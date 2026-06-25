// ============================================================
// AI Tool Agent — MCP 客户端兼容层
//
// 让系统能连接 MCP (Model Context Protocol) 服务器，
// 自动发现工具并注册到 ToolRegistry。
//
// 支持的传输方式:
//   - stdio: 启动子进程，通过 stdin/stdout JSON-RPC 通信
//   - HTTP/SSE: 连接远程 MCP 服务器
//
// 配置格式 (workspace/config/mcp_servers.json):
// {
//   "servers": {
//     "my-server": {
//       "transport": "stdio",
//       "command": "node",
//       "args": ["path/to/server.js"],
//       "env": { "KEY": "VALUE" }
//     },
//     "remote-server": {
//       "transport": "sse",
//       "url": "http://localhost:3100/mcp",
//       "headers": { "Authorization": "Bearer token" }
//     }
//   }
// }
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const fsp = require('fs').promises;

var MCP_CONFIG_FILE = null; // 延迟初始化
var mcpConnections = {};    // serverName → MCPConnection
var registeredMcpTools = []; // 已注册的 MCP 工具名列表

// ============================================================
// JSON-RPC 2.0 辅助
// ============================================================
var jsonRpcId = 1;

function jsonRpcRequest(method, params) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: jsonRpcId++,
    method: method,
    params: params || {}
  });
}

function parseJsonRpcResponse(data) {
  try {
    var parsed = JSON.parse(data);
    if (parsed.error) {
      return { success: false, error: parsed.error.message || JSON.stringify(parsed.error) };
    }
    return { success: true, result: parsed.result };
  } catch (e) {
    return { success: false, error: 'JSON 解析失败: ' + e.message };
  }
}

// ============================================================
// Stdio 传输 — 通过子进程 stdin/stdout 通信
// ============================================================
function createStdioConnection(config) {
  var child = null;
  var buffer = '';
  var pendingRequests = {}; // id → { resolve, reject, timer }
  var connected = false;
  var self = { start: start, send: send, stop: stop, isConnected: function() { return connected; }, child: null };

  function start() {
    return new Promise(function(resolve, reject) {
      try {
        var cmd = config.command || 'node';
        var args = config.args || [];
        var env = Object.assign({}, process.env, config.env || {});

        child = spawn(cmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: env,
          cwd: config.cwd || process.cwd()
        });

        child.stdout.on('data', function(chunk) {
          buffer += chunk.toString();
          // JSON-RPC 消息以换行分隔
          var lines = buffer.split('\n');
          buffer = lines.pop(); // 保留不完整的行
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            handleResponse(line);
          }
        });

        child.stderr.on('data', function(chunk) {
          // MCP 服务器调试输出，不干扰协议
        });

        child.on('error', function(err) {
          console.error('[MCP] 子进程启动失败:', err.message);
          connected = false;
          reject(err);
        });

        child.on('exit', function(code) {
          connected = false;
          // 拒绝所有待处理请求
          var ids = Object.keys(pendingRequests);
          for (var i = 0; i < ids.length; i++) {
            var pending = pendingRequests[ids[i]];
            if (pending.timer) clearTimeout(pending.timer);
            pending.reject(new Error('MCP 服务器已退出 (code=' + code + ')'));
            delete pendingRequests[ids[i]];
          }
        });

        connected = true;
        self.child = child;
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function handleResponse(data) {
    var parsed = parseJsonRpcResponse(data);
    var idMatch = data.match(/"id"\s*:\s*(\d+)/);
    if (idMatch) {
      var id = idMatch[1];
      var pending = pendingRequests[id];
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        delete pendingRequests[id];
        if (parsed.success) {
          pending.resolve(parsed.result);
        } else {
          pending.reject(new Error(parsed.error));
        }
      }
    }
  }

  function send(method, params, timeoutMs) {
    return new Promise(function(resolve, reject) {
      if (!child || !connected) {
        reject(new Error('MCP 服务器未连接'));
        return;
      }
      var id = jsonRpcId;
      var msg = jsonRpcRequest(method, params);
      var timeout = setTimeout(function() {
        delete pendingRequests[id];
        reject(new Error('MCP 请求超时 (' + (timeoutMs || 30000) + 'ms): ' + method));
      }, timeoutMs || 30000);

      pendingRequests[id] = { resolve: resolve, reject: reject, timer: timeout };
      child.stdin.write(msg + '\n');
    });
  }

  function stop() {
    connected = false;
    self.child = null;
    if (child) {
      try { child.kill('SIGTERM'); } catch (e) {}
      child = null;
    }
  }

  return self;
}

// ============================================================
// HTTP/SSE 传输 — 连接远程 MCP 服务器
// ============================================================
function createSseConnection(config) {
  var connected = false;
  var serverUrl = config.url;
  var headers = config.headers || {};

  function start() {
    return new Promise(function(resolve, reject) {
      // 验证 URL
      if (!serverUrl || (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://'))) {
        reject(new Error('无效的 MCP 服务器 URL: ' + serverUrl));
        return;
      }
      connected = true;
      resolve();
    });
  }

  function send(method, params, timeoutMs) {
    return new Promise(function(resolve, reject) {
      if (!connected) {
        reject(new Error('MCP 服务器未连接'));
        return;
      }

      var msg = jsonRpcRequest(method, params);
      var urlObj = new URL(serverUrl);
      var transport = urlObj.protocol === 'https:' ? https : http;

      var reqHeaders = Object.assign({
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }, headers);

      var req = transport.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: reqHeaders,
        timeout: timeoutMs || 30000
      }, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          if (res.statusCode !== 200) {
            reject(new Error('HTTP ' + res.statusCode + ': ' + data.substring(0, 200)));
            return;
          }
          var parsed = parseJsonRpcResponse(data);
          if (parsed.success) {
            resolve(parsed.result);
          } else {
            reject(new Error(parsed.error));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', function() {
        req.destroy();
        reject(new Error('MCP HTTP 请求超时'));
      });
      req.write(msg);
      req.end();
    });
  }

  function stop() {
    connected = false;
  }

  return { start: start, send: send, stop: stop, isConnected: function() { return connected; } };
}

