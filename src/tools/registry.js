var __toolRegistry = {};

// ╔══════════════════════════════════════════════════════════════╗
// ║ TOOL_DEFINITIONS — 必须与以下文件保持同步:                    ║
// ║   • src/background.js (Service Worker)                      ║
// ║   • src/injected.js (MAIN World)                            ║
// ║   • src/tools/registry.js (ISOLATED World)                  ║
// ║ 修改时请同步更新所有三处！                                     ║
// ╚══════════════════════════════════════════════════════════════╝
var TOOL_DEFINITIONS = [
  { name: "read_file", description: "读取本地文件的内容", parameters: { path: "文件的绝对路径 (string)" } },
  { name: "write_file", description: "写入内容到本地文件（不存在则创建，存在则覆盖）", parameters: { path: "文件的绝对路径 (string)", content: "要写入的文件内容 (string)" } },
  { name: "list_dir", description: "列出指定目录下的所有文件和子目录", parameters: { path: "目录的绝对路径 (string)" } },
  { name: "exec_command", description: "在 Windows 系统上执行一条 cmd 命令并返回输出结果", parameters: { command: "要执行的命令 (string)" } },
  { name: "append_file", description: "追加内容到本地文件末尾", parameters: { path: "文件的绝对路径 (string)", content: "要追加的内容 (string)" } },
  { name: "search_files", description: "在指定目录中搜索文件名匹配模式的文件", parameters: { pattern: "文件名的通配符模式 (string)", root: "搜索的根目录 (string)" } },
  { name: "get_file_info", description: "获取文件的详细信息（大小、修改时间等）", parameters: { path: "文件的绝对路径 (string)" } }
];

function registerTool(name, handler, description) {
  __toolRegistry[name] = { handler: handler, description: description || name };
}

function getToolHandler(name) {
  var entry = __toolRegistry[name];
  if (entry && entry.handler) {
    return entry.handler;
  }
  // 返回提示函数而非 null，避免 TypeError
  return function() {
    console.warn('[ToolRegistry] 工具 "' + name + '" 需要通过服务端执行');
    return null;
  };
}

function getToolList() {
  var list = [];
  for (var key in __toolRegistry) {
    if (__toolRegistry.hasOwnProperty(key)) {
      list.push({ name: key, description: __toolRegistry[key].description });
    }
  }
  return list;
}

// buildSystemPrompt 也定义在 background.js (Service Worker) 和 injected.js (MAIN World) — 必须保持同步
function buildSystemPrompt() {
  var prompt = '## 可用工具\n';
  prompt += JSON.stringify(TOOL_DEFINITIONS.map(function(t) {
    return { name: t.name, description: t.description, parameters: t.parameters };
  })) + '\n\n';
  prompt += '## 调用格式\n';
  prompt += '<tool_call name="工具名">\n{"参数名":"参数值"}\n</tool_call">\n\n';
  prompt += '## 规则\n';
  prompt += '1. 可以连续调用多个工具\n';
  prompt += '2. 工具调用会按顺序执行，结果会按顺序返回\n';
  prompt += '3. 路径请使用绝对路径\n';
  prompt += '4. 不需要工具时直接回答\n\n';
  prompt += '## 错误处理\n';
  prompt += '- 工具执行失败时会返回错误信息\n';
  prompt += '- 若某个工具执行失败，请分析错误原因后尝试其他替代方案完成任务';
  return prompt;
}
