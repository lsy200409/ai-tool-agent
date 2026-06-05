var { chromium } = require('playwright-core');
var http = require('http');
var fs = require('fs');
var path = require('path');

var startTime = Date.now();
var LOG_FILE = path.resolve(__dirname, '..', 'chrome-test-' + Date.now() + '.json');
var events = [];

function log(label, data) {
  var t = ((Date.now() - startTime) / 1000).toFixed(1);
  var s = typeof data === 'object' ? JSON.stringify(data) : String(data);
  if (s.length > 400) s = s.substring(0, 400) + '...';
  console.log('[' + t + 's] ' + label + ': ' + s);
  events.push({ t: t, label: label, data: data });
}

function cdpGet(path) {
  return new Promise(function(resolve, reject) {
    http.get('http://localhost:9222' + path, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({ raw: d }); }
      });
    }).on('error', reject);
  });
}

async function findDeepSeekPage() {
  var pages = await cdpGet('/json/list');
  return pages.find(function(p) {
    return p.type === 'page' && p.url && p.url.indexOf('chat.deepseek.com') >= 0;
  });
}

async function sendMessage(page, text) {
  log('send', text);
  
  // Click textarea
  try { await page.click('textarea', { timeout: 2000 }); } catch(e) {}
  await page.waitForTimeout(300);
  
  // Type text via React-compatible method
  await page.evaluate(function(text) {
    var ta = document.querySelector('textarea');
    if (!ta) return;
    
    // React listens for inputType 'insertText'
    var nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    );
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(ta, text);
    } else {
      ta.value = text;
    }
    
    // Trigger React's synthetic events
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      data: text, inputType: 'insertText'
    }));
  }, text);
  
  await page.waitForTimeout(800);
  
  // Click send button (SVG icon button near textarea)
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
      var hasSvg = !!b.querySelector('svg');
      var hasText = !!(b.textContent || '').trim();
      var nearTextarea = ta && Math.abs(r.top - taRect.bottom) < 150;
      var score = 0;
      if (hasSvg && hasText && nearTextarea) score = 100;
      else if (hasSvg && hasText) score = 50;
      else if (hasSvg && nearTextarea) score = 80;
      if (score > bs) { bs = score; best = b; }
    }
    if (best && bs >= 50) { best.click(); return 'clicked'; }
    // Fallback: Enter key
    if (ta) {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return 'enter';
    }
    return 'failed';
  }).then(function(r) { log('send_btn', r); });
}

async function checkExtensionState(page) {
  return await page.evaluate(function() {
    var r = {};
    
    // Check injected.js globals
    r.injectedReady = !!window.__ds_sse_interceptor_ready;
    
    // Check SSE interceptor
    if (window.__ds_interceptor_debug) {
      var d = window.__ds_interceptor_debug();
      r.xhr = {
        openCalled: d.xhrOpenCalled || 0,
        sendCalled: d.xhrSendCalled || 0,
        matched: d.xhrMatchingUrl || 0,
        bytes: d.xhrTotalBytes || 0
      };
    }
    
    // Check stream state
    if (window.__ds_streamState) {
      var ss = window.__ds_streamState();
      r.stream = {
        active: ss.active || false,
        textLen: (ss.accumulatedText || '').length,
        requestCount: ss.requestCount || 0
      };
    }
    
    // Check monitor
    if (window.__ds_monitor) {
      var m = window.__ds_monitor;
      r.monitor = {
        state: m.state || '?',
        autoWatch: !!m.autoWatch
      };
    }
    
    // Check panel
    var panel = document.getElementById('__ds-agent-panel');
    r.panelVisible = !!panel && panel.offsetParent !== null;
    
    // Check pet ball
    var pet = document.getElementById('__ds-pet-ball');
    r.petBallVisible = !!pet;
    
    return r;
  });
}

async function waitForStreamComplete(page, timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  var lastLen = 0, stable = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    var s = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      var m = window.__ds_monitor;
      return {
        active: ss.active || false,
        len: (ss.accumulatedText || '').length,
        finish: ss.finishReason || '',
        monitorState: m ? m.state : '?',
        toolCalls: m && m.currentRound ? (m.currentRound.toolCalls || []).length : 0
      };
    });
    log('stream', 'len=' + s.len + ' active=' + s.active + ' monitor=' + s.monitorState + ' tools=' + s.toolCalls);
    if (s.len !== lastLen) { lastLen = s.len; stable = 0; }
    else if (!s.active && s.len > 0) { stable++; }
    if (!s.active && s.len > 0 && stable >= 3) return s;
  }
  return { len: lastLen, timeout: true };
}

