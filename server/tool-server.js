// ============================================================
// DeepSeek Tool Agent v0.1.1 — 本地工具服务器
// 工具注册器(ToolRegistry) + 插件加载器(PluginRegistry) + 技能系统
//
// 架构: 插件化工具系统
//   - 工具: AnyAgentTool { name, label, description, parameters, execute }
//   - 插件: { id, name, version, register(api) }
//   - 执行管道: beforeHook → execute → afterHook
//   - 模式: OFF(拒绝) / MANUAL(审批) / AUTO(直接)
//   - Web搜索: 委托给 DeepSeek 内置能力，不在服务端实现
// ============================================================

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ToolRegistry, jsonResult, createToolContext } = require('./tool-registry');
const { PluginRegistry } = require('./plugin-loader');
const mcpClient = require('./mcp-client');
const crossPlatform = require('./cross-platform');

const PORT = 3002;
const ENGINE_VERSION = '0.1.1';
const SERVER_DIR = path.resolve(__dirname);

var WORKSPACE_DIR = path.resolve(__dirname, '..', 'workspace');
var CONFIG_DIR = path.join(WORKSPACE_DIR, 'config');
var MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory');
var SKILLS_DIR = path.join(WORKSPACE_DIR, 'skills');
var PLUGINS_DIR = path.join(WORKSPACE_DIR, 'plugins');
var BUILTIN_SKILLS_DIR = path.join(SERVER_DIR, 'builtin-skills');
var LOGS_DIR = path.join(SERVER_DIR, 'logs');

var ALLOWED_WRITE_PATHS = [WORKSPACE_DIR];

// ============================================================
// 全局实例
// ============================================================
const toolRegistry = new ToolRegistry(WORKSPACE_DIR);
const pluginRegistry = new PluginRegistry(toolRegistry, {
  workspaceDir: WORKSPACE_DIR,
  engineVersion: ENGINE_VERSION,
  scanDirs: []
});

// ============================================================
// 目录初始化
// ============================================================
async function ensureDirectories() {
  const dirs = [WORKSPACE_DIR, CONFIG_DIR, MEMORY_DIR, SKILLS_DIR, PLUGINS_DIR, LOGS_DIR];
  for (const dir of dirs) {
    try { await fs.mkdir(dir, { recursive: true }); } catch (e) {}
  }
  await copyBuiltinSkills();
  console.log(`[ToolServer] 工作目录: ${WORKSPACE_DIR}`);
  console.log(`[ToolServer] 技能目录: ${SKILLS_DIR}`);
  console.log(`[ToolServer] 插件目录: ${PLUGINS_DIR}`);
}

async function copyBuiltinSkills() {
  try {
    const entries = await fs.readdir(BUILTIN_SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const src = path.join(BUILTIN_SKILLS_DIR, entry.name);
      const dst = path.join(SKILLS_DIR, entry.name);
      try { await fs.access(dst); } catch {
        await copyDir(src, dst);
        console.log(`[ToolServer] 安装内置技能: ${entry.name}`);
      }
    }
  } catch (e) {}
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(srcPath, dstPath);
    else await fs.copyFile(srcPath, dstPath);
  }
}

// ============================================================
// 插件加载
// ============================================================
async function loadPlugins() {
  console.log('[ToolServer] 发现并加载插件...');
  try {
    const discovered = await pluginRegistry.discover();
    for (const pluginDef of discovered) {
      const loaded = await pluginRegistry.load(pluginDef);
      const status = loaded ? ' meet' : ' muted';
      console.log(`[ToolServer] 插件 ${pluginDef.id || pluginDef.name || 'unknown'}: ${status}`);
    }

    // 输出诊断信息
    for (const diag of pluginRegistry.diagnosticMessages) {
      const prefix = diag.level === 'error' ? '[Plugin Error]' : '[Plugin Warn]';
      console.log(`[ToolServer] ${prefix} ${diag.pluginId}: ${diag.message}`);
    }

    console.log(`[ToolServer] 已加载 ${pluginRegistry.plugins.length} 个插件`);
    console.log(`[ToolServer] 已注册 ${toolRegistry.listTools().length} 个工具`);
  } catch (e) {
    console.error('[ToolServer] 插件加载失败:', e.message);
  }

  // 加载 MCP 服务器
  try {
    var mcpTools = await mcpClient.loadMcpServers(toolRegistry, WORKSPACE_DIR);
    if (mcpTools.length > 0) {
      console.log('[ToolServer] MCP 工具已注册: ' + mcpTools.join(', '));
    }
  } catch (e) {
    console.error('[ToolServer] MCP 加载失败:', e.message);
  }
}

