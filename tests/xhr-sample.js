var { chromium } = require('playwright-core');

async function run() {
  console.log('连接中...');
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var pages = contexts[0].pages();
  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
  if (!page) { page = await contexts[0].newPage(); await page.goto('https://chat.deepseek.com/'); }
  await page.waitForTimeout(10000);
  console.log('页面: ' + page.url());

  var sseReady = await page.evaluate(function() { return !!window.__ds_sse_interceptor_ready; });
  console.log('SSE Interceptor: ' + sseReady);
  if (!sseReady) { console.log('未加载!'); await browser.close(); return; }

  console.log('');
  console.log('发送消息...');
  await page.click('textarea');
  await page.waitForTimeout(500);

  await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    var s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(ta, '你好，123+456=?');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      data: '你好，123+456=?', inputType: 'insertText'
    }));
  });

  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  console.log('已按 Enter 发送');

  console.log('');
  console.log('等待 15s 收集 XHR 数据...');
  for (var w = 0; w < 15; w++) {
    await page.waitForTimeout(1000);
    var dbg = await page.evaluate(function() {
      var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
      return {
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_pollActive: d.xhrPollActive || false,
        xhr_bytes: d.xhrTotalBytes || 0,
        stream: window.__ds_streamState ? window.__ds_streamState().requestCount : 0
      };
    });
    if (dbg.xhr_match > 0) {
      process.stdout.write('\r  ' + (w+1) + 's  xhrMatch=' + dbg.xhr_match +
        '  pollActive=' + dbg.xhr_pollActive +
        '  bytes=' + dbg.xhr_bytes +
        '  reqCount=' + dbg.stream);
      if (!dbg.xhr_pollActive && dbg.xhr_bytes > 0) break;
    }
  }

  console.log('');
  console.log('');
  console.log('=== 完整调试数据 ===');

  var debug = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    var ss = window.__ds_streamState ? window.__ds_streamState() : null;
    return {
      streamState: ss,
      fetch_wrapperTotal: d.wrapperCalledTotal,
      fetch_setter: d.setterCalledTotal,
      fetch_getter: d.getterCalledTotal,
      xhr_open: d.xhrOpenCalled,
      xhr_send: d.xhrSendCalled,
      xhr_match: d.xhrMatchingUrl,
      xhr_pollActive: d.xhrPollActive,
      xhr_pollCount: d.xhrPollCount,
      xhr_bytes: d.xhrTotalBytes,
      xhr_responseType: d.xhrResponseType || '(not set)',
      xhr_readyStateAtPoll: d.xhrReadyStateAtPoll,
      xhr_sampleText: d.xhrSampleText || '(empty)',
      urlsSeen: d.urlsSeen || []
    };
  });

  console.log(JSON.stringify(debug, null, 2));

  console.log('');
  if (debug.xhr_sampleText && debug.xhr_sampleText !== '(empty)') {
    console.log('=== XHR 原始响应文本 (前 500 字符) ===');
    console.log(debug.xhr_sampleText.substring(0, 500));
    console.log('');
    console.log('=== (hex dump 前 200 字节) ===');
    var hex = '';
    for (var i = 0; i < Math.min(debug.xhr_sampleText.length, 200); i++) {
      hex += debug.xhr_sampleText.charCodeAt(i).toString(16).padStart(2, '0') + ' ';
      if ((i + 1) % 32 === 0) hex += '\n';
    }
    console.log(hex);
  }

  await new Promise(function(r) { setTimeout(r, 5000); });
  await browser.close();
}

run().catch(console.error);