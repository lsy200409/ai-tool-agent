// 获取当前平台适配器
function getPlatform() {
  return (typeof PlatformRegistry !== 'undefined' && PlatformRegistry.getCurrent()) || null;
}

function findChatInput() {
  var platform = getPlatform();
  var selectors = platform && platform.dom && platform.dom.chatInputSelectors.length > 0
    ? platform.dom.chatInputSelectors
    : [
      // 通用 fallback 选择器
      'textarea[name="search"]',
      'textarea[placeholder*="DeepSeek"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="给"]',
      'textarea[placeholder*="输入"]',
      '#prompt-textarea',
      'textarea:not([hidden])',
      'div[contenteditable="true"]',
      '[role="textbox"]'
    ];

  for (var i = 0; i < selectors.length; i++) {
    var els = document.querySelectorAll(selectors[i]);
    for (var j = 0; j < els.length; j++) {
      var el = els[j];
      var style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0) return el;
    }
  }
  var fallback = document.querySelector('textarea');
  if (fallback && fallback.clientHeight > 0) return fallback;
  return null;
}

function setInputValue(element, value) {
  var platform = getPlatform();
  if (platform && platform.setInputValue) {
    platform.setInputValue(element, value);
    return;
  }

  // 通用 fallback
  element.focus();
  try { element.value = ''; } catch(e) {}
  try { document.execCommand('selectAll'); } catch(e) {}
  try { document.execCommand('delete'); } catch(e) {}
  try {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(element, value);
    else element.value = value;
  } catch(e) { element.value = value; }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function findSendButton() {
  var platform = getPlatform();

  // 优先使用平台特定的 findSendButton
  if (platform && platform.dom && platform.dom.findSendButton) {
    var btn = platform.dom.findSendButton();
    if (btn) return btn;
  }

  // 通用 fallback
  var all = document.querySelectorAll('[role="button"],button');
  for (var i = 0; i < all.length; i++) {
    var b = all[i];
    if (b.clientHeight <= 0 || b.offsetParent === null) continue;
    var html = (b.innerHTML || '').toLowerCase();
    // DeepSeek SVG 箭头
    if (html.indexOf('m8.3125') >= 0) { b.setAttribute('data-ds-send-btn', 'arrow'); return b; }
    if (html.indexOf('<rect') >= 0) { b.setAttribute('data-ds-send-btn', 'stop'); return b; }
  }

  // 输入框附近查找
  var input = findChatInput();
  if (input) {
    var walk = input.parentElement;
    for (var k = 0; k < 5; k++) {
      if (!walk) break;
      var btns = walk.querySelectorAll('button, [role="button"]');
      for (var j = 0; j < btns.length; j++) {
        var b2 = btns[j];
        if (b2.clientHeight > 0 && b2.offsetParent !== null) {
          b2.setAttribute('data-ds-send-btn', 'fallback');
          return b2;
        }
      }
      walk = walk.parentElement;
    }
  }
  return null;
}

function clickSendButton() {
  var platform = getPlatform();
  if (platform && platform.sendMessage) {
    var result = platform.sendMessage();
    if (result) return true;
  }

  var btn = findSendButton();
  if (!btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled) {
    return pressEnterToSend();
  }
  btn.focus();
  btn.click();
  var rect = btn.getBoundingClientRect();
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
  return true;
}

function pressEnterToSend() {
  var textarea = findChatInput();
  if (!textarea) return false;
  textarea.focus();
  var evt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
  textarea.dispatchEvent(new KeyboardEvent('keydown', evt));
  textarea.dispatchEvent(new KeyboardEvent('keypress', evt));
  textarea.dispatchEvent(new KeyboardEvent('keyup', evt));
  return true;
}

async function waitForChatInput() {
  for (var i = 0; i < 20; i++) {
    if (findChatInput()) return true;
    await sleep(500);
  }
  return false;
}
