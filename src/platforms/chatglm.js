/**
 * 智谱 ChatGLM 平台适配器
 */
(function() {
  var chatglmAdapter = {
    id: 'chatglm',
    name: '智谱ChatGLM',
    hostPattern: /chatglm\.cn|chat\.glm\.cn/,

    sse: {
      apiPattern: /backend-api\/assistant\/stream/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // 新格式: parts[].content[].text (累积)
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
        // 旧格式
        if (chunk.text) return chunk.text;
        if (chunk.content) return chunk.content;
        if (chunk.delta) return chunk.delta;
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        return null; // ChatGLM 通过 [DONE] 标记结束
      },

      detectEventClose: function(eventType, chunk) {
        return null;
      },

      binaryStream: false,
      cumulativeContent: true
    },

    dom: {
      chatInputSelectors: [
        'textarea.scroll-display-none',
        '#search-input-box textarea',
        'textarea[rows]',
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],

      findSendButton: function() {
        // 智谱 ChatGLM：发送按钮在 input-box-container 内
        var inputBoxContainer = document.querySelector('.input-box-container');
        if (inputBoxContainer) {
          // 优先查找 .send-btn / [class*="send"]
          var sendBtn = inputBoxContainer.querySelector('.send-btn, button[class*="send"], [class*="send-button"]');
          if (sendBtn && sendBtn.clientHeight > 0) return sendBtn;
          // 查找 .options-container 中的按钮
          var containers = inputBoxContainer.querySelectorAll('.options-container');
          if (containers.length > 0) {
            var lastContainer = containers[containers.length - 1];
            var btns = lastContainer.querySelectorAll('button');
            if (btns.length > 0) {
              // 最后一个可见按钮通常是发送按钮
              for (var i = btns.length - 1; i >= 0; i--) {
                if (btns[i].clientHeight > 0) return btns[i];
              }
            }
          }
          // 在 input-wrap 内查找含 SVG 的按钮
          var inputWrap = document.querySelector('.input-wrap');
          if (inputWrap) {
            var allBtns = inputWrap.querySelectorAll('button');
            for (var j = 0; j < allBtns.length; j++) {
              if (allBtns[j].clientHeight > 0 && allBtns[j].querySelector('svg')) {
                return allBtns[j];
              }
            }
          }
        }
        // 备选：找 .send-btn / [class*="send"]
        var all = document.querySelectorAll('.send-btn, [class*="send-btn"], [class*="send-button"]');
        for (var k = 0; k < all.length; k++) {
          if (all[k].clientHeight > 0) return all[k];
        }
        return null;
      },

      aiMessageSelectors: [
        'div[class*="assistant-message"]',
        'div[class*="message-content"]',
        'div[class*="markdown"]',
        'div[class*="markdown-body"]',
        'div[class*="answer"]',
        'div[class*="text-content"]'
      ],
      thinkContentSelector: '[class*="think-content"], [class*="thinking-content"]',
      userMessageSelector: '[class*="user-message"], [class*="human-message"], [class*="question-message"]',

      isUserMessage: function(el) {
        return PlatformAdapter.isUserMessage(el);
      },

      detectStreaming: function() {
        // 智谱流式输出时按钮变为停止
        var stopBtn = document.querySelector('button[class*="stop"], button[aria-label*="stop" i], button[aria-label*="停止" i], [class*="stop-button"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        // 或者发送按钮有 loading class
        var inputBoxContainer = document.querySelector('.input-box-container');
        if (inputBoxContainer) {
          var sendBtn = inputBoxContainer.querySelector('.send-btn, [class*="send-btn"]');
          if (sendBtn && sendBtn.className.indexOf('loading') >= 0) return true;
        }
        return false;
      }
    },

    setInputValue: function(element, value) {
      // 智谱 ChatGLM 使用 textarea (Vue)
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
      if (btn && !btn.disabled) { btn.click(); return true; }
      // fallback: Enter
      var input = typeof findChatInput === 'function' ? findChatInput() : null;
      return PlatformAdapter.sendMessageFallback(input);
    }
  };

  PlatformRegistry.register(chatglmAdapter);
})();
