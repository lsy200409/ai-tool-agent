// ============================================================
// DS Tool Agent Manager v2.5 — Popup Logic
// Chrome Extension Popup: storage bridge, 9 pages, CRUD
// ============================================================

(function() {
'use strict';

var CONFIG_KEY = 'ds_agent_config';
var API_BASE = 'http://localhost:3002';
var DEFAULT_CONFIG = {
  apiBaseUrl: 'http://localhost:3002',
  apiKey: '',
  timeout: 10,
  wsUrl: '',
  tools: [],
  skills: [],
  quickActions: [
    { label: '总结对话', command: '请总结我们目前的对话。' },
    { label: '重试工具', command: '上次工具调用失败，请使用正确的参数重试。' },
    { label: '新建对话', command: '开始一个新的对话上下文。' }
  ],
  logLevel: 'all',
  maxLogEntries: 500,
  desktopNotification: false,
  theme: 'light',
  panelPosition: 'br',
  draggable: true,
  fontSize: 13
};

var config = {};
var debounceTimers = {};

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  loadConfig();
  bindNavigation();
  bindConnectionPage();
  bindToolsPage();
  bindSkillsPage();
  bindQuickActionsPage();
  bindLogsPage();
  bindAppearancePage();
  bindDataPage();
  bindAboutPage();
  bindCloseButton();

  // Listen for storage changes from other contexts
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'sync' && changes[CONFIG_KEY]) {
      config = changes[CONFIG_KEY].newValue || {};
      refreshCurrentPage();
    }
  });
});

function loadConfig() {
  chrome.storage.sync.get(CONFIG_KEY, function(result) {
    config = result[CONFIG_KEY] || Object.assign({}, DEFAULT_CONFIG);
    applyConfigToUI();
  });
}

function saveConfig(key, value) {
  if (key) {
    config[key] = value;
  }
  // Debounce: batch saves within 300ms
  clearTimeout(debounceTimers._save);
  debounceTimers._save = setTimeout(function() {
    var toSave = Object.assign({}, DEFAULT_CONFIG, config);
    chrome.storage.sync.set({ ds_agent_config: toSave }, function() {
      showToast('已保存');
    });
  }, 300);
}

function syncToolToBackend(tool) {
  var baseUrl = config.apiBaseUrl || API_BASE;
  fetch(baseUrl + '/api/agent/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', tool: { name: tool.name, description: tool.description, defaultMode: tool.defaultMode, category: 'custom' } })
  }).catch(function() {});
}

function deleteToolFromBackend(name) {
  var baseUrl = config.apiBaseUrl || API_BASE;
  fetch(baseUrl + '/api/agent/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', name: name })
  }).catch(function() {});
}

function syncSkillToBackend(skill) {
  var baseUrl = config.apiBaseUrl || API_BASE;
  fetch(baseUrl + '/api/agent/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', name: skill.name, description: skill.description, content: skill.template || '' })
  }).catch(function() {});
}

function deleteSkillFromBackend(name) {
  var baseUrl = config.apiBaseUrl || API_BASE;
  fetch(baseUrl + '/api/agent/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', name: name })
  }).catch(function() {});
}

function syncQuickActionsToBackend() {
  var baseUrl = config.apiBaseUrl || API_BASE;
  var actions = (config.quickActions || []).map(function(a) {
    return { label: a.label, prompt: a.command };
  });
  fetch(baseUrl + '/api/agent/quick-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', actions: actions })
  }).catch(function() {});
}

function debounceSave(key) {
  return function(value) {
    config[key] = value;
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(function() {
      var toSave = Object.assign({}, DEFAULT_CONFIG, config);
      chrome.storage.sync.set({ ds_agent_config: toSave });
    }, 300);
  };
}

// ============================================================
// Navigation
// ============================================================
function bindNavigation() {
  var navItems = document.querySelectorAll('.pm-nav-item');
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function() {
      var page = this.getAttribute('data-page');
      switchPage(page);
      navItems.forEach(function(n) { n.classList.remove('active'); });
      this.classList.add('active');
    });
  }
}

