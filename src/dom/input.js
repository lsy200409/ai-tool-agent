function findChatInput() {
  var selectors = [
    'textarea[name="search"]', 'textarea[placeholder*="DeepSeek"]',
    'textarea[placeholder*="发送"]', 'textarea[placeholder*="给"]',
    'textarea._27c9245', 'textarea[class*="ds-scroll-area"]',
    'textarea.ds-textarea', 'textarea:not([hidden])',
    'div[contenteditable="true"]', '[role="textbox"]'
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
  element.focus();
  try { element.value = ''; } catch(e) {}
  try { document.execCommand('selectAll'); } catch(e) {}
  try { document.execCommand('delete'); } catch(e) {}

  var setSuccess = false;

  try {
    var setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element) || window.HTMLTextAreaElement.prototype,
      'value'
    );
    if (setter && typeof setter.set === 'function') {
      setter.call(element, value);
      setSuccess = true;
    }
  } catch(e) {}

  if (!setSuccess) {
    try {
      element.value = value;
      setSuccess = true;
    } catch(e) {}
  }

  if (!setSuccess) {
    try {
      document.execCommand('insertText', false, value);
      setSuccess = true;
    } catch(e) {}
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  var nativeSet = new InputEvent('input', {
    bubbles: true, cancelable: true, composed: true,
    data: value, inputType: 'insertText'
  });
  element.dispatchEvent(nativeSet);
}

function findSendButton() {
  var all = document.querySelectorAll('[role="button"],button');
  for (var i = 0; i < all.length; i++) {
    var b = all[i];
    if ((b.innerHTML || '').toLowerCase().indexOf(ARROW_SVG_PATH) >= 0) return b;
  }
  return null;
}

function clickSendButton() {
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
