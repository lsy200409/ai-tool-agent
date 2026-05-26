const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

var isPersistMode = process.argv.includes('--persist');
var isSkipLogin = process.argv.includes('--skip-login');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const USER_DATA_DIR = isPersistMode
  ? path.resolve(__dirname, '..', '.browser-data-e2e')
  : path.resolve(__dirname, '..', '.browser-data-e2e-' + Date.now());
const TOOL_SERVER_URL = 'http://localhost:3002';

// ============================================================
// 工具函数
// ============================================================
function cleanSingleton(dir) {
  var files = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (var i = 0; i < files.length; i++) {
    try { fs.unlinkSync(path.join(dir, files[i])); } catch(e) {}
  }
}

async function copyProfile() {
  var src = path.resolve(__dirname, '..', '.browser-data');
  if (!fs.existsSync(src)) { fs.mkdirSync(USER_DATA_DIR, { recursive: true }); return; }
  await new Promise(function(resolve, reject) {
    fs.cp(src, USER_DATA_DIR, { recursive: true, force: true }, function(err) {
      if (err && err.code !== 'EBUSY') console.log('[copy] 部分文件跳过:', err.message);
      resolve();
    });
  });
}

async function cleanupProfile() {
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch(e) {}
}

function httpGET(url) {
  return new Promise(function(resolve) {
    var req = http.get(url, function(res) {
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

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(label, msg) {
  console.log('[' + timestamp() + '] [' + label + '] ' + msg);
}

// ============================================================
// 测试结果收集
// ============================================================
var testResults = {
  phase1_checkup: { passed: [], failed: [] },
  phase2_inject: { passed: [], failed: [], details: [] },
  phase3_monitor: { passed: [], failed: [], toolCalls: [], executions: [], injections: [] },
  phase4_monitor: { passed: [], failed: [] },
  phase5: { passed: [], failed: [] },
  phase6: { passed: [], failed: [] },
  main: { passed: [], failed: [] },
  issues: []
};

function pass(phase, item, detail) {
  testResults[phase].passed.push(item);
  if (detail) {
    var arr = testResults[phase].details || testResults[phase].executions;
    if (arr) arr.push({ item: item, detail: detail });
  }
  log('PASS', '[' + phase + '] ' + item);
}

function fail(phase, item, detail) {
  testResults[phase].failed.push(item);
  testResults.issues.push({ phase: phase, item: item, detail: detail || '' });
  log('FAIL', '[' + phase + '] ' + item + (detail ? ' — ' + detail : ''));
}

function info(label, msg) {
  log('INFO', '[' + label + '] ' + msg);
}

// ============================================================
// 阶段 1: 基础设施检查
// ============================================================
async function phase1_checkup() {
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  阶段 1: 基础设施检查                          │');
  console.log('└──────────────────────────────────────────────┘\n');

  var health = await httpGET(TOOL_SERVER_URL + '/health');
  if (health && health.status === 'ok') {
    pass('phase1_checkup', 'Tool Server 运行正常 — v' + health.version + ' — ' + health.tools_count + ' tools');
    info('phase1', 'Workspace: ' + health.workspace);
    info('phase1', 'Platform: ' + health.platform);
  } else {
    fail('phase1_checkup', 'Tool Server 未运行', '请先执行 node server/tool-server.js');
    return false;
  }

  if (fs.existsSync(EXTENSION_PATH + '/manifest.json')) {
    pass('phase1_checkup', '扩展 manifest.json 存在');
  } else {
    fail('phase1_checkup', '扩展 manifest.json 不存在');
    return false;
  }

  return true;
}

// ============================================================
// 阶段 2: 注入提示词 — 发布工具调用任务
// ============================================================
async function phase2_injectPage(page) {
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  阶段 2: 扩展注入与 DOM 结构检查               │');
  console.log('└──────────────────────────────────────────────┘\n');

  var testInput = '请执行以下任务来验证你的工具调用能力：\n1. 先用 list_dir 列出 workspace 目录的内容\n2. 再用 read_file 读取 workspace/README.md 文件内容';

  await page.waitForTimeout(3000);

  // 检查 Panel
  try {
    await page.waitForFunction(function() {
      return !!document.getElementById('__ds-agent-panel');
    }, {}, { timeout: 10000 });
    pass('phase2_inject', 'Panel (#__ds-agent-panel) 已注入');
  } catch(e) {
    fail('phase2_inject', 'Panel 未注入', '检查 content_scripts manifest 配置');
  }

  // 检查 Pet Ball
  try {
    await page.waitForFunction(function() {
      return !!document.getElementById('__ds-pet-ball');
    }, {}, { timeout: 5000 });
    pass('phase2_inject', 'Pet Ball (#__ds-pet-ball) 已注入');
  } catch(e) {
    fail('phase2_inject', 'Pet Ball 未注入');
  }

  // 检查日志面板
  try {
    await page.waitForFunction(function() {
      return !!document.getElementById('__ds-log-area');
    }, {}, { timeout: 5000 });
    pass('phase2_inject', '日志面板已注入');
  } catch(e) {
    fail('phase2_inject', '日志面板未找到');
  }

  // 检查聊天输入框
  var inputFound = await page.evaluate(function() {
    var inputEls = document.querySelectorAll('textarea');
    for (var i = 0; i < inputEls.length; i++) {
      if (inputEls[i].clientHeight > 0 && inputEls[i].offsetParent !== null) return true;
    }
    return false;
  });
  if (inputFound) pass('phase2_inject', '聊天输入框已检测到');
  else fail('phase2_inject', '未找到聊天输入框');

  // 检查发送按钮
  var btnInfo = await page.evaluate(function() {
    var btns = document.querySelectorAll('[role="button"],button');
    for (var j = 0; j < btns.length; j++) {
      var html = (btns[j].innerHTML || '').toLowerCase();
      if (html.indexOf('m8.3125') >= 0) return { found: true, type: 'arrow' };
      if (html.indexOf('<rect') >= 0) return { found: true, type: 'stop' };
    }
    var inputEl = document.querySelector('textarea');
    if (inputEl) {
      var walk = inputEl;
      for (var k = 0; k < 5; k++) {
        walk = walk.parentElement;
        if (!walk) break;
        var nearBtns = walk.querySelectorAll('button, [role="button"]');
        for (var n = 0; n < nearBtns.length; n++) {
          if (nearBtns[n].clientHeight > 0 && nearBtns[n].offsetParent !== null) {
            return { found: true, type: 'fallback' };
          }
        }
      }
    }
    return { found: false };
  });
  if (btnInfo.found) pass('phase2_inject', '发送按钮已检测到 (type=' + btnInfo.type + ')');
  else fail('phase2_inject', '未找到发送按钮');

  // 检查 MONITOR — 通过 postMessage 跨 isolated world 通信
  var monitorReady = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() { resolve({ monitorExists: false, error: 'timeout' }); }, 2000);
      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_test_state_response') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve({ monitorExists: true, state: e.data.state, pollCount: e.data.pollCount });
        }
      });
      window.postMessage({ type: '__ds_test_query_state' }, '*');
    });
  });
  info('phase2', 'MONITOR 状态: ' + JSON.stringify(monitorReady));
  if (monitorReady.monitorExists) pass('phase2_inject', 'MONITOR 已加载 (state=' + monitorReady.state + ')');
  else fail('phase2_inject', 'MONITOR 未加载到 content script (postMessage 超时)');

  return monitorReady.monitorExists;
}

