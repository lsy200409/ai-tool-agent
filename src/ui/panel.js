// ============================================================
// AI Tool Agent v3.0 — Panel UI (Chromium-native styling)
// Design tokens from chromium-ui-react (--cr-* variables)
// Layout: dual-column (Tools&Skills | Live Logs) + bottom bar
// Pure vanilla JS — no framework dependency
// NOTE: agentTools/agentSkills/executionHistory 在 state.js 中声明
// ============================================================

var agentPersonality = null;
var agentCustomSkills = [];
var quickActions = [];
var logLevelFilter = 'all';
var autoScroll = true;
var petDragging = false;
var petOffsetX = 0;
var petOffsetY = 0;
var petDragStartX = 0;
var petDragStartY = 0;
var panelVisible = false;
var leftColumnTab = 'tools';
var panelResizing = false;
var panelResizeStartX = 0;
var panelResizeStartY = 0;
var panelResizeStartW = 0;
var panelResizeStartH = 0;
var expandedLogIndex = -1;

// ============================================================
// CSS — 已提取到 panel-css.js，此处仅调用
// ============================================================
injectPanelCSS();

// ============================================================
// HTML — Dual-column layout
// ============================================================
function injectPanelHTML() {
  if (document.getElementById('__ds-agent-panel')) return;

  // Pet ball
  var pet = document.createElement('div');
  pet.id = '__ds-pet-ball';
  pet.innerHTML = '<span id="__ds-pet-dot"></span>\uD83E\uDD16';
  pet.title = 'AI Tool Agent v0.1.1  |  Click to toggle panel  |  Ctrl+Shift+D';
  pet.addEventListener('mousedown', startPetDrag);
  document.body.appendChild(pet);

  // Main panel + resize handle
  var panel = document.createElement('div');
  panel.id = '__ds-agent-panel';
  panel.innerHTML = buildPanelHTML();
  document.body.appendChild(panel);

  var resizeHandle = document.createElement('div');
  resizeHandle.id = '__ds-resize-handle';
  resizeHandle.title = 'Drag to resize';
  resizeHandle.addEventListener('mousedown', startPanelResize);
  document.getElementById('__ds-agent-panel').appendChild(resizeHandle);

  // Modal overlay (contains QA modal)
  var overlay = document.createElement('div');
  overlay.id = '__ds-modal-overlay';
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = buildQAModalHTML();
  overlay.addEventListener('click', function(e) { if (e.target === overlay) hideAllModals(); });
  document.body.appendChild(overlay);

  bindPanelEvents();

  // 设置平台徽章
  var platformBadge = document.getElementById('__ds-platform-badge');
  if (platformBadge) {
    var p = getPlatform();
    if (p) {
      platformBadge.textContent = p.name || p.id;
      platformBadge.title = 'Platform: ' + (p.name || p.id);
    } else {
      platformBadge.textContent = '?';
      platformBadge.title = 'Unknown platform';
    }
  }
}

