var { chromium } = require('playwright-core');
var http = require('http');

var T0 = Date.now();
function ts() { return ((Date.now() - T0) / 1000).toFixed(1); }
function p(msg) { console.log('[' + ts() + 's] ' + msg); }

function httpGET(url) {
  return new Promise(function(resolve) {
    var req = http.get(url, function(res) {
      var body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(3000, function() { req.destroy(); resolve(null); });
  });
}

// 通过 postMessage 查询 monitor 状态
async function queryMonitor(page) {
  return await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() {
        resolve({
          state: (window.__ds_monitorState || {}).state || 'unknown',
          sseActive: window.__ds_streamState ? window.__ds_streamState().active : false,
          sseTextLen: window.__ds_streamState ? (window.__ds_streamState().accumulatedText || '').length : 0,
          sseEndTextLen: 0
        });
      }, 2000);

      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_test_state_response') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve({
            state: e.data.state,
            pollCount: e.data.pollCount || 0,
            stableCount: e.data.stableCount || 0,
            aiStarted: e.data.aiStarted || false,
            lastAiTextLen: e.data.lastAiTextLen || 0,
            toolChainIterations: e.data.toolChainIterations || 0,
            noToolCallWaitCount: e.data.noToolCallWaitCount || 0,
            currentRoundToolCalls: e.data.currentRoundToolCalls || 0,
            currentRoundExecResults: e.data.currentRoundExecResults || 0,
            sseActive: window.__ds_streamState ? window.__ds_streamState().active : false,
            sseTextLen: window.__ds_streamState ? (window.__ds_streamState().accumulatedText || '').length : 0
          });
        }
      });
      window.postMessage({ type: '__ds_test_query_state' }, '*');
    });
  });
}

// 发送消息到 DeepSeek
async function sendMessage(page, text) {
  await page.evaluate(function(t) {
    var el = document.querySelector('textarea');
    if (!el) return false;
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, t);
    else el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: t, inputType: 'insertText' }));
    return true;
  }, text);
  await page.waitForTimeout(600);
  // 点击发送按钮
  var clicked = await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    var taR = ta ? ta.getBoundingClientRect() : { bottom: 0, right: 0 };
    var btns = Array.from(document.querySelectorAll('button')).filter(function(b) {
      return !b.disabled && b.getBoundingClientRect().width > 0;
    });
    var best = null, bs = 0;
    btns.forEach(function(b) {
      var r = b.getBoundingClientRect();
      var svg = !!b.querySelector('svg');
      var empty = !(b.textContent || '').trim();
      var near = Math.abs(r.top - taR.bottom) < 150;
      var s = 0;
      if (svg && empty && near) s = 100;
      else if (svg && near) s = 70;
      else if (svg && empty) s = 40;
      if (s > bs) { bs = s; best = b; }
    });
    if (best && bs >= 40) { best.click(); return true; }
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return false;
  });
  await page.waitForTimeout(500);
  return clicked;
}

