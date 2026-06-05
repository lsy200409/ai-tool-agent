var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var startTime = Date.now();
var events = [];
var LOG_FILE = path.resolve(__dirname, '..', 'user-sim-' + Date.now() + '.json');

function log(type, data) {
  var entry = { t: ((Date.now() - startTime) / 1000).toFixed(1), type: type, data: data };
  events.push(entry);
  if (typeof data === 'object') {
    var s = JSON.stringify(data);
    console.log('[' + entry.t + 's] ' + type + ': ' + (s.length > 300 ? s.substring(0, 300) + '...' : s));
  } else {
    console.log('[' + entry.t + 's] ' + type + ': ' + data);
  }
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function now() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

function saveLog() {
  fs.writeFileSync(LOG_FILE, JSON.stringify({
    time: new Date().toISOString(),
    duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
    events: events
  }, null, 2));
  console.log('');
  console.log('日志已保存: ' + LOG_FILE);
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  真实用户模拟测试 — 完整监控链路验证                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('开始时间: ' + new Date().toISOString());
  console.log('');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var page = null;
  for (var ci = 0; ci < contexts.length; ci++) {
    var pages = contexts[ci].pages();
    for (var pi = 0; pi < pages.length; pi++) {
      var u = pages[pi].url();
      if (u.indexOf('chat.deepseek.com') >= 0) {
        page = pages[pi];
        break;
      }
    }
    if (page) break;
  }
  if (!page) {
    page = await contexts[0].newPage();
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(15000);
  }
  await page.bringToFront();
  log('page', { url: page.url() });

  // ──────────────────────────────────────────
  // 步骤1: 收集 console 日志和 postMessage 事件
  // ──────────────────────────────────────────
  page.on('console', function(msg) {
    var t = msg.text();
    if (t.indexOf('%c') >= 0) return;
    if (t.length > 500) t = t.substring(0, 500) + '...';
    log('console_' + msg.type(), { text: t });
  });

  var postMsgs = [];
  await page.evaluate(function() {
    window.__ds_simulation_postMsgs = [];
    window.addEventListener('message', function(e) {
      if (e.data && e.data.source === 'deepseek-tool-agent') {
        window.__ds_simulation_postMsgs.push({
          type: e.data.type,
          textLen: e.data.text ? e.data.text.length : 0,
          finishReason: e.data.finishReason,
          ts: Date.now()
        });
      }
    });
  });

  // ──────────────────────────────────────────
  // 步骤2: 初始化状态检查
  // ──────────────────────────────────────────
  console.log('─── 初始状态检查 ───');

  var initState = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    var ss = window.__ds_streamState ? window.__ds_streamState() : {};
    return {
      interceptor: {
        ready: !!window.__ds_sse_interceptor_ready,
        fetch_wrapper: d.wrapperCalledTotal || 0,
        fetch_getter: d.getterCalledTotal || 0,
        fetch_setter: d.setterCalledTotal || 0,
        xhr_open: d.xhrOpenCalled || 0,
        xhr_send: d.xhrSendCalled || 0,
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_pollActive: d.xhrPollActive || false,
        xhr_pollCount: d.xhrPollCount || 0,
        xhr_bytes: d.xhrTotalBytes || 0,
        xhrSamplesCount: (d.xhrSamples || []).length,
        streamEventsCount: (d.streamEvents || []).length
      },
      stream: {
        active: ss.active || false,
        textLen: (ss.accumulatedText || '').length,
        finishReason: ss.finishReason || null,
        requestCount: ss.requestCount || 0
      },
      monitor: window.__ds_monitor ? {
        state: window.__ds_monitor.state,
        sseEnabled: window.__ds_monitor.sse ? window.__ds_monitor.sse.enabled : false
      } : null
    };
  });

  log('init_state', initState);
  console.log('  SSE拦截器就绪: ' + initState.interceptor.ready);
  console.log('  XHR open/send: ' + initState.interceptor.xhr_open + '/' + initState.interceptor.xhr_send);
  console.log('  XHR match: ' + initState.interceptor.xhr_match);
  console.log('  MONITOR state: ' + (initState.monitor ? initState.monitor.state : 'N/A'));
  console.log('');

  // ──────────────────────────────────────────
  // 步骤3: 发送第一条测试消息
  // ──────────────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  第1轮: 发送普通对话消息');
  console.log('═══════════════════════════════════════');
  console.log('');

  await sendMessage(page, '你好，请用中文回答我：123+456=?');
  log('round1_sent', { message: '你好，请用中文回答我：123+456=?' });

  // 等待 AI 回复完成
  var round1Result = await waitForAIResponse(page, 60000);
  log('round1_result', round1Result);

  console.log('  第1轮完成:');
  console.log('    SSE事件数: ' + round1Result.sseEventCount);
  console.log('    AI回复长度: ' + round1Result.aiTextLen + '字');
  console.log('    AI回复预览: ' + round1Result.aiTextPreview);
  console.log('    工具调用: ' + round1Result.toolCalls + '个');
  console.log('');

  // ──────────────────────────────────────────
  // 步骤4: 发送带工具调用的消息
  // ──────────────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  第2轮: 发送工具调用消息');
  console.log('═══════════════════════════════════════');
  console.log('');

  var toolPrompt = '请使用exec_command工具执行命令: echo Hello from DeepSeek Tool Agent Test';
  await sendMessage(page, toolPrompt);

  log('round2_sent', { message: toolPrompt });

  // 等待 AI 回复完成
  var round2Result = await waitForAIResponse(page, 60000);
  log('round2_result', round2Result);

  console.log('  第2轮完成:');
  console.log('    SSE事件数: ' + round2Result.sseEventCount);
  console.log('    AI回复长度: ' + round2Result.aiTextLen + '字');
  console.log('    AI回复预览: ' + round2Result.aiTextPreview);
  console.log('    工具调用: ' + round2Result.toolCalls + '个');
  console.log('');

  // ──────────────────────────────────────────
  // 步骤5: 发送文件操作消息
  // ──────────────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  第3轮: 发送文件操作消息');
  console.log('═══════════════════════════════════════');
  console.log('');

  var filePrompt = '请先使用exec_command执行dir命令列出当前目录，然后使用write_file创建一个test.txt文件，内容为：这是一个测试文件';
  await sendMessage(page, filePrompt);

  log('round3_sent', { message: filePrompt });

  // 等待第一轮 AI 回复
  var round3Result = await waitForAIResponse(page, 60000);
  log('round3_result', round3Result);

  console.log('  第3轮完成:');
  console.log('    SSE事件数: ' + round3Result.sseEventCount);
  console.log('    AI回复长度: ' + round3Result.aiTextLen + '字');
  console.log('    AI回复预览: ' + round3Result.aiTextPreview);
  console.log('    工具调用: ' + round3Result.toolCalls + '个');
  console.log('');

  // ──────────────────────────────────────────
  // 步骤6: 等待可能的多轮工具链
  // ──────────────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log('  等待后续工具链执行...');
  console.log('═══════════════════════════════════════');

  for (var w = 0; w < 30; w++) {
    await page.waitForTimeout(2000);

    var snap = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      var m = window.__ds_monitor;
      var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
      return {
        monitorState: m ? m.state : '?',
        streamActive: ss.active || false,
        streamTextLen: (ss.accumulatedText || '').length,
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_pollActive: d.xhrPollActive || false,
        xhr_bytes: d.xhrTotalBytes || 0
      };
    });

    if (snap.monitorState !== 'idle' || snap.streamActive) {
      console.log('  [' + now() + '] state=' + snap.monitorState +
        ' stream=' + snap.streamActive +
        ' textLen=' + snap.streamTextLen +
        ' xhrBytes=' + snap.xhr_bytes +
        ' xhrPoll=' + snap.xhr_pollActive);
    }

    if (snap.monitorState === 'idle' && !snap.streamActive && w > 5) {
      console.log('  [' + now() + '] 监控已停止，工具链完成');
      break;
    }
  }

  // ──────────────────────────────────────────
  // 步骤7: 最终状态汇总
  // ──────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  最终状态汇总');
  console.log('═══════════════════════════════════════');

  var finalState = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    var ss = window.__ds_streamState ? window.__ds_streamState() : {};
    var m = window.__ds_monitor;
    return {
      interceptor: {
        fetch_wrapper: d.wrapperCalledTotal || 0,
        fetch_getter: d.getterCalledTotal || 0,
        xhr_open: d.xhrOpenCalled || 0,
        xhr_send: d.xhrSendCalled || 0,
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_bytes: d.xhrTotalBytes || 0,
        xhr_pollCount: d.xhrPollCount || 0,
        xhrSamples: (d.xhrSamples || []).slice(0, 10),
        urlsSeen: (d.urlsSeen || []).slice(0, 20)
      },
      stream: {
        active: ss.active || false,
        textLen: (ss.accumulatedText || '').length,
        finishReason: ss.finishReason || null,
        requestCount: ss.requestCount || 0
      },
      monitor: m ? {
        state: m.state,
        toolCalls: (m.currentRound && m.currentRound.toolCalls) ? m.currentRound.toolCalls.length : 0,
        execResults: (m.currentRound && m.currentRound.executedResults) ? m.currentRound.executedResults.length : 0,
        sseEnabled: m.sse ? m.sse.enabled : false,
        sseActive: m.sse ? m.sse.active : false
      } : null
    };
  });

  var pmsgs = await page.evaluate(function() {
    return (window.__ds_simulation_postMsgs || []).slice(0, 50);
  });

  log('final_state', finalState);
  log('postMessages', { count: pmsgs.length, messages: pmsgs });

  console.log('');
  console.log('=== 拦截器状态 ===');
  console.log('  fetch wrapper调用: ' + finalState.interceptor.fetch_wrapper);
  console.log('  XHR open/send: ' + finalState.interceptor.xhr_open + '/' + finalState.interceptor.xhr_send);
  console.log('  XHR match URL: ' + finalState.interceptor.xhr_match);
  console.log('  XHR 总字节: ' + finalState.interceptor.xhr_bytes);
  console.log('');

  console.log('=== SSE 流状态 ===');
  console.log('  流活跃: ' + finalState.stream.active);
  console.log('  捕获文字长度: ' + finalState.stream.textLen);
  console.log('  结束原因: ' + finalState.stream.finishReason);
  console.log('  请求次数: ' + finalState.stream.requestCount);
  console.log('');

  console.log('=== MONITOR 状态 ===');
  if (finalState.monitor) {
    console.log('  状态: ' + finalState.monitor.state);
    console.log('  工具调用数: ' + finalState.monitor.toolCalls);
    console.log('  执行结果数: ' + finalState.monitor.execResults);
    console.log('  SSE启用: ' + finalState.monitor.sseEnabled);
    console.log('');

    if (finalState.monitor.state === 'idle') {
      console.log('  ✓ 监控链正常完成');
    } else {
      console.log('  ⚠ 监控链卡在状态: ' + finalState.monitor.state);
    }
  } else {
    console.log('  ⚠ MONITOR 未加载');
  }

  console.log('');
  console.log('=== 诊断分析 ===');

  var issues = [];

  if (finalState.interceptor.fetch_wrapper === 0 && finalState.interceptor.xhr_match === 0) {
    issues.push('❌ 严重: fetch和XHR都没有拦截到chat/completion请求 — SSE拦截完全失效');
  }

  if (finalState.interceptor.xhr_match > 0 && finalState.stream.textLen === 0) {
    issues.push('❌ XHR拦截到请求但SSE内容为空 — SSE解析可能失败');
  }

  if (finalState.interceptor.xhr_match > 0 && finalState.stream.textLen > 0) {
    console.log('  ✓ SSE拦截工作正常: 捕获了' + finalState.stream.textLen + '字的内容');
  }

  if (finalState.stream.finishReason && finalState.stream.finishReason !== 'done') {
    console.log('  ✓ 流结束检测正常: ' + finalState.stream.finishReason);
  }

  if (issues.length === 0) {
    console.log('  ✓ 未发现明显问题');
  } else {
    for (var i = 0; i < issues.length; i++) {
      console.log('  ' + issues[i]);
    }
  }

  saveLog();
  console.log('');
  console.log('测试完成于: ' + new Date().toISOString());
}

