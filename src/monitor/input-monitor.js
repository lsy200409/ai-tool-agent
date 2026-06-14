// ============================================================
// DeepSeek Tool Agent v0.1.1 — 实时输入监控模块
//
// 5层架构:
//   Layer 0: SSE Stream Intercept — 网络层实时感知流状态 (NEW)
//   Layer 1: DOM Observer — Polling 检测页面流式状态 (fallback)
//   Layer 2: Content Parser — 从AI响应中提取 <tool_call>
//   Layer 3: Tool Coordinator — AUTO/MANUAL/OFF 模式调度
//   Layer 4: Result Injector — 工具结果回注到对话
//   Layer 5: UI Bridge — 与 panel.js 双向通信
// ============================================================

var MONITOR_STUCK_TIMEOUT = 5 * 60 * 1000;  // 监控卡死超时
var MONITOR_STATE_TIMEOUT = 180000;           // 状态超时保护
var SSE_TIMEOUT_MS = 5000;                    // SSE 无事件超时
var POLL_INTERVAL_MS = 800;                   // 轮询间隔
var STABLE_COUNT_THRESHOLD = 3;               // AI 回复稳定阈值

var MONITOR = {
  state: 'idle',

  currentRound: {
    toolCalls: [],
    executedResults: [],
    aiMessageText: '',
    startTime: 0
  },

  config: {
    pollInterval: POLL_INTERVAL_MS,
    maxWaitTime: 90000,
    stableThreshold: STABLE_COUNT_THRESHOLD,
    autoResumeTimeout: 5000,
    maxToolIterations: 20
  },

  pollTimer: null,
  stableCount: 0,
  lastAiText: '',
  aiStarted: false,

  toolModes: {},
  toolModesLoaded: false,

  sse: {
    enabled: false,
    active: false,
    accumulatedText: '',
    streamEnded: false,
    endText: '',
    lastEventTime: 0
  }
};

// ═══════════════════════════════════════════════════════════
// § 1. UI Bridge — 面板状态更新、对话框
// ═══════════════════════════════════════════════════════════
MONITOR.ui = {
  notifyState: function(state, data) {
    if (typeof setStageText === 'function') setStageText(state);
    if (typeof logPanel === 'function' && data && data.message) {
      logPanel(data.level || 'info', data.message);
    }
  },

  showApprovalDialog: function(toolCall) {
    return new Promise(function(resolve) {
      var overlay = document.getElementById('__ds-modal-overlay');
      if (!overlay) { resolve({ approved: true }); return; }

      var modal = document.createElement('div');
      modal.id = '__ds-tool-approval';
      modal.className = 'ds-modal';
      modal.style.display = 'block';
      modal.style.position = 'relative';
      modal.innerHTML = [
        '<div class="ds-modal-title">工具调用审批</div>',
        '<div style="margin:12px 0;padding:10px;background:var(--ds-bg);border-radius:var(--ds-radius-sm);">',
        '  <strong>工具:</strong> ' + escapeAttr(toolCall.name) + '<br>',
        '  <strong>参数:</strong> <pre style="margin:4px 0;font-size:11px;">' + escapeAttr(JSON.stringify(toolCall.arguments, null, 2)) + '</pre>',
        '</div>',
        '<div class="ds-modal-actions">',
        '  <button class="ds-btn ds-btn-danger ds-btn-sm" id="__ds-approve-deny">拒绝</button>',
        '  <button class="ds-btn ds-btn-success ds-btn-sm" id="__ds-approve-once">允许本次</button>',
        '  <button class="ds-btn ds-btn-primary ds-btn-sm" id="__ds-approve-always">始终允许</button>',
        '</div>'
      ].join('');

      overlay.innerHTML = '';
      overlay.appendChild(modal);
      overlay.classList.add('show');

      document.getElementById('__ds-approve-once').onclick = function() {
        overlay.classList.remove('show');
        resolve({ approved: true, action: 'allow_once' });
      };
      document.getElementById('__ds-approve-always').onclick = function() {
        overlay.classList.remove('show');
        resolve({ approved: true, action: 'allow_always' });
      };
      document.getElementById('__ds-approve-deny').onclick = function() {
        overlay.classList.remove('show');
        resolve({ approved: false, action: 'deny' });
      };
    });
  },

  // 敏感操作确认对话框 — 用于 needsConfirmation 结果
  showConfirmDialog: function(toolName, result) {
    return new Promise(function(resolve) {
      var overlay = document.getElementById('__ds-modal-overlay');
      if (!overlay) { resolve({ confirmed: false }); return; }

      var reason = result.reason || '此操作需要确认';
      var explanation = result.explanation || '';
      var command = result.command || '';
      var filePath = result.path || '';
      var safetyLevel = result.safetyLevel || '';

      var levelLabel = { sensitive: '⚠️ 敏感操作', dangerous: '🚫 危险操作' };
      var levelColor = { sensitive: '#f59e0b', dangerous: '#ef4444' };
      var label = levelLabel[safetyLevel] || '⚠️ 需要确认';
      var color = levelColor[safetyLevel] || '#f59e0b';

      var detailHtml = '';
      if (command) {
        detailHtml += '<div style="margin:8px 0;"><strong>命令:</strong> <code style="background:rgba(0,0,0,0.1);padding:2px 6px;border-radius:3px;font-size:12px;">' + escapeAttr(command) + '</code></div>';
      }
      if (filePath) {
        detailHtml += '<div style="margin:8px 0;"><strong>路径:</strong> <code style="background:rgba(0,0,0,0.1);padding:2px 6px;border-radius:3px;font-size:12px;">' + escapeAttr(filePath) + '</code></div>';
      }
      if (explanation) {
        detailHtml += '<div style="margin:8px 0;color:var(--ds-text-secondary);font-size:13px;">' + escapeAttr(explanation) + '</div>';
      }

      var modal = document.createElement('div');
      modal.id = '__ds-confirm-modal';
      modal.className = 'ds-modal';
      modal.style.cssText = 'display:block;position:relative;pointer-events:auto;';
      modal.innerHTML = [
        '<div class="ds-modal-title" style="border-left:4px solid ' + color + ';padding-left:10px;">' + label + '</div>',
        '<div style="margin:12px 0;padding:10px;background:var(--ds-bg);border-radius:var(--ds-radius-sm);">',
        '  <div style="margin-bottom:8px;font-weight:600;">' + escapeAttr(reason) + '</div>',
        '  <div><strong>工具:</strong> ' + escapeAttr(toolName) + '</div>',
        detailHtml,
        '</div>',
        '<div class="ds-modal-actions" style="pointer-events:auto;">',
        '  <button class="ds-btn ds-btn-danger ds-btn-sm" id="__ds-confirm-deny" style="pointer-events:auto;cursor:pointer;position:relative;z-index:10;">拒绝</button>',
        '  <button class="ds-btn ds-btn-success ds-btn-sm" id="__ds-confirm-ok" style="pointer-events:auto;cursor:pointer;position:relative;z-index:10;">确认执行</button>',
        '</div>'
      ].join('');

      // 阻止 modal 内部点击冒泡到 overlay
      modal.addEventListener('click', function(e) { e.stopPropagation(); });

      overlay.innerHTML = '';
      overlay.appendChild(modal);
      overlay.classList.add('show');

      // 使用 addEventListener 替代 onclick，更可靠
      var okBtn = document.getElementById('__ds-confirm-ok');
      var denyBtn = document.getElementById('__ds-confirm-deny');

      function cleanup() {
        if (okBtn) okBtn.removeEventListener('click', onConfirm);
        if (denyBtn) denyBtn.removeEventListener('click', onDeny);
        overlay.classList.remove('show');
      }

      function onConfirm(e) {
        e.stopPropagation();
        e.preventDefault();
        cleanup();
        resolve({ confirmed: true });
      }

      function onDeny(e) {
        e.stopPropagation();
        e.preventDefault();
        cleanup();
        resolve({ confirmed: false });
      }

      if (okBtn) okBtn.addEventListener('click', onConfirm);
      if (denyBtn) denyBtn.addEventListener('click', onDeny);
    });
  },

  updatePanelStatus: function(text) {
    if (typeof setStageText === 'function') setStageText(text);
    var progressEl = document.getElementById('__ds-progress-indicator');
    if (progressEl) progressEl.textContent = text;
  },

  updateToolChainProgress: function(current, total, toolName, status) {
    var text = 'Tool Chain ' + current + '/' + total + ' · ' + toolName;
    if (status) text += ' ' + status;
    MONITOR.ui.updatePanelStatus(text);

    var dotEl = document.getElementById('__ds-chain-dots');
    if (dotEl) {
      var dots = '';
      for (var i = 1; i <= total; i++) {
        if (i < current) dots += '<span style="color:#81c995;">●</span>';
        else if (i === current) dots += '<span style="color:#8ab4f8;">●</span>';
        else dots += '<span style="color:#5f6368;">○</span>';
        if (i < total) dots += ' ';
      }
      dotEl.innerHTML = dots;
    }
  }
};

