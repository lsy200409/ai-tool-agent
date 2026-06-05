/**
 * 多平台交互式测试脚本
 *
 * 流程：
 *   1. 通过 CDP 连接到已运行的 Chrome (http://localhost:9222)
 *   2. 对每个平台 (ChatGPT / Kimi / 通义千问 / 智谱ChatGLM / 豆包):
 *      a. 打开平台 URL
 *      b. 等待用户登录 — 轮询平台特有的"已登录"标志元素
 *      c. 注入平台适配器（如果扩展未自动加载）
 *      d. 验证 findChatInput / findSendButton / AI 消息选择器
 *      e. 验证 SSE 拦截器（__ds_sse_interceptor_ready / __ds_isStreamActive）
 *   3. 输出每个平台的详细测试结果
 *   4. 输出最终汇总表格
 *
 * 用法：
 *   1) 先以调试模式启动 Chrome:
 *      chrome.exe --remote-debugging-port=9222 --remote-allow-origins=*
 *   2) 手动打开平台页面并完成登录（或者让脚本打开）
 *   3) node tests/multi-platform-interactive.js
 *      或附加命令行参数指定单个平台: node tests/multi-platform-interactive.js chatgpt
 */

var { chromium } = require('playwright-core');
var fs = require('fs');
var path = require('path');

// ──────────────────────────────────────────────
// 配置
// ──────────────────────────────────────────────
var CDP_URL = 'http://localhost:9222';
var PROJECT_ROOT = path.resolve(__dirname, '..');
var LOGIN_POLL_INTERVAL_MS = 1000;     // 登录检测轮询间隔
var LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 单个平台登录等待超时 (5分钟)
var PAGE_INIT_WAIT_MS = 3000;          // 页面初步加载等待
var POST_INJECT_WAIT_MS = 1500;        // 注入后等待

// 平台定义 — 每个平台包含 URL、显示名、登录标志选择器、AI 消息标志
var PLATFORMS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    loginSelectors: [
      '#prompt-textarea',
      '[data-testid="conversation-turn-0"]',
      'textarea[placeholder="Ask anything"]',
      'textarea[placeholder*="Ask"]'
    ]
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.com',
    loginSelectors: [
      'div[class*="chat-input"]',
      'textarea[placeholder*="Kimi"]',
      'textarea[placeholder*="输入"]',
      'div[class*="editor-container"]'
    ]
  },
  {
    id: 'qwen',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen',
    loginSelectors: [
      'textarea[placeholder*="通义"]',
      'textarea[placeholder*="千问"]',
      'textarea[placeholder*="输入"]',
      'div[class*="input-editor"]'
    ]
  },
  {
    id: 'chatglm',
    name: '智谱ChatGLM',
    url: 'https://chatglm.cn',
    loginSelectors: [
      'textarea[placeholder*="ChatGLM"]',
      'textarea[placeholder*="智谱"]',
      'textarea[placeholder*="输入"]',
      'div[class*="chat-input"]'
    ]
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com',
    loginSelectors: [
      'textarea[placeholder*="豆包"]',
      'div[class*="input"]',
      'textarea[placeholder*="输入"]',
      'div[class*="chat-input"]'
    ]
  }
];

// 需要注入到 MAIN world 的源文件
var MAIN_WORLD_FILES = [
  'src/platforms/platform-registry.js',
  'src/platforms/deepseek.js',
  'src/platforms/chatgpt.js',
  'src/platforms/kimi.js',
  'src/platforms/qwen.js',
  'src/platforms/chatglm.js',
  'src/platforms/doubao.js',
  'src/dom/input.js',
  'src/dom/ai-message.js',
  'src/sse-interceptor.js'
];

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }
function ok(cond) { return cond ? '✅' : '❌'; }
function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function readSourceFile(relPath) {
  var fullPath = path.join(PROJECT_ROOT, relPath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    console.log(ts() + '   ⚠️  无法读取 ' + relPath + ': ' + e.message);
    return null;
  }
}

function detectLoginRedirect(url) {
  if (!url) return false;
  return /\/login|\/auth|\/signin|\/sign_in|\/oauth|\/sso|\/passport|auth\.aliyun|accounts\.google|chatglm\.cn\/login|doubao\.com\/login|kimi\.com\/login|chatgpt\.com\/auth/i.test(url);
}

