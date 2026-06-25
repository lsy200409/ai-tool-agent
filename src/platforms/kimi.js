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
      // op==='set' 返回的是累积文本，需要标记以便上层正确处理
      cumulativeContent: true,

      // Connect RPC 二进制帧解析
      // 注意：buffer 已经被 TextDecoder 解码为字符串，len 字段是原始字节数，
      // 但 UTF-8 多字节字符（如中文）解码后 1字符≠1字节，不能用 substring 按字节偏移截取。
      // 改用 JSON 感知提取：跳过帧头，通过大括号匹配找到完整 JSON 边界。
      parseBinaryFrame: function(buffer) {
        var frames = [];
        var offset = 0;
        while (offset < buffer.length) {
          // 跳过帧头（1字节标志 + 4字节长度 = 5字节），查找 JSON 起始位置
          var jsonStart = buffer.indexOf('{', offset);
          if (jsonStart < 0) break;

          // 通过大括号深度匹配找到完整 JSON 边界
          var depth = 0;
          var inStr = false;
          var escape = false;
          var jsonEnd = -1;
          for (var i = jsonStart; i < buffer.length; i++) {
            var ch = buffer[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"' && !inStr) { inStr = true; continue; }
            if (ch === '"' && inStr) { inStr = false; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            if (ch === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
          }

          if (jsonEnd > 0) {
            var jsonStr = buffer.substring(jsonStart, jsonEnd);
            try {
              frames.push(JSON.parse(jsonStr));
              offset = jsonEnd;
            } catch(e) {
              // JSON 解析失败，跳过当前 '{' 继续查找
              offset = jsonStart + 1;
            }
          } else {
            break;
          }
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

      // execCommand('insertText') 对长文本可能静默失败，fallback 到手动构建 DOM
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
