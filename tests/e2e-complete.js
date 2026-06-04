var { chromium } = require('playwright-core');

var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  工具调用链路完整测试 (含日志+完整返回)               ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }

  // 刷新页面
  console.log(ts() + ' 刷新页面...');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  // 安装 MAIN world 完整工具调用处理器（含完整返回格式）
  console.log(ts() + ' 安装完整工具调用处理器...');
  await page.evaluate(function() {
    // 工具调用解析（修复 < 丢失）
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

    // 获取用户原始消息
    window.__dsGetLatestUserMessage = function() {
      var userMsgs = document.querySelectorAll('[class*="user-message"], [class*="message-user"], [data-role="user"]');
      if (userMsgs.length > 0) {
        return (userMsgs[userMsgs.length - 1].innerText || '').trim();
      }
      // fallback: 查找所有消息中的用户消息
      var allMsgs = document.querySelectorAll('.fbb737a4, [class*="message-content"]');
      for (var i = allMsgs.length - 1; i >= 0; i--) {
        var text = (allMsgs[i].innerText || '').trim();
        if (text && text.indexOf('tool_') < 0 && text.indexOf('<tool_') < 0) {
          return text.substring(0, 200);
        }
      }
      return '';
    };

    // 结果注入（完整格式：工具结果 + 用户原始消息 + 重试引导）
    window.__dsInjectResult = function(results, toolCalls) {
      return new Promise(function(resolve) {
        var ta = document.querySelector('textarea');
        if (!ta) { resolve({ ok: false, reason: 'no textarea' }); return; }

        // 构建完整返回内容（与扩展 injectResults 一致）
        var responseText = '';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          responseText += '<tool_response status="' + (r.success !== false ? 'ok' : 'error') + '">\n';
          responseText += JSON.stringify(r.success ? (r.output || r.data || r) : { error: r.error || '未知错误' }, null, 2);
          responseText += '\n</tool_response>\n';
        }

        // 用户原始消息
        var userTask = window.__dsGetLatestUserMessage();
        if (userTask && userTask.length > 0) {
          responseText += '\n---\n';
          responseText += '原始任务: ' + userTask + '\n';

          // 检查是否有错误
          var hasError = results.some(function(r) { return r.success === false; });
          if (hasError) {
            responseText += '\n⚠️ 部分工具执行失败。请分析原因并尝试以下方法：\n';
            responseText += '1. 使用备用命令（如 exec_command 代替 read_file）\n';
            responseText += '2. 等待3秒后重试相同的工具调用\n';
            responseText += '3. 如果多次失败，告知用户可能的连接问题\n';
          }
          responseText += '\n请根据以上工具调用结果和用户原始任务继续完成任务，如果已完成则总结汇报。如果工具失败请分析原因并尝试其他方法。';
        }

        // 写入 textarea
        var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(ta, responseText);
        else ta.value = responseText;
        ta.dispatchEvent(new Event('input', { bubbles: true }));

        window.__dsToolChainLog.push('注入内容 (' + responseText.length + '字): ' + responseText.substring(0, 150).replace(/\n/g, '\\n'));

        setTimeout(function() {
          // 找发送按钮
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
            resolve({ ok: false, reason: 'no send button' });
          }
        }, 500);
      });
    };

    // SSE 监听
    window.__dsToolChainActive = false;
    window.__dsToolChainLog = [];
    window.__dsToolChainResults = null;

    window.__dsToolChainHandler = function(e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.source !== 'deepseek-tool-agent') return;
      if (e.data.type !== '__ds_stream_end') return;

      var text = e.data.text || '';
      var toolCalls = window.__dsParseToolCalls(text);

      window.__dsToolChainLog.push('[SSE] 流结束 textLen=' + text.length + ' toolCalls=' + toolCalls.length);

      if (toolCalls.length > 0 && !window.__dsToolChainActive) {
        window.__dsToolChainActive = true;
        window.__dsToolChainLog.push('[执行] 开始处理 ' + toolCalls.length + ' 个工具调用: ' + toolCalls.map(function(c) { return c.name; }).join(', '));

        (async function() {
          var results = [];
          for (var i = 0; i < toolCalls.length; i++) {
            var tc = toolCalls[i];
            window.__dsToolChainLog.push('[执行] ⚡ [' + (i+1) + '/' + toolCalls.length + '] ' + tc.name + ' ' + JSON.stringify(tc.arguments).substring(0, 80));
            try {
              var result = await window.__dsExecuteTool(tc);
              results.push(result);
              var icon = result.success ? '✓' : '✗';
              window.__dsToolChainLog.push('[执行] ' + icon + ' ' + tc.name + ': ' + (result.success ? '成功' : '失败 - ' + (result.error || '').substring(0, 60)));
              if (result.success && result.output) {
                var outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
                window.__dsToolChainLog.push('[输出] ' + outputStr.substring(0, 150));
              }
            } catch(err) {
              results.push({ success: false, error: err.message, tool: tc.name });
              window.__dsToolChainLog.push('[执行] ✗ ' + tc.name + ' 异常: ' + err.message);
            }
          }

          window.__dsToolChainLog.push('[注入] 开始注入结果...');
          var injectResult = await window.__dsInjectResult(results, toolCalls);
          window.__dsToolChainLog.push('[注入] 结果: ' + JSON.stringify(injectResult));

          window.__dsToolChainActive = false;
          window.__dsToolChainResults = results;
        })();
      }
    };

    if (window.__dsToolChainHandlerRef) {
      window.removeEventListener('message', window.__dsToolChainHandlerRef);
    }
    window.__dsToolChainHandlerRef = window.__dsToolChainHandler;
    window.addEventListener('message', window.__dsToolChainHandler);
  });

  console.log(ts() + ' 处理器已安装');

  // Step 1: 注入工具提示词
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
    console.log(ts() + ' 发送工具提示词...');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(15000);
  }

  // Step 2: 发送测试消息
  var testMsg = '请用 list_dir 列出 C:\\ 目录';
  console.log(ts() + ' 发送: "' + testMsg + '"');
  await page.click('textarea');
  await page.waitForTimeout(300);
  await page.keyboard.type(testMsg, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log(ts() + ' 已发送');

  // Step 3: 等待工具调用链路
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

    // 打印新日志
    if (info.toolChainLog.length > 0) {
      console.log(ts() + ' 日志:');
      info.toolChainLog.forEach(function(l) { console.log('  ' + l); });
      // 清空已打印的日志
      await page.evaluate(function() { window.__dsToolChainLog = []; });
    }

    if (info.toolChainResults) {
      console.log(ts() + ' ═══ 工具执行结果 ═══');
      info.toolChainResults.forEach(function(r) {
        console.log('  ' + (r.tool || '?') + ': ' + (r.success ? '成功' : '失败 ' + (r.error || '').substring(0, 80)));
        if (r.output) {
          var outputStr = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
          console.log('  output: ' + outputStr.substring(0, 300));
        }
      });
      break;
    }

    if (i % 15 === 0 && i > 0) {
      console.log(ts() + ' 等待中... (round ' + i + ')');
    }
  }

  // Step 4: 等待 AI 对工具结果的回复
  console.log(ts() + ' 等待 AI 回复工具结果...');
  await page.waitForTimeout(15000);

  var aiReply = await page.evaluate(function() {
    var msgs = document.querySelectorAll('[class*="ds-markdown--block"], [class*="assistant-message"]');
    if (msgs.length > 0) {
      return (msgs[msgs.length - 1].innerText || '').substring(0, 500);
    }
    return '';
  });
  console.log(ts() + ' AI 最终回复: ' + aiReply.substring(0, 300).replace(/\n/g, '\\n'));

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