// ═══════════════════════════════════════════════════════════
// § 2. Result Injector — 工具结果回注
// ═══════════════════════════════════════════════════════════
MONITOR.injector = {
  simplifyResult: function(r) {
    var toolName = r.tool || r.name || '';
    var data = r.data || r;
    var out = {};
    if (toolName) out.tool = toolName;

    if (data.error) {
      if (typeof data.error === 'object' && data.error.message) {
        out.error = data.error.message;
        if (data.error.code) out.code = data.error.code;
      } else {
        out.error = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
      }
      return out;
    }
    if (data.blocked) {
      out.blocked = true;
      out.reason = data.reason || '';
      if (data.needsConfirmation) out.needsConfirmation = true;
      if (data.explanation) out.explanation = data.explanation;
      if (data.safetyLevel) out.safetyLevel = data.safetyLevel;
      if (data.command) out.command = data.command;
      if (data.path) out.path = data.path;
      return out;
    }

    if (toolName === 'read_file') {
      if (data.content) out.content = data.content;
    } else if (toolName === 'write_file' || toolName === 'append_file') {
    } else if (toolName === 'list_dir') {
      if (data.files) out.files = data.files.map(function(f) {
        return f.isDirectory ? f.name + '/' : f.name;
      });
    } else if (toolName === 'search_files') {
      if (data.files) out.files = data.files.map(function(f) {
        var parts = f.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1];
      });
    } else if (toolName === 'get_file_info') {
      if (data.info) {
        out.size = data.info.size;
        out.modified = data.info.mtime;
        out.type = data.info.isDirectory ? 'directory' : 'file';
      }
    } else if (toolName === 'exec_command') {
      if (data.stdout && data.stdout.length > 0) out.stdout = data.stdout;
      if (data.stderr && data.stderr.length > 0) out.stderr = data.stderr;
      if ('exitCode' in data && data.exitCode !== 0) out.exitCode = data.exitCode;
    } else {
      if (data.stdout) out.stdout = data.stdout;
      if (data.stderr) out.stderr = data.stderr;
      if (data.content) out.content = data.content;
      if (data.result) out.result = data.result;
    }
    return out;
  },

  injectResults: function(results) {
    return new Promise(function(resolve) {
      var input = typeof findChatInput === 'function' ? findChatInput() : null;
      if (!input) {
        console.error('[Monitor] injectResults: findChatInput() 返回 null，无法注入工具结果');
        if (typeof logPanel === 'function') {
          logPanel('error', '❌ 注入失败: 找不到输入框 (findChatInput=null)');
        }
        resolve(false);
        return;
      }

      if (typeof logPanel === 'function') {
        var summary = results.map(function(r) {
          return (r.tool || r.name || '?') + ':' + (r.success !== false ? '✓' : '✗');
        }).join(', ');
        logPanel('success', '📥 工具结果已回填: ' + summary);
      }

      setTimeout(function() {
      var responseText = '';
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var simple = MONITOR.injector.simplifyResult(r);
        responseText += '<tool_response status="' + (r.success !== false ? 'ok' : 'error') + '">\n';
        responseText += JSON.stringify(simple, null, 2);
        responseText += '\n</tool_response>\n';
      }

      var userTask = typeof getLatestUserMessageText === 'function' ? getLatestUserMessageText() : '';
      if (userTask && userTask.length > 0 && userTask.indexOf('正在思考') !== 0) {
        responseText += '\n---\n';
        responseText += '原始任务: ' + userTask + '\n';

        var hasContextError = false;
        for (var j = 0; j < results.length; j++) {
          var r2 = results[j];
          var data = r2.data || r2;
          var errStr = data.error ? (typeof data.error === 'string' ? data.error : (data.error.message || '')) : (r2.error || '');
          if (errStr.indexOf('上下文已失效') >= 0 || errStr.indexOf('context invalidated') >= 0) {
            hasContextError = true;
            break;
          }
        }

        if (hasContextError) {
          responseText += '\n⚠️ 检测到扩展上下文中断的错误。系统将在3秒后自动恢复连接。\n';
          responseText += '如果问题持续，请刷新页面或重启浏览器扩展。\n';
          responseText += '继续执行: 请根据以上工具调用结果和用户原始任务继续完成任务，如果已完成则总结汇报。\n';
          responseText += '如果工具失败请分析原因并尝试以下方法：\n';
          responseText += '1. 使用备用命令（如 exec_command "type path\\to\\file" 代替 read_file）\n';
          responseText += '2. 等待3秒后重试相同的工具调用\n';
          responseText += '3. 如果多次失败，告知用户可能的连接问题';
        } else {
          responseText += '请根据以上工具调用结果和用户原始任务继续完成任务，如果已完成则总结汇报。如果工具失败请分析原因并尝试其他方法。';
        }
      }

      if (typeof logPanel === 'function') {
        logPanel('info', '📝 注入内容预览 (' + responseText.length + '字): ' + responseText.substring(0, 200).replace(/\n/g, ' '));
      }

      try {
        if (typeof setInputValue === 'function') setInputValue(input, responseText);
        else input.value = responseText;

        setTimeout(function() {
          var sendOk = typeof clickSendButton === 'function' ? clickSendButton() : false;
          if (!sendOk) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }
          if (typeof logPanel === 'function') {
            logPanel('info', '📤 工具结果已发送 (clickSendButton=' + sendOk + ', 文本' + responseText.length + '字)');
          }
          resolve(true);
        }, 300);
      } catch(e) {
        console.error('[Monitor] injectResults 异常: ' + e.message);
        if (typeof logPanel === 'function') logPanel('error', '注入结果异常: ' + e.message);
        resolve(false);
      }
    }, 300);
    });
  },

  injectSingleResult: function(callName, result) {
    return MONITOR.injector.injectResults([{
      tool: callName,
      success: result.success !== false
    }]);
  }
};

