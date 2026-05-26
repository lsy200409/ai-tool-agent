// ============================================================
// Extension Context 守卫 (参考 DeepSeek++)
// ============================================================
var __executorContextInvalidSince = 0;

function hasLiveExecutorContext() {
  try {
    if (typeof chrome === 'undefined') return false;
    var rt = chrome.runtime;
    if (!rt || !rt.id) return false;
    return typeof rt.sendMessage === 'function';
  } catch (e) {
    __executorContextInvalidSince = Date.now();
    return false;
  }
}

function isContextInvalidatedError(err) {
  var msg = err instanceof Error ? err.message : String(err);
  return msg.indexOf('Extension context invalidated') >= 0 ||
         msg.indexOf('context invalidated') >= 0 ||
         msg.indexOf('message port closed') >= 0 ||
         msg.indexOf('Could not establish connection') >= 0;
}

function recoverContextIfPossible() {
  if (!__executorContextInvalidSince) return;
  var elapsed = Date.now() - __executorContextInvalidSince;
  if (elapsed < 3000) return;
  __executorContextInvalidSince = 0;
  if (typeof logPanel === 'function') logPanel('info', '尝试恢复扩展连接...');
}

function sendMessageWithRetry(message, maxRetries) {
  maxRetries = maxRetries || 3;
  return new Promise(function(resolve, reject) {
    recoverContextIfPossible();

    if (!hasLiveExecutorContext()) {
      if (__executorContextInvalidSince === 0) __executorContextInvalidSince = Date.now();
      resolve({ success: false, error: '扩展上下文已失效，将在3秒后自动尝试恢复' });
      return;
    }

    __executorContextInvalidSince = 0;
    var attempt = 0;
    function trySend() {
      attempt++;
      try {
        chrome.runtime.sendMessage(message, function(response) {
          if (chrome.runtime.lastError) {
            var errMsg = chrome.runtime.lastError.message || '';
            if (isContextInvalidatedError(chrome.runtime.lastError)) {
              __executorContextInvalidSince = Date.now();
              resolve({ success: false, error: '扩展上下文已失效' });
              return;
            }
            __connectionHealthy = false;
            if (attempt < maxRetries) {
              logPanel('warn', '发送消息失败(第' + attempt + '次): ' + errMsg + '，重试...');
              setTimeout(trySend, 1000 * attempt);
            } else {
              reject(new Error('发送失败(' + maxRetries + '次): ' + errMsg));
            }
          } else {
            __connectionHealthy = true;
            __lastPingTime = Date.now();
            resolve(response);
          }
        });
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          __executorContextInvalidSince = Date.now();
          resolve({ success: false, error: '扩展上下文已失效' });
          return;
        }
        __connectionHealthy = false;
        if (attempt < maxRetries) {
          logPanel('warn', '发送异常(第' + attempt + '次): ' + e.message + '，重试...');
          setTimeout(trySend, 1000 * attempt);
        } else { reject(e); }
      }
    }
    trySend();
  });
}

function getToolEndpoint(toolName) {
  return 'exec';
}

async function executeToolViaHttp(toolCall) {
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, 15000);
  try {
    var response = await fetch(getEndpoint('exec'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolCall.name, args: toolCall.arguments || {} }), signal: ctrl.signal
    });
    clearTimeout(timer);
    var data = await response.json();
    if (data.error) return { success: false, error: data.error.message || '执行失败' };
    return { success: true, data: data };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function executeSingleTool(toolCall, session) {
  return new Promise(function(resolve) {
    var timeout = setTimeout(function() { resolve({ success: false, error: '执行超时（30秒）' }); }, 30000);
    sendMessageWithRetry({ action: 'executeTool', tool: toolCall }, 2).then(function(result) {
      clearTimeout(timeout);
      if (result && result.success) resolve({ success: true, data: result.data });
      else {
        var errMsg = result ? result.error : '无响应';
        if (errMsg && (errMsg.indexOf('未运行') >= 0 || errMsg.indexOf('无响应') >= 0 || errMsg.indexOf('连接') >= 0 || errMsg.indexOf('上下文已失效') >= 0)) {
          logPanel('warn', 'SW 通道返回错误，尝试 HTTP 直连: ' + errMsg);
          executeToolViaHttp(toolCall).then(resolve).catch(function(httpErr) { resolve({ success: false, error: 'SW和HTTP均失败: ' + httpErr.message }); });
        } else { resolve({ success: false, error: errMsg }); }
      }
    }).catch(function(err) {
      clearTimeout(timeout);
      var errMsg = err.message || '';
      if (errMsg.indexOf('Extension context invalidated') >= 0 || errMsg.indexOf('disconnected') >= 0 || errMsg.indexOf('Could not establish connection') >= 0 || errMsg.indexOf('message port closed') >= 0) {
        logPanel('warn', 'SW 断开，尝试 HTTP 直连执行工具...');
        executeToolViaHttp(toolCall).then(resolve).catch(function(httpErr) { resolve({ success: false, error: 'SW断开且HTTP直连也失败: ' + httpErr.message }); });
      } else { resolve({ success: false, error: errMsg }); }
    });
  });
}