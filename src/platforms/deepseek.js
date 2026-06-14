/**
 * DeepSeek 平台适配器
 */
(function() {
  var deepseekAdapter = {
    id: 'deepseek',
    name: 'DeepSeek',
    hostPattern: /chat\.deepseek\.com/,

    sse: {
      apiPattern: /chat\/completion/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // OpenAI 兼容格式
        if (chunk.choices && chunk.choices.length > 0) {
          var delta = chunk.choices[0].delta;
          if (delta && delta.content) return delta.content;
        }
        // DeepSeek 私有格式A
        if (typeof chunk.v === 'string') {
          if (chunk.p) {
            if (chunk.p === 'response/fragments/-1/content') return chunk.v;
            return null;
          }
          return chunk.v;
        }
        // DeepSeek 私有格式B
        if (chunk.p === 'response/fragments' && chunk.o === 'APPEND' && Array.isArray(chunk.v)) {
          var texts = [];
          for (var i = 0; i < chunk.v.length; i++) {
            var f = chunk.v[i];
            if (f.type === 'RESPONSE' && f.content) texts.push(f.content);
            if (f.type === 'THINK' && f.content) texts.push('[思考]' + f.content);
          }
          return texts.length > 0 ? texts.join('') : null;
        }
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        if (chunk.p === 'response/status' && chunk.o === 'SET' && chunk.v === 'FINISHED') return 'finished';
        if (chunk.choices && chunk.choices.length > 0) {
          var fr = chunk.choices[0].finish_reason;
          if (fr) return fr;
        }
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        if (eventType === 'close') return 'close';
        return null;
      },

      binaryStream: false
    },

    dom: {
      chatInputSelectors: [
        'textarea[name="search"]',
        'textarea[placeholder*="DeepSeek"]',
        'textarea[placeholder*="发送"]',
        'textarea[placeholder*="给"]',
        'textarea._27c9245',
        'textarea[class*="ds-scroll-area"]',
        'textarea.ds-textarea',
        'textarea:not([hidden])',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],

      findSendButton: function() {
        // 优先查找 DeepSeek 的 primary 发送按钮
        var primaryBtns = document.querySelectorAll('div[role="button"].ds-button--primary, div[role="button"][class*="ds-button--primary"]');
        for (var p = 0; p < primaryBtns.length; p++) {
          var pb = primaryBtns[p];
          if (pb.clientHeight > 0 && pb.offsetParent !== null) {
            pb.setAttribute('data-ds-send-btn', 'primary');
            return pb;
          }
        }
        // SVG 箭头检测
        var all = document.querySelectorAll('[role="button"],button');
        for (var i = 0; i < all.length; i++) {
          var b = all[i];
          var html = (b.innerHTML || '').toLowerCase();
          if (html.indexOf('m8.3125') >= 0) { b.setAttribute('data-ds-send-btn', 'arrow'); return b; }
          if (html.indexOf('<rect') >= 0) { b.setAttribute('data-ds-send-btn', 'stop'); return b; }
        }
        return null;
      },

      aiMessageSelectors: ['div.ds-assistant-message-main-content'],
      thinkContentSelector: '.ds-think-content',
      userMessageSelector: 'div.ds-message',

      isUserMessage: function(el) {
        return !el.querySelector('.ds-assistant-message-main-content');
      },

      detectStreaming: function() {
        var btn = this.findSendButton();
        if (!btn) return false;
        var isArrow = (btn.innerHTML || '').toLowerCase().indexOf('m8.3125') >= 0;
        return !isArrow;
      }
    },

    setInputValue: function(element, value) {
      element.focus();
      try { element.value = ''; } catch(e) {}
      try { document.execCommand('selectAll'); } catch(e) {}
      try { document.execCommand('delete'); } catch(e) {}
      try {
        PlatformAdapter.setInputValueNative(element, value);
      } catch(e) { element.value = value; }
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      if (!btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled) {
        // fallback: Enter 键
        var textarea = typeof findChatInput === 'function' ? findChatInput() : null;
        return PlatformAdapter.sendMessageFallback(textarea);
      }
      btn.focus();
      btn.click();
      var rect = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
      return true;
    }
  };

  PlatformRegistry.register(deepseekAdapter);
})();
