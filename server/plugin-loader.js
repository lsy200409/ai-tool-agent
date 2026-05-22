// ============================================================
// DeepSeek Tool Agent v2.3 — 插件加载器 (openclaw 兼容)
//
// 核心模式来自 openclaw-zero-token-main:
//   - 插件定义: OpenClawPluginDefinition { id, name, version, register(api) }
//   - 发现机制: 扫描 bundled/global/workspace 目录
//   - 注册 API: registerTool, registerHook 等
//   - 版本检查: semver compatible
//   - 来源追踪: PluginOrigin
// ============================================================

const fsp = require('fs').promises;
const fss = require('fs');
const path = require('path');

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
// 插件定义 (openclaw 格式)
// ============================================================
// OpenClawPluginDefinition = {
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

          try {
            await fsp.access(entryPath);
            const pluginModule = require(entryPath);
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
          const pluginModule = require(indexPath);
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

module.exports = { PluginRegistry, isVersionCompatible, parseSemver };