function buildPanelHTML() {
  return [
    '<div id="__ds-header">',
    '  <div id="__ds-header-left">',
    '    <span id="__ds-logo" class="ds-logo">[AI]</span>',
    '    <span id="__ds-title">Tool Agent</span>',
    '    <span id="__ds-version">v0.1.1</span>',
    '  </div>',
    '  <div id="__ds-status">',
    '    <span id="__ds-dot"></span>',
    '    <span id="__ds-status-text">Checking...</span>',
    '    <span id="__ds-platform-badge" class="ds-sse-badge" title="Current AI Platform" style="background:#6366f1;color:#fff;">--</span>',
    '    <span id="__ds-sse-badge" class="ds-sse-badge" title="SSE Stream Intercept Mode">SSE</span>',
    '  </div>',
    '  <div id="__ds-header-btns">',
    '    <button class="ds-hbtn" id="__ds-btn-minimize" title="Minimize">&#8722;</button>',
    '    <button class="ds-hbtn" id="__ds-btn-close" title="Close">&times;</button>',
    '  </div>',
    '</div>',

    '<div id="__ds-body">',
    '  <!-- Left Column: Tabs (Tools & Skills | Workspace) -->',
    '  <div id="__ds-col-left">',
    '    <div class="ds-left-tabs">',
    '      <button class="ds-left-tab active" data-tab="tools">&#128295; Tools</button>',
    '      <button class="ds-left-tab" data-tab="workspace">&#128193; Workspace</button>',
    '    </div>',
    '    <!-- Tools & Skills Panel -->',
    '    <div class="ds-left-panel active" id="__ds-left-tools">',
    '      <div class="ds-col-header">',
    '        <span class="ds-col-title">Tools &amp; Skills</span>',
    '        <div class="ds-search-wrap">',
    '          <span class="ds-search-icon">&#128269;</span>',
    '          <input class="ds-search-input" id="__ds-tool-search" placeholder="Search tools..." />',
    '        </div>',
    '      </div>',
    '      <div class="ds-tool-list" id="__ds-tools-container"><div class="ds-empty-state"><span class="ds-empty-icon">&#9881;</span><div class="ds-empty-text">Loading tools...</div><div class="ds-empty-hint">Connect to server to load available tools</div></div></div>',
    '      <div class="ds-skills-list" id="__ds-skills-container"></div>',
    '      <button class="ds-add-skill-btn" id="__ds-btn-add-skill">+ Add Skill</button>',
    '    </div>',
    '    <!-- Workspace File Browser Panel -->',
    '    <div class="ds-left-panel" id="__ds-left-workspace">',
    '      <div class="ds-col-header">',
    '        <span class="ds-col-title">Workspace Files</span>',
    '        <button class="ds-fe-refresh" id="__ds-btn-ws-refresh" title="Refresh">&#8635;</button>',
    '      </div>',
    '      <div id="__ds-fe-current-path" class="ds-fe-current-path"></div>',
    '      <div id="__ds-file-tree"><div class="__ds-file-loading">Waiting for server connection...</div></div>',
    '      <div id="__ds-file-preview" class="__ds-hidden">',
    '        <div class="__ds-preview-header">',
    '          <span class="__ds-preview-title" id="__ds-preview-filename"></span>',
    '          <button class="__ds-preview-close" id="__ds-btn-preview-close">&times;</button>',
    '        </div>',
    '        <pre class="__ds-preview-content" id="__ds-preview-content"></pre>',
    '      </div>',
    '    </div>',
    '  </div>',

    '  <!-- Right Column: Live Logs -->',
    '  <div id="__ds-col-right">',
    '    <div class="ds-col-header">',
    '      <span class="ds-col-title">Live Logs</span>',
    '      <button class="ds-more-btn" id="__ds-btn-log-more">&#8943;</button>',
    '    </div>',
    '    <div id="__ds-log-tabs">',
    '      <button class="ds-log-tab active" data-level="all">All</button>',
    '      <button class="ds-log-tab" data-level="info">Info</button>',
    '      <button class="ds-log-tab" data-level="warn">Warn</button>',
    '      <button class="ds-log-tab" data-level="error">Error</button>',
    '    </div>',
    '    <div class="ds-log-toolbar">',
    '      <span></span>',
    '      <div style="display:flex;gap:6px;">',
    '        <button class="ds-log-tb-btn" id="__ds-btn-export">Export</button>',
    '        <button class="ds-log-tb-btn" id="__ds-btn-clear">Clear</button>',
    '      </div>',
    '    </div>',
    '    <div id="__ds-log-area"><div style="padding:16px;color:var(--cr-fallback-color-on-surface-subtle);text-align:center;">No logs yet</div></div>',
    '    <div class="ds-log-scroll-btn active" id="__ds-btn-autoscroll">&#8964; auto-scroll</div>',
    '  </div>',
    '</div>',

    '<div id="__ds-bottom-bar">',
    '  <div id="__ds-builtin-btns">',
    '    <button class="ds-qbtn ds-qbtn-builtin" id="__ds-btn-inject-tools" title="从服务器获取最新工具列表并注入提示词">&#128295; 工具提示词</button>',
    '    <button class="ds-qbtn ds-qbtn-builtin" id="__ds-btn-init-memory" title="检测记忆状态：空则初始化，有则恢复">&#129504; 记忆管理</button>',
    '    <button class="ds-qbtn ds-qbtn-builtin" id="__ds-btn-retry-tool" title="让AI重试上一次失败的工具调用">&#128260; 工具重试</button>',
    '  </div>',
    '  <div id="__ds-quick-btns"></div>',
    '  <div id="__ds-status-line">',
    '    <span id="__ds-agent-status-text">Agent Not Ready</span>',
    '    <button class="ds-edit-btn" id="__ds-btn-edit-qa" title="Edit Quick Actions">&#9998;</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function buildQAModalHTML() {
  return [
    '<div id="__ds-qa-modal" class="ds-modal" style="display:none;">',
    '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">',
    '    <div class="ds-modal-title">Edit Quick Actions (max 5)</div>',
    '    <button class="ds-hbtn" id="__ds-qa-close" style="font-size:14px;">&times;</button>',
    '  </div>',
    '  <div id="__ds-qa-entries"></div>',
    '  <div class="ds-modal-actions">',
    '    <button class="ds-btn ds-btn-secondary ds-btn-sm" id="__ds-qa-cancel">Cancel</button>',
    '    <button class="ds-btn ds-btn-primary ds-btn-sm" id="__ds-qa-save">Save</button>',
    '  </div>',
    '</div>'
  ].join('');
}

// ============================================================
// Event bindings
// ============================================================
function bindPanelEvents() {
  // Header
  var minBtn = document.getElementById('__ds-btn-minimize');
  if (minBtn) minBtn.onclick = function() { togglePanel(false); };
  var closeBtn = document.getElementById('__ds-btn-close');
  if (closeBtn) closeBtn.onclick = function() { togglePanel(false); };
  var header = document.getElementById('__ds-header');
  if (header) header.addEventListener('mousedown', startPanelDrag);

  // Left column tabs
  var leftTabs = document.querySelectorAll('.ds-left-tab');
  for (var i = 0; i < leftTabs.length; i++) {
    leftTabs[i].addEventListener('click', function() {
      var tab = this.getAttribute('data-tab');
      switchLeftTab(tab);
    });
  }

  // Workspace refresh
  var wsRefreshBtn = document.getElementById('__ds-btn-ws-refresh');
  if (wsRefreshBtn) wsRefreshBtn.onclick = function() { loadFileBrowser(); };

  // Preview close
  var previewCloseBtn = document.getElementById('__ds-btn-preview-close');
  if (previewCloseBtn) previewCloseBtn.onclick = function() { closeFilePreview(); };

  // Search
  var searchInput = document.getElementById('__ds-tool-search');
  if (searchInput) {
    var _searchTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function() { renderToolCardsFiltered(searchInput.value.trim()); }, 200);
    });
  }

  // Log tabs
  var logTabs = document.querySelectorAll('.ds-log-tab');
  for (var i = 0; i < logTabs.length; i++) {
    logTabs[i].addEventListener('click', function() {
      logTabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      logLevelFilter = this.getAttribute('data-level') || 'all';
      renderLogs();
    });
  }

  // Log toolbar
  var exportBtn = document.getElementById('__ds-btn-export');
  if (exportBtn) exportBtn.onclick = function() { exportLogs(); };
  var clearBtn = document.getElementById('__ds-btn-clear');
  if (clearBtn) clearBtn.onclick = function() {
    executionHistory = []; renderLogs(); logPanel('info', 'Logs cleared');
  };

  // Auto scroll toggle
  var asBtn = document.getElementById('__ds-btn-autoscroll');
  if (asBtn) asBtn.onclick = function() {
    autoScroll = !autoScroll;
    this.classList.toggle('active', autoScroll);
    this.innerHTML = autoScroll ? '&#8964; auto-scroll' : '&#9644; paused';
    if (autoScroll) scrollToLogBottom();
  };

  // Quick actions edit
  var editQABtn = document.getElementById('__ds-btn-edit-qa');
  if (editQABtn) editQABtn.onclick = function() { showQAEditor(window.__ds_quickActions || []); };

  var btnInjectTools = document.getElementById('__ds-btn-inject-tools');
  if (btnInjectTools) btnInjectTools.onclick = function() {
    logPanel('info', '🛠 注入工具提示词...');
    if (window.injectToolPrompt) window.injectToolPrompt();
    else logPanel('error', 'injectToolPrompt 未加载');
  };

  var btnInitMemory = document.getElementById('__ds-btn-init-memory');
  if (btnInitMemory) btnInitMemory.onclick = function() {
    logPanel('info', '🧠 检测记忆状态...');
    if (window.smartAgentAction) window.smartAgentAction();
    else logPanel('error', 'smartAgentAction 未加载');
  };

  var btnRetryTool = document.getElementById('__ds-btn-retry-tool');
  if (btnRetryTool) btnRetryTool.onclick = function() {
    logPanel('info', '🔄 发送工具重试提示...');
    if (window.retryToolPrompt) window.retryToolPrompt();
    else logPanel('error', 'retryToolPrompt 未加载');
  };

  // Add skill
  var addSkillBtn = document.getElementById('__ds-btn-add-skill');
  if (addSkillBtn) addSkillBtn.onclick = function() {
    logPanel('info', 'Skill creation: use AI skill-creator or add manually via config');
  };

  // QA Modal
  var qaSave = document.getElementById('__ds-qa-save');
  if (qaSave) qaSave.onclick = saveQuickActions;
  var qaCancel = document.getElementById('__ds-qa-cancel');
  if (qaCancel) qaCancel.onclick = hideAllModals;
  var qaClose = document.getElementById('__ds-qa-close');
  if (qaClose) qaClose.onclick = hideAllModals;

  // Keyboard shortcut: Ctrl+Shift+D to toggle panel
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      togglePanel();
    }
  });
}

