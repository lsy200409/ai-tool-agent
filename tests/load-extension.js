// 加载扩展到 Edge 并等待 Service Worker
var { chromium } = require('playwright-core');
var http = require('http');
var fs = require('fs');
var path = require('path');

var CDP_URL = 'http://localhost:9222';
var EXT_ID = 'diaocpmadbepofacimmkigkkkeihnjio';
var EXT_PATH = path.resolve(__dirname, '..');

function log(msg) { console.log('[' + new Date().toLocaleTimeString() + '] ' + msg); }
function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function run() {
  var browser = await chromium.connectOverCDP(CDP_URL);
  log('CDP 连接成功');
  var context = browser.contexts()[0];

  // 打开 edge://extensions/
  var extPage = await context.newPage();
  await extPage.goto('edge://extensions/', { waitUntil: 'load', timeout: 10000 });
  await wait(3000);

  // 检查扩展是否已安装
  var checkResult = await extPage.evaluate(function(extId) {
    // 查找所有 extensions-item
    var items = document.querySelectorAll('extensions-item');
    if (items.length > 0) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === extId) return { installed: true, id: items[i].id };
      }
    }
    return { installed: false, itemCount: items.length, bodyText: document.body.innerText.substring(0, 500) };
  }, EXT_ID);

  log('扩展检查: ' + JSON.stringify(checkResult));

  if (!checkResult.installed) {
    log('扩展未安装！请在 Edge 中手动加载：');
    log('  1. 打开 edge://extensions/');
    log('  2. 开启"开发人员模式"');
    log('  3. 点击"加载解压缩的扩展"');
    log('  4. 选择目录: ' + EXT_PATH);
    log('');
    log('等待扩展安装... (每5秒检查一次，最多3分钟)');

    for (var i = 0; i < 36; i++) {
      await wait(5000);
      var recheck = await extPage.evaluate(function(extId) {
        var items = document.querySelectorAll('extensions-item');
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === extId) return { installed: true };
        }
        return { installed: false };
      }, EXT_ID);

      if (recheck.installed) {
        log('扩展已安装！');
        break;
      }
      if (i % 4 === 3) log('  仍在等待... (' + (i + 1) * 5 + 's)');
    }
  }

  // 等待 Service Worker
  log('等待 Service Worker...');
  var cdpSession = await browser.newBrowserCDPSession();

  for (var j = 0; j < 10; j++) {
    var targets = await cdpSession.send('Target.getTargets');
    var swTarget = targets.targetInfos.find(function(t) {
      return t.type === 'service_worker' && t.url && t.url.indexOf(EXT_ID) >= 0;
    });
    if (swTarget) {
      log('Service Worker 已启动: ' + swTarget.targetId);
      break;
    }
    if (j === 0) {
      // 触发 content script
      var triggerPage = await context.newPage();
      try { await triggerPage.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 10000 }); } catch(e) {}
    }
    await wait(3000);
  }

  log('完成。浏览器保持打开。');
  process.exit(0);
}

run().catch(function(e) {
  log('异常: ' + e.message);
  process.exit(1);
});
