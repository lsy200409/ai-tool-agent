async function loadFileBrowser(dirPath) {
  var treeEl = document.getElementById('__ds-file-tree');
  if (!treeEl) return;
  treeEl.innerHTML = '<div class="__ds-file-loading">加载中...</div>';
  var wsPath = dirPath || await getWorkspacePath();
  if (!wsPath) { treeEl.innerHTML = '<div class="__ds-file-error">未设置工作区路径<br>请点击 ⚙️ 设置</div>'; return; }
  updateWorkspaceDisplay(wsPath);
  try {
    var response = await fetch('http://localhost:3002/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'list_dir', args: { path: wsPath } }) });
    if (!response.ok) throw new Error('服务器响应错误');
    var data = await response.json();
    if (!data.success) throw new Error(data.error ? (data.error.message || '读取目录失败') : '读取目录失败');
    renderFileTree(treeEl, data.files, wsPath);
  } catch(e) {
    var errMsg = e.message || '';
    if (errMsg.indexOf('Failed to fetch') >= 0 || errMsg.indexOf('NetworkError') >= 0) {
      treeEl.innerHTML = '<div class="__ds-file-loading">⏳ 正在尝试连接...</div>';
      logPanel('info', '服务器未运行，尝试通过 Native Host 连接...');
      try {
        var nativeResp = await chrome.runtime.sendMessage({ action: 'connectNativeHost' });
        if (nativeResp && nativeResp.status && nativeResp.status.running) { logPanel('success', 'Native Host 已连接 ✅'); updateServerStatusUI(true); return loadFileBrowser(dirPath); }
      } catch(nativeErr) {
        var neMsg = nativeErr.message || '';
        if (neMsg.indexOf('Extension context invalidated') >= 0 || neMsg.indexOf('disconnected') >= 0) { logPanel('warn', 'Service Worker 重启中，稍后重试...'); await sleep(2000); return loadFileBrowser(dirPath); }
        logPanel('warn', 'loadFileBrowser Native Host 异常: ' + neMsg);
      }
      showStartupGuide();
      return;
    }
    treeEl.innerHTML = '<div class="__ds-file-error">加载失败: ' + escapeHtml(errMsg) + '</div>';
  }
}

function renderFileTree(container, files, basePath) {
  if (!files || files.length === 0) { container.innerHTML = '<div class="__ds-file-loading">目录为空</div>'; return; }
  var html = '';
  if (basePath) {
    var parentPath = basePath.replace(/[\\/][^\\/]+$/, '') || basePath;
    if (parentPath !== basePath) html += '<div class="__ds-file-item __ds-file-dir" data-path="' + escapeAttr(parentPath) + '" data-is-dir="true"><span class="__ds-file-icon">📁</span><span class="__ds-file-name">..</span></div>';
  }
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var fullPath = basePath.replace(/\\/g, '/').replace(/\/$/, '') + '/' + f.name;
    html += '<div class="__ds-file-item' + (f.isDirectory ? ' __ds-file-dir' : '') + '" data-path="' + escapeAttr(fullPath) + '" data-is-dir="' + (f.isDirectory ? 'true' : 'false') + '">';
    html += '<span class="__ds-file-icon">' + (f.isDirectory ? '📁' : '📄') + '</span>';
    html += '<span class="__ds-file-name">' + escapeHtml(f.name) + '</span>';
    if (!f.isDirectory && f.size > 0) html += '<span class="__ds-file-size">' + formatFileSize(f.size) + '</span>';
    html += '</div>';
  }
  container.innerHTML = html;
  var items = container.querySelectorAll('.__ds-file-item');
  for (var j = 0; j < items.length; j++) {
    items[j].addEventListener('click', function(e) {
      var path = this.getAttribute('data-path');
      var isDir = this.getAttribute('data-is-dir') === 'true';
      var allItems = container.querySelectorAll('.__ds-file-item');
      for (var k = 0; k < allItems.length; k++) allItems[k].classList.remove('__ds-file-selected');
      this.classList.add('__ds-file-selected');
      if (isDir) { loadFileBrowser(path); closeFilePreview(); }
      else { previewFile(path); }
    });
  }
}

async function previewFile(filePath) {
  var previewEl = document.getElementById('__ds-file-preview');
  var nameEl = document.getElementById('__ds-preview-filename');
  var contentEl = document.getElementById('__ds-preview-content');
  if (!previewEl || !contentEl) return;
  previewEl.classList.remove('__ds-hidden');
  nameEl.textContent = filePath.split(/[\\/]/).pop();
  contentEl.textContent = '加载中...';
  try {
    var response = await fetch('http://localhost:3002/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'read_file', args: { path: filePath } }) });
    if (!response.ok) throw new Error('读取失败');
    var data = await response.json();
    if (!data.success) throw new Error(data.error ? (data.error.message || '读取失败') : '读取失败');
    var content = data.content || '';
    if (content.length > 50000) content = content.substring(0, 50000) + '\n\n... (内容过长, 已截断)';
    contentEl.textContent = content;
  } catch(e) { contentEl.textContent = '读取失败: ' + e.message; }
}

function closeFilePreview() {
  var previewEl = document.getElementById('__ds-file-preview');
  if (previewEl) previewEl.classList.add('__ds-hidden');
}

function getWorkspacePath() {
  return new Promise(function(resolve) {
    chrome.storage.local.get(['workspacePath'], function(result) {
      if (result.workspacePath) resolve(result.workspacePath);
      else {
        fetch('http://localhost:3002/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get' }) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success && data.workspace) { chrome.storage.local.set({ workspacePath: data.workspace }); resolve(data.workspace); }
            else resolve('');
          }).catch(function() { resolve(''); });
      }
    });
  });
}
