var { chromium } = require('playwright-core');

var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  工具调用链路端到端测试                               ║');
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
    // 工具调用解析
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

    // 工具执行
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

    // 结果注入
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
          // 点击发送按钮（div[role="button"]）
          var taR = ta.getBoundingClientRect();
          var btns = Array.from(document.querySelectorAll('div[role="button"]')).filter(function(b) {
            var r = b.getBoundingClientRect();
            return r.width > 0 && Math.abs(r.top - taR.bottom) < 100;
          });
          // 找 primary 样式的按钮
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

    // SSE 监听
    window.__dsToolChainActive = false;
    window.__dsToolChainLog = [];
    window.__dsToolChainResults = null;

    window.addEventListener('message', function(e) {
      if (e.data && e.data.source === 'deepseek-tool-agent' && e.data.type === '__ds_stream_end') {
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
                window.__dsToolChainLog.push(tc.name + ' 完成: ' + (result.success ? '成功' : '失败'));
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
    });
  });

  // Step 1: 注入工具提示词
  console.log(ts() + ' 注入工具提示词...');
  // 点击面板上的注入按钮
  var injectBtn = await page.$('#__ds-btn-inject-tools');
  if (injectBtn) {
    await injectBtn.click();
    console.log(ts() + ' 已点击注入按钮');
    await page.waitForTimeout(1000);

    // 发送工具提示词
    await page.keyboard.press('Enter');
    console.log(ts() + ' 已发送工具提示词');

    // 等待 AI 回复
    await page.waitForTimeout(15000);
    console.log(ts() + ' 工具提示词已发送，AI 应该已理解工具格式');
  } else {
    console.log(ts() + ' 未找到注入按钮，跳过工具提示词注入');
  }

  // Step 2: 发送触发工具调用的消息
  var testMsg = '请用 list_dir 列出 C:\\ 目录';
  console.log(ts() + ' 发送测试消息: "' + testMsg + '"');

  // 使用 Playwright 的 fill + press
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
      var ms = window.__ds_monitorState || {};
      return {
        sseActive: ss.active || false,
        sseTextLen: (ss.accumulatedText || '').length,
        sseTextPreview: (ss.accumulatedText || '').substring(0, 200),
        monitorState: ms.state || '?',
        monitorToolCalls: ms.toolCalls || 0,
        monitorExecResults: ms.execResults || 0,
        toolChainActive: window.__dsToolChainActive || false,
        toolChainLog: window.__dsToolChainLog || [],
        toolChainResults: window.__dsToolChainResults || null
      };
    });

    // 检测 SSE 开始
    if (info.sseActive && !sseStarted) {
      sseStarted = true;
      console.log(ts() + ' SSE 流开始');
    }

    // 检测 SSE 结束
    if (!info.sseActive && sseStarted && !sseEnded) {
      sseEnded = true;
      console.log(ts() + ' SSE 流结束 (len=' + info.sseTextLen + ')');
      if (info.sseTextPreview.indexOf('tool_call') >= 0) {
        console.log(ts() + ' SSE 文本包含 tool_call!');
      }
    }

    // 检测工具调用链路
    if (info.toolChainLog.length > 0 && !toolChainTriggered) {
      toolChainTriggered = true;
      console.log(ts() + ' 工具调用链路已触发!');
    }

    // 每10轮打印状态
    if (i % 10 === 0 || toolChainTriggered || info.toolChainResults) {
      console.log(ts() + ' sse=' + info.sseTextLen + '(' + (info.sseActive ? 'active' : 'done') + ')' +
        ' monitor=' + info.monitorState +
        ' chain=' + info.toolChainActive +
        ' logCount=' + info.toolChainLog.length);

      if (info.toolChainLog.length > 0) {
        info.toolChainLog.slice(-5).forEach(function(l) {
          console.log('  → ' + l);
        });
      }
    }

    // 工具执行完成
    if (info.toolChainResults) {
      console.log(ts() + ' ═══ 工具执行结果 ═══');
      console.log(JSON.stringify(info.toolChainResults, null, 2));
      break;
    }
  }

  if (!toolChainTriggered) {
    console.log(ts() + ' ❌ 工具调用链路未触发');
    console.log('SSE 文本: ' + (await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      return (ss.accumulatedText || '').substring(0, 300);
    })));
  }

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
