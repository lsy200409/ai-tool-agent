// ============================================================
// DeepSeek Tool Agent v2.6 — 实时输入监控模块
//
// 5层架构:
//   Layer 0: SSE Stream Intercept — 网络层实时感知流状态 (NEW)
//   Layer 1: DOM Observer — Polling 检测页面流式状态 (fallback)
//   Layer 2: Content Parser — 从AI响应中提取 <tool_call>
//   Layer 3: Tool Coordinator — AUTO/MANUAL/OFF 模式调度
//   Layer 4: Result Injector — 工具结果回注到对话
//   Layer 5: UI Bridge — 与 panel.js 双向通信
// ============================================================

var MONITOR = {
  state: 'idle',

  currentRound: {
    toolCalls: [],
    executedResults: [],
    aiMessageText: '',
    startTime: 0
  },

  config: {
    pollInterval: 200,
    maxWaitTime: 90000,
    stableThreshold: 5,
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

// ============================================================
// Layer 5: UI Bridge
// ============================================================
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

// ============================================================
// Layer 4: Result Injector
// 使用 content-script 全局函数 (dom/input.js)
// ============================================================
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
    if (data.blocked) { out.blocked = true; out.reason = data.reason || ''; return out; }

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
      if (!input) { resolve(false); return; }

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

      try {
        if (typeof setInputValue === 'function') setInputValue(input, responseText);
        else input.value = responseText;
        setTimeout(function() {
          if (typeof clickSendButton === 'function') clickSendButton();
          else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          resolve(true);
        }, 300);
      } catch(e) {
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

// ============================================================
// Layer 3: Tool Coordinator
// ============================================================
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
      return result;
    } catch(e) {
      return { success: false, error: '工具执行失败: ' + e.message, tool: toolName };
    }
  },

  executeAll: async function(toolCalls) {
    MONITOR.state = 'executing_tools';
    var results = [];
    var total = toolCalls.length;

    for (var i = 0; i < toolCalls.length; i++) {
      var call = toolCalls[i];
      var mode = MONITOR.coordinator.getToolMode(call.name);
      MONITOR.ui.updateToolChainProgress(i + 1, total, call.name, 'exec');
      var result = await MONITOR.coordinator.executeToolCall(call, mode);
      results.push(result);
      var statusIcon = result.success ? '✓' : (result.blocked ? '⊘' : '✗');
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

// ============================================================
// Layer 2: Content Parser
// 使用 content-script 全局函数 (dom/ai-message.js)
// ============================================================
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
      if (sse.lastEventTime > 0 && (now - sse.lastEventTime) < 5000) {
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

// ============================================================
// Layer 1: DOM Observer + State Machine
// ============================================================
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
    MONITOR.ui.updatePanelStatus('已停止' + (reason ? ' (' + reason + ')' : ''));
  },

  poll: function() {
    if (MONITOR.state === 'idle') return;

    MONITOR._pollCount++;
    var aiText = MONITOR.parser.getLatestAIText();
    var isTextNew = (aiText !== MONITOR.lastAiText);

    // 心跳: 每50轮打印状态
    if (MONITOR._pollCount % 50 === 0 && typeof logPanel === 'function') {
      logPanel('info', '♥ poll#' + MONITOR._pollCount +
        ' state=' + MONITOR.state + ' aiLen=' + aiText.length +
        ' started=' + MONITOR.aiStarted + ' stable=' + MONITOR.stableCount +
        ' new=' + isTextNew);
    }

    // ─── 文本驱动状态机 ───
    if (isTextNew) {
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
    } else if (MONITOR.aiStarted && aiText.length > 3) {
      // 文本没变化，递增稳定计数
      MONITOR.stableCount++;

      if (MONITOR.stableCount >= MONITOR.config.stableThreshold) {
        // ═══════════════════════════════════════════════════════
        // 关键守卫: 流式输出必须确认已结束 (send button = arrow)
        // 专家模式思考阶段可能有长停顿，stableCount 会提前达标，
        // 此时绝不能判定为"已完成"，必须等流式真正结束。
        // ═══════════════════════════════════════════════════════
        var isStreaming = MONITOR.parser.detectStreaming();
        if (isStreaming) {
          if (MONITOR.stableCount % 10 === 0 && typeof logPanel === 'function') {
            logPanel('info', '⏳ 流式仍在进行 (' + MONITOR.stableCount + '轮不变)，等待完成...');
          }
          MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
          return;
        }

        MONITOR.state = 'ai_done';
        MONITOR.ui.updatePanelStatus('AI已完成');
        if (typeof logPanel === 'function') {
          logPanel('info', '✅ AI回复稳定 (' + aiText.length + '字, ' + MONITOR.stableCount + '轮不变, 流式已结束)');
        }

        var toolCalls = MONITOR.parser.parseToolCalls(aiText);

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
          return;
        } else {
          if (aiText.indexOf('<tool_response') >= 0) {
            if (typeof logPanel === 'function') {
              logPanel('info', '🔄 检测到工具回填消息，继续等待AI处理...');
            }
            MONITOR.state = 'listening';
            MONITOR.lastAiText = '';
            MONITOR.stableCount = 0;
            MONITOR.aiStarted = false;
            MONITOR._noToolCallWaitCount = 0;
            MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
            return;
          }

          if (!MONITOR._noToolCallWaitCount) MONITOR._noToolCallWaitCount = 0;

          if (MONITOR._noToolCallWaitCount < 15) {
            MONITOR._noToolCallWaitCount++;
            if (MONITOR._noToolCallWaitCount === 1 && typeof logPanel === 'function') {
              logPanel('info', '⏸ 无工具调用，二次确认等待中... (文本' + aiText.length + '字, 最多等3秒)');
            }
            MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
            return;
          }

          MONITOR._noToolCallWaitCount = 0;

          if (typeof logPanel === 'function') {
            logPanel('info', '💬 普通文本: "' + aiText.substring(0, 150).replace(/\n/g, ' ') + '"');
          }
          MONITOR.ui.notifyState('无工具调用', { level: 'info', message: 'AI 未请求工具调用，对话轮次结束，监控已停止' });
          MONITOR.observer.stop('轮次结束');
          if (typeof autoMode !== 'undefined') autoMode = false;
          MONITOR.ui.updatePanelStatus('就绪');
          return;
        }
      }
    }

    MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
  },

  handleToolCalls: async function(toolCalls) {
    MONITOR.ui.notifyState('处理工具调用', { level: 'info', message: '开始处理 ' + toolCalls.length + ' 个工具调用' });

    try {
      var results = await MONITOR.coordinator.executeAll(toolCalls);

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
        console.log('[Monitor] 连续失败: ' + MONITOR._consecutiveFailures + '/' + DS_CONFIG.circuitBreaker.maxConsecutiveFails + ' 工具=' + currentTool);
        if (MONITOR._consecutiveFailures >= DS_CONFIG.circuitBreaker.maxConsecutiveFails) {
          MONITOR._circuitBreakerTriggered = true;
          MONITOR.ui.notifyState('熔断', { level: 'error', message: '工具 ' + currentTool + ' 连续失败 ' + MONITOR._consecutiveFailures + ' 次，已触发熔断' });
          if (typeof logPanel === 'function') logPanel('error', '熔断触发: ' + currentTool + ' 连续失败 ' + MONITOR._consecutiveFailures + ' 次');
          MONITOR.observer.stop('circuit_breaker');
          if (typeof autoMode !== 'undefined') autoMode = false;
          if (typeof updateAutoButtonState === 'function') updateAutoButtonState();
          return;
        }
      } else {
        MONITOR._consecutiveFailures = 0;
      }

      if (MONITOR._consecutiveSameTool >= (DS_CONFIG.circuitBreaker.maxConsecutiveFails * 2)) {
        console.log('[Monitor] AI 重复请求同一工具 ' + MONITOR._consecutiveSameTool + ' 次，可能陷入重试循环');
        if (typeof logPanel === 'function') logPanel('warn', 'AI 可能陷入重试循环，已请求 ' + currentTool + ' 共 ' + MONITOR._consecutiveSameTool + ' 次');
      }

      window.postMessage({
        type: '__ds_tool_results',
        toolCalls: toolCalls,
        results: results.map(function(r) { return { tool: r.tool || r.name, success: r.success, error: r.error || undefined }; }),
        round: MONITOR._toolChainIterations + 1,
        timestamp: Date.now()
      }, '*');

      var injected = await MONITOR.injector.injectResults(results);
      if (injected) {
        MONITOR.ui.notifyState('结果已注入', { level: 'success', message: '工具执行结果已注入，等待AI后续响应' });
      }
    } catch(e) {
      console.error('[Monitor] handleToolCalls 异常:', e.message);
      if (typeof logPanel === 'function') logPanel('error', '工具调用处理失败: ' + e.message);
      MONITOR.observer.stop('工具执行异常');
      if (typeof autoMode !== 'undefined') autoMode = false;
      if (typeof updateAutoButtonState === 'function') updateAutoButtonState();
      return;
    }

    if (MONITOR._resumeTimer) clearTimeout(MONITOR._resumeTimer);

    MONITOR._toolChainIterations++;
    if (MONITOR._toolChainIterations > MONITOR.config.maxToolIterations) {
      console.log('[Monitor] 工具链已达最大迭代 (' + MONITOR._toolChainIterations + ')，停止');
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
      currentRoundExecResults: (MONITOR.currentRound && MONITOR.currentRound.executedResults) ? MONITOR.currentRound.executedResults.length : 0
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

console.log('[Monitor] 输入监控模块已加载 (v2.6 SSE模式)');

// ============================================================
// Layer 0: SSE Stream Event Handlers
// 监听 injected.js 发出的 SSE 流事件
// ============================================================
window.addEventListener('message', function(event) {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.source !== 'deepseek-tool-agent') return;

  switch (event.data.type) {
    case '__ds_stream_start':
      MONITOR.sse.enabled = true;
      MONITOR.sse.active = true;
      MONITOR.sse.streamEnded = false;
      MONITOR.sse.accumulatedText = '';
      MONITOR.sse.endText = '';
      MONITOR.sse.lastEventTime = Date.now();

      if (typeof updateSSEIndicator === 'function') updateSSEIndicator(true);

      if (MONITOR.state === 'idle' && typeof autoWatchRunning !== 'undefined' && autoWatchRunning) {
        MONITOR.observer.start();
      }
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

      if (MONITOR.state === 'ai_streaming') {
        MONITOR.lastAiText = MONITOR.sse.endText;
        MONITOR.stableCount = MONITOR.config.stableThreshold;
      }
      break;
  }
});

// ============================================================
// Extension Context 守卫 (参考 DeepSeek++)
// ============================================================
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
  var lastUserMsgCount = 0;

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

  function checkForNewUserMessage() {
    var current = countUserMessages();

    if (MONITOR.state !== 'idle') {
      lastUserMsgCount = current;
      return;
    }
    if (typeof autoWatchRunning === 'undefined' || !autoWatchRunning) {
      lastUserMsgCount = current;
      return;
    }

    if (current > lastUserMsgCount) {
      lastUserMsgCount = current;
      console.log('[Monitor] 检测到用户新消息 (msg#' + current + ')，自动重启监控');
      if (typeof logPanel === 'function') logPanel('info', '检测到用户新消息，自动启动监控');
      MONITOR.observer.start();
    }
  }

  setInterval(checkForNewUserMessage, 1000);

  // ============================================================
  // SW KeepAlive — 长连接端口防止 Service Worker 被闲置超时终止
  // Chrome MV3 默认 30 秒无消息即终止 SW，此端口保持连接活跃
  // ============================================================
  var _keepalivePort = null;
  var _keepaliveInterval = null;

  function establishKeepAlive() {
    try {
      if (_keepalivePort) {
        try { _keepalivePort.disconnect(); } catch(e) {}
      }
      _keepalivePort = chrome.runtime.connect({ name: 'keepAlive' });
      _keepalivePort.onDisconnect.addListener(function() {
        console.log('[Monitor] KeepAlive 端口断开，3秒后重连');
        _keepalivePort = null;
        setTimeout(establishKeepAlive, 3000);
      });
      _keepalivePort.onMessage.addListener(function(msg) {
        // 心跳响应到达，SW 仍然存活
      });
    } catch(e) {
      console.warn('[Monitor] KeepAlive 连接失败: ' + e.message);
      _keepalivePort = null;
      setTimeout(establishKeepAlive, 5000);
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
      setTimeout(establishKeepAlive, 3000);
    }
  }

  establishKeepAlive();
  _keepaliveInterval = setInterval(sendKeepAlivePing, 20000);
  // Chrome 允许内容脚本创建长连接端口，SW 只要有活跃端口就不会被终止
  // 20 秒一次心跳 < 30 秒超时阈值

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
      console.log('[Monitor] MutationObserver 检测到 document.body 替换，已重新绑定');
    }
  }, 5000);
})();