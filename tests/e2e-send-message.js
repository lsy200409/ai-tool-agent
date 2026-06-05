var { chromium } = require('playwright-core');
var path = require('path');
var fs = require('fs');

var LOG_FILE = path.resolve(__dirname, '..', 'e2e-logs-' + Date.now() + '.json');
var allEvents = [];
var startTime = Date.now();
var browser;
var page;

function ts() { return ((Date.now() - startTime) / 1000).toFixed(1) + 's'; }

function logEvent(type, data) {
  var event = { time: Date.now() - startTime, type: type, data: data };
  allEvents.push(event);
  console.log('[' + ts() + '] [' + type + ']', JSON.stringify(data).substring(0, 200));
}

async function setupLogCapture() {
  logEvent('init', { step: 'setup_log_capture' });

  await page.evaluate(function() {
    window.__e2e_postMessage_events = [];

    window.addEventListener('message', function(e) {
      if (e.data && e.data.source === 'deepseek-tool-agent') {
        window.__e2e_postMessage_events.push({
          time: Date.now(),
          type: e.data.type,
          dataKeys: Object.keys(e.data).filter(function(k) { return k !== 'source'; }),
          textLen: (e.data.text || '').length,
          truncated: e.data.truncated,
          active: e.data.active,
          endTextLen: (e.data.endText || '').length,
          finishReason: e.data.finishReason
        });
      }
    });

    window.__e2e_getEvents = function() { return window.__e2e_postMessage_events; };
  });

  page.on('console', function(msg) {
    var text = msg.text();
    if (text.length > 500) text = text.substring(0, 500) + '...';
    logEvent('console_' + msg.type(), { text: text });
  });

  page.on('pageerror', function(err) {
    logEvent('page_error', { message: err.message, stack: (err.stack || '').substring(0, 300) });
  });
}

async function checkPageState() {
  var state = await page.evaluate(function() {
    var result = {};

    result.url = window.location.href;

    result.hasSignIn = !!document.querySelector('[class*="sign-in"]') ||
      !!document.querySelector('[class*="login"]') ||
      window.location.href.indexOf('sign_in') >= 0;

    result.hasChatInput = !!document.querySelector('textarea') ||
      !!document.querySelector('[contenteditable="true"]') ||
      !!document.querySelector('[role="textbox"]');

    var textarea = document.querySelector('textarea');
    if (!textarea) {
      var allEditable = document.querySelectorAll('[contenteditable="true"], [role="textbox"]');
      result.editableCount = allEditable.length;
      if (allEditable.length > 0) {
        result.editableTag = allEditable[0].tagName;
        result.editablePlaceholder = allEditable[0].getAttribute('placeholder') || '';
      }
    } else {
      result.textareaExists = true;
      result.textareaPlaceholder = textarea.placeholder || '';
    }

    result.injectedAlive = !!window.__deepseekToolAgentInjected;
    result.fetchPatched = !window.fetch.toString().includes('[native code]');

    var sendBtns = document.querySelectorAll('button');
    result.buttonCount = sendBtns.length;
    for (var i = 0; i < Math.min(sendBtns.length, 10); i++) {
      var btn = sendBtns[i];
      var label = (btn.textContent || '').trim();
      var aria = btn.getAttribute('aria-label') || '';
      var cls = btn.className || '';
      if (label || aria) {
        if (!result.buttons) result.buttons = [];
        result.buttons.push({ index: i, label: label.substring(0, 40), aria: aria.substring(0, 40), cls: cls.substring(0, 40) });
      }
    }

    return result;
  });

  logEvent('page_state', state);
  return state;
}

async function sendMessage(text) {
  logEvent('action', { step: 'sending_message', text: text });

  var result = await page.evaluate(function(msgText) {
    var result = {};

    var textarea = document.querySelector('textarea');
    if (!textarea) {
      var editables = document.querySelectorAll('[contenteditable="true"], [role="textbox"]');
      textarea = editables[0];
    }
    if (!textarea) {
      result.error = '找不到输入框';
      return result;
    }

    result.foundInput = true;
    result.inputTag = textarea.tagName;

    if (textarea.tagName === 'TEXTAREA') {
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(textarea, msgText);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      textarea.textContent = '';
      textarea.focus();
      document.execCommand('insertText', false, msgText);
    }

    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    var sendBtn = null;
    var allBtns = document.querySelectorAll('button');
    for (var i = 0; i < allBtns.length; i++) {
      var b = allBtns[i];
      var aria = (b.getAttribute('aria-label') || '').toLowerCase();
      var hasSendIcon = b.querySelector('svg') && !b.textContent.trim();
      var isSubmit = b.type === 'submit';

      if ((aria.indexOf('send') >= 0 || aria.indexOf('发送') >= 0 || hasSendIcon || isSubmit) && b.offsetParent !== null) {
        sendBtn = b;
        result.sendBtnFound = { aria: b.getAttribute('aria-label') || '', index: i, hasSvg: hasSendIcon };
        break;
      }
    }

    if (!sendBtn) {
      for (var j = 0; j < allBtns.length; j++) {
        var b2 = allBtns[j];
        if (b2.offsetParent !== null && b2.tagName === 'BUTTON' && !b2.textContent.trim() && b2.querySelector('svg')) {
          sendBtn = b2;
          result.sendBtnFound = { note: 'icon-only-button', index: j };
          break;
        }
      }
    }

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      result.sent = true;
    } else {
      if (textarea.form) {
        var submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        textarea.form.dispatchEvent(submitEvent);
        result.formSubmitted = true;
      } else {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        result.enterPressed = true;
      }
    }

    return result;
  }, text);

  logEvent('send_result', result);
  return result;
}