// ═══ MAIN ═══

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  Chrome 可见交互测试 — 扩展端到端验证     ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // Step 1: Find the DeepSeek page via CDP
  log('step', 'Finding DeepSeek page...');
  var dsPage = await findDeepSeekPage();
  if (!dsPage) {
    console.log('ERROR: 未找到 DeepSeek 页面!');
    process.exit(1);
  }
  log('found', 'DeepSeek: ' + dsPage.url);

  // Step 2: Connect via CDP
  log('step', 'Connecting via CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var pages = browser.contexts()[0].pages();
  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) page = pages[0];
  log('connect', 'Connected to: ' + page.url());

  // Listen for console from the page
  page.on('console', function(msg) {
    var t = msg.text();
    if (t.indexOf('%c') >= 0 || t.length > 300) return;
    console.log('  [CONSOLE] ' + t);
  });

  // ── TEST 1: 初始扩展状态 ──
  console.log('\n── 测试1: 初始扩展状态 ──');
  await page.waitForTimeout(3000);
  var s0 = await checkExtensionState(page);
  log('init_state', s0);

  console.log('  注入就绪: ' + s0.injectedReady);
  console.log('  XHR拦截: ' + JSON.stringify(s0.xhr || {}));
  console.log('  流状态: ' + JSON.stringify(s0.stream || {}));
  console.log('  监控状态: ' + JSON.stringify(s0.monitor || {}));
  console.log('  面板可见: ' + s0.panelVisible);
  console.log('  悬浮球: ' + s0.petBallVisible);

  // ── TEST 2: 发送第一条消息 ──
  console.log('\n── 测试2: 发送消息 + 监控 AI 回复 ──');
  await sendMessage(page, '你好，请帮我用中文回复：JSON是什么？');
  
  var s1 = await waitForStreamComplete(page, 60000);
  log('test2_result', s1);

  console.log('  AI回复字数: ' + s1.len);
  console.log('  监控状态: ' + s1.monitorState);
  console.log('  工具调用数: ' + s1.toolCalls);

  // ── TEST 3: 刷新后状态 ──
  console.log('\n── 测试3: 模拟刷新后状态 ──');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  var s3 = await checkExtensionState(page);
  log('after_reload', s3);
  console.log('  刷新后注入就绪: ' + s3.injectedReady);

  // ── TEST 4: 第二次消息（测试监控链不中断） ──
  console.log('\n── 测试4: 连续对话监控稳定性 ──');
  await sendMessage(page, '继续回答：什么是REST API？请简短回答');
  
  var s4 = await waitForStreamComplete(page, 90000);
  log('test4_result', s4);
  console.log('  第二轮AI回复字数: ' + s4.len);
  console.log('  监控状态: ' + s4.monitorState);

  // ── TEST 5: 面板状态 ──
  console.log('\n── 测试5: 面板状态 ──');
  var panelState = await page.evaluate(function() {
    var p = document.getElementById('__ds-agent-panel');
    var pet = document.getElementById('__ds-pet-ball');
    return {
      panel_exists: !!p,
      panel_html_length: p ? p.innerHTML.length : 0,
      pet_exists: !!pet,
      tools_count: (function() {
        var c = document.getElementById('__ds-tools-container');
        return c ? c.querySelectorAll('.ds-tool-card').length : 0;
      })(),
      skills_count: (function() {
        var c = document.getElementById('__ds-skills-container');
        return c ? (c.children.length || 0) : 0;
      })(),
      ws_tab_exists: !!document.querySelector('.ds-left-tab[data-tab="workspace"]'),
      file_tree_exists: !!document.getElementById('__ds-file-tree')
    };
  });
  log('panel_state', panelState);
  console.log('  面板存在: ' + panelState.panel_exists);
  console.log('  面板HTML长度: ' + panelState.panel_html_length);
  console.log('  悬浮球存在: ' + panelState.pet_exists);
  console.log('  工具数: ' + panelState.tools_count);
  console.log('  Skills数: ' + panelState.skills_count);
  console.log('  Workspace Tab: ' + panelState.ws_tab_exists);
  console.log('  文件浏览器: ' + panelState.file_tree_exists);

  // ── TEST 6: 执行日志 ──
  console.log('\n── 测试6: 执行日志 ──');
  var logState = await page.evaluate(function() {
    var logs = window.__ds_executionHistory || [];
    return {
      total: logs.length,
      last: logs.slice(-3).map(function(l) {
        return { lvl: l.level, msg: (l.message || '').substring(0, 80), time: l.time };
      })
    };
  });
  log('log_state', logState);
  console.log('  日志总数: ' + logState.total);
  logState.last.forEach(function(l) {
    console.log('    [' + l.lvl + '] ' + l.msg);
  });

  // ── SUMMARY ──
  console.log('\n═══════════════════════════════════════════');
  console.log('  测试完成');
  console.log('═══════════════════════════════════════════');
  console.log('  扩展注入:  ' + (s0.injectedReady ? 'OK' : 'FAIL'));
  console.log('  第1轮对话: ' + (s1.len > 0 ? 'OK('+s1.len+'字)' : 'FAIL'));
  console.log('  刷新后恢复: ' + (s3.injectedReady ? 'OK' : 'FAIL'));
  console.log('  第2轮对话: ' + (s4.len > 0 ? 'OK('+s4.len+'字)' : ('FAIL' + (s4.timeout?'(timeout)':''))));
  console.log('  面板呈现:  ' + (panelState.panel_exists ? 'OK' : 'FAIL'));
  console.log('  文件浏览器: ' + (panelState.file_tree_exists ? 'OK' : 'FAIL'));
  console.log('  耗时: ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's');
  console.log('  日志: ' + LOG_FILE);

  fs.writeFileSync(LOG_FILE, JSON.stringify({
    time: new Date().toISOString(),
    duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
    events: events
  }, null, 2));

  console.log('\n浏览器保持打开，可手动查看面板。');
  // Close the CDP connection but keep browser open
  await browser.close();
}

main().catch(function(e) {
  console.error('测试崩溃: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});