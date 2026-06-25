function keepBackgroundAlive() {
  try {
    if (!bgPort) {
      bgPort = chrome.runtime.connect({ name: 'keepAlive' });
      __connectionHealthy = true;
      __lastPingTime = Date.now();
      bgPort.onDisconnect.addListener(function() {
        bgPort = null;
        __connectionHealthy = false;
        logPanel('warn', 'Background 连接断开，尝试重连...');
        setTimeout(keepBackgroundAlive, 1000);
      });
    }
  } catch(e) {
    bgPort = null;
    __connectionHealthy = false;
    setTimeout(keepBackgroundAlive, 2000);
  }
}

var _heartbeatTimer = null;

function startHeartbeat() {
  stopHeartbeat(); // 清除旧的定时器
  _heartbeatTimer = setInterval(function() {
    if (bgPort) {
      try { bgPort.postMessage({ type: 'ping' }); __lastPingTime = Date.now(); } catch(e) { bgPort = null; __connectionHealthy = false; keepBackgroundAlive(); }
    } else { keepBackgroundAlive(); }
  }, 10000);
}

function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

async function checkServerStatus() {
  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 3000);
    var response = await fetch(getEndpoint('health'), { signal: ctrl.signal });
    clearTimeout(timer);
    if (response.ok) { updateServerStatusUI(true); return { running: true }; }
  } catch(e) {}
  try {
    var status = await chrome.runtime.sendMessage({ action: 'getStatus' });
    if (status && status.running) { updateServerStatusUI(true); return status; }
  } catch(e) {}
  updateServerStatusUI(false);
  await ensureServerRunning();
  return { running: false };
}

async function ensureServerRunning() {
  if (__serverStarting) return;
  __serverStarting = true;
  logPanel('info', '检测服务器状态...');
  setStageText('检测服务...');
  var serverTextEl = document.getElementById('__ds-server-text');
  if (serverTextEl) serverTextEl.textContent = '检测中...';

  for (var attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      logPanel('info', '第 ' + attempt + '/2 次重试...');
      await sleep(3000);
    }
    if (serverTextEl) serverTextEl.textContent = '启动中...(' + attempt + '/2)';
    var connected = await _tryConnectOnce(serverTextEl);
    if (connected) { __serverStarting = false; return true; }
  }
  logPanel('warn', '⚠️ 服务器未运行 — 请手动启动');
  updateServerStatusUI(false);
  if (serverTextEl) serverTextEl.textContent = '未运行';
  showStartupGuide();
  __serverStarting = false;
  return false;
}

async function _tryConnectOnce(serverTextEl) {
  logPanel('info', '尝试通过 Native Messaging 连接服务...');
  try {
    var nativeResp = await chrome.runtime.sendMessage({ action: 'connectNativeHost' });
    if (nativeResp && nativeResp.status && nativeResp.status.running) {
      logPanel('success', 'Native Host 已连接，服务器就绪 ✅');
      addStageLog('success', '✅ 服务器已连接 (Native)', '通过 Native Messaging 成功连接到本地工具服务器');
      updateServerStatusUI(true);
      loadFileBrowser();
      return true;
    }
  } catch(e) {
    var errMsg = e.message || '';
    if (errMsg.indexOf('Extension context invalidated') >= 0 || errMsg.indexOf('disconnected') >= 0) {
      logPanel('warn', 'Service Worker 已重启，等待重新连接...');
      await sleep(2000);
      return false;
    }
    logPanel('warn', 'Native Messaging 连接异常: ' + errMsg);
  }
  logPanel('info', '尝试直接 HTTP 连接 ' + getServerUrl() + ' ...');
  try {
    var httpCtrl = new AbortController();
    var httpTimer = setTimeout(function() { httpCtrl.abort(); }, 4000);
    var httpResp = await fetch(getEndpoint('health'), { signal: httpCtrl.signal });
    clearTimeout(httpTimer);
    if (httpResp.ok) {
      logPanel('success', '服务器已通过 HTTP 直连就绪 ✅');
      updateServerStatusUI(true);
      if (serverTextEl) serverTextEl.textContent = '已连接 (HTTP)';
      loadFileBrowser();
      return true;
    }
  } catch(httpErr) { logPanel('warn', 'HTTP 直连失败: ' + (httpErr.message || '')); }
  return false;
}

