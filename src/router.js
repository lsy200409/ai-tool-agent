function init() {
  loadWorkspaceConfig();
  keepBackgroundAlive();
  startHeartbeat();
  setInterval(keepBackgroundAlive, 15000);
  injectScript();
  chrome.runtime.onMessage.addListener(handleExtensionMessage);
  window.addEventListener('message', handlePageMessage);
  injectOperationPanel();
  setTimeout(function() {
    if (typeof window.__ds_startMonitor === 'function') {
      window.__ds_startMonitor();
    }
  }, 2000);
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
}

function sendInjectRequest(autoSend, originalMessage) {
  return new Promise(function(resolve) {
    var requestId = ++requestIdCounter;
    pendingRequests[requestId] = resolve;
    window.postMessage({ type: '__ds_inject_tool', autoSend: autoSend, originalMessage: originalMessage, requestId: requestId }, '*');
    setTimeout(function() { if (pendingRequests[requestId]) { delete pendingRequests[requestId]; resolve({ success: false, error: '注入超时' }); } }, 5000);
  });
}

function handleExtensionMessage(request, _sender, sendResponse) {
  switch (request.action) {
    case 'injectToolPrompt': doInjectPrompt().then(function(r) { sendResponse(r || { success: true }); }); return true;
    case 'getStatus':
      var session = getCurrentSession();
      sendResponse({ enabled: true, processing: session && session.status === 'running', scriptLoaded: true, autoMode: autoMode, session: session ? { id: session.id, status: session.status, toolCount: session.totalToolCalls, originalMessage: session.originalMessage } : null });
      break;
    case 'togglePanel':
      if (request.visible !== undefined) { var panel = document.getElementById('__ds-agent-panel'); if (panel) { if (request.visible) { panel.classList.add('visible'); panel.style.display = 'flex'; } else { panel.classList.remove('visible'); panel.style.display = 'none'; } } }
      sendResponse({ success: true });
      break;
    case 'openSettings': openSettings(); sendResponse({ success: true }); break;
  }
  return true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}