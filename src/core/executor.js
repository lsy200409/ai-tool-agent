function sendMessageWithRetry(message, maxRetries) {
  maxRetries = maxRetries || 3;
  return new Promise(function(resolve, reject) {
    var attempt = 0;
    function trySend() {
      attempt++;
      try {
        chrome.runtime.sendMessage(message, function(response) {
          if (chrome.runtime.lastError) {
            __connectionHealthy = false;
            if (attempt < maxRetries) {
              logPanel('warn', '发送消息失败(第' + attempt + '次): ' + (chrome.runtime.lastError.message || '') + '，重试...');
              setTimeout(trySend, 1000 * attempt);
            } else {
              reject(new Error('发送失败(' + maxRetries + '次): ' + chrome.runtime.lastError.message));
            }
          } else {
            __connectionHealthy = true;
            __lastPingTime = Date.now();
            resolve(response);
          }
        });
      } catch (e) {
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
  var map = {
    'read_file': 'read', 'write_file': 'write', 'list_dir': 'list',
    'exec_command': 'exec', 'append_file': 'append',
    'search_files': 'search', 'get_file_info': 'file-info'
  };
  return map[toolName] || 'exec';
}

async function executeToolViaHttp(toolCall) {
  var endpoint = getToolEndpoint(toolCall.name);
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, 15000);
  try {
    var response = await fetch('http://localhost:3002/api/' + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toolCall.arguments || {}), signal: ctrl.signal
    });
    clearTimeout(timer);
    var data = await response.json();
    return data.success ? { success: true, data: data } : { success: false, error: data.error || 'HTTP执行失败' };
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
        if (errMsg && (errMsg.indexOf('未运行') >= 0 || errMsg.indexOf('无响应') >= 0 || errMsg.indexOf('连接') >= 0)) {
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
