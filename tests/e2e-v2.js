var { chromium } = require('playwright-core');

var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  工具调用链路端到端测试 v2                            ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }

  // 刷新页面
  console.log(ts() + ' 刷新页面...');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  // 安装 MAIN world 工具调用处理器
  console.log(ts() + ' 安装 MAIN world 工具调用处理器...');
  await page.evaluate(function() {
    window.__dsParseToolCalls = function(text) {
      if (!text) return [];
      var calls = [];
      var regex = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi;
      var match;
      while ((match = regex.exec(text)) !== null) {
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

    window.__dsInjectResult = function(results) {
      return new Promise(function(resolve) {
        var ta = document.querySelector('textarea');
        if (!ta) { resolve(false); return; }

        var resultText = '[TOOL_RESULT]\n' + JSON.stringify(results, null, 2) + '\n[/TOOL_RESULT]';
        var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(ta, resultText);
        else ta.value = resultText;
        ta.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(function() {
          // 找发送按钮（div[role="button"] with primary style）
          var taR = ta.getBoundingClientRect();
          var btns = Array.from(document.querySelectorAll('div[role="button"]')).filter(function(b) {
            var r = b.getBoundingClientRect();
            return r.width > 0 && Math.abs(r.top - taR.bottom) < 100;
          });
          var sendBtn = btns.find(function(b) {
            return b.className.indexOf('ds-button--primary') >= 0;
          });
          if (sendBtn) {
            sendBtn.click();
            resolve(true);
          } else if (btns.length > 0) {
            btns[btns.length - 1].click();
            resolve(true);
          } else {
            resolve(false);
          }
        }, 300);
      });
    };

    window.__dsToolChainActive = false;
    window.__dsToolChainLog = [];
    window.__dsToolChainResults = null;
    window.__dsSSEEvents = []; // 记录所有 SSE 事件

    window.addEventListener('message', function(e) {
      if (e.data && e.data.source === 'deepseek-tool-agent') {
        window.__dsSSEEvents.push({ type: e.data.type, ts: Date.now(), textLen: (e.data.text || '').length });

        if (e.data.type === '__ds_stream_end') {
          var text = e.data.text || '';
          var toolCalls = window.__dsParseToolCalls(text);

          if (toolCalls.length > 0 && !window.__dsToolChainActive) {
            window.__dsToolChainActive = true;
            window.__dsToolChainLog.push('检测到 ' + toolCalls.length + ' 个工具调用: ' + toolCalls.map(function(c) { return c.name; }).join(', '));

            (async function() {
              var results = [];
              for (var i = 0; i < toolCalls.length; i++) {
                var tc = toolCalls[i];
                window.__dsToolChainLog.push('执行: ' + tc.name + ' ' + JSON.stringify(tc.arguments).substring(0, 60));
                try {
                  var result = await window.__dsExecuteTool(tc);
                  results.push(result);
                  window.__dsToolChainLog.push(tc.name + ': ' + (result.success ? '成功' : '失败 ' + (result.error || '').substring(0, 50)));
                } catch(err) {
                  results.push({ success: false, error: err.message, tool: tc.name });
                  window.__dsToolChainLog.push(tc.name + ' 异常: ' + err.message);
                }
              }

              window.__dsToolChainLog.push('注入结果...');
              var injectOk = await window.__dsInjectResult(results);
              window.__dsToolChainLog.push('注入: ' + (injectOk ? '成功' : '失败'));

              window.__dsToolChainActive = false;
              window.__dsToolChainResults = results;
            })();
          }
        }
      }
    });
  });

  // Step 1: 通过 postMessage 注入工具提示词
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
  console.log(ts() + ' 注入结果: ' + JSON.stringify(injectResult));

  if (injectResult && (injectResult.success || injectResult.alreadyInjected)) {
    console.log(ts() + ' 工具提示词已注入，发送...');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    console.log(ts() + ' 已发送');
    await page.waitForTimeout(15000);
  } else {
    console.log(ts() + ' 注入失败，继续测试...');
  }

  // Step 2: 发送触发工具调用的消息
  var testMsg = '请用 list_dir 列出 C:\\ 目录';
  console.log(ts() + ' 发送测试消息: "' + testMsg + '"');
  await page.click('textarea');
  await page.waitForTimeout(300);
  await page.keyboard.type(testMsg, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log(ts() + ' 消息已发送');

  // Step 3: 等待工具调用链路
  console.log(ts() + ' 等待工具调用链路...');
  var sseStarted = false;
  var sseEnded = false;
  var toolChainTriggered = false;

  for (var i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);

    var info = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      return {
        sseActive: ss.active || false,
        sseTextLen: (ss.accumulatedText || '').length,
        sseTextPreview: (ss.accumulatedText || '').substring(0, 200),
        sseEvents: (window.__dsSSEEvents || []).slice(-5),
        toolChainActive: window.__dsToolChainActive || false,
        toolChainLog: window.__dsToolChainLog || [],
        toolChainResults: window.__dsToolChainResults || null
      };
    });

    if (info.sseActive && !sseStarted) {
      sseStarted = true;
      console.log(ts() + ' SSE 流开始');
    }
    if (!info.sseActive && sseStarted && !sseEnded) {
      sseEnded = true;
      console.log(ts() + ' SSE 流结束 (len=' + info.sseTextLen + ')');
    }
    if (info.toolChainLog.length > 0 && !toolChainTriggered) {
      toolChainTriggered = true;
      console.log(ts() + ' 工具调用链路已触发!');
    }

    // 每5轮或关键事件时打印
    if (i % 5 === 0 || toolChainTriggered || info.toolChainResults) {
      console.log(ts() + ' sse=' + info.sseTextLen + '(' + (info.sseActive ? 'active' : 'done') + ')' +
        ' chain=' + info.toolChainActive + ' logCount=' + info.toolChainLog.length);

      if (info.sseEvents.length > 0) {
        console.log('  SSE事件: ' + info.sseEvents.map(function(e) { return e.type + '(' + e.textLen + ')'; }).join(', '));
      }

      if (info.toolChainLog.length > 0) {
        info.toolChainLog.forEach(function(l) { console.log('  → ' + l); });
      }
    }

    if (info.toolChainResults) {
      console.log(ts() + ' ═══ 工具执行结果 ═══');
      console.log(JSON.stringify(info.toolChainResults, null, 2));
      break;
    }
  }

  if (!toolChainTriggered) {
    console.log(ts() + ' ❌ 工具调用链路未触发');

    // 检查 SSE 事件
    var sseInfo = await page.evaluate(function() {
      return {
        events: window.__dsSSEEvents || [],
        streamState: window.__ds_streamState ? window.__ds_streamState() : {}
      };
    });
    console.log('SSE 事件:');
    sseInfo.events.forEach(function(e) { console.log('  ' + e.type + ' textLen=' + e.textLen); });
    console.log('Stream State: ' + JSON.stringify(sseInfo.streamState));
  }

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