// ============================================================
// Pet ball drag
// ============================================================
function startPetDrag(e) {
  if (e.button !== 0) return;
  petDragging = true;
  petDragStartX = e.clientX; petDragStartY = e.clientY;
  var pet = document.getElementById('__ds-pet-ball');
  var rect = pet.getBoundingClientRect();
  petOffsetX = e.clientX - rect.left; petOffsetY = e.clientY - rect.top;
  pet.style.transition = 'none';
  document.addEventListener('mousemove', petDragMove);
  document.addEventListener('mouseup', petDragEnd);
  e.preventDefault();
}
function petDragMove(e) {
  if (!petDragging) return;
  var pet = document.getElementById('__ds-pet-ball');
  var vw = window.innerWidth, vh = window.innerHeight;
  pet.style.left = Math.min(Math.max(e.clientX - petOffsetX, 0), vw - 48) + 'px';
  pet.style.right = 'auto'; pet.style.bottom = 'auto';
  pet.style.top = Math.min(Math.max(e.clientY - petOffsetY, 0), vh - 48) + 'px';
}
function petDragEnd(e) {
  if (!petDragging) return;
  petDragging = false;
  var dx = Math.abs(e.clientX - petDragStartX), dy = Math.abs(e.clientY - petDragStartY);
  var pet = document.getElementById('__ds-pet-ball');
  pet.style.transition = 'transform .15s';
  if (dx < 5 && dy < 5) togglePanel();
  document.removeEventListener('mousemove', petDragMove);
  document.removeEventListener('mouseup', petDragEnd);
}

