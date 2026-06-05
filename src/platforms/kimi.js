/**
 * Kimi 平台适配器
 */
(function() {
  var kimiAdapter = {
    id: 'kimi',
    name: 'Kimi',
    hostPattern: /kimi\.com|moonshot\.cn/,

    sse: {
      apiPattern: /kimi\.gateway\.chat|ChatService\/Chat/,

      extractContent: function(chunk) {
        if (!chunk) return null;
        // Connect RPC 格式
        if (chunk.op === 'append' && chunk.block && chunk.block.text) {
          return chunk.block.text.content || null;
        }
        if (chunk.op === 'set' && chunk.block && chunk.block.text) {
          return chunk.block.text.content || null; // 累积文本
        }
        if (chunk.message && chunk.message.blocks) {
          var texts = [];
          for (var i = 0; i < chunk.message.blocks.length; i++) {
            var block = chunk.message.blocks[i];
            if (block.text && block.text.content) texts.push(block.text.content);
          }
          return texts.length > 0 ? texts.join('') : null;
        }
        return null;
      },

      detectStreamEnd: function(chunk) {
        if (!chunk) return null;
        if (chunk.done === true) return 'done';
        return null;
      },

      detectEventClose: function(eventType, chunk) {
        return null;
      },

      binaryStream: true,

      // Connect RPC 二进制帧解析
      parseBinaryFrame: function(buffer) {
        // Connect RPC: 1字节标志 + 4字节大端长度 + JSON payload
        var frames = [];
        var offset = 0;
        while (offset + 5 <= buffer.length) {
          var flag = buffer.charCodeAt(offset);
          var len = ((buffer.charCodeAt(offset+1) & 0xFF) << 24) |
                    ((buffer.charCodeAt(offset+2) & 0xFF) << 16) |
                    ((buffer.charCodeAt(offset+3) & 0xFF) << 8) |
                    (buffer.charCodeAt(offset+4) & 0xFF);
          if (offset + 5 + len > buffer.length) break;
          var payload = buffer.substring(offset + 5, offset + 5 + len);
          try {
            frames.push(JSON.parse(payload));
          } catch(e) {}
          offset += 5 + len;
        }
        return { frames: frames, consumed: offset };
      }
    },

    dom: {
      chatInputSelectors: [
        'div.chat-input-editor[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[data-lexical-editor="true"]',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],

      findSendButton: function() {
        // Kimi 的发送按钮：class="send-button-container"（div而非button）
        var sendBtn = document.querySelector('.send-button-container');
        if (sendBtn && sendBtn.clientHeight > 0) {
          sendBtn.setAttribute('data-ds-send-btn', 'kimi-send');
          return sendBtn;
        }
        // 备选：含 .send-icon 的父元素
        var sendIcon = document.querySelector('.send-icon');
        if (sendIcon) {
          var container = sendIcon.closest('.send-button-container, [class*="send-button"]');
          if (container && container.clientHeight > 0) {
            container.setAttribute('data-ds-send-btn', 'kimi-send-fallback');
            return container;
          }
        }
        return null;
      },

      aiMessageSelectors: [
        'div.chat-content-item-assistant',
        'div.segment-assistant .markdown',
        'div.chat-content-list .chat-content-item-assistant .markdown',
        'div[class*="markdown"]'
      ],
      thinkContentSelector: '.think-content, [class*="thinking"]',
      userMessageSelector: 'div.chat-content-item-user, div.segment-user',
      messageListSelector: 'div.chat-content-list',

      isUserMessage: function(el) {
        if (el.getAttribute('data-role') === 'user') return true;
        if (el.getAttribute('data-author') === 'user') return true;
        var cls = (el.className || '');
        if (typeof cls === 'string') {
          if (cls.indexOf('chat-content-item-user') >= 0) return true;
          if (cls.indexOf('segment-user') >= 0) return true;
          if (cls.indexOf('chat-content-item-assistant') >= 0) return false;
          if (cls.indexOf('segment-assistant') >= 0) return false;
        }
        return false;
      },

      detectStreaming: function() {
        // Kimi 流式输出时，发送按钮变为停止按钮（含 stop 图标）
        var stopIcon = document.querySelector('svg[class*="stop-icon"], [class*="stop-button"]');
        if (stopIcon && stopIcon.clientHeight > 0) return true;
        // 或者发送按钮变成 disabled
        var sendBtn = document.querySelector('.send-button-container');
        if (sendBtn && sendBtn.classList.contains('disabled')) return false;
        // 检查是否有正在进行的回复（assistant消息正在生成）
        var assistantMsg = document.querySelector('.chat-content-item-assistant');
        if (assistantMsg) {
          var segment = assistantMsg.querySelector('.segment-assistant');
          if (segment && segment.querySelector('.loading, [class*="typing"], [class*="generating"]')) return true;
        }
        return false;
      }
    },

    setInputValue: function(element, value) {
      // Kimi 使用 Lexical 编辑器 (contenteditable div)
      // 必须使用 execCommand 模拟真实输入，Lexical 才能检测到
      element.focus();
      // 先全选并删除
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      // 使用 execCommand 插入文本
      var ok = document.execCommand('insertText', false, value);

      // 如果 execCommand 不生效，fallback
      if (!ok || !element.textContent || element.textContent.trim() === '') {
        element.innerHTML = '';
        var lines = value.split('\n');
        for (var j = 0; j < lines.length; j++) {
          if (j > 0) element.appendChild(document.createElement('br'));
          element.appendChild(document.createTextNode(lines[j]));
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      }
    },

    sendMessage: function() {
      var btn = this.dom.findSendButton();
      // Kimi 的发送按钮是 div，没有 disabled 属性，用 class 判断
      if (btn && !btn.classList.contains('disabled')) { btn.click(); return true; }
      // fallback: Ctrl+Enter (Kimi 默认发送快捷键)
      var input = typeof findChatInput === 'function' ? findChatInput() : null;
      if (!input) return false;
      input.focus();
      var evt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, bubbles: true, cancelable: true, composed: true };
      input.dispatchEvent(new KeyboardEvent('keydown', evt));
      return true;
    }
  };

  PlatformRegistry.register(kimiAdapter);
})();
