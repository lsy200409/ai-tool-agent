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

        // z.ai 使用 {type, data} 格式，data 是 JSON 字符串需要二次解析
        if (chunk.type && chunk.data !== undefined) {
          var innerData = chunk.data;
          // data 可能是 JSON 字符串，需要解析
          if (typeof innerData === 'string') {
            try { innerData = JSON.parse(innerData); } catch(e) { return null; }
          }
          if (!innerData) return null;

          // 解析后的 innerData 可能是 OpenAI 兼容格式
          if (innerData.choices && innerData.choices.length > 0) {
            var delta = innerData.choices[0].delta;
            if (delta && delta.content) return delta.content;
            if (innerData.choices[0].finish_reason) return null;
          }
          // 智谱原生格式
          if (innerData.parts && innerData.parts.length > 0) {
            var texts = [];
            for (var i = 0; i < innerData.parts.length; i++) {
              var part = innerData.parts[i];
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
          // z.ai 增量内容格式: {delta_content: "...", phase: "thinking/output"}
          if (innerData.delta_content) return innerData.delta_content;
          if (innerData.text) return innerData.text;
          if (innerData.delta) return innerData.delta;
          if (innerData.content) {
            if (typeof innerData.content === 'string') return innerData.content;
          }
          return null;
        }

        // 直接 OpenAI 兼容格式（无外层 type/data 包装）
        if (chunk.choices && chunk.choices.length > 0) {
          var delta2 = chunk.choices[0].delta;
          if (delta2 && delta2.content) return delta2.content;
          if (chunk.choices[0].finish_reason) return null;
        }
        // 智谱原生格式
        if (chunk.parts && chunk.parts.length > 0) {
          var texts2 = [];
          for (var k = 0; k < chunk.parts.length; k++) {
            var part2 = chunk.parts[k];
            if (part2.content && Array.isArray(part2.content)) {
              for (var l = 0; l < part2.content.length; l++) {
                if (part2.content[l].type === 'text' && part2.content[l].text) {
                  texts2.push(part2.content[l].text);
                }
              }
            }
          }
          if (texts2.length > 0) return texts2.join('');
        }
        if (chunk.text) return chunk.text;
        if (chunk.delta) return chunk.delta;
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        // z.ai {type, data} 格式：type 表示结束
        if (chunk.type && chunk.data !== undefined) {
          // type 为 done/stop/chat:completion_done 等表示结束
          if (chunk.type === 'done' || chunk.type === 'stop' || chunk.type === 'chat:completion_done') return chunk.type;
          // 检查内层 data 的 finish_reason
          var innerData = chunk.data;
          if (typeof innerData === 'string') {
            try { innerData = JSON.parse(innerData); } catch(e) {}
          }
          if (innerData && innerData.choices && innerData.choices.length > 0 && innerData.choices[0].finish_reason) {
            return innerData.choices[0].finish_reason;
          }
          // z.ai 内层 data 可能有 finish_reason 字段
          if (innerData && innerData.finish_reason) return innerData.finish_reason;
          return null;
        }
        // 直接 OpenAI 格式
        if (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].finish_reason) {
          return chunk.choices[0].finish_reason;
        }
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        // z.ai SSE event type 可能表示关闭
        if (eventType === 'done' || eventType === 'stop') return eventType;
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
        // z.ai 发送按钮可能在 textarea 附近的 form 内
        // 优先查找已知 ID（旧版 DOM）
        var sendBtn = document.getElementById('send-message-button');
        if (sendBtn && sendBtn.clientHeight > 0) return sendBtn;

        // 在 textarea 附近查找发送按钮
        var textarea = document.querySelector('textarea#chat-input, textarea[placeholder*="帮您"], textarea[placeholder*="help"]');
        if (textarea) {
          // 向上遍历父级查找 form 内的 submit 按钮
          var walk = textarea.parentElement;
          for (var j = 0; j < 8; j++) {
            if (!walk) break;
            // 优先查找 type=submit 的按钮（z.ai 的发送按钮是 submit 类型）
            var submitBtns = walk.querySelectorAll('button[type="submit"]');
            for (var k = 0; k < submitBtns.length; k++) {
              var btn = submitBtns[k];
              // 排除已知非发送按钮（上传、侧边栏等）
              if (btn.clientHeight <= 0) continue;
              if (btn.id === 'upload-file-button' || btn.id === 'sidebar-new-chat-button') continue;
              if (btn.id && btn.id.indexOf('bits-') === 0) continue;
              // z.ai 发送按钮特征：bg-black 或包含 SVG 箭头
              var cls = btn.className || '';
              if (cls.indexOf('bg-black') >= 0 || cls.indexOf('bg-gray-900') >= 0) return btn;
            }
            // 也检查 type=button 的按钮
            var normalBtns = walk.querySelectorAll('button:not([type="submit"])');
            for (var m = 0; m < normalBtns.length; m++) {
              var nb = normalBtns[m];
              if (nb.clientHeight <= 0) continue;
              if (nb.id === 'upload-file-button') continue;
              if (nb.id && nb.id.indexOf('bits-') === 0) continue;
              var ncls = nb.className || '';
              if (ncls.indexOf('bg-black') >= 0 || ncls.indexOf('sendMessageButton') >= 0) return nb;
            }
            walk = walk.parentElement;
          }
        }

        // fallback: 全局查找 sendMessageButton class
        var btns = document.querySelectorAll('button.sendMessageButton');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].clientHeight > 0) return btns[i];
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
        // z.ai: 通过发送按钮状态检测是否正在生成
        var sendBtn = this.dom.findSendButton();
        if (sendBtn) {
          // 按钮不可用/灰色 = 正在生成
          if (sendBtn.disabled) return true;
          var cls = sendBtn.className || '';
          if (cls.indexOf('bg-[#E0E0E0]') >= 0 || cls.indexOf('opacity-50') >= 0 || cls.indexOf('pointer-events-none') >= 0) {
            return true;
          }
        }
        // 检查是否有停止按钮
        var stopBtn = document.querySelector('button[aria-label*="stop" i], button[aria-label*="Stop" i], button[class*="stop"]');
        if (stopBtn && stopBtn.clientHeight > 0) return true;
        return false;
      }
    },

    setInputValue: function(element, value) {
      // z.ai 使用 Svelte 框架的 textarea
      // 优先使用原生 setter（支持任意长度文本），insertText 对长文本会静默失败
      element.focus();
      try {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(element, value);
        else element.value = value;
      } catch(e) { element.value = value; }
      // 触发 Svelte 的 input 事件让框架感知值变化
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      if (btn) {
        // 如果按钮 disabled，等待框架更新（Svelte 响应式需要一帧）
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
          // 同步等待：不返回 Promise（调用方不处理 Promise）
          var btn2 = document.getElementById('send-message-button');
          if (btn2 && !btn2.disabled) { btn2.click(); return true; }
          // 按钮仍 disabled，走 fallback
        } else {
          btn.click();
          return true;
        }
      }
      // fallback: Enter
      var input = typeof findChatInput === 'function' ? findChatInput() : null;
      return PlatformAdapter.sendMessageFallback(input);
    }
  };

  PlatformRegistry.register(zaiAdapter);
})();