// ═══════════════════════════════════════════════════════════
// § 3. Tool Coordinator — AUTO/MANUAL/OFF 模式调度
// ═══════════════════════════════════════════════════════════
MONITOR.coordinator = {
  getToolMode: function(toolName) {
    if (!MONITOR.toolModesLoaded) {
      try {
        if (typeof agentTools !== 'undefined' && Array.isArray(agentTools)) {
          for (var i = 0; i < agentTools.length; i++) {
            MONITOR.toolModes[agentTools[i].name] = agentTools[i].mode || 'auto';
          }
          MONITOR.toolModesLoaded = true;
        }
      } catch(e) {}
    }
    return MONITOR.toolModes[toolName] || 'auto';
  },

  executeToolCall: async function(toolCall, mode) {
    var toolName = toolCall.name;
    var args = toolCall.arguments || toolCall.args || {};

    if (!toolName) return { success: false, error: '工具名称缺失' };

    if (mode === 'off') {
      MONITOR.ui.notifyState('工具已封锁', { level: 'warn', message: '工具 ' + toolName + ' 被OFF模式封锁' });
      return { success: false, error: '工具 ' + toolName + ' 已被封锁 (OFF 模式)', blocked: true, tool: toolName };
    }

    if (mode === 'manual') {
      var approval = await MONITOR.ui.showApprovalDialog(toolCall);
      if (!approval.approved) {
        MONITOR.ui.notifyState('已拒绝', { level: 'info', message: '拒绝执行: ' + toolName });
        return { success: false, error: '用户拒绝执行工具调用', denied: true, tool: toolName };
      }
      if (approval.action === 'allow_always') {
        MONITOR.toolModes[toolName] = 'auto';
        if (typeof agentTools !== 'undefined' && Array.isArray(agentTools)) {
          var t = agentTools.find(function(x) { return x.name === toolName; });
          if (t) t.mode = 'auto';
        }
      }
    }

    MONITOR.ui.notifyState('执行中: ' + toolName, { level: 'info', message: '执行工具: ' + toolName + ' ' + JSON.stringify(args).substring(0, 100) });

    try {
      var result = await executeSingleTool({ name: toolName, arguments: args }, (MONITOR.currentRound || {}).sessionId);
      result.tool = toolName;

      // 检查约束拦截结果
      var data = result.data || result;
      if (data.blocked) {
        if (data.neverAllow) {
          // NEVER_ALLOW — 绝对禁止，任何权限都无法绕过
          MONITOR.ui.notifyState('绝对禁止: ' + toolName, { level: 'error', message: data.reason || '此操作被安全规则永久禁止' });
          if (typeof logPanel === 'function') {
            logPanel('error', '🚫 绝对禁止: ' + toolName + ' — ' + (data.reason || '此操作被安全规则永久禁止'));
          }
          return { success: false, error: '绝对禁止(NEVER_ALLOW): ' + (data.reason || '此操作被安全规则永久禁止'), blocked: true, neverAllow: true, tool: toolName };
        } else if (data.needsConfirmation) {
          // 敏感操作 — 弹出确认对话框
          MONITOR.ui.notifyState('等待确认: ' + toolName, { level: 'warn', message: data.reason || '敏感操作需要确认' });
          if (typeof logPanel === 'function') {
            logPanel('warn', '⚠️ 需要确认: ' + toolName + ' — ' + (data.reason || ''));
          }

          var confirmResult = await MONITOR.ui.showConfirmDialog(toolName, data);
          if (confirmResult.confirmed) {
            // 用户确认 — 调用 /api/confirm 端点重新执行
            if (typeof logPanel === 'function') {
              logPanel('info', '✓ 用户已确认，重新执行: ' + toolName);
            }
            var confirmedResult = await executeConfirmedTool(toolName, args);
            confirmedResult.tool = toolName;
            return confirmedResult;
          } else {
            // 用户拒绝
            if (typeof logPanel === 'function') {
              logPanel('warn', '✗ 用户拒绝确认: ' + toolName);
            }
            return { success: false, error: '用户拒绝确认: ' + (data.reason || '敏感操作'), denied: true, tool: toolName };
          }
        } else {
          // 危险操作 — 直接拦截，不可确认
          MONITOR.ui.notifyState('已拦截: ' + toolName, { level: 'error', message: data.reason || '危险操作已被拦截' });
          if (typeof logPanel === 'function') {
            logPanel('error', '🚫 已拦截: ' + toolName + ' — ' + (data.reason || '危险操作'));
          }
          return { success: false, error: data.reason || '危险操作已被拦截', blocked: true, tool: toolName };
        }
      }

      return result;
    } catch(e) {
      return { success: false, error: '工具执行失败: ' + e.message, tool: toolName };
    }
  },

  executeAll: async function(toolCalls) {
    MONITOR.state = 'executing_tools';
    var results = [];
    var total = toolCalls.length;

    // 工具执行时自动展开面板
    if (typeof togglePanel === 'function') togglePanel(true);

    for (var i = 0; i < toolCalls.length; i++) {
      var call = toolCalls[i];
      var mode = MONITOR.coordinator.getToolMode(call.name);
      if (typeof logPanel === 'function') {
        logPanel('info', '⚡ 执行 [' + (i+1) + '/' + total + '] ' + call.name + ' ' + JSON.stringify(call.arguments || {}).substring(0, 80));
      }
      MONITOR.ui.updateToolChainProgress(i + 1, total, call.name, 'exec');
      var result = await MONITOR.coordinator.executeToolCall(call, mode);
      results.push(result);
      var statusIcon = result.success ? '✓' : (result.blocked ? '⊘' : '✗');
      if (typeof logPanel === 'function') {
        logPanel(result.success ? 'success' : 'error',
          statusIcon + ' ' + call.name + ': ' + (result.success ? '成功' : '失败 - ' + (result.error || '未知错误').substring(0, 80)));
      }
      MONITOR.ui.updateToolChainProgress(i + 1, total, call.name, statusIcon);

      if (result.blocked || result.denied) {
        MONITOR.ui.notifyState('执行中断', { level: 'warn', message: '工具执行链中断于: ' + call.name });
        break;
      }
    }

    MONITOR.currentRound.executedResults = results;
    return results;
  }
};