// ============================================================
// 插件管理器工具 — 让 Web 端 AI 可以安装/卸载/重载插件
// ============================================================
function registerPluginManagerTools() {

  toolRegistry.registerTool(function (ctx) {
    return [
      {
        name: 'plugin_list',
        label: 'List Plugins',
        description: '列出所有已安装插件及其状态。参数: 无',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async function () {
          var plugins = pluginRegistry.plugins.map(function (p) {
            var tools = [];
            var pluginTools = toolRegistry.listTools().filter(function (t) { return t.pluginId === p.id; });
            pluginTools.forEach(function (t) { tools.push(t.name); });
            return {
              id: p.id,
              name: p.name,
              version: p.version,
              kind: p.kind,
              origin: p.origin,
              loaded: p.loaded,
              tools: tools
            };
          });
          return [{ type: 'text', text: JSON.stringify({
            success: true,
            tool: 'plugin_list',
            count: plugins.length,
            plugins: plugins
          }) }];
        }
      },
      {
        name: 'plugin_install',
        label: 'Install Plugin',
        description: '安装新插件：创建 plugin.json + index.js 并自动加载。参数: id(插件ID), name(插件名), description(描述), kind(类型:tool/memory), tools(工具名数组), code(index.js源码)',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '插件唯一ID' },
            name: { type: 'string', description: '插件显示名称' },
            description: { type: 'string', description: '插件描述' },
            kind: { type: 'string', description: '插件类型: tool 或 memory' },
            tools: { type: 'array', description: '工具名列表,如["my_tool"]' },
            code: { type: 'string', description: 'index.js 完整源码 (Node.js)' }
          },
          required: ['id', 'name', 'code']
        },
        execute: async function (_toolCallId, args) {
          // 验证插件ID，防止路径穿越
          if (!args.id || !/^[a-zA-Z0-9_-]+$/.test(args.id)) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_install', error: '插件ID只能包含字母、数字、下划线和连字符' }) }];
          }
          // 安全检查: 插件安装需要用户确认，防止远程代码注入
          if (!ctx._confirmed) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'plugin_install',
              error: '插件安装需要用户确认，不可自动执行',
              needsConfirmation: true
            }) }];
          }
          try {
            var pluginDir = path.join(PLUGINS_DIR, args.id);
            var manifest = {
              id: args.id,
              name: args.name,
              version: '1.0.0',
              description: args.description || '',
              entry: 'index.js',
              requiredEngineVersion: '^2.3.0',
              tools: args.tools || [],
              kind: args.kind || 'tool'
            };

            await fs.mkdir(pluginDir, { recursive: true });
            await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8');
            await fs.writeFile(path.join(pluginDir, 'index.js'), args.code, 'utf-8');

            var discovered = await pluginRegistry.discover();
            var loaded = false;
            for (var i = 0; i < discovered.length; i++) {
              if (discovered[i].id === args.id || discovered[i].source === pluginDir) {
                loaded = await pluginRegistry.load(discovered[i]);
                break;
              }
            }

            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'plugin_install',
              pluginId: args.id,
              loaded: loaded,
              path: pluginDir,
              message: loaded ? '插件已安装并加载' : '插件已安装但加载失败，检查index.js语法'
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'plugin_install',
              error: e.message
            }) }];
          }
        }
      },
      {
        name: 'plugin_install_url',
        label: 'Install Plugin from URL',
        description: '从 URL 下载并安装插件包。支持 GitHub 仓库或 zip 包。参数: url(插件地址), id(插件ID)',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '插件包 URL（GitHub 仓库地址或 zip 包地址）' },
            id: { type: 'string', description: '插件唯一ID' }
          },
          required: ['url', 'id']
        },
        execute: async function (_toolCallId, args) {
          if (!args.id || !/^[a-zA-Z0-9_-]+$/.test(args.id)) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_install_url', error: '插件ID只能包含字母、数字、下划线和连字符' }) }];
          }
          if (!ctx._confirmed) {
            return [{ type: 'text', text: JSON.stringify({
              success: false, tool: 'plugin_install_url',
              error: '从 URL 安装插件需要用户确认', needsConfirmation: true
            }) }];
          }
          try {
            var pluginDir = path.join(PLUGINS_DIR, args.id);
            // 检查是否已存在
            try { await fs.access(pluginDir); return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_install_url', error: '插件 ' + args.id + ' 已存在，请先卸载' }) }]; } catch (e) {}

            var fetchUrl = args.url;
            // GitHub 仓库地址转换为 zip 下载链接
            if (fetchUrl.match(/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/)) {
              fetchUrl = fetchUrl.replace(/\/$/, '') + '/archive/refs/heads/main.zip';
            }

            // 下载
            var https = require('https');
            var http = require('http');
            var client = fetchUrl.startsWith('https') ? https : http;

            var zipData = await new Promise(function(resolve, reject) {
              client.get(fetchUrl, { timeout: 30000 }, function(res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                  // 跟随重定向
                  var redirectClient = res.headers.location.startsWith('https') ? https : http;
                  redirectClient.get(res.headers.location, { timeout: 30000 }, function(res2) {
                    var chunks = [];
                    res2.on('data', function(c) { chunks.push(c); });
                    res2.on('end', function() { resolve(Buffer.concat(chunks)); });
                  }).on('error', reject);
                } else {
                  var chunks = [];
                  res.on('data', function(c) { chunks.push(c); });
                  res.on('end', function() { resolve(Buffer.concat(chunks)); });
                }
              }).on('error', reject);
            });

            // 保存 zip 并解压
            var tmpZip = path.join(os.tmpdir(), 'plugin_' + args.id + '.zip');
            await fs.writeFile(tmpZip, zipData);

            // 使用 Node.js 内置解压（或 fallback 到系统 unzip）
            var tmpDir = path.join(os.tmpdir(), 'plugin_' + args.id);
            await fs.mkdir(tmpDir, { recursive: true });

            try {
              // 尝试用 child_process 解压
              var { execFileSync } = require('child_process');
              if (process.platform === 'win32') {
                execFileSync('powershell', ['-Command', 'Expand-Archive', '-Path', tmpZip, '-DestinationPath', tmpDir, '-Force'], { timeout: 15000 });
              } else {
                execFileSync('unzip', ['-o', tmpZip, '-d', tmpDir], { timeout: 15000 });
              }
            } catch (e) {
              return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_install_url', error: '解压失败: ' + e.message }) }];
            }

            // 查找 plugin.json（可能在子目录中）
            var foundDir = null;
            var entries = await fs.readdir(tmpDir, { withFileTypes: true });
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].isDirectory()) {
                try {
                  await fs.access(path.join(tmpDir, entries[i].name, 'plugin.json'));
                  foundDir = path.join(tmpDir, entries[i].name);
                  break;
                } catch (e) {}
              }
            }
            if (!foundDir) {
              try { await fs.access(path.join(tmpDir, 'plugin.json')); foundDir = tmpDir; } catch (e) {}
            }
            if (!foundDir) {
              return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_install_url', error: '下载的包中未找到 plugin.json' }) }];
            }

            // 复制到插件目录
            await fs.mkdir(pluginDir, { recursive: true });
            var files = await fs.readdir(foundDir, { withFileTypes: true });
            for (var i = 0; i < files.length; i++) {
              var srcFile = path.join(foundDir, files[i].name);
              var dstFile = path.join(pluginDir, files[i].name);
              if (files[i].isDirectory()) {
                var { execFileSync: cp } = require('child_process');
                if (process.platform === 'win32') {
                  cp('xcopy', [srcFile, dstFile + '\\', '/E', '/I', '/Y'], { timeout: 10000 });
                } else {
                  cp('cp', ['-r', srcFile, dstFile], { timeout: 10000 });
                }
              } else {
                await fs.copyFile(srcFile, dstFile);
              }
            }

            // 清理临时文件
            try { await fs.unlink(tmpZip); } catch (e) {}
            try {
              var { execFileSync: rm } = require('child_process');
              if (process.platform === 'win32') {
                rm('rmdir', ['/S', '/Q', tmpDir], { timeout: 10000 });
              } else {
                rm('rm', ['-rf', tmpDir], { timeout: 10000 });
              }
            } catch (e) {}

            // 加载插件
            var discovered = await pluginRegistry.discover();
            var loaded = false;
            for (var i = 0; i < discovered.length; i++) {
              if (discovered[i].id === args.id || discovered[i].source === pluginDir) {
                loaded = await pluginRegistry.load(discovered[i]);
                break;
              }
            }

            return [{ type: 'text', text: JSON.stringify({
              success: true, tool: 'plugin_install_url',
              pluginId: args.id, loaded: loaded, path: pluginDir,
              message: loaded ? '插件已从 URL 安装并加载' : '插件已下载但加载失败，检查 plugin.json 和 index.js'
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_install_url', error: e.message }) }];
          }
        }
      },
      {
        name: 'plugin_reload',
        label: 'Reload Plugins',
        description: '重新扫描并加载所有插件（热重载）。参数: 无',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async function () {
          try {
            // 先卸载所有已加载的插件（清理工具注册）
            var existingIds = [];
            for (var [pid] of pluginRegistry._plugins) { existingIds.push(pid); }
            for (var i = 0; i < existingIds.length; i++) {
              await pluginRegistry.unload(existingIds[i]);
            }
            var discovered = await pluginRegistry.discover();
            var loadedCount = 0;
            for (var i = 0; i < discovered.length; i++) {
              if (await pluginRegistry.load(discovered[i])) loadedCount++;
            }
            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'plugin_reload',
              unloaded: existingIds.length,
              total: discovered.length,
              loaded: loadedCount,
              failed: discovered.length - loadedCount,
              diagnostics: pluginRegistry.diagnosticMessages,
              message: '已卸载 ' + existingIds.length + ' 个旧插件，重载 ' + loadedCount + '/' + discovered.length + ' 个插件'
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'plugin_reload',
              error: e.message
            }) }];
          }
        }
      },
      {
        name: 'plugin_uninstall',
        label: 'Uninstall Plugin',
        description: '卸载插件（删除目录）。参数: id(插件ID)',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '插件ID' }
          },
          required: ['id']
        },
        execute: async function (_toolCallId, args) {
          // 验证插件ID，防止路径穿越
          if (!args.id || !/^[a-zA-Z0-9_-]+$/.test(args.id)) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'plugin_uninstall', error: '插件ID只能包含字母、数字、下划线和连字符' }) }];
          }
          try {
            var pluginDir = path.join(PLUGINS_DIR, args.id);
            var existed = false;
            try { await fs.access(pluginDir); existed = true; } catch (e) {}
            if (!existed) {
              return [{ type: 'text', text: JSON.stringify({
                success: true,
                tool: 'plugin_uninstall',
                pluginId: args.id,
                message: '插件目录不存在，无需卸载'
              }) }];
            }
            await pluginRegistry.unload(args.id);
            await removeDir(pluginDir);
            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'plugin_uninstall',
              pluginId: args.id,
              message: '插件已卸载'
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'plugin_uninstall',
              error: e.message
            }) }];
          }
        }
      }
    ];
  });

  console.log('[ToolServer] 已注册 5 个插件管理工具: plugin_list, plugin_install, plugin_install_url, plugin_reload, plugin_uninstall');
}