// ============================================================
// Panel drag
// ============================================================
var panelDragging = false, panelOffX = 0, panelOffY = 0;
function startPanelDrag(e) {
  if (e.button !== 0 || e.target.closest('button')) return;
  panelDragging = true;
  var p = document.getElementById('__ds-agent-panel'), r = p.getBoundingClientRect();
  panelOffX = e.clientX - r.left; panelOffY = e.clientY - r.top;
  p.style.transition = 'none';
  document.addEventListener('mousemove', panelDragMove);
  document.addEventListener('mouseup', panelDragEnd);
  e.preventDefault();
}
function panelDragMove(e) {
  if (!panelDragging) return;
  var p = document.getElementById('__ds-agent-panel'), vw = window.innerWidth, vh = window.innerHeight;
  p.style.right = 'auto'; p.style.bottom = 'auto';
  p.style.left = Math.min(Math.max(e.clientX - panelOffX, 0), vw - 680) + 'px';
  p.style.top = Math.min(Math.max(e.clientY - panelOffY, 0), vh - 480) + 'px';
}
function panelDragEnd() {
  if (!panelDragging) return;
  panelDragging = false;
  document.getElementById('__ds-agent-panel').style.transition = '';
  document.removeEventListener('mousemove', panelDragMove);
  document.removeEventListener('mouseup', panelDragEnd);
}

// ============================================================
// Panel resize
// ============================================================
function startPanelResize(e) {
  if (e.button !== 0) return;
  panelResizing = true;
  panelResizeStartX = e.clientX;
  panelResizeStartY = e.clientY;
  var p = document.getElementById('__ds-agent-panel');
  panelResizeStartW = p.offsetWidth;
  panelResizeStartH = p.offsetHeight;
  p.style.transition = 'none';
  document.addEventListener('mousemove', panelResizeMove);
  document.addEventListener('mouseup', panelResizeEnd);
  e.preventDefault();
  e.stopPropagation();
}
function panelResizeMove(e) {
  if (!panelResizing) return;
  var p = document.getElementById('__ds-agent-panel');
  var newW = Math.max(420, Math.min(panelResizeStartW + e.clientX - panelResizeStartX, window.innerWidth - 20));
  var newH = Math.max(320, Math.min(panelResizeStartH + e.clientY - panelResizeStartY, window.innerHeight - 40));
  p.style.width = newW + 'px';
  p.style.height = newH + 'px';
}
function panelResizeEnd() {
  if (!panelResizing) return;
  panelResizing = false;
  document.getElementById('__ds-agent-panel').style.transition = '';
  document.removeEventListener('mousemove', panelResizeMove);
  document.removeEventListener('mouseup', panelResizeEnd);
}

