const path = require('path');

async function setupMockDeepSeekPage(page) {
  await page.goto('http://localhost:3456/', { waitUntil: 'domcontentloaded', timeout: 15000 });

  await page.addScriptTag({ content: `
    window.__ds_panel_mock = true;
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!chrome.runtime) {
      chrome.runtime = {
        id: 'mock-extension-id',
        onMessage: { addListener: function() {} },
        sendMessage: function(msg, cb) { if (cb) cb({ success: true }); },
        getURL: function(p) { return p; },
        connect: function() { return { onMessage: { addListener: function() {} }, onDisconnect: { addListener: function() {} }, disconnect: function() {}, postMessage: function() {} }; }
      };
    }
    if (!chrome.storage) {
      chrome.storage = {
        local: {
          get: function(keys, cb) { cb({ workspacePath: 'f:/桌面/web_free_agent/deepseek-tool-agent/workspace' }); },
          set: function(data, cb) { if (cb) cb(); }
        }
      };
    }
    console.log('[Mock] chrome.* APIs shimmed');
  ` });

  var scriptRoot = path.resolve(__dirname, '..', 'src');
  var scriptFiles = [
    'core/state.js',
    'core/logger.js',
    'core/config.js',
    'core/tool-call-parser.js',
    'tools/registry.js',
    'tools/builtin.js',
    'ui/panel-css.js',
    'ui/connection.js',
    'ui/actions.js',
    'ui/file-browser.js',
    'ui/panel.js',
    'monitor/input-monitor.js',
  ];

  for (var i = 0; i < scriptFiles.length; i++) {
    try {
      await page.addScriptTag({ path: path.join(scriptRoot, scriptFiles[i]) });
      console.log('[Inject] loaded:', scriptFiles[i]);
    } catch (e) {
      console.log('[Inject] FAILED:', scriptFiles[i], e.message);
    }
  }

  await page.evaluate(function() {
    if (typeof initializePanel === 'function') {
      initializePanel();
    } else if (typeof injectPanelHTML === 'function' && typeof injectPanelCSS === 'function') {
      injectPanelCSS();
      injectPanelHTML();
    }
    if (typeof updateServerStatusUI === 'function') {
      updateServerStatusUI(true);
    }
    console.log('[PanelTest] Panel initialized');
  });
}

async function waitForPanel(page) {
  try {
    await page.waitForFunction(function() {
      var panel = document.getElementById('__ds-agent-panel');
      return panel && panel.style.display !== 'none' && typeof panel.classList !== 'undefined';
    }, {}, { timeout: 20000 });
    await page.waitForTimeout(500);
  } catch (e) {
    console.log('[waitForPanel] Panel not in DOM. Checking...');
    var bodyHTML = await page.evaluate(function() { return document.body.innerHTML.substring(0, 300); });
    console.log('Body HTML:', bodyHTML);
    throw e;
  }
}

async function openPanel(page) {
  var panel = await page.$('#__ds-agent-panel');
  if (!panel) throw new Error('Panel not found');
  var isVisible = await panel.evaluate(function(el) { return el.classList.contains('visible'); });
  if (!isVisible) {
    await page.click('#__ds-pet-ball');
    await page.waitForSelector('#__ds-agent-panel.visible', { timeout: 5000 });
  }
}

async function closePanel(page) {
  await page.evaluate(function() {
    var panel = document.getElementById('__ds-agent-panel');
    var pet = document.getElementById('__ds-pet-ball');
    if (panel && panel.classList.contains('visible')) {
      if (typeof closePanel === 'function') {
        closePanel(panel, pet);
      } else {
        panel.classList.remove('visible');
        panel.style.display = 'none';
        if (pet) pet.classList.remove('visible');
      }
      if (typeof closeAllOverlays === 'function') closeAllOverlays();
    }
  });
  await page.waitForFunction(function() {
    var p = document.getElementById('__ds-agent-panel');
    return p && !p.classList.contains('visible');
  }, {}, { timeout: 3000 });
}

module.exports = {
  setupMockDeepSeekPage,
  waitForPanel,
  openPanel,
  closePanel,
};