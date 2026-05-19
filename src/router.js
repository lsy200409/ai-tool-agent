function init() {
  loadWorkspaceConfig();
  keepBackgroundAlive();
  startHeartbeat();
  setInterval(keepBackgroundAlive, 15000);
  injectScript();
  chrome.runtime.onMessage.addListener(handleExtensionMessage);
  window.addEventListener('message', handlePageMessage);
  injectOperationPanel();
}

function loadWorkspaceConfig() {
  chrome.storage.local.get(['workspacePath'], function(result) {
    if (result.workspacePath) updateWorkspaceDisplay(result.workspacePath);
  });
}

function injectScript() {
  try {
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/injected.js');
    script.onload = function() { script.remove(); };
    script.onerror = function(e) { logPanel('error', '脚本加载失败: ' + (e.message || e)); };
    if (document.head) document.head.appendChild(script);
    else if (document.documentElement) document.documentElement.appendChild(script);
    else document.addEventListener('DOMContentLoaded', function() { (document.head || document.documentElement).appendChild(script); });
  } catch(e) { logPanel('error', '注入脚本错误: ' + e.message); }
}

function handlePageMessage(event) {
  if (!event.data || typeof event.data !== 'object') return;
  if (event.data.type === '__ds_inject_result') {
    var requestId = event.data.requestId;
    if (pendingRequests[requestId]) { pendingRequests[requestId](event.data.result); delete pendingRequests[requestId]; }
  }
  if (event.data.type === '__ds_auto_tool_calls') { handleAutoToolCalls(event.data.toolCalls || []); }
  if (event.data.type === '__ds_auto_no_tool_calls') {
    var session = getCurrentSession();
    var totalCalls = session ? session.totalToolCalls : 0;
    addStageLog('success', '✅ 任务阶段完成', 'AI 未请求更多工具调用，本轮执行结束（共 ' + totalCalls + ' 次工具调用）');
    addHistoryCard('phase_complete', '✅ 阶段完成', 'AI 不再需要工具调用，当前任务轮次结束。可发送新任务或查看结果。', false);
    logPanel('success', '任务阶段完成 (共 ' + totalCalls + ' 次工具调用)');
    stopAutoWatch(); autoMode = false;
    updateAutoButtonState(); updateHistoryUI();
    setStageText('任务完成');
    var doneBtn = document.getElementById('__ds-btn-submit');
    if (doneBtn) { doneBtn.textContent = '🚀 发送任务'; doneBtn.className = '__ds-btn __ds-btn-submit'; }
  }
}

function sendInjectRequest(autoSend, originalMessage) {
  return new Promise(function(resolve) {
    var requestId = ++requestIdCounter;
    pendingRequests[requestId] = resolve;
    window.postMessage({ type: '__ds_inject_tool', autoSend: autoSend, originalMessage: originalMessage, requestId: requestId }, '*');
    setTimeout(function() { if (pendingRequests[requestId]) { delete pendingRequests[requestId]; resolve({ success: false, error: '注入超时' }); } }, 5000);
  });
}

function startAutoWatchInInjected() {
  window.postMessage({ type: '__ds_start_auto_watch' }, '*');
}

function stopAutoWatchInInjected() {
  window.postMessage({ type: '__ds_stop_auto_watch' }, '*');
}

function handleExtensionMessage(request, _sender, sendResponse) {
  switch (request.action) {
    case 'injectToolPrompt': doInjectPrompt().then(function(r) { sendResponse(r || { success: true }); }); return true;
    case 'getStatus':
      var session = getCurrentSession();
      sendResponse({ enabled: true, processing: session && session.status === 'running', scriptLoaded: true, autoMode: autoMode, session: session ? { id: session.id, status: session.status, toolCount: session.totalToolCalls, originalMessage: session.originalMessage } : null });
      break;
    case 'togglePanel':
      if (request.visible !== undefined) { var panel = document.getElementById('__ds-tool-panel'); if (panel) panel.style.display = request.visible ? '' : 'none'; }
      sendResponse({ success: true });
      break;
    case 'openSettings': openSettings(); sendResponse({ success: true }); break;
  }
  return true;
}

