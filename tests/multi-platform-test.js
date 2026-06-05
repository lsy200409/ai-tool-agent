/**
 * 多平台适配器测试脚本
 *
 * 通过 CDP 连接 Chrome，测试 ChatGPT、Kimi、通义千问、智谱ChatGLM、豆包 5 个平台的适配器功能。
 *
 * 测试项：
 *   - PlatformRegistry 加载与平台检测
 *   - 面板注入 (#__ds-agent-panel)
 *   - 平台徽章显示
 *   - SSE 拦截器安装
 *   - Monitor 加载
 *   - 输入框查找 (findChatInput)
 *   - 发送按钮查找 (findSendButton)
 *   - AI 消息选择器匹配
 */

var { chromium } = require('playwright-core');
var fs = require('fs');
var path = require('path');

// ──────────────────────────────────────────────
// 配置
// ──────────────────────────────────────────────
var CDP_URL = 'http://localhost:9222';
var PAGE_LOAD_TIMEOUT = 15000;
var INTER_PLATFORM_DELAY = 2000;
var PROJECT_ROOT = path.resolve(__dirname, '..');

var PLATFORMS = [
  { id: 'chatgpt', name: 'ChatGPT',     url: 'https://chatgpt.com' },
  { id: 'kimi',    name: 'Kimi',         url: 'https://kimi.com' },
  { id: 'qwen',    name: '通义千问',      url: 'https://tongyi.aliyun.com/qianwen' },
  { id: 'chatglm', name: '智谱ChatGLM',  url: 'https://chatglm.cn' },
  { id: 'doubao',  name: '豆包',          url: 'https://www.doubao.com' }
];

// 需要注入的源文件列表（MAIN world）
var MAIN_WORLD_FILES = [
  'src/platforms/platform-registry.js',
  'src/platforms/deepseek.js',
  'src/platforms/chatgpt.js',
  'src/platforms/kimi.js',
  'src/platforms/qwen.js',
  'src/platforms/chatglm.js',
  'src/platforms/doubao.js',
  'src/sse-interceptor.js'
];

// 需要注入的源文件列表（ISOLATED world / MAIN world 共用）
var ISOLATED_WORLD_FILES = [
  'src/platforms/platform-registry.js',
  'src/platforms/deepseek.js',
  'src/platforms/chatgpt.js',
  'src/platforms/kimi.js',
  'src/platforms/qwen.js',
  'src/platforms/chatglm.js',
  'src/platforms/doubao.js',
  'src/dom/input.js',
  'src/dom/ai-message.js'
];

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

function icon(passed) { return passed ? '✅' : '❌'; }

// 读取源文件
function readSourceFile(relPath) {
  var fullPath = path.join(PROJECT_ROOT, relPath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    console.log(ts() + '   ⚠️ 无法读取 ' + relPath + ': ' + e.message);
    return null;
  }
}

// 检测是否跳转到了登录页面
function detectLoginRedirect(url) {
  var loginPatterns = [
    /\/login/i, /\/auth/i, /\/signin/i, /\/sign_in/i,
    /\/oauth/i, /\/sso/i, /\/passport/i,
    /auth\.aliyun/i, /login\.aliyun/i,
    /accounts\.google/i,
    /chatglm\.cn\/login/i,
    /doubao\.com\/login/i,
    /kimi\.com\/login/i,
    /chatgpt\.com\/auth/i
  ];
  for (var i = 0; i < loginPatterns.length; i++) {
    if (loginPatterns[i].test(url)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────
// CDP 辅助：在 ISOLATED world 中执行代码
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
        name: ctx.name || '',
        auxData: ctx.auxData || {}
      };
    });
    _cdpSession.on('Runtime.executionContextDestroyed', function(params) {
      delete _contextMap[params.executionContextId];
    });
  }
  return _cdpSession;
}

async function resetCdpSession(page) {
  _contextMap = {};
  if (_cdpSession) {
    try {
      await _cdpSession.detach();
    } catch (e) {}
    _cdpSession = null;
  }
}

async function cdpEval(page, expr, contextId) {
  var cdp = await getCdpSession(page);
  var params = { expression: expr, returnByValue: true, awaitPromise: false };
  if (contextId) params.contextId = contextId;
  try {
    var result = await cdp.send('Runtime.evaluate', params);
    if (result.exceptionDetails) {
      var desc = result.exceptionDetails.exception &&
        result.exceptionDetails.exception.description;
      return { __error: desc || result.exceptionDetails.text || 'Unknown' };
    }
    return result.result && result.result.value;
  } catch (e) {
    return { __error: e.message };
  }
}

