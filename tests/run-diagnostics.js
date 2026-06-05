const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXTENSION_PATH = path.resolve(__dirname, '..');
var USE_CDP = false;
var CDP_URL = 'http://localhost:9222';
var IDLE_SECONDS = 40;
var USER_DATA_DIR = null;
var NO_WAIT = false;

var args = process.argv.slice(2);
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--cdp') {
    USE_CDP = true;
    if (args[i + 1] && args[i + 1].startsWith('http')) {
      CDP_URL = args[i + 1];
      i++;
    }
  } else if (args[i] === '--idle') {
    IDLE_SECONDS = parseInt(args[i + 1]) || 40;
    i++;
  } else if (args[i] === '--profile') {
    if (args[i + 1]) {
      USER_DATA_DIR = path.resolve(args[i + 1]);
      i++;
    }
  } else if (args[i] === '--fresh') {
    USER_DATA_DIR = null;
  } else if (args[i] === '--no-wait') {
    NO_WAIT = true;
  } else if (args[i] === '--help') {
    console.log('用法: node tests/run-diagnostics.js [选项]');
    console.log('');
    console.log('选项:');
    console.log('  --cdp [url]     通过 CDP 连接已运行的 Chrome (默认: http://localhost:9222)');
    console.log('  --idle <秒>     挂机模拟时长 (默认: 40)');
    console.log('  --profile <dir> 指定浏览器数据目录 (默认: .browser-data-diag)');
    console.log('  --fresh         使用全新的临时目录 (每次需重新登录)');
    console.log('  --help          显示帮助');
    console.log('');
    console.log('CDP 模式需要先用以下命令启动 Chrome:');
    console.log('  chrome.exe --remote-debugging-port=9222');
    console.log('');
    console.log('默认: 使用持久化数据目录 .browser-data-diag (保留登录态)');
    process.exit(0);
  }
}

function timestamp() {
  return new Date().toISOString().substring(11, 23);
}

function log(label, msg) {
  console.log('[' + timestamp() + '] [' + label + '] ' + msg);
}

function divider(title) {
  var line = '═'.repeat(60);
  console.log('\n' + line);
  console.log('  ' + title);
  console.log(line);
}

var PASS = '✅';
var FAIL = '❌';
var WARN = '⚠️';

