// ============================================================
// DeepSeek Tool Agent v0.1.1 — 插件加载器
//
//   - 插件定义: { id, name, version, register(api) }
//   - 发现机制: 扫描 bundled/global/workspace 目录
//   - 注册 API: registerTool, registerHook 等
//   - 版本检查: semver compatible
//   - 来源追踪: PluginOrigin
// ============================================================

const fsp = require('fs').promises;
const fss = require('fs');
const path = require('path');
var sandboxProxies = require('./sandbox-proxies');

// ============================================================
// 插件沙箱 — 限制插件可访问的 Node.js 模块
// 防止恶意插件访问文件系统、网络、进程等敏厳能力
// ============================================================
var ALLOWED_PLUGIN_MODULES = [
  'path', 'url', 'querystring', 'crypto', 'util',
  'events', 'stream', 'buffer', 'string_decoder',
  'zlib', 'assert', 'math', 'json'
];

// 完全禁止的模块（无安全代理方式）
var BLOCKED_PLUGIN_MODULES = [
  'cluster', 'dgram', 'dns', 'fs/promises',
  'net', 'os', 'readline', 'repl', 'tls',
  'v8', 'vm', 'worker_threads'
];

// 需要代理的模块 — 提供受限版本而非完全禁止
var PROXIED_MODULES = {
  'fs': function(workspaceDir, pluginId) {
    return sandboxProxies.createSandboxedFs(workspaceDir, pluginId);
  },
  'http': function(workspaceDir, pluginId) {
    return sandboxProxies.createSandboxedHttp(pluginId, require('http'));
  },
  'https': function(workspaceDir, pluginId) {
    return sandboxProxies.createSandboxedHttp(pluginId, require('https'));
  },
  'child_process': function(workspaceDir, pluginId) {
    return sandboxProxies.createSandboxedChildProcess(pluginId);
  }
};

function createPluginSandbox(pluginDir, pluginId, workspaceDir) {
  workspaceDir = workspaceDir || pluginDir;

  var sandboxRequire = function(moduleName) {
    // 解析相对路径 — 允许插件内部引用
    if (moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName.startsWith('/')) {
      // 只允许引用插件目录内的文件
      var resolved = path.resolve(pluginDir, moduleName);
      if (!resolved.startsWith(path.resolve(pluginDir) + path.sep) && resolved !== path.resolve(pluginDir)) {
        throw new Error('插件 ' + pluginId + ' 尝试引用目录外文件: ' + moduleName);
      }
      return require(resolved);
    }

    // 检查是否需要代理
    var baseModule = moduleName.split('/')[0];
    if (PROXIED_MODULES[baseModule]) {
      return PROXIED_MODULES[baseModule](workspaceDir, pluginId);
    }

    // 检查模块黑名单
    if (BLOCKED_PLUGIN_MODULES.indexOf(baseModule) >= 0) {
      throw new Error('插件 ' + pluginId + ' 无权访问模块: ' + moduleName + ' (安全限制)');
    }

    // 白名单内的核心模块直接放行
    if (ALLOWED_PLUGIN_MODULES.indexOf(baseModule) >= 0) {
      return require(moduleName);
    }

    // 第三方模块 — 允许（npm 包在 node_modules 中），但记录警告
    console.warn('[PluginSandbox] 插件 ' + pluginId + ' 引用第三方模块: ' + moduleName);
    return require(moduleName);
  };

  return sandboxRequire;
}

