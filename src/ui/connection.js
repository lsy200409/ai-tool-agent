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

function startHeartbeat() {
  setInterval(function() {
    if (bgPort) {
      try { bgPort.postMessage({ type: 'ping' }); __lastPingTime = Date.now(); } catch(e) { bgPort = null; __connectionHealthy = false; keepBackgroundAlive(); }
    } else { keepBackgroundAlive(); }
  }, 10000);
}

async function checkServerStatus() {
  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 3000);
    var response = await fetch('http://localhost:3002/health', { signal: ctrl.signal });
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

  for (var attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      logPanel('info', '第 ' + attempt + '/3 次重试...');
      await sleep(2500);
    }
    var connected = await _tryConnectOnce(serverTextEl);
    if (connected) { __serverStarting = false; return true; }
  }
  logPanel('warn', '⚠️ 需要安装 Native Messaging 才能自动启动服务');
  updateServerStatusUI(false);
  if (serverTextEl) serverTextEl.textContent = '需安装';
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
  logPanel('info', '尝试直接 HTTP 连接 http://localhost:3002 ...');
  try {
    var httpCtrl = new AbortController();
    var httpTimer = setTimeout(function() { httpCtrl.abort(); }, 4000);
    var httpResp = await fetch('http://localhost:3002/health', { signal: httpCtrl.signal });
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