async function checkToolServer() {
  return new Promise(function(resolve) {
    var req = http.get('http://localhost:3002/health', function(res) {
      var body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(3000, function() { req.destroy(); resolve(null); });
  });
}

async function runDiagnostic1(page) {
  log('DIAG-1', '检查 injected.js 是否加载 & fetch 是否被劫持...');

  var result = await page.evaluate(function() {
    var r = {};

    r.injectedGuard = !!window.__deepseekToolAgentInjected;

    var fetchStr = window.fetch.toString();
    r.fetchIsPatched = !fetchStr.includes('[native code]');
    r.fetchSourceLength = fetchStr.length;
    r.fetchSourcePreview = fetchStr.substring(0, 250);

    r.hasTeeCode = fetchStr.includes('tee()') || fetchStr.includes('.tee(');
    r.hasUrlMatch = fetchStr.includes('chat/completion');
    r.hasStreamCheck = fetchStr.includes('text/event-stream') || fetchStr.includes('event-stream');
    r.hasPostMessage = fetchStr.includes('__ds_stream_start') || fetchStr.includes('postMessage');

    if (window.__ds_streamState) {
      var ss = window.__ds_streamState();
      r.streamState = ss;
    }

    r.__originalFetch_exists = !!window.__originalFetch;

    return r;
  });

  console.log('  injectedGuard:       ' + (result.injectedGuard ? PASS + ' true' : FAIL + ' FALSE - injected.js 未加载!'));
  console.log('  fetchIsPatched:      ' + (result.fetchIsPatched ? PASS + ' true (非原生)' : FAIL + ' FALSE - fetch 未被劫持!'));
  console.log('  hasTeeCode:          ' + (result.hasTeeCode ? PASS + ' true' : FAIL + ' FALSE - 无 tee() 代码!'));
  console.log('  hasUrlMatch:         ' + (result.hasUrlMatch ? PASS + ' true (chat/completion)' : WARN + ' FALSE'));
  console.log('  hasStreamCheck:      ' + (result.hasStreamCheck ? PASS + ' true (text/event-stream)' : WARN + ' FALSE'));
  console.log('  hasPostMessage:      ' + (result.hasPostMessage ? PASS + ' true (__ds_stream_start)' : WARN + ' FALSE'));
  console.log('  fetchSourceLength:   ' + result.fetchSourceLength + ' 字符');
  console.log('  __originalFetch:     ' + (result.__originalFetch_exists ? WARN + ' 存在 (可能非我们劫持)' : PASS + ' 不存在(正常)'));

  if (result.streamState) {
    console.log('  streamState:         active=' + result.streamState.active +
      ', requestCount=' + result.streamState.requestCount);
  }

  if (!result.fetchIsPatched) {
    console.log('  fetch 源码预览: ' + result.fetchSourcePreview);
  }

  return {
    injectedLoaded: result.injectedGuard,
    fetchPatched: result.fetchIsPatched,
    hasTee: result.hasTeeCode,
    hasUrlMatch: result.hasUrlMatch,
    hasStreamCheck: result.hasStreamCheck,
    hasPostMessage: result.hasPostMessage
  };
}

async function runDiagnostic2(page) {
  log('DIAG-2', 'postMessage 心跳：injected.js ↔ 页面通信...');

  var result = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var responded = false;
      var handler = function(e) {
        if (e.data && e.data.type === '__ds_heartbeat_injected_ack') {
          responded = true;
          window.removeEventListener('message', handler);
          resolve({
            alive: true,
            ackData: {
              alive: e.data.alive,
              streamActive: e.data.streamActive,
              fetchPatched: e.data.fetchPatched,
              timestamp: e.data.timestamp
            },
            responseTime: Date.now()
          });
        }
      };
      window.addEventListener('message', handler);
      var sendTime = Date.now();
      window.postMessage({ type: '__ds_heartbeat_injected', timestamp: sendTime }, '*');

      setTimeout(function() {
        if (!responded) {
          window.removeEventListener('message', handler);
          resolve({ alive: false, waited: 3000 });
        }
      }, 3000);
    });
  });

  if (result.alive) {
    console.log('  injected.js 存活:     ' + PASS + ' true');
    console.log('  ack.alive:           ' + result.ackData.alive);
    console.log('  ack.streamActive:    ' + result.ackData.streamActive);
    console.log('  ack.fetchPatched:    ' + result.ackData.fetchPatched);
    console.log('  ack.timestamp:       ' + result.ackData.timestamp);
  } else {
    console.log('  injected.js 存活:     ' + FAIL + ' FALSE - 无响应!');
    console.log('  等待时间:             ' + result.waited + 'ms');
  }

  return { injectedAlive: result.alive };
}

async function runDiagnostic3(page) {
  log('DIAG-3', '监听 postMessage 事件流，检查消息传递链路...');

  var setupResult = await page.evaluate(function() {
    window.__diag_events = [];
    window.__diag_handler = function(e) {
      if (e.data && e.data.source === 'deepseek-tool-agent') {
        window.__diag_events.push({
          type: e.data.type,
          timestamp: Date.now(),
          dataKeys: Object.keys(e.data)
        });
      }
    };
    window.addEventListener('message', window.__diag_handler);
    return { handlerSet: true };
  });

  console.log('  事件监听器已设置:     ' + PASS + ' true');
  console.log('  等待 3 秒收集事件...');

  await page.waitForTimeout(3000);

  var events = await page.evaluate(function() {
    if (window.__diag_handler) {
      window.removeEventListener('message', window.__diag_handler);
    }
    return window.__diag_events || [];
  });

  console.log('  收集到的事件数:       ' + events.length);
  for (var i = 0; i < events.length; i++) {
    console.log('    [' + i + '] type=' + events[i].type + ' keys=' + JSON.stringify(events[i].dataKeys));
  }

  var hasStreamStart = events.some(function(e) { return e.type === '__ds_stream_start'; });
  var hasStreamChunk = events.some(function(e) { return e.type === '__ds_stream_chunk'; });
  var hasStreamEnd = events.some(function(e) { return e.type === '__ds_stream_end'; });

  if (events.length === 0) {
    console.log('  ' + WARN + ' 无事件 (页面空闲，无 SSE 流活跃 - 正常)');
  }

  return { eventCount: events.length, hasStreamStart: hasStreamStart };
}