// 技能管理工具
function registerSkillManagerTools() {
  toolRegistry.registerTool(function (ctx) {
    return [
      {
        name: 'skill_list',
        label: 'List Skills',
        description: '列出所有已注册技能及其状态。参数: 无',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async function () {
          var result = await skills_list();
          return [{ type: 'text', text: JSON.stringify(result) }];
        }
      },
      {
        name: 'skill_create',
        label: 'Create Skill',
        description: '创建新技能。参数: name(技能名), description(描述), content(Skill.md正文内容)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名称（英文标识）' },
            description: { type: 'string', description: '技能描述' },
            content: { type: 'string', description: 'SKILL.md 正文内容（Markdown格式）' }
          },
          required: ['name', 'content']
        },
        execute: async function (_toolCallId, args) {
          try {
            await skills_create(args.name, args.description || '', args.content);
            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'skill_create', name: args.name, message: '技能已创建' }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'skill_create', error: e.message }) }];
          }
        }
      },
      {
        name: 'skill_toggle',
        label: 'Toggle Skill',
        description: '启用或禁用技能。参数: name(技能名), enabled(true/false)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '技能名称' },
            enabled: { type: 'boolean', description: 'true 启用, false 禁用' }
          },
          required: ['name', 'enabled']
        },
        execute: async function (_toolCallId, args) {
          try {
            await skills_toggle(args.name, args.enabled);
            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'skill_toggle', name: args.name, enabled: args.enabled, message: '技能已' + (args.enabled ? '启用' : '禁用') }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'skill_toggle', error: e.message }) }];
          }
        }
      }
    ];
  });
  console.log('[ToolServer] 已注册 3 个技能管理工具: skill_list, skill_create, skill_toggle');
}

async function removeDir(dirPath) {
  var entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dirPath, entries[i].name);
    if (entries[i].isDirectory()) await removeDir(full);
    else await fs.unlink(full);
  }
  await fs.rmdir(dirPath);
}

// ============================================================
// 日志
// ============================================================
async function appendLog(level, message, data) {
  try {
    var now = new Date();
    var dateStr = now.toISOString().split('T')[0];
    var timeStr = now.toTimeString().split(' ')[0];
    var logFile = path.join(LOGS_DIR, 'tool-server-' + dateStr + '.log');
    var logLine = '[' + timeStr + '] [' + level + '] ' + message;
    if (data) logLine += ' | data=' + JSON.stringify(data).substring(0, 500);
    logLine += '\n';
    await fs.appendFile(logFile, logLine, 'utf-8');
  } catch (e) {}
}

// ============================================================
// JSON 文件读写
// ============================================================
async function readJsonFile(filePath, defaultValue) {
  try { var raw = await fs.readFile(filePath, 'utf-8'); return JSON.parse(raw); }
  catch (e) { if (defaultValue !== undefined) return defaultValue; throw e; }
}

