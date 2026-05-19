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
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      var desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      var setter = desc ? desc.set : null;
      if (setter) {
        setter.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
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

  window.__injectToolPrompt = doInject;

  var __latestAIMessageEl = null;
  var __aiObserver = null;
  var __lastKnownText = '';

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
      __latestAIMessageEl = null;

      var timeout = setTimeout(function() {
        if (__aiObserver) {
          __aiObserver.disconnect();
          __aiObserver = null;
        }
        resolve(__latestAIMessageEl);
      }, 60000);

      var found = false;

      function checkExisting() {
        if (found) return;
        var el = findLastAIMessage();
        if (el) {
          found = true;
          clearTimeout(timeout);
          __latestAIMessageEl = el;
          __lastKnownText = (el.innerText || el.textContent || '').trim();
          if (__aiObserver) {
            __aiObserver.disconnect();
            __aiObserver = null;
          }
          resolve(el);
          return true;
        }
        return false;
      }

      if (checkExisting()) return;

      function onMutation(mutations) {
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
                __latestAIMessageEl = el;
                __lastKnownText = currentText;

                if (__aiObserver) {
                  __aiObserver.disconnect();
                  __aiObserver = null;
                }
                resolve(el);
                return;
              }
            }
          }
        }
      }

      __aiObserver = new MutationObserver(onMutation);
      __aiObserver.observe(document.body, {
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

  function isElementVisible(el) {
    if (!el) return false;
    try {
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0;
    } catch (e) {
      return false;
    }
  }

  function getLatestAIMessageText() {
    return new Promise(function(resolve) {
      var el = __latestAIMessageEl;
      if (!el) {
        resolve('');
        return;
      }

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

      resolve(text);
    });
  }

  window.__findLastAIMessage = findLastAIMessage;
  window.__observeLatestAIMessage = observeLatestAIMessage;
  window.__getLatestAIMessageText = getLatestAIMessageText;

  var __startSnapshot = '';
  var __scanStarted = false;
  var __scanPollTimer = null;
  var __executedThisRound = {};
  var __scanDebugLog = [];

  function debug(key, val) {
    var entry = { t: Date.now(), k: key, v: val };
    __scanDebugLog.push(entry);
    try {
      console.log('[DS Agent] ' + key, val);
    } catch (e) {}
  }

  function getPageText() {
    try {
      var text = document.body.innerText || document.body.textContent || '';
      return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
    } catch (e) {
      return '';
    }
  }

  function findChatScrollContainer() {
    var candidates = [];
    try {
      var allDivs = document.querySelectorAll('div');
      for (var i = 0; i < allDivs.length; i++) {
        var d = allDivs[i];
        var style = window.getComputedStyle(d);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          var rect = d.getBoundingClientRect();
          if (rect.height > 200 && rect.height < window.innerHeight) {
            candidates.push({ el: d, height: rect.height, top: rect.top });
          }
        }
      }
      candidates.sort(function(a, b) { return b.height - a.height; });
      return candidates.length > 0 ? candidates[0].el : null;
    } catch (e) {
      return null;
    }
  }

  function findLastAssistantMessage() {
    var result = { el: null, method: '', text: '', selectors: [] };

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

    for (var s = 0; s < assistantSelectors.length; s++) {
      try {
        var els = document.querySelectorAll(assistantSelectors[s]);
        for (var i = els.length - 1; i >= 0; i--) {
          var el = els[i];
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || rect.height < 20) continue;

          var text = (el.innerText || el.textContent || '').trim();
          if (text.length > 20) {
            result.el = el;
            result.text = text;
            result.method = 'selector:' + assistantSelectors[s];
            result.selectors.push(assistantSelectors[s]);
            debug('找到AI消息(选择器): ' + assistantSelectors[s], text.substring(0, 200));
            return result;
          }
        }
      } catch (e) {}
    }

    var container = findChatScrollContainer();
    if (container) {
      result.selectors.push('scrollContainer');
      var children = container.children;
      var lastGood = null;
      var lastGoodText = '';

      for (var c = children.length - 1; c >= 0; c--) {
        var child = children[c];
        var childStyle = window.getComputedStyle(child);
        if (childStyle.display === 'none' || childStyle.visibility === 'hidden') continue;
        var childRect = child.getBoundingClientRect();
        if (childRect.width === 0 || childRect.height < 20) continue;

        var childText = (child.innerText || child.textContent || '').trim();
        if (childText.length < 20) continue;

        if (childText.indexOf('## 环境') >= 0 && childText.indexOf('<tool_call') >= 0) {
          continue;
        }

        var childLower = childText.substring(0, 100).toLowerCase();
        if (childLower.indexOf('deepseek') >= 0 || childLower.indexOf('助手') >= 0 ||
            childLower.indexOf('assistant') >= 0) {
          continue;
        }

        var inputEl = findChatInput();
        if (inputEl && child.contains(inputEl)) continue;

        lastGood = child;
        lastGoodText = childText;
        break;
      }

      if (lastGood && lastGoodText) {
        result.el = lastGood;
        result.text = lastGoodText;
        result.method = 'scrollContainerLastChild';
        debug('找到AI消息(滚动容器末子元素)', lastGoodText.substring(0, 200));
        return result;
      }
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
        result.selectors.push('pre');
        debug('找到AI消息(pre标签)', preText.substring(0, 200));
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
        result.selectors.push('code');
        debug('找到AI消息(code标签)', codeText.substring(0, 200));
        return result;
      }
    }

    return result;
  }

  var __streamingCache = { ts: 0, result: false, prevIsArrow: true };
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

    if (toolName) return { tool: toolName, parameters: {} };
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

  function generateCallKey(name, args) {
    return name + '|' + JSON.stringify(args);
  }

  function scanForToolCalls() {
    debug('--- 开始扫描 ---', '');
    debug('页面文本总长度', getPageText().length);

    var ai = findLastAssistantMessage();
    debug('AI消息检测方法', ai.method || '无');
    debug('AI消息选择器', JSON.stringify(ai.selectors));

    if (!ai.text || ai.text.length < 10) {
      debug('扫描结果', '未找到AI消息文本');
      return { toolCalls: [], debugInfo: { method: 'none', textLen: 0, textPreview: '(未找到AI消息)' } };
    }

    var scanText = ai.text;
    debug('扫描文本长度', scanText.length);
    debug('扫描文本预览', scanText.substring(0, 500));

    var calls = extractToolCalls(scanText);
    debug('提取到的tool_call数量', calls.length);

    for (var i = 0; i < calls.length; i++) {
      debug('tool_call #' + i, calls[i].name + ' ' + JSON.stringify(calls[i].arguments));
    }

    return {
      toolCalls: calls,
      debugInfo: {
        method: ai.method || 'unknown',
        textLen: scanText.length,
        textPreview: scanText.substring(0, 500),
        selectors: ai.selectors || []
      }
    };
  }

  function startPolling(resolve, startMs) {
    var maxWaitMs = 90000;
    var pollIntervalMs = 1500;
    var lastText = getPageText();
    var stableCount = 0;
    var maxStable = 3;

    function poll() {
      var elapsed = Date.now() - startMs;
      if (elapsed >= maxWaitMs) {
        debug('轮询超时', elapsed + 'ms');
        __scanPollTimer = null;
        var timeoutResult = scanForToolCalls();
        debug('超时后结果', (timeoutResult.toolCalls || []).length + ' 个工具调用');
        resolve({ toolCalls: timeoutResult.toolCalls || [], debugInfo: timeoutResult.debugInfo });
        return;
      }

      var currentText = getPageText();
      var isStreaming = detectStreaming();
      var scanResult = scanForToolCalls();

      debug('轮询 #' + (stableCount + 1), 'streaming=' + isStreaming + ' calls=' + (scanResult.toolCalls || []).length + ' elapsed=' + (elapsed / 1000).toFixed(1) + 's');

      if (scanResult.toolCalls && scanResult.toolCalls.length > 0) {
        stableCount = 0;

        if (!isStreaming) {
          debug('✅ 检测到工具调用且AI停止', scanResult.toolCalls.length + '个');
          __scanPollTimer = null;
          resolve({ toolCalls: scanResult.toolCalls, debugInfo: scanResult.debugInfo });
          return;
        }
      }

      if (currentText === lastText) {
        stableCount++;
      } else {
        stableCount = 0;
        lastText = currentText;
      }

      if (stableCount >= maxStable && !isStreaming) {
        debug('✅ 内容稳定完成', stableCount + '次');
        __scanPollTimer = null;
        resolve({ toolCalls: scanResult.toolCalls || [], debugInfo: scanResult.debugInfo });
        return;
      }

      __scanPollTimer = setTimeout(poll, pollIntervalMs);
    }

    poll();
  }

  function dedupeCalls(calls) {
    var filtered = [];
    for (var i = 0; i < calls.length; i++) {
      var callKey = generateCallKey(calls[i].name, calls[i].arguments);
      if (__executedThisRound[callKey] === undefined) {
        __executedThisRound[callKey] = Date.now();
        filtered.push(calls[i]);
      }
    }
    return filtered;
  }

  function waitForAIOutputComplete() {
    return new Promise(function(resolve) {
      if (__scanPollTimer) {
        clearTimeout(__scanPollTimer);
        __scanPollTimer = null;
      }

      __scanDebugLog = [];
      __startSnapshot = getPageText();
      __executedThisRound = {};
      __scanStarted = true;

      debug('=== 新扫描轮次开始 ===', '');
      debug('快照长度', __startSnapshot.length);
      debug('流式状态', detectStreaming() ? '正在生成' : '已完成');
      debug('快照中含tool_call', __startSnapshot.indexOf('<tool_call') >= 0 ? '是(⚠快照已含)' : '否');

      var isStreaming = detectStreaming();

      if (!isStreaming) {
        debug('⚠ AI已停止输出，直接扫描', '');
        var directResult = scanForToolCalls();
        debug('直接扫描结果', (directResult.toolCalls || []).length + ' 个工具调用');
        resolve({ toolCalls: directResult.toolCalls || [], debugInfo: directResult.debugInfo, debugLog: __scanDebugLog.slice() });
        return;
      }

      debug('⏳ AI仍在输出，开始轮询', '');
      startPolling(resolve, Date.now());
    });
  }

  function resetScanState() {
    if (__scanPollTimer) {
      clearTimeout(__scanPollTimer);
      __scanPollTimer = null;
    }
    __startSnapshot = '';
    __scanStarted = false;
    __executedThisRound = {};
    __scanDebugLog = [];
    console.log('[DS Agent] 扫描状态已重置');
  }

  window.__resetScanState = resetScanState;
  window.__waitForAIOutputComplete = waitForAIOutputComplete;
  window.__scanForToolCalls = scanForToolCalls;
  window.__detectStreaming = detectStreaming;
  window.__findSendButton = findSendButton;
  window.__wasSendButtonJustReturnedToArrow = wasSendButtonJustReturnedToArrow;
  window.__getStreamingCache = function() { return __streamingCache; };

  var __autoWatchActive = false;
  var __autoWatchTimer = null;
  var __autoWatchStableCount = 0;
  var __autoWatchLastText = '';
  var __autoWatchFoundCalls = false;
  var __autoWatchPollCount = 0;
  var __autoWatchSeenStreaming = false;
  var __autoWatchSeenArrowToStop = false;
  var __autoWatchSeenStopToArrow = false;

  function startAutoWatch() {
    if (__autoWatchActive) return;
    __autoWatchActive = true;
    __autoWatchStableCount = 0;
    __autoWatchFoundCalls = false;
    __autoWatchPollCount = 0;
    __autoWatchSeenStreaming = false;
    __autoWatchSeenArrowToStop = false;
    __autoWatchSeenStopToArrow = false;
    __streamingCache = { ts: 0, result: false, prevIsArrow: true, justReturnedToArrow: false };
    debug('auto-watch', '自动监听已启动 (等待按钮arrow→stop→arrow)');
    autoWatchPoll();
  }

  function stopAutoWatch() {
    __autoWatchActive = false;
    if (__autoWatchTimer) {
      clearTimeout(__autoWatchTimer);
      __autoWatchTimer = null;
    }
    debug('auto-watch', '自动监听已停止');
  }

  function autoWatchPoll() {
    if (!__autoWatchActive) return;

    __autoWatchPollCount++;
    var isStreaming = detectStreaming();
    if (isStreaming) {
      __autoWatchSeenStreaming = true;
      __autoWatchSeenArrowToStop = true;
    }

    // 检测按钮从停止变回箭头 — AI生成完毕的信号
    if (wasSendButtonJustReturnedToArrow()) {
      __autoWatchSeenStopToArrow = true;
      debug('auto-watch', '✅ 按钮变回箭头，AI生成完毕');
    }

    var scanResult = scanForToolCalls();
    var hasCalls = scanResult.toolCalls && scanResult.toolCalls.length > 0;
    var currentAIText = (scanResult && scanResult.debugInfo) ? (scanResult.debugInfo.textPreview || '') : '';

    // 如果按钮从箭头→停止→箭头完整走了一遍 → AI肯定已生成完毕
    if (__autoWatchSeenArrowToStop && __autoWatchSeenStopToArrow) {
      debug('auto-watch', '完整的状态转换(arrow→stop→arrow)');
      if (hasCalls) {
        debug('auto-watch', '检测到 ' + scanResult.toolCalls.length + ' 个 tool_call，通知 content.js');
        __autoWatchFoundCalls = true;
        window.postMessage({ type: '__ds_auto_tool_calls', toolCalls: scanResult.toolCalls }, '*');
        stopAutoWatch();
        return;
      } else {
        debug('auto-watch', 'AI已完毕但无 tool_call');
        window.postMessage({ type: '__ds_auto_no_tool_calls' }, '*');
        stopAutoWatch();
        return;
      }
    }

    // 旧逻辑 fallback（防止按钮监控失败时的备用方案）
    if (hasCalls && !isStreaming) {
      if (currentAIText !== __autoWatchLastText) {
        __autoWatchLastText = currentAIText;
        __autoWatchStableCount = 0;
      } else {
        __autoWatchStableCount++;
      }
      if (__autoWatchStableCount >= 2) {
        debug('auto-watch(fallback)', '检测到 ' + scanResult.toolCalls.length + ' 个 tool_call');
        __autoWatchFoundCalls = true;
        window.postMessage({ type: '__ds_auto_tool_calls', toolCalls: scanResult.toolCalls }, '*');
        stopAutoWatch();
        return;
      }
    } else if (!hasCalls && !isStreaming && __autoWatchSeenStreaming) {
      if (currentAIText !== __autoWatchLastText) {
        __autoWatchLastText = currentAIText;
        __autoWatchStableCount = 0;
      } else {
        __autoWatchStableCount++;
      }
      if (__autoWatchStableCount >= 6 && __autoWatchPollCount > 3) {
        debug('auto-watch(fallback)', '内容稳定无 tool_call');
        window.postMessage({ type: '__ds_auto_no_tool_calls' }, '*');
        stopAutoWatch();
        return;
      }
      if (__autoWatchStableCount >= 12) {
        debug('auto-watch(fallback)', '超时');
        window.postMessage({ type: '__ds_auto_no_tool_calls' }, '*');
        stopAutoWatch();
        return;
      }
    } else {
      __autoWatchLastText = currentAIText;
      __autoWatchStableCount = 0;
    }

    __autoWatchTimer = setTimeout(autoWatchPoll, 1200);
  }

  window.addEventListener('message', function(event) {
    if (!event.data || typeof event.data !== 'object') return;

    var data = event.data;

    if (data.type === '__ds_inject_tool') {
      var result = doInject(data.autoSend);
      if (result.success) {
        resetScanState();
      }
      window.postMessage({
        type: '__ds_inject_result',
        requestId: data.requestId,
        result: result
      }, '*');
    }

    if (data.type === '__ds_start_auto_watch') {
      startAutoWatch();
    }

    if (data.type === '__ds_stop_auto_watch') {
      stopAutoWatch();
    }
  });

})();
