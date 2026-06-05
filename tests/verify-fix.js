var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var LOG_FILE = path.resolve(__dirname, '..', 'verify-fix-' + Date.now() + '.json');
var events = [];
var startTime = Date.now();

function evt(type, data) {
  var e = { time: Date.now() - startTime, type: type, data: data };
  events.push(e);
  console.log('[' + ((Date.now() - startTime)/1000).toFixed(1) + 's] [' + type + '] ' + JSON.stringify(data).substring(0, 200));
}

async function run() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  修复验证: SSE Interceptor (MAIN world + document_start)');
  console.log('='.repeat(60));
  console.log('');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var pages = contexts[0].pages();

  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
  if (!page) {
    page = await contexts[0].newPage();
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await page.bringToFront();
  }

  evt('connected', { url: page.url() });
  await page.waitForTimeout(8000);

  page.on('console', function(msg) {
    var text = msg.text();
    if (text.length > 300) text = text.substring(0, 300) + '...';
    if (text.indexOf('[API-CAPTURE]') < 0 && text.indexOf('[NET-') < 0) {
      evt('console_' + msg.type(), { text: text });
    }
  });

  page.on('pageerror', function(err) {
    evt('page_error', { msg: err.message });
  });

  var cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  var apiReqs = [];
  cdp.on('Network.requestWillBeSent', function(params) {
    var r = params.request;
    apiReqs.push({ method: r.method, url: r.url, ts: Date.now() - startTime });
  });
  cdp.on('Network.responseReceived', function(params) {
    var resp = params.response;
    var found = apiReqs.filter(function(r) {
      return r.url === resp.url && !r.respStatus;
    });
    var last = found[found.length - 1];
    if (last) {
      last.respStatus = resp.status;
      last.respMime = resp.mimeType;
    }
  });

  console.log('');
  console.log('--- 1. 检查注入状态 ---');

  var check = await page.evaluate(function() {
    var r = {};
    r.url = window.location.href;
    r.sseInterceptorReady = !!window.__ds_sse_interceptor_ready;
    r.hasStreamState = typeof window.__ds_streamState === 'function';
    r.hasIsStreamActive = typeof window.__ds_isStreamActive === 'function';
    r.hasGetStreamText = typeof window.__ds_getStreamText === 'function';
    r.fetchIsWrapped = !window.fetch.toString().includes('[native code]');
    r.fetchHasTee = window.fetch.toString().includes('tee(');
    r.fetchLen = window.fetch.toString().length;
    r.injectedAlive = !!window.__deepseekToolAgentInjected;

    var ss = window.__ds_streamState ? window.__ds_streamState() : null;
    r.streamState = ss;

    return r;
  });

  evt('check_state', check);

  console.log('  sseInterceptor: ' + (check.sseInterceptorReady ? 'OK' : 'FAIL'));
  console.log('  __ds_streamState: ' + (check.hasStreamState ? 'OK' : 'FAIL'));
  console.log('  fetch wrapped: ' + check.fetchIsWrapped + ' (len=' + check.fetchLen + ')');
  console.log('  fetch has tee: ' + check.fetchHasTee);
  console.log('  injected.js: ' + (check.injectedAlive ? 'OK' : 'FAIL'));
  console.log('  streamState: ' + JSON.stringify(check.streamState));

  if (!check.sseInterceptorReady) {
    evt('ERROR', { reason: 'sse_interceptor_not_loaded' });
    console.log('');
    console.log('❌ SSE Interceptor 未加载！world:MAIN 可能不支持');
    console.log('   当前浏览器可能不支持 content_scripts world:MAIN');
    await save();
    return;
  }

  if (!check.fetchIsWrapped || !check.fetchHasTee) {
    evt('ERROR', { reason: 'fetch_not_wrapped' });
    console.log('');
    console.log('❌ fetch 未被正确包装！');
    await save();
    return;
  }

  console.log('');
  console.log('✅ SSE Interceptor 已正确加载并运行在 MAIN world');

  var testText = '你好，请计算 123+456';

  var textarea = await page.$('textarea');
  if (!textarea) {
    evt('ERROR', { reason: 'no_textarea' });
    console.log('❌ 找不到 textarea');
    await save();
    return;
  }

  console.log('');
  console.log('--- 2. 输入消息 ---');

  await textarea.click();
  await page.waitForTimeout(300);

  await page.evaluate(function(text) {
    var ta = document.querySelector('textarea');
    if (!ta) return false;
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      data: text, inputType: 'insertText'
    }));
    return true;
  }, testText);

  evt('input_set', { text: testText });
  await page.waitForTimeout(1000);

  console.log('--- 3. 点击发送按钮 ---');

  var sendRes = await page.evaluate(function() {
    var textarea = document.querySelector('textarea');
    if (!textarea) return { error: 'no textarea' };

    var taRect = textarea.getBoundingClientRect();
    var allBtns = document.querySelectorAll('button');
    var best = null;
    var bestScore = 0;

    for (var i = 0; i < allBtns.length; i++) {
      var b = allBtns[i];
      if (b.disabled) continue;
      var rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      var score = 0;
      var hasSvg = !!b.querySelector('svg');
      var isEmpty = !(b.textContent || '').trim();
      var near = Math.abs(rect.top - taRect.bottom) < 120 &&
                 Math.abs(rect.right - taRect.right) < 250;

      if (hasSvg && isEmpty && near) score += 100;
      if (hasSvg && near) score += 50;
      if (hasSvg && isEmpty) score += 30;
      if (near) score += 10;
      if (rect.width < 60 && rect.height < 60) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = { idx: i, score: score, label: (b.textContent || '').trim().substring(0, 20) };
      }
    }

    if (best && best.score >= 30) {
      allBtns[best.idx].click();
      return { clicked: true, idx: best.idx, score: best.score };
    }

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
    return { clicked: false, fallback: 'enter', best: best };
  });

  evt('send', sendRes);
  console.log('  发送结果: ' + JSON.stringify(sendRes));

  console.log('');
  console.log('--- 4. 等待 SSE 事件 (最多 40s) ---');

  var streamStarted = false;
  var streamEnded = false;
  var pmEvents = [];

  for (var w = 0; w < 40; w++) {
    await page.waitForTimeout(1000);

    var info = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : null;
      var pm = window.__verify_pm_events || [];
      return {
        streamActive: ss ? ss.active : false,
        reqCount: ss ? ss.requestCount : 0,
        reqUrl: ss ? (ss.requestUrl || '').substring(0, 80) : '',
        accumulatedLen: ss ? (ss.accumulatedText || '').length : 0,
        pmCount: pm.length
      };
    });

    pmEvents = info;

    if (info.streamActive && !streamStarted) {
      streamStarted = true;
      evt('SSE_START', { reqCount: info.reqCount, url: info.reqUrl });
      console.log('');
      console.log('  ✅ SSE 流已开始！reqCount=' + info.reqCount + ' url=' + info.reqUrl);
      console.log('');
    }

    if (!info.streamActive && info.reqCount > 0 && !streamEnded) {
      streamEnded = true;
      evt('SSE_END', { accumulatedLen: info.accumulatedLen });
      console.log('');
      console.log('  ↑ SSE 流已结束，累积文本长度: ' + info.accumulatedLen);
      console.log('');
      await page.waitForTimeout(3000);
      break;
    }

    if (w < 5 || info.streamActive || (w % 5 === 0)) {
      process.stdout.write('\r  ' + (w + 1) + 's  stream=' + info.streamActive +
        '  reqCount=' + info.reqCount +
        '  textLen=' + info.accumulatedLen +
        '  apiReqs=' + apiReqs.length);
    }
  }

  console.log('');
  console.log('');

  var final = await page.evaluate(function() {
    var ss = window.__ds_streamState ? window.__ds_streamState() : null;
    return {
      streamActive: ss ? ss.active : false,
      reqCount: ss ? ss.requestCount : 0,
      reqUrl: ss ? ss.requestUrl : '',
      accumulatedLen: ss ? (ss.accumulatedText || '').length : 0,
      finishReason: ss ? ss.finishReason : null,
      sseInterceptorReady: !!window.__ds_sse_interceptor_ready,
      fetchLen: window.fetch.toString().length
    };
  });

  evt('final_state', final);

  var sseApis = apiReqs.filter(function(r) {
    return (r.url || '').indexOf('chat/completion') >= 0;
  });

  console.log('=== 最终状态 ===');
  console.log('  SSE Interceptor: ' + (final.sseInterceptorReady ? 'OK' : 'FAIL'));
  console.log('  fetch 长度: ' + final.fetchLen);
  console.log('  SSE 请求计数: ' + final.reqCount);
  console.log('  SSE 活跃: ' + final.streamActive);
  console.log('  累积文本长度: ' + final.accumulatedLen);
  console.log('  完成原因: ' + (final.finishReason || 'N/A'));
  console.log('');
  console.log('=== DeepSeek API 请求 ===');
  for (var si = 0; si < sseApis.length; si++) {
    var sa = sseApis[si];
    console.log('  ' + sa.method + ' ' + sa.url +
      ' → ' + (sa.respStatus || '?') + ' [' + (sa.respMime || '?') + ']');
  }

  console.log('');
  if (final.reqCount > 0) {
    console.log('✅✅✅ 修复成功！SSE 拦截器正常工作');
    console.log('   请求被拦截 ' + final.reqCount + ' 次');
    if (final.accumulatedLen > 0) {
      console.log('   累积捕获了 ' + final.accumulatedLen + ' 字符的 AI 响应');
    }
  } else if (sseApis.length > 0) {
    console.log('⚠️  API 请求发出了但拦截器未捕获。可能 body 已被消费。');
  } else {
    console.log('❌ 无 API 请求，消息可能未成功发送。');
  }

  await save();

  console.log('');
  console.log('浏览器保持打开。按 Ctrl+C 退出。');
  await new Promise(function() {});
}

async function save() {
  var out = {
    startTime: new Date(startTime).toISOString(),
    duration: Date.now() - startTime,
    eventCount: events.length,
    events: events
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(out, null, 2));
  console.log('日志: ' + LOG_FILE);
}

run().catch(function(e) {
  console.error('错误:', e.message);
  console.error(e.stack);
  process.exit(1);
});