async function writeJsonFile(filePath, data) {
  var dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// YAML Frontmatter 解析 (SKILL.md)
// ============================================================
function parseYamlFrontmatter(content) {
  var match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { frontmatter: {}, body: content };
  var yaml = match[1];
  var body = content.substring(match[0].length);
  var fm = {};
  var lines = yaml.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var kv = lines[i].match(/^(\w[\w_-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { frontmatter: fm, body };
}

// ============================================================
// 技能系统 (SKILL.md)
// ============================================================
var SKILLS_MANIFEST = path.join(CONFIG_DIR, 'skills_manifest.json');

// 技能目录热加载：监听文件变化，自动重新扫描
var _skillsWatcher = null;
var _skillsWatcherTimer = null;
var _fsNative = require('fs');  // 原始 fs 模块（用于 fs.watch）
function startSkillsWatcher() {
  try {
    _skillsWatcher = _fsNative.watch(SKILLS_DIR, { recursive: true }, function(eventType, filename) {
      if (!filename) return;
      // 只关注 SKILL.md 文件变化
      if (!filename.endsWith('SKILL.md') && !filename.endsWith('SKILL.md~')) return;
      // 防抖：500ms 内只触发一次
      if (_skillsWatcherTimer) clearTimeout(_skillsWatcherTimer);
      _skillsWatcherTimer = setTimeout(async function() {
        _skillsWatcherTimer = null;
        try {
          var skills = await scanSkillsDir();
          console.log('[Skills] 检测到技能文件变化，重新扫描: ' + skills.length + ' 个技能');
        } catch (e) {
          console.error('[Skills] 热加载扫描失败:', e.message);
        }
      }, 500);
    });
    _skillsWatcher.on('error', function() { /* 忽略监听错误 */ });
    console.log('[Skills] 热加载监听已启动: ' + SKILLS_DIR);
  } catch (e) {
    console.log('[Skills] 热加载监听启动失败(不影响功能): ' + e.message);
  }
}

async function scanSkillsDir() {
  var skillDirs = [];
  try {
    var entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isDirectory()) continue;
      // 一级目录：直接检查 SKILL.md
      var skillMdPath = path.join(SKILLS_DIR, entries[i].name, 'SKILL.md');
      try { await fs.access(skillMdPath); skillDirs.push(entries[i].name); } catch (e) {
        // 二级目录：扫描子目录中的 SKILL.md（如 lark/lark-doc/SKILL.md）
        try {
          var subEntries = await fs.readdir(path.join(SKILLS_DIR, entries[i].name), { withFileTypes: true });
          for (var j = 0; j < subEntries.length; j++) {
            if (!subEntries[j].isDirectory()) continue;
            var subSkillMd = path.join(SKILLS_DIR, entries[i].name, subEntries[j].name, 'SKILL.md');
            try { await fs.access(subSkillMd); skillDirs.push(entries[i].name + '/' + subEntries[j].name); } catch (e2) {}
          }
        } catch (e2) {}
      }
    }
  } catch (e) {}
  return skillDirs;
}

async function loadSkillInfo(skillName) {
  var skillDir = path.join(SKILLS_DIR, skillName);
  var skillMdPath = path.join(skillDir, 'SKILL.md');
  try {
    var content = await fs.readFile(skillMdPath, 'utf-8');
    var parsed = parseYamlFrontmatter(content);
    return {
      name: parsed.frontmatter.name || skillName,
      description: parsed.frontmatter.description || '',
      content: parsed.body,
      filename: 'SKILL.md'
    };
  } catch (e) { return null; }
}

async function getSkillsWithStatus() {
  var manifest = await readJsonFile(SKILLS_MANIFEST, { enabled_skills: [], custom_skills: [] });
  var dirs = await scanSkillsDir();
  var skills = [];
  for (var i = 0; i < dirs.length; i++) {
    var info = await loadSkillInfo(dirs[i]);
    if (!info) continue;
    var enabledEntry = manifest.enabled_skills.find(function(s) { return s.name === dirs[i]; });
    var enabled = enabledEntry ? enabledEntry.enabled : false;
    var isCustom = manifest.custom_skills.some(function(s) { return s.name === dirs[i]; });
    skills.push({ name: info.name, description: info.description, content: info.content, dirName: dirs[i], enabled: enabled, isCustom: isCustom, filename: info.filename });
  }
  return { skills: skills, custom_skills: skills.filter(function(s) { return s.isCustom; }) };
}

async function skills_list() {
  try {
    var result = await getSkillsWithStatus();
    return { success: true, skills: result.skills, custom_skills: result.custom_skills };
  } catch (e) { return { success: true, skills: [], custom_skills: [] }; }
}

async function skills_create(name, description, content) {
  if (!name) throw new Error('缺少 name 参数');
  if (!content) throw new Error('缺少 content 参数');
  var safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_').substring(0, 64);
  var skillDir = path.join(SKILLS_DIR, safeName);
  try { await fs.access(skillDir); throw new Error('技能 ' + safeName + ' 已存在'); } catch (e) { if (e.message.includes('已存在')) throw e; }
  var frontmatter = '---\nname: ' + safeName + '\ndescription: ' + (description || '') + '\n---\n\n';
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), frontmatter + content, 'utf-8');
  var manifest = await readJsonFile(SKILLS_MANIFEST, { enabled_skills: [], custom_skills: [] });
  manifest.custom_skills = manifest.custom_skills || [];
  manifest.custom_skills.push({ name: safeName, description: description || '', enabled: true, filename: 'SKILL.md' });
  await writeJsonFile(SKILLS_MANIFEST, manifest);
  await appendLog('INFO', '技能已创建: ' + safeName);
  return { success: true, skill: { name: safeName, description: description || '' } };
}

// 【修复】安全辅助函数：校验名称参数，防止路径穿越攻击
function validateSafeName(name, label) {
  if (!name || !/^[a-zA-Z0-9_\-\/\u4e00-\u9fff]+$/.test(name)) {
    throw new Error((label || '名称') + '只能包含字母、数字、下划线、连字符、斜杠和中文');
  }
  // 防止路径穿越：不允许 .. 和连续斜杠
  if (name.indexOf('..') >= 0 || name.indexOf('//') >= 0 || name.indexOf('\\') >= 0) {
    throw new Error((label || '名称') + '包含非法路径字符');
  }
  return name;
}

async function skills_toggle(name, enabled) {
  // 【修复】校验技能名称，防止路径穿越
  validateSafeName(name, '技能名称');
  var skillDir = path.join(SKILLS_DIR, name);
  // 【修复】二次校验：确保解析后的路径仍在 SKILLS_DIR 内
  if (!skillDir.startsWith(SKILLS_DIR + path.sep) && skillDir !== SKILLS_DIR) {
    throw new Error('非法路径');
  }
  try { await fs.access(path.join(skillDir, 'SKILL.md')); } catch (e) { throw new Error('技能不存在: ' + name); }
  var manifest = await readJsonFile(SKILLS_MANIFEST, { enabled_skills: [], custom_skills: [] });
  var idx = manifest.enabled_skills.findIndex(function(s) { return s.name === name; });
  if (idx >= 0) manifest.enabled_skills[idx].enabled = enabled;
  else manifest.enabled_skills.push({ name: name, enabled: enabled });
  await writeJsonFile(SKILLS_MANIFEST, manifest);
  return { success: true, message: '技能 ' + name + ' 已' + (enabled ? '启用' : '禁用') };
}

async function skills_delete(name) {
  // 【修复】校验技能名称，防止路径穿越
  validateSafeName(name, '技能名称');
  var skillDir = path.join(SKILLS_DIR, name);
  // 【修复】二次校验：确保解析后的路径仍在 SKILLS_DIR 内
  if (!skillDir.startsWith(SKILLS_DIR + path.sep) && skillDir !== SKILLS_DIR) {
    throw new Error('非法路径');
  }
  try { await fs.access(skillDir); } catch (e) { throw new Error('技能不存在: ' + name); }
  await fs.rm(skillDir, { recursive: true, force: true });
  var manifest = await readJsonFile(SKILLS_MANIFEST, { enabled_skills: [], custom_skills: [] });
  manifest.custom_skills = (manifest.custom_skills || []).filter(function(s) { return s.name !== name; });
  manifest.enabled_skills = (manifest.enabled_skills || []).filter(function(s) { return s.name !== name; });
  await writeJsonFile(SKILLS_MANIFEST, manifest);
  return { success: true, message: '技能 ' + name + ' 已删除' };
}

// ============================================================
// Agent API
// ============================================================
var PERSONALITY_FILE = path.join(CONFIG_DIR, 'personality.json');
var TOOLS_CONFIG = path.join(CONFIG_DIR, 'tools_config.json');

var DEFAULT_PERSONALITY = {
  name: '默认助手', version: '1.0',
  traits: { style: '专业精确', tone: '友好', verbosity: '适中', creativity: '中等' },
  mission: '', custom_prompt: '',
  created_at: new Date().toISOString()
};