// ============================================================
// MCP 连接管理器
// ============================================================
async function connectMcpServer(name, config) {
  console.log('[MCP] 连接服务器: ' + name + ' (transport=' + (config.transport || 'stdio') + ')');

  var connection;
  if (config.transport === 'sse' || config.transport === 'streamable-http' || config.url) {
    connection = createSseConnection(config);
  } else {
    connection = createStdioConnection(config);
  }

  try {
    await connection.start();
    console.log('[MCP] 已连接: ' + name);

    // 初始化 MCP 协议
    var initResult = await connection.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'ai-tool-agent',
        version: '0.1.1'
      }
    }, 15000);

    console.log('[MCP] 初始化成功: ' + name + ' (server=' + (initResult.serverInfo || {}).name + ')');

    mcpConnections[name] = {
      name: name,
      config: config,
      connection: connection,
      serverInfo: initResult.serverInfo || {},
      capabilities: initResult.capabilities || {}
    };

    // 发送 initialized 通知（MCP 通知不需要响应，直接写入 stdin）
    try {
      var notifMsg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      });
      if (connection.child) {
        connection.child.stdin.write(notifMsg + '\n');
      }
    } catch (e) {
      // 通知不需要响应，忽略错误
    }

    return mcpConnections[name];
  } catch (e) {
    console.error('[MCP] 连接失败: ' + name + ' — ' + e.message);
    connection.stop();
    throw e;
  }
}

// ============================================================
// 发现 MCP 工具并注册到 ToolRegistry
// ============================================================
async function discoverAndRegisterTools(toolRegistry, serverName) {
  var connInfo = mcpConnections[serverName];
  if (!connInfo) {
    console.error('[MCP] 服务器未连接: ' + serverName);
    return [];
  }

  try {
    var toolsResult = await connInfo.connection.send('tools/list', {}, 10000);
    var tools = (toolsResult && toolsResult.tools) || [];
    console.log('[MCP] 发现 ' + tools.length + ' 个工具: ' + serverName);

    var registered = [];
    for (var i = 0; i < tools.length; i++) {
      var mcpTool = tools[i];
      var toolName = serverName + '_' + mcpTool.name;

      // 创建适配器：将 MCP 工具转换为 AnyAgentTool 格式
      var adaptedTool = createMcpToolAdapter(toolName, mcpTool, serverName, connInfo.connection);
      toolRegistry.registerTool(adaptedTool, { pluginId: 'mcp:' + serverName });
      registeredMcpTools.push(toolName);
      registered.push(toolName);
    }

    console.log('[MCP] 已注册 ' + registered.length + ' 个工具: ' + serverName);
    return registered;
  } catch (e) {
    console.error('[MCP] 工具发现失败: ' + serverName + ' — ' + e.message);
    return [];
  }
}