// 查找 ISOLATED world 的执行上下文 ID
async function findIsolatedWorldContextId(page) {
  var ctxIds = Object.keys(_contextMap);
  for (var i = 0; i < ctxIds.length; i++) {
    var ctx = _contextMap[ctxIds[i]];
    // ISOLATED world: isDefault=false, origin 是 chrome-extension://
    if (ctx.auxData && ctx.auxData.isDefault === false &&
        ctx.origin && ctx.origin.indexOf('chrome-extension://') >= 0) {
      return parseInt(ctxIds[i]);
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// 手动注入适配器代码到 MAIN world
// ──────────────────────────────────────────────
async function injectAdaptersToMainWorld(page) {
  var injected = [];
  for (var i = 0; i < MAIN_WORLD_FILES.length; i++) {
    var source = readSourceFile(MAIN_WORLD_FILES[i]);
    if (source) {
      try {
        await page.evaluate(source);
        injected.push(MAIN_WORLD_FILES[i].replace('src/platforms/', '').replace('src/', '').replace('.js', ''));
      } catch (e) {
        console.log(ts() + '   注入 ' + MAIN_WORLD_FILES[i] + ' 失败: ' + e.message);
      }
    }
  }
  return injected;
}

// 手动注入适配器代码到 ISOLATED world
async function injectAdaptersToIsolatedWorld(page) {
  var isolatedCtxId = await findIsolatedWorldContextId(page);
  if (!isolatedCtxId) return [];

  var injected = [];
  for (var i = 0; i < ISOLATED_WORLD_FILES.length; i++) {
    var source = readSourceFile(ISOLATED_WORLD_FILES[i]);
    if (source) {
      try {
        var result = await cdpEval(page, source, isolatedCtxId);
        if (result && result.__error) {
          console.log(ts() + '   ISOLATED 注入 ' + ISOLATED_WORLD_FILES[i] + ' 失败: ' + result.__error);
        } else {
          injected.push(ISOLATED_WORLD_FILES[i].replace('src/platforms/', '').replace('src/', '').replace('.js', ''));
        }
      } catch (e) {
        console.log(ts() + '   ISOLATED 注入 ' + ISOLATED_WORLD_FILES[i] + ' 异常: ' + e.message);
      }
    }
  }
  return injected;
}

// ──────────────────────────────────────────────
// 单平台测试
// ──────────────────────────────────────────────
async function testPlatform(page, platform) {
  var result = {
    id: platform.id,
    name: platform.name,
    url: platform.url,
    detected: false,
    panel: false,
    badge: false,
    badgeText: '',
    sse: false,
    monitor: false,
    input: false,
    sendButton: false,
    aiMessage: false,
    status: '正常',
    details: []
  };

  console.log('\n' + ts() + ' ── 测试平台: ' + platform.name + ' (' + platform.url + ') ──');

  // a. 导航到平台 URL
  try {
    console.log(ts() + '   导航到 ' + platform.url + '...');
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    console.log(ts() + '   页面 URL: ' + page.url());
  } catch (e) {
    result.status = '无法访问';
    result.details.push('导航失败: ' + e.message.split('\n')[0]);
    console.log(ts() + '   ❌ 导航失败: ' + e.message.split('\n')[0]);
    return result;
  }

  // 检查是否跳转到登录页
  var currentUrl = page.url();
  if (detectLoginRedirect(currentUrl)) {
    result.status = '需要登录';
    result.details.push('页面跳转到登录页: ' + currentUrl);
    console.log(ts() + '   ⚠️ 页面跳转到登录页: ' + currentUrl);
  }

  // b. 等待页面加载和扩展 content scripts 初始化
  try {
    await page.waitForTimeout(5000);
  } catch (e) {}

  // 重置 CDP 上下文映射（导航后上下文会变）
  await resetCdpSession(page);
  await getCdpSession(page);
  // 等待上下文创建
  await page.waitForTimeout(2000);

  // c. 检查 PlatformRegistry 是否已由扩展自动加载
  var prAutoLoaded = false;
  try {
    var prType = await page.evaluate('typeof window.PlatformRegistry');
    prAutoLoaded = (prType !== 'undefined');
    console.log(ts() + '   扩展自动加载 PlatformRegistry: ' + prAutoLoaded);
  } catch (e) {}

  // 如果扩展未自动加载，手动注入适配器代码
  if (!prAutoLoaded) {
    console.log(ts() + '   扩展未自动加载，手动注入适配器代码...');
    var mainInjected = await injectAdaptersToMainWorld(page);
    console.log(ts() + '   MAIN world 注入: ' + mainInjected.join(', '));

    // 也尝试注入到 ISOLATED world
    var isolatedInjected = await injectAdaptersToIsolatedWorld(page);
    if (isolatedInjected.length > 0) {
      console.log(ts() + '   ISOLATED world 注入: ' + isolatedInjected.join(', '));
    }
  }

  // 等待注入完成
  await page.waitForTimeout(1000);

  // c. 检查 PlatformRegistry 是否加载（MAIN world）
  try {
    var prCheck = await page.evaluate(function() {
      if (typeof window.PlatformRegistry === 'undefined') return { exists: false };
      var pr = window.PlatformRegistry;
      var adapters = pr.getAll ? pr.getAll() : {};
      var current = pr.getCurrent ? pr.getCurrent() : null;
      return {
        exists: true,
        adapterCount: Object.keys(adapters).length,
        adapterIds: Object.keys(adapters),
        currentId: current ? current.id : null,
        currentName: current ? current.name : null
      };
    });
    console.log(ts() + '   PlatformRegistry: exists=' + prCheck.exists +
      ', adapters=' + (prCheck.adapterIds || []).join(',') +
      ', current=' + (prCheck.currentId || 'null'));

    if (prCheck.exists) {
      // d. 检查当前平台是否被正确检测
      result.detected = (prCheck.currentId === platform.id);
      if (!result.detected) {
        result.details.push('检测到平台: ' + (prCheck.currentId || 'null') + ', 期望: ' + platform.id);
      }
    }
  } catch (e) {
    result.details.push('PlatformRegistry 检查失败: ' + e.message);
    console.log(ts() + '   ❌ PlatformRegistry 检查失败: ' + e.message);
  }

  // e. 检查面板是否注入
  try {
    var panelExists = await page.evaluate(function() {
      return !!document.getElementById('__ds-agent-panel');
    });
    result.panel = panelExists;
    console.log(ts() + '   面板注入: ' + icon(panelExists));
  } catch (e) {
    result.details.push('面板检查失败: ' + e.message);
  }

  // f. 检查平台徽章
  try {
    var badgeInfo = await page.evaluate(function() {
      var badge = document.getElementById('__ds-platform-badge');
      if (!badge) return { exists: false, text: '' };
      return { exists: true, text: (badge.textContent || '').trim() };
    });
    result.badge = badgeInfo.exists;
    result.badgeText = badgeInfo.text;
    // 检查徽章是否显示正确的平台名称
    if (badgeInfo.exists && badgeInfo.text === platform.name) {
      result.badge = true;
    }
    console.log(ts() + '   平台徽章: ' + icon(badgeInfo.exists) +
      (badgeInfo.exists ? ' text="' + badgeInfo.text + '"' : ' (未找到)'));
  } catch (e) {
    result.details.push('徽章检查失败: ' + e.message);
  }

  // g. 检查 SSE 拦截器是否安装（MAIN world）
  try {
    var sseReady = await page.evaluate(function() {
      return !!window.__ds_sse_interceptor_ready;
    });
    result.sse = sseReady;
    console.log(ts() + '   SSE 拦截器: ' + icon(sseReady));
  } catch (e) {
    result.details.push('SSE 检查失败: ' + e.message);
  }

  // h. 检查 Monitor 是否加载（ISOLATED world）
  try {
    var isolatedCtxId = await findIsolatedWorldContextId(page);
    if (isolatedCtxId) {
      var monCheck = await cdpEval(page,
        'typeof MONITOR !== "undefined" ? ' +
        '{ exists: true, state: MONITOR.state } : ' +
        '{ exists: false }',
        isolatedCtxId
      );
      if (monCheck && !monCheck.__error) {
        result.monitor = !!monCheck.exists;
        console.log(ts() + '   Monitor (ISOLATED): ' + icon(result.monitor) +
          (monCheck.state ? ' state=' + monCheck.state : ''));
      } else {
        // 也尝试通过 MAIN world 的 __ds_monitorState 检查
        var monState = await page.evaluate(function() {
          return window.__ds_monitorState || null;
        });
        result.monitor = !!(monState && monState.state && monState.state !== 'unknown');
        console.log(ts() + '   Monitor (MAIN bridge): ' + icon(result.monitor));
      }
    } else {
      // 没有 ISOLATED world，通过 MAIN world bridge 检查
      var monState2 = await page.evaluate(function() {
        return window.__ds_monitorState || null;
      });
      result.monitor = !!(monState2 && monState2.state && monState2.state !== 'unknown');
      console.log(ts() + '   Monitor (MAIN bridge, no ISOLATED ctx): ' + icon(result.monitor));
    }
  } catch (e) {
    result.details.push('Monitor 检查失败: ' + e.message);
    console.log(ts() + '   ❌ Monitor 检查失败: ' + e.message);
  }

  // i. 检查输入框是否能找到（MAIN world 中调用 findChatInput）
  try {
    var inputFound = await page.evaluate(function() {
      if (typeof findChatInput === 'function') {
        var el = findChatInput();
        return !!el;
      }
      // fallback: 直接用选择器查找
      if (typeof PlatformRegistry !== 'undefined') {
        var platform = PlatformRegistry.getCurrent();
        if (platform && platform.dom && platform.dom.chatInputSelectors) {
          var selectors = platform.dom.chatInputSelectors;
          for (var i = 0; i < selectors.length; i++) {
            var els = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < els.length; j++) {
              var el = els[j];
              var style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0) {
                return true;
              }
            }
          }
        }
      }
      return false;
    });
    result.input = inputFound;
    console.log(ts() + '   输入框: ' + icon(inputFound));
  } catch (e) {
    result.details.push('输入框检查失败: ' + e.message);
    console.log(ts() + '   ❌ 输入框检查失败: ' + e.message);
  }

  // j. 检查发送按钮是否能找到（MAIN world 中调用 findSendButton）
  try {
    var sendBtnFound = await page.evaluate(function() {
      if (typeof findSendButton === 'function') {
        var btn = findSendButton();
        return !!btn;
      }
      // fallback: 直接用平台适配器的 findSendButton
      if (typeof PlatformRegistry !== 'undefined') {
        var platform = PlatformRegistry.getCurrent();
        if (platform && platform.dom && platform.dom.findSendButton) {
          var btn = platform.dom.findSendButton();
          return !!btn;
        }
      }
      return false;
    });
    result.sendButton = sendBtnFound;
    console.log(ts() + '   发送按钮: ' + icon(sendBtnFound));
  } catch (e) {
    result.details.push('发送按钮检查失败: ' + e.message);
    console.log(ts() + '   ❌ 发送按钮检查失败: ' + e.message);
  }

  // k. 检查 AI 消息选择器是否能匹配到页面元素
  try {
    var aiMsgMatch = await page.evaluate(function() {
      if (typeof PlatformRegistry === 'undefined') return false;
      var platform = PlatformRegistry.getCurrent();
      if (!platform || !platform.dom || !platform.dom.aiMessageSelectors) return false;
      var selectors = platform.dom.aiMessageSelectors;
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        if (els.length > 0) return true;
      }
      return false;
    });
    result.aiMessage = aiMsgMatch;
    console.log(ts() + '   AI 消息选择器: ' + icon(aiMsgMatch));
  } catch (e) {
    result.details.push('AI消息选择器检查失败: ' + e.message);
    console.log(ts() + '   ❌ AI消息选择器检查失败: ' + e.message);
  }

  // 如果需要登录，覆盖状态
  if (result.status === '需要登录') {
    console.log(ts() + '   ⚠️ 状态: 需要登录');
  }

  return result;
}

