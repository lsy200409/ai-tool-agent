// ============================================================
// DeepSeek Tool Agent v2.5 — Actions (纯 API + 辅助函数)
// 不包含 UI 渲染代码，所有UI由 panel.js 负责
// ============================================================

var API_BASE = 'http://localhost:3002';
var FETCH_TIMEOUT = 5000;

function apiFetch(path, body) {
  var options = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  try { options.signal = AbortSignal.timeout(FETCH_TIMEOUT); } catch(e) {}
  return fetch(API_BASE + path, options);
}

function apiPost(path, body) { return apiFetch(path, body); }
function apiGet(path) { return apiFetch(path, null); }
function apiJson(path, body) { return apiFetch(path, body).then(function(r) { return r.json(); }); }
function apiGetJson(path) { return apiGet(path).then(function(r) { return r.json(); }); }

// ============================================================
// Agent 初始化
// ============================================================
async function initAgent() {
  var btn = document.getElementById('__ds-btn-agent-init');
  var reinitBtn = document.getElementById('__ds-btn-reinit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 初始化中...'; }
  if (reinitBtn) { reinitBtn.disabled = true; reinitBtn.textContent = '⏳ 重新初始化中...'; }

  console.log('[actions] initAgent 开始');
  logPanel('info', '正在初始化 Agent...');

  try {
    var memResp = await apiJson('/api/agent/memory', { action: 'init' });
    if (memResp.success) logPanel('success', '记忆系统已初始化');
    else logPanel('warn', '初始化记忆: ' + (memResp.message || memResp.error || '未知状态'));
  } catch(e) { logPanel('warn', '初始化记忆异常: ' + e.message); }

  try {
    var persResp = await apiJson('/api/agent/personality', { action: 'reset' });
    if (persResp.success) logPanel('success', '人格已重置为默认');
    else logPanel('warn', '重置人格: ' + (persResp.message || persResp.error || '未知状态'));
  } catch(e) { logPanel('warn', '重置人格异常: ' + e.message); }

  var initPrompt = buildInitAgentPrompt();
  var input = findChatInput();
  if (input) {
    setInputValue(input, initPrompt);
    await sleep(600);
    clickSendButton();
    logPanel('success', '初始化提示词已注入并发送');
  } else {
    logPanel('error', '找不到 DeepSeek 输入框');
  }

  autoMode = true;
  autoWatchRunning = true;
  if (typeof window.__ds_startMonitor === 'function') window.__ds_startMonitor();
  setStageText('监听中');
  updateAutoButtonState();

  if (btn) { btn.disabled = false; btn.textContent = '🚀 初始化 Agent'; }
  if (reinitBtn) { reinitBtn.disabled = false; reinitBtn.textContent = '🔄 重新初始化'; }

  // 同步完整状态到面板
  await syncFullState();
}

function buildInitAgentPrompt() {
  var lines = [];
  lines.push('## Agent 初始化流程');
  lines.push('');
  lines.push('你刚刚完成了初始化。请按以下步骤了解你的工作环境：');
  lines.push('');
  lines.push('### 第一步：了解工作区');
  lines.push('使用 list_dir 工具列出工作区根目录，了解项目结构。');
  lines.push('');
  lines.push('### 第二步：了解可用工具');
  lines.push('- read_file: 读取本地文件内容');
  lines.push('- write_file: 写入内容到本地文件');
  lines.push('- list_dir: 列出指定目录下的文件和子目录');
  lines.push('- exec_command: 执行命令行并返回输出');
  lines.push('- append_file: 追加内容到本地文件末尾');
  lines.push('- search_files: 在指定目录中搜索文件名匹配的文件');
  lines.push('- get_file_info: 获取文件详细信息（大小、修改时间等）');
  lines.push('');
  lines.push('### 第三步：技能系统');
  lines.push('工作区 skills/ 目录下有可用的技能（SKILL.md 格式）。');
  lines.push('使用 list_dir 查看 skills/ 目录，然后读取你感兴趣的 SKILL.md 文件。');
  lines.push('');
  lines.push('### 第四步：工具调用格式');
  lines.push('调用工具时使用以下 XML 格式：');
  lines.push('<tool_call name="工具名">');
  lines.push('{"参数名":"参数值"}');
  lines.push('</tool_call>');
  lines.push('');
  lines.push('请先执行 list_dir 查看工作区内容和技能列表，然后告诉我你看到了什么。');
  return lines.join('\n');
}