// ============================================================
// 阶段 3: 注入工具调用提示词并监控全流程
// ============================================================
async function phase3_injectAndMonitor(page) {
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  阶段 3: 工具调用提示词注入与全流程监控        │');
  console.log('└──────────────────────────────────────────────┘\n');

  // 组装工具调用提示词 — 使用简单、容易被模型理解的任务
  var testPrompt = [
    '请使用工具完成以下任务：',
    '1. 用 list_dir 列出 workspace 目录的内容',
    '2. 用 read_file 读取 workspace/README.md 文件',
    '请确保使用 <tool_call> 格式调用工具，每次只调用一个工具。',
    '工具调用格式:',
    '<tool_call name="工具名">',
    '{"参数名":"参数值"}',
    '</tool_call>',
    '可用工具:',
    '- list_dir: 列出目录内容，参数 path (string)',
    '- read_file: 读取文件内容，参数 path (string)',
    '- exec_command: 执行命令，参数 command (string)',
    '- write_file: 写入文件，参数 path (string), content (string)',
    '- search_files: 搜索文件，参数 pattern (string), root (string)',
    '- get_file_info: 获取文件信息，参数 path (string)',
    '',
    'workspace 目录的完整路径是: f:\\桌面\\web_free_agent\\deepseek-tool-agent\\workspace',
    '请立即开始执行任务。'
  ].join('\n');

  info('phase3', '工具调用提示词:\n' + testPrompt.split('\n').map(function(l) { return '  > ' + l; }).join('\n'));

  // 使用 Playwright 原生 API 注入提示词（正确处理 React 受控组件）
  info('phase3', '正在通过 Playwright 原生 API 注入提示词到输入框...');

  // 找到输入框并填入
  var textarea = await page.$('textarea');
  if (textarea) {
    await textarea.click();
    await textarea.fill(testPrompt);
    await page.waitForTimeout(500);
    pass('phase3_monitor', '提示词已通过 page.fill() 注入 (' + testPrompt.length + ' 字)');
  } else {
    // fallback: contentEditable
    var editable = await page.$('[contenteditable="true"]');
    if (editable) {
      await editable.click();
      await editable.fill(testPrompt);
      await page.waitForTimeout(500);
      pass('phase3_monitor', '提示词已通过 contentEditable 注入 (' + testPrompt.length + ' 字)');
    } else {
      fail('phase3_monitor', '未找到可用输入框');
      return false;
    }
  }

  // 使用 Enter 键发送 (绕过按钮检测问题)
  info('phase3', '按下 Enter 发送...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  pass('phase3_monitor', '已通过 Enter 键发送提示词');
  return true;
}

// ============================================================
// 阶段 4: 监控 AI 流式生成和 tool_call 检测
// ============================================================
async function phase4_monitorStreaming(page, timeoutMs) {
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  阶段 4: 监控 AI 流式生成与 tool_call 检测     │');
  console.log('└──────────────────────────────────────────────┘\n');

  timeoutMs = timeoutMs || 180000;
  var checkInterval = 2000;
  var elapsed = 0;
  var startTime = Date.now();

  // 先启动监控 — 通过 postMessage
  info('phase4', '正在通过 postMessage 启动 MONITOR...');
  var monitorState = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() { resolve({ started: false, state: 'no_response' }); }, 3000);
      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_test_state_response') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve({ started: true, state: e.data.state, action: e.data.action });
        }
      });
      window.postMessage({ type: '__ds_test_start_monitor' }, '*');
    });
  });
  info('phase4', 'MONITOR 启动结果: ' + JSON.stringify(monitorState));
  if (monitorState.started) pass('phase4_monitor', 'MONITOR 已通过 postMessage 启动 (state=' + monitorState.state + ')');
  else info('phase4', 'MONITOR 启动状态: ' + JSON.stringify(monitorState));

  // 轮询监控状态
  info('phase4', '开始轮询监控 (间隔=' + checkInterval + 'ms, 超时=' + timeoutMs + 'ms)...');

  var lastAIText = '';
  var lastState = '';
  var logEntries = [];
  var toolCallsDetected = [];
  var roundCount = 0;

  while (elapsed < timeoutMs) {
    roundCount++;
    await page.waitForTimeout(checkInterval);
    elapsed += checkInterval;

    var snapshot = await page.evaluate(function() {
      var aiText = '';
      var assistantMsgs = document.querySelectorAll('div.ds-assistant-message-main-content');
      for (var i = 0; i < assistantMsgs.length; i++) {
        if (assistantMsgs[i].closest('.ds-think-content')) continue;
        var txt = (assistantMsgs[i].innerText || assistantMsgs[i].textContent || '').trim();
        if (txt.indexOf('## 环境') >= 0 || txt.indexOf('## 可用工具') >= 0) continue;
        if (txt.length > 0) aiText = txt;
      }

      var logPanelText = '';
      var logEl = document.getElementById('__ds-log-area');
      if (logEl) logPanelText = (logEl.innerText || '').substring(0, 500);

      var statusText = '';
      var statusEl = document.getElementById('__ds-status-text');
      if (statusEl) statusText = statusEl.innerText || '';

      return new Promise(function(resolve) {
        var timeout = setTimeout(function() {
          resolve({
            aiText: aiText, aiLen: aiText.length,
            hasToolCall: aiText.indexOf('<tool_call') >= 0,
            hasToolResponse: aiText.indexOf('<tool_response') >= 0,
            monitorState: 'unknown', statusText: statusText, logPreview: logPanelText
          });
        }, 500);

        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === '__ds_test_state_response') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve({
              aiText: aiText, aiLen: aiText.length,
              hasToolCall: aiText.indexOf('<tool_call') >= 0,
              hasToolResponse: aiText.indexOf('<tool_response') >= 0,
              monitorState: e.data.state, monitorPollCount: e.data.pollCount,
              monitorStableCount: e.data.stableCount, monitorAiStarted: e.data.aiStarted,
              statusText: statusText, logPreview: logPanelText
            });
          }
        });
        window.postMessage({ type: '__ds_test_query_state' }, '*');
      });
    });

    var aiText = snapshot.aiText;
    var stateChanged = (snapshot.monitorState !== lastState);

    if (aiText !== lastAIText) {
      lastAIText = aiText;
      if (aiText.length > 10) {
        info('phase4', 'round#' + roundCount + ' AI文本=' + aiText.length + '字 ' +
          'hasToolCall=' + snapshot.hasToolCall + ' hasToolResp=' + snapshot.hasToolResponse +
          ' monitor=' + snapshot.monitorState);
      }
    }

    if (stateChanged) {
      lastState = snapshot.monitorState;
      info('phase4', 'MONITOR 状态变更 → ' + snapshot.monitorState + ' (status=' + snapshot.statusText + ')');
    }

    // 检测到 tool_call
    if (snapshot.hasToolCall && !toolCallsDetected.some(function(tc) { return tc.text === aiText; })) {
      toolCallsDetected.push({ text: aiText, time: Date.now() });
      log('DETECT', 'AI 回复中包含 <tool_call> (长度=' + aiText.length + '字)');
      pass('phase4_monitor', '第' + toolCallsDetected.length + '轮 tool_call 已出现');

      var toolCallCount = (aiText.match(/<tool_call/gi) || []).length;
      info('phase4', 'Tool call 标签数量: ' + toolCallCount);

      // 提取并打印 tool_call 内容
      var calls = aiText.match(/<tool_call[\s\S]*?<\/tool_call>/gi) || [];
      for (var c = 0; c < calls.length; c++) {
        info('phase4', '  tool_call[' + c + ']: ' + calls[c].substring(0, 200).replace(/\n/g, '\\n'));
      }
    }

    // 检测到 tool_response (工具结果已回填)
    if (snapshot.hasToolResponse) {
      var respCount = (snapshot.aiText.match(/<tool_response/gi) || []).length;
      info('phase4', '检测到 tool_response (数量=' + respCount + ')');
    }

    // 如果 MONITOR 已经进入了处理工具或空闲状态
    if (snapshot.monitorState === 'executing_tools') {
      info('phase4', 'MONITOR 正在执行工具...');
    }

    if (snapshot.monitorState === 'idle' && lastState === 'executing_tools') {
      info('phase4', 'MONITOR 已从执行状态回到 idle');
      break;
    }

    if (snapshot.monitorState === 'idle' && lastState === 'ai_done') {
      info('phase4', 'MONITOR 已完成本轮处理 → idle');
      break;
    }

    if (snapshot.hasToolCall && snapshot.monitorState === 'idle' && elapsed > 30000) {
      info('phase4', '检测到 tool_call 但 MONITOR 已 idle，可能未自动检测到');
      break;
    }

    if (toolCallsDetected.length >= 2 && snapshot.monitorState === 'idle' && elapsed > 40000) {
      info('phase4', '已检测到多轮 tool_call，MONITOR 已 idle');
      break;
    }
  }

  info('phase4', '监控轮询结束 (总轮数=' + roundCount + ', 耗时=' + (elapsed/1000).toFixed(1) + 's)');

  // 汇总
  if (toolCallsDetected.length > 0) {
    pass('phase4_monitor', '共检测到 ' + toolCallsDetected.length + ' 轮包含 <tool_call> 的 AI 回复');
  } else {
    fail('phase4_monitor', '未检测到任何 <tool_call>', '可能 AI 未使用工具，或流式检测失败');
  }

  return {
    toolCallsDetected: toolCallsDetected,
    totalRounds: roundCount,
    elapsedMs: elapsed
  };
}