// ============================================================
// Left column tab switching
// ============================================================
function switchLeftTab(tab) {
  leftColumnTab = tab;
  var tabs = document.querySelectorAll('.ds-left-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
  }
  var panels = document.querySelectorAll('.ds-left-panel');
  for (var j = 0; j < panels.length; j++) {
    var panelId = panels[j].id;
    var isActive = (tab === 'tools' && panelId === '__ds-left-tools') || (tab === 'workspace' && panelId === '__ds-left-workspace');
    panels[j].classList.toggle('active', isActive);
  }
  if (tab === 'workspace') {
    loadFileBrowser();
  }
}

// ============================================================
// Toggle panel visibility
// ============================================================
function togglePanel(show) {
  var panel = document.getElementById('__ds-agent-panel');
  var pet = document.getElementById('__ds-pet-ball');
  if (!panel || !pet) { console.warn('[DS] togglePanel: elements not found', !!panel, !!pet); return; }

  var isOpen = panel.classList.contains('visible');

  if (show === true && !isOpen) {
    openPanel(panel, pet);
  } else if (show === false && isOpen) {
    closePanel(panel, pet);
  } else if (show === undefined) {
    if (isOpen) { closePanel(panel, pet); }
    else { openPanel(panel, pet); }
  }
}

function openPanel(panel, pet) {
  panel.classList.add('visible');
  panel.style.display = 'flex';
  pet.classList.add('visible');
  loadPanelData();
}

function closePanel(panel, pet) {
  panel.classList.remove('visible');
  panel.style.display = 'none';
  pet.classList.remove('visible');
  pet.style.left = '';
  pet.style.right = '';
  pet.style.top = '';
  pet.style.bottom = '';
}

async function loadPanelData() {
  var serverOnline = false;
  try {
    if (window.checkServerHealth) {
      var r = await window.checkServerHealth();
      serverOnline = r && r.healthy;
      updateServerStatusUI(serverOnline);
    }
  } catch(e) {}
  if (serverOnline) {
    try { if (window.loadTools) window.loadTools(); } catch(e) {}
    try { if (window.loadSkills) window.loadSkills(); } catch(e) {}
    try { if (window.loadQuickActions) window.loadQuickActions(); } catch(e) {}
  }
  renderLogs();
}

// ============================================================
// Tool cards rendering (with mode cycling)
// ============================================================
var MODE_CYCLE = ['auto', 'manual', 'off'];
var MODE_LABELS = { auto: 'AUTO', manual: 'MANUAL', off: 'OFF' };
var MODE_ICON = { auto: '\u26A1', manual: '\u25CF', off: '\u25CB' };
var MODE_CLASS = { auto: 'ds-mode-auto', manual: 'ds-mode-manual', off: 'ds-mode-off' };

function renderToolsList(tools) {
  if (!tools || !Array.isArray(tools)) return;
  agentTools = tools;
  renderToolCardsFiltered('');
}