// 描述一个 DOM 元素的简短签名（用于输出）
function describeElement(el) {
  if (!el) return null;
  try {
    var tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    var id = el.id ? ('#' + el.id) : '';
    var cls = (typeof el.className === 'string' && el.className)
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    var placeholder = el.getAttribute ? (el.getAttribute('placeholder') || '') : '';
    var ariaLabel = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
    var dataTestid = el.getAttribute ? (el.getAttribute('data-testid') || '') : '';

    var sig = '<' + tag + id + cls + '>';
    var extra = [];
    if (placeholder) extra.push('placeholder="' + placeholder + '"');
    if (ariaLabel) extra.push('aria-label="' + ariaLabel + '"');
    if (dataTestid) extra.push('data-testid="' + dataTestid + '"');
    if (extra.length > 0) sig += ' ' + extra.join(' ');
    return sig;
  } catch (e) {
    return '<element>';
  }
}

// ──────────────────────────────────────────────
// CDP 辅助
// ──────────────────────────────────────────────
var _cdpSession = null;
var _contextMap = {};

async function getCdpSession(page) {
  if (!_cdpSession) {
    _cdpSession = await page.context().newCDPSession(page);
    await _cdpSession.send('Runtime.enable');
    _cdpSession.on('Runtime.executionContextCreated', function(params) {
      var ctx = params.context;
      _contextMap[ctx.id] = {
        id: ctx.id,
        origin: ctx.origin || '',
        auxData: ctx.auxData || {}
      };
    });
    _cdpSession.on('Runtime.executionContextDestroyed', function(params) {
      delete _contextMap[params.executionContextId];
    });
  }
  return _cdpSession;
}

async function resetCdpSession() {
  _contextMap = {};
  if (_cdpSession) {
    try { await _cdpSession.detach(); } catch (e) {}
    _cdpSession = null;
  }
}

// ──────────────────────────────────────────────
// 适配器注入
// ──────────────────────────────────────────────
async function injectAdaptersToMainWorld(page) {
  var injected = [];
  for (var i = 0; i < MAIN_WORLD_FILES.length; i++) {
    var source = readSourceFile(MAIN_WORLD_FILES[i]);
    if (!source) continue;
    try {
      await page.evaluate(source);
      injected.push(MAIN_WORLD_FILES[i]);
    } catch (e) {
      console.log(ts() + '   ⚠️  注入 ' + MAIN_WORLD_FILES[i] + ' 失败: ' + e.message.split('\n')[0]);
    }
  }
  return injected;
}