// ============================================================
// MCP 工具适配器 — 将 MCP 工具转换为 AnyAgentTool
// ============================================================
function createMcpToolAdapter(toolName, mcpTool, serverName, connection) {
  // 将 MCP inputSchema 转换为我们的 parameters 格式
  var parameters = mcpTool.inputSchema || {
    type: 'object',
    properties: {},
    required: []
  };

  // 确保 parameters 有正确的结构
  if (!parameters.type) parameters.type = 'object';
  if (!parameters.properties) parameters.properties = {};

  return {
    name: toolName,
    label: (mcpTool.annotations && mcpTool.annotations.title) || mcpTool.name,
    description: (mcpTool.description || '') + ' [MCP:' + serverName + ']',
    parameters: parameters,
    isReadOnly: mcpTool.annotations && mcpTool.annotations.readOnlyHint,
    isConcurrencySafe: true,
    isDestructive: mcpTool.annotations && mcpTool.annotations.destructiveHint,
    execute: async function(toolCallId, args) {
      try {
        var result = await connection.send('tools/call', {
          name: mcpTool.name,
          arguments: args || {}
        }, 60000);

        // MCP 工具返回格式: { content: [{type: "text", text: "..."}], isError: bool }
        var content = (result && result.content) || [];
        var isError = result && result.isError;
        var textParts = [];

        for (var i = 0; i < content.length; i++) {
          if (content[i].type === 'text') {
            textParts.push(content[i].text);
          } else if (content[i].type === 'image') {
            textParts.push('[image: ' + (content[i].mimeType || 'unknown') + ']');
          } else if (content[i].type === 'resource') {
            textParts.push('[resource: ' + JSON.stringify(content[i].resource) + ']');
          }
        }

        var responseText = textParts.join('\n');

        // 尝试解析为 JSON，如果失败则包装
        try {
          var parsed = JSON.parse(responseText);
          return [{ type: 'text', text: JSON.stringify(Object.assign({ success: !isError, tool: toolName }, parsed)) }];
        } catch (e) {
          return [{ type: 'text', text: JSON.stringify({
            success: !isError,
            tool: toolName,
            content: responseText,
            isError: isError || false
          }) }];
        }
      } catch (e) {
        return [{ type: 'text', text: JSON.stringify({
          success: false,
          tool: toolName,
          error: e.message
        }) }];
      }
    }
  };
}

// ============================================================
// 加载 MCP 配置并连接所有服务器
// ============================================================
async function loadMcpServers(toolRegistry, workspaceDir) {
  MCP_CONFIG_FILE = path.join(workspaceDir, 'config', 'mcp_servers.json');

  var config;
  try {
    var data = await fsp.readFile(MCP_CONFIG_FILE, 'utf-8');
    config = JSON.parse(data);
  } catch (e) {
    // 配置文件不存在，创建默认配置
    config = { servers: {} };
    try {
      await fsp.mkdir(path.dirname(MCP_CONFIG_FILE), { recursive: true });
      await fsp.writeFile(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log('[MCP] 已创建默认配置: ' + MCP_CONFIG_FILE);
    } catch (writeErr) {
      console.warn('[MCP] 无法创建配置文件:', writeErr.message);
    }
    return [];
  }

  var servers = config.servers || {};
  var serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    console.log('[MCP] 无 MCP 服务器配置');
    return [];
  }

  console.log('[MCP] 发现 ' + serverNames.length + ' 个 MCP 服务器配置');

  var allRegistered = [];
  for (var i = 0; i < serverNames.length; i++) {
    var name = serverNames[i];
    var serverConfig = servers[name];

    // 跳过禁用的服务器
    if (serverConfig.enabled === false) {
      console.log('[MCP] 跳过禁用的服务器: ' + name);
      continue;
    }

    try {
      await connectMcpServer(name, serverConfig);
      var tools = await discoverAndRegisterTools(toolRegistry, name);
      allRegistered = allRegistered.concat(tools);
    } catch (e) {
      console.error('[MCP] 服务器 ' + name + ' 连接失败，跳过: ' + e.message);
    }
  }

  return allRegistered;
}

// ============================================================
// 断开所有 MCP 连接
// ============================================================
function disconnectAll() {
  var names = Object.keys(mcpConnections);
  for (var i = 0; i < names.length; i++) {
    try {
      mcpConnections[names[i]].connection.stop();
      console.log('[MCP] 已断开: ' + names[i]);
    } catch (e) {}
  }
  mcpConnections = {};
  registeredMcpTools = [];
}

// ============================================================
// 获取 MCP 状态
// ============================================================
function getStatus() {
  var servers = [];
  var names = Object.keys(mcpConnections);
  for (var i = 0; i < names.length; i++) {
    var conn = mcpConnections[names[i]];
    servers.push({
      name: names[i],
      connected: conn.connection.isConnected(),
      serverInfo: conn.serverInfo,
      transport: conn.config.transport || 'stdio'
    });
  }
  return {
    servers: servers,
    totalTools: registeredMcpTools.length,
    toolNames: registeredMcpTools.slice()
  };
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  loadMcpServers: loadMcpServers,
  disconnectAll: disconnectAll,
  getStatus: getStatus,
  connectMcpServer: connectMcpServer,
  discoverAndRegisterTools: discoverAndRegisterTools
};
