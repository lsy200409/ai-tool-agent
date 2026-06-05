var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var LOG_FILE = path.resolve(__dirname, '..', 'debug-fetch-' + Date.now() + '.json');
var events = [];
var startTime = Date.now();

function evt(type, data) {
  events.push({ time: Date.now() - startTime, type: type, data: data });
  console.log('[' + ((Date.now() - startTime)/1000).toFixed(1) + 's] [' + type + '] ' + JSON.stringify(data).substring(0, 300));
}

async function run() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Fetch 拦截器调试诊断');
  console.log('='.repeat(60));
  console.log('');

  await new Promise(function(r) { setTimeout(r, 10000); });

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
  await page.waitForTimeout(10000);

  page.on('console', function(msg) {
    var text = msg.text();
    if (text.length > 300) text = text.substring(0, 300) + '...';
    evt('console_' + msg.type(), { text: text });
  });

  var check = await page.evaluate(function() {
    var r = {};

    r.sseInterceptorReady = !!window.__ds_sse_interceptor_ready;

    r.interceptorDebug = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : null;

    r.streamState = window.__ds_streamState ? window.__ds_streamState() : null;

    r.fetchAtRuntime = !window.fetch.toString().includes('[native code]');
    r.fetchLen = window.fetch.toString().length;
    r.fetchFirst200 = window.fetch.toString().substring(0, 200);

    r.injectedAlive = !!window.__deepseekToolAgentInjected;

    return r;
  });

  evt('check', check);

  console.log('');
  console.log('=== Interceptor 状态 ===');
  console.log('  loaded: ' + check.sseInterceptorReady);
  console.log('');
  console.log('=== Debug 数据 ===');
  if (check.interceptorDebug) {
    var d = check.interceptorDebug;
    console.log('  fetchAtLoadNative: ' + d.fetchAtLoadNative);
    console.log('  fetchAtLoadStr: ' + d.fetchAtLoadStr);
    console.log('  fetchDescWritable: ' + d.fetchDescWritable);
    console.log('  fetchDescConfigurable: ' + d.fetchDescConfigurable);
    console.log('  fetchDescHasGetter: ' + d.fetchDescHasGetter);
    console.log('  definePropertyUsed: ' + d.definePropertyUsed);
    console.log('  wrapperCalledTotal: ' + d.wrapperCalledTotal);
    console.log('  wrapperCalledMatchingUrl: ' + d.wrapperCalledMatchingUrl);
    console.log('  wrapperCalledNonMatching: ' + d.wrapperCalledNonMatching);
    console.log('  setterCalledTotal: ' + d.setterCalledTotal);
    console.log('  getterCalledTotal: ' + d.getterCalledTotal);
    console.log('  urlsSeen (' + (d.urlsSeen || []).length + '):');
    if (d.urlsSeen) {
      for (var i = 0; i < d.urlsSeen.length; i++) {
        console.log('    ' + d.urlsSeen[i]);
      }
    }
  } else {
    console.log('  (interceptor debug 不可用)');
  }

  console.log('');
  console.log('=== Stream State ===');
  console.log('  ' + JSON.stringify(check.streamState));

  console.log('');
  console.log('=== fetch 运行时 ===');
  console.log('  wrapped: ' + check.fetchAtRuntime);
  console.log('  len: ' + check.fetchLen);
  console.log('  first200: ' + check.fetchFirst200);

  console.log('');

  if (check.interceptorDebug) {
    var d = check.interceptorDebug;
    if (!d.fetchAtLoadNative) {
      console.log('⚠️  document_start 时 window.fetch 不是原生函数！');
      console.log('   这是 root cause — fetch 在 document_start 时已被包装');
      console.log('   实际类型: ' + d.fetchAtLoadStr);
    } else if (d.fetchDescHasGetter) {
      console.log('⚠️  window.fetch 已有 getter/setter！');
      console.log('   浏览器已在 fetch 上设置了自定义属性描述符');
    } else if (d.wrapperCalledTotal === 0) {
      console.log('❌ wrapper 从未被调用！');
      console.log('   getter 被调用了 ' + d.getterCalledTotal + ' 次');
      console.log('   setter 被调用了 ' + d.setterCalledTotal + ' 次');
      console.log('   → fetch 访问通过 getter，但 DeepSeek 在拦截器安装前捕获了引用');
    } else if (d.wrapperCalledTotal > 0) {
      console.log('✅ wrapper 被调用了 ' + d.wrapperCalledTotal + ' 次');
      if (d.wrapperCalledMatchingUrl === 0) {
        console.log('⚠️  但没有任何 URL 匹配 chat/completion');
      }
    }
  }

  var fs_check = await page.evaluate(function() {
    return {
      fetchIsWrapped: !window.fetch.toString().includes('[native code]'),
      fetchSourceLen: window.fetch.toString().length
    };
  });
  console.log('');
  console.log('fetch 当前状态: wrapped=' + fs_check.fetchIsWrapped + ' len=' + fs_check.fetchSourceLen);

  fs.writeFileSync(LOG_FILE, JSON.stringify({
    startTime: new Date(startTime).toISOString(),
    check: check,
    events: events
  }, null, 2));
  console.log('日志: ' + LOG_FILE);
  console.log('');
  console.log('浏览器保持打开。按 Ctrl+C 退出。');
  await new Promise(function() {});
}

run().catch(function(e) {
  console.error('错误:', e.message);
  console.error(e.stack);
  process.exit(1);
});