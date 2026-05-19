async function doInjectPrompt() {
  var btn = document.getElementById('__ds-btn-inject');
  if (!btn) return;
  btn.disabled = true; btn.textContent = '⏳ 注入中...';
  await checkServerStatus();
  var input = findChatInput();
  if (!input) { logPanel('error', '找不到 DeepSeek 输入框'); btn.disabled = false; btn.textContent = '💉 注入提示词'; return; }
  var currentValue = input.value || '';
  if (currentValue.includes('## 可用工具') && currentValue.includes('<tool_call')) { logPanel('info', '工具提示词已存在'); btn.disabled = false; btn.textContent = '💉 注入提示词'; return; }
  var toolPrompt = buildSystemPrompt();
  setInputValue(input, currentValue.trim() ? toolPrompt + '\n\n---\n\n' + currentValue : toolPrompt);
  logPanel('success', '工具提示词已注入');
  btn.disabled = false; btn.textContent = '💉 注入提示词';
}

function handleSubmitOrStop() {
  if (autoMode || autoWatchRunning) {
    stopAutoWatch(); autoMode = false; autoWatchRunning = false;
    updateAutoButtonState(); setStageText('已停止');
    logPanel('warn', '自动监听已停止');
    var btn = document.getElementById('__ds-btn-submit');
    if (btn) { btn.textContent = '🚀 发送任务'; btn.className = '__ds-btn __ds-btn-submit'; }
  } else { doSubmitTask(); }
}

async function doSubmitTask() {
  var btn = document.getElementById('__ds-btn-submit');
  if (!btn) return;
  btn.disabled = true; btn.textContent = '⏳ 处理中...';
  var taskInput = document.getElementById('__ds-task-input');
  var userTask = taskInput ? taskInput.value.trim() : '';
  if (!userTask) { logPanel('error', '请输入任务内容'); btn.disabled = false; btn.textContent = '🚀 发送任务'; return; }
  var input = findChatInput();
  if (!input) { logPanel('error', '找不到 DeepSeek 输入框'); btn.disabled = false; btn.textContent = '🚀 发送任务'; return; }
  resetCurrentSession();
  originalTask = userTask;
  createAgentSession(originalTask);
  updateSessionStatusUI();
  logPanel('info', '写入任务: ' + userTask.substring(0, 80));
  setInputValue(input, userTask);
  await sleep(500);
  clickSendButton();
  autoMode = true; autoWatchRunning = true;
  startAutoWatchInInjected();
  setStageText('自动监听中');
  updateAutoButtonState();
  btn.disabled = false;
  btn.textContent = '⏹ 停止监听'; btn.className = '__ds-btn __ds-btn-stop';
}

async function doRestartServer() {
  var btn = document.getElementById('__ds-btn-restart');
  if (!btn) return;
  btn.disabled = true; btn.textContent = '🔄 重启中...';
  logPanel('info', '正在激活 Native Host...');
  try {
    var nativeResp = await chrome.runtime.sendMessage({ action: 'connectNativeHost' });
    if (nativeResp && nativeResp.status && nativeResp.status.running) {
      logPanel('success', 'Native Host 已连接，服务就绪 ✅');
      addStageLog('success', '✅ 服务已就绪', '通过 Native Messaging 成功连接到运行中的服务');
      updateServerStatusUI(true);
      loadFileBrowser();
      btn.textContent = '🔄 重启服务'; btn.disabled = false;
      return;
    }
  } catch(e) {}
  showStartupGuide();
  btn.textContent = '🔄 重启服务'; btn.disabled = false;
}

function toggleFileBrowser() {
  fileBrowserVisible = !fileBrowserVisible;
  var leftPanel = document.querySelector('.__ds-file-browser-panel');
  var toggleBtn = document.getElementById('__ds-btn-toggle-files');
  if (leftPanel) {
    if (fileBrowserVisible) { leftPanel.classList.remove('__ds-file-collapsed'); if (toggleBtn) toggleBtn.textContent = '◀'; }
    else { leftPanel.classList.add('__ds-file-collapsed'); if (toggleBtn) toggleBtn.textContent = '▶'; }
  }
}

function stopAutoWatch() {
  autoWatchRunning = false;
  stopAutoWatchInInjected();
  updateAutoButtonState();
}

function openSettings(tab) {
  var overlay = document.getElementById('__ds-settings-overlay');
  var currentEl = document.getElementById('__ds-settings-current');
  var inputEl = document.getElementById('__ds-settings-workspace');
  if (!overlay) return;
  getWorkspacePath().then(function(wsPath) {
    if (currentEl) currentEl.textContent = wsPath || '未设置';
    if (inputEl) inputEl.value = wsPath || '';
    overlay.classList.remove('__ds-hidden');
    if (tab === 'launcher') switchSettingsTab('launcher');
  });
}