// ──────────────────────────────────────────────
// 单平台测试
// ──────────────────────────────────────────────
async function testPlatform(platform) {
  console.log('\n=== ' + platform.name + ' 测试 ===');

  // 使用新的 page 来隔离
  var browser = await chromium.connectOverCDP(CDP_URL).catch(function() { return null; });
  if (!browser) {
    console.log('  ❌ CDP 连接不可用');
    return null;
  }
  var context = browser.contexts()[0];
  var page = await context.newPage();

  // 重置 CDP 上下文映射
  await resetCdpSession();

  // 拦截 console
  var pageConsole = [];
  page.on('console', function(msg) {
    var txt = msg.text();
    if (txt.indexOf('%c') >= 0) return;
    if (pageConsole.length < 20) pageConsole.push(txt);
  });

  var result = {
    id: platform.id,
    name: platform.name,
    url: platform.url,
    loggedIn: false,
    detectedSelector: '',
    registryLoaded: false,
    currentPlatform: '',
    inputFound: false,
    inputInfo: null,
    sendButtonFound: false,
    sendButtonInfo: null,
    aiMessageMatched: false,
    aiMessageInfo: null,
    sseReady: false,
    sseActiveFnExists: false,
    sseRequestCount: 0
  };

  // ── Step 0: 导航到平台 URL ──
  try {
    console.log('  [导航] 打开 ' + platform.url);
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(PAGE_INIT_WAIT_MS);
  } catch (e) {
    console.log('  ❌ 导航失败: ' + e.message.split('\n')[0]);
    await page.close().catch(function() {});
    result.error = '导航失败: ' + e.message.split('\n')[0];
    return result;
  }

  // 如果当前已经在登录页
  if (detectLoginRedirect(page.url())) {
    console.log('  ℹ️  当前在登录页: ' + page.url());
  }

  // ── Step 1: 等待用户登录 ──
  console.log('[1/4] 等待登录...');
  var loginDetected = false;
  var detectedSelector = '';
  var deadline = Date.now() + LOGIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      var found = await page.evaluate(function(selectors) {
        for (var i = 0; i < selectors.length; i++) {
          var sel = selectors[i];
          try {
            var els = document.querySelectorAll(sel);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              var rect = el.getBoundingClientRect();
              // 必须可见（clientHeight > 0 且在视口附近）
              if (el.clientHeight > 0 && rect.width > 0 && rect.height > 0) {
                return sel;
              }
            }
          } catch (e) {}
        }
        return null;
      }, platform.loginSelectors);

      if (found) {
        loginDetected = true;
        detectedSelector = found;
        break;
      }
    } catch (e) {}

    // 等待一段时间后重试
    var remaining = Math.ceil((deadline - Date.now()) / 1000);
    process.stdout.write('\r  ⏳ 已等待 ' + (Math.floor((LOGIN_TIMEOUT_MS - (deadline - Date.now())) / 1000)) + 's / ' +
                         Math.ceil(LOGIN_TIMEOUT_MS / 1000) + 's  (剩余 ' + remaining + 's)...');
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }
  // 清除进度行
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  if (!loginDetected) {
    console.log('  ❌ 登录超时 (' + Math.ceil(LOGIN_TIMEOUT_MS / 1000) + 's)，未检测到登录标志');
    console.log('  ℹ️  请手动在浏览器中完成登录后重试');
    await page.close().catch(function() {});
    result.error = '登录超时';
    return result;
  }

  result.loggedIn = true;
  result.detectedSelector = detectedSelector;
  console.log('  ' + ok(true) + ' 已检测到登录标志: ' + detectedSelector);

  // ── Step 2: 注入平台适配器 ──
  console.log('[2/4] 注入平台适配器...');

  // 检查是否已由扩展自动加载
  var prAutoLoaded = false;
  try {
    prAutoLoaded = await page.evaluate('typeof window.PlatformRegistry !== "undefined"');
  } catch (e) {}

  if (!prAutoLoaded) {
    var injected = await injectAdaptersToMainWorld(page);
    console.log('  ' + ok(injected.length > 0) + ' 已注入 ' + injected.length + ' 个文件');
  } else {
    console.log('  ' + ok(true) + ' PlatformRegistry 已由扩展自动加载');
  }
  await page.waitForTimeout(POST_INJECT_WAIT_MS);

  // 验证 PlatformRegistry
  var prInfo = await page.evaluate(function() {
    if (typeof PlatformRegistry === 'undefined') return null;
    var current = PlatformRegistry.getCurrent ? PlatformRegistry.getCurrent() : null;
    return {
      exists: true,
      currentId: current ? current.id : null,
      currentName: current ? current.name : null,
      adapterCount: Object.keys(PlatformRegistry.getAll ? PlatformRegistry.getAll() : {}).length
    };
  }).catch(function() { return null; });

  if (prInfo) {
    result.registryLoaded = true;
    result.currentPlatform = prInfo.currentId || '';
    console.log('  ' + ok(true) + ' PlatformRegistry 已加载');
    console.log('  ' + ok(prInfo.currentId === platform.id) +
                ' 当前平台: ' + (prInfo.currentName || prInfo.currentId || '(未检测)'));
  } else {
    console.log('  ❌ PlatformRegistry 加载失败');
  }

  // ── Step 3: 验证选择器 ──
  console.log('[3/4] 验证选择器...');

  // 3a. 输入框
  var inputResult = await page.evaluate(function() {
    if (typeof findChatInput !== 'function') {
      // 退化方案：通过 PlatformRegistry 的 chatInputSelectors
      if (typeof PlatformRegistry !== 'undefined') {
        var platform = PlatformRegistry.getCurrent();
        if (platform && platform.dom && platform.dom.chatInputSelectors) {
          for (var i = 0; i < platform.dom.chatInputSelectors.length; i++) {
            var els = document.querySelectorAll(platform.dom.chatInputSelectors[i]);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              var rect = el.getBoundingClientRect();
              if (el.clientHeight > 0 && rect.width > 0) return el.outerHTML.substring(0, 200);
            }
          }
        }
      }
      return null;
    }
    var el = findChatInput();
    if (!el) return null;
    return el.outerHTML.substring(0, 200);
  }).catch(function() { return null; });

  if (inputResult) {
    result.inputFound = true;
    result.inputInfo = inputResult;
    console.log('  ' + ok(true) + ' 输入框: ' + inputResult.substring(0, 120));
  } else {
    console.log('  ❌ 输入框: 未找到');
  }

  // 3b. 发送按钮
  var sendBtnResult = await page.evaluate(function() {
    var btn = null;
    if (typeof findSendButton === 'function') {
      btn = findSendButton();
    } else if (typeof PlatformRegistry !== 'undefined') {
      var platform = PlatformRegistry.getCurrent();
      if (platform && platform.dom && platform.dom.findSendButton) {
        btn = platform.dom.findSendButton();
      }
    }
    if (!btn) return null;
    return {
      html: btn.outerHTML.substring(0, 200),
      ariaLabel: btn.getAttribute ? (btn.getAttribute('aria-label') || '') : '',
      disabled: btn.disabled || false
    };
  }).catch(function() { return null; });

  if (sendBtnResult) {
    result.sendButtonFound = true;
    result.sendButtonInfo = sendBtnResult;
    var info = sendBtnResult;
    var line = info.html.substring(0, 120);
    if (info.ariaLabel) line += ' [aria-label="' + info.ariaLabel + '"]';
    console.log('  ' + ok(true) + ' 发送按钮: ' + line);
  } else {
    console.log('  ❌ 发送按钮: 未找到');
  }

  // 3c. AI 消息选择器
  var aiResult = await page.evaluate(function() {
    if (typeof PlatformRegistry === 'undefined') return null;
    var platform = PlatformRegistry.getCurrent();
    if (!platform || !platform.dom || !platform.dom.aiMessageSelectors) return null;
    var matches = [];
    for (var i = 0; i < platform.dom.aiMessageSelectors.length; i++) {
      var sel = platform.dom.aiMessageSelectors[i];
      var els = document.querySelectorAll(sel);
      if (els.length > 0) {
        for (var j = 0; j < Math.min(els.length, 3); j++) {
          matches.push({
            selector: sel,
            tag: els[j].tagName ? els[j].tagName.toLowerCase() : '',
            cls: (typeof els[j].className === 'string' ? els[j].className : '').substring(0, 60),
            textLen: (els[j].innerText || els[j].textContent || '').length
          });
        }
      }
    }
    return matches;
  }).catch(function() { return null; });

  if (aiResult && aiResult.length > 0) {
    result.aiMessageMatched = true;
    result.aiMessageInfo = aiResult;
    var sample = aiResult[0];
    console.log('  ' + ok(true) + ' AI 消息: ' + sample.selector + ' (' + aiResult.length + ' 个匹配)');
  } else {
    console.log('  ❌ AI 消息选择器: 未匹配');
  }

  // ── Step 4: SSE 拦截器 ──
  console.log('[4/4] SSE 拦截器...');
  var sseResult = await page.evaluate(function() {
    return {
      ready: !!window.__ds_sse_interceptor_ready,
      hasIsActive: typeof window.__ds_isStreamActive === 'function',
      isActive: typeof window.__ds_isStreamActive === 'function' ? window.__ds_isStreamActive() : null,
      hasStreamState: typeof window.__ds_streamState === 'function',
      debug: window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : null
    };
  }).catch(function() { return null; });

  if (sseResult) {
    result.sseReady = sseResult.ready;
    result.sseActiveFnExists = sseResult.hasIsActive;
    if (sseResult.debug) {
      result.sseRequestCount = sseResult.debug.wrapperCalledMatchingUrl || 0;
    }
    console.log('  ' + ok(sseResult.ready) + ' 拦截器已安装: ' + sseResult.ready);
    console.log('  ' + ok(sseResult.hasIsActive) +
                ' window.__ds_isStreamActive() 可调用: ' + sseResult.hasIsActive);
    if (sseResult.debug) {
      console.log('     · 匹配 API 请求数: ' + (sseResult.debug.wrapperCalledMatchingUrl || 0));
      console.log('     · XHR 匹配数: ' + (sseResult.debug.xhrMatchingUrl || 0));
    }
  } else {
    console.log('  ❌ SSE 拦截器: 检查失败');
  }

  // 不关闭页面 — 用户可能要继续浏览
  // await page.close().catch(function() {});
  result._page = page;

  return result;
}

