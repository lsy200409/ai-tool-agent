var __localLogBuffer = [];
var __LOCAL_LOG_MAX = 500;
var __localLogSessionId = Date.now();

function logPanel(level, message) {
  var now = new Date();
  var time = now.toLocaleTimeString();
  var timestamp = now.toISOString();
  var fullMessage = '[' + level.toUpperCase() + '] ' + time + ' ' + message;

  if (level === 'error') console.error('[Agent] ' + fullMessage);
  else if (level === 'warn') console.warn('[Agent] ' + fullMessage);
  else console.log('[Agent] ' + fullMessage);

  saveLocalLog(level, message, time, timestamp);
  sendLogToFile(level, message, timestamp);
  addStageLog(level, '[' + level.toUpperCase() + '] ' + time, message);
}

function saveLocalLog(level, message, time, timestamp) {
  try {
    var entry = { t: time, ts: timestamp, l: level, m: message, sid: __localLogSessionId };
    __localLogBuffer.push(entry);
    if (__localLogBuffer.length > __LOCAL_LOG_MAX) {
      __localLogBuffer = __localLogBuffer.slice(-Math.floor(__LOCAL_LOG_MAX * 0.7));
    }
    if (__localLogBuffer.length % 20 === 0) persistLocalLogs();
  } catch(e) {}
}

function persistLocalLogs() {
  try {
    if (__localLogBuffer.length === 0) return;
    var key = '__ds_logs_' + new Date().toISOString().substring(0, 10);
    var existing = [];
    try { existing = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
    existing = existing.concat(__localLogBuffer.map(function(e) {
      return e.t + ' [' + e.l + '] ' + e.m;
    }));
    if (existing.length > __LOCAL_LOG_MAX * 2) {
      existing = existing.slice(-__LOCAL_LOG_MAX * 1.5);
    }
    localStorage.setItem(key, JSON.stringify(existing));
    localStorage.setItem('__ds_log_last_key', key);
    localStorage.setItem('__ds_log_session', String(__localLogSessionId));
    localStorage.setItem('__ds_log_last_update', new Date().toISOString());
    __localLogBuffer = [];
  } catch(e) {}
}

function getLocalLogs() {
  var allLogs = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf('__ds_logs_') === 0) {
        try { allLogs = allLogs.concat(JSON.parse(localStorage.getItem(key))); } catch(e) {}
      }
    }
  } catch(e) {}
  return allLogs;
}

function exportLogsDownload() {
  persistLocalLogs();
  var logs = getLocalLogs();
  if (logs.length === 0) { logPanel('info', '📥 无日志可导出'); return; }
  var text = '='.repeat(80) + '\nDeepSeek Tool Agent - 执行日志\n导出时间: ' + new Date().toLocaleString() + '\n日志条数: ' + logs.length + '\n='.repeat(80) + '\n\n' + logs.join('\n');
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'ai-agent-log-' + new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  logPanel('info', '📥 日志已导出 (' + text.length + ' 字节)');
}

function sendLogToFile(level, message, timestamp) {
  try {
    chrome.runtime.sendMessage({ action: 'log', level: level, message: message, timestamp: timestamp || Date.now() }, function() {});
  } catch(e) {}
}

function addStageLog(level, title, content, details) {
  if (executionHistory.length > __MAX_LOG_ENTRIES * 3) {
    executionHistory.splice(0, executionHistory.length - __MAX_LOG_ENTRIES * 2);
  }
  executionHistory.push({
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    type: 'log_' + level,
    title: title,
    content: content || '',
    isError: level === 'error' || level === 'warn',
    time: new Date().toLocaleTimeString(),
    expanded: false,
    details: details || null
  });
  updateHistoryUI();
}

function addHistoryCard(type, title, content, isError, details) {
  executionHistory.push({
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    type: type, title: title, content: content || '',
    isError: !!isError, time: new Date().toLocaleTimeString(),
    expanded: false, details: details || null
  });
  if (executionHistory.length > 200) executionHistory = executionHistory.slice(-150);
  updateHistoryUI();
}

var __updateHistoryPending = false;

function updateHistoryUI() {
  if (__updateHistoryPending) return;
  __updateHistoryPending = true;
  setTimeout(function() {
    __updateHistoryPending = false;
    _doUpdateHistoryUI();
  }, 0);
}