// ═══════════════════════════════════════════════════════════
// § 4. Content Parser — 从AI响应中提取工具调用
// ═══════════════════════════════════════════════════════════
MONITOR.parser = {
  parseToolCalls: function(text) { return parseToolCalls(text); },
  parseSingleCall: function(rawTag) { return parseSingleCall(rawTag); },

  getLatestAIText: function() {
    if (typeof getLatestAIMessageText === 'function') {
      var txt = getLatestAIMessageText();
      if (txt && txt.length > 0) return txt;
    }

    var selectors = [
      'div[class*="assistant"]',
      'div[class*="response"]', 'div[class*="markdown"]', 'div[class*="prose"]'
    ];
    var best = '';
    for (var s = 0; s < selectors.length; s++) {
      var els = document.querySelectorAll(selectors[s]);
      for (var e = els.length - 1; e >= 0; e--) {
        if (els[e].closest('.ds-think-content')) continue;
        var txt = (els[e].innerText || els[e].textContent || '').trim();
        if (txt.length > 3 && txt.indexOf('## 环境') < 0) { best = txt; break; }
      }
      if (best) break;
    }
    return best;
  },

  detectStreaming: function() {
    if (MONITOR.sse.enabled) {
      var sse = MONITOR.sse;
      var now = Date.now();
      if (sse.active) return true;
      if (sse.streamEnded) return false;
      if (sse.lastEventTime > 0 && (now - sse.lastEventTime) < SSE_TIMEOUT_MS) {
        return false;
      }
      // SSE 已启用但既不 active 也没 streamEnded — 可能 stream_end 事件丢失
      // 如果距离最后事件已超过阈值，认为流已结束
      if (sse.lastEventTime > 0 && (now - sse.lastEventTime) >= SSE_TIMEOUT_MS) {
        sse.streamEnded = true;
        return false;
      }
    }
    if (typeof detectStreaming === 'function') return detectStreaming();
    return false;
  },

  wasSendButtonReturnedToArrow: function() {
    if (typeof wasSendButtonJustReturnedToArrow === 'function') return wasSendButtonJustReturnedToArrow();
    return false;
  }
};

// ═══════════════════════════════════════════════════════════
// § 5. State Machine — 轮询状态机与工具调用处理
// ═══════════════════════════════════════════════════════════
function countUserMessages() {
  var all = document.querySelectorAll('div.ds-message');
  var count = 0;
  for (var i = 0; i < all.length; i++) {
    if (!all[i].querySelector('.ds-assistant-message-main-content')) {
      var txt = (all[i].innerText || all[i].textContent || '').trim();
      if (txt.indexOf('<tool_response') >= 0) continue;
      if (txt.indexOf('原始任务:') >= 0) continue;
      if (txt.indexOf('正在思考') === 0) continue;
      if (txt.length > 0) count++;
    }
  }
  return count;
}

function getLatestUserText() {
  try {
    return typeof getLatestUserMessageText === 'function'
      ? getLatestUserMessageText()
      : '';
  } catch(e) { return ''; }
}

var _monitorStartMsgCount = 0;
var _lastDetectedUserText = '';

