// ============================================================
// DeepSeek Tool Agent v2.3 — 工具注册器 (openclaw 兼容)
//
// 核心模式来自 openclaw-zero-token-main:
//   - AnyAgentTool: { name, label, description, parameters, execute }
//   - ToolFactory: (ctx) => AnyAgentTool | AnyAgentTool[]
//   - 执行管道: beforeHooks → execute → afterHooks
//   - 审批/模式: OFF(拒绝) / MANUAL(审批) / AUTO(直接执行)
//   - 结果包装: jsonResult() 返回 [{type:"text", text:JSON.stringify(data)}]
// ============================================================

const { exec } = require('child_process');
const util = require('util');
const fsp = require('fs').promises;
const fss = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);

// ============================================================
// 结果包装器 (openclaw pattern)
// ============================================================
function jsonResult(data) {
  return [{ type: 'text', text: JSON.stringify(data) }];
}

function textResult(text) {
  return [{ type: 'text', text: text }];
}

function errorResult(message, details) {
  return [{ type: 'text', text: JSON.stringify({ success: false, error: message, ...(details || {}) }) }];
}

// ============================================================
// 工具上下文 (OpenClawPluginToolContext 简化版)
// ============================================================
function createToolContext(options) {
  return {
    config: options.config || {},
    workspaceDir: options.workspaceDir || '',
    agentDir: options.agentDir || '',
    sessionKey: options.sessionKey || '',
    sandboxed: options.sandboxed || false,
    platform: process.platform,
    env: { ...process.env }
  };
}

// ============================================================
// 内置工具定义 (AnyAgentTool 格式)
// ============================================================
function buildBuiltinTools(ctx) {
  const wsDir = ctx.workspaceDir;

  return [
    // --- 文件读写 ---
    {
      name: 'read_file',
      label: 'Read File',
      description: '读取本地文件内容。参数: path (文件路径, 相对工作区或绝对路径)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      },
      execute: async (_toolCallId, args) => {
        const filePath = resolvePath(args.path, wsDir);
        try {
          const content = await fsp.readFile(filePath, 'utf-8');
          return jsonResult({ success: true, content, path: filePath, size: content.length });
        } catch (e) {
          return jsonResult({ success: false, error: e.message, path: filePath });
        }
      }
    },
    {
      name: 'write_file',
      label: 'Write File',
      description: '写入内容到本地文件 (覆盖模式)。参数: path, content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '写入内容' }
        },
        required: ['path', 'content']
      },
      execute: async (_toolCallId, args) => {
        const filePath = resolvePath(args.path, wsDir);
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, args.content, 'utf-8');
        return jsonResult({ success: true, path: filePath, size: args.content.length });
      }
    },
    {
      name: 'append_file',
      label: 'Append File',
      description: '追加内容到文件末尾。参数: path, content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '追加内容' }
        },
        required: ['path', 'content']
      },
      execute: async (_toolCallId, args) => {
        const filePath = resolvePath(args.path, wsDir);
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.appendFile(filePath, args.content, 'utf-8');
        return jsonResult({ success: true, path: filePath });
      }
    },

    // --- 目录操作 ---
    {
      name: 'list_dir',
      label: 'List Directory',
      description: '列出目录下的文件和子目录。参数: path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径' }
        },
        required: ['path']
      },
      execute: async (_toolCallId, args) => {
        const dirPath = resolvePath(args.path || '.', wsDir);
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          let size = 0;
          try { if (entry.isFile()) { const stat = await fsp.stat(fullPath); size = stat.size; } } catch (e) {}
          return { name: entry.name, isDirectory: entry.isDirectory(), size };
        }));
        files.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return jsonResult({ success: true, files, count: files.length, path: dirPath });
      }
    },

    // --- 命令执行 ---
    {
      name: 'exec_command',
      label: 'Execute Command',
      description: '在终端中执行命令并返回输出。参数: command, cwd (工作目录), timeout (毫秒,默认30s)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell命令' },
          cwd: { type: 'string', description: '工作目录' },
          timeout: { type: 'number', description: '超时毫秒数' }
        },
        required: ['command']
      },
      execute: async (_toolCallId, args) => {
        const danger = detectDangerousCommand(args.command);
        if (danger) {
          return jsonResult({ success: true, blocked: true, reason: danger.reason, command: args.command, stdout: '', stderr: '' });
        }
        const workDir = args.cwd ? resolvePath(args.cwd, wsDir) : wsDir;
        try {
          const result = await execPromise(args.command, {
            timeout: args.timeout || 30000,
            maxBuffer: 2 * 1024 * 1024,
            cwd: workDir, shell: true,
            windowsHide: true
          });
          return jsonResult({
            success: true,
            stdout: (result.stdout || '').substring(0, 50000),
            stderr: (result.stderr || '').substring(0, 10000)
          });
        } catch (error) {
          return jsonResult({
            success: true,
            stdout: (error.stdout || '').substring(0, 50000),
            stderr: (error.stderr || error.message || '').substring(0, 10000),
            exitCode: error.code || -1
          });
        }
      }
    }
  ];
}

// ============================================================
// 工具注册器
// ============================================================
class ToolRegistry {
  constructor(workspaceDir) {
    this._tools = new Map();
    this._beforeHooks = [];
    this._afterHooks = [];
    this._workspaceDir = workspaceDir;
    this._pluginTools = new Map();
    this._registerBuiltins();
  }

  // --- 注册 ---
  _registerBuiltins() {
    const ctx = createToolContext({ workspaceDir: this._workspaceDir });
    const tools = buildBuiltinTools(ctx);
    for (const tool of tools) {
      this._tools.set(tool.name, tool);
    }
  }

