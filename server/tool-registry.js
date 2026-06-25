// ============================================================
// DeepSeek Tool Agent v0.1.1 — 工具注册器
//
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
const crossPlatform = require('./cross-platform');
const { sanitizeToolArgs } = require('./sanitization');
const ssrfGuard = require('./ssrf-guard');
const errors = require('./errors');
const toolFactory = require('./tool-factory');

const execPromise = util.promisify(exec);

// ============================================================
// 结果包装器
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
// 工具上下文
// ============================================================
function createToolContext(options) {
  return {
    config: options.config || {},
    workspaceDir: options.workspaceDir || '',
    agentDir: options.agentDir || '',
    sessionKey: options.sessionKey || '',
    sandboxed: options.sandboxed || false,
    globalPermissions: options.globalPermissions || false,
    _confirmed: options._confirmed || false,
    _fromHttp: options._fromHttp || false,
    platform: process.platform,
    env: { ...process.env }
  };
}

// ============================================================
// 命令输出乱码清洗
// ============================================================

/**
 * 清洗命令输出中的乱码字符
 * - 移除 UTF-16 LE 被误读产生的 NULL 字节和控制字符
 * - 移除不可打印字符（保留常用标点和中文）
 * @param {string} text - 原始输出文本
 * @param {boolean} isStderr - 是否为 stderr（stderr 清洗更激进）
 * @returns {string} 清洗后的文本
 */
