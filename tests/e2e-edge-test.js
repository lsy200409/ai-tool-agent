var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var startTime = Date.now();
var events = [];
var LOG_FILE = path.resolve(__dirname, '..', 'e2e-test-' + Date.now() + '.json');

var EXTENSION_PATH = path.resolve(__dirname, '..');
var EXTENSION_ID = 'diaocpmadbepofacimmkigkkkeihnjio';

function log(type, data) {
  var entry = { t: ((Date.now() - startTime) / 1000).toFixed(1), type: type, data: data };
  events.push(entry);
  var s = typeof data === 'object' ? JSON.stringify(data) : String(data);
  console.log('[' + entry.t + 's] ' + type + ': ' + (s.length > 300 ? s.substring(0, 300) + '...' : s));
}

function saveLog() {
  fs.writeFileSync(LOG_FILE, JSON.stringify({
    time: new Date().toISOString(),
    duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
    extensionId: EXTENSION_ID,
    events: events
  }, null, 2));
  console.log('\n日志已保存: ' + LOG_FILE);
}

var TEST_CASES = [
  {
    id: 'basic_chat',
    desc: '基础对话测试',
    message: '你好，请用中文回答：123+456等于多少？',
    expectStream: true,
    timeout: 60000
  },
  {
    id: 'tool_call',
    desc: '工具调用测试',
    message: '请使用exec_command工具执行命令: echo Hello from E2E Test',
    expectToolCalls: true,
    timeout: 90000
  },
  {
    id: 'skill_trigger',
    desc: 'Skill 触发测试 (code-review)',
    message: '请review一下这段代码: function add(a,b){return a+b} 有什么问题吗？',
    expectSkill: 'code-review',
    timeout: 60000
  },
  {
    id: 'tdd_skill',
    desc: 'TDD Skill 触发测试',
    message: '请用TDD的方式帮我写一个函数，检查一个字符串是否是回文',
    expectSkill: 'tdd',
    timeout: 120000
  },
  {
    id: 'grill_skill',
    desc: 'Grill-me Skill 触发测试',
    message: 'grill me: 我想给这个扩展加一个暗黑模式切换功能',
    expectSkill: 'grill-me',
    timeout: 60000
  }
];

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function now() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

async function sendMessage(page, text) {
  try {
    await page.click('textarea', { timeout: 3000 });
  } catch (e) {
    try { var ta = await page.$('textarea'); if (ta) await ta.focus(); } catch (e2) {}
  }
  await page.waitForTimeout(500);

  await page.evaluate(function(text) {
    var ta = document.querySelector('textarea');
    if (!ta) return;
    var desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ta) || HTMLTextAreaElement.prototype, 'value'
    );
    if (desc && desc.set) { desc.set.call(ta, text); }
    else { ta.value = text; }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true, data: text, inputType: 'insertText'
    }));
  }, text);

  await page.waitForTimeout(800);

  await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    var btns = document.querySelectorAll('button');
    var best = null, bs = 0;
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
      if (s > bs) { bs = s; best = b; }
    }
    if (best && bs >= 30) { best.click(); return; }
    if (ta) {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(500);
}

async function waitForAIResponse(page, timeout) {
  var lastTextLen = 0, stableCount = 0;
  var endT = Date.now() + timeout;
  while (Date.now() < endT) {
    await page.waitForTimeout(1000);
    var info = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      var m = window.__ds_monitor;
      return {
        streamActive: ss.active || false,
        textLen: (ss.accumulatedText || '').length,
        textPreview: (ss.accumulatedText || '').substring(0, 150).replace(/\n/g, ' '),
        finishReason: ss.finishReason || null,
        monitorState: m ? m.state : '?'
      };
    });
    if (info.textLen !== lastTextLen) { lastTextLen = info.textLen; stableCount = 0; }
    else { stableCount++; }
    if (!info.streamActive && info.textLen > 0 && stableCount >= 4) break;
  }
  await page.waitForTimeout(3000);
  return await page.evaluate(function() {
    var ss = window.__ds_streamState ? window.__ds_streamState() : {};
    var m = window.__ds_monitor;
    return {
      aiTextLen: (ss.accumulatedText || '').length,
      aiTextPreview: (ss.accumulatedText || '').substring(0, 200).replace(/\n/g, ' '),
      finishReason: ss.finishReason || '',
      monitorState: m ? m.state : '?',
      toolCalls: m && m.currentRound ? (m.currentRound.toolCalls || []).length : 0,
      panelTools: m && m.currentRound ? (m.currentRound.tools || []).slice(0, 3) : []
    };
  });
}

async function getExtensionState(page) {
  return await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    var ss = window.__ds_streamState ? window.__ds_streamState() : {};
    var m = window.__ds_monitor;
    return {
      interceptor: {
        ready: !!window.__ds_sse_interceptor_ready,
        xhr_open: d.xhrOpenCalled || 0,
        xhr_send: d.xhrSendCalled || 0,
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_bytes: d.xhrTotalBytes || 0,
        xhr_pollActive: d.xhrPollActive || false
      },
      stream: {
        active: ss.active || false,
        textLen: (ss.accumulatedText || '').length,
        finishReason: ss.finishReason || null,
        requestCount: ss.requestCount || 0
      },
      monitor: m ? {
        state: m.state,
        sseEnabled: m.sse ? m.sse.enabled : false,
        toolCalls: m.currentRound ? (m.currentRound.toolCalls || []).length : 0,
        execResults: m.currentRound ? (m.currentRound.executedResults || []).length : 0
      } : null,
      panel: window.__ds_panel ? {
        visible: !!document.getElementById('__ds-agent-panel'),
        skillsLoaded: (function() {
          var c = document.getElementById('__ds-skills-container');
          return c ? (c.children.length || c.innerHTML.length > 100) : false;
        })(),
        toolsCount: (function() {
          var c = document.getElementById('__ds-tools-container');
          return c ? c.querySelectorAll('.ds-tool-card').length : 0;
        })()
      } : null
    };
  });
}