async function run() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  DeepSeek E2E 模拟用户测试');
  console.log('='.repeat(60));
  console.log('');

  try {
    browser = await chromium.connectOverCDP('http://localhost:9222');
    var contexts = browser.contexts();
    var pages = contexts[0].pages();

    page = pages.find(function(p) { return p.url().indexOf('chat.deepseek') >= 0; });
    if (!page) {
      page = await contexts[0].newPage();
      await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      await page.bringToFront();
    }

    logEvent('init', { step: 'connected', pageUrl: page.url() });

    await page.waitForTimeout(8000);
    await setupLogCapture();

    var state = await checkPageState();
    logEvent('init', { step: 'extension_init_done' });

    if (state.hasSignIn) {
      logEvent('blocked', { reason: 'login_required', url: state.url });
      console.log('');
      console.log('═══════════════════════════════════════════════');
      console.log('  需要登录 DeepSeek！');
      console.log('═══════════════════════════════════════════════');
      console.log('');
      console.log('请在 Edge 浏览器中登录 DeepSeek。');
      console.log('登录完成后，按 Enter 继续...');
      console.log('');

      await new Promise(function(resolve) {
        var stdin = process.stdin;
        stdin.resume();
        stdin.once('data', function() {
          stdin.pause();
          resolve();
        });
      });

      await page.waitForTimeout(5000);
      await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(5000);

      state = await checkPageState();
      if (state.hasSignIn) {
        logEvent('blocked', { reason: 'still_on_login', url: state.url });
        console.log('⚠ 仍在登录页面，无法继续。请手动操作后重试。');
        await browser.close();
        return;
      }
    }

    if (!state.hasChatInput) {
      logEvent('blocked', { reason: 'no_chat_input', state: state });
      console.log('⚠ 页面无聊天输入框，可能还在加载。等待 5 秒再试...');
      await page.waitForTimeout(5000);
      state = await checkPageState();
      if (!state.hasChatInput) {
        console.log('⚠ 仍然找不到输入框，请确认页面是否完全加载。');
        logEvent('blocked', { reason: 'no_chat_input_retry', state: state });
        await browser.close();
        return;
      }
    }

    await logStateSnapshot();
    await monitorPostMessageEvents();

    var testMessage = '你好，请帮我计算 123 + 456 等于多少？';
    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('  发送测试消息: ' + testMessage);
    console.log('═══════════════════════════════════════════════');
    console.log('');

    var sendStartTime = Date.now();
    var sendResult = await sendMessage(testMessage);

    if (sendResult.error) {
      logEvent('error', { step: 'send_failed', error: sendResult.error });
      console.log('❌ 发送失败: ' + sendResult.error);
      await saveLogs();
      await browser.close();
      return;
    }

    logEvent('action', { step: 'waiting_for_response' });
    console.log('等待 AI 响应（最多 60 秒）...');
    console.log('');

    await waitForAIResponse(60000);

    var pmEvents = await page.evaluate(function() {
      return window.__e2e_getEvents ? window.__e2e_getEvents() : [];
    });

    logEvent('result', {
      postMessageEventCount: pmEvents.length,
      hasStreamStart: pmEvents.some(function(e) { return e.type === '__ds_stream_start'; }),
      hasStreamChunk: pmEvents.some(function(e) { return e.type === '__ds_stream_chunk'; }),
      hasStreamEnd: pmEvents.some(function(e) { return e.type === '__ds_stream_end'; }),
      toolCallDetected: pmEvents.some(function(e) { return e.type === '__ds_tool_call'; }),
    });

    var finalState = await checkPageState();
    logEvent('result', { finalState: finalState });

    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('  测试完成');
    console.log('═══════════════════════════════════════════════');
    console.log('');

    var pmStats = {
      total: pmEvents.length,
      types: {}
    };
    for (var i = 0; i < pmEvents.length; i++) {
      var t = pmEvents[i].type;
      pmStats.types[t] = (pmStats.types[t] || 0) + 1;
    }
    console.log('postMessage 事件: ' + pmEvents.length + ' 个');
    var typeKeys = Object.keys(pmStats.types);
    for (var j = 0; j < typeKeys.length; j++) {
      console.log('  ' + typeKeys[j] + ': ' + pmStats.types[typeKeys[j]] + ' 次');
    }

    if (pmEvents.some(function(e) { return e.type === '__ds_tool_call'; })) {
      console.log('✅ 检测到工具调用！扩展监控正常工作');
    } else if (pmEvents.some(function(e) { return e.type === '__ds_stream_start'; })) {
      console.log('⚠️ 检测到 SSE 流事件，但无工具调用。可能 AI 未调用工具');
    } else {
      console.log('❌ 未检测到任何 SSE 流事件！fetch 劫持可能未触发');
      console.log('   请检查：');
      console.log('   1. DeepSeek API 端点是否仍是 chat/completion');
      console.log('   2. Content-Type 响应头是否仍是 text/event-stream');
      console.log('   3. injected.js 中的 URL 匹配是否正确');
    }

    await saveLogs();

    console.log('');
    console.log('浏览器保持打开。按 Ctrl+C 退出。');
    await new Promise(function() {});

  } catch(e) {
    logEvent('fatal_error', { message: e.message, stack: e.stack });
    console.error('❌ 错误: ' + e.message);
    console.error(e.stack);
    await saveLogs();
    try { await browser.close(); } catch(_) {}
    process.exit(1);
  }
}