function switchPage(pageName) {
  var pages = document.querySelectorAll('.pm-page');
  for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');
  var target = document.getElementById('pm-page-' + pageName);
  if (target) target.classList.add('active');

  // Load data for page
  if (pageName === 'tools') renderToolsList();
  if (pageName === 'skills') renderSkillsList();
  if (pageName === 'quickactions') renderQAList();
  if (pageName === 'logs') renderLogPreview();
}

function refreshCurrentPage() {
  var activeNav = document.querySelector('.pm-nav-item.active');
  if (activeNav) switchPage(activeNav.getAttribute('data-page'));
}

function applyConfigToUI() {
  // Connection page
  var apiUrl = document.getElementById('pm-api-url');
  if (apiUrl) apiUrl.value = config.apiBaseUrl || '';
  var apiKey = document.getElementById('pm-api-key');
  if (apiKey) apiKey.value = config.apiKey || '';
  var timeout = document.getElementById('pm-timeout');
  if (timeout) timeout.value = config.timeout || 10;
  var wsUrl = document.getElementById('pm-ws-url');
  if (wsUrl) wsUrl.value = config.wsUrl || '';

  // Logs page
  var maxLogs = document.getElementById('pm-max-logs');
  if (maxLogs) maxLogs.value = config.maxLogEntries || 500;
  setToggleState('pm-toggle-notif', !!config.desktopNotification);

  // Appearance
  var theme = document.getElementById('pm-theme');
  if (theme) theme.value = config.theme || 'light';
  var panelPos = document.getElementById('pm-panel-pos');
  if (panelPos) panelPos.value = config.panelPosition || 'br';
  setToggleState('pm-toggle-drag', config.draggable !== false);
  var fontSize = document.getElementById('pm-font-size');
  if (fontSize) fontSize.value = config.fontSize || 13;

  renderToolsList();
  renderSkillsList();
  renderQAList();
  renderLogPreview();
}

function setToggleState(id, on) {
  var el = document.getElementById(id);
  if (!el) return;
  var track = el.querySelector('.pm-toggle-track');
  if (track) track.className = 'pm-toggle-track' + (on ? ' on' : '');
}

// ============================================================
// CONNECTION PAGE
// ============================================================
function bindConnectionPage() {
  var showKeyBtn = document.getElementById('pm-btn-showkey');
  if (showKeyBtn) showKeyBtn.addEventListener('click', function() {
    var keyInput = document.getElementById('pm-api-key');
    if (keyInput) {
      keyInput.type = (keyInput.type === 'password') ? 'text' : 'password';
      this.textContent = (keyInput.type === 'password') ? '显示' : '隐藏';
    }
  });

  // Debounced inputs
  bindInputDebounced('pm-api-url', 'apiBaseUrl');
  bindInputDebounced('pm-api-key', 'apiKey');
  bindInputDebounced('pm-ws-url', 'wsUrl');

  var timeoutInput = document.getElementById('pm-timeout');
  if (timeoutInput) timeoutInput.addEventListener('input', function() {
    var v = parseInt(this.value);
    if (v >= 1 && v <= 30) {
      saveConfig('timeout', v);
      this.classList.remove('error');
    } else {
      this.classList.add('error');
    }
  });

  var testBtn = document.getElementById('pm-btn-test-conn');
  if (testBtn) testBtn.addEventListener('click', testConnection);
}

function testConnection() {
  var url = (document.getElementById('pm-api-url').value || '').trim();
  var dot = document.getElementById('pm-conn-dot');
  var status = document.getElementById('pm-conn-status');
  if (!dot || !status) return;

  dot.className = 'pm-dot pm-dot-grey';
  status.textContent = '检测中...';

  fetch(url + '/health', { signal: AbortSignal.timeout(3000) })
    .then(function(r) {
      if (r.ok) {
        dot.className = 'pm-dot pm-dot-green';
        status.textContent = '已连接';
        showToast('连接成功');
        saveConfig();
      } else {
        throw new Error('HTTP ' + r.status);
      }
    })
    .catch(function(e) {
      dot.className = 'pm-dot pm-dot-red';
      status.textContent = '失败: ' + (e.message || '超时');
      showToast('连接失败');
    });
}