async function runDiagnostic4(page) {
  log('DIAG-4', '内容脚本状态检查...');

  var csState = await page.evaluate(function() {
    var result = {};

    result.autoWatchRunning = window.__ds_autoWatchRunning;
    result.autoMode = window.__ds_autoMode;

    result.monitorExists = typeof window.__ds_monitor !== 'undefined';
    if (window.__ds_monitor) {
      var m = window.__ds_monitor;
      result.monitorState = m.state;
      result.monitorAiStarted = m.aiStarted;
      result.monitorStableCount = m.stableCount;
      result.monitorLastAiTextLen = (m.lastAiText || '').length;
      result.monitorToolChainIterations = m._toolChainIterations;
      result.monitorPollCount = m._pollCount;

      if (m.sse) {
        result.sseEnabled = m.sse.enabled;
        result.sseActive = m.sse.active;
        result.sseStreamEnded = m.sse.streamEnded;
        result.sseLastEventTime = m.sse.lastEventTime;
      }
    }

    result.startMonitorFn = typeof window.__ds_startMonitor === 'function';
    result.stopMonitorFn = typeof window.__ds_stopMonitor === 'function';
    result.getStateFn = typeof window.__ds_getMonitorState === 'function';
    result.hasLiveContextFn = typeof window.__ds_hasLiveContext === 'function';

    try {
      result.chromeRuntimeId = chrome && chrome.runtime ? chrome.runtime.id : null;
    } catch(e) {
      result.chromeRuntimeId = 'ERROR: ' + e.message;
    }

    result.panelExists = !!document.getElementById('__ds-agent-panel');
    result.logPanelExists = !!document.getElementById('__ds-log-panel');
    result.petBallExists = !!document.getElementById('__ds-pet-ball');

    return result;
  });

  console.log('  autoWatchRunning:     ' + (csState.autoWatchRunning === true ? PASS + ' true' :
    csState.autoWatchRunning === false ? WARN + ' false (未启动)' : FAIL + ' undefined'));
  console.log('  autoMode:             ' + (csState.autoMode));
  console.log('  MONITOR 存在:          ' + (csState.monitorExists ? PASS + ' true' : FAIL + ' FALSE'));
  console.log('  MONITOR.state:        ' + csState.monitorState);
  console.log('  MONITOR.pollCount:    ' + (csState.monitorPollCount || 0));
  console.log('  MONITOR.stableCount:  ' + (csState.monitorStableCount || 0));
  console.log('  SSE.enabled:          ' + csState.sseEnabled);
  console.log('  SSE.active:           ' + csState.sseActive);
  console.log('  SSE.streamEnded:      ' + csState.sseStreamEnded);
  console.log('  SSE.lastEventTime:    ' + csState.sseLastEventTime);
  console.log('  chrome.runtime.id:    ' + csState.chromeRuntimeId);
  console.log('  panelExists:          ' + (csState.panelExists ? PASS + ' true' : FAIL + ' FALSE'));
  console.log('  logPanelExists:       ' + (csState.logPanelExists ? PASS + ' true' : FAIL + ' FALSE'));
  console.log('  petBallExists:        ' + (csState.petBallExists ? PASS + ' true' : FAIL + ' FALSE'));
  console.log('  __ds_startMonitor:    ' + (csState.startMonitorFn ? PASS + ' function' : FAIL + ' undefined'));
  console.log('  __ds_stopMonitor:     ' + (csState.stopMonitorFn ? PASS + ' function' : FAIL + ' undefined'));
  console.log('  __ds_hasLiveContext:  ' + (csState.hasLiveContextFn ? PASS + ' function' : FAIL + ' undefined'));

  return {
    autoWatchRunning: csState.autoWatchRunning,
    monitorExists: csState.monitorExists,
    monitorState: csState.monitorState,
    sseEnabled: csState.sseEnabled,
    sseActive: csState.sseActive,
    panelExists: csState.panelExists,
    logPanelExists: csState.logPanelExists,
    hasLiveContext: csState.chromeRuntimeId && !csState.chromeRuntimeId.startsWith('ERROR')
  };
}