async function logStateSnapshot() {
  var snap = await page.evaluate(function() {
    var r = {};
    r.injectedGuard = !!window.__deepseekToolAgentInjected;
    r.streamState = window.__ds_streamState ? window.__ds_streamState() : null;
    r.fetchStrLen = window.fetch.toString().length;
    r.autoWatchRunning = window.__ds_autoWatchRunning;
    r.monitorExists = typeof window.__ds_monitor !== 'undefined';

    if (window.__ds_monitor) {
      r.monitorState = window.__ds_monitor.state;
      r.monitorAiStarted = window.__ds_monitor.aiStarted;
      r.sseEnabled = window.__ds_monitor.sse ? window.__ds_monitor.sse.enabled : null;
      r.sseActive = window.__ds_monitor.sse ? window.__ds_monitor.sse.active : null;
    }

    r.messageCount = document.querySelectorAll('div.ds-message, [class*="message"]').length;
    return r;
  });
  logEvent('state_snapshot', snap);
}

async function monitorPostMessageEvents() {
  await page.evaluate(function() {
    window.addEventListener('message', function(e) {
      if (e.data && e.data.source === 'deepseek-tool-agent') {
        window.__e2e_pm_monitor = window.__e2e_pm_monitor || [];
        window.__e2e_pm_monitor.push({
          time: Date.now(),
          type: e.data.type,
          active: e.data.active,
        });
      }
    });
  });
}

async function waitForAIResponse(maxWaitMs) {
  var startWait = Date.now();
  var pollInterval = 1000;
  var lastMsgCount = 0;

  while (Date.now() - startWait < maxWaitMs) {
    await page.waitForTimeout(pollInterval);

    var info = await page.evaluate(function() {
      var pmEvents = window.__e2e_pm_monitor || [];
      var lastPm = pmEvents.length > 0 ? pmEvents[pmEvents.length - 1] : null;
      return {
        pmCount: pmEvents.length,
        lastPmType: lastPm ? lastPm.type : null,
      };
    });

    if (info.lastPmType === '__ds_stream_end') {
      logEvent('response', { status: 'stream_ended', elapsed: Date.now() - startWait, pmCount: info.pmCount });
      await page.waitForTimeout(5000);
      break;
    }

    if (info.pmCount > 0 && info.pmCount === lastMsgCount && Date.now() - startWait > 15000) {
      logEvent('response', { status: 'no_new_events', elapsed: Date.now() - startWait, pmCount: info.pmCount });
      await page.waitForTimeout(3000);
      break;
    }

    lastMsgCount = info.pmCount;

    if ((Date.now() - startWait) % 10000 < pollInterval) {
      console.log('  ' + ((Date.now() - startWait)/1000).toFixed(0) + 's... pmEvents=' + info.pmCount);
    }
  }
}

async function saveLogs() {
  var out = {
    startTime: new Date(startTime).toISOString(),
    duration: Date.now() - startTime,
    eventCount: allEvents.length,
    events: allEvents
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(out, null, 2));
  console.log('');
  console.log('日志已导出: ' + LOG_FILE);
  console.log('事件总数: ' + allEvents.length);
}

run().catch(function(err) {
  console.error('启动失败:', err);
  process.exit(1);
});