function closeSettings() {
  var overlay = document.getElementById('__ds-settings-overlay');
  if (overlay) overlay.classList.add('__ds-hidden');
}

async function saveSettings() {
  var inputEl = document.getElementById('__ds-settings-workspace');
  if (!inputEl) return;
  var newPath = inputEl.value.trim();
  if (!newPath) { alert('请输入工作区路径'); return; }
  logPanel('info', '正在更新工作区路径: ' + newPath);
  try {
    var response = await fetch('http://localhost:3002/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-workspace', path: newPath }) });
    var data = await response.json();
    if (data.success) {
      chrome.storage.local.set({ workspacePath: newPath }, function() {
        logPanel('success', '工作区已更新: ' + newPath);
        updateWorkspaceDisplay(newPath);
        loadFileBrowser(newPath);
        closeSettings();
      });
    } else { logPanel('error', '更新工作区失败: ' + (data.error || '')); }
  } catch(e) { logPanel('error', '更新工作区失败: ' + e.message); }
}

function switchSettingsTab(tab) {
  var wsPanel = document.getElementById('__ds-settings-workspace-panel');
  var lauPanel = document.getElementById('__ds-settings-launcher-panel');
  var tabWs = document.getElementById('__ds-tab-workspace');
  var tabLau = document.getElementById('__ds-tab-launcher');
  if (tab === 'launcher') {
    if (wsPanel) wsPanel.classList.add('__ds-hidden');
    if (lauPanel) lauPanel.classList.remove('__ds-hidden');
    if (tabWs) tabWs.classList.remove('__ds-tab-active');
    if (tabLau) tabLau.classList.add('__ds-tab-active');
    refreshLauncherStatus(false);
  } else {
    if (wsPanel) wsPanel.classList.remove('__ds-hidden');
    if (lauPanel) lauPanel.classList.add('__ds-hidden');
    if (tabWs) tabWs.classList.add('__ds-tab-active');
    if (tabLau) tabLau.classList.remove('__ds-tab-active');
  }
}

function addLauncherLog(msg, type) {
  var el = document.getElementById('__ds-launcher-log-content');
  if (!el) return;
  var now = new Date();
  var time = now.toLocaleTimeString();
  var prefix = type === 'error' ? '✖' : type === 'success' ? '✓' : type === 'warn' ? '⚠' : '•';
  el.innerHTML += '<div class="__ds-log-entry"><span class="__ds-log-time">' + time + '</span> <span style="color:' + (type === 'error' ? '#a04030' : type === 'success' ? '#5a8a4a' : type === 'warn' ? '#8a7a4a' : '#6a6560') + '">' + prefix + ' ' + escapeHtml(msg) + '</span></div>';
  el.scrollTop = el.scrollHeight;
}

async function checkLauncherStatus() {
  try {
    var opts = { method: 'GET' };
    try { opts.signal = AbortSignal.timeout(2000); } catch(e) {}
    var response = await fetch('http://localhost:3003/api/launcher/status', opts);
    if (response.ok) { var data = await response.json(); return { running: true, data: data }; }
  } catch(e) {}
  return { running: false };
}

async function refreshLauncherStatus(showLog) {
  var status = await checkLauncherStatus();
  var cardEl = document.getElementById('__ds-launcher-card-status');
  var serverEl = document.getElementById('__ds-launcher-card-server');
  document.getElementById('__ds-launcher-detail-pid').textContent = status.running && status.data ? status.data.launcherPid || '-' : '-';
  document.getElementById('__ds-launcher-detail-uptime').textContent = status.running && status.data ? Math.floor((status.data.uptime || 0) / 60) + '分' + (status.data.uptime || 0) % 60 + '秒' : '-';
  document.getElementById('__ds-launcher-detail-restarts').textContent = status.running && status.data ? String(status.data.totalRestarts || 0) : '-';
  document.getElementById('__ds-launcher-detail-server-pid').textContent = status.running && status.data ? String(status.data.serverPid || '-') : '-';
  if (cardEl) { cardEl.textContent = status.running ? '✅ 运行中' : '⛔ 未运行'; cardEl.style.color = status.running ? '#5a8a4a' : '#a04030'; }
  if (serverEl) { serverEl.textContent = status.running && status.data && status.data.serverRunning ? '✅ 运行中' : '⛔ 未运行'; serverEl.style.color = status.running && status.data && status.data.serverRunning ? '#5a8a4a' : '#a04030'; }
  if (showLog && status.running) addLauncherLog('状态已刷新 (PID: ' + (status.data.launcherPid || '-') + ')', 'info');
}

