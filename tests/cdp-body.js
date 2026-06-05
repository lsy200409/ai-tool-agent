var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var LOG_FILE = path.resolve(__dirname, '..', 'cdp-body-' + Date.now() + '.json');
var startTime = Date.now();

function ts() { return ((Date.now() - startTime) / 1000).toFixed(1); }

async function run() {
  console.log('='.repeat(60));
  console.log('  CDP 完整响应体捕获');
  console.log('='.repeat(60));

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var contexts = browser.contexts();
  var pages = contexts[0].pages();
  var page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
  if (!page) { page = await contexts[0].newPage(); await page.goto('https://chat.deepseek.com/'); }
  await page.waitForTimeout(10000);

  console.log('页面: ' + page.url());
  console.log('');

  var cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  var chatReqId = null;
  var chatRespBody = null;
  var chatRespChunks = [];
  var streamDataReceivedLength = 0;

  cdp.on('Network.requestWillBeSent', function(p) {
    if ((p.request.url || '').indexOf('chat/completion') >= 0) {
      chatReqId = p.requestId;
      console.log('[NET] REQ: ' + p.request.method + ' ' + p.request.url.substring(0, 80));
      if (p.request.postData) {
        console.log('[NET] POST body size: ' + p.request.postData.length);
      }
    }
  });

  cdp.on('Network.responseReceived', function(p) {
    if (p.requestId === chatReqId) {
      console.log('[NET] RES: ' + p.response.status + ' ' + p.response.mimeType);
      console.log('[NET] Headers: ' + JSON.stringify(p.response.headers).substring(0, 300));
    }
  });

  cdp.on('Network.dataReceived', function(p) {
    if (p.requestId === chatReqId) {
      streamDataReceivedLength += p.dataLength;
      if (streamDataReceivedLength % 1000 < p.dataLength ||
          streamDataReceivedLength < 500) {
        process.stdout.write('\r  已接收: ' + streamDataReceivedLength + ' bytes');
      }
    }
  });

  cdp.on('Network.loadingFinished', function(p) {
    if (p.requestId === chatReqId) {
      console.log('');
      console.log('[NET] 请求完成, encodedDataLength=' + p.encodedDataLength);
    }
  });

  cdp.on('Network.loadingFailed', function(p) {
    if (p.requestId === chatReqId) {
      console.log('[NET] 请求失败: ' + p.errorText);
    }
  });

  await page.click('textarea');
  await page.waitForTimeout(300);

  await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    var s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(ta, '你好，1+1=?');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      data: '你好，1+1=?', inputType: 'insertText'
    }));
  });

  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  console.log('');
  console.log('消息已发送，等待响应...');
  console.log('');

  var maxWait = 40;
  for (var w = 0; w < maxWait; w++) {
    await page.waitForTimeout(1000);

    var dbg = await page.evaluate(function() {
      var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
      var ss = window.__ds_streamState ? window.__ds_streamState() : null;
      return {
        xhr_match: d.xhrMatchingUrl || 0,
        xhr_pollActive: d.xhrPollActive || false,
        xhr_bytes: d.xhrTotalBytes || 0,
        xhr_pollCount: d.xhrPollCount || 0,
        xhr_sample: d.xhrSampleText || '',
        reqCount: ss ? ss.requestCount : 0
      };
    });

    if (w < 3 || dbg.xhr_match > 0 || (w % 5 === 0)) {
      process.stdout.write('\r  ' + (w+1) + 's' +
        '  xhrMatch=' + dbg.xhr_match +
        '  poll=' + dbg.xhr_pollActive +
        '  bytes=' + dbg.xhr_bytes +
        '  pollCnt=' + dbg.xhr_pollCount +
        '  cdpBytes=' + streamDataReceivedLength);
    }
  }

  console.log('');
  console.log('');

  if (chatReqId) {
    try {
      var body = await cdp.send('Network.getResponseBody', { requestId: chatReqId });
      chatRespBody = body.body;
      var base64 = body.base64Encoded;
      console.log('=== CDP 完整响应体 (' + (chatRespBody || '').length + ' bytes) ===');
      console.log('base64: ' + base64);

      if (chatRespBody) {
        var truncated = chatRespBody.substring(0, 2000);
        console.log(truncated);
        if (chatRespBody.length > 2000) {
          console.log('... (截断, 总计 ' + chatRespBody.length + ' 字节)');
        }
      }
    } catch (e) {
      console.log('无法获取响应体: ' + e.message);
    }
  } else {
    console.log('未捕获到 chat/completion 请求');
  }

  var finalDebug = await page.evaluate(function() {
    var d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
    return {
      xhr_match: d.xhrMatchingUrl,
      xhr_pollActive: d.xhrPollActive,
      xhr_pollCount: d.xhrPollCount,
      xhr_bytes: d.xhrTotalBytes,
      xhr_responseType: d.xhrResponseType,
      xhr_readyStateAtPoll: d.xhrReadyStateAtPoll,
      xhr_sampleText: d.xhrSampleText
    };
  });

  console.log('');
  console.log('=== XHR 拦截器最终状态 ===');
  console.log(JSON.stringify(finalDebug, null, 2));

  fs.writeFileSync(LOG_FILE, JSON.stringify({
    time: new Date(startTime).toISOString(),
    chatReqId: chatReqId,
    responseBody: chatRespBody ? chatRespBody.substring(0, 5000) : null,
    responseBodyLength: chatRespBody ? chatRespBody.length : 0,
    cdpBytesReceived: streamDataReceivedLength,
    xhrDebug: finalDebug
  }, null, 2));

  console.log('');
  console.log('日志: ' + LOG_FILE);
  console.log('浏览器保持打开。按 Ctrl+C 退出。');
  await new Promise(function() {});
}

run().catch(function(e) { console.error(e); process.exit(1); });