// ============================================================
// 阶段 5: 检查工具执行结果和回填
// ============================================================
async function phase5_checkResults(page) {
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  阶段 5: 工具执行结果与回填检查                 │');
  console.log('└──────────────────────────────────────────────┘\n');

  // 检查日志面板中的工具执行记录
  var logContent = await page.evaluate(function() {
    var lp = document.getElementById('__ds-log-area');
    return lp ? (lp.innerText || '').substring(0, 2000) : '';
  });

  if (logContent) {
    info('phase5', '日志面板内容 (' + logContent.length + ' 字):');
    var lines = logContent.split('\n').filter(function(l) { return l.trim().length > 0; });
    lines.slice(-15).forEach(function(l) { info('phase5', '  ' + l); });
  } else {
    fail('phase5', '日志面板为空，工具执行记录丢失');
  }

  // 检查 AI 回复中的 tool_response
  var aiMessages = await page.evaluate(function() {
    var msgs = [];
    var els = document.querySelectorAll('div.ds-assistant-message-main-content');
    for (var i = 0; i < els.length; i++) {
      var txt = (els[i].innerText || els[i].textContent || '').trim();
      if (txt.length > 20 && txt.indexOf('## 环境') < 0 && txt.indexOf('## 可用工具') < 0) {
        msgs.push({
          idx: i,
          length: txt.length,
          hasToolCall: txt.indexOf('<tool_call') >= 0,
          hasToolResponse: txt.indexOf('<tool_response') >= 0,
          preview: txt.substring(0, 200)
        });
      }
    }
    return msgs;
  });

  info('phase5', 'AI 消息汇总: ' + aiMessages.length + ' 条有效消息');
  for (var m = 0; m < aiMessages.length; m++) {
    var msg = aiMessages[m];
    info('phase5', '  [' + m + '] len=' + msg.length + ' tool_call=' + msg.hasToolCall + ' tool_resp=' + msg.hasToolResponse);
    info('phase5', '      preview: ' + msg.preview.substring(0, 120).replace(/\n/g, '\\n'));
  }

  // 验证关键路径
  var hasToolCallInMessages = aiMessages.some(function(m) { return m.hasToolCall; });
  var hasToolRespInMessages = aiMessages.some(function(m) { return m.hasToolResponse; });

  if (hasToolCallInMessages) pass('phase5', 'AI 消息中存在 <tool_call>');
  else fail('phase5', 'AI 消息中未发现 <tool_call>');

  if (hasToolRespInMessages) pass('phase5', 'AI 消息中存在 <tool_response> (工具已回填)');
  else info('phase5', 'AI 消息中未发现 <tool_response>，可能等待下一轮');

  // 检查聊天区总消息数
  var totalMessages = await page.evaluate(function() {
    return document.querySelectorAll('div.ds-message').length;
  });
  info('phase5', '会话总消息数: ' + totalMessages);

  return {
    hasToolCall: hasToolCallInMessages,
    hasToolResponse: hasToolRespInMessages,
    totalMessages: totalMessages,
    aiMessages: aiMessages
  };
}

