var __streamingCache = { ts: 0, result: false, prevIsArrow: true, justReturnedToArrow: false };

function detectStreaming() {
  var now = Date.now();
  if (now - __streamingCache.ts < 300) return __streamingCache.result;
  var btn = findSendButton();
  if (!btn) {
    __streamingCache = { ts: now, result: false, prevIsArrow: false, justReturnedToArrow: false };
    return false;
  }
  var isArrow = (btn.innerHTML || '').toLowerCase().indexOf(ARROW_SVG_PATH) >= 0;
  var wasArrow = __streamingCache.prevIsArrow;
  var justReturned = (wasArrow === false && isArrow === true);
  __streamingCache = { ts: now, result: !isArrow, prevIsArrow: isArrow, justReturnedToArrow: justReturned };
  return !isArrow;
}

function wasSendButtonJustReturnedToArrow() {
  return __streamingCache.justReturnedToArrow === true;
}

function getLatestAIMessageText() {
  // 仅选取 assistant 类型的消息，排除用户消息和系统提示
  var sel = '[data-role="assistant"],div[class*="ds-message"][class*="assistant"],div.ds-markdown';
  var els = document.querySelectorAll(sel);
  var best = '';
  for (var i = 0; i < els.length; i++) {
    var txt = (els[i].innerText || els[i].textContent || '').trim();
    // 跳过系统提示词（包含 ## 环境、## 可用工具 等内容）
    if (txt.indexOf('## 环境') >= 0 || txt.indexOf('## 可用工具') >= 0) continue;
    if (txt.length > 20) best = txt;
  }
  // 备用：如果上面的选择器没找到，从 body innerText 截取最后一段
  if (best.length < 30) {
    var bodyText = (document.body.innerText || '').trim();
    var lines = bodyText.split('\n');
    var parts = [];
    for (var j = lines.length - 1; j >= 0 && parts.length < 50; j--) {
      if (lines[j].trim() && lines[j].indexOf('## ') !== 0) parts.unshift(lines[j]);
    }
    if (parts.length > 10) best = parts.join('\n');
  }
  return best;
}

function aiAlreadyRepliedAfterToolCall() {
  var latestMsg = getLatestAIMessageText();
  logPanel('info', '🔍 检测AI是否自行回复: AI消息长度=' + latestMsg.length);

  if (!latestMsg || latestMsg.length < 30) {
    logPanel('info', '  → AI消息为空或过短，未自行回复');
    return false;
  }

  // 检查最后一个 </tool_call> 之后是否有内容
  var closeIdx = latestMsg.lastIndexOf('</tool_call>');
  if (closeIdx < 0) {
    logPanel('info', '  → 无 </tool_call> 标签，未自行回复');
    return false;
  }

  var afterTag = latestMsg.substring(closeIdx + 12).trim();
  logPanel('info', '  → </tool_call> 之后内容长度=' + afterTag.length + ' 预览="' + afterTag.substring(0, 100) + '"');

  if (afterTag.length > 20) {
    logPanel('info', '  ✅ AI 已自行回复，跳过回填');
    return true;
  }

  logPanel('info', '  → AI 尚未自行回复（tool_call 后内容不足20字）');
  return false;
}
