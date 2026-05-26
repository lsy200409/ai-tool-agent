const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

var TOOL_SERVER_PORT = 3002;
var toolServerProcess = null;

async function startToolServer() {
  return new Promise(function(resolve, reject) {
    var serverPath = path.resolve(__dirname, '..', 'server', 'tool-server.js');
    toolServerProcess = spawn('node', [serverPath], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PORT: String(TOOL_SERVER_PORT), TOOL_SERVER_PORT: String(TOOL_SERVER_PORT) })
    });

    var started = false;
    var timeout = setTimeout(function() {
      if (!started) {
        toolServerProcess.kill();
        reject(new Error('Tool server start timeout'));
      }
    }, 15000);

    toolServerProcess.stdout.on('data', function(data) {
      var msg = data.toString();
      console.log('[ToolServer]', msg.trim());
      if (!started && (msg.indexOf('started') >= 0 || msg.indexOf('listening') >= 0 || msg.indexOf('running') >= 0 || msg.indexOf('3002') >= 0)) {
        started = true;
        clearTimeout(timeout);
        setTimeout(function() { resolve(toolServerProcess); }, 500);
      }
    });

    toolServerProcess.stderr.on('data', function(data) {
      console.log('[ToolServer:err]', data.toString().trim());
      if (!started && data.toString().indexOf('listening') >= 0) {
        started = true;
        clearTimeout(timeout);
        setTimeout(function() { resolve(toolServerProcess); }, 500);
      }
    });

    toolServerProcess.on('error', function(err) {
      clearTimeout(timeout);
      reject(err);
    });

    toolServerProcess.on('exit', function(code) {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error('Tool server exited with code ' + code));
      }
    });
  });
}

function stopToolServer() {
  return new Promise(function(resolve) {
    if (toolServerProcess) {
      toolServerProcess.on('exit', function() { resolve(); });
      toolServerProcess.kill('SIGTERM');
      setTimeout(function() {
        try { toolServerProcess.kill('SIGKILL'); } catch(e) {}
        resolve();
      }, 3000);
    } else {
      resolve();
    }
  });
}