// 使用 vm 模块在沙箱中加载插件代码，注入自定义 require
function sandboxModule(entryPath, sandboxRequire) {
  var vm = require('vm');
  var fssLoad = require('fs');
  var content = fssLoad.readFileSync(entryPath, 'utf-8');
  var moduleExports = {};
  var moduleObj = { exports: moduleExports };

  // 模拟 Node.js 模块包装: (function(exports, require, module, __filename, __dirname) { ... })
  var wrappedCode = '(function(exports, require, module, __filename, __dirname) {\n' + content + '\n});';

  var script = new vm.Script(wrappedCode, { filename: entryPath });
  var fn = script.runInNewContext({
    console: console,
    setTimeout: setTimeout,
    setInterval: setInterval,
    clearTimeout: clearTimeout,
    clearInterval: clearInterval,
    JSON: JSON,
    Math: Math,
    Date: Date,
    RegExp: RegExp,
    Error: Error,
    TypeError: TypeError,
    RangeError: RangeError,
    SyntaxError: SyntaxError,
    URIError: URIError,
    EvalError: EvalError,
    Promise: Promise,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Map: Map,
    Set: Set,
    Symbol: Symbol,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    isFinite: isFinite,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    encodeURI: encodeURI,
    decodeURI: decodeURI,
    Buffer: Buffer,
    ArrayBuffer: ArrayBuffer,
    Uint8Array: Uint8Array
  });

  // 调用包装函数，注入沙箱 require
  fn(moduleExports, sandboxRequire, moduleObj, entryPath, path.dirname(entryPath));

  return moduleObj.exports;
}

// ============================================================
// 简易 semver 检查 (不引入外部依赖)
// ============================================================
function isVersionCompatible(pluginVersion, requiredRange) {
  if (!requiredRange || requiredRange === '*') return true;
  if (!pluginVersion) return false;

  const plugin = parseSemver(pluginVersion);

  // 处理 ^x.y.z 格式
  if (requiredRange.startsWith('^')) {
    const req = parseSemver(requiredRange.slice(1));
    if (!plugin || !req) return false;
    if (req.major === 0) return plugin.major === req.major && plugin.minor >= req.minor;
    return plugin.major === req.major && (plugin.minor > req.minor || (plugin.minor === req.minor && plugin.patch >= req.patch));
  }

  // 处理 >=x.y.z 格式
  if (requiredRange.startsWith('>=')) {
    const req = parseSemver(requiredRange.slice(2));
    if (!plugin || !req) return false;
    return compareSemver(plugin, req) >= 0;
  }

  // 精确版本
  const req = parseSemver(requiredRange);
  if (!plugin || !req) return false;
  return plugin.major === req.major && plugin.minor === req.minor && plugin.patch === req.patch;
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]) };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// ============================================================
// 插件定义
// ============================================================
// PluginDefinition = {
//   id?: string,
//   name?: string,
//   description?: string,
//   version?: string,
//   kind?: "memory" | "context-engine" | "tool",
//   configSchema?: { ... },
//   register?: (api: PluginApi) => void | Promise<void>,
//   activate?: (api: PluginApi) => void | Promise<void>
// }

// ============================================================
// 插件清单格式 (.plugin.json)
// ============================================================
// {
//   "id": "my-plugin",
//   "name": "My Plugin",
//   "version": "1.0.0",
//   "description": "Plugin description",
//   "entry": "index.js",
//   "requiredEngineVersion": "^2.3.0",
//   "tools": ["tool1", "tool2"],
//   "kind": "tool"
// }

class PluginRegistry {
  constructor(toolRegistry, options) {
    this._toolRegistry = toolRegistry;
    this._plugins = new Map();
    this._workspaceDir = options.workspaceDir || '';
    this._engineVersion = options.engineVersion || '2.3.0';
    this._scanDirs = options.scanDirs || [];
    this._diagnostics = [];
  }

  get plugins() {
    return Array.from(this._plugins.values());
  }

  get diagnosticMessages() {
    return this._diagnostics;
  }

  async discover() {
    this._diagnostics = [];
    const discovered = [];

    // 1. bundled plugins (<server>/builtin-plugins/)
    const bundledDir = path.join(__dirname, 'builtin-plugins');
    const bundledPlugins = await this._scanDirectory(bundledDir, 'bundled');
    discovered.push(...bundledPlugins);

    // 2. workspace plugins (<workspace>/plugins/)
    const wsPluginsDir = path.join(this._workspaceDir, 'plugins');
    const wsPlugins = await this._scanDirectory(wsPluginsDir, 'workspace');
    discovered.push(...wsPlugins);

    // 3. additional scan dirs
    for (const dir of this._scanDirs) {
      const plugins = await this._scanDirectory(dir, 'config');
      discovered.push(...plugins);
    }

    return discovered;
  }