  registerTool(factory, opts) {
    if (typeof factory === 'function') {
      const ctx = createToolContext({ workspaceDir: this._workspaceDir });
      const result = factory(ctx);
      const tools = Array.isArray(result) ? result : (result ? [result] : []);
      for (const tool of tools) {
        const name = (opts && opts.name) || tool.name;
        this._tools.set(name, tool);
        if (opts && opts.pluginId) {
          this._pluginTools.set(name, { tool, pluginId: opts.pluginId, optional: opts.optional || false });
        }
      }
    } else if (factory && typeof factory.name === 'string') {
      this._tools.set(factory.name, factory);
    }
  }

  registerToolsFromPlugin(pluginId, tools) {
    for (const tool of tools) {
      this._tools.set(tool.name, tool);
      this._pluginTools.set(tool.name, { tool, pluginId, optional: false });
    }
  }

  // --- 钩子 ---
  addBeforeHook(hook) {
    this._beforeHooks.push(hook);
  }

  addAfterHook(hook) {
    this._afterHooks.push(hook);
  }

  // --- 查询 ---
  getTool(name) {
    return this._tools.get(name) || null;
  }

  listTools() {
    const tools = [];
    for (const [name, tool] of this._tools) {
      const pInfo = this._pluginTools.get(name);
      tools.push({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        pluginId: pInfo ? pInfo.pluginId : 'builtin',
        source: pInfo ? 'plugin' : 'builtin'
      });
    }
    return tools;
  }

  hasTool(name) {
    return this._tools.has(name);
  }

  // --- 执行管道 ---
  async executeTool(name, args, opts) {
    const tool = this._tools.get(name);
    if (!tool) {
      return errorResult(`未知工具: ${name}`);
    }

    const toolCallId = (opts && opts.toolCallId) || generateId();
    const toolContext = {
      toolName: name,
      toolCallId,
      runId: (opts && opts.runId) || '',
      sessionId: (opts && opts.sessionId) || ''
    };

    // Phase 1: before_hooks (审批/修改参数)
    let blockReason = null;
    let modifiedArgs = { ...args };
    for (const hook of this._beforeHooks) {
      try {
        var result = await hook({
          toolName: name,
          params: modifiedArgs,
          toolCallId,
          runId: toolContext.runId
        }, toolContext);
        if (result) {
          if (result.block) {
            blockReason = result.blockReason || '被策略拦截';
            break;
          }
          if (result.params) modifiedArgs = { ...modifiedArgs, ...result.params };
          if (result.requireApproval && opts && opts.mode === 'manual') {
            blockReason = '需要人工审批 (manual 模式)';
            break;
          }
        }
      } catch (e) {
        return errorResult('before_hook 异常: ' + e.message);
      }
    }

    if (blockReason) {
      return jsonResult({ success: true, blocked: true, reason: blockReason, tool: name });
    }

    // Phase 2: execute
    let execResult;
    try {
      execResult = await tool.execute(toolCallId, modifiedArgs);
    } catch (e) {
      execResult = errorResult('工具执行异常: ' + e.message);
    }

    // Phase 3: after_hooks (后处理)
    for (const hook of this._afterHooks) {
      try {
        await hook({
          toolName: name,
          params: modifiedArgs,
          toolCallId,
          runId: toolContext.runId,
          result: execResult
        }, toolContext);
      } catch (e) {
        // after_hooks 不应影响结果
      }
    }

    return execResult;
  }
}

// ============================================================
// 危险命令检测 (保留现有逻辑)
// ============================================================
const DANGER_PATTERNS = [
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-rf)\s+\//i, reason: '递归删除根目录' },
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-rf)\s+~(\/|\\)/i, reason: '递归删除用户主目录' },
  { pattern: /\bdel\s+\/[fq]\s+\/[s]\s+C:\\/i, reason: '批量删除系统盘文件' },
  { pattern: /\b(format|diskpart)\b/i, reason: '磁盘格式化/分区操作' },
  { pattern: /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i, reason: '系统关机/重启' },
  { pattern: /\bdd\s+if=/i, reason: '磁盘镜像写入' },
  { pattern: /\bmkfs\b/i, reason: '文件系统格式化' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//i, reason: '批量开放根目录权限' },
  { pattern: /\bcurl.*\|\s*(sh|bash|cmd)\b/i, reason: '远程代码执行(curl piped to shell)' },
  { pattern: /\bwget.*-O-.*\|\s*(sh|bash)\b/i, reason: '远程代码执行(wget piped to shell)' },
  { pattern: /\biex\s/i, reason: 'PowerShell远程代码执行' },
  { pattern: /\bInvoke-Expression\b/i, reason: 'PowerShell远程代码执行' },
  { pattern: /\beval\s*\(/i, reason: 'JS/Python eval执行' },
  { pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;:/, reason: 'Fork炸弹' },
  { pattern: /\b>\/dev\/sda\b/i, reason: '覆盖磁盘设备' }
];

function detectDangerousCommand(command) {
  for (var i = 0; i < DANGER_PATTERNS.length; i++) {
    if (DANGER_PATTERNS[i].pattern.test(command)) {
      return { blocked: true, reason: DANGER_PATTERNS[i].reason, command };
    }
  }
  return null;
}

// ============================================================
// 辅助
// ============================================================
function resolvePath(filePath, workspaceDir) {
  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  var normalized = filePath.replace(/^[/\\]*workspace[/\\]/i, '');
  return path.join(workspaceDir, normalized);
}

function generateId() {
  return 'tc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

module.exports = { ToolRegistry, jsonResult, textResult, errorResult, createToolContext, resolvePath, detectDangerousCommand };