// 自动执行 pipeline
async function handleAutoToolCalls(calls) {
  if (!autoMode || !autoWatchRunning) return;
  var toolNames = calls.map(function(c) { return c.name; }).join(', ');
  logPanel('info', '🔍 检测到 ' + calls.length + ' 个工具调用: [' + toolNames + ']');
  addStageLog('info', '🔍 AI 输出中检测到工具调用', '共 ' + calls.length + ' 个调用', [{ label: '工具列表', value: toolNames }]);
  for (var i = 0; i < calls.length; i++) {
    var c = calls[i];
    addHistoryCard('tool_detect', '检测 #' + (i+1) + ': ' + c.name, JSON.stringify(c.arguments || {}, null, 2), false, [{ label: '工具名', value: c.name }]);
  }
  pendingToolCalls = [];
  for (var j = 0; j < calls.length; j++) pendingToolCalls.push({ index: j + 1, name: calls[j].name, arguments: calls[j].arguments, rawTag: calls[j].rawTag, status: 'pending' });
  addStageLog('info', '⚙️ 准备批量执行', '已将 ' + calls.length + ' 个工具调用加入执行队列');
  await autoExecuteTools();
}

async function autoExecuteTools() {
  if (!autoMode || pendingToolCalls.length === 0) return;
  var session = getCurrentSession();
  if (!session) return;
  setStageText('执行工具...');
  var totalTools = pendingToolCalls.filter(function(t) { return t.status === 'pending'; }).length;
  logPanel('info', '⚙️ 开始执行 ' + totalTools + ' 个工具...');
  var successCount = 0, failCount = 0;
  var execStartTime = Date.now();

  for (var i = 0; i < pendingToolCalls.length; i++) {
    var tc = pendingToolCalls[i];
    if (tc.status !== 'pending') continue;
    tc.status = 'executing';
    var toolStartTime = Date.now();
    logPanel('info', '⚡ [' + (i+1) + '/' + totalTools + '] 执行: ' + tc.name);

    try {
      var execResult = await executeSingleTool(tc, session);
      var toolElapsed = ((Date.now() - toolStartTime) / 1000).toFixed(1) + 's';
      if (execResult.success) {
        tc.status = 'done'; tc.result = execResult.data; successCount++;
        var outputStr = '';
        if (typeof execResult.data === 'string') outputStr = execResult.data;
        else if (execResult.data && execResult.data.content !== undefined) outputStr = execResult.data.content;
        else if (execResult.data && execResult.data.stdout !== undefined) { outputStr = execResult.data.stdout; if (execResult.data.stderr) outputStr += '\n[stderr]\n' + execResult.data.stderr; }
        else outputStr = JSON.stringify(execResult.data, null, 2);
        logPanel('success', '✅ ' + tc.name + ' 成功 (' + toolElapsed + ')');
        addHistoryCard('tool_output', '✅ ' + tc.name + ' → 成功', outputStr.substring(0, 5000), false, [{ label: '耗时', value: toolElapsed }, { label: '预览', value: outputStr.substring(0, 200).replace(/\n/g, ' ') }]);
        addToolCallToChain(session.id, tc, execResult.data);
      } else {
        tc.status = 'error'; failCount++;
        logPanel('error', '❌ ' + tc.name + ' 失败 (' + toolElapsed + '): ' + (execResult.error || ''));
        addHistoryCard('tool_output', '❌ ' + tc.name + ' → 失败', execResult.error || '执行失败', true, [{ label: '耗时', value: toolElapsed }, { label: '错误', value: execResult.error || '' }]);
        addToolCallToChain(session.id, tc, { error: execResult.error });
      }
    } catch (err) {
      tc.status = 'error'; failCount++;
      logPanel('error', '💥 ' + tc.name + ' 异常: ' + err.message);
      addHistoryCard('tool_output', '💥 ' + tc.name + ' → 异常', err.message, true);
    }
    await sleep(200);
  }

  var totalExecTime = ((Date.now() - execStartTime) / 1000).toFixed(1);
  logPanel('info', '📊 工具执行完毕: ✅' + successCount + ' ❌' + failCount + ' (耗时 ' + totalExecTime + 's)');
  addStageLog(successCount > 0 ? 'success' : (failCount > 0 ? 'warn' : 'info'), '📊 批量执行完成', '✅' + successCount + ' ❌' + failCount + ' 共' + pendingToolCalls.length + '个, 耗时' + totalExecTime + 's');
  setStageText('回填结果');
  updateSessionStatusUI();
  await sleep(500);

  // 检查 AI 是否已自行回复
  if (aiAlreadyRepliedAfterToolCall()) {
    logPanel('info', 'AI 已在 tool_call 后自行回复，跳过回填');
    addStageLog('info', 'ℹ️ AI 已自行处理', '工具执行后的回填已被跳过');
  } else {
    var combinedResults = buildCombinedResults();
    await fillResultsBack(session, combinedResults);
  }
  pendingToolCalls = [];
}

// start - 自动监听模式
async function autoWatchLoop() {
  if (!autoMode || !autoWatchRunning) return;
  var isStreaming = detectStreaming();
  if (isStreaming.__autoWatchSeenStreaming) { autoWatchSeenStreaming = true; }
  // 通过 autoWatchInjected 处理
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