// ──────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────

async function sendMessage(page, text) {
  // 点击输入框
  try {
    await page.click('textarea', { timeout: 3000 });
  } catch (e) {
    try {
      var ta = await page.$('textarea');
      if (ta) await ta.focus();
    } catch (e2) {}
  }
  await page.waitForTimeout(500);

  // 设置输入值
  await page.evaluate(function(text) {
    var ta = document.querySelector('textarea');
    if (!ta) return;
    var desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ta) || HTMLTextAreaElement.prototype,
      'value'
    );
    if (desc && desc.set) {
      desc.set.call(ta, text);
    } else {
      ta.value = text;
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      data: text, inputType: 'insertText'
    }));
  }, text);

  await page.waitForTimeout(800);

  // 点击发送按钮
  await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    var btns = document.querySelectorAll('button');
    var best = null;
    var bs = 0;
    var taRect = ta ? ta.getBoundingClientRect() : { top: 0, right: 0, bottom: 0 };

    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.disabled) continue;
      var r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      var svg = !!b.querySelector('svg');
      var empty = !(b.textContent || '').trim();
      var near = ta && Math.abs(r.top - taRect.bottom) < 120 && Math.abs(r.right - taRect.right) < 250;
      var s = 0;
      if (svg && empty && near) s = 100;
      else if (svg && near) s = 50;
      else if (svg && empty) s = 30;
      else if (near) s = 10;
      if (s > bs) { bs = s; best = b; }
    }

    if (best && bs >= 30) {
      best.click();
      return;
    }

    // 回退: enter键
    if (ta) {
      ta.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }
  });

  await page.waitForTimeout(500);
}

