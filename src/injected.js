(function() {
  'use strict';

  if (window.__deepseekToolAgentInjected) return;
  window.__deepseekToolAgentInjected = true;

  var TOOL_DEFINITIONS = [
    { name: "read_file",   description: "读取本地文件内容",                     parameters: { path: "string" } },
    { name: "write_file",  description: "写入内容到本地文件(不存在则创建,存在则覆盖)", parameters: { path: "string", content: "string" } },
    { name: "list_dir",    description: "列出指定目录下的文件和子目录",           parameters: { path: "string" } },
    { name: "exec_command", description: "在Windows系统上执行cmd命令并返回输出", parameters: { command: "string" } },
    { name: "append_file", description: "追加内容到本地文件末尾",                parameters: { path: "string", content: "string" } },
    { name: "search_files", description: "在指定目录中搜索文件名匹配的文件",     parameters: { pattern: "string", root: "string" } },
    { name: "get_file_info", description: "获取文件详细信息(大小,修改时间等)",   parameters: { path: "string" } }
  ];

  function buildSystemPrompt() {
    var toolDefsStr = JSON.stringify(TOOL_DEFINITIONS);

    var prompt = '';
    prompt += '## 环境\n';
    prompt += '- 操作系统: Windows (cmd.exe)\n';
    prompt += '- 文件路径: 使用反斜杠 C:\\path\\file.txt 或正斜杠 C:/path/file.txt\n';
    prompt += '- exec_command 通过 cmd.exe /c 执行，支持所有 cmd 内部命令（echo, dir, type, cd, copy, del 等）\n';
    prompt += '- 注意: echo、dir、type、cd 是 cmd.exe 内部命令，不是独立程序，直接使用命令名即可\n\n';
    prompt += '## 工作区\n';
    prompt += '- 工作区根目录是 AI 可读写的范围，路径相对于此目录\n';
    prompt += '- 例如: 读取 projects/test.txt → 实际读取 {工作区}/projects/test.txt\n';
    prompt += '- 不要在前缀添加 "workspace/"，直接从 projects/ 或 config/ 或 memory/ 开始写\n\n';
    prompt += '## 可用工具\n';
    prompt += toolDefsStr + '\n\n';
    prompt += '## 调用格式\n';
    prompt += '需要调用工具时输出:\n';
    prompt += '<tool_call name="工具名">\n{"参数名":"参数值"}\n</tool_call\n\n';
    prompt += '示例:\n';
    prompt += '<tool_call name="exec_command">\n{"command":"echo Hello World"}\n</tool_call\n\n';
    prompt += '<tool_call name="exec_command">\n{"command":"dir C:\\Users"}\n</tool_call\n\n';
    prompt += '## 规则\n';
    prompt += '1. 可以连续调用多个工具\n';
    prompt += '2. 工具调用会按顺序执行，结果会按顺序返回\n';
    prompt += '3. 路径请使用绝对路径\n';
    prompt += '4. 不需要工具时直接回答\n\n';
    prompt += '## 错误处理\n';
    prompt += '- 工具执行失败时，错误信息会以 <tool_response status="error"> 格式返回\n';
    prompt += '- "ENOENT" 表示命令或路径不存在，请检查拼写或用其他方式实现目标\n';
    prompt += '- "EPERM" 表示权限不足，尝试换个目录操作\n';
    prompt += '- 若某个工具执行失败，请分析错误原因后尝试其他替代方案完成任务';

    return prompt;
  }

  function findChatInput() {
    var selectors = [
      'textarea[name="search"]',
      'textarea[placeholder*="DeepSeek"]',
      'textarea[placeholder*="发送"]',
      'textarea._27c9245',
      'textarea[class*="ds-scroll-area"]',
      'textarea.ds-textarea',
      'textarea:not([hidden])',
      'div[contenteditable="true"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        var style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0) {
          return el;
        }
      }
    }

    return null;
  }

  function setInputValue(element, value) {
    element.focus();
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      var setOk = false;
      try {
        var desc = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(element) || window.HTMLTextAreaElement.prototype,
          'value'
        );
        if (desc && typeof desc.set === 'function') {
          desc.set.call(element, value);
          setOk = true;
        }
      } catch(e) {}
      if (!setOk) {
        try { element.value = value; setOk = true; } catch(e) {}
      }
      if (!setOk) {
        try { document.execCommand('insertText', false, value); setOk = true; } catch(e) {}
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, composed: true,
        data: value, inputType: 'insertText'
      }));
    } else if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function clickSendButton() {
    var textarea = findChatInput();
    if (!textarea) return false;

    var allButtons = document.querySelectorAll('button');
    var bestButton = null;
    var bestScore = 0;

    for (var i = 0; i < allButtons.length; i++) {
      var btn = allButtons[i];
      if (btn.disabled) continue;
      var rect = btn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      var html = btn.innerHTML.toLowerCase();
      var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      var cls = btn.className.toLowerCase();

      var score = 0;

      if (aria.includes('发送') || aria.includes('send') || aria.includes('submit')) score += 20;
      if (cls.includes('send') || cls.includes('submit')) score += 10;
      if (html.includes('svg')) score += 5;

      var hasArrowSvg = html.includes('m8.3125') || html.includes('arrow') ||
                        (html.includes('d="') && html.includes('path') &&
                         (html.includes('v15') || html.includes('15.043')));
      if (hasArrowSvg) score += 15;

      if (!btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') score += 3;

      var taRect = textarea.getBoundingClientRect();
      if (Math.abs(rect.top - taRect.top) < 100 && Math.abs(rect.right - taRect.right) < 200) score += 8;
      if (rect.width < 60 && rect.height < 60) score += 3;

      if (score > bestScore) {
        bestScore = score;
        bestButton = btn;
      }
    }

    if (bestButton && bestScore >= 8) {
      bestButton.click();
      return true;
    }

    textarea.focus();
    var desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    var setter = desc ? desc.set : null;
    if (setter) setter.call(textarea, textarea.value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));

    setTimeout(function() {
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }, 100);

    return true;
  }

  function doInject(autoSend) {
    var input = findChatInput();
    if (!input) return { success: false, error: '找不到输入框' };

    var currentValue = input.value || '';

    if (currentValue.includes('## 可用工具') && currentValue.includes('<tool_call')) {
      return { success: true, toolCount: TOOL_DEFINITIONS.length, alreadyInjected: true };
    }

    var toolPrompt = buildSystemPrompt();

    var newValue;
    if (currentValue.trim()) {
      newValue = toolPrompt + '\n\n---\n\n' + currentValue;
    } else {
      newValue = toolPrompt;
    }

    setInputValue(input, newValue);
    input.focus();

    if (autoSend) {
      setTimeout(function() {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true
        }));
      }, 300);
    }

    return { success: true, toolCount: TOOL_DEFINITIONS.length };
  }

  var __latestAIMessageEl = null;
  var __lastKnownText = '';

  function isElementVisible(el) {
    if (!el) return false;
    try {
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0;
    } catch (e) {
      return false;
    }
  }

  function findLastAIMessage() {
    var selectors = [
      'div[data-role="assistant"]',
      'div[class*="assistant"]',
      'div[class*="ai-response"]',
      'div[role="assistant"]',
      'div[class*="message"][class*="assistant"]',
      'article[class*="assistant"]',
      'section[class*="assistant"]',
      'div[class*="chat"][class*="message"]'
    ];

    for (var s = 0; s < selectors.length; s++) {
      var candidates = document.querySelectorAll(selectors[s]);
      for (var i = candidates.length - 1; i >= 0; i--) {
        var el = candidates[i];
        if (isElementVisible(el)) {
          var text = el.innerText || el.textContent || '';
          if (text.trim().length > 10) {
            return el;
          }
        }
      }
    }

    return null;
  }

  function observeLatestAIMessage() {
    return new Promise(function(resolve) {
      var latestEl = null;

      var timeout = setTimeout(function() {
        resolve(latestEl);
      }, 60000);

      var found = false;

      function checkExisting() {
        if (found) return false;
        var el = findLastAIMessage();
        if (el) {
          found = true;
          clearTimeout(timeout);
          latestEl = el;
          __latestAIMessageEl = el;
          __lastKnownText = (el.innerText || el.textContent || '').trim();
          resolve(el);
          return true;
        }
        return false;
      }

      if (checkExisting()) return;

      var observer = new MutationObserver(function(mutations) {
        if (found) return;
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var node = added[n];
            if (node.nodeType !== 1) continue;
            var el = findLastAIMessage();
            if (el) {
              var currentText = (el.innerText || el.textContent || '').trim();
              if (currentText !== __lastKnownText && currentText.length > 10) {
                found = true;
                clearTimeout(timeout);
                latestEl = el;
                __latestAIMessageEl = el;
                __lastKnownText = currentText;
                observer.disconnect();
                resolve(el);
                return;
              }
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true
      });

      var pollInterval = setInterval(function() {
        if (found) {
          clearInterval(pollInterval);
          return;
        }
        if (checkExisting()) {
          clearInterval(pollInterval);
        }
      }, 500);
    });
  }

  function getLatestAIMessageText() {
    var el = __latestAIMessageEl;
    if (!el) return '';

    var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

    var codeBlocks = el.querySelectorAll ? el.querySelectorAll('pre code, code[class*="language-"]') : [];
    for (var i = 0; i < codeBlocks.length; i++) {
      var codeText = (codeBlocks[i].innerText || codeBlocks[i].textContent || '').trim();
      if (codeText.length > text.length) {
        text = codeText;
      }
    }

    var markdownBlocks = el.querySelectorAll ? el.querySelectorAll('pre, .code-block, [class*="code"]') : [];
    for (var j = 0; j < markdownBlocks.length; j++) {
      var mdText = (markdownBlocks[j].innerText || markdownBlocks[j].textContent || '').trim();
      if (mdText.length > text.length * 0.8) {
        text = mdText;
      }
    }

    return text;
  }

  function findLastAssistantMessage() {
    var result = { el: null, method: '', text: '' };

    var assistantSelectors = [
      'div[data-role="assistant"]',
      'div[role="assistant"]',
      'article[data-role="assistant"]',
      'div[data-message-author-role="assistant"]',
      'div[data-message-role="assistant"]',
      'div[class*="assistant"]:not([class*="user"])',
      'div[class*="response"]:not([class*="user"])',
      'div[class*="answer"]:not([class*="user"])',
      'div[class*="markdown"]',
      'div[class*="prose"]',
      'div[class*="message"][class*="ai"]',
      'div[class*="message"][class*="bot"]',
      'div[class*="ds-markdown"]',
      'div[class*="ds-message"]',
      'div[class*="content"]:not([class*="input"]):not([class*="textarea"])'
    ];

    for (var i = 0; i < assistantSelectors.length; i++) {
      try {
        var candidates = document.querySelectorAll(assistantSelectors[i]);
        for (var c = candidates.length - 1; c >= 0; c--) {
          var el = candidates[c];
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || rect.height < 20) continue;

          var rawText = (el.innerText || el.textContent || '').trim();
          if (rawText.length > 20) {
            result.el = el;
            result.text = rawText;
            result.method = 'selector:' + assistantSelectors[i];
            return result;
          }
        }
      } catch (e) {}
    }

    var preEls = document.querySelectorAll('pre');
    for (var p = preEls.length - 1; p >= 0; p--) {
      var pre = preEls[p];
      var preStyle = window.getComputedStyle(pre);
      if (preStyle.display === 'none' || preStyle.visibility === 'hidden') continue;
      var preRect = pre.getBoundingClientRect();
      if (preRect.width === 0 || preRect.height < 20) continue;

      var preText = (pre.innerText || pre.textContent || '').trim();
      if (preText.indexOf('<tool_call') >= 0) {
        result.el = pre;
        result.text = preText;
        result.method = 'preTag';
        return result;
      }
    }

    var codeEls = document.querySelectorAll('code');
    for (var cd = codeEls.length - 1; cd >= 0; cd--) {
      var code = codeEls[cd];
      var codeText = (code.innerText || code.textContent || '').trim();
      if (codeText.indexOf('<tool_call') >= 0 && codeText.length > 20) {
        result.el = code;
        result.text = codeText;
        result.method = 'codeTag';
        return result;
      }
    }

    return result;
  }

  var __streamingCache = { ts: 0, result: false, prevIsArrow: true, justReturnedToArrow: false };
  var __ARROW_PATH = 'm8.3125';

  function findSendButton() {
    var all = document.querySelectorAll('[role="button"],button');
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (b.getBoundingClientRect().width === 0) continue;
      if ((b.innerHTML || '').toLowerCase().indexOf(__ARROW_PATH) >= 0) return b;
    }
    return null;
  }

  function isSendButtonArrow(btn) {
    if (!btn) return false;
    return (btn.innerHTML || '').toLowerCase().indexOf(__ARROW_PATH) >= 0;
  }

  function detectStreaming() {
    var now = Date.now();
    if (now - __streamingCache.ts < 300) return __streamingCache.result;

    var btn = findSendButton();
    if (!btn) {
      __streamingCache = { ts: now, result: false, prevIsArrow: false, justReturnedToArrow: false };
      return false;
    }

    var isArrow = isSendButtonArrow(btn);
    var wasArrow = __streamingCache.prevIsArrow;
    var justReturned = (wasArrow === false && isArrow === true);

    __streamingCache = {
      ts: now,
      result: !isArrow,
      prevIsArrow: isArrow,
      justReturnedToArrow: justReturned
    };
    return !isArrow;
  }

  function wasSendButtonJustReturnedToArrow() {
    return __streamingCache.justReturnedToArrow === true;
  }

  function parseToolCall(rawTag) {
    var nameMatch = rawTag.match(/name\s*=\s*"([^"]*)"/i);
    var toolName = nameMatch ? nameMatch[1] : null;

    var contentMatch = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/i.exec(rawTag);
    if (!contentMatch) return null;

    var content = contentMatch[1].trim();

    try {
      var args = JSON.parse(content);
      if (args.name && args.arguments) {
        return { tool: args.name, parameters: args.arguments };
      }
      if (args.tool && args.parameters) {
        return { tool: args.tool, parameters: args.parameters };
      }
      if (toolName && typeof args === 'object' && Object.keys(args).length > 0) {
        return { tool: toolName, parameters: args };
      }
    } catch (e) {
      var opens = (content.match(/\{/g) || []).length;
      var closes = (content.match(/\}/g) || []).length;

      if (opens > closes) {
        try {
          var fixed = JSON.parse(content + '}'.repeat(opens - closes));
          if (fixed.arguments) return { tool: toolName, parameters: fixed.arguments };
          if (fixed.parameters) return { tool: toolName, parameters: fixed.parameters };
          if (toolName && typeof fixed === 'object' && Object.keys(fixed).length > 0) {
            return { tool: toolName, parameters: fixed };
          }
        } catch (e2) {}
      }
    }

    if (toolName) {
      if (content.length > 0 && toolName === 'exec_command') {
        var cmdMatch = content.match(/"command"\s*:\s*"(.*?)"\s*,\s*"/);
        if (cmdMatch && cmdMatch[1]) return { tool: toolName, parameters: { command: cmdMatch[1] } };
        cmdMatch = content.match(/"command"\s*:\s*"(.*?)"\s*\}/);
        if (cmdMatch && cmdMatch[1]) return { tool: toolName, parameters: { command: cmdMatch[1] } };
        return { tool: toolName, parameters: { command: content } };
      }
      return { tool: toolName, parameters: {} };
    }
    return null;
  }

  function extractToolCalls(text) {
    var toolCalls = [];
    var regex = /<tool_call[\s\S]*?<\/tool_call>/gi;
    var matches = text.match(regex) || [];

    for (var i = 0; i < matches.length; i++) {
      var parsed = parseToolCall(matches[i]);
      if (parsed) {
        toolCalls.push({
          rawTag: matches[i],
          name: parsed.tool,
          arguments: parsed.parameters,
          index: i
        });
      }
    }

    return toolCalls;
  }

  window.__injectToolPrompt = doInject;
  window.__findLastAIMessage = findLastAIMessage;
  window.__observeLatestAIMessage = observeLatestAIMessage;
  window.__getLatestAIMessageText = getLatestAIMessageText;
  window.__findLastAssistantMessage = findLastAssistantMessage;
  window.__detectStreaming = detectStreaming;
  window.__wasSendButtonJustReturnedToArrow = wasSendButtonJustReturnedToArrow;
  window.__findSendButton = findSendButton;
  window.__isSendButtonArrow = isSendButtonArrow;
  window.__getStreamingCache = function() { return __streamingCache; };
  window.__parseToolCall = parseToolCall;
  window.__extractToolCalls = extractToolCalls;
  window.__findChatInput = findChatInput;
  window.__setInputValue = setInputValue;
  window.__clickSendButton = clickSendButton;

  window.addEventListener('message', function(event) {
    if (!event.data || typeof event.data !== 'object') return;

    var data = event.data;

    if (data.type === '__ds_inject_tool') {
      var result = doInject(data.autoSend);
      window.postMessage({
        type: '__ds_inject_result',
        requestId: data.requestId,
        result: result
      }, '*');
    }

    if (data.type === '__ds_heartbeat_injected') {
      var ss = window.__ds_streamState ? window.__ds_streamState() : { active: false };
      window.postMessage({
        source: 'ai-tool-agent',
        type: '__ds_heartbeat_injected_ack',
        alive: true,
        streamActive: ss.active,
        fetchPatched: true,
        timestamp: Date.now()
      }, '*');
    }
  });

})();