// ============================================================
// TOOLS PAGE
// ============================================================
function bindToolsPage() {
  var addBtn = document.getElementById('pm-btn-add-tool');
  if (addBtn) addBtn.addEventListener('click', function() {
    showToolModal(null);
  });
}

function renderToolsList() {
  var container = document.getElementById('pm-tools-list');
  if (!container) return;
  var tools = config.tools || [];

  if (tools.length === 0) {
    container.innerHTML = '<div class="pm-empty">未配置工具</div>';
    return;
  }

  var html = '<div class="pm-list-header"><span style="flex:1">工具</span><span style="width:70px;text-align:center">模式</span><span style="width:60px"></span></div>';
  for (var i = 0; i < tools.length; i++) {
    var t = tools[i];
    var modeClass = t.defaultMode === 'auto' ? 'pm-badge-auto' : t.defaultMode === 'manual' ? 'pm-badge-manual' : 'pm-badge-off';
    html += '<div class="pm-list-row">';
    html += '<span class="pm-list-name">' + esc(t.name) + '</span>';
    html += '<span class="pm-list-desc">' + esc((t.description || '').substring(0, 50)) + '</span>';
    html += '<span class="pm-list-action"><span class="pm-badge ' + modeClass + '">' + (t.defaultMode || 'OFF').toUpperCase() + '</span></span>';
    html += '<span class="pm-list-action"><button class="pm-btn pm-btn-sm" data-edit-tool="' + i + '">&#9998;</button></span>';
    html += '<span class="pm-list-action"><button class="pm-btn pm-btn-sm pm-btn-danger" data-del-tool="' + i + '">&#10005;</button></span>';
    html += '</div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('[data-edit-tool]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-edit-tool'));
      showToolModal(config.tools[idx]);
    });
  });

  container.querySelectorAll('[data-del-tool]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-del-tool'));
      if (confirm('删除工具 "' + (config.tools[idx] || {}).name + '"？')) {
        var toolName = config.tools[idx].name;
        config.tools.splice(idx, 1);
        saveConfig();
        renderToolsList();
        deleteToolFromBackend(toolName);
        showToast('工具已删除');
      }
    });
  });
}

function showToolModal(tool) {
  var isEdit = !!tool;
  var title = isEdit ? '编辑工具' : '添加工具';
  var nameVal = isEdit ? (tool.name || '') : '';
  var descVal = isEdit ? (tool.description || '') : '';
  var tmplVal = isEdit ? (tool.template || '') : '';
  var modeVal = isEdit ? (tool.defaultMode || 'off') : 'off';

  showModal(title, [
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">名称 *</label>',
    '<input class="pm-input" id="pm-modal-t-name" value="' + esc(nameVal) + '" placeholder="例如: file_search" /></div>',
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">描述</label>',
    '<input class="pm-input" id="pm-modal-t-desc" value="' + esc(descVal) + '" /></div>',
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">模板 *</label>',
    '<textarea class="pm-input" id="pm-modal-t-template" rows="3" placeholder="{{input}} -> 工具输出">' + esc(tmplVal) + '</textarea></div>',
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">默认模式</label>',
    '<select class="pm-input pm-select" id="pm-modal-t-mode">',
    '  <option value="auto"' + (modeVal === 'auto' ? ' selected' : '') + '>自动</option>',
    '  <option value="manual"' + (modeVal === 'manual' ? ' selected' : '') + '>手动</option>',
    '  <option value="off"' + (modeVal === 'off' ? ' selected' : '') + '>关闭</option>',
    '</select></div>'
  ].join(''), function(close) {
    var name = document.getElementById('pm-modal-t-name').value.trim();
    var desc = document.getElementById('pm-modal-t-desc').value.trim();
    var template = document.getElementById('pm-modal-t-template').value.trim();
    var mode = document.getElementById('pm-modal-t-mode').value;

    if (!name || !template) { showToast('名称和模板为必填项'); return; }

    var entry = { name: name, description: desc, template: template, defaultMode: mode };
    if (!config.tools) config.tools = [];

    if (isEdit) {
      var idx = config.tools.findIndex(function(t) { return t.name === tool.name; });
      if (idx >= 0) config.tools[idx] = entry;
    } else {
      config.tools.push(entry);
    }

    saveConfig();
    renderToolsList();
    syncToolToBackend(entry);
    showToast(isEdit ? '工具已更新' : '工具已添加');
    if (close) close();
  });
}