var DEFAULT_TOOLS = [
  { name: 'exec_command', description: '命令行执行', category: 'system', mode: 'manual' },
  { name: 'read_file', description: '读取文件', category: 'io', mode: 'auto' },
  { name: 'write_file', description: '写入文件', category: 'io', mode: 'auto' },
  { name: 'append_file', description: '追加文件', category: 'io', mode: 'auto' },
  { name: 'list_dir', description: '列出目录', category: 'io', mode: 'auto' },
  { name: 'search_files', description: '搜索文件', category: 'io', mode: 'auto' },
  { name: 'get_file_info', description: '文件信息', category: 'io', mode: 'auto' }
];

var AGENT_API = {

  async status() {
    var personality, memoryInited, tools, skillsData;
    try { personality = await readJsonFile(PERSONALITY_FILE, DEFAULT_PERSONALITY); } catch (e) { personality = DEFAULT_PERSONALITY; }
    try { await fs.access(path.join(MEMORY_DIR, 'memory_init.json')); memoryInited = true; } catch (e) { memoryInited = false; }
    try { tools = await readJsonFile(TOOLS_CONFIG, DEFAULT_TOOLS); } catch (e) { tools = DEFAULT_TOOLS; }
    try { skillsData = await getSkillsWithStatus(); } catch (e) { skillsData = { skills: [], custom_skills: [] }; }

    var allTools = toolRegistry.listTools();
    var sysInfo = crossPlatform.getSystemInfo();

    return {
      success: true, initialized: memoryInited, workspace: WORKSPACE_DIR,
      personality: personality, tools: tools, tools_available: allTools,
      skills: skillsData.skills, custom_skills: skillsData.custom_skills,
      plugins: pluginRegistry.plugins.map(function(p) { return { id: p.id, name: p.name, version: p.version, kind: p.kind, origin: p.origin }; }),
      plugin_diagnostics: pluginRegistry.diagnosticMessages,
      server: {
        pid: process.pid, uptime: Math.floor(process.uptime()),
        platform: sysInfo.platform, arch: sysInfo.arch,
        nodeVersion: sysInfo.nodeVersion, cpus: sysInfo.cpus,
        memoryMB: sysInfo.memoryMB, version: ENGINE_VERSION
      }
    };
  },

  async personality_get() {
    try { return { success: true, personality: await readJsonFile(PERSONALITY_FILE, DEFAULT_PERSONALITY) }; }
    catch (e) { return { success: true, personality: DEFAULT_PERSONALITY }; }
  },

  async personality_save(personality) {
    if (!personality || typeof personality !== 'object') throw new Error('无效的人格配置');
    var existing = await readJsonFile(PERSONALITY_FILE, DEFAULT_PERSONALITY);
    var merged = { ...existing, ...personality, traits: { ...existing.traits, ...(personality.traits || {}) }, updated_at: new Date().toISOString() };
    await writeJsonFile(PERSONALITY_FILE, merged);
    return { success: true, personality: merged };
  },

  async personality_reset() {
    await writeJsonFile(PERSONALITY_FILE, { ...DEFAULT_PERSONALITY, created_at: new Date().toISOString() });
    return { success: true, personality: DEFAULT_PERSONALITY };
  },

  async memory_init() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    var initFile = path.join(MEMORY_DIR, 'memory_init.json');
    var initData = { initialized: true, created_at: new Date().toISOString(), description: 'Agent 记忆存储目录' };
    await writeJsonFile(initFile, initData);
    return { success: true, memory: initData };
  },

  async memory_save(key, data) {
    if (!key) throw new Error('缺少 key 参数');
    var memFile = path.join(MEMORY_DIR, key.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_') + '.json');
    var entry = { key: key, data: data, saved_at: new Date().toISOString() };
    await writeJsonFile(memFile, entry);
    return { success: true };
  },

  async memory_load() {
    var initData = await readJsonFile(path.join(MEMORY_DIR, 'memory_init.json'), { initialized: false });
    var entries = [];
    try {
      var files = await fs.readdir(MEMORY_DIR);
      for (var i = 0; i < files.length; i++) {
        if (files[i] === 'memory_init.json' || !files[i].endsWith('.json')) continue;
        try { entries.push(await readJsonFile(path.join(MEMORY_DIR, files[i]))); } catch (e) {}
      }
    } catch (e) {}
    return { success: true, memory: initData, entries: entries, entry_count: entries.length };
  },

  async memory_clear() {
    try {
      var files = await fs.readdir(MEMORY_DIR);
      for (var i = 0; i < files.length; i++) { try { await fs.unlink(path.join(MEMORY_DIR, files[i])); } catch (e) {} }
    } catch (e) {}
    return { success: true };
  },

  async tools_list() {
    try { return { success: true, tools: await readJsonFile(TOOLS_CONFIG, DEFAULT_TOOLS) }; }
    catch (e) { return { success: true, tools: DEFAULT_TOOLS }; }
  },

  async tools_set_mode(name, mode) {
    if (['off', 'manual', 'auto'].indexOf(mode) === -1) throw new Error('mode 必须是 off, manual 或 auto');
    var tools = DEFAULT_TOOLS;
    try { tools = await readJsonFile(TOOLS_CONFIG, tools); } catch (e) {}
    var tool = tools.find(function(t) { return t.name === name; });
    if (!tool) throw new Error('未找到工具: ' + name);
    tool.mode = mode;
    await writeJsonFile(TOOLS_CONFIG, tools);
    return { success: true };
  },

  async tools_create(tool) {
    if (!tool || !tool.name) throw new Error('缺少 tool.name 参数');
    var tools = DEFAULT_TOOLS;
    try { tools = await readJsonFile(TOOLS_CONFIG, tools); } catch (e) {}
    if (tools.find(function(t) { return t.name === tool.name; })) throw new Error('工具 ' + tool.name + ' 已存在');
    tools.push({ name: tool.name, description: tool.description || '', category: tool.category || 'custom', mode: tool.mode || tool.defaultMode || 'manual' });
    await writeJsonFile(TOOLS_CONFIG, tools);
    return { success: true, tool: tools[tools.length - 1] };
  },

  async tools_delete(name) {
    if (!name) throw new Error('缺少 name 参数');
    var tools = DEFAULT_TOOLS;
    try { tools = await readJsonFile(TOOLS_CONFIG, tools); } catch (e) {}
    var idx = tools.findIndex(function(t) { return t.name === name; });
    if (idx < 0) throw new Error('未找到工具: ' + name);
    tools.splice(idx, 1);
    await writeJsonFile(TOOLS_CONFIG, tools);
    return { success: true, message: '工具 ' + name + ' 已删除' };
  },

  async quick_actions_get() {
    var configFile = path.join(CONFIG_DIR, 'quick_actions.json');
    var defaults = [
      { label: '总结会话并整理记忆', prompt: '请总结本次会话的关键内容，将重要信息整理后写入 memory/ 目录下的对应文件中。' },
      { label: '重试上次失败的工具', prompt: '请重新执行上一次失败的工具调用，分析失败原因并调整执行策略。' }
    ];
    try { return { success: true, actions: await readJsonFile(configFile, defaults) }; }
    catch (e) { return { success: true, actions: defaults }; }
  },

  async quick_actions_save(actions) {
    if (!Array.isArray(actions) || actions.length > 5) throw new Error('快捷操作最多5个');
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || typeof a !== 'object') throw new Error('快捷操作格式无效');
      if (typeof a.label !== 'string' || !a.label.trim()) throw new Error('快捷操作[' + i + ']缺少label');
      if (typeof a.prompt !== 'string' || !a.prompt.trim()) throw new Error('快捷操作[' + i + ']缺少prompt');
      a.label = a.label.trim().substring(0, 50);
      a.prompt = a.prompt.trim().substring(0, 2000);
    }
    var configFile = path.join(CONFIG_DIR, 'quick_actions.json');
    await writeJsonFile(configFile, actions);
    return { success: true };
  }
};