// ============================================================
// 阶段 6: 详细诊断 — 分析潜在问题
// ============================================================
async function phase6_diagnostics(page, phase4Result) {
  console.log('\n┌──────────────────────────────────────────────┐');
  console.log('│  阶段 6: 诊断分析                              │');
  console.log('└──────────────────────────────────────────────┘\n');

  var issues = [];

  // 诊断 1: 检查 getLatestAIMessageText 是否正确工作
  var aiTextInfo = await page.evaluate(function() {
    var els = document.querySelectorAll('div.ds-assistant-message-main-content');
    var candidates = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = (el.innerText || el.textContent || '').trim();
      if (txt.length === 0) continue;
      if (el.closest('.ds-think-content')) continue;
      candidates.push({ idx: i, len: txt.length, hasToolCall: txt.indexOf('<tool_call') >= 0, systemPrompt: txt.indexOf('## 环境') >= 0 });
    }
    return {
      totalDivs: els.length,
      candidates: candidates
    };
  });

  info('phase6', 'getLatestAIMessageText 候选信息:');
  info('phase6', '  总 div 数: ' + aiTextInfo.totalDivs);
  info('phase6', '  有效候选: ' + aiTextInfo.candidates.length);
  for (var d = 0; d < aiTextInfo.candidates.length; d++) {
    var c = aiTextInfo.candidates[d];
    info('phase6', '    [' + c.idx + '] len=' + c.len + ' tool_call=' + c.hasToolCall + ' sysPrompt=' + c.systemPrompt);
  }

  // 诊断 2: 检查 MONITOR 内部状态 (通过 postMessage)
  var monitorInternals = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() { resolve({ ok: false, error: 'MONITOR 无响应' }); }, 2000);
      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_test_state_response') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve({
            ok: true,
            state: e.data.state,
            stableCount: e.data.stableCount,
            aiStarted: e.data.aiStarted,
            lastAiTextLen: e.data.lastAiTextLen || 0,
            toolChainIterations: e.data.toolChainIterations || 0,
            noToolCallWaitCount: e.data.noToolCallWaitCount || 0,
            currentRoundToolCalls: e.data.currentRoundToolCalls || 0,
            currentRoundExecResults: e.data.currentRoundExecResults || 0,
            _pollCount: e.data.pollCount || 0
          });
        }
      });
      window.postMessage({ type: '__ds_test_query_state' }, '*');
    });
  });

  info('phase6', 'MONITOR 内部状态: ' + JSON.stringify(monitorInternals, null, 2));

  // 诊断 3: 检查 detectStreaming 当前状态
  var streamingState = await page.evaluate(function() {
    var btns = document.querySelectorAll('[role="button"],button');
    for (var j = 0; j < btns.length; j++) {
      var html = (btns[j].innerHTML || '');
      if (html.indexOf('<rect') >= 0) return { streaming: true, btnType: 'stop/rect' };
      if (html.indexOf('m8.3125') >= 0 || html.indexOf('M8.3125') >= 0) return { streaming: false, btnType: 'arrow' };
    }
    return { streaming: false, btnType: 'unknown' };
  });

  info('phase6', 'detectStreaming 状态: ' + JSON.stringify(streamingState));

  // 诊断 4: 检查 postMessage 捕获的工具执行结果
  var toolResults = await page.evaluate(function() {
    return window.__ds_toolResults || [];
  });

  if (toolResults.length > 0) {
    pass('phase6', '工具执行已通过 postMessage 捕获: ' + toolResults.length + ' 轮');
    for (var tr = 0; tr < toolResults.length; tr++) {
      info('phase6', '  结果[' + tr + ']: round=' + toolResults[tr].round + ' tools=' + JSON.stringify(toolResults[tr].results).substring(0, 300));
    }
  } else {
    info('phase6', '未捕获到工具执行结果 (postMessage 事件未触发)');
  }

  // 诊断 5: 关键问题检测
  if (phase4Result.toolCallsDetected.length === 0) {
    issues.push('严重: AI 未返回 <tool_call>，可能模型未理解任务或 DeepSeek 不愿意输出工具调用格式');
    issues.push('建议: 检查 AI 的实际回复内容是否包含工具调用');
  }

  if (monitorInternals.ok && monitorInternals.state === 'idle' && monitorInternals._pollCount === 0) {
    issues.push('注意: MONITOR 未开始轮询 (pollCount=0)，监控未实际运行');
  }

  if (monitorInternals.ok && monitorInternals.stableCount > 20 && monitorInternals.state !== 'ai_done') {
    issues.push('警告: stableCount=' + monitorInternals.stableCount + ' 较高但仍未进入 ai_done，可能 detectStreaming 误判流式状态');
  }

  if (monitorInternals.ok && monitorInternals.noToolCallWaitCount >= 15) {
    issues.push('注意: 无工具调用二次确认已到期 (noToolCallWaitCount=' + monitorInternals.noToolCallWaitCount + ')，监控可能已自动停止');
  }

  if (streamingState.streaming) {
    issues.push('注意: 发送按钮仍为方块(停止按钮)，AI 仍在流式输出中');
  }

  info('phase6', '\n=== 诊断结论 ===');
  if (issues.length === 0) {
    info('phase6', '✅ 未发现明显问题');
  } else {
    for (var iss = 0; iss < issues.length; iss++) {
      log('ISSUE', issues[iss]);
    }
  }

  return { issues: issues, monitorInternals: monitorInternals };
}