// ============================================================
// SKILLS PAGE
// ============================================================
function bindSkillsPage() {
  var addBtn = document.getElementById('pm-btn-add-skill');
  if (addBtn) addBtn.addEventListener('click', function() {
    showSkillModal(null);
  });
}

function renderSkillsList() {
  var container = document.getElementById('pm-skills-list');
  if (!container) return;
  var skills = config.skills || [];

  if (skills.length === 0) {
    container.innerHTML = '<div class="pm-empty">未配置技能</div>';
    return;
  }

  var html = '<div class="pm-list-header"><span style="flex:1">技能</span><span style="width:60px;text-align:center">状态</span><span style="width:50px"></span></div>';
  for (var i = 0; i < skills.length; i++) {
    var s = skills[i];
    var enabled = s.enabled;
    var badgeClass = enabled ? 'pm-badge-on' : 'pm-badge-off2';
    html += '<div class="pm-list-row">';
    html += '<span class="pm-list-name">' + esc(s.name) + '</span>';
    html += '<span class="pm-list-desc">' + esc((s.description || '').substring(0, 50)) + '</span>';
    html += '<span class="pm-list-action"><span class="pm-badge ' + badgeClass + '">' + (enabled ? 'ON' : 'OFF') + '</span></span>';
    html += '<span class="pm-list-action"><button class="pm-btn pm-btn-sm pm-btn-danger" data-del-skill="' + i + '">&#10005;</button></span>';
    html += '</div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('[data-del-skill]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-del-skill'));
      if (confirm('删除技能 "' + (config.skills[idx] || {}).name + '"？')) {
        var skillName = config.skills[idx].name;
        config.skills.splice(idx, 1);
        saveConfig();
        renderSkillsList();
        deleteSkillFromBackend(skillName);
        showToast('技能已删除');
      }
    });
  });
}

function showSkillModal(skill) {
  var isEdit = !!skill;
  var nameVal = isEdit ? (skill.name || '') : '';
  var descVal = isEdit ? (skill.description || '') : '';
  var tmplVal = isEdit ? (skill.template || '') : '';
  var enabledVal = isEdit ? (skill.enabled || false) : false;

  showModal(isEdit ? '编辑技能' : '添加技能', [
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">名称 *</label>',
    '<input class="pm-input" id="pm-modal-s-name" value="' + esc(nameVal) + '" placeholder="技能名称" /></div>',
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">描述</label>',
    '<input class="pm-input" id="pm-modal-s-desc" value="' + esc(descVal) + '" /></div>',
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:block;font-size:11px;color:#5f6368;margin-bottom:4px">模板 *</label>',
    '<textarea class="pm-input" id="pm-modal-s-template" rows="3" placeholder="技能提示词/指令">' + esc(tmplVal) + '</textarea></div>',
    '<div style="margin-bottom:12px"><label class="pm-form-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="pm-modal-s-enabled" ' + (enabledVal ? 'checked' : '') + '> 默认启用</label></div>'
  ].join(''), function(close) {
    var name = document.getElementById('pm-modal-s-name').value.trim();
    var desc = document.getElementById('pm-modal-s-desc').value.trim();
    var template = document.getElementById('pm-modal-s-template').value.trim();
    var enabled = document.getElementById('pm-modal-s-enabled').checked;

    if (!name || !template) { showToast('名称和模板为必填项'); return; }

    var entry = { name: name, description: desc, template: template, enabled: enabled };
    if (!config.skills) config.skills = [];

    if (isEdit) {
      var idx = config.skills.findIndex(function(s) { return s.name === skill.name; });
      if (idx >= 0) config.skills[idx] = entry;
    } else {
      config.skills.push(entry);
    }

    saveConfig();
    renderSkillsList();
    syncSkillToBackend(entry);
    showToast(isEdit ? '技能已更新' : '技能已添加');
    if (close) close();
  });
}