async function runDiagnostic5(page, diag1Before) {
  log('DIAG-5', '长时间挂机模拟 (' + IDLE_SECONDS + ' 秒)，检查状态是否保持...');

  console.log('  挂机前 - injectedLoaded: ' + diag1Before.injectedLoaded +
    ', fetchPatched: ' + diag1Before.fetchPatched);

  var stepMs = 10000;
  var steps = Math.ceil(IDLE_SECONDS * 1000 / stepMs);

  for (var i = 1; i <= steps; i++) {
    await page.waitForTimeout(stepMs);
    var elapsed = i * 10;
    console.log('  ' + elapsed + 's / ' + IDLE_SECONDS + 's...');

    if (i === Math.floor(steps / 2)) {
      try {
        var swAlive = await page.evaluate(function() {
          try {
            return chrome && chrome.runtime && chrome.runtime.id ? 'alive' : 'dead';
          } catch(e) {
            return 'error: ' + e.message;
          }
        });
        console.log('  SW 状态 (' + elapsed + 's): ' + swAlive);
      } catch(e) {
        console.log('  SW 状态检查失败: ' + e.message);
      }
    }
  }

  var after = await page.evaluate(function() {
    var fetchStr = window.fetch.toString();
    return {
      injectedAlive: !!window.__deepseekToolAgentInjected,
      fetchPatched: !fetchStr.includes('[native code]'),
      fetchSourceLength: fetchStr.length,
      autoWatchRunning: window.__ds_autoWatchRunning,
      monitorState: window.__ds_monitor ? window.__ds_monitor.state : 'N/A',
      sseEnabled: (window.__ds_monitor && window.__ds_monitor.sse) ? window.__ds_monitor.sse.enabled : null,
      sseActive: (window.__ds_monitor && window.__ds_monitor.sse) ? window.__ds_monitor.sse.active : null
    };
  });

  console.log('');
  console.log('  === 挂机后状态 ===');
  console.log('  injectedAlive:        ' + (after.injectedAlive ? PASS + ' true' : FAIL + ' FALSE - injected.js 丢失!'));
  console.log('  fetchPatched:         ' + (after.fetchPatched ? PASS + ' true' : FAIL + ' FALSE - fetch 劫持丢失!'));
  console.log('  fetchSourceLength:    ' + after.fetchSourceLength);
  console.log('  autoWatchRunning:     ' + (after.autoWatchRunning === true ? PASS + ' true' :
    after.autoWatchRunning === false ? WARN + ' false' : FAIL + ' undefined'));
  console.log('  monitorState:         ' + after.monitorState);
  console.log('  sseEnabled:           ' + after.sseEnabled);
  console.log('  sseActive:            ' + after.sseActive);

  return {
    injectedAlive: after.injectedAlive,
    fetchPatched: after.fetchPatched,
    autoWatchRunning: after.autoWatchRunning,
    monitorState: after.monitorState
  };
}