// ============================================================
// HTTP 服务器
// ============================================================
var server = http.createServer(async function(req, res) {
  // 【修复】请求超时保护：60 秒后自动终止连接
  req.setTimeout(60000, function() {
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: '请求超时' }));
    } else {
      res.end();
    }
  });
  var CORS_WHITELIST = [
    'chrome-extension://diaocpmadbepofacimmkigkkkeihnjio',
    'https://chat.deepseek.com',
    'https://chat.deepseek.com/',
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://kimi.com',
    'https://www.kimi.com',
    'https://kimi.moonshot.cn',
    'https://tongyi.aliyun.com',
    'https://qianwen.aliyun.com',
    'https://chat2.qianwen.com',
    'https://chat.qwen.ai',
    'https://www.qianwen.com',
    'https://qianwen.com',
    'https://chatglm.cn',
    'https://chat.z.ai',
    'https://z.ai',
    'https://www.doubao.com',
    'https://doubao.com',
    'http://localhost:3002'
  ];

  var requestOrigin = req.headers.origin || '';
  // 【修复】无 Origin 头的请求（curl/Postman 等非浏览器客户端）应放行，CORS 仅约束浏览器跨域
  var isBrowserCorsRequest = requestOrigin !== '';
  var allowedOrigin = CORS_WHITELIST.indexOf(requestOrigin) >= 0 ? requestOrigin : '';
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    if (isBrowserCorsRequest && !allowedOrigin) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200); res.end(); return;
  }
  // 仅对浏览器跨域请求执行来源校验，非浏览器请求（无 Origin 头）放行
  if (isBrowserCorsRequest && !allowedOrigin && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: '来源未授权' }));
    return;
  }

  try {
    var urlPath = req.url.split('?')[0];

    // --- Health ---
    if (urlPath === '/health' && req.method === 'GET') {
      var sysInfo = crossPlatform.getSystemInfo();
      var allTools = toolRegistry.listTools();
      var skills = await getSkillsWithStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok', version: ENGINE_VERSION,
        workspace: WORKSPACE_DIR, platform: sysInfo.platform, arch: sysInfo.arch,
        pid: process.pid, uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        tools_count: allTools.length,
        skills_count: skills.skills.length,
        plugins_count: pluginRegistry.plugins.length,
        cpus: sysInfo.cpus
      }));
      return;
    }

    if (req.method === 'POST' || req.method === 'GET') {
      var body = req.method === 'POST' ? await parseBody(req) : parseQuery(req);
      var result;

      switch (urlPath) {

        // --- 工具执行 (通过 ToolRegistry 管道) ---
        case '/api/tool':
          if (!body.name) { result = { success: false, error: '缺少 name 参数' }; break; }
          var toolResult = await toolRegistry.executeTool(body.name, body.args || body, { toolCallId: body.toolCallId, mode: body.mode || 'auto', _fromHttp: true });
          // 解包插件格式 [{type:"text", text:"..."}] → {success, ...}
          if (Array.isArray(toolResult) && toolResult.length > 0 && toolResult[0].text) {
            try { result = JSON.parse(toolResult[0].text); } catch (e) { result = { content: toolResult[0].text }; }
          } else {
            result = { content: toolResult };
          }
          break;

        // --- 工具列表 (新格式) ---
        case '/api/tools':
          if (req.method === 'GET') {
            result = { success: true, tools: toolRegistry.listTools() };
          } else if (body.action === 'execute') {
            var execResult = await toolRegistry.executeTool(body.name, body.args || {}, { mode: body.mode || 'auto', _fromHttp: true });
            if (Array.isArray(execResult) && execResult.length > 0 && execResult[0].text) {
              try { result = JSON.parse(execResult[0].text); } catch (e) { result = { content: execResult[0].text }; }
            } else {
              result = { content: execResult };
            }
          } else {
            result = { success: true, tools: toolRegistry.listTools() };
          }
          break;

        // --- 插件管理 ---
        case '/api/plugins':
          if (req.method === 'GET') {
            result = {
              success: true,
              plugins: pluginRegistry.plugins,
              diagnostics: pluginRegistry.diagnosticMessages
            };
          } else if (body.action === 'reload') {
            // 重新扫描并加载
            var discovered = await pluginRegistry.discover();
            var loadedCount = 0;
            for (var i = 0; i < discovered.length; i++) {
              if (await pluginRegistry.load(discovered[i])) loadedCount++;
            }
            result = {
              success: true,
              loaded: loadedCount,
              total: discovered.length,
              plugins: pluginRegistry.plugins,
              diagnostics: pluginRegistry.diagnosticMessages
            };
          } else {
            // 【修复】未知 action 返回错误而非 result=undefined
            result = { success: false, error: '未知操作: ' + (body.action || '(空)') };
          }
          break;

        // --- 飞书消息队列 ---
        case '/api/feishu/messages':
          result = await handleFeishuMessages(body, req.method, urlPath);
          break;

        // --- 飞书回复回传 ---
        case '/api/feishu/reply':
          result = await handleFeishuReply(body);
          break;

        // --- 已废弃: 兼容旧 API 端点 (v0.1.1+ 请使用 /exec) ---
        case '/api/read':
          result = await executeToolLegacy('read_file', { path: body.path });
          break;
        case '/api/write':
          result = await executeToolLegacy('write_file', { path: body.path, content: body.content });
          break;
        case '/api/list':
          result = await executeToolLegacy('list_dir', { path: body.path });
          break;
        case '/api/exec':
          result = await executeToolLegacy('exec_command', { command: body.command, cwd: body.cwd, timeout: body.timeout });
          break;
        case '/api/append':
          result = await executeToolLegacy('append_file', { path: body.path, content: body.content });
          break;
        case '/api/search':
          result = await executeToolLegacy('search_files', { pattern: body.pattern, root: body.root });
          break;
        case '/api/file-info':
          result = await executeToolLegacy('get_file_info', { path: body.path });
          break;

        case '/api/log':
          await appendLog(body.level || 'INFO', body.message, body.data);
          result = { success: true };
          break;

        case '/api/confirm':
          // 二次确认执行 — 用户确认后重新执行被拦截的工具
          if (!body.tool || !body.args) {
            result = { success: false, error: '缺少 tool 或 args 参数' };
          } else {
            try {
              const confirmResult = await toolRegistry.executeToolConfirmed(body.tool, body.args, { toolCallId: 'confirm_' + Date.now() });
              // 解包插件格式 [{type:"text", text:"..."}] → {success, ...}
              if (Array.isArray(confirmResult) && confirmResult.length > 0 && confirmResult[0].text) {
                try { result = JSON.parse(confirmResult[0].text); } catch(e) { result = { content: confirmResult[0].text }; }
              } else {
                result = confirmResult || { success: false, error: '执行无返回' };
              }
            } catch (e) {
              result = { success: false, error: e.message };
            }
          }
          break;

        case '/api/config':
          result = await handleConfig(body);
          break;

        case '/api/agent/personality':
          if (req.method === 'GET') result = await AGENT_API.personality_get();
          else if (body.action === 'save') result = await AGENT_API.personality_save(body.personality);
          else if (body.action === 'reset') result = await AGENT_API.personality_reset();
          else result = await AGENT_API.personality_get();
          break;

        case '/api/mcp/status':
          result = { success: true, mcp: mcpClient.getStatus() };
          break;

        case '/api/agent/memory':
          if (body.action === 'init') result = await AGENT_API.memory_init();
          else if (body.action === 'load') result = await AGENT_API.memory_load();
          else if (body.action === 'clear') result = await AGENT_API.memory_clear();
          else if (body.action === 'save') result = await AGENT_API.memory_save(body.key, body.data);
          else result = { success: false, error: '未知操作' };
          break;

        case '/api/agent/skills':
          if (req.method === 'GET') result = await skills_list();
          else if (body.action === 'toggle') result = await skills_toggle(body.name, body.enabled);
          else if (body.action === 'create') result = await skills_create(body.name, body.description, body.content);
          else if (body.action === 'delete') result = await skills_delete(body.name);
          else result = await skills_list();
          break;

        case '/api/agent/tools':
          if (req.method === 'GET') result = await AGENT_API.tools_list();
          else if (body.action === 'set_mode') result = await AGENT_API.tools_set_mode(body.name, body.mode);
          else if (body.action === 'create') result = await AGENT_API.tools_create(body.tool);
          else if (body.action === 'delete') result = await AGENT_API.tools_delete(body.name);
          else result = await AGENT_API.tools_list();
          break;

        case '/api/agent/status':
          result = await AGENT_API.status();
          break;

        case '/api/agent/quick-actions':
          if (req.method === 'GET') result = await AGENT_API.quick_actions_get();
          else if (body.action === 'save') result = await AGENT_API.quick_actions_save(body.actions);
          else result = await AGENT_API.quick_actions_get();
          break;

        case '/api/save_tool_history': {
          // 持久化工具调用历史，供 get_tool_history 工具查询
          try {
            var histPath = require('path').join(WORKSPACE_DIR, 'sessions', 'tool-history.json');
            var fsHist = require('fs');
            fsHist.mkdirSync(require('path').dirname(histPath), { recursive: true });
            var existing = { entries: [] };
            try { existing = JSON.parse(fsHist.readFileSync(histPath, 'utf-8')); } catch(e) {}
            if (!existing.entries) existing.entries = [];
            existing.entries.push({
              iteration: body.iteration || (existing.entries.length + 1),
              results: body.results || [],
              timestamp: body.timestamp || Date.now()
            });
            // 保留最近 50 轮历史
            if (existing.entries.length > 50) existing.entries = existing.entries.slice(-50);
            fsHist.writeFileSync(histPath, JSON.stringify(existing, null, 2), 'utf-8');
            result = { success: true };
          } catch(e) {
            result = { success: false, error: e.message };
          }
          break;
        }

        case '/exec':
          if (req.method === 'POST') {
            var execToolName = body.tool;
            var execArgs = body.args || {};
            if (!execToolName) { result = { success: false, error: { code: 'MISSING_PARAM', message: '缺少 tool 参数' } }; break; }
            var execResult = await toolRegistry.executeTool(execToolName, execArgs, { mode: body.mode || 'auto', _fromHttp: true });
            if (Array.isArray(execResult) && execResult.length > 0 && execResult[0].text) {
              try { result = JSON.parse(execResult[0].text); } catch (e) { result = { content: execResult[0].text }; }
            } else {
              result = { content: execResult };
            }
            // 保留工具执行的实际成功/失败状态，不再强制覆盖为 true
            if (typeof result.success === 'undefined') {
              result.success = !result.error && !result.blocked;
            }
          } else {
            result = { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' } };
          }
          break;

        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Unknown endpoint: ' + urlPath }));
          return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    }
  } catch (error) {
    console.error('[ToolServer] Error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: error.message } }));
  }
});