function sanitizeCommandOutput(text, isStderr) {
  if (!text || typeof text !== 'string') return '';

  // 1. 检测并处理 UTF-16 LE 被误读为 UTF-8 的情况
  //    特征：大量 NULL 字节（\u0000）夹杂在 ASCII 字符之间
  if (text.indexOf('\0') >= 0 || text.includes(String.fromCharCode(0))) {
    text = text.replace(/\u0000/g, '');
    // 同时清除 UTF-16 LE 被误读后的 NULL 字节间隔
    text = text.replace(/\0/g, '');
  }

  // 2. 移除其他控制字符（保留换行、回车、制表符）
  text = text.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

  // 3. 对于 stderr，额外清洗 WSL 启动信息等噪音
  if (isStderr) {
    var lines = text.split('\n');
    var cleaned = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      // 跳过空行
      if (!line) continue;
      // 跳过 WSL 启动信息（包含乱码特征或特定关键词）
      if (line.indexOf('hKm0R') >= 0 ||
          line.match(/^wsl:/i) ||
          line.match(/^\s*w\u0000s\u0000l\u0000:/) ||
          (line.indexOf('WSL') >= 0 && line.length < 80) ||
          line.match(/^[\x00-\x1F\uFFFD]+$/)) {
        continue;
      }
      cleaned.push(lines[i]);
    }
    text = cleaned.join('\n');
  }

  return text.trim();
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

        // 路径安全检查 — isForbiddenPath 抛出 SecurityBlockedError，由 executeTool 统一捕获
        isForbiddenPath(filePath);

        // 读操作：允许访问工作区外路径，仅保护核心系统目录（FORBIDDEN_PATHS + NEVER_ALLOW_PATHS 已在上方检查）
        // 不再做 isPathWithinWorkspace / isOutsideWorkspace 限制

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

        // 路径安全检查 — isForbiddenPath 抛出 SecurityBlockedError，由 executeTool 统一捕获
        isForbiddenPath(filePath);

        // 敏感路径仍需确认（可被 globalPermissions / _confirmed 绕过）
        const sensitive = isSensitivePath(filePath);
        if (sensitive && !ctx.globalPermissions && !ctx._confirmed) {
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: '写入敏感目录需要确认: ' + sensitive.reason,
            path: filePath,
            explanation: 'AI 应说明需要写入此文件的原因，由用户确认后执行'
          });
        }

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

        // 路径安全检查 — isForbiddenPath 抛出 SecurityBlockedError，由 executeTool 统一捕获
        isForbiddenPath(filePath);

        // 敏感路径仍需确认（可被 globalPermissions / _confirmed 绕过）
        const sensitive = isSensitivePath(filePath);
        if (sensitive && !ctx.globalPermissions && !ctx._confirmed) {
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: '写入敏感目录需要确认: ' + sensitive.reason,
            path: filePath,
            explanation: 'AI 应说明需要追加此文件的原因，由用户确认后执行'
          });
        }

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

        // 路径安全检查 — isForbiddenPath 抛出 SecurityBlockedError，由 executeTool 统一捕获
        isForbiddenPath(dirPath);

        // 读操作：允许访问工作区外路径，仅保护核心系统目录（FORBIDDEN_PATHS + NEVER_ALLOW_PATHS 已在上方检查）
        // 不再做 isPathWithinWorkspace / isOutsideWorkspace 限制

        try {
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
        } catch (e) {
          return jsonResult({ success: false, error: e.message, path: dirPath });
        }
      }
    },

    // --- 命令执行 ---
    {
      name: 'exec_command',
      label: 'Execute Command',
      description: '在终端中执行命令并返回输出。参数: command, cwd, timeout, wsl (是否在WSL中执行)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell命令' },
          cwd: { type: 'string', description: '工作目录' },
          timeout: { type: 'number', description: '超时毫秒数' },
          wsl: { type: 'boolean', description: '是否在WSL2中执行(仅Windows)' },
          distro: { type: 'string', description: 'WSL发行版名称(默认Ubuntu)' }
        },
        required: ['command']
      },
      execute: async (_toolCallId, args) => {
        if (!args.command) return jsonResult({ success: false, error: '缺少 command 参数' });

        // 1. 危险命令检测（最高优先级，NEVER_ALLOW — 任何权限都无法绕过）
        // detectDangerousCommand 抛出 SecurityBlockedError，由 executeTool 统一捕获
        detectDangerousCommand(args.command);

        // 2. 命令安全级别分类
        const safetyLevel = classifyCommand(args.command);

        // 3. 工作目录检查（NEVER_ALLOW — 不可绕过）
        // isForbiddenPath 抛出 SecurityBlockedError，由 executeTool 统一捕获
        const workDir = args.cwd ? resolvePath(args.cwd, wsDir) : wsDir;
        isForbiddenPath(workDir);

        // 3.5 SSRF 防护 — 如果命令包含 curl/wget，验证目标 URL
        if (args.command.match(/\b(curl|wget)\b/i)) {
          var urlMatch = args.command.match(/https?:\/\/[^\s'"]+/);
          if (urlMatch) {
            var ssrfResult = ssrfGuard.validateUrl(urlMatch[0]);
            if (!ssrfResult.safe) {
              throw new errors.SecurityBlockedError('exec_command', 'SSRF 防护: ' + ssrfResult.reason, 'never_allow');
            }
          }
        }

        // 4. 敏感命令需要二次确认
        if (safetyLevel === 'sensitive' && !ctx.globalPermissions && !ctx._confirmed) {
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: '敏感命令需要确认',
            command: args.command,
            safetyLevel: safetyLevel,
            explanation: '此命令可能修改文件或系统状态，AI 应解释命令作用后由用户确认执行',
            stdout: '',
            stderr: ''
          });
        }

        // 4.5 自动批准命令 — 直接执行，但记录日志
        if (safetyLevel === 'auto_approve') {
          console.log('[auto_approve] 命令自动批准执行:', args.command);
        }

        // 5. 执行命令
        try {
          let execCommand = args.command;
          let execCwd = workDir;
          let execOptions = {
            timeout: args.timeout || 30000,
            maxBuffer: 2 * 1024 * 1024,
            cwd: workDir, shell: true,
            windowsHide: true,
            encoding: 'utf-8',
            // Windows 下显式指定 cmd.exe 路径，避免 ENOENT 间歇性错误
            ...(process.platform === 'win32' ? { shell: process.env.ComSpec || 'C:\\WINDOWS\\system32\\cmd.exe' } : {})
          };

          // WSL 模式: 在 WSL2 中执行命令
          const useWsl = args.wsl || detectWslCommand(args.command);
          if (useWsl && crossPlatform.PLATFORM.isWindows && crossPlatform.WSL.isAvailable()) {
            execCommand = crossPlatform.WSL.buildWslCommand(args.command, {
              cwd: workDir,
              distro: args.distro
            });
            // WSL 命令在 Windows 侧执行，不需要 cwd
            delete execOptions.cwd;
          }

          const result = await execPromise(execCommand, execOptions);
          var cleanStdout = sanitizeCommandOutput(result.stdout || '', false);
          var cleanStderr = sanitizeCommandOutput(result.stderr || '', true);
          return jsonResult({
            success: true,
            stdout: cleanStdout.substring(0, 50000),
            stderr: cleanStderr.substring(0, 10000),
            safetyLevel: safetyLevel,
            wsl: useWsl
          });
        } catch (error) {
          var errStdout = sanitizeCommandOutput(error.stdout || '', false);
          var errStderr = sanitizeCommandOutput(error.stderr || error.message || '', true);
          return jsonResult({
            success: true,
            stdout: errStdout.substring(0, 50000),
            stderr: errStderr.substring(0, 10000),
            exitCode: error.code || -1,
            safetyLevel: safetyLevel
          });
        }
      }
    },
    {
      name: 'task_plan',
      label: 'Task Plan',
      description: '创建或更新任务计划。在开始复杂任务（3步以上）时调用此工具制定计划，每完成一步后更新状态。这是你的外部记忆，避免丢失目标。参数: steps (数组，每项含 description 和 status)',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: '任务步骤列表',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: '步骤描述' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'], description: '步骤状态' }
              }
            }
          }
        },
        required: ['steps']
      },
      execute: async (_toolCallId, args) => {
        const planPath = path.join(wsDir, 'sessions', 'current-plan.json');
        await fsp.mkdir(path.dirname(planPath), { recursive: true });
        const plan = {
          steps: args.steps || [],
          updatedAt: new Date().toISOString()
        };
        await fsp.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
        return jsonResult({ success: true, planPath, stepCount: plan.steps.length });
      }
    },
    {
      name: 'get_tool_history',
      label: 'Get Tool History',
      description: '获取当前会话的工具调用历史。当上下文被截断时，用此工具找回之前的工具调用结果。参数: iteration (可选，指定获取第几轮的结果，不传则返回全部摘要)',
      parameters: {
        type: 'object',
        properties: {
          iteration: { type: 'number', description: '指定获取第几轮的工具结果（从1开始）。不传则返回所有轮次的摘要' }
        }
      },
      execute: async (_toolCallId, args) => {
        const histPath = path.join(wsDir, 'sessions', 'tool-history.json');
        try {
          const raw = await fsp.readFile(histPath, 'utf-8');
          const history = JSON.parse(raw);
          if (args.iteration) {
            const entry = history.entries.find(e => e.iteration === args.iteration);
            return entry ? jsonResult({ success: true, entry }) : jsonResult({ success: false, error: '未找到第' + args.iteration + '轮的记录' });
          }
          // 返回摘要
          const summary = history.entries.map(e => ({
            iteration: e.iteration,
            tools: e.results.map(r => ({ tool: r.tool, success: r.success }))
          }));
          return jsonResult({ success: true, summary });
        } catch (e) {
          return jsonResult({ success: false, error: '暂无工具调用历史' });
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
    this._builtTools = new Map(); // buildTool 构建的验证工具
    this._beforeHooks = [];
    this._afterHooks = [];
    this._workspaceDir = workspaceDir;
    this._pluginTools = new Map();
    this._globalPermissions = false;
    this._registerBuiltins();
  }

  // --- 注册 ---
  _registerBuiltins() {
    const ctx = createToolContext({ workspaceDir: this._workspaceDir, globalPermissions: this._globalPermissions });
    const tools = buildBuiltinTools(ctx);
    for (const tool of tools) {
      this._tools.set(tool.name, tool);
      // 使用 buildTool 构建验证版本
      try {
        const builtTool = toolFactory.buildTool({
          name: tool.name,
          description: tool.description || tool.label,
          isReadOnly: tool.isReadOnly || false,
          isConcurrencySafe: tool.isConcurrencySafe || false,
          isDestructive: tool.isDestructive || false,
          validateInput: tool.validateInput || undefined,
          checkPermissions: tool.checkPermissions || undefined,
          execute: tool.execute ? function(args, execCtx) { return tool.execute('', args); } : undefined
        });
        this._builtTools.set(tool.name, builtTool);
      } catch (e) {
        console.warn('[ToolRegistry] buildTool 构建失败:', tool.name, e.message);
      }
    }
  }

  setGlobalPermissions(enabled) {
    this._globalPermissions = !!enabled;
    // 保存插件工具条目（含 tool 对象和 pluginId）
    var pluginEntries = new Map();
    for (var [name, entry] of this._pluginTools) pluginEntries.set(name, entry);
    this._tools.clear();
    this._builtTools.clear();
    this._pluginTools.clear();
    this._registerBuiltins();
    // 重新注册插件工具（之前只保存了 pluginId 但未重新注册 tool 对象）
    for (var [name, entry] of pluginEntries) {
      this._tools.set(name, entry.tool);
      this._pluginTools.set(name, entry);
    }
  }

  registerTool(factory, opts) {
    if (typeof factory === 'function') {
      const ctx = createToolContext({ workspaceDir: this._workspaceDir, globalPermissions: this._globalPermissions });
      const result = factory(ctx);
      const tools = Array.isArray(result) ? result : (result ? [result] : []);
      for (const tool of tools) {
        const name = (opts && opts.name) || tool.name;
        this._tools.set(name, tool);
        // 使用 buildTool 构建验证版本并存储
        try {
          const builtTool = toolFactory.buildTool({
            name: tool.name,
            description: tool.description || tool.label,
            isReadOnly: tool.isReadOnly || false,
            isConcurrencySafe: tool.isConcurrencySafe || false,
            isDestructive: tool.isDestructive || false,
            validateInput: tool.validateInput || undefined,
            checkPermissions: tool.checkPermissions || undefined,
            execute: tool.execute ? function(args, execCtx) { return tool.execute('', args); } : undefined
          });
          this._builtTools.set(name, builtTool);
        } catch (e) {
          // buildTool 构建失败不影响正常注册
          console.warn('[ToolRegistry] buildTool 构建失败:', name, e.message);
        }
        if (opts && opts.pluginId) {
          this._pluginTools.set(name, { tool, pluginId: opts.pluginId, optional: opts.optional || false });
        }
      }
    } else if (factory && typeof factory.name === 'string') {
      this._tools.set(factory.name, factory);
      // 使用 buildTool 构建验证版本
      try {
        const builtTool = toolFactory.buildTool({
          name: factory.name,
          description: factory.description || factory.label,
          isReadOnly: factory.isReadOnly || false,
          isConcurrencySafe: factory.isConcurrencySafe || false,
          isDestructive: factory.isDestructive || false,
          validateInput: factory.validateInput || undefined,
          checkPermissions: factory.checkPermissions || undefined,
          execute: factory.execute ? function(args, execCtx) { return factory.execute('', args); } : undefined
        });
        this._builtTools.set(factory.name, builtTool);
      } catch (e) {
        console.warn('[ToolRegistry] buildTool 构建失败:', factory.name, e.message);
      }
      // 记录 pluginId
      if (opts && opts.pluginId) {
        this._pluginTools.set(factory.name, { tool: factory, pluginId: opts.pluginId, optional: opts.optional || false });
      }
    }
  }

  registerToolsFromPlugin(pluginId, tools) {
    for (const tool of tools) {
      this._tools.set(tool.name, tool);
      this._pluginTools.set(tool.name, { tool, pluginId, optional: false });
    }
  }

  // --- 带确认标记执行（用于 /api/confirm 端点）---
  async executeToolConfirmed(name, args, opts) {
    // 用带 _confirmed 标记的 ctx 重建内置工具，确保闭包中的 ctx._confirmed 为 true
    const confirmedCtx = createToolContext({
      workspaceDir: this._workspaceDir,
      globalPermissions: this._globalPermissions,
      _confirmed: true
    });

    // 优先用 confirmedCtx 重建内置工具（解决闭包 ctx 问题）
    let tool = null;
    const rebuiltTools = buildBuiltinTools(confirmedCtx);
    tool = rebuiltTools.find(t => t.name === name) || null;

    // 如果内置工具中没找到，再从 _tools Map 查找（插件工具）
    if (!tool) {
      tool = this._tools.get(name) || null;
    }

    if (!tool) return errorResult(`未知工具: ${name}`);

    // 净化工具参数 — 移除危险 Unicode 字符，防御 ASCII Smuggling 攻击
    args = sanitizeToolArgs(args);

    const toolCallId = (opts && opts.toolCallId) || generateId();
    try {
      return await tool.execute(toolCallId, args);
    } catch (e) {
      // 使用错误分层体系格式化 — SecurityBlockedError/PermissionDeniedError 等携带上下文
      return jsonResult(errors.errorToToolResult(e));
    }
  }

  // --- 卸载插件工具 ---
  unregisterToolsByPlugin(pluginId) {
    const removed = [];
    for (const [name, info] of this._pluginTools) {
      if (info.pluginId === pluginId) {
        this._tools.delete(name);
        this._builtTools.delete(name);
        removed.push(name);
      }
    }
    for (const name of removed) {
      this._pluginTools.delete(name);
    }
    return removed;
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

    // 净化工具参数 — 移除危险 Unicode 字符，防御 ASCII Smuggling 攻击
    args = sanitizeToolArgs(args);

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

    // Phase 1.5: 两阶段验证（当 builtTool 存在时使用）
    const builtTool = this._builtTools.get(name);
    if (builtTool) {
      const ctx = createToolContext({
        workspaceDir: this._workspaceDir,
        globalPermissions: this._globalPermissions,
        _confirmed: opts && opts._confirmed,
        _fromHttp: opts && opts._fromHttp
      });
      try {
        const validationResult = await toolFactory.executeToolWithValidation(builtTool, modifiedArgs, ctx);
        // 验证/权限被拦截时直接返回
        if (validationResult.success === false && (validationResult.validationError || validationResult.permissionDenied || validationResult.needsConfirmation)) {
          return jsonResult(validationResult);
        }
      } catch (e) {
        // SecurityBlockedError 等错误 — 使用错误分层体系格式化
        return jsonResult(errors.errorToToolResult(e));
      }
    }

    // Phase 2: execute
    let execResult;
    try {
      execResult = await tool.execute(toolCallId, modifiedArgs);
    } catch (e) {
      // 使用错误分层体系格式化 — SecurityBlockedError/PermissionDeniedError 等携带上下文
      execResult = jsonResult(errors.errorToToolResult(e));
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
// 安全约束系统 — "deny 永远赢" 原则
//
// 规则层级（优先级从高到低）:
//   1. NEVER_ALLOW — 绝对禁止，任何权限模式都无法绕过
//   2. FORBIDDEN_PATHS — 系统关键目录，globalPermissions 也不可绕过
//   3. DANGER_PATTERNS — 危险命令，globalPermissions 也不可绕过
//   4. PROTECTED_PATHS — bypass 免疫路径，需确认但不可自动放行
//   5. SENSITIVE_PATHS / SENSITIVE_COMMANDS — 需二次确认
//   6. SAFE_COMMANDS — 可直接执行
// ============================================================

// 0. 绝对禁止路径 — NEVER_ALLOW，任何权限都无法绕过
// 包括: .git/ (git历史损坏), shell配置 (命令注入), SSH密钥 (身份冒用)
const NEVER_ALLOW_PATHS = [
  // Git 仓库元数据 — 损坏会导致 git 历史丢失
  '.git',
  '.git\\', '.git/',
  // Shell 配置文件 — 修改可导致命令注入
  '.bashrc', '.bash_profile', '.bash_logout', '.profile',
  '.zshrc', '.zprofile', '.zshenv',
  '.kshrc', '.cshrc', '.tcshrc',
  'config.fish',
  // Git 全局配置 — 身份冒用
  '.gitconfig', '.gitignore_global',
  // SSH 密钥 — 身份冒用/密钥泄露
  '.ssh',
  '.ssh\\', '.ssh/',
  // 凭据文件
  '.npmrc', '.pypirc', '.netrc', '.aws',
  '.env', '.env.local', '.env.production',
  // GPG 密钥
  '.gnupg', '.gpg',
  // 系统级配置
  'hosts', 'resolv.conf', 'fstab',
];

// 0b. 绝对禁止的命令模式 — NEVER_ALLOW，任何权限都无法绕过
const NEVER_ALLOW_COMMAND_PATTERNS = [
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-rf)\s+.*\.git/i, reason: '删除 .git 目录会导致 git 历史永久丢失' },
  { pattern: /\bdel\s+.*\.git/i, reason: '删除 .git 目录会导致 git 历史永久丢失' },
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
  { pattern: /\b>\/dev\/sda\b/i, reason: '覆盖磁盘设备' },
  // 新增: 写入 shell 配置文件
  { pattern: />\s*~\/\.bashrc/i, reason: '写入 .bashrc 可导致命令注入' },
  { pattern: />\s*~\/\.zshrc/i, reason: '写入 .zshrc 可导致命令注入' },
  { pattern: />\s*~\/\.profile/i, reason: '写入 .profile 可导致命令注入' },
  // 新增: SSH 密钥操作
  { pattern: /\bssh-keygen\b/i, reason: '生成 SSH 密钥可能覆盖现有密钥' },
  // 新增: 凭据窃取
  { pattern: /\bcat\s+.*\.ssh\/id_(rsa|ed25519|ecdsa)/i, reason: '读取 SSH 私钥' },
  { pattern: /\btype\s+.*\.ssh\/id_(rsa|ed25519|ecdsa)/i, reason: '读取 SSH 私钥' },
  // 新增: 读取敏感配置文件（降级为 sensitive，允许确认后读取）
  // .gitconfig 和 .npmrc 移至 SENSITIVE_COMMANDS，不再 NEVER_ALLOW
  // Windows 危险命令
  { pattern: /\bdel\s+\/[fsq]/i, reason: 'Windows 强制删除文件' },
  { pattern: /\brd\s+\/[sq]/i, reason: 'Windows 强制删除目录' },
  { pattern: /\bformat\s+[a-z]:/i, reason: 'Windows 格式化磁盘' },
  // 网络外泄工具（nc/ncat 在 SENSITIVE_COMMANDS 中，需确认后使用）
  { pattern: /\b(curl|wget)\s+.*\|\s*(nc|ncat)\b/i, reason: '管道外泄到网络' },
];

// 1. 命令白名单 — 这些命令可以直接执行，不需要二次确认
// 仅包含纯只读/无副作用的命令，任何可执行代码/下载/修改的命令都不在此列
const SAFE_COMMANDS = [
  // 文件浏览
  'ls', 'dir', 'tree', 'find', 'locate', 'which', 'where', 'pwd', 'cd',
  // 文件查看
  'cat', 'head', 'tail', 'less', 'more', 'type', 'bat',
  // 搜索
  'grep', 'rg', 'ag', 'ack', 'findstr', 'select-string',
  // 文件信息
  'stat', 'wc', 'file', 'du', 'df', 'touch',
  // 版本控制（git 移至 AUTO_APPROVE_COMMANDS）
  'svn', 'hg',
  // 构建工具（make/cmake/gradle/mvn 移至 AUTO_APPROVE_COMMANDS）
  // 测试（jest/mocha/pytest/vitest 移至 AUTO_APPROVE_COMMANDS）
  // 文本处理（sed/awk 可修改文件/执行系统命令，移至 SENSITIVE_COMMANDS）
  'echo', 'printf', 'sort', 'uniq', 'diff', 'patch', 'tr', 'cut',
  // 压缩（查看）
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  // 网络（ping/nslookup 等只读；curl/wget 移至 AUTO_APPROVE_COMMANDS）
  'ping', 'nslookup', 'dig', 'host', 'ipconfig', 'ifconfig',
  // 进程查看
  'ps', 'top', 'htop', 'tasklist', 'wmic',
  // 环境信息
  'env', 'set', 'printenv', 'whoami', 'hostname', 'uname', 'date', 'cal',
  'id', 'groups', 'uptime', 'free', 'lsb_release', 'sw_vers',
  // 编码
  'base64', 'md5sum', 'sha256sum', 'certutil',
  // PowerShell 只读 cmdlet（Get-* 系列均为只读查询）
  'Get-ChildItem', 'Get-Content', 'Get-Item', 'Get-Location', 'Get-Process',
  'Get-Service', 'Get-Date', 'Get-Host', 'Get-Command', 'Get-Help',
  'Get-Variable', 'Get-Alias', 'Get-History', 'Get-Module',
  'Get-EventLog', 'Get-WmiObject', 'Get-CimInstance', 'Get-NetTCPConnection',
  'Test-Path', 'Test-Connection', 'Read-Host',
  'Get-ItemProperty', 'Get-ItemPropertyValue', 'Get-FileHash',
  'Select-Object', 'Where-Object', 'ForEach-Object', 'Format-Table', 'Format-List',
  'Get-WinEvent', 'Get-Counter', 'Get-LocalGroup', 'Get-LocalUser',
  // 代码检查/格式化（移至 AUTO_APPROVE_COMMANDS）
];

// 1.5 自动批准命令 — 危险系数不高，无需确认即可执行
// 这些命令虽然有一定风险，但在日常开发中频繁使用，且风险可控
const AUTO_APPROVE_COMMANDS = [
  // 版本控制（常用操作，风险低）
  'git',
  // 包管理（安装/查看依赖）
  'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo',
  // 开发运行时（运行项目/脚本）
  'node', 'python', 'python3', 'ruby', 'java', 'go', 'powershell', 'pwsh', 'cmd',
  // WSL 访问（Windows 下通过 WSL 执行 Linux 命令）
  'wsl', 'bash', 'sh', 'zsh',
  // 构建工具
  'make', 'cmake', 'gradle', 'mvn',
  // 测试框架
  'jest', 'mocha', 'pytest', 'vitest',
  // 代码检查/格式化
  'tsc', 'eslint', 'prettier', 'ruff', 'black', 'mypy',
  // 网络请求（仅查看）
  'curl', 'wget',
];

// 2. 敏感命令 — 需要二次确认（AI 解释作用后用户确认）
const SENSITIVE_COMMANDS = [
  // 文件修改
  'rm', 'del', 'rmdir', 'rd', 'move', 'ren', 'rename', 'cp', 'copy', 'xcopy', 'robocopy',
  'mkdir', 'md', 'chmod', 'chown', 'icacls', 'attrib',
  // 文本处理（可修改文件/执行系统命令）
  'sed', 'awk',
  // 容器逃逸风险
  'docker',
  // 编译器（可通过 -e 等参数执行任意代码）
  'rustc',
  // 系统操作
  'net', 'netsh', 'sc', 'reg', 'regedit', 'gpupdate', 'sfc', 'dism',
  'taskkill', 'kill', 'pkill', 'killall',
  // 服务管理
  'systemctl', 'service', 'net start', 'net stop',
  // 安装/卸载
  'install', 'apt', 'apt-get', 'yum', 'dnf', 'brew', 'choco', 'scoop', 'winget',
  'npm install', 'npm uninstall', 'npm i',
  'pip install', 'pip uninstall', 'pip3 install', 'pip3 uninstall',
  'yarn add', 'yarn remove', 'pnpm add', 'pnpm remove',
  'cargo install',
  // 用户管理
  'useradd', 'userdel', 'passwd', 'adduser',
  // 防火墙
  'iptables', 'ufw', 'firewall-cmd',
  // 注册表
  'reg', 'regedit', 'regsvr32',
  // 计划任务
  'schtasks', 'crontab', 'at',
  // PowerShell 执行策略
  'Set-ExecutionPolicy',
  // PowerShell 写入/修改类 cmdlet
  'Remove-Item', 'Remove-ItemProperty', 'Remove-ItemPropertyValue',
  'Set-Content', 'Out-File', 'Add-Content', 'Clear-Content',
  'Start-Process', 'Stop-Process', 'Wait-Process', 'Debug-Process',
  'Invoke-WebRequest', 'Invoke-RestMethod', 'Invoke-CimMethod',
  'New-Item', 'New-ItemProperty', 'Move-Item', 'Move-ItemProperty',
  'Rename-Item', 'Rename-ItemProperty', 'Copy-Item', 'Copy-ItemProperty',
  'Set-Item', 'Set-ItemProperty', 'Clear-Item',
  'Enable-ComputerRestore', 'Disable-ComputerRestore',
  'Restart-Computer', 'Stop-Computer',
  'Set-Service', 'Start-Service', 'Stop-Service', 'Restart-Service',
  'Register-ScheduledTask', 'Unregister-ScheduledTask',
  'Set-Acl', 'Set-AuthenticodeSignature',
  // 网络外泄工具
  'nc', 'ncat',
];

// 3. 禁止路径 — 绝对不允许读写
const FORBIDDEN_PATHS = [
  // Windows 系统目录
  'C:\\Windows', 'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64', 'C:\\Windows\\System',
  'C:\\Windows\\WinSxS', 'C:\\Windows\\SoftwareDistribution',
  // Program Files
  'C:\\Program Files', 'C:\\Program Files (x86)',
  // 系统根目录关键文件
  'C:\\bootmgr', 'C:\\BOOTNXT', 'C:\\pagefile.sys', 'C:\\hiberfil.sys',
  // Linux 系统目录
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/boot', '/sys', '/proc', '/dev',
  '/root', '/var/log', '/var/lib',
  // macOS 系统目录
  '/System', '/Library', '/private/var',
];

// 4. 敏感路径 — 需要二次确认
const SENSITIVE_PATHS = [
  process.env.USERPROFILE || process.env.HOME || '',
  process.env.APPDATA || '',
  process.env.LOCALAPPDATA || '',
  'C:\\Users', '/home',
];

// 判断命令安全级别: 'safe' | 'auto_approve' | 'sensitive' | 'dangerous'
function classifyCommand(command) {
  if (!command || typeof command !== 'string') return 'safe';

  const cmd = command.trim();

  // 先检查危险命令（最高优先级）
  try {
    detectDangerousCommand(cmd);
  } catch (e) {
    if (e.name === 'SecurityBlockedError') return 'dangerous';
    throw e;
  }

  // 处理链式命令：&&、||、;、| 连接的多个子命令，取最高风险级别
  var subCommands = splitChainCommands(cmd);
  if (subCommands.length > 1) {
    var maxLevel = 'safe';
    var levelOrder = { safe: 0, auto_approve: 1, sensitive: 2, dangerous: 3 };
    for (var i = 0; i < subCommands.length; i++) {
      var subLevel = classifyCommand(subCommands[i]);
      if (levelOrder[subLevel] > levelOrder[maxLevel]) maxLevel = subLevel;
    }
    return maxLevel;
  }

  // 提取命令名（第一个词）
  const firstWord = cmd.split(/\s+/)[0].toLowerCase();
  // 处理路径形式: C:\xxx 或 /usr/bin/xxx
  const baseName = firstWord.split(/[/\\]/).pop().replace(/\.(exe|bat|cmd|ps1|sh)$/i, '');

  // 检查敏感命令（优先于白名单，因为 npm install 是敏感的但 npm 是安全的）
  for (const sc of SENSITIVE_COMMANDS) {
    if (cmd.toLowerCase().startsWith(sc + ' ') || cmd.toLowerCase() === sc) {
      return 'sensitive';
    }
  }

  // 检查白名单（纯只读/无副作用命令）— 大小写不敏感匹配
  var safeCommandsLower = SAFE_COMMANDS.map(function(c) { return c.toLowerCase(); });
  if (safeCommandsLower.includes(baseName) || safeCommandsLower.includes(firstWord)) {
    return 'safe';
  }

  // 检查自动批准命令（有一定风险但日常频繁使用，直接执行但记录日志）— 大小写不敏感
  var autoApproveLower = AUTO_APPROVE_COMMANDS.map(function(c) { return c.toLowerCase(); });
  if (autoApproveLower.includes(baseName) || autoApproveLower.includes(firstWord)) {
    // WSL/bash/sh/zsh 前缀命令：检查子命令的安全级别
    if (['wsl', 'bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'].includes(baseName) || ['wsl', 'bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'].includes(firstWord)) {
      var subCmd = extractSubCommand(cmd);
      if (subCmd) {
        var subLevel = classifyCommand(subCmd);
        // 子命令是 safe 的，整体也 safe；auto_approve 的，整体也 auto_approve
        if (subLevel === 'safe') return 'safe';
        if (subLevel === 'auto_approve') return 'auto_approve';
        // 子命令是 sensitive/dangerous 的，保持原级别
        return subLevel;
      }
    }
    return 'auto_approve';
  }

  // 未知命令默认为敏感
  return 'sensitive';
}

// 拆分链式命令：&&、||、;、| 连接的多个子命令
function splitChainCommands(cmd) {
  // 简单拆分，不处理引号内的分隔符（对于安全检查足够）
  var parts = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/);
  return parts.filter(function(p) { return p.trim().length > 0; });
}

// 从 wsl/bash/sh/zsh 前缀命令中提取实际子命令
function extractSubCommand(cmd) {
  // powershell -Command "Get-ChildItem ..." → 提取 "Get-ChildItem ..."
  var psMatch = cmd.match(/^p(?:owershell|wsh)\s+(?:-Command\s+)?["']?(.+?)["']?$/i);
  if (psMatch) return psMatch[1];
  // cmd /c "xxx" 或 cmd /s /c "xxx" → 提取 xxx
  var cmdMatch = cmd.match(/^cmd\s+(?:\/s\s+)?\/c\s+["']?(.+?)["']?$/i);
  if (cmdMatch) return cmdMatch[1];
  // wsl -- bash -c "xxx" → 提取 xxx
  var wslBashMatch = cmd.match(/^wsl\s+.*bash\s+-c\s+["'](.+?)["']/i);
  if (wslBashMatch) return wslBashMatch[1];
  // bash -c "xxx" → 提取 xxx
  var bashMatch = cmd.match(/^(bash|sh|zsh)\s+-c\s+["'](.+?)["']/i);
  if (bashMatch) return bashMatch[2];
  // wsl ls -la → 提取 ls -la
  var wslSimpleMatch = cmd.match(/^wsl\s+(?:--\S+\s+)*(\S+.*)/i);
  if (wslSimpleMatch) return wslSimpleMatch[1].trim();
  // bash/sh/zsh ls → 提取 ls
  var shellSimpleMatch = cmd.match(/^(bash|sh|zsh)\s+(\S+.*)/i);
  if (shellSimpleMatch) return shellSimpleMatch[2].trim();
  return null;
}

// 检查路径是否在禁止列表中（FORBIDDEN_PATHS + NEVER_ALLOW_PATHS + UNC路径）
// 注意: 此检查不可被 globalPermissions 或 _confirmed 绕过
// 安全拦截时抛出 SecurityBlockedError，由 executeTool 统一捕获和格式化
function isForbiddenPath(filePath) {
  if (!filePath) return null;

  // Null 字节注入检查 — 防止截断攻击
  if (filePath.indexOf('\0') >= 0) {
    throw new errors.SecurityBlockedError('isForbiddenPath', '路径包含 null 字节(可能的截断攻击): ' + filePath, 'never_allow');
  }

  const normalized = path.resolve(filePath).toLowerCase();

  // 1. Windows UNC 路径防护 — 防止 NTLM 凭据泄露
  // \\attacker-server\share\file.txt 会触发 Windows 自动发送 NTLM 凭据
  // 但 \\wsl$\ 和 \\wsl.localhost\ 是合法的 WSL 文件系统访问路径，应放行
  if (/^\\\\wsl(\$|\.localhost)\\/i.test(filePath) || /^\/\/wsl(\$|\.localhost)\//i.test(filePath)) {
    // WSL 文件系统路径 — 允许，但继续后续安全检查
  } else if (/^\\\\[a-z0-9]/i.test(filePath) || filePath.startsWith('//')) {
    throw new errors.SecurityBlockedError('isForbiddenPath', 'UNC网络路径已被禁止(防止NTLM凭据泄露): ' + filePath, 'never_allow');
  }

  // 2. NEVER_ALLOW 路径检查 — deny 永远赢，任何权限都无法绕过
  for (const na of NEVER_ALLOW_PATHS) {
    if (!na) continue;
    const naLower = na.toLowerCase();
    // 检查路径中是否包含这些危险目录/文件名
    // 例如: /home/user/.git, C:\project\.git, /home/user/.bashrc
    const segments = normalized.split(/[/\\]/);
    for (const seg of segments) {
      if (seg === naLower || seg === naLower.replace(/[/\\]$/, '')) {
        throw new errors.SecurityBlockedError('isForbiddenPath', 'NEVER_ALLOW: 受保护路径(不可绕过): ' + na, 'never_allow');
      }
    }
    // 也检查路径结尾是否匹配文件名
    if (normalized.endsWith(naLower) || normalized.endsWith(naLower + '/') || normalized.endsWith(naLower + '\\')) {
      throw new errors.SecurityBlockedError('isForbiddenPath', 'NEVER_ALLOW: 受保护路径(不可绕过): ' + na, 'never_allow');
    }
  }

  // 3. FORBIDDEN_PATHS 检查 — 系统关键目录
  for (const fp of FORBIDDEN_PATHS) {
    if (!fp) continue;
    if (normalized.startsWith(fp.toLowerCase()) || normalized === fp.toLowerCase()) {
      throw new errors.SecurityBlockedError('isForbiddenPath', '系统关键目录: ' + fp, 'never_allow');
    }
  }
  return null;
}

// 检查路径是否在敏感列表中
function isSensitivePath(filePath) {
  if (!filePath) return false;
  const normalized = path.resolve(filePath).toLowerCase();
  for (const sp of SENSITIVE_PATHS) {
    if (!sp) continue;
    if (normalized.startsWith(sp.toLowerCase())) {
      return { sensitive: true, reason: '用户目录: ' + sp };
    }
  }
  return null;
}

// 检查路径是否在 workspace 外
function isOutsideWorkspace(filePath, workspaceDir) {
  if (!filePath || !workspaceDir) return false;
  const normalized = path.resolve(filePath).toLowerCase();
  const wsNormalized = path.resolve(workspaceDir).toLowerCase();
  return !normalized.startsWith(wsNormalized);
}

// 检查路径是否在 workspace 内（Windows 兼容，统一处理正反斜杠）
function isPathWithinWorkspace(filePath, workspaceDir) {
  if (!filePath || !workspaceDir) return false;
  // 统一解析并规范化路径，处理 Windows 正反斜杠差异
  var resolvedTarget = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  var resolvedWs = path.resolve(workspaceDir).replace(/\\/g, '/').toLowerCase();
  // 确保 workspace 目录以 / 结尾，避免 /home/user 匹配 /home/userdata
  if (!resolvedWs.endsWith('/')) resolvedWs += '/';
  return resolvedTarget.startsWith(resolvedWs) || resolvedTarget === resolvedWs.slice(0, -1);
}

// ============================================================
// 危险命令检测 — "deny 永远赢" 原则
// NEVER_ALLOW_COMMAND_PATTERNS 不可被任何权限绕过
// ============================================================

function detectDangerousCommand(command) {
  // NEVER_ALLOW 命令检查 — 任何权限都无法绕过
  // 安全拦截时抛出 SecurityBlockedError，由 executeTool 统一捕获和格式化
  for (var i = 0; i < NEVER_ALLOW_COMMAND_PATTERNS.length; i++) {
    if (NEVER_ALLOW_COMMAND_PATTERNS[i].pattern.test(command)) {
      throw new errors.SecurityBlockedError('detectDangerousCommand', NEVER_ALLOW_COMMAND_PATTERNS[i].reason, 'never_allow');
    }
  }
  return null;
}

// ============================================================
// 辅助
// ============================================================
function resolvePath(filePath, workspaceDir) {
  if (!filePath) return workspaceDir || process.cwd();

  // 移除 null 字节（防止截断攻击）
  if (filePath.indexOf('\0') >= 0) {
    filePath = filePath.replace(/\0/g, '');
  }

  // WSL 网络路径: \\wsl$\Ubuntu\home\user — 直接返回，Windows 可访问
  if (/^\\\\wsl(\$|\.localhost)\\/i.test(filePath)) return filePath;

  // /mnt/c/... 格式 — WSL 风格路径，转为 Windows 路径
  if (crossPlatform.WSL.isWslPath(filePath)) {
    return crossPlatform.WSL.wslToWin(filePath);
  }

  // WSL 原生路径: /home/user/... — 转为 \\wsl$\Distro\home\user
  if (crossPlatform.PLATFORM.isWindows && crossPlatform.WSL.isWslNativePath(filePath)) {
    const distro = crossPlatform.WSL.getDefaultDistro();
    return '\\\\wsl$\\' + distro + filePath.replace(/\//g, '\\');
  }

  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  var normalized = filePath.replace(/^[/\\]*workspace[/\\]/i, '');
  return path.join(workspaceDir, normalized);
}

// 检测命令是否应该在 WSL 中执行
// 包含 Linux 特有命令或路径时自动切换
function detectWslCommand(command) {
  if (!crossPlatform.PLATFORM.isWindows) return false;
  if (!crossPlatform.WSL.isAvailable()) return false;

  // 明确的 Linux 命令
  const linuxOnlyCmds = [
    'apt', 'apt-get', 'dpkg', 'snap', 'systemctl', 'journalctl',
    'pacman', 'yum', 'dnf', 'zypper',
    'grep -R', 'find /', 'chmod', 'chown',
    'bash -c', 'sh -c',
    'make', 'cmake',
    'gcc', 'g++', 'clang',
    'docker run', 'docker exec',
    'python3', 'pip3',
    'ls -la', 'cat /etc/',
    'htop', 'nano', 'vim',
    'apt-cache', 'aptitude'
  ];

  const cmdLower = command.toLowerCase().trim();
  for (const lc of linuxOnlyCmds) {
    if (cmdLower.startsWith(lc.toLowerCase())) return true;
  }

  // 包含 Linux 特有路径
  if (/\/etc\/|\/var\/log\/|\/usr\/|\/home\/|\/tmp\//.test(command)) return true;

  // 包含管道和 Linux 命令
  if (/\|\s*(grep|awk|sed|sort|uniq|head|tail|xargs)\b/.test(command)) return true;

  return false;
}

function generateId() {
  return 'tc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

module.exports = { ToolRegistry, jsonResult, textResult, errorResult, createToolContext, resolvePath, detectDangerousCommand, classifyCommand, isForbiddenPath, isSensitivePath, isOutsideWorkspace, isPathWithinWorkspace };