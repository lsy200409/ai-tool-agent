function parseToolCallContent(content, defaultName) {
  var text = (content || '').trim();

  // 尝试直接解析 JSON
  try {
    var obj = JSON.parse(text);
    if (obj.name && typeof obj.name === 'string') return { tool: obj.name, parameters: obj.arguments || {} };
    if (obj.tool && typeof obj.tool === 'string') return { tool: obj.tool, parameters: obj.parameters || {} };
    if (defaultName && typeof obj === 'object' && Object.keys(obj).length > 0) {
      return { tool: defaultName, parameters: obj };
    }
    if (defaultName) return { tool: defaultName, parameters: {} };
    return null;
  } catch (e) {}

  // 处理 JSON 截断 (常见于流式输出)
  var opens = (text.match(/\{/g) || []).length;
  var closes = (text.match(/\}/g) || []).length;
  if (opens > closes) {
    try {
      var fixed = JSON.parse(text + '}'.repeat(opens - closes));
      if (fixed.name) return { tool: fixed.name, parameters: fixed.arguments || {} };
      if (fixed.tool) return { tool: fixed.tool, parameters: fixed.parameters || {} };
      if (fixed.arguments) return { tool: defaultName, parameters: fixed.arguments };
      if (fixed.parameters) return { tool: defaultName, parameters: fixed.parameters };
      if (defaultName && typeof fixed === 'object' && Object.keys(fixed).length > 0) {
        return { tool: defaultName, parameters: fixed };
      }
    } catch (e2) {}
  }

  // 处理常见工具的 fallback
  if (defaultName) {
    if (defaultName === 'exec_command') {
      var cmdMatch = text.match(/"command"\s*:\s*"(.*?)"\s*[,\}]/);
      if (cmdMatch && cmdMatch[1]) return { tool: defaultName, parameters: { command: cmdMatch[1] } };
      return { tool: defaultName, parameters: { command: text.replace(/^["']|["']$/g, '') } };
    }
    if (defaultName === 'read_file' || defaultName === 'write_file' || defaultName === 'append_file' || defaultName === 'get_file_info') {
      var pathMatch = text.match(/"path"\s*:\s*"(.*?)"\s*[,\}]/);
      if (pathMatch && pathMatch[1]) return { tool: defaultName, parameters: { path: pathMatch[1] } };
    }
    if (defaultName === 'search_files') {
      var patternMatch = text.match(/"pattern"\s*:\s*"(.*?)"\s*[,\}]/);
      var rootMatch = text.match(/"root"\s*:\s*"(.*?)"\s*[,\}]/);
      if (patternMatch && patternMatch[1]) return { tool: defaultName, parameters: { pattern: patternMatch[1], root: rootMatch ? rootMatch[1] : '.' } };
    }
    return { tool: defaultName, parameters: {} };
  }

  return null;
}

function parseSingleCall(rawTag) {
  // 格式1: <tool_call name="tool_name">JSON</tool_call>
  var nameMatch = rawTag.match(/name\s*=\s*"([^"]*)"/i);
  var toolName = nameMatch ? nameMatch[1] : null;

  var contentMatch = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/i.exec(rawTag);
  if (contentMatch) {
    return parseToolCallContent(contentMatch[1], toolName);
  }

  // 格式2: <tool_name>JSON</tool_name> (DeepSeek++ 风格 fallback)
  var xmlNameMatch = rawTag.match(/^<\s*(\/{0,1})([a-zA-Z_][a-zA-Z0-9_]*)>/);
  if (xmlNameMatch) {
    var xmlName = xmlNameMatch[2];
    var isClosing = xmlNameMatch[1];
    if (!isClosing) {
      var closeTag = '<\/' + xmlName + '>';
      var xmlContentMatch = rawTag.match(new RegExp('<' + xmlName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '>([\\s\\S]*?)' + closeTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      if (xmlContentMatch) {
        return parseToolCallContent(xmlContentMatch[1], xmlName);
      }
    }
  }

  return null;
}

function parseToolCalls(text) {
  var results = [];
  // 主格式: <tool_call name="x">...</tool_call>
  var regex = /<tool_call[\s\S]*?<\/tool_call>/gi;
  var matches = text.match(regex) || [];

  for (var i = 0; i < matches.length; i++) {
    var parsed = parseSingleCall(matches[i]);
    if (parsed) {
      results.push({ rawTag: matches[i], name: parsed.tool, arguments: parsed.parameters, index: i });
    }
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseToolCallContent: parseToolCallContent, parseSingleCall: parseSingleCall, parseToolCalls: parseToolCalls };
}