// ──────────────────────────────────────────────
// 输出汇总
// ──────────────────────────────────────────────
function printSummary(results) {
  console.log('\n\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  多平台测试汇总');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();

  var header = pad('平台', 14) + ' | ' +
               pad('登录', 4) + ' | ' +
               pad('平台检测', 10) + ' | ' +
               pad('输入框', 6) + ' | ' +
               pad('发送按钮', 8) + ' | ' +
               pad('AI消息', 6) + ' | ' +
               pad('SSE', 4) + ' | ' +
               'API 拦截数';
  console.log(header);
  console.log('-'.repeat(header.length));

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var line = pad(r.name, 14) + ' | ' +
               pad(r.loggedIn ? '✅' : '❌', 4) + ' | ' +
               pad(r.currentPlatform || '-', 10) + ' | ' +
               pad(r.inputFound ? '✅' : '❌', 6) + ' | ' +
               pad(r.sendButtonFound ? '✅' : '❌', 8) + ' | ' +
               pad(r.aiMessageMatched ? '✅' : '❌', 6) + ' | ' +
               pad(r.sseReady ? '✅' : '❌', 4) + ' | ' +
               String(r.sseRequestCount);
    console.log(line);
  }
  console.log('-'.repeat(header.length));
  console.log();

  // 统计
  var stats = { total: results.length, loggedIn: 0, input: 0, send: 0, ai: 0, sse: 0, allOk: 0 };
  for (var j = 0; j < results.length; j++) {
    var r2 = results[j];
    if (r2.loggedIn) stats.loggedIn++;
    if (r2.inputFound) stats.input++;
    if (r2.sendButtonFound) stats.send++;
    if (r2.aiMessageMatched) stats.ai++;
    if (r2.sseReady) stats.sse++;
    if (r2.loggedIn && r2.inputFound && r2.sendButtonFound && r2.aiMessageMatched && r2.sseReady) {
      stats.allOk++;
    }
  }
  console.log('  平台总数:    ' + stats.total);
  console.log('  已登录:      ' + stats.loggedIn + '/' + stats.total);
  console.log('  输入框:      ' + stats.input + '/' + stats.total);
  console.log('  发送按钮:    ' + stats.send + '/' + stats.total);
  console.log('  AI 消息:     ' + stats.ai + '/' + stats.total);
  console.log('  SSE 拦截器:  ' + stats.sse + '/' + stats.total);
  console.log('  全部通过:    ' + stats.allOk + '/' + stats.total);
  console.log();

  // 备注
  console.log('  说明:');
  console.log('  - 登录检测: 平台特有的"已登录"标志元素是否出现');
  console.log('  - 平台检测: PlatformRegistry.getCurrent() 返回的当前平台 id');
  console.log('  - 输入框/发送按钮/AI消息: 平台适配器中的选择器是否匹配到实际元素');
  console.log('  - SSE 拦截器: window.__ds_sse_interceptor_ready 是否为 true');
  console.log('  - API 拦截数: 拦截器匹配到的真实 API 请求数 (>0 说明拦截了真实请求)');
  console.log();
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   多平台交互式测试 — ChatGPT / Kimi / 千问 / 智谱 / 豆包   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('  CDP URL: ' + CDP_URL);
  console.log('  登录等待超时: ' + Math.ceil(LOGIN_TIMEOUT_MS / 1000) + 's / 平台');
  console.log();

  // Step 1: CDP 连接
  console.log(ts() + ' 正在连接 Chrome (CDP)...');
  var browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    var ctx = browser.contexts()[0];
    if (!ctx) throw new Error('没有浏览器上下文');
    console.log(ts() + ' ✅ CDP 连接成功，上下文数: ' + browser.contexts().length);
  } catch (e) {
    console.log(ts() + ' ❌ CDP 连接失败: ' + e.message);
    console.log('  请确保 Chrome 以调试模式启动:');
    console.log('    chrome.exe --remote-debugging-port=9222 --remote-allow-origins=*');
    process.exit(1);
  }

  // 决定要测试的平台
  var cliArg = process.argv[2];
  var platformsToTest = PLATFORMS;
  if (cliArg) {
    platformsToTest = PLATFORMS.filter(function(p) {
      return p.id === cliArg || p.name === cliArg;
    });
    if (platformsToTest.length === 0) {
      console.log('  ⚠️  未找到匹配平台: ' + cliArg);
      console.log('  可用: ' + PLATFORMS.map(function(p) { return p.id; }).join(', '));
      process.exit(1);
    }
  }

  // Step 2: 逐个测试平台
  var allResults = [];
  for (var i = 0; i < platformsToTest.length; i++) {
    var platform = platformsToTest[i];
    try {
      var result = await testPlatform(platform);
      if (result) allResults.push(result);
    } catch (e) {
      console.log('  ❌ 测试异常: ' + e.message);
    }
  }

  // Step 3: 汇总
  printSummary(allResults);

  console.log('  浏览器保持打开，可继续手动测试。');
  console.log('  关闭 Ctrl+C 退出。');

  // 不要关闭浏览器
  // await browser.close();
}

main().catch(function(e) {
  console.error('异常: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