MONITOR.observer = {
  start: function() {
    MONITOR.state = 'listening';
    MONITOR.currentRound = { toolCalls: [], executedResults: [], aiMessageText: '', startTime: Date.now() };
    MONITOR.lastAiText = '';
    MONITOR.stableCount = 0;
    MONITOR.aiStarted = false;
    MONITOR._pollCount = 0;
    MONITOR._toolChainIterations = 0;
    MONITOR._noToolCallWaitCount = 0;
    MONITOR._aiDoneLogged = false;

    _monitorStartMsgCount = countUserMessages();
    _lastDetectedUserText = getLatestUserText();

    if (MONITOR.sse.enabled) {
      MONITOR.sse.streamEnded = false;
      MONITOR.sse.endText = '';
    }

    MONITOR.processMarker = typeof getLatestAIMessageText === 'function'
      ? { text: getLatestAIMessageText(), time: Date.now() }
      : { text: '', time: Date.now() };

    MONITOR.ui.updatePanelStatus('监听中...');
    MONITOR.ui.notifyState('监听中', { level: 'info', message: '已启动实时监控' + (MONITOR.sse.enabled ? ' (SSE模式)' : ' (DOM轮询模式)') });
    MONITOR.observer.poll();
  },

  stop: function(reason) {
    MONITOR.state = 'idle';
    if (MONITOR.pollTimer) {
      clearTimeout(MONITOR.pollTimer);
      MONITOR.pollTimer = null;
    }
    if (MONITOR._resumeTimer) {
      clearTimeout(MONITOR._resumeTimer);
      MONITOR._resumeTimer = null;
    }
    MONITOR.aiStarted = false;
    MONITOR.stableCount = 0;
    MONITOR.processMarker = null;
    if (MONITOR.sse.enabled) {
      MONITOR.sse.streamEnded = false;
    }
    _monitorStartMsgCount = countUserMessages();
    MONITOR.ui.updatePanelStatus('已停止' + (reason ? ' (' + reason + ')' : ''));
  },

  poll: function() {
    if (MONITOR.state === 'idle') return;

    MONITOR._pollCount++;

    // ─── SSE 缓存优先: 如果 SSE 已检测到工具调用，直接执行 ───
    if (MONITOR._sseToolCalls && MONITOR._sseToolCalls.length > 0) {
      var cachedCalls = MONITOR._sseToolCalls;
      var cachedText = MONITOR._sseToolCallText;
      MONITOR._sseToolCalls = null;
      MONITOR._sseToolCallText = null;

      if (MONITOR.pollTimer) { clearTimeout(MONITOR.pollTimer); MONITOR.pollTimer = null; }
      MONITOR.state = 'ai_done';
      MONITOR.currentRound.toolCalls = cachedCalls;
      MONITOR.currentRound.aiMessageText = cachedText || '';
      if (typeof logPanel === 'function') {
        logPanel('info', '🔧 轮询发现SSE缓存工具调用，直接执行: ' +
          cachedCalls.map(function(c) { return c.name; }).join(', '));
      }
      MONITOR.observer.handleToolCalls(cachedCalls);
      return;
    }

    var aiText = MONITOR.parser.getLatestAIText();
    var isStreaming = MONITOR.parser.detectStreaming();

    // 心跳: 每50轮打印状态
    if (MONITOR._pollCount % 50 === 0 && typeof logPanel === 'function') {
      var isTextNew = (aiText !== MONITOR.lastAiText);
      logPanel('info', '♥ poll#' + MONITOR._pollCount +
        ' state=' + MONITOR.state + ' aiLen=' + aiText.length +
        ' started=' + MONITOR.aiStarted + ' stable=' + MONITOR.stableCount +
        ' new=' + isTextNew);
    }

    // ─── 状态驱动调度 ───
    var shouldReturn = false;
    switch (MONITOR.state) {
      case 'listening':
        shouldReturn = MONITOR.observer._handleIdleState(aiText, isStreaming);
        break;
      case 'ai_streaming':
        shouldReturn = MONITOR.observer._handleAIStreamingState(aiText, isStreaming);
        break;
      case 'ai_done':
        shouldReturn = MONITOR.observer._handleAIDoneState(aiText);
        break;
      case 'executing_tools':
        shouldReturn = MONITOR.observer._handleExecutingToolsState();
        break;
    }

    if (!shouldReturn) {
      MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
    }
  },

  // ── §5 子函数: listening 状态处理 ──────────────────────────
  _handleIdleState: function(aiText, isStreaming) {
    var isTextNew = (aiText !== MONITOR.lastAiText);
    if (!isTextNew) return false;

    // 如果 SSE 已检测到工具调用，不要让 DOM 文本差异重置 stableCount
    if (MONITOR._sseToolCalls && MONITOR._sseToolCalls.length > 0) {
      MONITOR.lastAiText = aiText; // 同步为 DOM 文本避免循环
      return false;
    }

    MONITOR.lastAiText = aiText;
    MONITOR._noToolCallWaitCount = 0;
    if (aiText.length > 3) {
      MONITOR.stableCount = 0;

      if (!MONITOR.aiStarted) {
        MONITOR.aiStarted = true;
        MONITOR.state = 'ai_streaming';
        MONITOR.ui.updatePanelStatus('AI生成中...');
        var userMsg = typeof getLatestUserMessageText === 'function' ? getLatestUserMessageText() : '';
        if (typeof logPanel === 'function' && userMsg.length > 0 && userMsg.indexOf('正在思考') !== 0) {
          logPanel('info', '📤 用户消息(' + userMsg.length + '字): "' + userMsg.substring(0, 100) + '"');
        } else if (typeof logPanel === 'function' && userMsg.length === 0) {
          logPanel('info', '📤 用户消息(0字，可能是工具回填消息)');
        }
      }
    }
    return false;
  },

  // ── §5 子函数: ai_streaming 状态处理 ──────────────────────
  _handleAIStreamingState: function(aiText, isStreaming) {
    var isTextNew = (aiText !== MONITOR.lastAiText);

    if (isTextNew) {
      MONITOR.lastAiText = aiText;
      MONITOR._noToolCallWaitCount = 0;
      if (aiText.length > 3) {
        MONITOR.stableCount = 0;
      }
      return false;
    }

    // 文本没变化，递增稳定计数
    // 注意: DOM innerText 可能丢失 <tool_call 标签内容导致 aiText 很短，
    // 但 SSE 已结束且 aiStarted=true 时仍应递增 stableCount
    MONITOR.stableCount++;

    if (MONITOR.stableCount < MONITOR.config.stableThreshold) {
      return false;
    }

    // ═══════════════════════════════════════════════════════
    // 关键守卫: 流式输出必须确认已结束 (send button = arrow)
    // 专家模式思考阶段可能有长停顿，stableCount 会提前达标，
    // 此时绝不能判定为"已完成"，必须等流式真正结束。
    // ═══════════════════════════════════════════════════════
    if (isStreaming) {
      if (MONITOR.stableCount % 10 === 0 && typeof logPanel === 'function') {
        logPanel('info', '⏳ 流式仍在进行 (' + MONITOR.stableCount + '轮不变)，等待完成...');
      }
      return false;
    }

    // AI 已完成 — 转移到 ai_done 状态
    MONITOR.state = 'ai_done';
    MONITOR.ui.updatePanelStatus('AI已完成');
    // 只在首次稳定时记录日志，避免重复
    if (MONITOR._aiDoneLogged !== true) {
      MONITOR._aiDoneLogged = true;
      if (typeof logPanel === 'function') {
        logPanel('info', '✅ AI回复稳定 (' + aiText.length + '字, 流式已结束)');
      }
    }

    // 委托给 ai_done 处理器
    return MONITOR.observer._handleAIDoneState(aiText);
  },

  // ── §5 子函数: ai_done 状态处理 ───────────────────────────
  _handleAIDoneState: function(aiText) {
    // 优先使用 SSE 原始文本解析工具调用（DOM innerText 会丢失 <tool_call 标签名）
    var textForParsing = MONITOR._sseToolCallText || MONITOR.sse.endText || aiText;
    var toolCalls = MONITOR.parser.parseToolCalls(textForParsing);

    // 清理 SSE 缓存
    MONITOR._sseToolCalls = null;
    MONITOR._sseToolCallText = null;

    if (toolCalls.length > 0) {
      MONITOR._preToolAiText = aiText;
      MONITOR.currentRound.toolCalls = toolCalls;
      MONITOR.currentRound.aiMessageText = aiText;
      if (typeof logPanel === 'function') {
        logPanel('info', '🔧 工具调用: ' +
          toolCalls.map(function(c) { return c.name + ' ' + JSON.stringify(c.arguments).substring(0, 60); }).join(', '));
      }
      MONITOR.ui.notifyState('检测到工具调用', {
        level: 'info',
        message: '检测到 ' + toolCalls.length + ' 个工具调用: ' + toolCalls.map(function(c) { return c.name; }).join(', ')
      });
      MONITOR.observer.handleToolCalls(toolCalls);
      return true; // handleToolCalls 管理后续轮询
    }

    if (aiText.indexOf('<tool_response') >= 0) {
      if (typeof logPanel === 'function') {
        logPanel('info', '🔄 检测到工具回填消息，继续等待AI处理...');
      }
      MONITOR.state = 'listening';
      MONITOR.lastAiText = '';
      MONITOR.stableCount = 0;
      MONITOR.aiStarted = false;
      MONITOR._noToolCallWaitCount = 0;
      return false; // 继续轮询 listening 状态
    }

    if (!MONITOR._noToolCallWaitCount) MONITOR._noToolCallWaitCount = 0;

    if (MONITOR._noToolCallWaitCount < 15) {
      MONITOR._noToolCallWaitCount++;
      if (MONITOR._noToolCallWaitCount === 1 && typeof logPanel === 'function') {
        logPanel('info', '⏸ 无工具调用，二次确认等待中... (文本' + aiText.length + '字, 最多等3秒)');
      }
      return false; // 继续轮询等待确认
    }

    MONITOR._noToolCallWaitCount = 0;

    if (typeof logPanel === 'function') {
      logPanel('info', '💬 普通文本: "' + aiText.substring(0, 150).replace(/\n/g, ' ') + '"');
    }
    MONITOR.ui.notifyState('无工具调用', { level: 'info', message: 'AI 未请求工具调用，对话轮次结束，监控已停止' });
    MONITOR.observer.stop('轮次结束');
    if (typeof autoMode !== 'undefined') autoMode = false;
    MONITOR.ui.updatePanelStatus('就绪');
    return true; // 停止轮询
  },

  // ── §5 子函数: executing_tools 状态处理 ────────────────────
  _handleExecutingToolsState: function() {
    // 工具异步执行中，继续轮询等待状态变化
    return false;
  },

  handleToolCalls: async function(toolCalls) {
    if (typeof logPanel === 'function') {
      logPanel('info', '🔧 开始处理 ' + toolCalls.length + ' 个工具调用: ' +
        toolCalls.map(function(c) { return c.name + '(' + JSON.stringify(c.arguments || {}).substring(0, 40) + ')'; }).join(', '));
    }
    MONITOR.ui.notifyState('处理工具调用', { level: 'info', message: '开始处理 ' + toolCalls.length + ' 个工具调用' });

    try {
      var results = await MONITOR.coordinator.executeAll(toolCalls);

      if (MONITOR.observer._checkCircuitBreaker(toolCalls)) {
        return;
      }

      await MONITOR.observer._injectToolResults(results);
    } catch(e) {
      console.error('[Monitor] handleToolCalls 异常:', e.message);
      if (typeof logPanel === 'function') logPanel('error', '工具调用处理失败: ' + e.message);
      MONITOR.observer.stop('工具执行异常');
      if (typeof autoMode !== 'undefined') autoMode = false;
      if (typeof updateAutoButtonState === 'function') updateAutoButtonState();
      return;
    }
  },

  // ── §5 子函数: 熔断器检查 ─────────────────────────────────
  _checkCircuitBreaker: function(toolCalls) {
    var results = MONITOR.currentRound.executedResults;

    MONITOR._lastExecutedTool = MONITOR._lastExecutedTool || '';
    MONITOR._consecutiveSameTool = MONITOR._consecutiveSameTool || 0;
    MONITOR._consecutiveFailures = MONITOR._consecutiveFailures || 0;
    MONITOR._circuitBreakerTriggered = MONITOR._circuitBreakerTriggered || false;

    var allFailed = true;
    var currentTool = toolCalls[0] ? (toolCalls[0].name || toolCalls[0]) : '';
    for (var ri = 0; ri < results.length; ri++) {
      if (results[ri].success) { allFailed = false; break; }
    }

    if (currentTool === MONITOR._lastExecutedTool) {
      MONITOR._consecutiveSameTool++;
    } else {
      MONITOR._consecutiveSameTool = 1;
      MONITOR._consecutiveFailures = 0;
      MONITOR._lastExecutedTool = currentTool;
    }

    if (allFailed) {
      MONITOR._consecutiveFailures++;
      var maxFails = (typeof DS_CONFIG !== 'undefined' && DS_CONFIG.circuitBreaker && DS_CONFIG.circuitBreaker.maxConsecutiveFails) || 5;
      if (MONITOR._consecutiveFailures >= maxFails) {
        MONITOR._circuitBreakerTriggered = true;
        MONITOR.ui.notifyState('熔断', { level: 'error', message: '工具 ' + currentTool + ' 连续失败 ' + MONITOR._consecutiveFailures + ' 次，已触发熔断' });
        if (typeof logPanel === 'function') logPanel('error', '熔断触发: ' + currentTool + ' 连续失败 ' + MONITOR._consecutiveFailures + ' 次');
        MONITOR.observer.stop('circuit_breaker');
        if (typeof autoMode !== 'undefined') autoMode = false;
        if (typeof updateAutoButtonState === 'function') updateAutoButtonState();
        return true;
      }
    } else {
      MONITOR._consecutiveFailures = 0;
    }

    if (MONITOR._consecutiveSameTool >= (maxFails * 2)) {
      if (typeof logPanel === 'function') logPanel('warn', 'AI 可能陷入重试循环，已请求 ' + currentTool + ' 共 ' + MONITOR._consecutiveSameTool + ' 次');
    }

    return false;
  },

  // ── §5 子函数: 结果注入与恢复 ─────────────────────────────
  _injectToolResults: async function(results) {
    window.postMessage({
      type: '__ds_tool_results',
      toolCalls: MONITOR.currentRound.toolCalls,
      results: results.map(function(r) { return { tool: r.tool || r.name, success: r.success, error: r.error || undefined }; }),
      round: MONITOR._toolChainIterations + 1,
      timestamp: Date.now()
    }, '*');

    var injected = await MONITOR.injector.injectResults(results);
    if (injected) {
      MONITOR.ui.notifyState('结果已注入', { level: 'success', message: '工具执行结果已注入，等待AI后续响应' });
    }

    if (MONITOR._resumeTimer) clearTimeout(MONITOR._resumeTimer);

    MONITOR._toolChainIterations++;
    if (MONITOR._toolChainIterations > MONITOR.config.maxToolIterations) {
      if (typeof logPanel === 'function') logPanel('warn', '工具链已达最大迭代次数 (' + MONITOR._toolChainIterations + ')，自动停止');
      MONITOR.observer.stop('超限');
      if (typeof autoMode !== 'undefined') autoMode = false;
      if (typeof updateAutoButtonState === 'function') updateAutoButtonState();
      return;
    }

    MONITOR._resumeTimer = setTimeout(function() {
      MONITOR._resumeTimer = null;
      MONITOR.lastAiText = MONITOR._preToolAiText || '';
      MONITOR.stableCount = 0;
      MONITOR.aiStarted = false;
      MONITOR.currentRound.toolCalls = [];
      MONITOR.currentRound.executedResults = [];
      MONITOR.state = 'listening';
      MONITOR._noToolCallWaitCount = 0;
      MONITOR._preToolAiText = null;
    MONITOR._consecutiveSameTool = 0;
    MONITOR._consecutiveFailures = 0;
    MONITOR._circuitBreakerTriggered = false;

    var dotsEl = document.getElementById('__ds-chain-dots');
    if (dotsEl) dotsEl.innerHTML = '';

    MONITOR.observer.poll();
    }, MONITOR.config.autoResumeTimeout);
  }
};

