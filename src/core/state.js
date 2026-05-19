// 全局状态
var panelInstance = null;
var requestIdCounter = 0;
var pendingRequests = {};
var agentSessions = new Map();
var currentSessionId = null;
var toolCallCounter = 0;
var bgPort = null;
var pendingToolCalls = [];
var executionHistory = [];
var autoMode = false;
var autoWatchRunning = false;
var originalTask = '';
var fileBrowserVisible = true;
var __serverStarting = false;
var __MAX_LOG_ENTRIES = 50;
var __connectionHealthy = false;
var __lastPingTime = 0;

var TOOL_CALL_REGEX = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/i;
var ARROW_SVG_PATH = 'm8.3125';

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extensionPathHint() {
  try {
    var url = chrome.runtime.getURL('');
    return url.replace(/\/$/, '').replace('chrome-extension://' + chrome.runtime.id, '');
  } catch(e) {}
  return 'deepseek-tool-agent';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function createAgentSession(userMessage) {
  var sessionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  var session = {
    id: sessionId,
    originalMessage: userMessage,
    toolCallChain: [],
    status: 'running',
    createdAt: Date.now(),
    totalToolCalls: 0
  };
  agentSessions.set(sessionId, session);
  currentSessionId = sessionId;
  return session;
}

function addToolCallToChain(sessionId, toolCall, result) {
  var session = agentSessions.get(sessionId);
  if (!session) return;
  toolCallCounter++;
  var chainEntry = {
    index: toolCallCounter,
    name: toolCall.name,
    args: toolCall.arguments,
    result: result,
    timestamp: Date.now()
  };
  session.toolCallChain.push(chainEntry);
  session.totalToolCalls++;
}

function getCurrentSession() {
  if (currentSessionId) {
    var session = agentSessions.get(currentSessionId);
    if (session && session.status === 'running') return session;
  }
  var entries = agentSessions.values();
  var entry;
  while (true) {
    entry = entries.next();
    if (entry.done) break;
    if (entry.value.status === 'running') {
      currentSessionId = entry.value.id;
      return entry.value;
    }
  }
  return null;
}

function resetCurrentSession() {
  var prevSessionId = currentSessionId;
  if (currentSessionId) {
    var session = agentSessions.get(currentSessionId);
    if (session) session.status = 'completed';
    currentSessionId = null;
  }
  toolCallCounter = 0;
  pendingToolCalls = [];
  executionHistory = [];
  originalTask = '';
  autoMode = false;
}