// ============================================================
// QUICK ACTIONS PAGE
// ============================================================
function bindQuickActionsPage() {
  var addBtn = document.getElementById('pm-btn-add-qa');
  if (addBtn) addBtn.addEventListener('click', function() {
    if (!config.quickActions) config.quickActions = [];
    if (config.quickActions.length >= 5) { showToast('最多5个快捷操作'); return; }
    config.quickActions.push({ label: '', command: '' });
    saveConfig();
    renderQAList();
    syncQuickActionsToBackend();
    // Focus new last item
    setTimeout(function() {
      var inputs = document.querySelectorAll('.pm-qa-label-input');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 50);
  });

  var importBtn = document.getElementById('pm-btn-import-preset');
  if (importBtn) importBtn.addEventListener('click', function() {
    var PRESETS = [
      { label: '总结对话', command: '请简洁地总结我们目前的对话。' },
      { label: '翻译选中内容', command: '将选中的文本翻译为中文。' },
      { label: '解释代码', command: '详细解释选中的代码。' },
      { label: '修复错误', command: '分析错误并提供修复方案。' },
      { label: '提取任务', command: '从对话中提取所有待办事项。' }
    ];
    if (confirm('用预设替换当前快捷操作？')) {
      config.quickActions = PRESETS.slice(0, 5);
      saveConfig();
      renderQAList();
      syncQuickActionsToBackend();
      showToast('预设已导入');
    }
  });
}

function renderQAList() {
  var container = document.getElementById('pm-qa-list');
  if (!container) return;
  var actions = config.quickActions || [];

  if (actions.length === 0) {
    container.innerHTML = '<div class="pm-empty">无快捷操作，点击"+ 添加"创建。</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    html += '<div style="border:1px solid var(--cr-outline);border-radius:var(--cr-radius-sm);padding:10px;margin-bottom:8px;background:var(--cr-surface)">';
    html += '<div style="display:flex;gap:8px;margin-bottom:6px">';
    html += '<input class="pm-input pm-qa-label-input" data-qa-idx="' + i + '" data-field="label" value="' + esc(a.label || '') + '" placeholder="Label" style="flex:1" />';
    html += '<button class="pm-btn pm-btn-sm pm-btn-danger" data-del-qa="' + i + '" title="Remove">&#10005;</button>';
    html += '</div>';
    html += '<textarea class="pm-input pm-qa-cmd-textarea" data-qa-idx="' + i + '" data-field="command" rows="2" placeholder="Command/prompt...">' + esc(a.command || '') + '</textarea>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Bind input events (debounce per field)
  container.querySelectorAll('.pm-qa-label-input, .pm-qa-cmd-textarea').forEach(function(input) {
    input.addEventListener('input', function() {
      var idx = parseInt(this.getAttribute('data-qa-idx'));
      var field = this.getAttribute('data-field');
      if (!config.quickActions[idx]) config.quickActions[idx] = {};
      config.quickActions[idx][field] = this.value;
      saveConfig();
      clearTimeout(debounceTimers._qaSync);
      debounceTimers._qaSync = setTimeout(function() { syncQuickActionsToBackend(); }, 2000);
    });
  });

  container.querySelectorAll('[data-del-qa]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-del-qa'));
      config.quickActions.splice(idx, 1);
      saveConfig();
      renderQAList();
      syncQuickActionsToBackend();
    });
  });
}