async function waitForAIResponse(page, timeout) {
  var sseEventCount = 0;
  var lastTextLen = 0;
  var stableCount = 0;

  var startT = Date.now();
  var endT = startT + timeout;

  while (Date.now() < endT) {
    await page.waitForTimeout(1000);

    var info = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      var m = window.__ds_monitor;
      var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
      return {
        streamActive: ss.active || false,
        textLen: (ss.accumulatedText || '').length,
        textPreview: (ss.accumulatedText || '').substring(0, 150).replace(/\n/g, ' '),
        finishReason: ss.finishReason || null,
        requestCount: ss.requestCount || 0,
        monitorState: m ? m.state : '?',
        xhr_pollActive: d.xhrPollActive || false,
        xhr_match: d.xhrMatchingUrl || 0
      };
    });

    if (info.textLen !== lastTextLen) {
      lastTextLen = info.textLen;
      stableCount = 0;
      if (info.textLen > 0 && info.textLen % 20 === 0) {
        console.log('  [' + now() + '] AI回复中... ' + info.textLen + '字');
      }
    } else {
      stableCount++;
    }

    if (!info.streamActive && !info.xhr_pollActive && info.textLen > 0 && stableCount >= 5) {
      console.log('  [' + now() + '] AI回复稳定: ' + info.textLen + '字');
      break;
    }
  }

  // 额外等待 DOM 更新
  await page.waitForTimeout(3000);

  var result = await page.evaluate(function() {
    var ss = window.__ds_streamState ? window.__ds_streamState() : {};
    var m = window.__ds_monitor;
    return {
      aiTextLen: (ss.accumulatedText || '').length,
      aiTextPreview: (ss.accumulatedText || '').substring(0, 200).replace(/\n/g, ' '),
      finishReason: ss.finishReason || '',
      requestCount: ss.requestCount || 0,
      monitorState: m ? m.state : '?',
      toolCalls: m && m.currentRound ? (m.currentRound.toolCalls || []).length : 0
    };
  });

  return result;
}

run().then(function() {
  console.log('Done.');
}).catch(function(e) {
  console.error('测试失败:', e.message);
  console.error(e.stack);
  saveLog();
  process.exit(1);
});