// ============================================================
// 快捷操作
// ============================================================
async function triggerQuickAction(promptOrIndex) {
  var prompt;

  // 支持两种调用方式：传字符串直接使用，传数字从后端获取
  if (typeof promptOrIndex === 'number') {
    console.log('[actions] triggerQuickAction index=' + promptOrIndex);
    try {
      var resp = await apiGetJson('/api/agent/quick-actions');
      if (resp.success && resp.actions && resp.actions.length > promptOrIndex) {
        prompt = resp.actions[promptOrIndex].prompt;
        logPanel('info', '触发快捷操作: ' + resp.actions[promptOrIndex].label);
      } else {
        logPanel('warn', '快捷操作不可用 (index=' + promptOrIndex + ')');
        return;
      }
    } catch(e) {
      logPanel('error', '触发快捷操作失败: ' + e.message);
      return;
    }
  } else if (typeof promptOrIndex === 'string') {
    prompt = promptOrIndex;
    logPanel('info', '快捷操作: ' + prompt.substring(0, 60));
  } else {
    logPanel('warn', '无效的快捷操作参数');
    return;
  }

  var input = findChatInput();
  if (input) {
    setInputValue(input, prompt);
    await sleep(500);
    clickSendButton();
    logPanel('success', '快捷操作已发送');
  } else {
    logPanel('error', '找不到 DeepSeek 输入框');
  }
}

// ============================================================
// 人格管理 (纯 API，不操作 DOM)
// ============================================================
async function loadPersonality() {
  try {
    var data = await apiGetJson('/api/agent/personality');
    if (data.success) return data.personality;
  } catch(e) { logPanel('error', '加载人格失败: ' + e.message); }
  return null;
}

async function savePersonality(personality) {
  try {
    var data = await apiJson('/api/agent/personality', { action: 'save', personality: personality });
    if (data.success) { logPanel('success', '人格配置已保存'); return true; }
    logPanel('error', '保存人格失败');
  } catch(e) { logPanel('error', '保存人格失败: ' + e.message); }
  return false;
}

async function resetPersonality() {
  try {
    var data = await apiJson('/api/agent/personality', { action: 'reset' });
    if (data.success) logPanel('success', '人格已重置');
    return data.success;
  } catch(e) { logPanel('error', '重置人格失败: ' + e.message); }
  return false;
}

// ============================================================
// 记忆管理
// ============================================================
async function initMemory() {
  try {
    var data = await apiJson('/api/agent/memory', { action: 'init' });
    if (data.success) logPanel('success', '记忆系统已初始化');
    return data.success;
  } catch(e) { logPanel('error', '初始化记忆失败: ' + e.message); }
  return false;
}

async function loadMemory() {
  try {
    var data = await apiJson('/api/agent/memory', { action: 'load' });
    if (data.success) logPanel('success', '记忆已加载 (共 ' + (data.entry_count || 0) + ' 条)');
    return data;
  } catch(e) { logPanel('error', '加载记忆失败: ' + e.message); }
  return null;
}

async function clearMemory() {
  try {
    var data = await apiJson('/api/agent/memory', { action: 'clear' });
    if (data.success) logPanel('success', '记忆已清除');
    return true;
  } catch(e) { logPanel('error', '清除记忆失败: ' + e.message); }
  return false;
}

async function saveMemory(key, data) {
  try {
    var result = await apiJson('/api/agent/memory', { action: 'save', key: key, data: data });
    if (result.success) logPanel('success', '记忆已保存: ' + key);
    else logPanel('error', '保存记忆失败: ' + (result.message || '未知错误'));
  } catch(e) { logPanel('error', '保存记忆失败: ' + e.message); }
}

// ============================================================
// 技能管理
// ============================================================
async function loadSkills() {
  try {
    var data = await apiGetJson('/api/agent/skills');
    if (data.success && data.skills) {
      renderSkillsList(data.skills, data.custom_skills || []);
      logPanel('success', '技能列表已加载 (共 ' + data.skills.length + ' 个)');
      return data;
    }
    logPanel('error', '加载技能失败');
  } catch(e) { logPanel('error', '加载技能失败: ' + e.message); }
  return null;
}