// 等待 AI 回复完成（含工具调用链）
async function waitForToolChain(page, timeout) {
  var deadline = Date.now() + (timeout || 180000);
  var lastSseLen = 0;
  var stableCount = 0;
  var phase = 'waiting_ai'; // waiting_ai → ai_done → tool_executing → tool_injected → ai_final → done
  var toolCallsDetected = 0;
  var toolExecResults = 0;
  var round = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    round++;

    var info = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      var ms = window.__ds_monitorState || {};
      var logEl = document.getElementById('__ds-log-area');
      var logText = logEl ? (logEl.innerText || '').substring(0, 800) : '';
      return {
        sseActive: ss.active || false,
        sseLen: (ss.accumulatedText || '').length,
        sseEndText: (ss.accumulatedText || '').substring(0, 300),
        finishReason: ss.finishReason || '',
        monitorState: ms.state || '?',
        monitorToolCalls: ms.toolCalls || 0,
        monitorToolNames: ms.toolNames || [],
        monitorExecResults: ms.execResults || 0,
        logPreview: logText
      };
    });

    // 检查 SSE 文本中是否有 tool_call
    var sseHasToolCall = info.sseEndText.indexOf('<tool_call') >= 0 ||
                         info.sseEndText.indexOf('tool_call') >= 0;

    if (info.sseLen !== lastSseLen) {
      lastSseLen = info.sseLen;
      stableCount = 0;
    } else if (!info.sseActive) {
      stableCount++;
    }

    // 每5轮打印状态
    if (round % 5 === 0 || info.monitorState !== '?' || sseHasToolCall) {
      p('round#' + round + ' phase=' + phase +
        ' sse=' + info.sseLen + '(' + (info.sseActive ? 'active' : 'done') + ')' +
        ' monitor=' + info.monitorState +
        ' tools=' + info.monitorToolCalls +
        ' exec=' + info.monitorExecResults +
        ' stable=' + stableCount +
        (sseHasToolCall ? ' [TOOL_CALL_IN_SSE]' : ''));
    }

    // 状态机
    if (phase === 'waiting_ai') {
      if (info.sseLen > 0) {
        phase = 'ai_streaming';
        p('AI 开始生成...');
      }
    }

    if (phase === 'ai_streaming') {
      if (!info.sseActive && stableCount >= 2) {
        phase = 'ai_done';
        p('AI 流式输出结束 (sseLen=' + info.sseLen + ')');
        if (sseHasToolCall) {
          p('SSE 文本包含 tool_call 标签！');
        }
      }
    }

    if (phase === 'ai_done') {
      if (info.monitorState === 'executing_tools' || info.monitorToolCalls > 0) {
        phase = 'tool_executing';
        toolCallsDetected = info.monitorToolCalls;
        p('MONITOR 检测到工具调用! tools=' + info.monitorToolCalls + ' names=' + JSON.stringify(info.monitorToolNames));
      } else if (info.monitorState === 'idle' && !sseHasToolCall) {
        p('AI 回复完成，无工具调用');
        return { success: true, hadToolCall: false, phase: 'no_tool_call' };
      }
    }

    if (phase === 'tool_executing') {
      if (info.monitorExecResults > 0) {
        toolExecResults = info.monitorExecResults;
        p('工具执行完成! execResults=' + info.monitorExecResults);
        phase = 'tool_injected';
      }
    }

    if (phase === 'tool_injected') {
      // 等待 AI 对工具结果的回复
      if (info.sseActive) {
        phase = 'ai_final';
        p('AI 开始处理工具结果...');
      } else if (info.monitorState === 'listening' || info.monitorState === 'idle') {
        // 可能结果注入后 AI 还没开始回复
        p('等待 AI 回复工具结果... (monitor=' + info.monitorState + ')');
      }
    }

    if (phase === 'ai_final') {
      if (!info.sseActive && stableCount >= 3) {
        p('AI 最终回复完成');
        return {
          success: true,
          hadToolCall: true,
          toolCallsDetected: toolCallsDetected,
          toolExecResults: toolExecResults,
          finalSseLen: info.sseLen,
          phase: 'complete'
        };
      }
    }

    // 超时保护
    if (round > 90) {
      p('轮询超时 (90轮)');
      break;
    }
  }

  return { success: false, hadToolCall: toolCallsDetected > 0, phase: phase, timeout: true };
}

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  工具调用链路验证测试 — SSE检测→执行→注入→AI回复      ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');

  // 1. 检查服务器
  p('检查工具服务器...');
  var health = await httpGET('http://localhost:3002/health');
  if (health && health.status === 'ok') {
    p('✅ 工具服务器正常 (v' + health.version + ', ' + health.tools_count + ' tools)');
  } else {
    p('❌ 工具服务器未运行!');
    process.exit(1);
  }

  // 2. 连接 Chrome
  p('连接 Chrome CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { p('❌ 未找到 DeepSeek 页面!'); process.exit(1); }
  p('当前页面: ' + page.url());

  // 3. 验证扩展状态
  p('验证扩展状态...');
  var extState = await queryMonitor(page);
  p('扩展状态: ' + JSON.stringify(extState));

  if (extState.state === 'unknown') {
    p('❌ 扩展未加载! 请先刷新页面或重新加载扩展');
    process.exit(1);
  }
  p('✅ 扩展已加载 (monitor=' + extState.state + ')');

  // 4. 安装 postMessage 监听器捕获工具执行结果
  await page.evaluate(function() {
    window.__testToolResults = [];
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === '__ds_tool_results') {
        window.__testToolResults.push(e.data);
      }
    });
  });

  // 5. 先注入工具提示词（通过面板按钮）
  p('注入工具提示词...');
  var injectResult = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() { resolve({ success: false, error: 'timeout' }); }, 5000);
      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_inject_result') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(e.data.result);
        }
      });
      window.postMessage({ type: '__ds_inject_tool', autoSend: false, requestId: Date.now() }, '*');
    });
  });
  p('注入结果: ' + JSON.stringify(injectResult));

  if (injectResult && injectResult.success) {
    p('✅ 工具提示词已注入 (' + injectResult.toolCount + ' 个工具)');
    // 手动点击发送
    await page.waitForTimeout(500);
    await page.evaluate(function() {
      var ta = document.querySelector('textarea');
      if (!ta) return;
      var taR = ta.getBoundingClientRect();
      var btns = Array.from(document.querySelectorAll('button')).filter(function(b) {
        return !b.disabled && b.getBoundingClientRect().width > 0;
      });
      var best = null, bs = 0;
      btns.forEach(function(b) {
        var r = b.getBoundingClientRect();
        var svg = !!b.querySelector('svg');
        var empty = !(b.textContent || '').trim();
        var near = Math.abs(r.top - taR.bottom) < 150;
        var s = 0;
        if (svg && empty && near) s = 100;
        else if (svg && near) s = 70;
        else if (svg && empty) s = 40;
        if (s > bs) { bs = s; best = b; }
      });
      if (best && bs >= 40) best.click();
      else ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    });
    p('已发送工具提示词');
    // 等待 AI 回复工具提示词（确认AI理解了工具格式）
    await page.waitForTimeout(8000);
  } else if (injectResult && injectResult.alreadyInjected) {
    p('工具提示词已存在，跳过注入');
  } else {
    p('⚠️ 注入失败: ' + JSON.stringify(injectResult) + '，继续测试...');
  }

  // 6. 发送触发工具调用的消息
  var testMessage = '请用 list_dir 列出目录 f:\\桌面\\web_free_agent\\deepseek-tool-agent\\workspace 的内容';
  p('发送测试消息: "' + testMessage + '"');
  var sent = await sendMessage(page, testMessage);
  p('消息已发送 (buttonClicked=' + sent + ')');

  // 7. 等待工具调用链路完成
  p('');
  p('═══ 开始监控工具调用链路 ═══');
  var result = await waitForToolChain(page, 180000);

  // 8. 输出最终结果
  p('');
  p('═══ 测试结果 ═══');
  p('成功: ' + result.success);
  p('有工具调用: ' + result.hadToolCall);
  if (result.hadToolCall) {
    p('工具调用数: ' + result.toolCallsDetected);
    p('执行结果数: ' + result.toolExecResults);
  }
  p('最终阶段: ' + result.phase);
  if (result.timeout) p('⚠️ 超时');

  // 9. 检查日志面板
  var logContent = await page.evaluate(function() {
    var lp = document.getElementById('__ds-log-area');
    return lp ? (lp.innerText || '').substring(0, 2000) : '';
  });
  if (logContent) {
    p('');
    p('═══ 日志面板 (最近20行) ═══');
    var lines = logContent.split('\n').filter(function(l) { return l.trim(); });
    lines.slice(-20).forEach(function(l) { p('  ' + l); });
  }

  // 10. 检查工具执行结果 (postMessage)
  var toolResults = await page.evaluate(function() {
    return (window.__testToolResults || []).map(function(r) {
      return { round: r.round, tools: r.results, time: r.timestamp };
    });
  });
  if (toolResults.length > 0) {
    p('');
    p('═══ 工具执行结果 (postMessage) ═══');
    toolResults.forEach(function(r) {
      p('  Round ' + r.round + ': ' + JSON.stringify(r.tools).substring(0, 200));
    });
  }

  // 11. 最终 monitor 状态
  var finalState = await queryMonitor(page);
  p('');
  p('═══ 最终 Monitor 状态 ═══');
  p(JSON.stringify(finalState, null, 2));

  // 12. 总结
  p('');
  p('═══ 总结 ═══');
  if (result.success && result.hadToolCall) {
    p('✅ 工具调用链路完整: SSE检测→执行→注入→AI回复');
  } else if (result.hadToolCall && !result.success) {
    p('⚠️ 检测到工具调用但链路未完成');
  } else if (!result.hadToolCall) {
    p('❌ 未检测到工具调用');
    p('可能原因: AI未使用tool_call格式 / SSE拦截失败 / Monitor未检测到');
  }

  // 不关闭浏览器，保持运行
  p('');
  p('测试完成。浏览器保持打开。');
  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
