document.addEventListener('DOMContentLoaded', () => {
  init();
});

let panelVisible = true;

async function init() {
  checkAllStatus();
  setupEventListeners();
  loadPanelState();
}

function setupEventListeners() {
  document.getElementById('panel-toggle')?.addEventListener('click', togglePanelVisibility);
  document.getElementById('btn-open-deepseek')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://chat.deepseek.com' });
  });
  document.getElementById('btn-toggle-panel')?.addEventListener('click', togglePanelFromButton);
  document.getElementById('btn-restart-server')?.addEventListener('click', restartServer);
  document.getElementById('btn-settings')?.addEventListener('click', openSettings);
}

async function togglePanelVisibility() {
  panelVisible = !panelVisible;
  updatePanelToggleUI();
  chrome.storage.local.set({ panelVisible: panelVisible });
  notifyPanelVisibility();
}

function updatePanelToggleUI() {
  const bg = document.getElementById('panel-toggle-bg');
  const knob = document.getElementById('panel-toggle-knob');
  const label = document.getElementById('panel-toggle-label');

  if (panelVisible) {
    bg.classList.add('on');
    knob.style.transform = 'translateX(18px)';
    if (label) label.textContent = '已显示';
  } else {
    bg.classList.remove('on');
    knob.style.transform = 'translateX(2px)';
    if (label) label.textContent = '已隐藏';
  }
}

function togglePanelFromButton() {
  panelVisible = !panelVisible;
  updatePanelToggleUI();
  chrome.storage.local.set({ panelVisible: panelVisible });
  notifyPanelVisibility();
}

function loadPanelState() {
  chrome.storage.local.get(['panelVisible'], (result) => {
    if (result.panelVisible !== undefined) {
      panelVisible = result.panelVisible;
    }
    updatePanelToggleUI();
  });
}

function notifyPanelVisibility() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url?.includes('chat.deepseek.com')) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'togglePanel',
        visible: panelVisible
      }).catch(() => {});
    }
  });
}

async function checkAllStatus() {
  await checkServerStatus();
  await checkLauncherStatus();
  await checkTaskStatus();
}

async function checkServerStatus() {
  const badge = document.getElementById('server-badge');
  if (!badge) return;

  try {
    var timeout = AbortSignal.timeout ? AbortSignal.timeout(2000) : null;
    var opts = timeout ? { signal: timeout } : {};
    var ctrl = timeout ? null : new AbortController();
    if (ctrl) { setTimeout(function() { ctrl.abort(); }, 2000); opts.signal = ctrl.signal; }

    const response = await fetch('http://localhost:3002/health', opts);
    if (response.ok) {
      badge.textContent = '运行中';
      badge.className = 'badge badge-ok';
      return;
    }
  } catch (e) {}

  badge.textContent = '未连接';
  badge.className = 'badge badge-error';
}

async function checkLauncherStatus() {
  const badge = document.getElementById('launcher-badge');
  if (!badge) return;

  try {
    var timeout = AbortSignal.timeout ? AbortSignal.timeout(2000) : null;
    var opts = timeout ? { signal: timeout } : {};
    var ctrl = timeout ? null : new AbortController();
    if (ctrl) { setTimeout(function() { ctrl.abort(); }, 2000); opts.signal = ctrl.signal; }

    const response = await fetch('http://localhost:3003/api/launcher/status', opts);
    if (response.ok) {
      const data = await response.json();
      badge.textContent = data.serverRunning ? '运行中' : '已启动';
      badge.className = 'badge badge-ok';
      return;
    }
  } catch (e) {}

  badge.textContent = '未运行';
  badge.className = 'badge badge-off';
}

async function checkTaskStatus() {
  const container = document.getElementById('task-overview');
  if (!container) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !tab.url?.includes('chat.deepseek.com')) {
      container.innerHTML = '<div class="no-data">请先打开 DeepSeek 页面</div>';
      return;
    }

    const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
    if (status) {
      if (status.session && status.session.status === 'running') {
        container.innerHTML = '' +
          '<div class="info-row"><span class="info-key">任务</span><span class="info-val">' + escapeHtml((status.session.originalMessage || '').substring(0, 40)) + '</span></div>' +
          '<div class="info-row"><span class="info-key">工具调用</span><span class="info-val">' + (status.session.toolCount || 0) + ' 次</span></div>' +
          '<div class="info-row"><span class="info-key">状态</span><span class="info-val">' + (status.processing ? '处理中' : '运行中') + '</span></div>';
      } else {
        container.innerHTML = '<div class="no-data">无进行中的任务</div>';
      }
    }
  } catch (e) {
    container.innerHTML = '<div class="no-data">无法获取任务状态</div>';
  }
}

async function restartServer() {
  const btn = document.getElementById('btn-restart-server');
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = '⏳ 重启中...';

  var restarted = false;

  try {
    const response = await fetch('http://localhost:3003/api/launcher/restart', {
      method: 'POST',
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      restarted = true;
    }
  } catch (e) {}

  if (!restarted) {
    try {
      const fallbackResp = await fetch('http://localhost:3002/api/start-launcher', {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });
      if (fallbackResp.ok) {
        restarted = true;
      }
    } catch (e2) {}
  }

  if (restarted) {
    await new Promise(resolve => {
      var started = Date.now();
      var MAX_WAIT = 12000;
      function check() {
        if (Date.now() - started > MAX_WAIT) { resolve(); return; }
        fetch('http://localhost:3002/health')
          .then(function(r) {
            if (r.ok) { resolve(); }
            else if (Date.now() - started < MAX_WAIT) { setTimeout(check, 500); }
            else { resolve(); }
          })
          .catch(function() {
            if (Date.now() - started < MAX_WAIT) { setTimeout(check, 500); }
            else { resolve(); }
          });
      }
      setTimeout(check, 1000);
    });
    await checkAllStatus();
  }

  btn.disabled = false;
  btn.textContent = '🔄 重启服务';
}

function openSettings() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url?.includes('chat.deepseek.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'openSettings' }).catch(() => {});
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}