var { chromium } = require('playwright-core');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var pages = contexts[0].pages();
  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
  if (!page) { page = await contexts[0].newPage(); await page.goto('https://chat.deepseek.com/'); }
  await page.waitForTimeout(3000);

  var debug = await page.evaluate(function() {
    var r = {};
    r.sseReady = !!window.__ds_sse_interceptor_ready;
    r.debug = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : null;
    r.streamState = window.__ds_streamState ? window.__ds_streamState() : null;
    r.fetchWrapped = !window.fetch.toString().includes('[native code]');

    r.xhrOpenNative = !XMLHttpRequest.prototype.open.toString().includes('[native code]');
    r.xhrSendNative = !XMLHttpRequest.prototype.send.toString().includes('[native code]');
    r.xhrOpenFirst100 = XMLHttpRequest.prototype.open.toString().substring(0, 100);
    r.xhrSendFirst100 = XMLHttpRequest.prototype.send.toString().substring(0, 100);

    return r;
  });

  console.log('sseReady: ' + debug.sseReady);
  console.log('fetchWrapped: ' + debug.fetchWrapped);
  console.log('xhrOpen native-like: ' + debug.xhrOpenNative);
  console.log('xhrSend native-like: ' + debug.xhrSendNative);
  console.log('');
  if (debug.debug) {
    var d = debug.debug;
    console.log('=== Debug ===');
    console.log('fetch_wrapperCalledTotal: ' + d.wrapperCalledTotal);
    console.log('fetch_setterCalled: ' + d.setterCalledTotal);
    console.log('fetch_getterCalled: ' + d.getterCalledTotal);
    console.log('xhr_openCalled: ' + d.xhrOpenCalled);
    console.log('xhr_sendCalled: ' + d.xhrSendCalled);
    console.log('xhr_matchingUrl: ' + d.xhrMatchingUrl);
    console.log('xhr_pollActive: ' + d.xhrPollActive);
    console.log('xhr_pollCount: ' + d.xhrPollCount);
    console.log('xhr_totalBytes: ' + d.xhrTotalBytes);
  }
  if (debug.streamState) {
    console.log('');
    console.log('=== Stream ===');
    console.log(JSON.stringify(debug.streamState));
  }

  await browser.close();
}

run().catch(console.error);