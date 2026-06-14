// ============================================================
// AI Tool Agent v0.1.1 — Actions (纯 API + 辅助函数)
// 不包含 UI 渲染代码，所有UI由 panel.js 负责
// ============================================================

// ═══════════════════════════════════════════════════════════
// § 1. API 客户端 — HTTP 请求封装
// ═══════════════════════════════════════════════════════════

var getApiBase = function() { return getServerUrl(); };
var API_TIMEOUT_MS = 5000;
var FEISHU_INJECT_COOLDOWN_MS = 5000;
var FEISHU_DEDUP_WINDOW_MS = 15000;
var FEISHU_REPLY_TIMEOUT_MS = 120000;
var AI_REPLY_TRUNCATE_LEN = 3000;
var FETCH_TIMEOUT = API_TIMEOUT_MS;

function apiFetch(path, body) {
  var options = {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  try { options.signal = AbortSignal.timeout(FETCH_TIMEOUT); } catch(e) {}
  return fetch(getApiBase() + path, options);
}

function apiPost(path, body) { return apiFetch(path, body); }
function apiGet(path) { return apiFetch(path, null); }
function apiJson(path, body) { return apiFetch(path, body).then(function(r) { return r.json(); }); }
function apiGetJson(path) { return apiGet(path).then(function(r) { return r.json(); }); }

// ═══════════════════════════════════════════════════════════
// § 2. Agent Initialization — 对话式引导画像构建
// ═══════════════════════════════════════════════════════════
async function initAgent() {
  logPanel('info', '正在检查记忆状态...');

  var isFirstTime = true;

  try {
    var memResp = await apiJson('/api/agent/memory', { action: 'stats' });
    if (memResp.success && memResp.totalRecords > 0) {
      isFirstTime = false;
      logPanel('info', '检测到已有记忆 (' + memResp.totalRecords + ' 条)，进入回归模式');
    } else {
      logPanel('info', '记忆为空，进入首次设置模式');
    }
  } catch(e) {
    logPanel('warn', '无法检查记忆状态，使用首次设置模式');
  }

  var initPrompt = isFirstTime ? buildSetupPrompt() : buildRecallPrompt();
  logPanel('success', (isFirstTime ? '首次设置' : '回归模式') + ' Prompt 已构建 (' + initPrompt.length + ' chars)');

  var input = findChatInput();
  if (input) {
    setInputValue(input, initPrompt);
    await sleep(600);
    clickSendButton();
    logPanel('success', isFirstTime ? '首次设置提示已发送' : '记忆恢复提示已发送');
  } else {
    logPanel('error', '找不到输入框');
  }

  autoMode = true;
  autoWatchRunning = true;
  if (typeof window.__ds_startMonitor === 'function') window.__ds_startMonitor();
  setStageText('监听中');
  updateAutoButtonState();

  await syncFullState();
  return isFirstTime;
}

async function smartAgentAction() {
  var hasMemory = false;
  try {
    var memResp = await apiJson('/api/agent/memory', { action: 'stats' });
    hasMemory = memResp.success && memResp.totalRecords > 0;
  } catch(e) {}

  if (!hasMemory) {
    return await initAgent();
  }

  var prompt = [
    '[系统指令]',
    '请使用 memory_search 工具搜索关键词 "agent-profile" 或 "画像"，',
    '读取之前保存的用户画像 JSON，然后以用户设定的语气和风格向我打招呼。',
    '如果找到了画像，严格按照其中的 tone、style、constraints 来交互。',
    '如果找不到画像，请友好地告知我并引导我重新设置。'
  ].join(' ');

  var input = findChatInput();
  if (input) {
    setInputValue(input, prompt);
    await sleep(400);
    clickSendButton();
    logPanel('success', '已发送记忆恢复指令');
  } else {
    logPanel('error', '找不到输入框');
    return false;
  }

  autoMode = true;
  autoWatchRunning = true;
  if (typeof window.__ds_startMonitor === 'function') window.__ds_startMonitor();
  setStageText('监听中');
  updateAutoButtonState();
  await syncFullState();
  return false;
}

async function updateInitButtonLabel() {
  try {
    var memResp = await apiJson('/api/agent/memory', { action: 'stats' });
    var hasMemory = memResp.success && memResp.totalRecords > 0;
    var btn = document.querySelector('#__ds-quick-btns .ds-qbtn[data-qa-index="1"]');
    if (btn) {
      if (hasMemory) {
        btn.innerHTML = '<span class="ds-qbtn-icon">\u{1F504}</span> 恢复人格';
        btn.title = '从记忆恢复Agent画像和上下文';
      } else {
        btn.innerHTML = '<span class="ds-qbtn-icon">\u{1F680}</span> 初始化';
        btn.title = '初始化 Agent — 构建全面上下文';
      }
    }
  } catch(e) {}
}

// ============================================================
// 首次设置 Prompt — AI 作为画像引导员，在对话中收集用户信息
// ============================================================
function buildSetupPrompt() {
  return [
    '[系统指令 — 用户不可见此内容，你只需按指令行动]',
    '',
    '你正处于 **首次设置模式**。请以友好的方式逐步引导用户完成以下画像构建过程。',
    '',
    '---',
    '',
    '## 你的任务',
    '',
    '请通过对话依次了解用户的以下信息，每轮聚焦 1-2 个方面，不要一次性问太多：',
    '',
    '### 1. 身份',
    '- 怎么称呼你？（姓名或昵称）',
    '- 你的角色或职业是什么？',
    '- 你主要用这个Agent做什么？（场景）',
    '',
    '### 2. 灵魂（交互风格）',
    '- 你希望我以什么语气和你交流？（如：简洁直接/温暖活泼/专业正式）',
    '- 偏好的回复风格？（详细展开/简洁扼要）',
    '- 有什么特别的语言习惯或要求？',
    '',
    '### 3. 用户画像（偏好与目标）',
    '- 你的核心目标是什么？',
    '- 有什么使用习惯或偏好我需要知道？',
    '- 工作区偏好？（常用目录、文件类型等）',
    '',
    '### 4. 约束条件',
    '- 不希望我做的事情？',
    '- 需要特别注意的规则或边界？',
    '',
    '---',
    '',
    '## 收集完成后',
    '',
    '当所有信息收集完毕并获得用户确认后，请使用 **memory_save** 工具保存以下内容：',
    '',
    '- `sessionId`: "agent-profile"',
    '- `role`: "system"',
    '- `content`: 一条结构化的JSON画像，格式为：',
    '```',
    '{"name":"用户姓名","role":"用户角色","tone":"语气偏好","style":"回复风格",',
    ' "scene":"使用场景","goals":["目标1","目标2"],',
    ' "constraints":["约束1","约束2"],"notes":"其他备注"}',
    '```',
    '',
    '保存完毕后，告诉用户："画像已保存！下次新会话我会自动加载这些信息。"',
    '',
    '---',
    '',
    '## 重要规则',
    '- 用中文交流',
    '- 保持友好的对话节奏，不要让用户觉得在填表',
    '- 可以穿插一些轻松的表达，展现你的个性',
    '- 如果用户不想回答某些问题，跳过即可',
    '- 全程不要主动调用其他工具（read_file/exec_command等），只专注于画像收集',
    '- 收集过程中不要提 memory_save 的技术细节，只在最后确认时使用',
    '',
    '现在，用第一句话开始引导用户吧。'
  ].join('\n');
}

// ============================================================
// 回归 Prompt — AI 从记忆加载画像，恢复人格
// ============================================================
function buildRecallPrompt() {
  return [
    '[系统指令 — 用户不可见此内容，你只需按指令行动]',
    '',
    '你处于 **回归模式**。用户之前已经完成了画像设置。',
    '',
    '请执行以下步骤：',
    '',
    '1. 使用 `memory_search` 搜索关键词 "agent-profile 画像" 或使用 `memory_recall` 获取最近的记忆',
    '2. 从记忆中找到用户画像 JSON，提取用户的身份、语气偏好、目标和约束',
    '3. 以用户设定的人格向用户打招呼',
    '',
    '打招呼格式参考：',
    '"欢迎回来，[用户名]！我已经加载了你之前的偏好设置：[简要复述关键信息]。今天有什么需要帮助的？"',
    '',
    '---',
    '',
    '## 重要规则',
    '- 画像加载后，全程使用用户设定的语气和风格',
    '- 如果记忆中没有找到画像，友好地告诉用户"这是你第一次使用吗？"然后转入首次设置模式',
    '- 用中文交流',
    '',
    '现在，开始加载记忆吧。'
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════
// § 8. Quick Actions — 快捷操作
// ═══════════════════════════════════════════════════════════
async function triggerQuickAction(promptOrIndex) {
  var prompt;

  // 支持两种调用方式：传字符串直接使用，传数字从后端获取
  if (typeof promptOrIndex === 'number') {
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
    logPanel('error', '找不到输入框');
  }
}

// ═══════════════════════════════════════════════════════════
// § 3. Tool Prompt Injection — 工具提示词注入
// ═══════════════════════════════════════════════════════════
async function injectToolPrompt() {
  logPanel('info', '正在获取实时工具列表...');
  try {
    var toolsResp = await apiGetJson('/api/tools');
    if (!toolsResp.success || !toolsResp.tools) {
      logPanel('error', '获取工具列表失败');
      return;
    }

    var tools = toolsResp.tools;
    var autoTools = [];
    var otherTools = [];

    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      if (t.pluginId === 'builtin' && t.name.indexOf('plugin_') === 0) {
        otherTools.push(t);
      } else {
        autoTools.push(t);
      }
    }

    var prompt = '你是 AI 助手，可以使用以下真实工具完成任务。\n\n## 可用工具\n\n';

    for (var i = 0; i < autoTools.length; i++) {
      var t = autoTools[i];
      prompt += '### ' + t.name + '\n';
      prompt += t.description + '\n';
      var props = (t.parameters && t.parameters.properties) ? t.parameters.properties : {};
      var required = (t.parameters && t.parameters.required) || [];
      var keys = Object.keys(props);
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        prompt += '  ' + k + ': ' + props[k].type + (required.indexOf(k) >= 0 ? ' [必填]' : ' [可选]') + '\n';
      }
      prompt += '\n';
    }

    if (otherTools.length > 0) {
      prompt += '## 插件管理工具\n\n';
      for (var i = 0; i < otherTools.length; i++) {
        var t = otherTools[i];
        prompt += '### ' + t.name + '\n' + t.description + '\n\n';
      }
    }

    prompt += '## 调用格式\n';
    prompt += '<tool_call name="工具名">\n{"参数":"值"}\n</tool_call>\n\n';
    prompt += '结果以 <tool_response status="ok|error"> 返回。无需工具时直接回复。';

    var input = findChatInput();
    if (input) {
      setInputValue(input, prompt);
      await sleep(400);
      clickSendButton();
      logPanel('success', '工具提示词已注入 (' + tools.length + ' 个工具, 含插件)');
    } else {
      logPanel('error', '找不到输入框');
    }
  } catch(e) {
    logPanel('error', '注入工具提示词失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// § 4. Personality Management — 人格管理
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// § 5. Memory Management — 记忆管理
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// § 6. Skills Management — 技能管理
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// § 7. Tools Management — 工具管理
// ═══════════════════════════════════════════════════════════
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

// ── §8 续: Quick Actions API ──────────────────────────────
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

// ═══════════════════════════════════════════════════════════
// § 9. System Management — 系统管理、面板同步
// ═══════════════════════════════════════════════════════════
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

// ── §9 续: 面板同步 ──────────────────────────────────────
async function syncFullState() {
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
// exportLogsDownload is defined in core/logger.js (loaded first)

// ============================================================
// 工具端点映射
// ============================================================
// getToolEndpoint is defined in core/executor.js (loaded first)
// persistLocalLogs and getLocalLogs are defined in core/logger.js (loaded first)

window.__ds_viewRawLogs = function() {
  persistLocalLogs();
  var logs = getLocalLogs();
  var previewEl = document.getElementById('__ds-log-preview-area');
  if (!previewEl) return;
  previewEl.textContent = logs.length === 0 ? '(无本地日志)' : logs.slice(-100).join('\n');
  previewEl.scrollTop = previewEl.scrollHeight;
};

// ═══════════════════════════════════════════════════════════
// § 10. Feishu Bridge — 飞书桥接
// ═══════════════════════════════════════════════════════════

// ── 飞书桥接状态变量 ──────────────────────────────────────
var feishuPollTimer = null;           // 轮询定时器
var feishuLastProcessedId = null;     // 上次处理的消息 ID
var feishuPendingReplies = {};        // 等待回复的消息 { msgId: { chatId, startTime, awaitingReply, replySent } }
var feishuReplyWatcherTimer = null;   // 回复监听定时器
var feishuInjectedKeys = [];          // 已注入消息的去重键列表
var feishuLastInjectTime = 0;         // 上次注入时间戳
var FEISHU_INJECT_COOLDOWN = FEISHU_INJECT_COOLDOWN_MS;  // 注入冷却时间
var FEISHU_DEDUP_WINDOW = FEISHU_DEDUP_WINDOW_MS;        // 去重窗口时间

function hashFeishuKey(senderId, content) {
  var h = 0;
  var key = (senderId || '') + '::' + content;
  for (var i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return h;
}

function isFeishuDuplicate(msg) {
  var h = hashFeishuKey(msg.senderId, msg.content);
  var now = Date.now();
  feishuInjectedKeys = feishuInjectedKeys.filter(function(e) { return now - e.time < FEISHU_DEDUP_WINDOW; });
  for (var i = 0; i < feishuInjectedKeys.length; i++) {
    if (feishuInjectedKeys[i].key === h) return true;
  }
  feishuInjectedKeys.push({ key: h, time: now });
  if (feishuInjectedKeys.length > 50) feishuInjectedKeys = feishuInjectedKeys.slice(-50);
  return false;
}

function startFeishuBridge() {
  if (feishuPollTimer) return;
  feishuPollTimer = setInterval(pollFeishuQueue, 3000);
}

function stopFeishuBridge() {
  if (feishuPollTimer) { clearInterval(feishuPollTimer); feishuPollTimer = null; }
  if (feishuReplyWatcherTimer) { clearInterval(feishuReplyWatcherTimer); feishuReplyWatcherTimer = null; }
  feishuPendingReplies = {};
  feishuInjectedKeys = [];
  feishuLastInjectTime = 0;
}

function startReplyWatcher() {
  if (feishuReplyWatcherTimer) return;
  feishuReplyWatcherTimer = setInterval(watchPendingReplies, 2000);
}

function watchPendingReplies() {
  var keys = Object.keys(feishuPendingReplies);
  if (keys.length === 0) {
    if (feishuReplyWatcherTimer) { clearInterval(feishuReplyWatcherTimer); feishuReplyWatcherTimer = null; }
    return;
  }

  var getState = window.__ds_getMonitorState || function() { return 'listening'; };
  var state = getState();

  for (var i = 0; i < keys.length; i++) {
    var msgId = keys[i];
    var entry = feishuPendingReplies[msgId];

    if (entry.awaitingReply && state === 'listening' && !entry.replySent) {
      var elapsed = Date.now() - entry.startTime;
      if (elapsed < 3000) continue;

      entry.replySent = true;
      captureAndReplyFeishu(entry.chatId, msgId);
    }

    if (entry.replySent || Date.now() - entry.startTime > 120000) {
      delete feishuPendingReplies[msgId];
    }
  }
}

async function captureAndReplyFeishu(chatId, msgId) {
  try {
    var aiText = '';
    if (typeof getLatestAIMessageText === 'function') {
      aiText = getLatestAIMessageText();
    }
    if (!aiText) {
      var els = document.querySelectorAll('div.ds-assistant-message-main-content');
      for (var i = els.length - 1; i >= 0; i--) {
        aiText = (els[i].innerText || els[i].textContent || '').trim();
        if (aiText) break;
      }
    }
    if (!aiText) { return; }

    if (aiText.length > AI_REPLY_TRUNCATE_LEN) aiText = aiText.substring(0, AI_REPLY_TRUNCATE_LEN) + '...[已截断]';

    var resp = await apiJson('/api/feishu/reply', { chatId: chatId, text: aiText }, 'POST');
    if (resp.success) {
      logPanel('success', 'AI回复已回传飞书 (' + aiText.length + '字)');
    } else {
      logPanel('error', '飞书回传失败: ' + (resp.error || 'unknown'));
    }
  } catch(e) {
  }
}

async function pollFeishuQueue() {
  try {
    var resp = await apiGetJson('/api/feishu/messages');
    if (!resp.success || !resp.messages || resp.messages.length === 0) return;

    var pending = resp.messages.filter(function(m) { return m.id !== feishuLastProcessedId; });
    if (pending.length === 0) return;

    for (var i = 0; i < pending.length; i++) {
      var msg = pending[i];
      feishuLastProcessedId = msg.id;

      apiJson('/api/feishu/messages', { action: 'mark processed' }, 'PUT').catch(function(){});

      var waited = 0;
      var getState = window.__ds_getMonitorState || function() { return 'listening'; };
      while (getState() !== 'listening' && waited < 15000) {
        await sleep(500);
        waited += 500;
      }

      var input = findChatInput();
      if (input && msg.content) {
        if (isFeishuDuplicate(msg)) {
          continue;
        }
        var now = Date.now();
        if (now - feishuLastInjectTime < FEISHU_INJECT_COOLDOWN) {
          continue;
        }
        feishuLastInjectTime = now;

        var injectText = '[来自飞书] ' + (msg.senderId ? msg.senderId.substring(0,8) + ': ' : '') + msg.content;
        setInputValue(input, injectText);
        await sleep(400);
        clickSendButton();

        if (msg.chatId) {
          feishuPendingReplies[msg.id] = { chatId: msg.chatId, startTime: Date.now(), awaitingReply: false };
          setTimeout(function(mid) {
            var e = feishuPendingReplies[mid];
            if (e) e.awaitingReply = true;
            startReplyWatcher();
          }, 2000, msg.id);
        }

        logPanel('info', '飞书消息已注入: ' + msg.content.substring(0,30));
      }
    }

    try {
      for (var j = 0; j < pending.length; j++) {
        await apiJson('/api/feishu/messages', { id: pending[j].id }, 'PUT');
      }
    } catch(e) {}
  } catch(e) {
  }
}

// ============================================================
// 导出到 window（供 panel.js 调用）
// ============================================================
window.__ds_initAgent = initAgent;
window.__ds_exportLogs = exportLogsDownload;
window.__ds_onToolModeChange = setToolMode;
window.__ds_syncFullState = syncFullState;
window.__ds_testConnection = testConnection;
window.__ds_toggleSkill = toggleSkill;
window.__ds_saveQuickActions = saveQuickActions;
window.__ds_loadQuickActions = loadQuickActions;
window.__ds_openPermissions = openPermissions;
window.__ds_restrictPermissions = restrictPermissions;
window.__ds_startFeishuBridge = startFeishuBridge;
window.__ds_stopFeishuBridge = stopFeishuBridge;
window.__ds_injectToolPrompt = injectToolPrompt;
window.__ds_smartAgentAction = smartAgentAction;
window.__ds_updateInitButtonLabel = updateInitButtonLabel;

// ── §3 续: 工具重试提示词 ────────────────────────────────
async function retryToolPrompt() {
  var monitor = window.__ds_monitor;
  var hasRecentFailure = false;
  var lastToolName = '';
  var failureCount = 0;

  if (monitor) {
    lastToolName = monitor._lastExecutedTool || '';
    failureCount = monitor._consecutiveFailures || 0;
    hasRecentFailure = failureCount > 0;
  }

  var recentErrors = [];
  if (executionHistory && executionHistory.length > 0) {
    for (var i = Math.max(0, executionHistory.length - 20); i < executionHistory.length; i++) {
      var log = executionHistory[i];
      if (log.level === 'error') {
        recentErrors.push('[' + (log.time || '') + '] ' + (log.message || ''));
      }
    }
  }

  var prompt;

  if (hasRecentFailure && lastToolName) {
    prompt = [
      '[系统指令 — 工具重试]',
      '',
      '你刚才使用工具 `' + lastToolName + '` 连续失败了 ' + failureCount + ' 次。',
      '',
      '请分析以下错误信息，调整参数后重试：'
    ].join('\n');

    if (recentErrors.length > 0) {
      prompt += '\n\n## 最近错误日志\n';
      for (var e = 0; e < Math.min(recentErrors.length, 5); e++) {
        prompt += '- ' + recentErrors[e] + '\n';
      }
    }

    prompt += '\n## 重试规则\n';
    prompt += '1. 检查工具参数是否正确（路径是否存在、格式是否正确）\n';
    prompt += '2. 尝试使用替代方案（如 read_file 失败 → 用 exec_command "type path" 代替）\n';
    prompt += '3. 如果是权限问题，尝试换一个目录操作\n';
    prompt += '4. 最多重试 2 次，如果仍然失败请分析原因并告知用户\n';
  } else if (recentErrors.length > 0) {
    prompt = [
      '[系统指令 — 工具重试]',
      '',
      '最近有一些工具调用错误，请分析以下错误日志并尝试修复：',
      '',
      '## 最近错误日志'
    ].join('\n');
    for (var e2 = 0; e2 < Math.min(recentErrors.length, 5); e2++) {
      prompt += '\n- ' + recentErrors[e2];
    }
    prompt += '\n\n请根据错误信息调整方法，尝试完成任务。';
  } else {
    prompt = [
      '[系统指令 — 工具重试]',
      '',
      '请回顾你最近的工具调用。如果有失败的调用，请：',
      '1. 分析失败原因',
      '2. 调整参数后重新调用',
      '3. 如果找不到合适的替代方案，告知用户',
      '',
      '如果最近没有工具调用，请告诉我你需要什么帮助。'
    ].join('\n');
  }

  var input = findChatInput();
  if (input) {
    setInputValue(input, prompt);
    await sleep(500);
    clickSendButton();
    logPanel('success', '工具重试提示已发送 (' + (hasRecentFailure ? lastToolName + ' ' + failureCount + '次失败' : '通用重试') + ')');
  } else {
    logPanel('error', '找不到输入框');
  }
}

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
window.openPermissions = openPermissions;
window.restrictPermissions = restrictPermissions;
window.getConfig = getConfig;
window.syncFullState = syncFullState;
window.retryToolPrompt = retryToolPrompt;
window.smartAgentAction = smartAgentAction;
window.injectToolPrompt = injectToolPrompt;