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
  // DeepSeek 真实 DOM: AI回复主内容在 div.ds-assistant-message-main-content 中
  // 思考过程在普通 div.ds-markdown 中，我们取最后一个有 main-content 的
  var els = document.querySelectorAll('div.ds-assistant-message-main-content');
  var best = '';
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.closest('.ds-think-content')) continue;
    var txt = (el.innerText || el.textContent || '').trim();
    if (txt.indexOf('## 环境') >= 0 || txt.indexOf('## 可用工具') >= 0) continue;
    if (txt.length > 0) best = txt;
  }
  return best;
}

function getLatestUserMessageText() {
  var all = document.querySelectorAll('div.ds-message');
  var last = '';
  for (var i = 0; i < all.length; i++) {
    if (!all[i].querySelector('.ds-assistant-message-main-content')) {
      if (all[i].querySelector('.ds-think-content')) continue;
      var txt = (all[i].innerText || all[i].textContent || '').trim();
      if (txt.indexOf('<tool_response') >= 0) continue;
      if (txt.indexOf('原始任务:') >= 0) continue;
      if (txt.indexOf('正在思考') === 0) continue;
      if (txt.length > 0) last = txt;
    }
  }
  return last;
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
