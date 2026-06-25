/**
 * Qwen 国际版 (chat.qwen.ai) 平台适配器
 * 与国内版（qianwen.com/tongyi）结构不同，独立适配
 */
(function() {
  var qwenIntlAdapter = {
    id: 'qwen-intl',
    name: 'Qwen国际版',
    hostPattern: /chat\.qwen\.ai/,

    sse: {
      // Qwen 国际版使用标准 OpenAI 兼容格式
      apiPattern: /\/api\/v2\/chat\/completions|chat\/completions/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // OpenAI 兼容格式: choices[0].delta.content
        if (chunk.choices && chunk.choices.length > 0) {
          var delta = chunk.choices[0].delta;
          if (delta && delta.content) return delta.content;
        }
        // 备选字段
        if (chunk.text) return chunk.text;
        if (chunk.content) return chunk.content;
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

      binaryStream: false
    },

    dom: {
      chatInputSelectors: [
        'textarea.message-input-textarea',
        'textarea[placeholder*="帮您"]',
        'textarea[placeholder*="Qwen"]',
        '.message-input textarea',
        'textarea',
        'div[contenteditable="true"]'
      ],

      findSendButton: function() {
        // Qwen国际版：内层 button.send-button
        var sendBtn = document.querySelector('button.send-button');
        if (sendBtn && sendBtn.clientHeight > 0) {
          sendBtn.setAttribute('data-ds-send-btn', 'qwen-intl-send-btn');
          return sendBtn;
        }
        // 外层 div
        sendBtn = document.querySelector('.message-input-right-button-send');
        if (sendBtn && sendBtn.clientHeight > 0) {
          // 优先返回内层 button
          var innerBtn = sendBtn.querySelector('button');
          if (innerBtn && innerBtn.clientHeight > 0) return innerBtn;
          sendBtn.setAttribute('data-ds-send-btn', 'qwen-intl-send');
          return sendBtn;
        }
        // 备选
        sendBtn = document.querySelector('.message-input-right-button');
        if (sendBtn && sendBtn.clientHeight > 0) {
          var innerBtn2 = sendBtn.querySelector('button');
          if (innerBtn2 && innerBtn2.clientHeight > 0) return innerBtn2;
          return sendBtn;
        }
        // 备选：含 send 字样的button
        var btns = document.querySelectorAll('button[class*="send"]');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].clientHeight > 0) return btns[i];
        }
        return null;
      },

      aiMessageSelectors: [
        '.qwen-chat-message',
        'div[class*="chat-message"]',
        'div[class*="markdown-body"]',
        'div[class*="message-content"]',
        'div[class*="markdown"]',
        'div[class*="response"]'
      ],
      thinkContentSelector: '.qwen-chat-think, [class*="think-content"]',
      userMessageSelector: '.qwen-chat-message-user, [class*="user-message"]',

      isUserMessage: function(el) {
        if (el.getAttribute('data-role') === 'user') return true;
        var cls = (el.className || '');
        if (cls.indexOf('qwen-chat-message-user') >= 0) return true;
        if (cls.indexOf('user-message') >= 0) return true;
        if (cls.indexOf('qwen-chat-message-assistant') >= 0) return false;
        if (cls.indexOf('assistant') >= 0) return false;
        return false;
      },

      detectStreaming: function() {
        var stopBtn = document.querySelector('button[class*="stop"], button[aria-label*="stop" i], [class*="stop-button"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        return false;
      }
    },

    setInputValue: function(element, value) {
      // Qwen国际版使用 textarea
      // 原生 setter 优先（execCommand('insertText') 对长文本静默失败）
      element.focus();
      try {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(element, value);
        else element.value = value;
      } catch(e) { element.value = value; }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      // 千问国际版的发送按钮可能是 div，用 class 判断 disabled
      var isDisabled = btn && (btn.disabled || btn.classList.contains('disabled') || btn.classList.contains('cursor-not-allowed'));
      if (btn && !isDisabled) { btn.click(); return true; }
      var input = typeof findChatInput === 'function' ? findChatInput() : null;
      return PlatformAdapter.sendMessageFallback(input);
    }
  };

  PlatformRegistry.register(qwenIntlAdapter);
})();