function _doUpdateHistoryUI() {
  var container = document.getElementById('__ds-history-list');
  if (!container) return;
  if (executionHistory.length === 0) { container.innerHTML = '<div class="__ds-history-empty">等待工具执行...</div>'; return; }
  if (executionHistory.length > __MAX_LOG_ENTRIES) executionHistory.splice(0, executionHistory.length - __MAX_LOG_ENTRIES);

  function badgeForCard(card) {
    switch (card.type) {
      case 'tool_call': return { cls: '__ds-card-type-call', text: '调用' };
      case 'tool_output': return card.isError ? { cls: '__ds-card-type-error', text: '失败' } : { cls: '__ds-card-type-output', text: '结果' };
      case 'tool_detect': return { cls: '__ds-card-type-tool_detect', text: '检测' };
      case 'task_send': return { cls: '__ds-card-type-task_send', text: '任务' };
      case 'phase_complete': return { cls: '__ds-card-type-phase_complete', text: '完成' };
      case 'inject': return { cls: '__ds-card-type-inject', text: '注入' };
      case 'log_error': return { cls: '__ds-card-type-error', text: '错误' };
      case 'log_warn': return { cls: '__ds-card-type-warn', text: '警告' };
      case 'log_success': return { cls: '__ds-card-type-success', text: '成功' };
      default: return card.isError ? { cls: '__ds-card-type-error', text: '错误' } : { cls: '__ds-card-type-info', text: '日志' };
    }
  }

  var html = '';
  for (var i = 0; i < executionHistory.length; i++) {
    var card = executionHistory[i];
    var badge = badgeForCard(card);
    var preview = (card.content || '').trim();
    preview = preview.length > 80 ? escapeHtml(preview.substring(0, 80)) + '...' : escapeHtml(preview);

    html += '<div class="__ds-history-card" data-card-id="' + escapeAttr(card.id) + '">';
    html += '<div class="__ds-card-header" data-card-id="' + escapeAttr(card.id) + '">';
    html += '<span class="__ds-card-type-badge ' + badge.cls + '">' + badge.text + '</span>';
    html += '<div class="__ds-card-header-main">';
    html += '<span class="__ds-card-title">' + escapeHtml(card.title) + '</span>';
    if (preview) html += '<span class="__ds-card-preview">' + preview + '</span>';
    html += '</div>';
    html += '<span class="__ds-card-time">' + card.time + '</span>';
    html += '<span class="__ds-card-toggle' + (card.expanded ? ' __ds-expanded' : '') + '">▶</span>';
    html += '</div>';
    html += '<div class="__ds-card-body' + (card.expanded ? ' __ds-expanded' : '') + '">';
    html += '<div class="__ds-card-content-text">' + escapeHtml((card.content || '').trim()).replace(/\n/g, '<br>') + '</div>';
    if (card.details && card.details.length > 0) {
      html += '<div class="__ds-card-details">';
      for (var d = 0; d < card.details.length; d++) {
        var item = card.details[d];
        if (typeof item === 'string') {
          html += '<div class="__ds-detail-row"><span class="__ds-detail-bullet">•</span><span>' + escapeHtml(item) + '</span></div>';
        } else if (item) {
          html += '<div class="__ds-detail-row"><span class="__ds-detail-label">' + escapeHtml(item.label || '') + ':</span><span class="__ds-detail-value">' + escapeHtml(String(item.value || '')) + '</span></div>';
        }
      }
      html += '</div>';
    }
    html += '</div></div>';
  }
  container.innerHTML = html;

  // Ensure event delegation is attached only once
  if (!container.__ds_delegated) {
    container.__ds_delegated = true;
    container.addEventListener('click', function(e) {
      var header = e.target.closest('.__ds-card-header');
      if (header) {
        var cardId = header.getAttribute('data-card-id');
        if (cardId) window.__ds_toggleCard(cardId);
      }
    });
  }

  container.scrollTop = container.scrollHeight;
}

window.__ds_toggleCard = function(cardId) {
  for (var i = 0; i < executionHistory.length; i++) {
    if (executionHistory[i].id === cardId) { executionHistory[i].expanded = !executionHistory[i].expanded; break; }
  }
  updateHistoryUI();
};

window.__ds_exportLogs = function() { exportLogsDownload(); };
