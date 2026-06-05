var __streamingCache = { ts: 0, result: false, prevIsArrow: true, justReturnedToArrow: false };

function detectStreaming() {
  var platform = getPlatform();

  // 优先使用平台特定的 detectStreaming
  if (platform && platform.dom && platform.dom.detectStreaming) {
    var result = platform.dom.detectStreaming();
    if (result !== null && result !== undefined) return result;
  }

  // Fallback: 通过发送按钮状态检测
  var now = Date.now();
  if (now - __streamingCache.ts < 300) return __streamingCache.result;
  var btn = findSendButton();
  if (!btn) {
    __streamingCache = { ts: now, result: false, prevIsArrow: false, justReturnedToArrow: false };
    return false;
  }
  var isArrow = (btn.innerHTML || '').toLowerCase().indexOf('m8.3125') >= 0;
  var wasArrow = __streamingCache.prevIsArrow;
  var justReturned = (wasArrow === false && isArrow === true);
  __streamingCache = { ts: now, result: !isArrow, prevIsArrow: isArrow, justReturnedToArrow: justReturned };
  return !isArrow;
}

function wasSendButtonJustReturnedToArrow() {
  return __streamingCache.justReturnedToArrow === true;
}

function getLatestAIMessageText() {
  var platform = getPlatform();
  var selectors = platform && platform.dom && platform.dom.aiMessageSelectors.length > 0
    ? platform.dom.aiMessageSelectors
    : ['div.ds-assistant-message-main-content']; // DeepSeek fallback

  var thinkSelector = platform && platform.dom && platform.dom.thinkContentSelector
    ? platform.dom.thinkContentSelector
    : '.ds-think-content';

  var els = document.querySelectorAll(selectors.join(','));
  var candidates = [];

  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (thinkSelector && el.closest(thinkSelector)) continue;
    var txt = (el.innerText || el.textContent || '').trim();
    if (txt.indexOf('## 环境') >= 0 || txt.indexOf('## 可用工具') >= 0) continue;
    if (txt.length > 0) candidates.push({ txt: txt, idx: i });
  }

  if (candidates.length === 0) return '';

  if (candidates.length === 1) return candidates[0].txt;

  var best = candidates[candidates.length - 1].txt;

  if (best.indexOf('<tool_call') >= 0 || best.indexOf('<tool_response') >= 0) {
    return best;
  }

  for (var j = candidates.length - 2; j >= 0; j--) {
    var prev = candidates[j].txt;
    if (prev.indexOf('<tool_call') >= 0 || prev.indexOf('<tool_response') >= 0) {
      if (best.indexOf(prev) >= 0) {
        return prev;
      }
      return best;
    }
  }

  return best;
}

function getLatestUserMessageText() {
  var platform = getPlatform();
  var userSelector = platform && platform.dom && platform.dom.userMessageSelector
    ? platform.dom.userMessageSelector
    : 'div.ds-message';

  var thinkSelector = platform && platform.dom && platform.dom.thinkContentSelector
    ? platform.dom.thinkContentSelector
    : '.ds-think-content';

  var isUserMsg = platform && platform.dom && platform.dom.isUserMessage
    ? platform.dom.isUserMessage
    : function(el) { return !el.querySelector('.ds-assistant-message-main-content'); };

  var all = document.querySelectorAll(userSelector);
  var last = '';
  for (var i = 0; i < all.length; i++) {
    if (isUserMsg(all[i])) {
      if (thinkSelector && all[i].querySelector(thinkSelector)) continue;
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
