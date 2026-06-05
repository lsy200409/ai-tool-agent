var { chromium } = require('playwright-core');
var path = require('path');
var EXT_PATH = path.resolve(__dirname, '..');

(async () => {
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var pages = browser.contexts()[0].pages();

  var extPage = pages.find(function(p) { return p.url().indexOf('extensions') >= 0; });
  if (!extPage) {
    extPage = await browser.contexts()[0].newPage();
    await extPage.goto('edge://extensions/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await extPage.waitForTimeout(3000);
  }
  await extPage.bringToFront();

  console.log('在扩展页面尝试启用开发者模式...');

  var devModeEnabled = await extPage.evaluate(function() {
    var toggle = document.querySelector('extensions-manager')
      && document.querySelector('extensions-manager').shadowRoot
      && document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar')
      && document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot
      && document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot.querySelector('#devMode');

    if (toggle && toggle.getAttribute('aria-pressed') !== 'true') {
      toggle.click();
      return '已点击开发者模式开关';
    }
    return toggle ? '开发者模式已开启' : '未找到开发者模式开关';
  });

  console.log(devModeEnabled);
  await extPage.waitForTimeout(2000);

  console.log('尝试点击"加载解压缩的扩展"...');

  var loadClicked = await extPage.evaluate(function(dir) {
    var toolbar = document.querySelector('extensions-manager')
      && document.querySelector('extensions-manager').shadowRoot
      && document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar');
    if (!toolbar || !toolbar.shadowRoot) return '未找到工具栏';

    var loadBtn = toolbar.shadowRoot.querySelector('#loadUnpacked');
    if (loadBtn) {
      loadBtn.click();
      return '已点击加载按钮（需要选择文件夹）';
    }
    return '未找到加载按钮';
  }, EXT_PATH);

  console.log(loadClicked);
  console.log('');
  console.log('如果弹出了文件夹选择对话框，请选择:');
  console.log('  ' + EXT_PATH);
  console.log('');
  console.log('选择后等待 3 秒...');

  await extPage.waitForTimeout(3000);

  var staticDir = path.resolve(EXT_PATH, 'native-messaging', 'static');
  var fs = require('fs');
  if (fs.existsSync(staticDir)) {
    console.log('static 目录存在', staticDir);
  }

  console.log('');
  console.log('等待 5 秒让扩展加载...');
  await extPage.waitForTimeout(5000);

  var loaded = await extPage.evaluate(function() {
    var manager = document.querySelector('extensions-manager');
    if (!manager || !manager.shadowRoot) return [];

    var list = manager.shadowRoot.querySelector('extensions-item-list');
    if (!list || !list.shadowRoot) return [];

    var items = list.shadowRoot.querySelectorAll('extensions-item');
    var results = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var itemRoot = item.shadowRoot;
      if (!itemRoot) continue;
      var nameEl = itemRoot.querySelector('#name');
      results.push({
        name: nameEl ? nameEl.textContent.trim() : item.textContent.substring(0, 60),
        index: i
      });
    }
    return results;
  });

  console.log('当前加载的扩展:');
  for (var i = 0; i < loaded.length; i++) {
    console.log('  ' + (i+1) + '. ' + loaded[i].name);
  }

  console.log('');
  console.log('操作完成。浏览器保持打开。');

})();