// ============================================================
// LOGS PAGE
// ============================================================
function bindLogsPage() {
  // Log level tabs
  var logTabs = document.querySelectorAll('#pm-log-filter-tabs .pm-log-tab');
  logTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      logTabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      config.logLevel = this.getAttribute('data-level') || 'all';
      saveConfig();
      renderLogPreview();
    });
  });

  // Set initial active tab based on config
  logTabs.forEach(function(tab) {
    if (tab.getAttribute('data-level') === (config.logLevel || 'all')) tab.click();
  });

  // Max logs
  var maxLogs = document.getElementById('pm-max-logs');
  if (maxLogs) maxLogs.addEventListener('input', function() {
    var v = parseInt(this.value);
    if (v >= 50 && v <= 2000) {
      config.maxLogEntries = v;
      saveConfig();
      this.classList.remove('error');
    } else {
      this.classList.add('error');
    }
  });

  // Notification toggle
  var notifToggle = document.getElementById('pm-toggle-notif');
  if (notifToggle) notifToggle.addEventListener('click', function() {
    var track = this.querySelector('.pm-toggle-track');
    var isOn = !track.classList.contains('on');
    track.classList.toggle('on', isOn);
    config.desktopNotification = isOn;
    if (isOn && chrome.permissions) {
      chrome.permissions.request({ permissions: ['notifications'] }, function(granted) {
        if (!granted) {
          track.classList.remove('on');
          config.desktopNotification = false;
          showToast('桌面通知权限被拒绝');
        }
      });
    }
    saveConfig();
  });
  setToggleState('pm-toggle-notif', !!config.desktopNotification);

  // Export
  var exportBtn = document.getElementById('pm-btn-export-logs');
  if (exportBtn) exportBtn.addEventListener('click', exportLogsFromBG);

  // Clear
  var clearBtn = document.getElementById('pm-btn-clear-logs');
  if (clearBtn) clearBtn.addEventListener('click', function() {
    if (confirm('清除所有日志？')) {
      chrome.runtime.sendMessage({ action: 'clearLogs' }, function() {
        showToast('日志已清除');
        renderLogPreview();
      });
    }
  });
}

function renderLogPreview() {
  var preview = document.getElementById('pm-log-preview');
  if (!preview) return;

  chrome.runtime.sendMessage({ action: 'getLogs' }, function(logs) {
    if (!logs || !logs.length || !Array.isArray(logs)) {
      preview.innerHTML = '<div class="pm-empty" style="padding:20px">暂无日志</div>';
      return;
    }

    var levelFilter = config.logLevel || 'all';
    var filtered = levelFilter === 'all' ? logs : logs.filter(function(l) { return l.level === levelFilter; });
    var recent = filtered.slice(-20);

    if (recent.length === 0) {
      preview.innerHTML = '<div class="pm-empty" style="padding:20px">无 "' + levelFilter + '" 级别日志</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < recent.length; i++) {
      var l = recent[i];
      var cls = l.level === 'error' ? 'color:#d93025' : l.level === 'warn' ? 'color:#b06000' : l.level === 'success' ? 'color:#1e8e3e' : '';
      html += '<div style="padding:2px 0;border-bottom:1px solid #f0f0f0;font-size:11px;display:flex;gap:6px">';
      html += '<span style="color:#9aa0a6;flex-shrink:0">' + (l.time || '--:--') + '</span>';
      html += '<span style="font-weight:600;flex-shrink:0;width:40px;' + cls + '">' + (l.level || '?') + '</span>';
      html += '<span style="word-break:break-all">' + esc(l.message || '') + '</span>';
      html += '</div>';
    }
    preview.innerHTML = html;
    preview.scrollTop = preview.scrollHeight;
  });
}