// ──────────────────────────────────────────────
// 输出汇总表格
// ──────────────────────────────────────────────
function printSummaryTable(results) {
  console.log('\n');
  console.log('=== 多平台适配器测试结果 ===');
  console.log();

  // 表头
  var header = padRight('平台', 14) + '| ' +
               padCenter('检测', 4) + ' | ' +
               padCenter('面板', 4) + ' | ' +
               padCenter('SSE', 3) + ' | ' +
               padCenter('Monitor', 7) + ' | ' +
               padCenter('输入框', 4) + ' | ' +
               padCenter('发送按钮', 6) + ' | ' +
               padCenter('AI消息', 4) + ' | ' +
               '状态';
  console.log(header);

  var separator = repeatStr('-', 14) + '-+-' +
                  repeatStr('-', 4) + '-+-' +
                  repeatStr('-', 4) + '-+-' +
                  repeatStr('-', 3) + '-+-' +
                  repeatStr('-', 7) + '-+-' +
                  repeatStr('-', 4) + '-+-' +
                  repeatStr('-', 6) + '-+-' +
                  repeatStr('-', 4) + '-+-' +
                  repeatStr('-', 8);
  console.log(separator);

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var line = padRight(r.name, 14) + '| ' +
               padCenter(icon(r.detected), 4) + ' | ' +
               padCenter(icon(r.panel), 4) + ' | ' +
               padCenter(icon(r.sse), 3) + ' | ' +
               padCenter(icon(r.monitor), 7) + ' | ' +
               padCenter(icon(r.input), 4) + ' | ' +
               padCenter(icon(r.sendButton), 6) + ' | ' +
               padCenter(icon(r.aiMessage), 4) + ' | ' +
               r.status;
    console.log(line);
  }

  console.log(separator);

  // 统计
  var totalChecks = 0;
  var passedChecks = 0;
  for (var j = 0; j < results.length; j++) {
    var r2 = results[j];
    var checks = [r2.detected, r2.panel, r2.sse, r2.monitor, r2.input, r2.sendButton, r2.aiMessage];
    for (var k = 0; k < checks.length; k++) {
      totalChecks++;
      if (checks[k]) passedChecks++;
    }
  }

  console.log();
  console.log('总检查项: ' + totalChecks + '  |  通过: ' + passedChecks + '  |  未通过: ' + (totalChecks - passedChecks));
  console.log();

  // 详细信息
  var hasDetails = false;
  for (var m = 0; m < results.length; m++) {
    if (results[m].details.length > 0) {
      hasDetails = true;
      break;
    }
  }
  if (hasDetails) {
    console.log('--- 详细信息 ---');
    for (var n = 0; n < results.length; n++) {
      var r3 = results[n];
      if (r3.details.length > 0) {
        console.log('[' + r3.name + ']');
        for (var p = 0; p < r3.details.length; p++) {
          console.log('  - ' + r3.details[p]);
        }
      }
    }
    console.log();
  }
}