async function executeToolLegacy(name, args) {
  var result = await toolRegistry.executeTool(name, args, { _fromHttp: true });
  if (Array.isArray(result) && result.length > 0 && result[0].text) {
    try { return JSON.parse(result[0].text); } catch (e) { return { content: result[0].text }; }
  }
  return { content: result };
}

var GLOBAL_PERMISSIONS = false;

async function handleConfig(body) {
  if (body.action === 'get') {
    var sysInfo = crossPlatform.getSystemInfo();
    return {
      success: true, workspace: WORKSPACE_DIR, logsDir: LOGS_DIR,
      allowedWritePaths: ALLOWED_WRITE_PATHS, platform: sysInfo.platform,
      port: PORT, version: ENGINE_VERSION,
      tools_count: toolRegistry.listTools().length,
      plugins_count: pluginRegistry.plugins.length,
      globalPermissions: GLOBAL_PERMISSIONS
    };
  } else if (body.action === 'set-permissions') {
    GLOBAL_PERMISSIONS = !!body.global;
    // 安全限制: 即使全局权限开启，也只允许写入工作目录，不允许设置根路径
    ALLOWED_WRITE_PATHS = [WORKSPACE_DIR];
    toolRegistry.setGlobalPermissions(GLOBAL_PERMISSIONS);
    return { success: true, globalPermissions: GLOBAL_PERMISSIONS };
  } else if (body.action === 'restrict-permissions') {
    GLOBAL_PERMISSIONS = false;
    ALLOWED_WRITE_PATHS = [WORKSPACE_DIR];
    toolRegistry.setGlobalPermissions(false);
    return { success: true, globalPermissions: false };
  }
  return { success: false, error: '未知操作' };
}

// ============================================================
// 飞书消息队列 — 监听器收消息后写入，前端扩展轮询读取并注入聊天
// ============================================================
var feishuQueue = [];