window.__ds_startMonitor = function() {
  MONITOR.observer.start();
};
window.__ds_stopMonitor = function() {
  MONITOR.observer.stop('手动停止');
  if (typeof autoMode !== 'undefined') autoMode = false;
  if (typeof autoWatchRunning !== 'undefined') autoWatchRunning = false;
  if (typeof updateAutoButtonState === 'function') updateAutoButtonState();
};
window.__ds_getMonitorState = function() {
  return MONITOR.state;
};
window.__ds_refreshToolModes = function() {
  MONITOR.toolModesLoaded = false;
};
window.__ds_monitor = MONITOR;

// Sync monitor state to MAIN world via postMessage (for Playwright/CDP access)
function syncMonitorToMainWorld() {
  window.postMessage({
    type: '__ds_monitor_state_sync',
    payload: {
      state: MONITOR.state,
      autoWatch: !!MONITOR.autoWatch,
      toolCalls: MONITOR.currentRound ? (MONITOR.currentRound.toolCalls || []).length : 0,
      toolNames: MONITOR.currentRound ? (MONITOR.currentRound.tools || []).slice(0, 10) : [],
      execResults: MONITOR.currentRound ? (MONITOR.currentRound.executedResults || []).length : 0
    }
  }, '*');
}
setInterval(syncMonitorToMainWorld, 2000);
syncMonitorToMainWorld();

