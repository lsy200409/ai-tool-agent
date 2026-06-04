var APP_VERSION = 'v2.6';

function $(id) { return document.getElementById(id); }

var TIMEOUTS = { http: 2000, poll: 2000, wait: 35000 };

(function boot() {
  var page = 'connection';
  try { page = window.location.hash ? window.location.hash.slice(1) : 'connection'; } catch(e) {}
  switchPage(page);
  if (page === 'connection') checkServerStatus();

  window.addEventListener('hashchange', function() {
    var p = window.location.hash ? window.location.hash.slice(1) : 'connection';
    switchPage(p);
    if (p === 'connection') checkServerStatus();
  });
})();

function switchPage(name) {
  var navs = document.querySelectorAll('.pm-nav-item');
  for (var i = 0; i < navs.length; i++) {
    navs[i].classList.toggle('active', navs[i].dataset.page === name);
  }
  var pages = document.querySelectorAll('.pm-page');
  for (var j = 0; j < pages.length; j++) {
    pages[j].classList.toggle('active', pages[j].id === 'pm-page-' + name);
  }
}

function log(msg, type) {
  var el = $('pm-log');
  if (!el) return;
  type = type || 'info';
  var now = new Date().toLocaleTimeString();
  var icon = type === 'error' ? '[X]' : type === 'success' ? '[\u2713]' : '[*]';
  el.innerHTML += '<div class="pm-log-line ' + type + '"><span>' + now + '</span>' + icon + ' ' + msg + '</div>';
  el.scrollTop = el.scrollHeight;
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ============================================================
// 服务状态检测
// ============================================================
async function checkServerStatus() {
  var badge = $('pm-status-badge');
  var text = $('pm-status-text');
  var detail = $('pm-status-detail');

  if (badge) badge.className = 'pm-status-badge checking';
  if (text) text.textContent = '检测中...';
  if (detail) detail.textContent = '';

  var ok = await httpCheck(2000);

  if (ok) {
    if (badge) badge.className = 'pm-status-badge running';
    if (text) text.textContent = '服务运行中';
    try {
      var resp = await fetch('http://localhost:3002/health');
      var data = await resp.json();
      if (detail) detail.textContent = '工具: ' + (data.toolCount || '?') + ' | 插件: ' + (data.pluginCount || '?') + ' | 端口: 3002';
    } catch(e) {
      if (detail) detail.textContent = '端口: 3002';
    }
  } else {
    if (badge) badge.className = 'pm-status-badge stopped';
    if (text) text.textContent = '服务未运行';
    if (detail) detail.textContent = '点击下方按钮启动服务';
  }
}

async function httpCheck(timeoutMs) {
  try {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 2000);
    var resp = await fetch('http://localhost:3002/health', { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch(e) { return false; }
}

// ============================================================
// 启动服务 — 多级回退 + 自动轮询
// ============================================================
var __starting = false;

async function startServer() {
  if (__starting) return;
  __starting = true;

  var btn = $('pm-btn-start-server');
  var status = $('pm-start-status');
  var progress = $('pm-start-progress');
  var bar = $('pm-start-progress-bar');

  clearLog();
  if (btn) { btn.disabled = true; btn.textContent = '启动中...'; }
  if (status) status.textContent = '';
  if (progress) { progress.classList.add('show'); bar.style.width = '0%'; }

  // Step 1: HTTP 直检
  log('Step 1/4: HTTP 直检 (localhost:3002)...');
  updateProgress(10);
  var running = await httpCheck(2000);
  if (running) {
    log('服务已在运行', 'success');
    done('服务已在运行');
    return;
  }
  log('服务未运行，继续尝试启动');

  // Step 2: Launcher API
  log('Step 2/4: 尝试 Launcher API (3003)...');
  updateProgress(25);
  var launcherOk = await tryLauncherAPI();
  if (launcherOk) {
    await pollUntilRunning();
    return;
  }
  log('Launcher API 不可用', 'error');

  // Step 3: 通过扩展后台启动
  log('Step 3/4: 通过扩展后台启动 (Native Host)...');
  updateProgress(50);
  var bgOk = await tryBackgroundStart();
  if (bgOk) {
    await pollUntilRunning();
    return;
  }

  // Step 4: 所有方法失败，显示手动帮助
  log('Step 4/4: 自动启动失败，请手动启动', 'error');
  updateProgress(100);
  showManualStartHelp();
  done('所有自动启动方法失败', false);
}

async function tryLauncherAPI() {
  try {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 3000);
    var resp = await fetch('http://localhost:3003/api/launcher/restart', { method: 'POST', signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) {
      log('Launcher API 接受重启请求，等待服务就绪...', 'success');
      return true;
    }
    return false;
  } catch(e) { return false; }
}

async function tryBackgroundStart() {
  return new Promise(function(resolve) {
    try {
      chrome.runtime.sendMessage({ action: 'restartServer' }, function(resp) {
        if (!resp) { log('扩展后台无响应', 'error'); resolve(false); return; }
        if (resp.success) {
          log('扩展后台: 启动成功 (' + (resp.method || '?') + ')', 'success');
          resolve(true);
        } else {
          var err = resp.error || '未知错误';
          log('扩展后台: ' + err, 'error');
          if (resp.helpMessage) log(resp.helpMessage, 'info');
          resolve(false);
        }
      });
      setTimeout(function() { resolve(false); }, 38000);
    } catch(e) {
      log('扩展通信异常: ' + e.message, 'error');
      resolve(false);
    }
  });
}

async function pollUntilRunning() {
  log('等待服务就绪 (最多 35 秒)...', 'info');
  var start = Date.now();
  var max = 35000;

  while (Date.now() - start < max) {
    updateProgress(50 + Math.floor(50 * (Date.now() - start) / max));
    var ok = await httpCheck(2000);
    if (ok) {
      updateProgress(100);
      log('服务已就绪', 'success');
      done('服务已启动');
      showPostStartInfo();
      return;
    }
    log('等待中... (' + Math.floor((Date.now() - start) / 1000) + 's)', 'info');
  }

  log('等待超时 — 服务可能仍在启动中', 'error');
  updateProgress(100);
  done('启动中...', true);
}

function showPostStartInfo() {
  setTimeout(checkServerStatus, 1000);
}

function showManualStartHelp() {
  var area = $('pm-log');
  if (!area) return;

  area.innerHTML += [
    '<div class="pm-help-box">',
    '  <div class="pm-help-title">无法自动启动 — 选择以下方式：</div>',
    '',
    '  <div class="pm-help-method"><b>推荐 ⭐ — 注册 Native Host（一劳永逸）</b></div>',
    '  <div class="pm-help-desc">注册后，扩展可以自动启动/停止服务，弹窗"启动服务"按钮直接可用</div>',
    '  <div class="pm-help-cmd">右键 → 以管理员身份运行 <code>native-messaging\\register.bat</code></div>',
    '  <div class="pm-help-desc" style="margin-top:4px;color:#34a853">✓ 自动检测 Node.js 路径 | ✓ 自动检测项目位置 | ✓ 支持 Chrome + Edge</div>',
    '',
    '  <div class="pm-help-method"><b>方式2 — 双击启动（每次手动）</b></div>',
    '  <div class="pm-help-cmd">双击项目目录中的 <code>start-server.bat</code></div>',
    '',
    '  <div class="pm-help-method"><b>方式3 — 命令行</b></div>',
    '  <div class="pm-help-cmd" id="pm-cmd-text">在项目目录中执行 node server\\launcher.js</div>',
    '  <button class="pm-btn-copy" onclick="copyManualCmd()">复制命令</button>',
    '',
    '  <div class="pm-help-note">',
    '    为什么不能自动启动？<br>',
    '    Chrome 扩展出于安全设计，不能直接启动本地进程。<br>',
    '    必须先注册 Native Messaging Host（方式1）才能实现全自动。',
    '  </div>',
    '</div>'
  ].join('');
}

function copyManualCmd() {
  navigator.clipboard.writeText('node server\\launcher.js').then(function() {
    log('命令已复制到剪贴板（在项目目录中执行）', 'success');
  });
}

function done(text, showRetry) {
  var btn = $('pm-btn-start-server');
  var status = $('pm-start-status');
  if (btn) { btn.disabled = false; btn.textContent = '启动服务'; }
  if (status) status.textContent = text || '';
  if (showRetry === false) {
    log(text || '操作完成', 'error');
  }
  __starting = false;
  setTimeout(checkServerStatus, 1500);
}

function clearLog() {
  var el = $('pm-log');
  if (el) el.innerHTML = '';
}

function updateProgress(pct) {
  var bar = $('pm-start-progress-bar');
  if (bar) bar.style.width = pct + '%';
}

// ============================================================
// 重启服务
// ============================================================
async function restartServer() {
  log('正在重启服务...');
  var btn = $('pm-btn-start-server');
  if (btn) { btn.disabled = true; btn.textContent = '重启中...'; }

  try {
    chrome.runtime.sendMessage({ action: 'restartServer' }, function(resp) {
      if (resp && resp.success) {
        log('重启请求已发送，等待服务就绪...', 'success');
        pollUntilRunning().then(function() {
          if (btn) { btn.disabled = false; btn.textContent = '启动服务'; }
        });
      } else {
        log('重启失败: ' + (resp ? (resp.error || '无响应') : '无响应'), 'error');
        if (btn) { btn.disabled = false; btn.textContent = '启动服务'; }
      }
    });
  } catch(e) {
    log('重启异常: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '启动服务'; }
  }
}

// ============================================================
// 停止服务
// ============================================================
async function stopServer() {
  log('正在停止服务...');
  try {
    var resp = await fetch('http://localhost:3003/api/launcher/stop', { method: 'POST' });
    if (resp.ok) {
      log('停止请求已发送', 'success');
    } else {
      log('停止服务需要 Launcher 运行在端口 3003 — 请手动关闭终端窗口', 'error');
    }
  } catch(e) {
    log('停止服务需要 Launcher 运行 — 请手动关闭终端窗口 (Ctrl+C)', 'error');
  }
  setTimeout(checkServerStatus, 2000);
}

// ============================================================
// 事件绑定
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  var verEl = document.getElementById('pm-version');
  if (verEl) verEl.textContent = APP_VERSION;

  var startBtn = $('pm-btn-start-server');
  if (startBtn) startBtn.onclick = startServer;

  var restartBtn = $('pm-btn-restart-server');
  if (restartBtn) restartBtn.onclick = restartServer;

  var stopBtn = $('pm-btn-stop-server');
  if (stopBtn) stopBtn.onclick = stopServer;

  var refreshBtn = $('pm-btn-refresh-status');
  if (refreshBtn) refreshBtn.onclick = function() {
    var badge = $('pm-status-badge');
    if (badge) badge.className = 'pm-status-badge checking';
    checkServerStatus();
  };

  var copyBtn = document.querySelector('.pm-btn-copy');
  if (copyBtn) copyBtn.onclick = copyManualCmd;

  var tabBtns = document.querySelectorAll('.pm-nav-item');
  for (var i = 0; i < tabBtns.length; i++) {
    tabBtns[i].addEventListener('click', function() {
      window.location.hash = this.dataset.page;
    });
  }
});