async function handleFeishuMessages(body, method) {
  if (method === 'GET') {
    // 【修复】GET 时自动清理已处理消息，防止内存泄漏
    feishuQueue = feishuQueue.filter(function(m) { return !m.processed; });
    var pending = feishuQueue;
    return { success: true, messages: pending, count: pending.length, queueTotal: feishuQueue.length };
  }
  if (method === 'POST') {
    var msg = {
      id: 'fs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6),
      senderId: body.senderId || '',
      chatId: body.chatId || '',
      content: body.content || '',
      messageType: body.messageType || 'text',
      timestamp: body.timestamp || Date.now(),
      processed: false,
      receivedAt: Date.now()
    };
    feishuQueue.push(msg);
    if (feishuQueue.length > 200) feishuQueue = feishuQueue.slice(-200);
    console.log('[Feishu] 消息入队:', msg.id, msg.content.substring(0,40));
    return { success: true, id: msg.id };
  }
  if (method === 'PUT' || method === 'PATCH') {
    var found = null;
    for (var i = 0; i < feishuQueue.length; i++) {
      if (feishuQueue[i].id === body.id) { feishuQueue[i].processed = true; found = feishuQueue[i]; break; }
    }
    return { success: !!found, id: body.id, message: found ? '已标记处理' : '未找到' };
  }
  if (method === 'DELETE') {
    feishuQueue = feishuQueue.filter(function(m) { return m.id !== body.id; });
    return { success: true };
  }
  return { success: false, error: '不支持的请求方法' };
}

// 【修复】跨平台兼容：根据操作系统选择 lark-cli 路径
var LARK_CLI = process.platform === 'win32'
  ? path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe')
  : path.join((process.env.HOME || '/usr/local'), '.npm-global', 'lib', 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli');
// 【修复】子进程超时时间（毫秒）
var CHILD_PROCESS_TIMEOUT_MS = 30000;

async function handleFeishuReply(body) {
  if (!body.chatId || !body.text) {
    return { success: false, error: '缺少 chatId 或 text' };
  }

  var text = body.text;
  if (text.length > 4000) text = text.substring(0, 4000) + '...[已截断]';

  return new Promise(function(resolve) {
    var child = spawn(LARK_CLI, [
      'im', '+messages-send',
      '--chat-id', body.chatId,
      '--text', text,
      '--as', 'bot'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    // 【修复】子进程超时保护：超时后强制终止
    var childTimer = setTimeout(function() {
      try { child.kill('SIGKILL'); } catch(e) {}
      resolve({ success: false, error: 'lark-cli 执行超时' });
    }, CHILD_PROCESS_TIMEOUT_MS);

    var stdout = '';
    var stderr = '';
    child.stdout.on('data', function(d) { stdout += d.toString(); });
    child.stderr.on('data', function(d) { stderr += d.toString(); });

    child.on('close', function(code) {
      clearTimeout(childTimer);
      console.log('[Feishu] 回复结果:', code === 0 ? 'OK' : 'FAIL', body.chatId, text.substring(0, 30));
      if (code === 0) {
        try {
          var r = JSON.parse(stdout);
          resolve({ success: true, messageId: r.message_id || (r.data && r.data.message_id) || '' });
        } catch(e) {
          resolve({ success: true, raw: stdout });
        }
      } else {
        resolve({ success: false, error: stderr || stdout, exitCode: code });
      }
    });

    child.on('error', function(e) {
      clearTimeout(childTimer);
      console.log('[Feishu] 回复错误:', e.message);
      resolve({ success: false, error: e.message });
    });
  });
}

// 【修复】请求体最大 10MB，防止内存耗尽攻击
var MAX_BODY_SIZE = 10 * 1024 * 1024;
// 【修复】请求体接收超时 30 秒，防止慢速客户端挂起
var BODY_TIMEOUT_MS = 30000;

function parseBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    var receivedBytes = 0;
    // 【修复】超时保护：若客户端在指定时间内未完成发送则中止
    var timer = setTimeout(function() {
      req.destroy(new Error('请求体接收超时'));
    }, BODY_TIMEOUT_MS);

    req.on('data', function(chunk) {
      receivedBytes += chunk.length;
      // 【修复】大小限制：超过上限立即中止连接
      if (receivedBytes > MAX_BODY_SIZE) {
        clearTimeout(timer);
        req.destroy(new Error('请求体超过最大限制 ' + MAX_BODY_SIZE + ' 字节'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function() {
      clearTimeout(timer);
      try {
        var buffer = Buffer.concat(chunks);
        var data = buffer.toString('utf-8');
        resolve(data ? JSON.parse(data) : {});
      } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', function(err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseQuery(req) {
  var urlObj = new URL(req.url, 'http://localhost');
  var params = {};
  urlObj.searchParams.forEach(function(v, k) { params[k] = v; });
  return params;
}

// ============================================================
// 启动
// ============================================================
ensureDirectories().then(async function() {
  await loadPlugins();
  registerPluginManagerTools();
  registerSkillManagerTools();
  server.listen(PORT, function() {
    var sysInfo = crossPlatform.getSystemInfo();
    console.log('\n\x1b[36m\x1b[1m  DeepSeek Tool Agent v' + ENGINE_VERSION + ' — 本地工具服务器\x1b[0m\n');
    console.log('  Server:    http://localhost:' + PORT);
    console.log('  Workspace: ' + WORKSPACE_DIR);
    console.log('  Platform:  ' + sysInfo.platform + ' / ' + sysInfo.arch + ' / Node ' + sysInfo.nodeVersion);
    console.log('  Tools:     ' + toolRegistry.listTools().length + ' registered');
    console.log('  Plugins:   ' + pluginRegistry.plugins.length + ' loaded');
    console.log('  Skills:    SKILL.md');
    console.log('');
    console.log('  API v0.1.1:  /exec (统一工具执行端点)');
    console.log('             /api/tool (ToolRegistry pipeline)');
    console.log('             /api/tools (list/execute)');
    console.log('             /api/plugins (list/reload)');
    console.log('             /api/read|write|list|exec|append|search|file-info (legacy compat)');
    console.log('             /api/agent/* (personality/memory/skills/tools/quick-actions)');
    console.log('');
    console.log('  Press Ctrl+C to stop\n');

    // 技能目录热加载：监听 SKILLS_DIR 变化
    startSkillsWatcher();
  });
});

process.on('SIGINT', function() { console.log('\nShutting down...'); mcpClient.disconnectAll(); server.close(function() { process.exit(0); }); });
process.on('uncaughtException', function(err) {
  console.error('=== 未捕获异常 ===');
  console.error('时间:', new Date().toISOString());
  console.error('类型:', err.constructor.name);
  console.error('消息:', err.message);
  console.error('堆栈:', err.stack || '(无堆栈)');
  console.error('==================');
  // 进程状态可能已损坏，安全退出让 launcher 重启
  console.error('进程将在 3 秒后退出...');
  setTimeout(function() { process.exit(1); }, 3000);
});
process.on('unhandledRejection', function(reason, promise) {
  console.error('=== 未处理的 Promise 拒绝 ===');
  console.error('时间:', new Date().toISOString());
  console.error('原因:', reason);
  if (reason && reason.stack) console.error('堆栈:', reason.stack);
  console.error('==========================');
});