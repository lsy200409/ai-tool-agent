/**
 * ChatGPT 平台适配器
 */
(function() {
  var chatgptAdapter = {
    id: 'chatgpt',
    name: 'ChatGPT',
    hostPattern: /chatgpt\.com|chat\.openai\.com/,

    sse: {
      apiPattern: /backend-api\/conversation/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // ChatGPT 格式: message.content.parts[0] 是累积完整文本
        if (chunk.message && chunk.message.content && chunk.message.content.parts) {
          var parts = chunk.message.content.parts;
          if (parts.length > 0) {
            var text = parts[0];
            if (typeof text === 'object' && text.text) text = text.text;
            if (typeof text === 'string') return text; // 注意：这是累积文本，不是增量
          }
        }
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        // ChatGPT 不使用 finish_reason，通过 [DONE] 标记结束
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        return null;
      },

      binaryStream: false,

      // ChatGPT 的 content 是累积的，需要特殊处理
      cumulativeContent: true
    },

    dom: {
      chatInputSelectors: [
        '#prompt-textarea',
        'textarea[placeholder]',
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],

      findSendButton: function() {
        // ChatGPT 使用 data-testid
        var btn = document.querySelector('[data-testid="send-button"]');
        if (btn && btn.clientHeight > 0) return btn;
        btn = document.querySelector('button[aria-label="Send message"]');
        if (btn && btn.clientHeight > 0) return btn;
        btn = document.querySelector('button[aria-label="Send prompt"]');
        if (btn && btn.clientHeight > 0) return btn;
        return null;
      },

      aiMessageSelectors: [
        'div[data-message-author-role="assistant"]',
        '[data-testid^="conversation-turn-"]'
      ],
      thinkContentSelector: '',  // ChatGPT 没有思考内容折叠
      userMessageSelector: '[data-testid^="conversation-turn-"]',

      isUserMessage: function(el) {
        // 优先检查 data-message-author-role 属性
        var role = el.getAttribute('data-message-author-role');
        if (role === 'user') return true;
        if (role === 'assistant') return false;
        // 奇数 turn 为 user，偶数 turn 为 assistant
        var testId = el.getAttribute('data-testid') || '';
        var match = testId.match(/conversation-turn-(\d+)/);
        if (match) return parseInt(match[1]) % 2 === 1;
        return false;
      },

      detectStreaming: function() {
        // ChatGPT 流式输出时发送按钮变为停止按钮
        var stopBtn = document.querySelector('button[aria-label="Stop generating"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        stopBtn = document.querySelector('[data-testid="stop-button"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        return false;
      }
    },

    setInputValue: function(element, value) {
      element.focus();
      // ChatGPT 使用 React，需要用原生 setter
      try {
        var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLElement.prototype, 'value'
        ) || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        );
        if (nativeInputValueSetter && nativeInputValueSetter.set) {
          nativeInputValueSetter.set.call(element, value);
        } else {
          element.value = value;
        }
      } catch(e) {
        element.value = value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      if (!btn || btn.disabled) {
        // fallback: Enter 键（ChatGPT 支持 Enter 发送）
        var textarea = typeof findChatInput === 'function' ? findChatInput() : null;
        if (!textarea) return false;
        textarea.focus();
        var evt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        textarea.dispatchEvent(new KeyboardEvent('keydown', evt));
        textarea.dispatchEvent(new KeyboardEvent('keypress', evt));
        textarea.dispatchEvent(new KeyboardEvent('keyup', evt));
        return true;
      }
      btn.click();
      return true;
    }
  };

  PlatformRegistry.register(chatgptAdapter);
})();