async function doLauncherStart() {
  addLauncherLog('正在尝试启动服务...', 'info');
  var btn = document.getElementById('__ds-btn-launcher-start');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 启动中...'; }
  try {
    var response = await fetch('http://localhost:3002/api/start-launcher', { method: 'POST' });
    if (response.ok) {
      var result = await response.json();
      if (result.success) {
        addLauncherLog('启动器进程已启动 (PID: ' + (result.pid || '-') + ')', 'success');
        var ready = await new Promise(function(resolve) {
          var attempts = 0;
          function check() {
            attempts++;
            var opts = { method: 'GET' };
            try { opts.signal = AbortSignal.timeout(1000); } catch(e) {}
            fetch('http://localhost:3003/api/launcher/status', opts).then(function(r) { return r.json(); }).then(function(d) { if (d.serverRunning) resolve(true); else if (attempts < 15) setTimeout(check, 1000); else resolve(false); }).catch(function() { if (attempts < 15) setTimeout(check, 1000); else resolve(false); });
          }
          setTimeout(check, 1500);
        });
        if (ready) addLauncherLog('服务就绪，工具服务器运行中', 'success');
        else addLauncherLog('服务已启动但工具服务器尚未就绪', 'warn');
        refreshLauncherStatus(true);
        checkServerStatus();
      } else addLauncherLog('启动失败: ' + (result.error || ''), 'error');
    } else addLauncherLog('启动器API无响应', 'error');
  } catch(e) { addLauncherLog('连接失败: ' + e.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = '▶ 启动服务'; }
}

async function doLauncherStop() {
  addLauncherLog('正在停止启动器...', 'warn');
  var btn = document.getElementById('__ds-btn-launcher-stop');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 停止中...'; }
  try {
    var response = await fetch('http://localhost:3003/api/launcher/stop', { method: 'POST' });
    if (response.ok) { await response.json(); addLauncherLog('服务已停止', 'success'); }
    else addLauncherLog('停止失败 (HTTP ' + response.status + ')', 'error');
  } catch(e) { addLauncherLog('连接失败: ' + e.message, 'error'); }
  await sleep(2000);
  refreshLauncherStatus(true);
  checkServerStatus();
  if (btn) { btn.disabled = false; btn.textContent = '⏹ 停止服务'; }
}

async function doLauncherRestartAll() {
  addLauncherLog('正在重启全部服务...', 'warn');
  var btnR = document.getElementById('__ds-btn-launcher-restart');
  if (btnR) { btnR.disabled = true; btnR.textContent = '⏳ 重启中...'; }
  try {
    var response = await fetch('http://localhost:3003/api/launcher/restart', { method: 'POST' });
    if (response.ok) {
      addLauncherLog('重启请求已提交', 'info');
      await new Promise(function(resolve) {
        var attempts = 0;
        function check() {
          attempts++;
          var opts = { method: 'GET' };
          try { opts.signal = AbortSignal.timeout(1000); } catch(e) {}
          fetch('http://localhost:3002/health', opts).then(function(r) { if (r.ok) { addLauncherLog('工具服务器已就绪', 'success'); resolve(); } else if (attempts < 30) setTimeout(check, 500); else { addLauncherLog('等待超时', 'warn'); resolve(); } }).catch(function() { if (attempts < 30) setTimeout(check, 500); else { addLauncherLog('等待超时', 'warn'); resolve(); } });
        }
        setTimeout(check, 1000);
      });
      refreshLauncherStatus(true); loadFileBrowser(); checkServerStatus();
    } else { addLauncherLog('重启请求失败', 'error'); await doLauncherStart(); }
  } catch(e) { addLauncherLog('连接启动器失败: ' + e.message, 'error'); await doLauncherStart(); }
  if (btnR) { btnR.disabled = false; btnR.textContent = '🔄 重启全部'; }
}

function updateWorkspaceDisplay(wsPath) {
  var el = document.getElementById('__ds-workspace-path');
  if (el) { el.textContent = wsPath; el.title = wsPath; }
}

window.__ds_viewRawLogs = function() {
  persistLocalLogs();
  var logs = getLocalLogs();
  var previewEl = document.getElementById('__ds-log-preview-area');
  if (!previewEl) return;
  previewEl.textContent = logs.length === 0 ? '(无本地日志)' : logs.slice(-100).join('\n');
  previewEl.scrollTop = previewEl.scrollHeight;
};