async function toggleSkill(name, enabled) {
  try {
    var data = await apiJson('/api/agent/skills', { action: 'toggle', name: name, enabled: enabled });
    if (data.success) logPanel('success', '技能 ' + name + ' 已' + (enabled ? '启用' : '禁用'));
    else logPanel('error', '切换技能失败: ' + (data.message || data.error || ''));
    return data.success;
  } catch(e) { logPanel('error', '切换技能失败: ' + e.message); }
  return false;
}

async function createSkill(name, description, content) {
  try {
    var data = await apiJson('/api/agent/skills', { action: 'create', name: name, description: description || '', content: content || '' });
    if (data.success) { logPanel('success', '技能 ' + name + ' 已创建'); loadSkills(); return true; }
    logPanel('error', '创建技能失败: ' + (data.message || data.error || ''));
  } catch(e) { logPanel('error', '创建技能失败: ' + e.message); }
  return false;
}

async function deleteSkill(name) {
  try {
    var data = await apiJson('/api/agent/skills', { action: 'delete', name: name });
    if (data.success) { logPanel('success', '技能 ' + name + ' 已删除'); loadSkills(); return true; }
    logPanel('error', '删除技能失败: ' + (data.message || data.error || ''));
  } catch(e) { logPanel('error', '删除技能失败: ' + e.message); }
  return false;
}

// ============================================================
// 工具管理
// ============================================================
async function loadTools() {
  try {
    var data = await apiGetJson('/api/agent/tools');
    if (data.success && data.tools) {
      renderToolsList(data.tools);
      return data.tools;
    }
    logPanel('error', '加载工具失败');
  } catch(e) { logPanel('error', '加载工具失败: ' + e.message); }
  return [];
}

async function setToolMode(name, mode) {
  try {
    var data = await apiJson('/api/agent/tools', { action: 'set_mode', name: name, mode: mode });
    if (data.success) logPanel('success', '工具 ' + name + ' 模式已设为 ' + mode);
    else logPanel('error', '设置工具模式失败: ' + (data.message || data.error || ''));
    return data.success;
  } catch(e) { logPanel('error', '设置工具模式失败: ' + e.message); }
  return false;
}

// ============================================================
// 快捷操作 API
// ============================================================
async function loadQuickActions() {
  try {
    var data = await apiGetJson('/api/agent/quick-actions');
    if (data.success && data.actions) {
      updateQuickActionButtons(data.actions);
      return data.actions;
    }
  } catch(e) { logPanel('error', '加载快捷操作失败: ' + e.message); }
  return [];
}

async function saveQuickActions(actions) {
  try {
    var data = await apiJson('/api/agent/quick-actions', { action: 'save', actions: actions });
    if (data.success) { logPanel('success', '快捷操作已保存'); updateQuickActionButtons(actions); return true; }
    logPanel('error', '保存快捷操作失败: ' + (data.message || data.error || ''));
  } catch(e) { logPanel('error', '保存快捷操作失败: ' + e.message); }
  return false;
}

// ============================================================
// 系统管理
// ============================================================
async function checkServerHealth() {
  try {
    var data = await apiGetJson('/health');
    return data.status === 'ok' ? { healthy: true, data: data } : { healthy: false, data: data };
  } catch(e) { return { healthy: false }; }
}

async function testConnection() {
  logPanel('info', '正在测试连接...');
  try {
    var data = await apiGetJson('/health');
    if (data.status === 'ok') {
      updateServerStatusUI(true);
      logPanel('success', '连接测试通过 (PID: ' + data.pid + ')');
      return true;
    }
    updateServerStatusUI(false);
    logPanel('warn', '连接测试失败');
  } catch(e) {
    updateServerStatusUI(false);
    logPanel('error', '连接测试失败: ' + e.message);
  }
  return false;
}

async function updateWorkspacePath(newPath) {
  logPanel('info', '正在更新工作区路径: ' + newPath);
  try {
    var data = await apiJson('/api/config', { action: 'set-workspace', path: newPath });
    if (data.success) { logPanel('success', '工作区已更新: ' + newPath); return true; }
    logPanel('error', '更新工作区失败: ' + (data.error || ''));
  } catch(e) { logPanel('error', '更新工作区失败: ' + e.message); }
  return false;
}

async function openPermissions() {
  try {
    var data = await apiJson('/api/config', { action: 'open-permissions' });
    if (data.success) { logPanel('warn', '写入权限已开放'); return true; }
    logPanel('error', '开放权限失败');
  } catch(e) { logPanel('error', '开放权限失败: ' + e.message); }
  return false;
}