async function waitForToolServer(timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise(function(resolve, reject) {
        var req = http.get('http://localhost:' + TOOL_SERVER_PORT + '/api/status', function(res) {
          resolve(res);
        });
        req.on('error', reject);
        req.setTimeout(1000, function() { req.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch(e) {
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }
  return false;
}

async function setupRealEnvPage(page) {
  await page.goto('http://localhost:3456/mock-deepseek.html', { waitUntil: 'domcontentloaded', timeout: 15000 });

  await page.addScriptTag({ content: `
    window.__ds_panel_mock = true;
    window.__ds_real_env = true;
    if (!window.chrome) window.chrome = {};
    if (!chrome.runtime) {
      chrome.runtime = {
        id: 'mock-real-env-id',
        onMessage: {
          addListener: function(cb) { window.__ds_chrome_onMessage_cb = cb; }
        },
        sendMessage: function(msg, cb) {
          if (msg && msg.action === 'executeTool' && msg.tool && msg.tool.name) {
            try {
              var http = new XMLHttpRequest();
              http.open('POST', 'http://localhost:3002/exec', false);
              http.setRequestHeader('Content-Type', 'application/json');
              http.send(JSON.stringify({ tool: msg.tool.name, args: msg.tool.arguments || {} }));
              var raw = JSON.parse(http.responseText);
              var wrapped = raw.error
                ? { success: false, error: raw.error.message || '执行失败' }
                : { success: true, data: raw };
              window.__ds_toolResult = wrapped;
              window.__ds_toolResultTime = Date.now();
              window.__ds_lastToolResult = wrapped;
              if (cb) cb(wrapped);
            } catch(e) {
              var errResult = { success: false, error: e.message };
              window.__ds_toolResult = errResult;
              window.__ds_toolResultTime = Date.now();
              window.__ds_lastToolResult = errResult;
              if (cb) cb(errResult);
            }
            return;
          }
          if (cb) cb({ success: true });
        },
        getURL: function(p) { return p; },
        connect: function() {
          return {
            onMessage: { addListener: function() {} },
            onDisconnect: { addListener: function() {} },
            disconnect: function() {},
            postMessage: function() {}
          };
        }
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
    console.log('[RealEnv] chrome.* APIs shimmed with tool execution bridge');
  ` });

  var scriptRoot = path.resolve(__dirname, '..', 'src');
  var contentScripts = [
    'ui/panel-css.js',
    'core/state.js',
    'core/logger.js',
    'core/tool-call-parser.js',
    'dom/input.js',
    'dom/ai-message.js',
    'core/config.js',
    'ui/file-browser.js',
    'ui/panel.js',
    'ui/connection.js',
    'ui/actions.js',
    'core/parser.js',
    'core/executor.js',
    'core/backfill.js',
    'tools/registry.js',
    'tools/builtin.js',
    'monitor/input-monitor.js',
    'router.js',
    'gateway/bridge.js'
  ];

  for (var i = 0; i < contentScripts.length; i++) {
    try {
      await page.addScriptTag({ path: path.join(scriptRoot, contentScripts[i]) });
      console.log('[RealEnv:load] ' + contentScripts[i]);
    } catch (e) {
      console.log('[RealEnv:FAIL] ' + contentScripts[i] + ': ' + e.message);
    }
  }

  await page.evaluate(function() {
    if (typeof initializePanel === 'function') {
      initializePanel();
    } else {
      if (typeof injectPanelHTML === 'function') injectPanelHTML();
      if (typeof injectPanelCSS === 'function') injectPanelCSS();
    }
    if (typeof updateServerStatusUI === 'function') updateServerStatusUI(true);
    console.log('[RealEnv] Panel initialized');
  });
}

async function startMonitor(page) {
  await page.evaluate(function() {
    if (typeof MONITOR === 'undefined' || !MONITOR.observer) {
      throw new Error('MONITOR not available - ensure input-monitor.js is loaded');
    }
    MONITOR.observer.start();
  });
}

async function stopMonitor(page) {
  await page.evaluate(function() {
    if (typeof MONITOR !== 'undefined' && MONITOR.observer) {
      MONITOR.observer.stop('test');
    }
  });
}

async function simulateAIStreaming(page, fullText, options) {
  options = options || {};
  var chunkSize = options.chunkSize || 10;
  var chunkDelay = options.chunkDelay || 50;
  var stableDelay = options.stableDelay || 2000;

  await stopMonitor(page);

  await page.evaluate(function() {
    window.__ds_clearMessages();
    window.__ds_setStreaming(true);
  });

  var contentEl = await page.evaluate(function() {
    return window.__ds_addAssistantMessage('');
  });

  var handle = await page.evaluateHandle(function() { return window.__ds_getLatestAssistantContent(); });
  var currentText = '';

  for (var i = 0; i < fullText.length; i += chunkSize) {
    var chunk = fullText.substring(i, Math.min(i + chunkSize, fullText.length));
    currentText += chunk;
    await page.evaluate(function(args) {
      var el = document.querySelectorAll('.ds-assistant-message-main-content');
      var last = el[el.length - 1];
      if (last) last.textContent = args[0];
    }, [currentText]);
    await page.waitForTimeout(chunkDelay);
  }

  if (options.streamingDone !== false) {
    await page.evaluate(function() { window.__ds_setStreaming(false); });
  }

  return handle;
}

async function waitForMonitorState(page, expectedState, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  try {
    await page.waitForFunction(function(expected) {
      return typeof MONITOR !== 'undefined' && MONITOR.state === expected;
    }, expectedState, { timeout: timeoutMs });
    return true;
  } catch (e) {
    return false;
  }
}

async function waitForToolExecution(page, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  try {
    await page.waitForFunction(function() {
      return window.__ds_lastToolResult !== undefined;
    }, {}, { timeout: timeoutMs });
    var result = await page.evaluate(function() { return window.__ds_lastToolResult; });
    return result;
  } catch (e) {
    return null;
  }
}

async function getMonitorState(page) {
  return page.evaluate(function() {
    return {
      state: MONITOR ? MONITOR.state : 'unknown',
      aiStarted: MONITOR ? MONITOR.aiStarted : false,
      stableCount: MONITOR ? MONITOR.stableCount : 0,
      lastAiTextLength: MONITOR ? (MONITOR.lastAiText ? MONITOR.lastAiText.length : 0) : 0,
      toolChainIterations: MONITOR ? MONITOR._toolChainIterations : 0
    };
  });
}

module.exports = {
  startToolServer,
  stopToolServer,
  waitForToolServer,
  setupRealEnvPage,
  startMonitor,
  stopMonitor,
  simulateAIStreaming,
  waitForMonitorState,
  waitForToolExecution,
  getMonitorState,
  TOOL_SERVER_PORT
};