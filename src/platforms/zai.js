/**
 * 智谱国际版 (z.ai) 平台适配器
 */
(function() {
  var zaiAdapter = {
    id: 'zai',
    name: '智谱国际版',
    hostPattern: /chat\.z\.ai|z\.ai/,

    sse: {
      // z.ai 使用 OpenAI 兼容 API
      apiPattern: /chat\/completions|\/api\/chat\/completion|api\.z\.ai/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // OpenAI 兼容格式
        if (chunk.choices && chunk.choices.length > 0) {
          var delta = chunk.choices[0].delta;
          if (delta) {
            if (delta.content) return delta.content;
          }
          // finish_reason
          if (chunk.choices[0].finish_reason) return null;
        }
        // 智谱原生格式
        if (chunk.parts && chunk.parts.length > 0) {
          var texts = [];
          for (var i = 0; i < chunk.parts.length; i++) {
            var part = chunk.parts[i];
            if (part.content && Array.isArray(part.content)) {
              for (var j = 0; j < part.content.length; j++) {
                if (part.content[j].type === 'text' && part.content[j].text) {
                  texts.push(part.content[j].text);
                }
              }
            }
          }
          if (texts.length > 0) return texts.join('');
        }
        if (chunk.text) return chunk.text;
        if (chunk.delta) return chunk.delta;
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        // OpenAI 格式
        if (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].finish_reason) {
          return chunk.choices[0].finish_reason;
        }
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        return null;
      },

      binaryStream: false,
      cumulativeContent: false
    },

    dom: {
      chatInputSelectors: [
        'textarea#chat-input',
        'textarea[placeholder*="帮您"]',
        'textarea[placeholder*="help"]',
        'textarea',
        'div[contenteditable="true"]'
      ],

      findSendButton: function() {
        // z.ai: 发送按钮 id="send-message-button"
        var sendBtn = document.getElementById('send-message-button');
        if (sendBtn && sendBtn.clientHeight > 0) return sendBtn;
        // class 查找
        var btns = document.querySelectorAll('button.sendMessageButton, button[type="submit"]');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].clientHeight > 0 && btns[i].id === 'send-message-button') return btns[i];
        }
        // 备选：在 textarea 附近查找 submit 按钮
        var textarea = document.querySelector('textarea#chat-input');
        if (textarea) {
          var walk = textarea.parentElement;
          for (var j = 0; j < 5; j++) {
            if (!walk) break;
            var submitBtns = walk.querySelectorAll('button[type="submit"]');
            for (var k = 0; k < submitBtns.length; k++) {
              if (submitBtns[k].clientHeight > 0) return submitBtns[k];
            }
            walk = walk.parentElement;
          }
        }
        return null;
      },

      aiMessageSelectors: [
        '[class*="assistant"]',
        '[class*="bot-message"]',
        '[data-role="assistant"]',
        'div[class*="markdown"]',
        'div[class*="message-content"]'
      ],
      thinkContentSelector: '[class*="think"], [class*="reasoning"]',
      userMessageSelector: '[class*="user-message"], [data-role="user"]',

      isUserMessage: function(el) {
        if (el.getAttribute('data-role') === 'user') return true;
        var cls = (el.className || '');
        if (cls.indexOf('user-message') >= 0 || cls.indexOf('user') >= 0) return true;
        if (cls.indexOf('assistant') >= 0 || cls.indexOf('bot') >= 0) return false;
        return false;
      },

      detectStreaming: function() {
        // z.ai: 发送按钮变为灰色/不可用时表示正在生成
        var sendBtn = document.getElementById('send-message-button');
        if (sendBtn) {
          var cls = sendBtn.className || '';
          // 发送按钮有 disabled 样式时表示正在生成
          if (cls.indexOf('bg-[#E0E0E0]') >= 0 || cls.indexOf('text-[#110F0F]/20') >= 0) {
            // 按钮是灰色 = 正在生成
            // 但初始状态也是灰色... 需要更精确的判断
          }
        }
        // 检查是否有停止按钮
        var stopBtn = document.querySelector('button[aria-label*="stop" i], button[aria-label*="Stop" i], button[class*="stop"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        return false;
      }
    },

    setInputValue: function(element, value) {
      // z.ai 使用 textarea
      element.focus();
      element.select();
      document.execCommand('delete', false, null);
      var ok = document.execCommand('insertText', false, value);
      if (!ok) {
        // fallback: 原生 setter
        try {
          var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(element, value);
          else element.value = value;
        } catch(e) { element.value = value; }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      if (btn) { btn.click(); return true; }
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

  PlatformRegistry.register(zaiAdapter);
})();
