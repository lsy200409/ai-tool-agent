var { chromium } = require('playwright-core');

async function run() {
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var pages = contexts[0].pages();
  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
  if (!page) { console.log('NO PAGE'); process.exit(1); }

  var debug = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    var ss = window.__ds_streamState ? window.__ds_streamState() : null;
    return {
      sseReady: !!window.__ds_sse_interceptor_ready,
      streamState: ss,
      fetch_wrapperTotal: d.wrapperCalledTotal,
      fetch_setter: d.setterCalledTotal,
      fetch_getter: d.getterCalledTotal,
      fetchAtLoadNative: d.fetchAtLoadNative,
      fetchDescWritable: d.fetchDescWritable,
      fetchDescConfigurable: d.fetchDescConfigurable,
      fetchDescHasGetter: d.fetchDescHasGetter,
      xhr_open: d.xhrOpenCalled,
      xhr_send: d.xhrSendCalled,
      xhr_match: d.xhrMatchingUrl,
      xhr_pollActive: d.xhrPollActive,
      xhr_pollCount: d.xhrPollCount,
      xhr_bytes: d.xhrTotalBytes,
      xhr_responseType: d.xhrResponseType,
      xhr_readyStateAtPoll: d.xhrReadyStateAtPoll,
      xhr_sampleText: d.xhrSampleText,
      urlsSeen: d.urlsSeen
    };
  });

  console.log(JSON.stringify(debug, null, 2));

  await browser.close();
}

run().catch(console.error);