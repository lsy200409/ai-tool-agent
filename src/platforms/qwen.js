/**
 * 通义千问 平台适配器
 */
(function() {
  var qwenAdapter = {
    id: 'qwen',
    name: '通义千问',
    hostPattern: /tongyi\.aliyun\.com|qianwen\.aliyun\.com|qianwen\.com/,

    sse: {
      apiPattern: /chat\/completions|\/api\/v[12]\/chat|chat2-api\.qianwen/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // OpenAI 兼容格式: choices[0].delta.content
        if (chunk.choices && chunk.choices.length > 0) {
          var delta = chunk.choices[0].delta;
          if (delta && delta.content) return delta.content;
        }
        // 国内版: data.messages[].content (累积文本)
        if (chunk.data && chunk.data.messages) {
          var msgs = chunk.data.messages;
          if (msgs.length > 0 && msgs[msgs.length-1].content) {
            return msgs[msgs.length-1].content;
          }
        }
        // 备选字段
        if (chunk.text) return chunk.text;
        if (chunk.content) return chunk.content;
        if (chunk.delta) return chunk.delta;
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        if (chunk.choices && chunk.choices.length > 0) {
          var fr = chunk.choices[0].finish_reason;
          if (fr) return fr;
        }
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        return null;
      },

      binaryStream: false,
      // 国内版 data.messages 是累积文本，需要特殊处理
      cumulativeContent: true
    },

    dom: {
      chatInputSelectors: [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][placeholder*="千问"]',
        'div[contenteditable="true"][placeholder*="通义"]',
        'div[contenteditable="true"]',
        'textarea[placeholder*="千问"]',
        'textarea[placeholder*="通义"]',
        'textarea',
        '[role="textbox"]'
      ],

      findSendButton: function() {
        // 通义千问：class含 cursor-not-allowed 表示禁用状态，输入后才可点击
        var btns = document.querySelectorAll('button');
        // 优先找含 svg 且在输入框附近的 button
        var input = document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (input) {
          var walk = input.parentElement;
          for (var k = 0; k < 5; k++) {
            if (!walk) break;
            var btns2 = walk.querySelectorAll('button');
            for (var j = 0; j < btns2.length; j++) {
              var b = btns2[j];
              if (b.clientHeight > 0 && b.querySelector('svg')) {
                b.setAttribute('data-ds-send-btn', 'qwen-send');
                return b;
              }
            }
            walk = walk.parentElement;
          }
        }
        // 备选：所有 button 中有 svg 的
        for (var i = 0; i < btns.length; i++) {
          var b = btns[i];
          if (b.clientHeight > 0 && b.querySelector('svg') && b.getAttribute('type') !== 'button') {
            return b;
          }
        }
        return null;
      },

      aiMessageSelectors: [
        'div[class*="text-assistant"]',
        'div[class*="assistant-message"]',
        'div[class*="markdown-body"]',
        'div[class*="message-content"]',
        'div[class*="markdown"]',
        'div[class*="answer"]',
        'div[class*="response"]'
      ],
      thinkContentSelector: '[class*="think-content"], [class*="thinking-content"]',
      userMessageSelector: '[class*="user-message"], [class*="human-message"], [class*="text-user"]',

      isUserMessage: function(el) {
        if (el.getAttribute('data-role') === 'user') return true;
        if (el.getAttribute('data-author') === 'user') return true;
        var cls = (el.className || '');
        if (typeof cls === 'string') {
          if (cls.indexOf('user-message') >= 0 || cls.indexOf('human-message') >= 0) return true;
          if (cls.indexOf('text-user') >= 0) return true;
          if (cls.indexOf('assistant') >= 0 || cls.indexOf('bot') >= 0 || cls.indexOf('ai') >= 0) return false;
        }
        return false;
      },

      detectStreaming: function() {
        var stopBtn = document.querySelector('button[aria-label*="stop" i], button[aria-label*="停止" i], [class*="stop-button"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        // 通义千问：输入框附近有 disabled 的发送按钮表示正在流式
        var input = document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (input) {
          var walk = input.parentElement;
          for (var k = 0; k < 5; k++) {
            if (!walk) break;
            var btn = walk.querySelector('button[disabled], button.cursor-not-allowed');
            if (btn && btn.querySelector('svg')) return true;
            walk = walk.parentElement;
          }
        }
        return false;
      }
    },

    setInputValue: function(element, value) {
      // 通义千问也是 contenteditable div
      element.focus();
      try {
        // 使用 Range + Selection 插入文本，模拟用户输入
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        // 直接清空 innerHTML
        element.innerHTML = '';
        // 把多行文本转为 <br> 分割
        var lines = value.split('\n');
        for (var i = 0; i < lines.length; i++) {
          if (i > 0) element.appendChild(document.createElement('br'));
          element.appendChild(document.createTextNode(lines[i]));
        }
      } catch(e) {
        element.textContent = value;
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      if (btn && !btn.disabled) { btn.click(); return true; }
      // fallback: Enter
      var input = typeof findChatInput === 'function' ? findChatInput() : null;
      if (!input) return false;
      input.focus();
      var evt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      input.dispatchEvent(new KeyboardEvent('keydown', evt));
      input.dispatchEvent(new KeyboardEvent('keypress', evt));
      input.dispatchEvent(new KeyboardEvent('keyup', evt));
      return true;
    }
  };

  PlatformRegistry.register(qwenAdapter);
})();
