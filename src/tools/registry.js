var __toolRegistry = {};

function registerTool(name, handler, description) {
  __toolRegistry[name] = { handler: handler, description: description || name };
}

function getToolHandler(name) {
  var entry = __toolRegistry[name];
  return entry ? entry.handler : null;
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

function buildSystemPrompt() {
  var list = getToolList();
  var prompt = '## 可用工具\n';
  prompt += JSON.stringify(list.map(function(t) {
    return { name: t.name, description: t.description };
  })) + '\n\n';
  prompt += '## 调用格式\n';
  prompt += '<tool_call name="工具名">\n{"参数名":"参数值"}\n</tool_call\n\n';
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