  async load(pluginDef) {
    const id = pluginDef.id || pluginDef.name || 'unknown';

    // 版本兼容性检查
    if (pluginDef.manifest && pluginDef.manifest.requiredEngineVersion) {
      if (!isVersionCompatible(this._engineVersion, pluginDef.manifest.requiredEngineVersion)) {
        this._diagnostics.push({
          level: 'warn',
          message: `插件 ${id} 要求引擎版本 ${pluginDef.manifest.requiredEngineVersion}, 当前版本 ${this._engineVersion}`,
          pluginId: id
        });
      }
    }

    // 检查重复
    if (this._plugins.has(id)) {
      this._diagnostics.push({
        level: 'warn',
        message: `插件 ${id} 已加载, 跳过重复加载`,
        pluginId: id
      });
      return false;
    }

    try {
      // 构建插件 API
      const api = this._buildPluginApi(id, pluginDef);

      // 调用 register()
      if (typeof pluginDef.register === 'function') {
        await pluginDef.register(api);
      } else if (typeof pluginDef.definition === 'function') {
        await pluginDef.definition(api);
      } else if (typeof pluginDef === 'function') {
        await pluginDef(api);
      }

      // 调用 activate() (如果存在)
      if (typeof pluginDef.activate === 'function') {
        await pluginDef.activate(api);
      }

      this._plugins.set(id, {
        id,
        name: pluginDef.name || id,
        version: pluginDef.version || '0.0.0',
        description: pluginDef.description || '',
        kind: pluginDef.kind || 'tool',
        origin: pluginDef.origin || 'config',
        source: pluginDef.source || '',
        manifest: pluginDef.manifest || null,
        loaded: true
      });

      return true;
    } catch (e) {
      this._diagnostics.push({
        level: 'error',
        message: `加载插件 ${id} 失败: ${e.message}`,
        pluginId: id
      });
      return false;
    }
  }

  async unload(pluginId) {
    if (!this._plugins.has(pluginId)) return false;
    // 清理插件注册的工具
    if (this._toolRegistry && typeof this._toolRegistry.unregisterToolsByPlugin === 'function') {
      const removed = this._toolRegistry.unregisterToolsByPlugin(pluginId);
      if (removed.length > 0) {
        console.log('[PluginRegistry] 卸载插件 ' + pluginId + '，移除 ' + removed.length + ' 个工具: ' + removed.join(', '));
      }
    }
    this._plugins.delete(pluginId);
    return true;
  }

  getPlugin(pluginId) {
    return this._plugins.get(pluginId) || null;
  }

  // --- 内部 ---
  _buildPluginApi(pluginId, pluginDef) {
    const self = this;
    return {
      id: pluginId,
      name: pluginDef.name || pluginId,
      version: pluginDef.version,
      description: pluginDef.description,
      source: pluginDef.source || '',
      rootDir: pluginDef.rootDir || '',
      config: pluginDef.config || {},
      pluginConfig: pluginDef.pluginConfig || {},
      logger: {
        info: (msg) => console.log(`[plugin:${pluginId}] ${msg}`),
        warn: (msg) => console.warn(`[plugin:${pluginId}] ${msg}`),
        error: (msg) => console.error(`[plugin:${pluginId}] ${msg}`)
      },

      registerTool: (factory, opts) => {
        if (self._toolRegistry) {
          self._toolRegistry.registerTool(factory, { ...(opts || {}), pluginId });
        }
      },

      registerHook: (event, handler, opts) => {
        if (self._toolRegistry) {
          if (event === 'before_tool_call' || (Array.isArray(event) && event.includes('before_tool_call'))) {
            self._toolRegistry.addBeforeHook(handler);
          }
          if (event === 'after_tool_call' || (Array.isArray(event) && event.includes('after_tool_call'))) {
            self._toolRegistry.addAfterHook(handler);
          }
        }
      },

      resolvePath: (input) => {
        return path.resolve(pluginDef.rootDir || self._workspaceDir, input);
      }
    };
  }