function exportLogsFromBG() {
  chrome.runtime.sendMessage({ action: 'getLogs' }, function(logs) {
    if (!logs || !logs.length) { showToast('没有日志可导出'); return; }
    var text = '=== DS-Agent Logs (' + new Date().toISOString() + ') ===\n\n';
    for (var i = 0; i < logs.length; i++) {
      text += '[' + (logs[i].time || '--:--') + '] [' + (logs[i].level || 'info').toUpperCase() + '] ' + (logs[i].message || '') + '\n';
    }
    downloadText(text, 'agent-logs-' + Date.now() + '.txt');
    showToast('日志已导出');
  });
}

// ============================================================
// APPEARANCE PAGE
// ============================================================
function bindAppearancePage() {
  var themeSel = document.getElementById('pm-theme');
  if (themeSel) themeSel.addEventListener('change', function() {
    config.theme = this.value;
    saveConfig();
    updateAppearancePreview();
  });

  var posSel = document.getElementById('pm-panel-pos');
  if (posSel) posSel.addEventListener('change', function() {
    config.panelPosition = this.value;
    saveConfig();
  });

  var dragToggle = document.getElementById('pm-toggle-drag');
  if (dragToggle) dragToggle.addEventListener('click', function() {
    var track = this.querySelector('.pm-toggle-track');
    var isOn = !track.classList.contains('on');
    track.classList.toggle('on', isOn);
    config.draggable = isOn;
    saveConfig();
  });

  var fontSlider = document.getElementById('pm-font-size');
  if (fontSlider) fontSlider.addEventListener('input', function() {
    config.fontSize = parseInt(this.value);
    saveConfig();
    updateAppearancePreview();
  });
}

function updateAppearancePreview() {
  var preview = document.getElementById('pm-appearance-preview');
  if (!preview) return;
  var fontSize = config.fontSize || 13;
  var posMap = { br: 'bottom-right', bl: 'bottom-left', tr: 'top-right', tl: 'top-left' };
  var posLabel = posMap[config.panelPosition] || 'bottom-right';

  preview.style.fontSize = fontSize + 'px';
  preview.innerHTML = [
    '<div style="width:100%;border:1px solid var(--cr-outline);border-radius:8px;padding:8px;background:' + (config.theme === 'dark' ? '#202124' : '#fff') + ';color:' + (config.theme === 'dark' ? '#e8eaed' : '#202124') + '">',
    '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:500;">',
    '    <span>[DS] Agent Preview</span>',
    '    <span style="font-size:10px;color:#9aa0a6">' + posLabel + ' &middot; draggable=' + (config.draggable !== false) + '</span>',
    '  </div>',
    '  <div style="display:flex;gap:4px">',
    '    <span style="background:#e8f0fe;color:#1a73e8;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600">HOME</span>',
    '    <span style="padding:2px 8px;border-radius:10px;font-size:10px;color:#5f6368">TOOLS</span>',
    '    <span style="padding:2px 8px;border-radius:10px;font-size:10px;color:#5f6368">LOGS</span>',
    '  </div>',
    '</div>'
  ].join('');
}