// Monitor 状态超时保护：如果卡在 ai_streaming/executing_tools 超过 180 秒，自动恢复
var _monitorStateTimestamp = Date.now();
var _lastMonitorState = MONITOR.state;
setInterval(function() {
  if (MONITOR.state !== _lastMonitorState) {
    _lastMonitorState = MONITOR.state;
    _monitorStateTimestamp = Date.now();
  }

  var stuckMs = Date.now() - _monitorStateTimestamp;
  if ((MONITOR.state === 'ai_streaming' || MONITOR.state === 'executing_tools') && stuckMs > MONITOR_STATE_TIMEOUT) {
    console.warn('[Monitor] 状态卡在 ' + MONITOR.state + ' 超过 ' + Math.round(stuckMs/1000) + 's，强制恢复');
    if (typeof logPanel === 'function') {
      logPanel('warn', '⚠️ Monitor 状态超时，自动恢复 (stuck in ' + MONITOR.state + ' for ' + Math.round(stuckMs/1000) + 's)');
    }
    if (MONITOR.pollTimer) { clearTimeout(MONITOR.pollTimer); MONITOR.pollTimer = null; }
    if (MONITOR._resumeTimer) { clearTimeout(MONITOR._resumeTimer); MONITOR._resumeTimer = null; }
    MONITOR.state = 'idle';
    MONITOR.aiStarted = false;
    MONITOR.stableCount = 0;
    MONITOR._sseToolCalls = null;
    MONITOR._sseToolCallText = null;
    MONITOR.sse.active = false;
    MONITOR.ui.updatePanelStatus('就绪（超时恢复）');
  }
}, 10000);

window.addEventListener('message', function(event) {
  if (!event.data || typeof event.data !== 'object') return;

  var data = event.data;

  if (data.type === '__ds_auto_tool_calls' && data.toolCalls && data.toolCalls.length > 0) {
    MONITOR.observer.handleToolCalls(data.toolCalls);
  }

  if (data.type === '__ds_auto_no_tool_calls') {
    MONITOR.ui.notifyState('任务完成', { level: 'success', message: 'AI 不再请求工具调用' });
    MONITOR.state = 'idle';
    MONITOR.ui.updatePanelStatus('就绪');
  }

  if (data.type === '__ds_test_query_state') {
    window.postMessage({
      type: '__ds_test_state_response',
      state: MONITOR.state,
      pollCount: MONITOR._pollCount || 0,
      stableCount: MONITOR.stableCount || 0,
      aiStarted: MONITOR.aiStarted || false,
      lastAiTextLen: (MONITOR.lastAiText || '').length,
      toolChainIterations: MONITOR._toolChainIterations || 0,
      noToolCallWaitCount: MONITOR._noToolCallWaitCount || 0,
      currentRoundToolCalls: (MONITOR.currentRound && MONITOR.currentRound.toolCalls) ? MONITOR.currentRound.toolCalls.length : 0,
      currentRoundExecResults: (MONITOR.currentRound && MONITOR.currentRound.executedResults) ? MONITOR.currentRound.executedResults.length : 0,
      sseEnabled: MONITOR.sse ? MONITOR.sse.enabled : false,
      sseActive: MONITOR.sse ? MONITOR.sse.active : false,
      sseEndTextLen: MONITOR.sse ? (MONITOR.sse.endText || '').length : 0,
      sseEndTextPreview: MONITOR.sse ? (MONITOR.sse.endText || '').substring(0, 100) : '',
      sseStreamEnded: MONITOR.sse ? MONITOR.sse.streamEnded : false,
      _sseToolCalls: MONITOR._sseToolCalls ? MONITOR._sseToolCalls.length : 0,
      pollTimer: !!MONITOR.pollTimer,
      autoWatchRunning: typeof autoWatchRunning !== 'undefined' ? autoWatchRunning : 'UNDEFINED'
    }, '*');
  }

  if (data.type === '__ds_test_start_monitor') {
    MONITOR.observer.start();
    window.postMessage({ type: '__ds_test_state_response', state: MONITOR.state, action: 'started' }, '*');
  }

  if (data.type === '__ds_test_stop_monitor') {
    MONITOR.observer.stop('test_stop');
    window.postMessage({ type: '__ds_test_state_response', state: MONITOR.state, action: 'stopped' }, '*');
  }
});


// ═══════════════════════════════════════════════════════════
// § 6. SSE Event Handler — 监听 injected.js 发出的 SSE 流事件
// ═══════════════════════════════════════════════════════════
window.addEventListener('message', function(event) {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.source !== 'ai-tool-agent' && event.data.source !== 'deepseek-tool-agent') return;

  switch (event.data.type) {
    case '__ds_stream_start':
      MONITOR.sse.enabled = true;
      MONITOR.sse.active = true;
      MONITOR.sse.streamEnded = false;
      MONITOR.sse.accumulatedText = '';
      MONITOR.sse.endText = '';
      MONITOR.sse.lastEventTime = Date.now();

      if (typeof updateSSEIndicator === 'function') updateSSEIndicator(true);

      // 无论 autoWatchRunning 状态如何，都重置并启动 Monitor
      // 防止长时间不使用后 autoWatchRunning 为 false 导致监控不启动
      if (typeof autoWatchRunning !== 'undefined') {
        autoWatchRunning = true;
      }

      if (MONITOR.state !== 'idle') {
        if (MONITOR.pollTimer) { clearTimeout(MONITOR.pollTimer); MONITOR.pollTimer = null; }
        if (MONITOR._resumeTimer) { clearTimeout(MONITOR._resumeTimer); MONITOR._resumeTimer = null; }
        MONITOR.state = 'idle';
        MONITOR.aiStarted = false;
        MONITOR.stableCount = 0;
        _monitorStuckSince = 0;
      }
      MONITOR.observer.start();
      break;

    case '__ds_stream_chunk':
      MONITOR.sse.active = true;
      MONITOR.sse.accumulatedText = event.data.fullText || '';
      MONITOR.sse.lastEventTime = Date.now();
      break;

    case '__ds_stream_end':
      MONITOR.sse.active = false;
      MONITOR.sse.streamEnded = true;
      MONITOR.sse.endText = event.data.text || '';
      MONITOR.sse.lastEventTime = Date.now();

      if (typeof updateSSEIndicator === 'function') updateSSEIndicator(false);

      // SSE 原始文本包含 <tool_call 标签（DOM innerText 会丢失标签名）
      // 无论 monitor 当前状态如何，只要 SSE 有文本就尝试解析工具调用
      if (MONITOR.sse.endText) {
        MONITOR.lastAiText = MONITOR.sse.endText;
        MONITOR.aiStarted = true;
        MONITOR.stableCount = MONITOR.config.stableThreshold;

        // 立即从 SSE 原始文本解析工具调用
        var sseToolCalls = MONITOR.parser.parseToolCalls(MONITOR.sse.endText);
        if (sseToolCalls.length > 0) {
          MONITOR._sseToolCalls = sseToolCalls;
          MONITOR._sseToolCallText = MONITOR.sse.endText;

          // 不停止轮询！让轮询自己检测到 _sseToolCalls 并执行
          // 强制推进状态，确保轮询能进入 stableCount 检查
          if (MONITOR.state === 'listening' || MONITOR.state === 'idle') {
            MONITOR.state = 'ai_streaming';
          }

          // 如果轮询没在运行，立即启动
          if (!MONITOR.pollTimer && MONITOR.state !== 'idle') {
            MONITOR.observer.poll();
          }
        }
      }
      break;

    case '__ds_heartbeat_injected_ack':
      break;
  }
});

