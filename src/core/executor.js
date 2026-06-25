// ============================================================
// Extension Context 守卫
// ============================================================
var EXECUTOR_CONTEXT_RECOVERY_MS = 3000;
var EXECUTOR_HTTP_TIMEOUT_MS = 15000;
var EXECUTOR_TOOL_TIMEOUT_MS = 30000;

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
  if (elapsed < EXECUTOR_CONTEXT_RECOVERY_MS) return;
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
    // 修复：添加 settled 守卫，防止 Promise 被多次 resolve/reject（竞态条件）
    var settled = false;
    // 修复：追踪重试定时器，确保 Promise settled 后能清理定时器（内存泄漏）
    var retryTimer = null;

    function doResolve(val) {
      if (!settled) {
        settled = true;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        resolve(val);
      }
    }

    function doReject(val) {
      if (!settled) {
        settled = true;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        reject(val);
      }
    }

    function trySend() {
      // 修复：检查是否已 settled，避免已放弃的重试继续执行
      if (settled) return;
      attempt++;
      try {
        chrome.runtime.sendMessage(message, function(response) {
          if (chrome.runtime.lastError) {
            var errMsg = chrome.runtime.lastError.message || '';
            if (isContextInvalidatedError(chrome.runtime.lastError)) {
              __executorContextInvalidSince = Date.now();
              doResolve({ success: false, error: '扩展上下文已失效' });
              return;
            }
            __connectionHealthy = false;
            if (attempt < maxRetries) {
              logPanel('warn', '发送消息失败(第' + attempt + '次): ' + errMsg + '，重试...');
              retryTimer = setTimeout(trySend, 1000 * attempt);
            } else {
              doReject(new Error('发送失败(' + maxRetries + '次): ' + errMsg));
            }
          } else {
            __connectionHealthy = true;
            __lastPingTime = Date.now();
            doResolve(response);
          }
        });
      } catch (e) {
        if (isContextInvalidatedError(e)) {
          __executorContextInvalidSince = Date.now();
          doResolve({ success: false, error: '扩展上下文已失效' });
          return;
        }
        __connectionHealthy = false;
        if (attempt < maxRetries) {
          logPanel('warn', '发送异常(第' + attempt + '次): ' + e.message + '，重试...');
          retryTimer = setTimeout(trySend, 1000 * attempt);
        } else { doReject(e); }
      }
    }
    trySend();
  });
}

function getToolEndpoint(toolName) {
  return 'exec';
}

async function executeToolViaHttp(toolCall) {
  // 修复：输入验证，防止空/无效的 toolCall 导致后续逻辑异常（安全）
  if (!toolCall || typeof toolCall.name !== 'string' || !toolCall.name) {
    return { success: false, error: '无效的工具调用参数' };
  }

  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, EXECUTOR_HTTP_TIMEOUT_MS);
  try {
    var response = await fetch(getEndpoint('exec'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolCall.name, args: toolCall.arguments || {} }), signal: ctrl.signal
    });
    clearTimeout(timer);
    timer = null;
    // 修复：检查 HTTP 响应状态码，4xx/5xx 不应被静默接受（错误处理）
    if (!response.ok) {
      return { success: false, error: 'HTTP错误: ' + response.status + ' ' + response.statusText };
    }
    var data = await response.json();
    if (data.blocked) return { success: false, data: data, blocked: true };
    if (data.error) {
      var errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
      return { success: false, error: errMsg };
    }
    return { success: true, data: data };
  } catch (e) {
    if (timer) { clearTimeout(timer); timer = null; }
    // 修复：区分超时中断与普通网络错误，AbortError 应返回超时提示而非抛出异常（错误处理/资源清理）
    if (e.name === 'AbortError') {
      return { success: false, error: 'HTTP请求超时(' + EXECUTOR_HTTP_TIMEOUT_MS + 'ms)', timedOut: true };
    }
    throw e;
  }
}

