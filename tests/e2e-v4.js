var { chromium } = require('playwright-core');

var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  工具调用链路端到端测试 v4 (修复<丢失)               ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });

  // 安装修复后的工具调用处理器
  console.log(ts() + ' 安装修复后的工具调用处理器...');
  await page.evaluate(function() {
    // 修复后的工具调用解析（补上丢失的 <）
    window.__dsParseToolCalls = function(text) {
      if (!text) return [];
      // 修复 SSE 拦截器丢失的 < 符号
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

    window.__dsInjectResult = function(results) {
      return new Promise(function(resolve) {
        var ta = document.querySelector('textarea');
        if (!ta) { resolve({ ok: false, reason: 'no textarea' }); return; }

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
            resolve({ ok: true, method: 'primary button' });
          } else if (btns.length > 0) {
            btns[btns.length - 1].click();
            resolve({ ok: true, method: 'last button' });
          } else {
            // 用 Playwright 的 Enter 键
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            resolve({ ok: true, method: 'Enter key' });
          }
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
      var toolCalls = window.__dsParseToolCalls(text);

      window.__dsToolChainLog.push('SSE end: textLen=' + text.length + ' toolCalls=' + toolCalls.length +
        (toolCalls.length > 0 ? ' names=' + toolCalls.map(function(c) { return c.name; }).join(',') : ''));

      if (toolCalls.length > 0 && !window.__dsToolChainActive) {
        window.__dsToolChainActive = true;
        window.__dsToolChainLog.push('开始执行 ' + toolCalls.length + ' 个工具调用');

        (async function() {
          var results = [];
          for (var i = 0; i < toolCalls.length; i++) {
            var tc = toolCalls[i];
            window.__dsToolChainLog.push('执行: ' + tc.name + ' ' + JSON.stringify(tc.arguments).substring(0, 80));
            try {
              var result = await window.__dsExecuteTool(tc);
              results.push(result);
              window.__dsToolChainLog.push(tc.name + ': ' + (result.success ? '成功' : '失败 ' + (result.error || '').substring(0, 60)));
            } catch(err) {
              results.push({ success: false, error: err.message, tool: tc.name });
              window.__dsToolChainLog.push(tc.name + ' 异常: ' + err.message);
            }
          }

          window.__dsToolChainLog.push('注入结果...');
          var injectResult = await window.__dsInjectResult(results);
          window.__dsToolChainLog.push('注入: ' + JSON.stringify(injectResult));

          window.__dsToolChainActive = false;
          window.__dsToolChainResults = results;
        })();
      }
    };

    // 移除旧的处理器（如果有）
    if (window.__dsToolChainHandlerRef) {
      window.removeEventListener('message', window.__dsToolChainHandlerRef);
    }
    window.__dsToolChainHandlerRef = window.__dsToolChainHandler;
    window.addEventListener('message', window.__dsToolChainHandler);
  });

  console.log(ts() + ' 处理器已安装');

  // 发送消息
  var testMsg = '请用 list_dir 列出 C:\\ 目录';
  console.log(ts() + ' 发送: "' + testMsg + '"');
  await page.click('textarea');
  await page.waitForTimeout(300);
  await page.keyboard.type(testMsg, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log(ts() + ' 已发送');

  // 等待
  console.log(ts() + ' 等待工具调用链路...');
  for (var i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);

    var info = await page.evaluate(function() {
      return {
        toolChainActive: window.__dsToolChainActive || false,
        toolChainLog: window.__dsToolChainLog || [],
        toolChainResults: window.__dsToolChainResults || null
      };
    });

    if (info.toolChainLog.length > 0 && i < 5) {
      console.log(ts() + ' 日志:');
      info.toolChainLog.forEach(function(l) { console.log('  → ' + l); });
    }

    if (info.toolChainResults) {
      console.log(ts() + ' ═══ 工具执行结果 ═══');
      info.toolChainResults.forEach(function(r) {
        console.log('  ' + (r.tool || '?') + ': ' + (r.success ? '成功' : '失败 ' + (r.error || '').substring(0, 80)));
        if (r.output) console.log('  output: ' + (typeof r.output === 'string' ? r.output.substring(0, 200) : JSON.stringify(r.output).substring(0, 200)));
      });
      break;
    }

    if (i % 15 === 0 && i > 0) {
      console.log(ts() + ' 等待中... (round ' + i + ', logCount=' + info.toolChainLog.length + ')');
      if (info.toolChainLog.length > 0) {
        info.toolChainLog.slice(-3).forEach(function(l) { console.log('  → ' + l); });
      }
    }
  }

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
