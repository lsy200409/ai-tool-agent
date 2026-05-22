// ============================================================
// DeepSeek Tool Agent v2.5 — 实时输入监控模块
//
// 5层架构:
//   Layer 1: DOM Observer — Polling 检测页面流式状态
//   Layer 2: Content Parser — 从AI响应中提取 <tool_call>
//   Layer 3: Tool Coordinator — AUTO/MANUAL/OFF 模式调度
//   Layer 4: Result Injector — 工具结果回注到对话
//   Layer 5: UI Bridge — 与 panel.js 双向通信
//
// 注意: content script 运行在 isolated world，
// 无法直接访问 injected.js 的 window.__* 函数。
// 使用 dom/input.js 和 dom/ai-message.js 中定义的同名全局函数。
// 跨 world 通信通过 window.postMessage。
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
    autoResumeTimeout: 5000
  },

  pollTimer: null,
  stableCount: 0,
  lastAiText: '',
  aiStarted: false,

  toolModes: {},
  toolModesLoaded: false
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
  }
};

// ============================================================
// Layer 4: Result Injector
// 使用 content-script 全局函数 (dom/input.js)
// ============================================================
MONITOR.injector = {
  simplifyResult: function(r) {
    var toolName = r.tool || r.name || '';
    var out = {};
    if (toolName) out.tool = toolName;

    if (r.error) { out.error = r.error; return out; }
    if (r.blocked) { out.blocked = true; out.reason = r.reason || ''; return out; }

    if (toolName === 'read_file') {
      if (r.content) out.content = r.content;
    } else if (toolName === 'write_file' || toolName === 'append_file') {
      // 成功即返回空，status="ok" 已表达
    } else if (toolName === 'list_dir') {
      if (r.files) out.files = r.files.map(function(f) {
        return f.isDirectory ? f.name + '/' : f.name;
      });
    } else if (toolName === 'search_files') {
      if (r.files) out.files = r.files.map(function(f) {
        var parts = f.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1];
      });
    } else if (toolName === 'get_file_info') {
      if (r.info) {
        out.size = r.info.size;
        out.modified = r.info.mtime;
        out.type = r.info.isDirectory ? 'directory' : 'file';
      }
    } else if (toolName === 'exec_command') {
      if (r.stdout && r.stdout.length > 0) out.stdout = r.stdout;
      if (r.stderr && r.stderr.length > 0) out.stderr = r.stderr;
      if ('exitCode' in r && r.exitCode !== 0) out.exitCode = r.exitCode;
    } else {
      // 未知工具/插件: 保留核心字段
      if (r.stdout) out.stdout = r.stdout;
      if (r.stderr) out.stderr = r.stderr;
      if (r.content) out.content = r.content;
      if (r.result) out.result = r.result;
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
        responseText += '请根据以上工具调用结果和用户原始任务继续完成任务，如果已完成则总结汇报。如果工具失败请分析原因并尝试其他方法。';
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
      var resp = await fetch('http://localhost:3002/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: toolName, args: args, mode: mode })
      });
      var data = await resp.json();
      data.tool = toolName;
      if (!('success' in data)) data.success = true;
      return data;
    } catch(e) {
      return { success: false, error: '工具执行失败: ' + e.message, tool: toolName };
    }
  },

  executeAll: async function(toolCalls) {
    MONITOR.state = 'executing_tools';
    var results = [];

    for (var i = 0; i < toolCalls.length; i++) {
      var call = toolCalls[i];
      var mode = MONITOR.coordinator.getToolMode(call.name);
      var result = await MONITOR.coordinator.executeToolCall(call, mode);
      results.push(result);

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
  parseToolCalls: function(text) {
    var toolCalls = [];
    var regex = /<tool_call[\s\S]*?<\/tool_call>/gi;
    var matches = text.match(regex) || [];

    for (var i = 0; i < matches.length; i++) {
      var parsed = MONITOR.parser.parseSingleCall(matches[i]);
      if (parsed) {
        toolCalls.push({ rawTag: matches[i], name: parsed.tool, arguments: parsed.parameters, index: i });
      }
    }
    return toolCalls;
  },

  parseSingleCall: function(rawTag) {
    var nameMatch = rawTag.match(/name\s*=\s*"([^"]*)"/i);
    var toolName = nameMatch ? nameMatch[1] : null;

    var contentMatch = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/i.exec(rawTag);
    if (!contentMatch) return null;

    var content = contentMatch[1].trim();

    try {
      var args = JSON.parse(content);
      if (args.name && args.arguments) return { tool: args.name, parameters: args.arguments };
      if (args.tool && args.parameters) return { tool: args.tool, parameters: args.parameters };
      if (toolName && typeof args === 'object' && Object.keys(args).length > 0) {
        return { tool: toolName, parameters: args };
      }
    } catch(e) {
      var opens = (content.match(/\{/g) || []).length;
      var closes = (content.match(/\}/g) || []).length;
      if (opens > closes) {
        try {
          var fixed = JSON.parse(content + '}'.repeat(opens - closes));
          if (fixed.arguments) return { tool: toolName, parameters: fixed.arguments };
          if (fixed.parameters) return { tool: toolName, parameters: fixed.parameters };
          if (toolName && typeof fixed === 'object' && Object.keys(fixed).length > 0) {
            return { tool: toolName, parameters: fixed };
          }
        } catch(e2) {}
      }
    }

    if (toolName) return { tool: toolName, parameters: {} };
    return null;
  },

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

    MONITOR.ui.updatePanelStatus('监听中...');
    MONITOR.ui.notifyState('监听中', { level: 'info', message: '已启动实时监控 (200ms轮询, 纯文本驱动)' });
    MONITOR.observer.poll();
  },

  stop: function() {
    MONITOR.state = 'idle';
    if (MONITOR.pollTimer) {
      clearTimeout(MONITOR.pollTimer);
      MONITOR.pollTimer = null;
    }
    MONITOR.ui.updatePanelStatus('已停止');
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
        MONITOR.state = 'ai_done';
        MONITOR.ui.updatePanelStatus('AI已完成');
        if (typeof logPanel === 'function') {
          logPanel('info', '✅ AI回复稳定 (' + aiText.length + '字, ' + MONITOR.stableCount + '轮不变)');
        }

        var toolCalls = MONITOR.parser.parseToolCalls(aiText);

        if (toolCalls.length > 0) {
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
          if (typeof logPanel === 'function') {
            logPanel('info', '💬 普通文本: "' + aiText.substring(0, 150).replace(/\n/g, ' ') + '"');
          }
          MONITOR.ui.notifyState('无工具调用', { level: 'info', message: 'AI 未请求工具调用，对话轮次结束' });
          MONITOR.state = 'listening';
          MONITOR.aiStarted = false;
          MONITOR.stableCount = 0;
          MONITOR.ui.updatePanelStatus('就绪');
          MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
          return;
        }
      }
    }

    MONITOR.pollTimer = setTimeout(function() { MONITOR.observer.poll(); }, MONITOR.config.pollInterval);
  },

  handleToolCalls: async function(toolCalls) {
    MONITOR.ui.notifyState('处理工具调用', { level: 'info', message: '开始处理 ' + toolCalls.length + ' 个工具调用' });

    var results = await MONITOR.coordinator.executeAll(toolCalls);

    var injected = await MONITOR.injector.injectResults(results);
    if (injected) {
      MONITOR.ui.notifyState('结果已注入', { level: 'success', message: '工具执行结果已注入，等待AI后续响应' });
    }

    if (MONITOR._resumeTimer) clearTimeout(MONITOR._resumeTimer);
    MONITOR._resumeTimer = setTimeout(function() {
      MONITOR._resumeTimer = null;
      MONITOR.lastAiText = MONITOR.parser.getLatestAIText();
      MONITOR.stableCount = 0;
      MONITOR.aiStarted = false;
      MONITOR.currentRound.toolCalls = [];
      MONITOR.currentRound.executedResults = [];
      MONITOR.state = 'listening';
      MONITOR.observer.poll();
    }, MONITOR.config.autoResumeTimeout);
  }
};

window.__ds_startMonitor = function() {
  MONITOR.observer.start();
};
window.__ds_stopMonitor = function() {
  MONITOR.observer.stop();
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
});

console.log('[Monitor] 输入监控模块已加载');