// ============================================================
// MCP 测试服务器 — 模拟 OpenClaw 兼容的 MCP 工具服务器
// 通过 stdio 传输 JSON-RPC 2.0 消息
// ============================================================

var readline = require('readline');

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// MCP 工具定义
var TOOLS = [
  {
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' },
        unit: { type: 'string', description: '温度单位 (celsius/fahrenheit)', enum: ['celsius', 'fahrenheit'] }
      },
      required: ['city']
    }
  },
  {
    name: 'calculate',
    description: '执行数学计算',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '数学表达式' }
      },
      required: ['expression']
    }
  },
  {
    name: 'list_files',
    description: '列出目录中的文件',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' },
        pattern: { type: 'string', description: '文件匹配模式' }
      },
      required: ['path']
    },
    annotations: { readOnlyHint: true }
  }
];

// 处理 JSON-RPC 请求
function handleRequest(request) {
  var id = request.id;
  var method = request.method;
  var params = request.params || {};

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'mcp-test-server',
          version: '1.0.0'
        }
      });
      break;

    case 'notifications/initialized':
      // 通知，不需要响应
      break;

    case 'tools/list':
      sendResponse(id, { tools: TOOLS });
      break;

    case 'tools/call':
      handleToolCall(id, params);
      break;

    default:
      sendResponse(id, null, { code: -32601, message: 'Method not found: ' + method });
  }
}

function handleToolCall(id, params) {
  var toolName = params.name;
  var args = params.arguments || {};

  switch (toolName) {
    case 'get_weather':
      var city = args.city || 'unknown';
      var unit = args.unit || 'celsius';
      var temp = unit === 'fahrenheit' ? 72 : 22;
      sendResponse(id, {
        content: [
          { type: 'text', text: JSON.stringify({ city: city, temperature: temp, unit: unit, condition: 'sunny', humidity: '45%' }) }
        ],
        isError: false
      });
      break;

    case 'calculate':
      var expr = args.expression || '0';
      var result;
      try {
        // 安全的数学计算（仅允许数字和运算符）
        var safe = expr.replace(/[^0-9+\-*/.() ]/g, '');
        result = Function('"use strict"; return (' + safe + ')')();
      } catch (e) {
        result = 'Error: ' + e.message;
      }
      sendResponse(id, {
        content: [
          { type: 'text', text: JSON.stringify({ expression: expr, result: result }) }
        ],
        isError: false
      });
      break;

    case 'list_files':
      sendResponse(id, {
        content: [
          { type: 'text', text: JSON.stringify({ path: args.path, files: ['file1.txt', 'file2.js', 'README.md'] }) }
        ],
        isError: false
      });
      break;

    default:
      sendResponse(id, {
        content: [
          { type: 'text', text: 'Unknown tool: ' + toolName }
        ],
        isError: true
      });
  }
}

function sendResponse(id, result, error) {
  var response = { jsonrpc: '2.0', id: id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}

rl.on('line', function(line) {
  try {
    var request = JSON.parse(line.trim());
    handleRequest(request);
  } catch (e) {
    // 忽略无效输入
  }
});

// 通知父进程已就绪
process.stderr.write('[mcp-test-server] Ready\n');