function updateServerStatusUI(running) {
  var petDot = document.getElementById('__ds-pet-dot');
  var headerDot = document.getElementById('__ds-h-status-dot');
  var statusText = document.getElementById('__ds-status-text');
  var serverStatusText = document.getElementById('__ds-server-status-text');
  var panelStatusDot = document.getElementById('__ds-panel-status-dot');
  var serverText = document.getElementById('__ds-server-text');

  var dotColor = running ? '#5b8a4a' : '#c0bab0';
  var dotShadow = running ? '0 0 6px rgba(91,138,74,0.4)' : 'none';

  if (petDot) { petDot.style.background = dotColor; petDot.style.boxShadow = dotShadow; }
  if (headerDot) { headerDot.style.background = dotColor; headerDot.style.boxShadow = dotShadow; }
  if (statusText) statusText.textContent = running ? '已连接' : '未连接';
  if (serverStatusText) serverStatusText.textContent = running ? '✅ 已连接' : '❌ 未连接';
  if (panelStatusDot) { panelStatusDot.className = running ? '__ds-status-connected' : '__ds-status-disconnected'; }
  if (serverText) { serverText.textContent = running ? '已连接' : '未连接'; serverText.className = running ? '__ds-status-on' : '__ds-status-off'; }

  var cfgDot = document.getElementById('__ds-cfg-status-dot');
  var cfgLabel = document.getElementById('__ds-cfg-status-label');
  var cfgBtn = document.getElementById('__ds-btn-start-server');
  if (cfgDot && cfgLabel && cfgBtn) {
    if (running) {
      cfgDot.classList.add('online');
      cfgLabel.textContent = 'Server: Connected';
      cfgBtn.textContent = 'Restart';
      cfgBtn.classList.add('restart');
    } else {
      cfgDot.classList.remove('online');
      cfgLabel.textContent = 'Server: Disconnected';
      cfgBtn.textContent = 'Start Server';
      cfgBtn.classList.remove('restart');
    }
    cfgBtn.disabled = false;
  }
}

function setStageText(msg) {
  var el = document.getElementById('__ds-status-text');
  if (el) el.textContent = msg;

  var stageEl = document.getElementById('__ds-stage-text');
  if (stageEl) stageEl.textContent = msg;
}

function updateAutoButtonState() {
  var btn = document.getElementById('__ds-btn-submit');
  if (!btn) return;
  if (autoMode || autoWatchRunning) {
    btn.textContent = '⏹ 停止监听'; btn.className = '__ds-btn __ds-btn-stop';
  } else {
    btn.textContent = '🚀 发送任务'; btn.className = '__ds-btn __ds-btn-submit';
  }
}

function updateSessionStatusUI() {
  var sessionEl = document.getElementById('__ds-session-text');
  var session = getCurrentSession();
  if (sessionEl) {
    if (session && session.status === 'running') { sessionEl.textContent = '进行中'; sessionEl.className = '__ds-status-warn'; }
    else { sessionEl.textContent = '空闲'; sessionEl.className = '__ds-status-off'; }
  }
}

function showStartupGuide() {
  if (panelVisible) {
    var area = document.getElementById('__ds-log-area');
    if (area) {
      area.innerHTML = [
        '<div style="padding:20px;text-align:center;">',
        '  <div style="font-size:48px;margin-bottom:12px;">&#9888;</div>',
        '  <div style="font-weight:600;margin-bottom:8px;color:var(--cr-fallback-color-on-surface-subtle);">本地工具服务器未运行</div>',
        '  <div style="font-size:12px;color:var(--cr-fallback-color-on-surface-subtle);margin-bottom:16px;">请手动启动服务或安装 Native Messaging Host</div>',
        '  <div style="background:var(--ds-bg);border:1px solid var(--ds-border);border-radius:6px;padding:12px;text-align:left;font-family:monospace;font-size:11px;margin-bottom:12px;">',
        '    <div style="color:#81c995;"># 方式1: 双击启动（推荐）</div>',
        '    <div style="color:var(--cr-fallback-color-on-surface-subtle);">双击项目根目录的 <b>start-server.bat</b></div>',
        '    <div style="color:#81c995;margin-top:8px;"># 方式2: 命令行启动</div>',
        '    <div style="color:var(--cr-fallback-color-on-surface-subtle);">cd /d "&lt;项目根目录&gt;"</div>',
        '    <div style="color:var(--cr-fallback-color-on-surface-subtle);">node server\\launcher.js</div>',
        '    <div style="color:#81c995;margin-top:8px;"># 方式3: 安装 Native Host（自动启动）</div>',
        '    <div style="color:var(--cr-fallback-color-on-surface-subtle);">以管理员身份运行 native-messaging\\register.bat</div>',
        '  </div>',
        '  <button class="ds-btn ds-btn-primary ds-btn-sm" onclick="window.__ds_retryConnect && window.__ds_retryConnect()" style="cursor:pointer;">&#8635; 重试连接</button>',
        '</div>'
      ].join('');
    }
  }
  logPanel('warn', '服务器未运行 — 请查看 Live Logs 面板中的启动指南');
}

window.__ds_retryConnect = function() {
  logPanel('info', '手动重试连接...');
  ensureServerRunning();
};