  async _scanDirectory(dir, origin) {
    const discovered = [];
    try {
      await fsp.access(dir);
    } catch (e) {
      return discovered;
    }

    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginDir = path.join(dir, entry.name);

        // 1. 先尝试 .plugin.json 清单
        const manifestPath = path.join(pluginDir, 'plugin.json');
        try {
          await fsp.access(manifestPath);
          const manifestRaw = await fsp.readFile(manifestPath, 'utf-8');
          const manifest = JSON.parse(manifestRaw);
          const entryFile = manifest.entry || 'index.js';
          const entryPath = path.join(pluginDir, entryFile);

          // 验证 entry 路径，防止路径穿越
          const realEntryDir = path.resolve(pluginDir);
          const realEntryPath = path.resolve(entryPath);
          if (!realEntryPath.startsWith(realEntryDir + path.sep) && realEntryPath !== realEntryDir) {
            this._diagnostics.push({ level: 'error', pluginId: entry.name, message: '插件入口路径逃逸: ' + entryFile });
            continue;
          }

          try {
            await fsp.access(entryPath);
            // 使用沙箱 require 加载插件，限制其可访问的模块
            var sandbox = createPluginSandbox(pluginDir, manifest.id || entry.name, this._workspaceDir);
            var pluginModule = sandboxModule(entryPath, sandbox);
            // 如果模块导出的是函数, 包裹为 { definition: fn }
            const raw = typeof pluginModule === 'function' ? { definition: pluginModule } :
              (typeof pluginModule.default === 'function' ? { definition: pluginModule.default } : (pluginModule.default || pluginModule));
            const pluginDef = { ...raw };

            discovered.push({
                ...pluginDef,
                id: pluginDef.id || manifest.id || entry.name,
              name: pluginDef.name || manifest.name || entry.name,
              version: pluginDef.version || manifest.version || '0.0.0',
              description: pluginDef.description || manifest.description || '',
              kind: pluginDef.kind || manifest.kind || 'tool',
              manifest,
              origin,
              source: pluginDir,
              rootDir: pluginDir
            });
            continue;
          } catch (e) {
            this._diagnostics.push({
              level: 'warn',
              message: `插件 ${entry.name} 入口文件缺失: ${entryFile}`,
              pluginId: entry.name
            });
          }
        } catch (e) {
          // 无 manifest, 尝试直接加载
        }

        // 2. 尝试直接加载 index.js (无 manifest)
        const indexPath = path.join(pluginDir, 'index.js');
        try {
          await fsp.access(indexPath);
          // 使用沙箱 require 加载插件，限制其可访问的模块
          var sandbox2 = createPluginSandbox(pluginDir, entry.name, this._workspaceDir);
          const pluginModule = sandboxModule(indexPath, sandbox2);
          const pluginDef = typeof pluginModule === 'function' ? { register: pluginModule, definition: pluginModule } :
            (pluginModule.default ? { ...pluginModule.default, definition: pluginModule.default.register || pluginModule.default } : pluginModule);

          discovered.push({
            ...pluginDef,
            id: pluginDef.id || entry.name,
            name: pluginDef.name || entry.name,
            version: pluginDef.version || '0.0.0',
            description: pluginDef.description || '',
            kind: pluginDef.kind || 'tool',
            manifast: null,
            origin,
            source: pluginDir,
            rootDir: pluginDir
          });
        } catch (e) {
          // 跳过
        }
      }
    } catch (e) {
      this._diagnostics.push({
        level: 'error',
        message: `扫描插件目录失败: ${dir} - ${e.message}`
      });
    }

    return discovered;
  }
}

module.exports = { PluginRegistry, isVersionCompatible, parseSemver, createPluginSandbox, sandboxModule };