function renderToolCardsFiltered(query) {
  var container = document.getElementById('__ds-tools-container');
  if (!container) return;
  var q = (query || '').toLowerCase();
  var filtered = agentTools.filter(function(t) {
    return !q || (t.name || '').toLowerCase().indexOf(q) >= 0 || (t.description || '').toLowerCase().indexOf(q) >= 0;
  });
  if (filtered.length === 0) {
    container.innerHTML = '<div class="ds-empty-state"><span class="ds-empty-icon">&#128269;</span><div class="ds-empty-text">' +
      (q ? 'No tools match "' + escapeAttr(q) + '"' : 'No tools loaded') + '</div><div class="ds-empty-hint">' +
      (q ? 'Try a different search term' : 'Connect to the server to load tools') + '</div></div>';
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var tool = filtered[i];
    var mode = tool.mode || 'off';
    html += '<div class="ds-tool-card" data-tool="' + escapeAttr(tool.name) + '">';
    html += '<span class="ds-tool-icon">' + (MODE_ICON[mode] || '\u25CB') + '</span>';
    html += '<div class="ds-tool-info">';
    html += '<div class="ds-tool-name">' + escapeAttr(tool.name) + '</div>';
    html += '<div class="ds-tool-desc">' + escapeAttr(tool.description || '') + '</div>';
    html += '</div>';
    html += '<span class="ds-tool-mode ' + (MODE_CLASS[mode] || 'ds-mode-off') + '" data-tool="' + escapeAttr(tool.name) + '">' + (MODE_LABELS[mode] || 'OFF') + '</span>';
    html += '<span class="ds-tool-add" data-tool="' + escapeAttr(tool.name) + '">+</span>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Mode cycle click
  var modeEls = container.querySelectorAll('.ds-tool-mode');
  for (var j = 0; j < modeEls.length; j++) {
    modeEls[j].onclick = (function(el) {
      return function() {
        var tName = el.getAttribute('data-tool');
        var currentMode = el.textContent.trim().toUpperCase();
        var idx = MODE_CYCLE.indexOf(currentMode.toLowerCase());
        var nextIdx = (idx + 1) % MODE_CYCLE.length;
        var nextMode = MODE_CYCLE[nextIdx];
        el.textContent = MODE_LABELS[nextMode];
        el.className = 'ds-tool-mode ' + MODE_CLASS[nextMode];
        el.parentNode.querySelector('.ds-tool-icon').textContent = MODE_ICON[nextMode];
        if (window.__ds_onToolModeChange) window.__ds_onToolModeChange(tName, nextMode);
      };
    })(modeEls[j]);
  }
}

// ============================================================
// Skills rendering
// ============================================================
function renderSkillsList(skills, customSkills) {
  if (!skills) skills = [];
  if (!Array.isArray(skills)) return;
  agentSkills = skills;
  agentCustomSkills = customSkills || [];
  var container = document.getElementById('__ds-skills-container');
  if (!container) return;
  if (skills.length === 0) { container.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < skills.length; i++) {
    var sk = skills[i];
    var enabled = sk.enabled !== undefined ? sk.enabled : false;
    html += '<div class="ds-skill-row">';
    html += '<span class="ds-skill-name">' + escapeAttr(sk.name) + '</span>';
    html += '<div class="ds-skill-toggle" data-skill="' + escapeAttr(sk.dirName || sk.name) + '" data-enabled="' + enabled + '">';
    html += '<div class="ds-toggle-pill ' + (enabled ? 'on' : 'off') + '"><div class="ds-toggle-knob"></div></div>';
    html += '</div></div>';
  }
  container.innerHTML = html;

  var toggles = container.querySelectorAll('.ds-skill-toggle');
  for (var j = 0; j < toggles.length; j++) {
    toggles[j].onclick = (function(el) {
      return function() {
        var sName = el.getAttribute('data-skill');
        var curEnabled = el.getAttribute('data-enabled') === 'true';
        var newEnabled = !curEnabled;
        el.setAttribute('data-enabled', String(newEnabled));
        var pill = el.querySelector('.ds-toggle-pill');
        pill.className = 'ds-toggle-pill ' + (newEnabled ? 'on' : 'off');
        if (window.__ds_toggleSkill) window.__ds_toggleSkill(sName, newEnabled);
      };
    })(toggles[j]);
  }
}

// ============================================================
// Quick actions (bottom bar)
// ============================================================
function updateQuickActionButtons(actions) {
  if (!actions) actions = [];
  window.__ds_quickActions = actions;
  quickActions = actions;
  var container = document.getElementById('__ds-quick-btns');
  if (!container) return;
  if (actions.length === 0) {
    container.innerHTML = '<span style="color:var(--cr-fallback-color-on-surface-subtle);font-size:var(--cr-font-size-xs);">No quick actions</span>';
    return;
  }
  var icons = ['\u229E', '\u2600', '\u274C'];
  var html = '';
  for (var i = 0; i < actions.length; i++) {
    html += '<button class="ds-qbtn" data-qa-index="' + i + '">';
    html += '<span class="ds-qbtn-icon">' + (icons[i % icons.length] || '\u229E') + '</span>';
    html += escapeAttr(actions[i].label || 'Action ' + (i+1));
    html += '</button>';
  }
  container.innerHTML = html;
  var btns = container.querySelectorAll('.ds-qbtn');
  for (var j = 0; j < btns.length; j++) {
    btns[j].onclick = (function(idx) {
      return function() {
        if (window.triggerQuickAction) window.triggerQuickAction(idx);
      };
    })(parseInt(btns[j].getAttribute('data-qa-index')));
  }
  updateStatusBar();
}

function updateStatusBar() {
  var statusEl = document.getElementById('__ds-agent-status-text');
  if (!statusEl) return;
  var autoCount = 0;
  for (var i = 0; i < agentTools.length; i++) {
    if ((agentTools[i].mode || 'off') === 'auto') autoCount++;
  }
  statusEl.innerHTML = '<span class="ds-online">Ready</span> &middot; ' + agentTools.length + ' tools &middot; ' + autoCount + ' auto';
}

// ============================================================
// Agent state
// ============================================================
function updateAgentPanelUI(initialized) {
  updateStatusBar();
  updateQuickActionButtons(window.__ds_quickActions || []);
}

// ============================================================
// Logs
// ============================================================
function renderLogs() {
  var area = document.getElementById('__ds-log-area');
  if (!area) return;
  if (!executionHistory || executionHistory.length === 0) {
    area.innerHTML = '<div class="ds-empty-state"><span class="ds-empty-icon">&#128240;</span><div class="ds-empty-text">No logs yet</div><div class="ds-empty-hint">Agent activity will appear here in real-time</div></div>';
    return;
  }
  var recent = executionHistory.slice(-200);
  var filtered = recent;
  if (logLevelFilter && logLevelFilter !== 'all') {
    filtered = recent.filter(function(l) { return l.level === logLevelFilter; });
  }
  if (filtered.length === 0) {
    area.innerHTML = '<div class="ds-empty-state"><span class="ds-empty-icon">&#128269;</span><div class="ds-empty-text">No ' + logLevelFilter + ' logs</div><div class="ds-empty-hint">Switch to a different filter level</div></div>';
    return;
  }
  var html = '';
  var countByLevel = { info: 0, warn: 0, error: 0, success: 0 };
  for (var i = 0; i < filtered.length; i++) {
    var log = filtered[i];
    var cls = 'ds-badge-' + (log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : log.level === 'success' ? 'success' : 'info');
    var logIndex = executionHistory.indexOf(log);
    var isExpanded = logIndex === expandedLogIndex;
    html += '<div class="ds-log-entry' + (isExpanded ? ' ds-log-expanded' : '') + '" data-log-index="' + logIndex + '">';
    html += '<span class="ds-log-time">' + escapeAttr(log.time || '--:--') + '</span>';
    html += '<span class="ds-log-badge ' + cls + '">' + (log.level || 'info') + '</span>';
    html += '<span class="ds-log-msg">' + escapeAttr(log.message || '') + '</span>';
    if (isExpanded && log.detail) {
      html += '<div class="ds-log-detail">' + escapeAttr(log.detail) + '</div>';
    }
    html += '</div>';
    countByLevel[log.level] = (countByLevel[log.level] || 0) + 1;
  }
  html += '<div class="ds-log-count-bar">';
  html += '<span class="ds-log-count">' + filtered.length + ' entries</span>';
  if (countByLevel.error > 0) html += '<span class="ds-log-count ds-log-count-error">' + countByLevel.error + ' errors</span>';
  if (countByLevel.warn > 0) html += '<span class="ds-log-count ds-log-count-warn">' + countByLevel.warn + ' warns</span>';
  html += '</div>';
  area.innerHTML = html;

  var entries = area.querySelectorAll('.ds-log-entry');
  for (var j = 0; j < entries.length; j++) {
    entries[j].addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-log-index'));
      expandedLogIndex = expandedLogIndex === idx ? -1 : idx;
      renderLogs();
    });
  }

  if (autoScroll) scrollToLogBottom();
}