function padRight(str, len) {
  str = String(str);
  while (str.length < len) str += ' ';
  return str;
}

function padCenter(str, len) {
  str = String(str);
  if (str.length >= len) return str;
  var left = Math.floor((len - str.length) / 2);
  var right = len - str.length - left;
  return repeatStr(' ', left) + str + repeatStr(' ', right);
}

function repeatStr(ch, count) {
  var s = '';
  for (var i = 0; i < count; i++) s += ch;
  return s;
}

// ──────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          多平台适配器测试 — ChatGPT/Kimi/千问/智谱/豆包      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  var browser, context, page;

  // Step 1: CDP 连接
  console.log(ts() + ' Step 1: 通过 CDP 连接到 Chrome (' + CDP_URL + ')...');
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    context = browser.contexts()[0];
    if (!context) throw new Error('没有浏览器上下文');
    console.log(ts() + ' ✅ CDP 连接成功，上下文数: ' + browser.contexts().length);
  } catch (e) {
    console.log(ts() + ' ❌ CDP 连接失败: ' + e.message);
    console.log(ts() + ' 请确保 Chrome 已启动并开启了远程调试端口 (--remote-debugging-port=9222)');
    process.exit(1);
  }

  // 创建新页面用于测试
  page = await context.newPage();

  var allResults = [];

  // Step 2: 逐个测试平台
  console.log(ts() + ' Step 2: 开始逐个平台测试...');
  for (var i = 0; i < PLATFORMS.length; i++) {
    var platform = PLATFORMS[i];
    var result = await testPlatform(page, platform);
    allResults.push(result);

    // 平台之间等待
    if (i < PLATFORMS.length - 1) {
      console.log(ts() + '   等待 ' + (INTER_PLATFORM_DELAY / 1000) + ' 秒...');
      await page.waitForTimeout(INTER_PLATFORM_DELAY);
    }
  }

  // Step 3: 输出汇总
  console.log(ts() + ' Step 3: 输出汇总表格');
  printSummaryTable(allResults);

  // 关闭测试页面
  try {
    await page.close();
  } catch (e) {}

  console.log(ts() + ' 测试完成');
}

main().catch(function(e) {
  console.error('异常:', e);
  process.exit(1);
});