async function executeSingleTool(toolCall, session) {
  // 修复：输入验证，防止空/无效的 toolCall（安全）
  if (!toolCall || typeof toolCall.name !== 'string' || !toolCall.name) {
    return { success: false, error: '无效的工具调用参数' };
  }

  return new Promise(function(resolve) {
    // 防止超时与异步回调双重 resolve 的竞态条件
    var settled = false;
    var timeout = setTimeout(function() {
      if (!settled) {
        settled = true;
        resolve({ success: false, error: '工具执行超时(30s)', timedOut: true });
      }
    }, EXECUTOR_TOOL_TIMEOUT_MS);

    sendMessageWithRetry({ action: 'executeTool', tool: toolCall }, 2).then(function(result) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        // 处理约束拦截（blocked）的情况
        if (result && result.blocked) {
          resolve({ success: false, data: result, blocked: true });
          return;
        }
        if (result && result.success) resolve({ success: true, data: result.data });
        else {
          var errMsg = result ? result.error : '无响应';
          if (errMsg && (errMsg.indexOf('未运行') >= 0 || errMsg.indexOf('无响应') >= 0 || errMsg.indexOf('连接') >= 0 || errMsg.indexOf('上下文已失效') >= 0)) {
            logPanel('warn', 'SW 通道返回错误，尝试 HTTP 直连: ' + errMsg);
            executeToolViaHttp(toolCall).then(resolve).catch(function(httpErr) { resolve({ success: false, error: 'SW和HTTP均失败: ' + httpErr.message }); });
          } else {
            // 可行动化错误提示：根据错误类型提供修复建议
            var hint = '';
            if (errMsg.indexOf('ENOENT') >= 0) hint = '。建议: 检查路径拼写，或用 search_files 搜索文件';
            else if (errMsg.indexOf('EPERM') >= 0 || errMsg.indexOf('EACCES') >= 0) hint = '。建议: 权限不足，尝试其他目录或检查文件权限';
            else if (errMsg.indexOf('timeout') >= 0 || errMsg.indexOf('超时') >= 0) hint = '。建议: 命令可能执行时间过长，尝试简化命令';
            else if (errMsg.indexOf('JSON') >= 0) hint = '。建议: 参数JSON格式错误，检查引号和逗号';
            resolve({ success: false, error: errMsg + hint });
          }
        }
      }
    }).catch(function(err) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        // 修复：使用统一的 isContextInvalidatedError 检测函数，确保所有上下文失效场景都能触发 HTTP 回退（逻辑错误）
        if (isContextInvalidatedError(err)) {
          logPanel('warn', 'SW 断开，尝试 HTTP 直连执行工具...');
          executeToolViaHttp(toolCall).then(resolve).catch(function(httpErr) { resolve({ success: false, error: 'SW断开且HTTP直连也失败: ' + httpErr.message }); });
        } else { resolve({ success: false, error: err.message || String(err) }); }
      }
    });
  });
}

// 确认执行 — 调用 /api/confirm 端点重新执行被拦截的工具
async function executeConfirmedTool(toolName, args) {
  // 修复：输入验证（安全）
  if (!toolName || typeof toolName !== 'string') {
    return { success: false, error: '无效的工具名称' };
  }

  // 修复：安全检查 DS_CONFIG 是否可用，防止直接访问未定义变量抛异常（错误处理）
  if (typeof DS_CONFIG === 'undefined' || !DS_CONFIG || !DS_CONFIG.serverUrl) {
    return { success: false, error: '服务器配置不可用' };
  }

  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, EXECUTOR_HTTP_TIMEOUT_MS);
  try {
    var response = await fetch(DS_CONFIG.serverUrl + '/api/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, args: args }), signal: ctrl.signal
    });
    clearTimeout(timer);
    timer = null;
    // 修复：检查 HTTP 响应状态码（错误处理）
    if (!response.ok) {
      return { success: false, error: '确认请求HTTP错误: ' + response.status + ' ' + response.statusText };
    }
    var data = await response.json();
    if (data.success === false && data.error) return { success: false, error: data.error };
    return { success: true, data: data };
  } catch (e) {
    if (timer) { clearTimeout(timer); timer = null; }
    // 修复：区分超时中断与普通网络错误（错误处理/资源清理）
    if (e.name === 'AbortError') {
      return { success: false, error: '确认执行请求超时(' + EXECUTOR_HTTP_TIMEOUT_MS + 'ms)' };
    }
    return { success: false, error: '确认执行失败: ' + e.message };
  }
}