// ============================================================
// 主流程
// ============================================================
async function run() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  DS-Agent v2.5 — 端到端工具调用测试');
  console.log('  专注: 工具调用的检测、解析、执行、回填全流程');
  console.log('═══════════════════════════════════════════════════\n');

  // 阶段 1
  var ok = await phase1_checkup();
  if (!ok) {
    console.log('\n[FATAL] 基础设施检查失败，测试终止');
    return;
  }

  // 启动浏览器
  info('main', '启动浏览器...');
  await copyProfile();
  cleanSingleton(USER_DATA_DIR);

  var context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      '--disable-extensions-except=' + EXTENSION_PATH,
      '--load-extension=' + EXTENSION_PATH,
      '--ignore-certificate-errors',
      '--disable-web-security',
    ],
    devtools: false,
  });

  context.on('page', function(page) {
    info('browser', '新页面: ' + page.url());
  });

  var page = await context.newPage();
  page.setDefaultTimeout(30000);

  // 导航到 DeepSeek
  info('main', '导航到 https://chat.deepseek.com/ ...');
  try {
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) {
    info('main', '导航超时或出错: ' + e.message.substring(0, 100));
  }

  // 导航后安装 postMessage 监听器（必须在导航后，否则 about:blank 的 window 会丢失）
  await page.evaluate(function() {
    window.__ds_toolResults = [];
    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === '__ds_tool_results') {
        window.__ds_toolResults.push(e.data);
        console.log('[Test:postMsg] Tool results captured (round ' + e.data.round + '):', JSON.stringify(e.data.results).substring(0, 300));
      }
    });
  });
  pass('main', 'postMessage 监听器已安装 (导航后)');

  await page.waitForTimeout(5000);
  var url = page.url();
  info('main', '当前页面: ' + url);

  // 登录检查
  var isLoginPage = url.indexOf('login') >= 0 || url.indexOf('auth') >= 0;
  if (isLoginPage && isSkipLogin) {
    info('main', '检测到登录页但已启用 --skip-login，尝试使用持久化 session...');
    await page.waitForTimeout(5000);
    if (page.url().indexOf('login') < 0) {
      info('main', 'Session 有效，已自动登录');
    } else {
      fail('main', 'Session 无效，仍需手动登录。请运行不带 --skip-login 的测试');
      return;
    }
  } else if (isLoginPage) {
    console.log('\n' + '='.repeat(50));
    console.log('  请在浏览器窗口中完成 DeepSeek 登录');
    console.log('  登录后按 Enter 继续...');
    console.log('='.repeat(50) + '\n');
    await page.waitForTimeout(500);

    await new Promise(function(resolve) {
      process.stdin.once('data', function() { resolve(); });
    });

    await page.waitForTimeout(3000);
    info('main', '登录后 URL: ' + page.url());
  }

  // 阶段 2: 扩展注入检查
  var monitorOk = await phase2_injectPage(page);
  if (!monitorOk) {
    info('main', 'MONITOR 未就绪，尝试等待更多时间...');
    await page.waitForTimeout(5000);
    monitorOk = await page.evaluate(function() {
      return new Promise(function(resolve) {
        var timeout = setTimeout(function() { resolve(false); }, 2000);
        window.addEventListener('message', function handler(e) {
          if (e.data && e.data.type === '__ds_test_state_response') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(true);
          }
        });
        window.postMessage({ type: '__ds_test_query_state' }, '*');
      });
    });
    if (monitorOk) pass('main', 'MONITOR 延迟后已就绪');
    else fail('main', 'MONITOR 仍然未就绪');
  }

  // 阶段 3: 注入工具调用提示词
  var sent = await phase3_injectAndMonitor(page);
  if (!sent) {
    console.log('\n[FATAL] 发送提示词失败，测试终止');
    return;
  }

  // 阶段 4: 监控流式生成
  var phase4Result = await phase4_monitorStreaming(page, 180000);

  // 阶段 5: 检查结果
  var phase5Result = await phase5_checkResults(page);

  // 阶段 6: 诊断分析
  var phase6Result = await phase6_diagnostics(page, phase4Result);

  // ============================================================
  // 最终报告
  // ============================================================
  console.log('\n');
  console.log('═══════════════════════════════════════════════');
  console.log('  端到端工具调用测试 — 最终报告');
  console.log('═══════════════════════════════════════════════');

  var totalPass = 0, totalFail = 0;
  for (var key in testResults) {
    if (key === 'issues') continue;
    var phase = testResults[key];
    totalPass += (phase.passed || []).length;
    totalFail += (phase.failed || []).length;
  }

  console.log('\n  测试统计: ' + totalPass + ' 通过 / ' + totalFail + ' 失败 / ' + (totalPass + totalFail) + ' 总计');

  console.log('\n  通过项:');
  for (var pk in testResults) {
    if (pk === 'issues') continue;
    var p = testResults[pk];
    for (var pi = 0; pi < p.passed.length; pi++) {
      console.log('    ✅ ' + p.passed[pi]);
    }
  }

  if (totalFail > 0) {
    console.log('\n  失败项:');
    for (var fk in testResults) {
      if (fk === 'issues') continue;
      var f = testResults[fk];
      for (var fi = 0; fi < f.failed.length; fi++) {
        console.log('    ❌ ' + f.failed[fi]);
      }
    }
  }

  if (testResults.issues.length > 0) {
    console.log('\n  发现的问题:');
    for (var i = 0; i < testResults.issues.length; i++) {
      console.log('    ⚠  [' + testResults.issues[i].phase + '] ' + testResults.issues[i].item);
      if (testResults.issues[i].detail) {
        console.log('        Detail: ' + testResults.issues[i].detail);
      }
    }
  }

  if (phase6Result.issues.length > 0) {
    console.log('\n  诊断分析:');
    for (var di = 0; di < phase6Result.issues.length; di++) {
      console.log('    🔍 ' + phase6Result.issues[di]);
    }
  }

  console.log('\n  监控内部状态: ' + JSON.stringify(phase6Result.monitorInternals, null, 2));

  console.log('\n  浏览器保持打开，请手动检查。');
  console.log('  按 Ctrl+C 退出。');
  console.log('═══════════════════════════════════════════════\n');

  // 保持进程存活
  process.on('SIGINT', async function() {
    console.log('\n[Cleanup] 正在清理...');
    await context.close();
    await cleanupProfile();
    console.log('[Cleanup] 完成');
    process.exit(0);
  });

  await new Promise(function() {});
}

run().catch(async function(err) {
  console.error('[FATAL]', err.message);
  console.error(err.stack);
  await cleanupProfile();
  process.exit(1);
});