// ── Main ──

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  DeepSeek Tool Agent — Edge E2E 场景模拟测试                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('启动 Edge (Playwright channel)...');
  var browser = await chromium.launch({
    channel: 'msedge',
    headless: false,
    args: [
      '--disable-extensions-except=' + EXTENSION_PATH,
      '--load-extension=' + EXTENSION_PATH,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
  log('browser', 'Edge launched');

  var context = browser.contexts()[0] || await browser.newContext();
  var page = await context.newPage();

  page.on('console', function(msg) {
    var t = msg.text();
    if (t.indexOf('%c') >= 0) return;
    if (t.length > 200) t = t.substring(0, 200);
    events.push({ t: ((Date.now() - startTime) / 1000).toFixed(1), type: 'console_' + msg.type(), data: t });
  });

  console.log('');
  console.log('── 步骤1: 打开 DeepSeek Chat ──');
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  log('page_loaded', 'chat.deepseek.com');
  console.log('  页面已加载, 等待扩展注入...');
  await page.waitForTimeout(10000);

  // ── 初始状态检查 ──
  console.log('\n── 步骤2: 初始状态检查 ──');
  var initState = await getExtensionState(page);
  log('init_state', initState);

  console.log('  SSE拦截器: ' + (initState.interceptor.ready ? '就绪' : '未就绪'));
  console.log('  XHR open/send: ' + initState.interceptor.xhr_open + '/' + initState.interceptor.xhr_send);
  console.log('  Monitor状态: ' + (initState.monitor ? initState.monitor.state : 'N/A'));
  console.log('  面板可见: ' + (initState.panel ? initState.panel.visible : 'N/A'));

  // ── 禁用自动监控(如果要测试手动触发) ──
  await page.evaluate(function() {
    if (window.__ds_monitor) {
      window.__ds_monitor.autoWatch = true;
      console.log('[Test] autoWatch 已启用');
    }
  });

  // ── 步骤3: 运行测试用例 ──
  var results = [];

  for (var ti = 0; ti < TEST_CASES.length; ti++) {
    var tc = TEST_CASES[ti];
    console.log('\n═══════════════════════════════════════');
    console.log('  测试' + (ti + 1) + ': ' + tc.desc);
    console.log('═══════════════════════════════════════');

    await sendMessage(page, tc.message);
    console.log('  消息已发送: ' + tc.message);

    var result = await waitForAIResponse(page, tc.timeout);
    result.testId = tc.id;
    result.testDesc = tc.desc;
    log('test_' + tc.id, result);

    console.log('  AI回复: ' + result.aiTextLen + '字');
    console.log('  预览: ' + (result.aiTextPreview || '').substring(0, 100));
    console.log('  工具调用: ' + result.toolCalls + '个');
    console.log('  Monitor: ' + result.monitorState);

    // Check skill triggering
    if (tc.expectSkill) {
      var skillMatched = result.aiTextPreview && result.aiTextPreview.toLowerCase().indexOf(tc.expectSkill.toLowerCase()) >= 0;
      console.log('  Skill检测 (' + tc.expectSkill + '): ' + (skillMatched ? '可能触发' : '未检测到关键词'));
    }

    results.push(result);

    // 状态快照
    var snap = await getExtensionState(page);
    log('state_snap_' + tc.id, snap);

    // 间隔让系统稳定
    await page.waitForTimeout(5000);
  }

  // ── 步骤4: 最终状态汇总 ──
  console.log('\n═══════════════════════════════════════');
  console.log('  最终状态汇总');
  console.log('═══════════════════════════════════════');

  var finalState = await getExtensionState(page);
  log('final_state', finalState);

  console.log('');
  console.log('=== 拦截器 ===');
  console.log('  XHR open: ' + finalState.interceptor.xhr_open);
  console.log('  XHR send: ' + finalState.interceptor.xhr_send);
  console.log('  XHR match: ' + finalState.interceptor.xhr_match);
  console.log('  XHR 字节: ' + finalState.interceptor.xhr_bytes);

  console.log('\n=== SSE 流 ===');
  console.log('  活跃: ' + finalState.stream.active);
  console.log('  捕获文字: ' + finalState.stream.textLen + '字');
  console.log('  请求次数: ' + finalState.stream.requestCount);

  console.log('\n=== MONITOR ===');
  if (finalState.monitor) {
    console.log('  状态: ' + finalState.monitor.state);
    console.log('  工具调用: ' + finalState.monitor.toolCalls);
    console.log('  执行结果: ' + finalState.monitor.execResults);
  }

  console.log('\n=== 面板 ===');
  if (finalState.panel) {
    console.log('  可见: ' + finalState.panel.visible);
    console.log('  工具数: ' + finalState.panel.toolsCount);
    console.log('  Skills: ' + (finalState.panel.skillsLoaded ? '已加载' : '未加载'));
  }

  console.log('\n=== 测试结果摘要 ===');
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    console.log('  [' + r.testId + '] ' + r.testDesc + ': ' +
      '回复' + r.aiTextLen + '字, ' +
      '工具' + r.toolCalls + '个, ' +
      '状态=' + r.monitorState);
  }

  saveLog();
  console.log('\n测试完成: ' + new Date().toISOString());

  // Keep browser open for manual inspection
  console.log('\n浏览器保持打开, 可手动检查。按 Ctrl+C 退出...');
  await new Promise(function() {});  // wait forever
}

run().catch(function(e) {
  console.error('测试失败:', e.message);
  saveLog();
  process.exit(1);
});