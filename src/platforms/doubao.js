/**
 * 豆包 平台适配器
 */
(function() {
  var doubaoAdapter = {
    id: 'doubao',
    name: '豆包',
    hostPattern: /doubao\.com/,

    sse: {
      apiPattern: /samantha\/chat\/completion|\/chat\/completion/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // Samantha 格式: event_type=2001
        if (chunk.event_type === 2001 && chunk.event_data) {
          try {
            var eventData = JSON.parse(chunk.event_data);
            if (eventData.message && eventData.message.content) {
              try {
                var content = JSON.parse(eventData.message.content);
                if (content.text) return content.text;
              } catch(e) {
                return eventData.message.content;
              }
            }
          } catch(e) {}
        }
        // SSE event 格式
        if (chunk.text) return chunk.text;
        if (chunk.patch_op) {
          for (var i = 0; i < chunk.patch_op.length; i++) {
            if (chunk.patch_op[i].patch_value && chunk.patch_op[i].patch_value.tts_content) {
              return chunk.patch_op[i].patch_value.tts_content;
            }
          }
        }
        if (chunk.content && chunk.content.content_block) {
          var texts = [];
          for (var j = 0; j < chunk.content.content_block.length; j++) {
            var block = chunk.content.content_block[j];
            if (block.content && block.content.text_block && block.content.text_block.text) {
              texts.push(block.content.text_block.text);
            }
          }
          if (texts.length > 0) return texts.join('');
        }
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        if (chunk.event_type === 2003) return 'finished';
        if (chunk.is_finish === true) return 'finished';
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        if (eventType === 'SSE_REPLY_END') return 'reply_end';
        return null;
      },

      binaryStream: false
    },

    dom: {
      chatInputSelectors: [
        'textarea.semi-input-textarea',
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="豆包"]',
        'textarea[placeholder*="发送"]',
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],

      findSendButton: function() {
        // 豆包：发送按钮在 textarea 父级的下方
        // 优先查找 .send-button / [class*="send-btn"] / [aria-label*="发送"] / [aria-label*="send"]
        var sendSelectors = [
          '[class*="send-button"]',
          '[class*="send-btn"]',
          'button[aria-label*="发送" i]',
          'button[aria-label*="send" i]',
          '[data-testid*="send"]'
        ];
        for (var s = 0; s < sendSelectors.length; s++) {
          var els = document.querySelectorAll(sendSelectors[s]);
          for (var i = 0; i < els.length; i++) {
            if (els[i].clientHeight > 0) return els[i];
          }
        }

        // 豆包发送按钮特征：textarea 父级内，含 SVG 上箭头图标的 button
        // SVG path: M12.0005 2.25C12.5528 2.25... (上箭头发送图标)
        var ta = document.querySelector('textarea.semi-input-textarea');
        if (ta) {
          var walk = ta.parentElement;
          for (var k = 0; k < 6; k++) {
            if (!walk) break;
            var btns = walk.querySelectorAll('button');
            for (var j = 0; j < btns.length; j++) {
              var b = btns[j];
              if (b.clientHeight > 0 && b.querySelector('svg')) {
                var svgHtml = b.innerHTML || '';
                // 发送按钮的 SVG 含有上箭头路径特征
                if (svgHtml.indexOf('M12.0005') >= 0 || svgHtml.indexOf('2.25C12.5528') >= 0) {
                  b.setAttribute('data-ds-send-btn', 'doubao-arrow');
                  return b;
                }
              }
            }
            walk = walk.parentElement;
          }
        }

        // 备选：textarea 父级 3 层内找仅含 svg 的 button (排除含文字的)
        if (ta) {
          var walk2 = ta.parentElement;
          for (var m = 0; m < 5; m++) {
            if (!walk2) break;
            var btns2 = walk2.querySelectorAll('button');
            for (var n = 0; n < btns2.length; n++) {
              var b2 = btns2[n];
              if (b2.clientHeight > 0 && b2.querySelector('svg') && b2.textContent.trim() === '') {
                b2.setAttribute('data-ds-send-btn', 'doubao-svg-only');
                return b2;
              }
            }
            walk2 = walk2.parentElement;
          }
        }
        return null;
      },

      aiMessageSelectors: [
        'div[class*="assistant"]',
        'div[class*="markdown-body"]',
        'div[class*="message-content"]',
        'div[class*="markdown"]',
        'div[class*="answer"]',
        'div[class*="response"]'
      ],
      thinkContentSelector: '[class*="think-content"], [class*="thinking-content"]',
      userMessageSelector: '[class*="user-message"], [class*="human-message"]',

      isUserMessage: function(el) {
        if (el.getAttribute('data-role') === 'user') return true;
        if (el.getAttribute('data-author') === 'user') return true;
        var cls = (el.className || '');
        if (cls.indexOf('user-message') >= 0 || cls.indexOf('human-message') >= 0) return true;
        if (cls.indexOf('assistant') >= 0 || cls.indexOf('bot') >= 0 || cls.indexOf('ai') >= 0) return false;
        return false;
      },

      detectStreaming: function() {
        var stopBtn = document.querySelector('button[aria-label*="stop" i], button[aria-label*="停止" i], [class*="stop"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        return false;
      }
    },

    setInputValue: function(element, value) {
      // 豆包使用 textarea
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
      if (!input) return false;
      input.focus();
      var evt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      input.dispatchEvent(new KeyboardEvent('keydown', evt));
      input.dispatchEvent(new KeyboardEvent('keypress', evt));
      input.dispatchEvent(new KeyboardEvent('keyup', evt));
      return true;
    }
  };

  PlatformRegistry.register(doubaoAdapter);
})();