// ═══════════════════════════════════════════════════════════
// § 7. Extension Context Guard — 扩展上下文守卫
// ═══════════════════════════════════════════════════════════
(function() {
  var _contextValid = true;

  function hasLiveExtensionContext() {
    if (!_contextValid) return false;
    try {
      if (typeof chrome === 'undefined') return false;
      var rt = chrome.runtime;
      return Boolean(rt && rt.id) && typeof rt.sendMessage === 'function';
    } catch (e) {
      _contextValid = false;
      return false;
    }
  }

  window.__ds_hasLiveContext = hasLiveExtensionContext;

  window.addEventListener('unhandledrejection', function(event) {
    if (hasExtensionInvalidatedError(event.reason)) {
      _contextValid = false;
      event.preventDefault();
    }
  });

  function hasExtensionInvalidatedError(err) {
    var msg = err instanceof Error ? err.message : String(err);
    return msg.indexOf('Extension context invalidated') >= 0 ||
           msg.indexOf('context invalidated') >= 0;
  }
})();

(function() {
  // ═══════════════════════════════════════════════════════════
  // § 8. User Message Detection — 用户消息检测与自动启动
  // ═══════════════════════════════════════════════════════════
  var lastUserMsgCount = 0;

  // countUserMessages, getLatestUserText, _lastDetectedUserText, _monitorStartMsgCount
  // 已提取到全局作用域，此处直接使用全局变量

  function checkForNewUserMessage() {
    if (MONITOR.state !== 'idle') {
      return;
    }
    if (typeof autoWatchRunning === 'undefined' || !autoWatchRunning) {
      return;
    }

    var currentCount = countUserMessages();
    var currentText = getLatestUserText();

    var countChanged = currentCount > _monitorStartMsgCount;
    var textChanged = currentText && currentText !== _lastDetectedUserText;

    if (countChanged || textChanged) {
      _monitorStartMsgCount = currentCount;
      _lastDetectedUserText = currentText;
      lastUserMsgCount = currentCount;
      if (typeof logPanel === 'function') logPanel('info', '检测到用户新消息，自动启动监控');
      MONITOR.observer.start();
    }
  }

  setInterval(checkForNewUserMessage, 1000);

  var _visibilityFired = 0;
  var _monitorStuckSince = 0;

  function forceCheckVisibility() {
    _visibilityFired++;
    if (typeof logPanel === 'function' && _visibilityFired <= 3) {
      logPanel('info', 'visibility触发检测 #' + _visibilityFired + ' state=' + MONITOR.state + ' autoWatch=' + autoWatchRunning);
    }

    if (MONITOR.state !== 'idle') {
      if (!_monitorStuckSince) {
        _monitorStuckSince = Date.now();
      } else if (Date.now() - _monitorStuckSince > MONITOR_STUCK_TIMEOUT) {
        if (typeof logPanel === 'function') logPanel('warn', 'MONITOR 状态卡死(' + MONITOR.state + ')，强制恢复');
        MONITOR.state = 'idle';
        if (MONITOR.pollTimer) { clearTimeout(MONITOR.pollTimer); MONITOR.pollTimer = null; }
        if (MONITOR._resumeTimer) { clearTimeout(MONITOR._resumeTimer); MONITOR._resumeTimer = null; }
        MONITOR.aiStarted = false;
        MONITOR.stableCount = 0;
        _monitorStuckSince = 0;
      }
    } else {
      _monitorStuckSince = 0;
    }

    checkForNewUserMessage();
  }

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      forceCheckVisibility();
    }
  });

  window.addEventListener('focus', function() {
    forceCheckVisibility();
  });

  window.addEventListener('pageshow', function(e) {
    if (!e.persisted) return;
    forceCheckVisibility();
  });

  // ═══════════════════════════════════════════════════════════
  // § 9. KeepAlive & Service Worker — 长连接保活
  // ═══════════════════════════════════════════════════════════
  var _keepalivePort = null;
  var _keepaliveInterval = null;
  var _keepaliveGeneration = 0;

  function establishKeepAlive() {
    try {
      var gen = ++_keepaliveGeneration;
      if (_keepalivePort) {
        try { _keepalivePort.disconnect(); } catch(e) {}
      }
      _keepalivePort = null;
      var port = chrome.runtime.connect({ name: 'keepAlive' });
      _keepalivePort = port;
      port.onDisconnect.addListener(function() {
        if (_keepalivePort === port) {
          _keepalivePort = null;
        }
        if (gen === _keepaliveGeneration) {
          setTimeout(establishKeepAlive, 3000);
        }
      });
      port.onMessage.addListener(function() {
        // 心跳响应到达，SW 仍然存活
      });

      // SW 重连后验证 injected.js 是否存活
      setTimeout(function() {
        if (gen === _keepaliveGeneration && _keepalivePort === port) {
          verifySSEInjection();
        }
      }, 5000);
    } catch(e) {
      console.warn('[Monitor] KeepAlive 连接失败: ' + e.message);
      _keepalivePort = null;
      setTimeout(establishKeepAlive, 5000);
    }
  }

  function verifySSEInjection() {
    if (typeof autoWatchRunning === 'undefined' || !autoWatchRunning) return;
    // 验证 injected.js 在页面上下文中是否存活
    try {
      window.postMessage({ type: '__ds_heartbeat_injected', timestamp: Date.now() }, '*');
    } catch(e) {
      console.warn('[Monitor] SSE 注入验证失败: ' + e.message);
    }
    // 如果监控之前是收听状态但现在停止了，重新启动
    if (MONITOR.state === 'idle' && typeof autoWatchRunning !== 'undefined' && autoWatchRunning) {
    }
  }

  function sendKeepAlivePing() {
    try {
      if (_keepalivePort) {
        _keepalivePort.postMessage({ type: 'ping', timestamp: Date.now() });
      } else {
        establishKeepAlive();
      }
    } catch(e) {
      _keepalivePort = null;
      establishKeepAlive();
    }
  }

  establishKeepAlive();
  _keepaliveInterval = setInterval(sendKeepAlivePing, 20000);
  // Chrome 允许内容脚本创建长连接端口，SW 只要有活跃端口就不会被终止
  // 20 秒一次心跳 < 30 秒超时阈值

  // ═══════════════════════════════════════════════════════════
  // § 10. MutationObserver — DOM 变动监听
  // ═══════════════════════════════════════════════════════════
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) {
          if (typeof getLatestUserMessageText === 'function') {
            var t = getLatestUserMessageText();
            if (t && t.length > 0) {
              checkForNewUserMessage();
              return;
            }
          }
        }
      }
    }
  });

  var _observedBody = document.body;
  observer.observe(_observedBody, { childList: true, subtree: true });

  setInterval(function() {
    if (document.body !== _observedBody) {
      observer.disconnect();
      _observedBody = document.body;
      observer.observe(_observedBody, { childList: true, subtree: true });
    }
  }, 5000);
})();