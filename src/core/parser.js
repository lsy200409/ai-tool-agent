function parseToolCallContent(raw, defaultName) {
  var content = raw.trim();
  try {
    var obj = JSON.parse(content);
    if (obj.name && typeof obj.name === 'string') return { tool: obj.name, parameters: obj.arguments || {} };
    if (obj.tool && typeof obj.tool === 'string') return { tool: obj.tool, parameters: obj.parameters || {} };
    if (defaultName) return { tool: defaultName, parameters: obj };
    return null;
  } catch (e) {
    var opens = (content.match(/\{/g) || []).length;
    var closes = (content.match(/\}/g) || []).length;
    if (opens > closes) {
      try {
        var obj2 = JSON.parse(content + '}'.repeat(opens - closes));
        if (obj2.name) return { tool: obj2.name, parameters: obj2.arguments || {} };
        if (obj2.tool) return { tool: obj2.tool, parameters: obj2.parameters || {} };
        if (defaultName) return { tool: defaultName, parameters: obj2 };
      } catch(e2) {}
    }
    return null;
  }
}

function extractToolCall(text) {
  var tagMatch = /<tool_call\s+([^>]*)>/i.exec(text);
  if (!tagMatch) return null;
  var attrStr = tagMatch[1];
  var nameMatch = attrStr.match(/name\s*=\s*"([^"]*)"/);
  var toolName = nameMatch ? nameMatch[1] : null;
  var contentMatch = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/i.exec(text);
  if (!contentMatch) return null;
  return parseToolCallContent(contentMatch[1], toolName);
}

function extractAllToolCalls(text) {
  var results = [];
  var regex = /<tool_call[\s\S]*?<\/tool_call>/gi;
  var matches = text.match(regex) || [];
  for (var i = 0; i < matches.length; i++) {
    var parsed = extractToolCall(matches[i]);
    if (parsed) {
      results.push({ rawTag: matches[i], name: parsed.tool, arguments: parsed.parameters, index: i });
    }
  }
  return results;
}
