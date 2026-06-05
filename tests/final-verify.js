var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var events = [];
var startTime = Date.now();
var LOG_FILE = path.resolve(__dirname, '..', 'final-verify-' + Date.now() + '.json');

function log(type, data) {
  events.push({ t: ((Date.now()-startTime)/1000).toFixed(1), type: type, data: data });
  console.log('[' + ((Date.now()-startTime)/1000).toFixed(1) + 's] ' + type + ': ' + JSON.stringify(data).substring(0, 250));
}

async function run() {
  console.log('='.repeat(60));
  console.log('  最终修复验证: XHR + Fetch 双重拦截');
  console.log('='.repeat(60));

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var pages = contexts[0].pages();
  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
  if (!page) { page = await contexts[0].newPage(); await page.goto('https://chat.deepseek.com/'); }
  await page.waitForTimeout(10000);
  await page.bringToFront();

  log('page', { url: page.url() });

  page.on('console', function(msg) {
    var t = msg.text();
    if (t.length > 200) t = t.substring(0, 200) + '...';
    log('console_' + msg.type(), { text: t });
  });

  var cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  var netReqs = [];
  cdp.on('Network.requestWillBeSent', function(p) {
    netReqs.push({ method: p.request.method, url: p.request.url, ts: Date.now() - startTime });
  });
  cdp.on('Network.responseReceived', function(p) {
    var f = netReqs.filter(function(r) { return r.url === p.response.url && !r.status; });
    var last = f[f.length - 1];
    if (last) { last.status = p.response.status; last.mime = p.response.mimeType; }
  });

  var state1 = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    return {
      sseReady: !!window.__ds_sse_interceptor_ready,
      fetch_wrapperCalls: d.wrapperCalledTotal || 0,
      fetch_setter: d.setterCalledTotal || 0,
      fetch_getter: d.getterCalledTotal || 0,
      xhr_open: d.xhrOpenCalled || 0,
      xhr_send: d.xhrSendCalled || 0,
      xhr_match: d.xhrMatchingUrl || 0,
      xhr_pollActive: d.xhrPollActive || false,
      xhr_pollCount: d.xhrPollCount || 0,
      xhr_bytes: d.xhrTotalBytes || 0,
      stream: window.__ds_streamState ? window.__ds_streamState() : null
    };
  });

  log('initial_state', state1);
  console.log('');
  console.log('初始状态:');
  console.log('  fetch wrapper调用: ' + state1.fetch_wrapperCalls);
  console.log('  fetch setter: ' + state1.fetch_setter);
  console.log('  fetch getter: ' + state1.fetch_getter);
  console.log('  xhr open: ' + state1.xhr_open);
  console.log('  xhr send: ' + state1.xhr_send);
  console.log('  xhr match: ' + state1.xhr_match);
  console.log('  xhr poll: ' + state1.xhr_pollActive + ' (count=' + state1.xhr_pollCount + ' bytes=' + state1.xhr_bytes + ')');
  console.log('');

  console.log('═══════════════════════════════════');
  console.log('  发送测试消息...');
  console.log('═══════════════════════════════════');
  console.log('');

  await page.click('textarea');
  await page.waitForTimeout(500);

  await page.evaluate(function(text) {
    var ta = document.querySelector('textarea');
    if (!ta) return;
    var s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      data: text, inputType: 'insertText'
    }));
  }, '你好，123+456=?');

  await page.waitForTimeout(1000);

  var sendRes = await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    if (!ta) return { error: 'no textarea' };
    var taRect = ta.getBoundingClientRect();
    var btns = document.querySelectorAll('button');
    var best = null;
    var bs = 0;

    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.disabled) continue;
      var r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var svg = !!b.querySelector('svg');
      var empty = !(b.textContent || '').trim();
      var near = Math.abs(r.top - taRect.bottom) < 120 &&
                 Math.abs(r.right - taRect.right) < 250;
      var s = 0;
      if (svg && empty && near) s = 100;
      else if (svg && near) s = 50;
      else if (svg && empty) s = 30;
      else if (near) s = 10;
      if (s > bs) { bs = s; best = { idx: i, s: s }; }
    }

    if (best && best.s >= 30) {
      btns[best.idx].click();
      return { clicked: true, idx: best.idx, score: best.s };
    }
    ta.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    return { clicked: false, fallback: 'enter' };
  });

  log('send', sendRes);

  console.log('等待 SSE 事件...');
  console.log('');

  for (var w = 0; w < 40; w++) {
    await page.waitForTimeout(1000);

    var dbg = await page.evaluate(function() {
      var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
      var ss = window.__ds_streamState ? window.__ds_streamState() : null;
      return {
        streamActive: ss ? ss.active : false,
        reqCount: ss ? ss.requestCount : 0,
        textLen: ss ? (ss.accumulatedText || '').length : 0,
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_pollActive: d.xhrPollActive || false,
        xhr_pollCount: d.xhrPollCount || 0,
        xhr_bytes: d.xhrTotalBytes || 0,
        fetch_wrapper: d.wrapperCalledTotal || 0
      };
    });

    if (dbg.streamActive || dbg.xhr_pollActive || dbg.reqCount > 0) {
      console.log('  [' + (w+1) + 's] stream=' + dbg.streamActive +
        ' reqCount=' + dbg.reqCount +
        ' xhr_match=' + dbg.xhr_match +
        ' xhr_poll=' + dbg.xhr_pollActive +
        ' bytes=' + dbg.xhr_bytes +
        ' textLen=' + dbg.textLen);
    }

    if (w < 5 || dbg.streamActive || (w % 5 === 0)) {
      process.stdout.write('\r  ' + (w+1) + 's  stream=' + dbg.streamActive +
        '  fetchWrp=' + dbg.fetch_wrapper +
        '  xhrMatch=' + dbg.xhr_match +
        '  poll=' + dbg.xhr_pollActive +
        '  bytes=' + dbg.xhr_bytes);
    }
  }

  console.log('');
  console.log('');

  var final = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    var ss = window.__ds_streamState ? window.__ds_streamState() : null;
    return {
      stream: ss,
      fetch_wrapperCalls: d.wrapperCalledTotal || 0,
      fetch_setter: d.setterCalledTotal || 0,
      fetch_getter: d.getterCalledTotal || 0,
      xhr_open: d.xhrOpenCalled || 0,
      xhr_send: d.xhrSendCalled || 0,
      xhr_match: d.xhrMatchingUrl || 0,
      xhr_pollActive: d.xhrPollActive || false,
      xhr_pollCount: d.xhrPollCount || 0,
      xhr_bytes: d.xhrTotalBytes || 0,
      urlsSeen: d.urlsSeen || []
    };
  });

  log('final_state', final);

  var sseApi = netReqs.filter(function(r) { return (r.url || '').indexOf('chat/completion') >= 0; });

  console.log('=== 最终状态 ===');
  console.log('  fetch wrapper 被调用: ' + final.fetch_wrapperCalls);
  console.log('  fetch setter: ' + final.fetch_setter);
  console.log('  XHR open: ' + final.xhr_open);
  console.log('  XHR send: ' + final.xhr_send);
  console.log('  XHR match URL: ' + final.xhr_match);
  console.log('  XHR pollActive: ' + final.xhr_pollActive);
  console.log('  XHR pollCount: ' + final.xhr_pollCount);
  console.log('  XHR bytes: ' + final.xhr_bytes);
  console.log('  stream: ' + JSON.stringify(final.stream));
  console.log('');
  console.log('=== CDP API 请求 ===');
  for (var i = 0; i < sseApi.length; i++) {
    var a = sseApi[i];
    console.log('  ' + a.method + ' ' + a.url + ' → ' + (a.status || '?') + ' [' + (a.mime || '?') + ']');
  }
  console.log('');
  console.log('=== URLs seen by fetch wrapper ===');
  for (var j = 0; j < (final.urlsSeen || []).length; j++) {
    console.log('  ' + final.urlsSeen[j]);
  }

  console.log('');
  if (final.stream && final.stream.requestCount > 0) {
    console.log('✅✅✅ 修复成功！SSE 拦截器捕获了流');
  } else if (final.xhr_match > 0) {
    console.log('✅ XHR 拦截匹配了 URL，但轮询未激活');
  } else if (final.fetch_wrapperCalls > 0) {
    console.log('✅ fetch wrapper 被调用了 ' + final.fetch_wrapperCalls + ' 次');
  } else {
    console.log('❌ 无拦截器触发');
    console.log('');
    if (final.xhr_open === 0 && final.xhr_send === 0) {
      console.log('→ XHR open/send 都为 0，说明扩展未拦截 XHR');
      console.log('  可能原因：content_scripts world:MAIN 无法修改 XHR prototype');
    } else if (final.xhr_send > 0 && final.xhr_match === 0) {
      console.log('→ XHR send 被调用但 URL 不匹配 chat/completion');
    }
  }

  fs.writeFileSync(LOG_FILE, JSON.stringify({ events: events, final: final, apiReqs: sseApi }, null, 2));
  console.log('');
  console.log('日志: ' + LOG_FILE);
  await new Promise(function() {});
}

run().catch(function(e) { console.error(e); process.exit(1); });