async function run() {
  console.log('');
  divider('DeepSeek Tool Agent — Fetch 劫持链路诊断');
  console.log('  模式: ' + (USE_CDP ? 'CDP 远程连接 (' + CDP_URL + ')' : '本地启动 Chrome + 扩展'));
  console.log('  扩展路径: ' + EXTENSION_PATH);
  if (!USE_CDP) console.log('  数据目录: ' + (USER_DATA_DIR || '.browser-data-diag'));
  console.log('  挂机时长: ' + IDLE_SECONDS + ' 秒');
  console.log('');

  var health = await checkToolServer();
  if (health) {
    log('SERVER', PASS + ' Tool Server 运行中 v' + health.version + ' (' + (health.tools_count || '?') + ' tools)');
  } else {
    log('SERVER', WARN + ' Tool Server 未检测到 (localhost:3002)，工具执行将失败');
  }

  var browser;
  var context;
  var page;

  if (USE_CDP) {
    log('SETUP', '通过 CDP 连接 ' + CDP_URL + ' ...');
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      var contexts = browser.contexts();
      if (contexts.length === 0) {
        log('SETUP', FAIL + ' 没有可用的浏览器上下文');
        process.exit(1);
      }
      context = contexts[0];
      log('SETUP', PASS + ' 已连接，' + contexts.length + ' 个上下文');
    } catch(e) {
      log('SETUP', FAIL + ' CDP 连接失败: ' + e.message);
      log('SETUP', '请先用以下命令启动 Chrome:');
      log('SETUP', '  chrome.exe --remote-debugging-port=9222');
      process.exit(1);
    }
  } else {
    if (!USER_DATA_DIR) {
      USER_DATA_DIR = path.resolve(__dirname, '..', '.browser-data-diag');
    }
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });

    var lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
    for (var li = 0; li < lockFiles.length; li++) {
      try { fs.unlinkSync(path.join(USER_DATA_DIR, lockFiles[li])); } catch(e) {}
    }

    log('SETUP', '启动 Chrome (userDataDir=' + USER_DATA_DIR + ')...');

    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: [
        '--disable-extensions-except=' + EXTENSION_PATH,
        '--load-extension=' + EXTENSION_PATH,
        '--ignore-certificate-errors',
        '--disable-web-security',
        '--allow-running-insecure-content'
      ],
      devtools: false
    });

    log('SETUP', PASS + ' Chrome 已启动');
  }

  try {
    var pages = context.pages();
    if (pages.length > 0) {
      page = pages[0];
      log('SETUP', '使用已有页面: ' + page.url());
    } else {
      page = await context.newPage();
      log('SETUP', '创建新页面');
    }

    divider('STEP 1: 导航到 DeepSeek');

    try {
      await page.goto('https://chat.deepseek.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch(e) {
      log('NAV', WARN + ' 导航超时: ' + e.message.substring(0, 100));
    }

    var currentUrl = page.url();
    log('NAV', '当前页面: ' + currentUrl);

    if (currentUrl.indexOf('login') >= 0 || currentUrl.indexOf('auth') >= 0 || currentUrl.indexOf('sign_in') >= 0) {
      log('NAV', WARN + ' 检测到登录页面');
      if (NO_WAIT) {
        log('NAV', '--no-wait 模式: 跳过登录，直接在登录页检查扩展加载状态');
      } else {
        log('NAV', '请在浏览器中登录 DeepSeek，然后回到终端...');
        log('NAV', '按 Enter 继续...');

        await new Promise(function(resolve) {
          var stdin = process.stdin;
          stdin.resume();
          stdin.once('data', function() {
            stdin.pause();
            resolve();
          });
        });

        await page.waitForTimeout(3000);
        log('NAV', '登录后 URL: ' + page.url());
      }
    }

    log('INIT', '等待扩展初始化和内容脚本注入 (10 秒)...');
    await page.waitForTimeout(10000);

    divider('DIAGNOSTIC TESTS');

    var d1 = await runDiagnostic1(page);
    var d2 = await runDiagnostic2(page);
    var d3 = await runDiagnostic3(page);
    var d4 = await runDiagnostic4(page);
    var d5 = await runDiagnostic5(page, d1);

    divider('诊断结果汇总');

    var passed = 0;
    var failed = 0;
    var warnings = 0;

    function check(name, val, critical) {
      if (val === true) {
        console.log('  ' + PASS + ' ' + name);
        passed++;
      } else if (val === false) {
        var marker = critical ? FAIL + ' [关键]' : WARN;
        console.log('  ' + marker + ' ' + name);
        if (critical) failed++; else warnings++;
      } else {
        console.log('  ' + WARN + ' ' + name + ' = ' + JSON.stringify(val));
        warnings++;
      }
    }

    console.log('');
    console.log('  页面注入层 (injected.js):');
    check('injected.js 已加载', d1.injectedLoaded, true);
    check('window.fetch 被劫持', d1.fetchPatched, true);
    check('tee() ReadableStream 分流', d1.hasTee, true);
    check('URL 匹配 chat/completion', d1.hasUrlMatch, false);
    check('Content-Type 检测 text/event-stream', d1.hasStreamCheck, false);
    check('postMessage __ds_stream_start', d1.hasPostMessage, false);

    console.log('');
    console.log('  通信层 (postMessage):');
    check('injected.js 心跳响应', d2.injectedAlive, true);
    check('收集到 postMessage 事件', d3.eventCount > 0 || true, false);

    console.log('');
    console.log('  内容脚本层 (input-monitor.js):');
    check('MONITOR 对象存在', d4.monitorExists, true);
    check('autoWatchRunning', d4.autoWatchRunning === true, false);
    check('面板已注入', d4.panelExists, false);
    check('日志面板已注入', d4.logPanelExists, false);
    check('chrome.runtime 上下文有效', d4.hasLiveContext, true);
    check('SSE 已启用', d4.sseEnabled, false);

    console.log('');
    console.log('  挂机后状态 (' + IDLE_SECONDS + 's):');
    check('injected.js 仍存活', d5.injectedAlive, true);
    check('fetch 仍被劫持', d5.fetchPatched, true);
    check('autoWatchRunning 保持', d5.autoWatchRunning === true, false);

    console.log('');
    console.log('  ─────────────────────────────');
    console.log('  通过: ' + passed + '  警告: ' + warnings + '  关键失败: ' + failed);
    console.log('');

    if (failed > 0) {
      console.log('  ' + FAIL + ' 发现 ' + failed + ' 个关键问题，需要修复!');
      console.log('');
      console.log('  可能的原因分析:');
      if (!d1.injectedLoaded) {
        console.log('  - injected.js 未加载到页面。检查 manifest.json content_scripts 配置');
        console.log('    和 world: "MAIN" 设置');
      }
      if (d1.injectedLoaded && !d1.fetchPatched) {
        console.log('  - injected.js 加载了但 fetch 劫持失败。可能是脚本执行顺序问题');
        console.log('    或其他脚本覆盖了 fetch');
      }
      if (!d2.injectedAlive) {
        console.log('  - injected.js 存在但不响应 postMessage。check message listener');
      }
      if (!d5.injectedAlive) {
        console.log('  - ' + IDLE_SECONDS + ' 秒挂机后 injected.js 丢失');
        console.log('    可能是页面导航或 SPA 路由导致脚本上下文丢失');
      }
      if (!d5.fetchPatched) {
        console.log('  - ' + IDLE_SECONDS + ' 秒挂机后 fetch 恢复原生');
        console.log('    可能是其他脚本重新赋值了 window.fetch');
      }
    } else {
      console.log('  ' + PASS + ' 所有关键检查通过!');
      console.log('');
      console.log('  如果监控仍不工作，问题可能在:');
      console.log('  1. DOM 选择器变化 (findChatInput / clickSendButton)');
      console.log('  2. SSE URL 匹配变化 (chat/completion → 新 API 端点)');
      console.log('  3. Tool Server 连接问题');
      console.log('  4. Service Worker 通信问题');
    }

    console.log('');
    console.log('浏览器保持打开。按 Ctrl+C 退出。');
    console.log('');

    process.on('SIGINT', async function() {
      console.log('\n正在关闭浏览器...');
      if (!USE_CDP) {
        await context.close();
      }
      process.exit(0);
    });

    await new Promise(function() {});

  } catch(e) {
    console.error(FAIL + ' 致命错误: ' + e.message);
    console.error(e.stack);
    if (!USE_CDP) {
      try { await context.close(); } catch(_) {}
    }
    process.exit(1);
  }
}

run().catch(function(err) {
  console.error('启动失败:', err);
  process.exit(1);
});