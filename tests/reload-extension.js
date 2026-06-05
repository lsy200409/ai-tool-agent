var { chromium } = require('playwright-core');

async function main() {
  console.log('连接 Chrome CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];

  // 方法1: 通过 background page 执行 chrome.runtime.reload()
  // 先找到扩展的 background page
  var bgPage = null;
  for (var pg of ctx.pages()) {
    if (pg.url().indexOf('chrome-extension://') >= 0) {
      bgPage = pg;
      break;
    }
  }

  if (bgPage) {
    console.log('找到扩展 background page: ' + bgPage.url());
    try {
      await bgPage.evaluate(function() { chrome.runtime.reload(); });
      console.log('已执行 chrome.runtime.reload()');
    } catch(e) {
      console.log('chrome.runtime.reload() 失败: ' + e.message);
    }
  } else {
    console.log('未找到扩展 background page');
  }

  // 方法2: 通过 CDP 发送扩展 reload 命令
  try {
    var cdpSession = await ctx.newCDPSession(ctx.pages()[0]);
    // 获取扩展信息
    var targets = await browser.contexts()[0].pages();
    console.log('当前页面:');
    targets.forEach(function(p) { console.log('  ' + p.url()); });
  } catch(e) {
    console.log('CDP 方法失败: ' + e.message);
  }

  // 等待扩展重新加载
  console.log('等待扩展重新加载...');
  await new Promise(function(r) { setTimeout(r, 5000); });

  // 刷新 DeepSeek 页面
  var dsPage = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (dsPage) {
    console.log('刷新 DeepSeek 页面...');
    await dsPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(function(r) { setTimeout(r, 8000); });

    // 检查状态
    var state = await dsPage.evaluate(function() {
      return new Promise(function(resolve) {
        var timeout = setTimeout(function() { resolve({ error: 'timeout' }); }, 2000);
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === '__ds_test_state_response') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(e.data);
          }
        });
        window.postMessage({ type: '__ds_test_query_state' }, '*');
      });
    });
    console.log('\n扩展重新加载后状态:');
    console.log(JSON.stringify(state, null, 2));
  }

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