async function restrictPermissions() {
  try {
    var data = await apiJson('/api/config', { action: 'restrict-permissions' });
    if (data.success) { logPanel('info', '权限已恢复限制'); return true; }
    logPanel('error', '限制权限失败');
  } catch(e) { logPanel('error', '限制权限失败: ' + e.message); }
  return false;
}

async function getConfig() {
  try {
    var data = await apiJson('/api/config', { action: 'get' });
    return data.success ? data : null;
  } catch(e) { return null; }
}

// ============================================================
// 面板同步
// ============================================================
async function syncFullState() {
  console.log('[actions] syncFullState 开始');
  logPanel('info', '正在同步完整状态...');
  try {
    var status = await apiGetJson('/api/agent/status');
    if (status.success) {
      updateAgentPanelUI(status.initialized === true);
      if (status.tools) renderToolsList(status.tools);
      if (status.skills) renderSkillsList(status.skills, status.custom_skills || []);
      try { var actions = await loadQuickActions(); updateQuickActionButtons(actions); } catch(qaErr) {}
      updateServerStatusUI(true);
      logPanel('success', '状态同步完成');
      return status;
    }
    logPanel('warn', '状态同步失败');
  } catch(e) { logPanel('error', '状态同步失败: ' + e.message); }
  return null;
}

// ============================================================
// 导出日志
// ============================================================
function exportLogsDownload() {
  if (!executionHistory || executionHistory.length === 0) {
    logPanel('warn', '没有可导出的日志');
    return;
  }
  var lines = [];
  for (var i = 0; i < executionHistory.length; i++) {
    var log = executionHistory[i];
    lines.push('[' + (log.time || '') + '] [' + (log.level || 'info') + '] ' + (log.message || ''));
  }
  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'agent-logs-' + new Date().toISOString().split('T')[0] + '.txt';
  a.click();
  URL.revokeObjectURL(url);
  logPanel('success', '日志已导出');
}

// ============================================================
// 工具端点映射
// ============================================================
function getToolEndpoint(toolName) {
  return {
    path: '/exec',
    body: function(args) { return { tool: toolName, args: args }; }
  };
}

// ============================================================
// 本地日志 (供旧代码兼容)
// ============================================================
function persistLocalLogs() {}
function getLocalLogs() { return []; }

window.__ds_viewRawLogs = function() {
  persistLocalLogs();
  var logs = getLocalLogs();
  var previewEl = document.getElementById('__ds-log-preview-area');
  if (!previewEl) return;
  previewEl.textContent = logs.length === 0 ? '(无本地日志)' : logs.slice(-100).join('\n');
  previewEl.scrollTop = previewEl.scrollHeight;
};

// ============================================================
// 导出到 window（供 panel.js 调用）
// ============================================================
window.__ds_initAgent = initAgent;
window.__ds_exportLogs = exportLogsDownload;
window.__ds_onToolModeChange = setToolMode;
window.__ds_updateWorkspace = updateWorkspacePath;
window.__ds_syncFullState = syncFullState;
window.__ds_testConnection = testConnection;
window.__ds_toggleSkill = toggleSkill;
window.__ds_saveQuickActions = saveQuickActions;
window.__ds_loadQuickActions = loadQuickActions;
window.__ds_openPermissions = openPermissions;
window.__ds_restrictPermissions = restrictPermissions;

// 供旧代码调用的全局
window.triggerQuickAction = triggerQuickAction;
window.loadPersonality = loadPersonality;
window.savePersonality = savePersonality;
window.resetPersonality = resetPersonality;
window.initMemory = initMemory;
window.loadMemory = loadMemory;
window.clearMemory = clearMemory;
window.saveMemory = saveMemory;
window.loadSkills = loadSkills;
window.toggleSkill = toggleSkill;
window.createSkill = createSkill;
window.deleteSkill = deleteSkill;
window.loadTools = loadTools;
window.setToolMode = setToolMode;
window.loadQuickActions = loadQuickActions;
window.saveQuickActions = saveQuickActions;
window.checkServerHealth = checkServerHealth;
window.testConnection = testConnection;
window.updateWorkspacePath = updateWorkspacePath;
window.openPermissions = openPermissions;
window.restrictPermissions = restrictPermissions;
window.getConfig = getConfig;
window.syncFullState = syncFullState;
window.getToolEndpoint = getToolEndpoint;
window.exportLogsDownload = exportLogsDownload;