// ============================================================
// DATA PAGE
// ============================================================
function bindDataPage() {
  var exportCfg = document.getElementById('pm-btn-export-config');
  if (exportCfg) exportCfg.addEventListener('click', function() {
    var fullConfig = Object.assign({}, DEFAULT_CONFIG, config);
    downloadText(JSON.stringify(fullConfig, null, 2), 'ds-agent-config-' + Date.now() + '.json');
    showToast('配置已导出');
  });

  var importCfg = document.getElementById('pm-btn-import-config');
  var fileInput = document.getElementById('pm-file-import');
  if (importCfg && fileInput) {
    importCfg.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        try {
          var imported = JSON.parse(ev.target.result);
          if (typeof imported === 'object' && imported !== null) {
            config = Object.assign(config, imported);
            saveConfig();
            applyConfigToUI();
            showToast('配置导入成功');
          }
        } catch(err) {
          showToast('无效的 JSON 文件');
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  var resetBtn = document.getElementById('pm-btn-reset-default');
  if (resetBtn) resetBtn.addEventListener('click', function() {
    if (confirm('恢复所有设置为默认值？')) {
      config = Object.assign({}, DEFAULT_CONFIG);
      saveConfig();
      applyConfigToUI();
      showToast('已恢复默认设置');
    }
  });

  var clearAllBtn = document.getElementById('pm-btn-clear-all');
  if (clearAllBtn) clearAllBtn.addEventListener('click', function() {
    var input = prompt('输入 DELETE 确认清除所有数据：');
    if (input === 'DELETE') {
      chrome.storage.sync.clear(function() {
        config = Object.assign({}, DEFAULT_CONFIG);
        saveConfig();
        applyConfigToUI();
        showToast('所有数据已清除');
      });
    } else if (input !== null) {
      showToast('确认失败');
    }
  });
}

// ============================================================
// ABOUT PAGE
// ============================================================
function bindAboutPage() {
  var diagBtn = document.getElementById('pm-btn-diagnose');
  if (diagBtn) diagBtn.addEventListener('click', function() {
    var info = [
      '=== DS-Agent Diagnostics ===',
      'Version: 2.5.0',
      'Manifest: MV3',
      'Storage Key: ' + CONFIG_KEY,
      'Config keys: ' + Object.keys(config).join(', '),
      'Tools: ' + (config.tools || []).length,
      'Skills: ' + (config.skills || []).length,
      'Quick Actions: ' + (config.quickActions || []).length,
      'Theme: ' + (config.theme || 'light'),
      'Panel Position: ' + (config.panelPosition || 'br'),
      'Date: ' + new Date().toISOString()
    ].join('\n');

    copyToClipboard(info);
    showToast('诊断信息已复制到剪贴板');
  });

  var ghBtn = document.getElementById('pm-btn-open-github');
  if (ghBtn) ghBtn.addEventListener('click', function() {
    chrome.tabs.create({ url: 'https://github.com' });
  });
}

// ============================================================
// CLOSE BUTTON
// ============================================================
function bindCloseButton() {
  var closeBtn = document.getElementById('pm-btn-close');
  if (closeBtn) closeBtn.addEventListener('click', function() {
    window.close();
  });
}

// ============================================================
// MODAL SYSTEM
// ============================================================
function showModal(title, bodyHtml, onSave) {
  var overlay = document.getElementById('pm-modal-overlay');
  var content = document.getElementById('pm-modal-content');
  if (!overlay || !content) return;

  content.innerHTML = [
    '<div class="pm-modal-title">' + esc(title) + '</div>',
    bodyHtml,
    '<div class="pm-modal-actions">',
    '  <button class="pm-btn pm-btn-sm" id="pm-modal-cancel">取消</button>',
    '  <button class="pm-btn pm-btn-primary pm-btn-sm" id="pm-modal-save">保存</button>',
    '</div>'
  ].join('');

  overlay.classList.add('show');

  document.getElementById('pm-modal-cancel').onclick = hideModal;
  document.getElementById('pm-modal-save').onclick = function() {
    if (onSave) onSave(hideModal);
  };
}

function hideModal() {
  var overlay = document.getElementById('pm-modal-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ============================================================
// TOAST
// ============================================================
var toastTimer = null;
function showToast(msg) {
  var toast = document.getElementById('pm-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2000);
}

// ============================================================
// UTILITIES
// ============================================================
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function bindInputDebounced(elementId, configKey) {
  var el = document.getElementById(elementId);
  if (!el) return;
  var saver = debounceSave(configKey);
  el.addEventListener('input', function() { saver(this.value); });
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  } else {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function downloadText(text, filename) {
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

})();