function scrollToLogBottom() {
  var area = document.getElementById('__ds-log-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function exportLogs() {
  if (!executionHistory || executionHistory.length === 0) { logPanel('warn', 'No logs to export'); return; }
  var text = '=== AI Tool Agent Logs ===\n';
  for (var i = 0; i < executionHistory.length; i++) {
    text += '[' + (executionHistory[i].time || '--:--') + '] [' + (executionHistory[i].level || 'info').toUpperCase() + '] ' + (executionHistory[i].message || '') + '\n';
  }
  var blob = new Blob([text], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'agent-logs-' + Date.now() + '.txt'; a.click();
  URL.revokeObjectURL(url);
  logPanel('info', 'Logs exported');
}

// logPanel is defined in core/logger.js (loaded first)

// ============================================================
// Server status
// ============================================================
// updateServerStatusUI and setStageText are defined in connection.js (loaded first)

function updateSSEIndicator(active) {
  var badge = document.getElementById('__ds-sse-badge');
  if (!badge) return;
  if (active) {
    badge.classList.add('active');
    badge.title = 'SSE Stream Intercept: Active (v0.1.1)';
  } else {
    badge.classList.remove('active');
    badge.title = 'SSE Stream Intercept: Idle (v0.1.1)';
  }
}

// ============================================================
// QA Editor modal
// ============================================================
function showQAEditor(actions) {
  if (!actions || !Array.isArray(actions)) actions = [];
  var modal = document.getElementById('__ds-qa-modal');
  var overlay = document.getElementById('__ds-modal-overlay');
  if (!modal || !overlay) return;
  hideAllModals();
  overlay.classList.add('show');
  modal.style.display = 'block';
  var entries = document.getElementById('__ds-qa-entries');
  if (!entries) return;
  var html = '';
  var count = Math.max(actions.length, 2);
  for (var i = 0; i < count; i++) {
    var act = actions[i] || { label: '', prompt: '' };
    html += '<div class="ds-qa-entry">';
    html += '<div class="ds-form-group"><label class="ds-form-label">Label</label>';
    html += '<input class="ds-form-input ds-qa-label" value="' + escapeAttr(act.label || '') + '" placeholder="e.g. Summarize chat" /></div>';
    html += '<div class="ds-form-group"><label class="ds-form-label">Prompt</label>';
    html += '<textarea class="ds-form-input ds-qa-prompt" rows="2" placeholder="Prompt AI receives...">' + escapeAttr(act.prompt || '') + '</textarea></div>';
    html += '</div>';
  }
  entries.innerHTML = html;
}

async function saveQuickActions() {
  var entries = document.querySelectorAll('#__ds-qa-entries .ds-qa-entry');
  var actions = [];
  for (var i = 0; i < entries.length; i++) {
    var label = entries[i].querySelector('.ds-qa-label');
    var prompt = entries[i].querySelector('.ds-qa-prompt');
    if (label && prompt && label.value.trim() && prompt.value.trim()) {
      actions.push({ label: label.value.trim(), prompt: prompt.value.trim() });
    }
  }
  if (actions.length === 0) { alert('Need at least one valid action'); return; }
  if (actions.length > 5) { alert('Max 5 actions'); return; }
  window.__ds_quickActions = actions;
  updateQuickActionButtons(actions);
  if (window.__ds_saveQuickActions) await window.__ds_saveQuickActions(actions);
  hideAllModals();
  logPanel('info', 'Quick actions saved');
}

function hideAllModals() {
  var overlay = document.getElementById('__ds-modal-overlay');
  if (overlay) overlay.classList.remove('show');
  var modal = document.getElementById('__ds-qa-modal');
  if (modal) modal.style.display = 'none';
}

// ============================================================
// Utility
// ============================================================
function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
// Exports to window (for actions.js / external callers)
// ============================================================
window.injectOperationPanel = injectPanelHTML;
window.renderToolsList = renderToolsList;
window.renderSkillsList = renderSkillsList;
window.updateAgentPanelUI = updateAgentPanelUI;
window.renderLogs = renderLogs;
window.updateQuickActionButtons = updateQuickActionButtons;
window.showQuickActionsEditor = showQAEditor;
window.hideAllModals = hideAllModals;
window.updateSSEIndicator = updateSSEIndicator;
window.switchLeftTab = switchLeftTab;
window.__ds_retryConnect = function() { logPanel('info', '手动重试连接...'); if (typeof window.ensureServerRunning === 'function') window.ensureServerRunning(); };

// ============================================================
// Auto init
// ============================================================
(function() {
  if (document.getElementById('__ds-agent-panel')) return;
  injectPanelCSS();
  injectPanelHTML();
  var pet = document.getElementById('__ds-pet-ball');
  var panel = document.getElementById('__ds-agent-panel');

  var __ds_healthTimer = null;

  function startHealthPolling() {
    if (__ds_healthTimer) clearInterval(__ds_healthTimer);
    function check() {
      try {
        if (window.checkServerStatus) {
          window.checkServerStatus();
        } else if (window.checkServerHealth) {
          window.checkServerHealth().then(function(r) { updateServerStatusUI(r && r.healthy); });
        }
      } catch(e) {}
    }
    check();
    __ds_healthTimer = setInterval(check, 30000);
  }

  setTimeout(function() {
    startHealthPolling();
  }, 1000);
})();
