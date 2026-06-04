var { chromium } = require('playwright-core');

var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  DeepSeek 专家模式+深度思考 工具调用测试 v4           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }

  // 创建新会话
  console.log(ts() + ' 创建新会话...');
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Step 1: 切换到专家模式
  console.log(ts() + ' 切换到专家模式...');
  var expertResult = await page.evaluate(function() {
    // 查找含"专家模式"文字的元素并点击
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].innerText || '').trim() === '专家模式') {
        // 点击包含这个 span 的可点击父元素
        var target = spans[i].closest('[class*="_9f2341b"]') || spans[i].parentElement;
        if (target) {
          target.click();
          return { found: true, method: 'span parent', text: '专家模式' };
        }
      }
    }
    return { found: false };
  });
  console.log(ts() + ' 专家模式: ' + JSON.stringify(expertResult));
  await page.waitForTimeout(2000);

  // Step 2: 开启深度思考
  console.log(ts() + ' 开启深度思考...');
  var thinkResult = await page.evaluate(function() {
    var toggle = document.querySelector('.ds-toggle-button');
    if (toggle) {
      var text = (toggle.innerText || '').trim();
      var isSelected = toggle.className.indexOf('selected') >= 0;
      if (!isSelected) {
        toggle.click();
        return { found: true, text: text, wasSelected: false, clicked: true };
      }
      return { found: true, text: text, wasSelected: true, clicked: false };
    }
    return { found: false };
  });
  console.log(ts() + ' 深度思考: ' + JSON.stringify(thinkResult));
  await page.waitForTimeout(2000);

  // 验证当前模式
  var verifyResult = await page.evaluate(function() {
    var expertSpan = null;
    var quickSpan = null;
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].innerText || '').trim();
      if (t === '专家模式') expertSpan = spans[i].closest('[class*="_9f2341b"]');
      if (t === '快速模式') quickSpan = spans[i].closest('[class*="_9f2341b"]');
    }
    var isExpert = expertSpan && expertSpan.className.indexOf('_31a22b0') >= 0;
    var isQuick = quickSpan && quickSpan.className.indexOf('_31a22b0') >= 0;

    var toggle = document.querySelector('.ds-toggle-button');
    var isDeepThink = toggle && toggle.className.indexOf('selected') >= 0;

    return { isExpert: isExpert, isQuick: isQuick, isDeepThink: isDeepThink };
  });
  console.log(ts() + ' 验证: 专家=' + verifyResult.isExpert + ' 快速=' + verifyResult.isQuick + ' 深度思考=' + verifyResult.isDeepThink);

  // Step 3: 安装工具调用处理器
  console.log(ts() + ' 安装工具调用处理器...');
  await page.evaluate(function() {
    window.__dsParseToolCalls = function(text) {
      if (!text) return [];
      var fixedText = text;
      fixedText = fixedText.replace(/(^|[^<])(tool_call\s+name=["'])/gi, '$1<$2');
      fixedText = fixedText.replace(/(^|[^<])(\/tool_call>)/gi, '$1<$2');
      var calls = [];
      var regex = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi;
      var match;
      while ((match = regex.exec(fixedText)) !== null) {
        try {
          var args = JSON.parse(match[2].trim());
          calls.push({ name: match[1], arguments: args });
        } catch(e) {
          calls.push({ name: match[1], arguments: match[2].trim(), parseError: true });
        }
      }
      return calls;
    };

    window.__dsExecuteTool = function(toolCall) {
      return new Promise(function(resolve) {
        fetch('http://localhost:3002/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: toolCall.name, args: toolCall.arguments })
        }).then(function(r) { return r.json(); })
          .then(function(data) { resolve(data); })
          .catch(function(e) { resolve({ success: false, error: e.message, tool: toolCall.name }); });
      });
    };

    window.__dsGetLatestUserMessage = function() {
      var userMsgs = document.querySelectorAll('[class*="user-message"], [class*="message-user"], [data-role="user"]');
      if (userMsgs.length > 0) return (userMsgs[userMsgs.length - 1].innerText || '').trim();
      return '';
    };

    window.__dsInjectResult = function(results) {
      return new Promise(function(resolve) {
        var ta = document.querySelector('textarea');
        if (!ta) { resolve({ ok: false, reason: 'no textarea' }); return; }

        var responseText = '';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          responseText += '<tool_response status="' + (r.success !== false ? 'ok' : 'error') + '">\n';
          responseText += JSON.stringify(r.success ? (r.output || r.data || r) : { error: r.error || '未知错误' }, null, 2);
          responseText += '\n</tool_response>\n';
        }

        var userTask = window.__dsGetLatestUserMessage();
        if (userTask) {
          responseText += '\n---\n原始任务: ' + userTask + '\n';
          responseText += '\n请根据以上工具调用结果和用户原始任务继续完成任务，如果已完成则总结汇报。';
        }

        var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(ta, responseText);
        else ta.value = responseText;
        ta.dispatchEvent(new Event('input', { bubbles: true }));

        window.__dsToolChainLog.push('注入内容 (' + responseText.length + '字)');

        setTimeout(function() {
          var taR = ta.getBoundingClientRect();
          var btns = Array.from(document.querySelectorAll('div[role="button"]')).filter(function(b) {
            var r = b.getBoundingClientRect();
            return r.width > 0 && Math.abs(r.top - taR.bottom) < 100;
          });
          var sendBtn = btns.find(function(b) { return b.className.indexOf('ds-button--primary') >= 0; });
          if (sendBtn) { sendBtn.click(); resolve({ ok: true, method: 'primary button' }); }
          else if (btns.length > 0) { btns[btns.length - 1].click(); resolve({ ok: true, method: 'last button' }); }
          else { resolve({ ok: false, reason: 'no send button' }); }
        }, 500);
      });
    };

    window.__dsToolChainActive = false;
    window.__dsToolChainLog = [];
    window.__dsToolChainResults = null;

    window.__dsToolChainHandler = function(e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.source !== 'deepseek-tool-agent') return;
      if (e.data.type !== '__ds_stream_end') return;

      var text = e.data.text || '';
      var finishReason = e.data.finishReason || '';

      var thinkStart = text.indexOf('[思考]');
      var thinkLen = 0;
      if (thinkStart >= 0) {
        var toolCallStart = text.indexOf('tool_call', thinkStart);
        thinkLen = (toolCallStart >= 0 ? toolCallStart : text.length) - thinkStart;
      }

      window.__dsToolChainLog.push('[SSE] 流结束 textLen=' + text.length + ' reason=' + finishReason);
      if (thinkStart >= 0) {
        window.__dsToolChainLog.push('[SSE] ★ 思考内容 (约' + thinkLen + '字)');
        window.__dsToolChainLog.push('[SSE] 思考预览: ' + text.substring(thinkStart, thinkStart + Math.min(200, thinkLen)).replace(/\n/g, '\\n'));
      } else {
        window.__dsToolChainLog.push('[SSE] 思考内容: 无');
      }
      window.__dsToolChainLog.push('[SSE] 文本后300字: ' + text.substring(Math.max(0, text.length - 300)).replace(/\n/g, '\\n'));

      var toolCalls = window.__dsParseToolCalls(text);
      window.__dsToolChainLog.push('[SSE] 解析到 ' + toolCalls.length + ' 个工具调用');

      if (toolCalls.length > 0 && !window.__dsToolChainActive) {
        window.__dsToolChainActive = true;
        window.__dsToolChainLog.push('[执行] 开始处理 ' + toolCalls.length + ' 个工具调用');

        (async function() {
          var results = [];
          for (var i = 0; i < toolCalls.length; i++) {
            var tc = toolCalls[i];
            window.__dsToolChainLog.push('[执行] ⚡ ' + tc.name + ' ' + JSON.stringify(tc.arguments).substring(0, 80));
            try {
              var result = await window.__dsExecuteTool(tc);
              results.push(result);
              window.__dsToolChainLog.push('[执行] ' + (result.success ? '✓' : '✗') + ' ' + tc.name);
              if (result.success && result.output) {
                var outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
                window.__dsToolChainLog.push('[输出] ' + outputStr.substring(0, 150));
              }
            } catch(err) {
              results.push({ success: false, error: err.message, tool: tc.name });
              window.__dsToolChainLog.push('[执行] ✗ ' + tc.name + ' 异常: ' + err.message);
            }
          }

          window.__dsToolChainLog.push('[注入] 开始注入...');
          var injectResult = await window.__dsInjectResult(results);
          window.__dsToolChainLog.push('[注入] 结果: ' + JSON.stringify(injectResult));

          window.__dsToolChainActive = false;
          window.__dsToolChainResults = results;
        })();
      } else if (toolCalls.length === 0) {
        window.__dsToolChainLog.push('[SSE] 未检测到工具调用');
      }
    };

    if (window.__dsToolChainHandlerRef) window.removeEventListener('message', window.__dsToolChainHandlerRef);
    window.__dsToolChainHandlerRef = window.__dsToolChainHandler;
    window.addEventListener('message', window.__dsToolChainHandler);
  });

  // Step 4: 注入工具提示词
  console.log(ts() + ' 注入工具提示词...');
  var injectResult = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 10000);
      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_inject_result') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(e.data.result || { success: false });
        }
      });
      window.postMessage({ type: '__ds_inject_tool', autoSend: false, requestId: Date.now() }, '*');
    });
  });
  console.log(ts() + ' 注入: ' + JSON.stringify(injectResult));

  if (injectResult && (injectResult.success || injectResult.alreadyInjected)) {
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    console.log(ts() + ' 工具提示词已发送，等待AI回复...');
    await page.waitForTimeout(20000);
  }

  // Step 5: 发送测试消息
  var testMsg = '请用 read_file 读取 C:\\Windows\\win.ini 的内容';
  console.log(ts() + ' 发送: "' + testMsg + '"');
  await page.click('textarea');
  await page.waitForTimeout(300);
  await page.keyboard.type(testMsg, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log(ts() + ' 已发送');

  // Step 6: 等待工具调用链路
  console.log(ts() + ' 等待工具调用链路（专家模式+深度思考可能需要较长时间）...');
  var toolChainCompleted = false;
  for (var i = 0; i < 120; i++) {
    await page.waitForTimeout(2000);

    var info = await page.evaluate(function() {
      return {
        toolChainActive: window.__dsToolChainActive || false,
        toolChainLog: window.__dsToolChainLog || [],
        toolChainResults: window.__dsToolChainResults || null
      };
    });

    if (info.toolChainLog.length > 0) {
      info.toolChainLog.forEach(function(l) { console.log(ts() + ' ' + l); });
      await page.evaluate(function() { window.__dsToolChainLog = []; });
    }

    if (info.toolChainResults) {
      console.log(ts() + ' ═══ 工具执行结果 ═══');
      info.toolChainResults.forEach(function(r) {
        console.log('  ' + (r.tool || '?') + ': ' + (r.success ? '成功' : '失败 ' + (r.error || '').substring(0, 80)));
      });
      toolChainCompleted = true;
      break;
    }

    if (i % 15 === 0 && i > 0) {
      console.log(ts() + ' 等待中... (round ' + i + ')');
    }
  }

  if (!toolChainCompleted) {
    console.log(ts() + ' ⚠️ 工具调用链路未完成');
  }

  // Step 7: 等待 AI 回复
  console.log(ts() + ' 等待 AI 回复工具结果...');
  await page.waitForTimeout(30000);

  var finalInfo = await page.evaluate(function() {
    var msgs = document.querySelectorAll('[class*="ds-markdown--block"], [class*="assistant-message"]');
    var lastMsg = msgs.length > 0 ? (msgs[msgs.length - 1].innerText || '').substring(0, 500) : '';

    var thinkContents = document.querySelectorAll('.ds-think-content, [class*="think-content"]');
    var thinkText = '';
    if (thinkContents.length > 0) {
      thinkText = (thinkContents[thinkContents.length - 1].innerText || '').substring(0, 200);
    }

    // 检查模式
    var expertSpan = null;
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].innerText || '').trim() === '专家模式') {
        expertSpan = spans[i].closest('[class*="_9f2341b"]');
      }
    }
    var isExpert = expertSpan && expertSpan.className.indexOf('_31a22b0') >= 0;
    var toggle = document.querySelector('.ds-toggle-button');
    var isDeepThink = toggle && toggle.className.indexOf('selected') >= 0;

    return { lastMsg: lastMsg, thinkText: thinkText, thinkCount: thinkContents.length, isExpert: isExpert, isDeepThink: isDeepThink };
  });

  console.log(ts() + ' 模式: 专家=' + finalInfo.isExpert + ' 深度思考=' + finalInfo.isDeepThink);
  console.log(ts() + ' 思考内容元素: ' + finalInfo.thinkCount + ' 个');
  if (finalInfo.thinkText) {
    console.log(ts() + ' 思考预览: ' + finalInfo.thinkText.substring(0, 150).replace(/\n/g, '\\n'));
  }
  console.log(ts() + ' AI 最终回复: ' + finalInfo.lastMsg.substring(0, 300).replace(/\n/g, '\\n'));

  console.log(ts() + ' 测试完成');
  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
