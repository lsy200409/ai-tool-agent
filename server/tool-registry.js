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

        // 路径安全检查
        const forbidden = isForbiddenPath(filePath);
        if (forbidden) {
          return jsonResult({ success: true, blocked: true, reason: '禁止读取: ' + forbidden.reason, path: filePath });
        }

        // workspace 外的路径需要确认
        if (isOutsideWorkspace(filePath, wsDir) && !ctx.globalPermissions && !ctx._confirmed) {
          const sensitive = isSensitivePath(filePath);
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: sensitive ? '读取敏感目录需要确认: ' + sensitive.reason : '读取 workspace 外路径需要确认',
            path: filePath,
            explanation: 'AI 应说明需要读取此文件的原因，由用户确认后执行'
          });
        }

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

        // 路径安全检查
        const forbidden = isForbiddenPath(filePath);
        if (forbidden) {
          return jsonResult({ success: true, blocked: true, reason: '禁止写入: ' + forbidden.reason, path: filePath });
        }

        // 写入 workspace 外的路径需要确认
        if (isOutsideWorkspace(filePath, wsDir) && !ctx.globalPermissions && !ctx._confirmed) {
          const sensitive = isSensitivePath(filePath);
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: sensitive ? '写入敏感目录需要确认: ' + sensitive.reason : '写入 workspace 外路径需要确认',
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

        // 路径安全检查
        const forbidden = isForbiddenPath(filePath);
        if (forbidden) {
          return jsonResult({ success: true, blocked: true, reason: '禁止写入: ' + forbidden.reason, path: filePath });
        }

        // 写入 workspace 外的路径需要确认
        if (isOutsideWorkspace(filePath, wsDir) && !ctx.globalPermissions && !ctx._confirmed) {
          const sensitive = isSensitivePath(filePath);
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: sensitive ? '写入敏感目录需要确认: ' + sensitive.reason : '写入 workspace 外路径需要确认',
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

        // 路径安全检查
        const forbidden = isForbiddenPath(dirPath);
        if (forbidden) {
          return jsonResult({ success: true, blocked: true, reason: '禁止列出: ' + forbidden.reason, path: dirPath });
        }

        // workspace 外的路径需要确认
        if (isOutsideWorkspace(dirPath, wsDir) && !ctx.globalPermissions && !ctx._confirmed) {
          const sensitive = isSensitivePath(dirPath);
          return jsonResult({
            success: true,
            blocked: true,
            needsConfirmation: true,
            reason: sensitive ? '列出敏感目录需要确认: ' + sensitive.reason : '列出 workspace 外目录需要确认',
            path: dirPath,
            explanation: 'AI 应说明需要访问此目录的原因，由用户确认后执行'
          });
        }

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
        if (!args.command) return jsonResult({ success: false, error: '缺少 command 参数' });

        // 1. 危险命令检测（最高优先级，直接拦截）
        if (!ctx.globalPermissions) {
          const danger = detectDangerousCommand(args.command);
          if (danger) {
            return jsonResult({ success: true, blocked: true, reason: danger.reason, command: args.command, stdout: '', stderr: '' });
          }
        }

        // 2. 命令安全级别分类
        const safetyLevel = classifyCommand(args.command);

        // 3. 工作目录检查
        const workDir = args.cwd ? resolvePath(args.cwd, wsDir) : wsDir;
        const cwdCheck = isForbiddenPath(workDir);
        if (cwdCheck) {
          return jsonResult({ success: true, blocked: true, reason: '工作目录在禁止区域: ' + cwdCheck.reason, command: args.command, stdout: '', stderr: '' });
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

        // 5. 执行命令
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
            stderr: (result.stderr || '').substring(0, 10000),
            safetyLevel: safetyLevel
          });
        } catch (error) {
          return jsonResult({
            success: true,
            stdout: (error.stdout || '').substring(0, 50000),
            stderr: (error.stderr || error.message || '').substring(0, 10000),
            exitCode: error.code || -1,
            safetyLevel: safetyLevel
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
    this._globalPermissions = false;
    this._registerBuiltins();
  }

  // --- 注册 ---
  _registerBuiltins() {
    const ctx = createToolContext({ workspaceDir: this._workspaceDir, globalPermissions: this._globalPermissions });
    const tools = buildBuiltinTools(ctx);
    for (const tool of tools) {
      this._tools.set(tool.name, tool);
    }
  }

  setGlobalPermissions(enabled) {
    this._globalPermissions = !!enabled;
    var pluginEntries = new Map();
    for (var [name, pluginId] of this._pluginTools) pluginEntries.set(name, pluginId);
    this._tools.clear();
    this._pluginTools.clear();
    this._registerBuiltins();
    for (var [name, pluginId] of pluginEntries) this._pluginTools.set(name, pluginId);
  }

  registerTool(factory, opts) {
    if (typeof factory === 'function') {
      const ctx = createToolContext({ workspaceDir: this._workspaceDir, globalPermissions: this._globalPermissions });
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

  // --- 带确认标记执行（用于 /api/confirm 端点）---
  async executeToolConfirmed(name, args, opts) {
    const confirmedCtx = createToolContext({
      workspaceDir: this._workspaceDir,
      globalPermissions: this._globalPermissions,
      _confirmed: true
    });
    const tools = buildBuiltinTools(confirmedCtx);
    const tool = tools.find(t => t.name === name);
    if (!tool) return errorResult(`未知工具: ${name}`);

    const toolCallId = (opts && opts.toolCallId) || generateId();
    try {
      return await tool.execute(toolCallId, args);
    } catch (e) {
      return errorResult('工具执行异常: ' + e.message);
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
// 安全约束系统
// ============================================================

// 1. 命令白名单 — 这些命令可以直接执行，不需要二次确认
const SAFE_COMMANDS = [
  // 文件浏览
  'ls', 'dir', 'tree', 'find', 'locate', 'which', 'where', 'pwd', 'cd',
  // 文件查看
  'cat', 'head', 'tail', 'less', 'more', 'type', 'bat',
  // 搜索
  'grep', 'rg', 'ag', 'ack', 'findstr', 'select-string',
  // 文件信息
  'stat', 'wc', 'file', 'du', 'df', 'touch',
  // 版本控制
  'git', 'svn', 'hg',
  // 包管理（只读操作）
  'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo',
  // 开发工具
  'node', 'python', 'python3', 'ruby', 'java', 'go', 'rustc',
  // 构建工具
  'make', 'cmake', 'gradle', 'mvn',
  // 测试
  'jest', 'mocha', 'pytest', 'vitest',
  // 文本处理
  'echo', 'printf', 'sort', 'uniq', 'diff', 'patch', 'tr', 'cut', 'awk', 'sed',
  // 压缩（查看）
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  // 网络（只读）
  'ping', 'curl', 'wget', 'nslookup', 'dig', 'host', 'ipconfig', 'ifconfig',
  // 进程查看
  'ps', 'top', 'htop', 'tasklist', 'wmic',
  // 环境信息
  'env', 'set', 'printenv', 'whoami', 'hostname', 'uname', 'date', 'cal',
  // Docker（只读）
  'docker',
  // 编码
  'base64', 'md5sum', 'sha256sum', 'certutil',
  // 其他安全命令
  'tsc', 'eslint', 'prettier', 'ruff', 'black', 'mypy',
];

// 2. 敏感命令 — 需要二次确认（AI 解释作用后用户确认）
const SENSITIVE_COMMANDS = [
  // 文件修改
  'rm', 'del', 'rmdir', 'rd', 'move', 'ren', 'rename', 'cp', 'copy', 'xcopy', 'robocopy',
  'mkdir', 'md', 'chmod', 'chown', 'icacls', 'attrib',
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
];

// 3. 禁止路径 — 绝对不允许读写
const FORBIDDEN_PATHS = [
  // Windows 系统目录
  'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64', 'C:\\Windows\\System',
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

// 判断命令安全级别: 'safe' | 'sensitive' | 'dangerous'
function classifyCommand(command) {
  if (!command || typeof command !== 'string') return 'safe';

  const cmd = command.trim();

  // 先检查危险命令（最高优先级）
  const danger = detectDangerousCommand(cmd);
  if (danger) return 'dangerous';

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

  // 检查白名单
  if (SAFE_COMMANDS.includes(baseName) || SAFE_COMMANDS.includes(firstWord)) {
    return 'safe';
  }

  // 未知命令默认为敏感
  return 'sensitive';
}

// 检查路径是否在禁止列表中
function isForbiddenPath(filePath) {
  if (!filePath) return false;
  const normalized = path.resolve(filePath).toLowerCase();
  for (const fp of FORBIDDEN_PATHS) {
    if (!fp) continue;
    if (normalized.startsWith(fp.toLowerCase()) || normalized === fp.toLowerCase()) {
      return { forbidden: true, reason: '系统关键目录: ' + fp };
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

module.exports = { ToolRegistry, jsonResult, textResult, errorResult, createToolContext, resolvePath, detectDangerousCommand, classifyCommand, isForbiddenPath, isSensitivePath, isOutsideWorkspace };