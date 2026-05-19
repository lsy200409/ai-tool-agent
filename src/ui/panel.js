function injectOperationPanel() {
  if (panelInstance) return;
  var panel = document.createElement('div');
  panel.id = '__ds-tool-panel';
  panel.innerHTML = buildPanelHTML() + buildPanelCSS();
  document.body.appendChild(panel);
  panelInstance = panel;
  bindPanelEvents(panel);
  makeDraggable(panel);
  setupResizeHandling(panel);
  loadFileBrowser();
  checkServerStatus();
  setTimeout(function() { checkServerStatus(); }, 3000);
  setInterval(function() { checkServerStatus(); }, 60000);
}

function setupResizeHandling(panel) {
  var ro = new ResizeObserver(function() {
    var body = document.getElementById('__ds-panel-body');
    var main = document.getElementById('__ds-panel-main');
    if (body && main) {
      var h = panel.clientHeight;
      if (h < 200) return;
    }
  });
  ro.observe(panel);
}

function buildPanelHTML() {
  return '<div id="__ds-panel-header">' +
    '<div class="__ds-header-left"><span class="__ds-header-icon">🛠️</span><span class="__ds-header-title">DeepSeek Agent</span></div>' +
    '<div class="__ds-header-right">' +
    '<span id="__ds-panel-status-dot" class="__ds-status-disconnected" title="服务器状态"></span>' +
    '<span id="__ds-btn-settings" class="__ds-icon-btn" title="设置工作区">⚙️</span>' +
    '<span id="__ds-panel-toggle" class="__ds-icon-btn" title="折叠/展开">−</span></div></div>' +
    '<div id="__ds-panel-body">' +
    '<div id="__ds-task-input-area"><textarea id="__ds-task-input" class="__ds-task-textarea" placeholder="在此输入你的任务...&#10;例如：帮我分析 workspace 目录下的文件结构"></textarea></div>' +
    '<div id="__ds-panel-main">' +
    '<div id="__ds-panel-left" class="__ds-file-browser-panel">' +
    '<div class="__ds-section-header"><span>📂 文件浏览器</span>' +
    '<div class="__ds-section-actions"><span id="__ds-btn-toggle-files" class="__ds-icon-btn-sm" title="折叠文件浏览器">◀</span><span id="__ds-btn-refresh-files" class="__ds-icon-btn-sm" title="刷新">🔄</span><span id="__ds-btn-goto-workspace" class="__ds-icon-btn-sm" title="回到工作区">🏠</span></div></div>' +
    '<div class="__ds-file-browser-content">' +
    '<div id="__ds-workspace-bar"><span id="__ds-workspace-path" class="__ds-workspace-path-text"></span></div>' +
    '<div id="__ds-file-tree"></div>' +
    '<div id="__ds-file-preview" class="__ds-hidden"><div class="__ds-preview-header"><span id="__ds-preview-filename"></span><span id="__ds-btn-close-preview" class="__ds-icon-btn-sm">✕</span></div><pre id="__ds-preview-content"></pre></div>' +
    '</div></div>' +
    '<div id="__ds-panel-right">' +
    '<div class="__ds-section-header"><span>📋 执行历史</span>' +
    '<div class="__ds-section-actions"><span id="__ds-btn-view-logs" class="__ds-icon-btn-sm" title="查看原始日志">📄</span><span id="__ds-btn-export-logs" class="__ds-icon-btn-sm" title="导出日志文件">📥</span><span id="__ds-btn-clear-history" class="__ds-icon-btn-sm" title="清空历史">🗑️</span></div></div>' +
    '<div id="__ds-history-list"><div class="__ds-history-empty">等待任务执行...</div></div>' +
    '<div id="__ds-log-preview" style="display:none;padding:6px 8px;border-top:1px solid rgba(0,0,0,0.08);max-height:150px;overflow:auto;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span style="font-size:10px;color:#8a857c;font-weight:600;">原始日志 (最近100条)</span><span id="__ds-btn-close-log-preview" class="__ds-icon-btn-sm" style="cursor:pointer;font-size:12px;" title="关闭">✕</span></div>' +
    '<pre id="__ds-log-preview-area" style="font-size:9px;line-height:1.5;color:#5a564e;white-space:pre-wrap;word-break:break-all;margin:0;font-family:monospace;"></pre></div>' +
    '</div></div>' +
    '<div id="__ds-panel-bottom">' +
    '<div id="__ds-control-bar">' +
    '<button id="__ds-btn-inject" class="__ds-btn __ds-btn-inject" title="仅注入工具提示词到输入框，不发送">💉 注入提示词</button>' +
    '<button id="__ds-btn-submit" class="__ds-btn __ds-btn-submit" title="将任务填入DeepSeek输入框并发送，自动开启监听">🚀 发送任务</button>' +
    '<button id="__ds-btn-restart" class="__ds-btn __ds-btn-restart" title="重启工具服务器">🔄 重启服务</button>' +
    '<button id="__ds-btn-reset" class="__ds-btn __ds-btn-reset" title="重置会话状态">重置</button></div>' +
    '<div id="__ds-status-bar">' +
    '<span id="__ds-status-server" class="__ds-status-item"><span class="__ds-status-label">服务器:</span> <span id="__ds-server-text">检测中...</span></span>' +
    '<span id="__ds-status-session" class="__ds-status-item"><span class="__ds-status-label">会话:</span> <span id="__ds-session-text">空闲</span></span>' +
    '<span id="__ds-status-stage" class="__ds-status-item"><span class="__ds-status-label">阶段:</span> <span id="__ds-stage-text">就绪</span></span></div></div></div>' +
    buildSettingsModal();
}

function buildSettingsModal() {
  return '<div id="__ds-settings-overlay" class="__ds-modal-overlay __ds-hidden">' +
    '<div id="__ds-settings-modal" class="__ds-modal">' +
    '<div class="__ds-modal-header"><span>⚙️ 设置与服务管理</span><span id="__ds-btn-close-settings" class="__ds-icon-btn">✕</span></div>' +
    '<div class="__ds-modal-body">' +
    '<div class="__ds-settings-tabs"><span id="__ds-tab-workspace" class="__ds-settings-tab __ds-tab-active">工作区</span><span id="__ds-tab-launcher" class="__ds-settings-tab">服务管理</span></div>' +
    '<div id="__ds-settings-workspace-panel" class="__ds-settings-panel">' +
    '<div class="__ds-form-group"><label>工作区路径</label><input id="__ds-settings-workspace" class="__ds-form-input" type="text" placeholder="例如: F:\\桌面\\project 或 C:/Users/..."><div class="__ds-form-hint">设置AI可操作的文件目录，修改后重启服务器生效</div></div>' +
    '<div class="__ds-form-group"><label>当前工作区</label><div id="__ds-settings-current" class="__ds-form-value"></div></div></div>' +
    '<div id="__ds-settings-launcher-panel" class="__ds-settings-panel __ds-hidden">' +
    '<div class="__ds-launcher-status-cards"><div class="__ds-launcher-card"><div class="__ds-launcher-card-icon">🔧</div><div><div class="__ds-launcher-card-label">服务进程</div><div id="__ds-launcher-card-status" class="__ds-launcher-card-value">检测中...</div></div></div>' +
    '<div class="__ds-launcher-card"><div class="__ds-launcher-card-icon">🖥️</div><div><div class="__ds-launcher-card-label">工具服务器</div><div id="__ds-launcher-card-server" class="__ds-launcher-card-value">检测中...</div></div></div></div>' +
    '<div id="__ds-launcher-details" class="__ds-launcher-details">' +
    '<div class="__ds-launcher-detail-row"><span class="__ds-launcher-detail-label">PID</span><span id="__ds-launcher-detail-pid" class="__ds-launcher-detail-value">-</span></div>' +
    '<div class="__ds-launcher-detail-row"><span class="__ds-launcher-detail-label">运行时长</span><span id="__ds-launcher-detail-uptime" class="__ds-launcher-detail-value">-</span></div>' +
    '<div class="__ds-launcher-detail-row"><span class="__ds-launcher-detail-label">重启次数</span><span id="__ds-launcher-detail-restarts" class="__ds-launcher-detail-value">-</span></div>' +
    '<div class="__ds-launcher-detail-row"><span class="__ds-launcher-detail-label">服务器 PID</span><span id="__ds-launcher-detail-server-pid" class="__ds-launcher-detail-value">-</span></div></div>' +
    '<div class="__ds-launcher-actions">' +
    '<button id="__ds-btn-launcher-start" class="__ds-btn-launcher-action __ds-btn-l-start">▶ 启动启动器</button>' +
    '<button id="__ds-btn-launcher-stop" class="__ds-btn-launcher-action __ds-btn-l-stop">⏹ 停止启动器</button>' +
    '<button id="__ds-btn-launcher-restart" class="__ds-btn-launcher-action __ds-btn-l-restart">🔄 重启全部</button>' +
    '<button id="__ds-btn-launcher-refresh" class="__ds-btn-launcher-action __ds-btn-l-refresh">刷新</button></div>' +
    '<div class="__ds-launcher-log"><div class="__ds-launcher-log-header">操作记录</div><div id="__ds-launcher-log-content" class="__ds-launcher-log-content">等待操作...</div></div></div></div>' +
    '<div class="__ds-modal-footer"><button id="__ds-btn-save-settings" class="__ds-btn __ds-btn-primary">保存并重启服务器</button><button id="__ds-btn-cancel-settings" class="__ds-btn __ds-btn-secondary">取消</button></div></div></div>';
}

function buildPanelCSS() {
  var css = '<style>#__ds-tool-panel{position:fixed;top:60px;right:16px;width:680px;height:520px;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;color:#3a3632;z-index:999999;box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:hidden;display:flex;flex-direction:column;resize:both;min-width:480px;min-height:360px;}';
  css += '#__ds-tool-panel.__ds-collapsed{height:42px;min-height:42px;resize:none;}#__ds-tool-panel.__ds-collapsed #__ds-panel-body{display:none;}';
  css += '#__ds-panel-header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:rgba(0,0,0,0.03);cursor:move;user-select:none;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0;}';
  css += '.__ds-header-left{display:flex;align-items:center;gap:8px;}.__ds-header-icon{font-size:16px;}.__ds-header-title{font-weight:600;font-size:14px;color:#3a3632;}';
  css += '.__ds-header-right{display:flex;align-items:center;gap:6px;}.__ds-icon-btn{cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;transition:background 0.2s;}';
  css += '.__ds-icon-btn:hover{background:rgba(0,0,0,0.06);}.__ds-icon-btn-sm{cursor:pointer;font-size:13px;padding:1px 4px;border-radius:3px;transition:background 0.2s;}';
  css += '.__ds-icon-btn-sm:hover{background:rgba(0,0,0,0.06);}#__ds-panel-body{display:flex;flex-direction:column;flex:1;overflow:hidden;}';
  css += '#__ds-panel-main{display:flex;flex:1;overflow:hidden;gap:1px;background:#f8f6f2;}';
  css += '#__ds-panel-left{width:45%;min-width:200px;display:flex;flex-direction:column;background:#f3f1ed;overflow:hidden;}';
  css += '#__ds-panel-right{flex:1;min-width:200px;display:flex;flex-direction:column;background:#faf9f7;overflow:hidden;}';
  css += '.__ds-section-header{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;font-size:12px;font-weight:600;color:#7a756c;border-bottom:1px solid rgba(0,0,0,0.07);flex-shrink:0;}';
  css += '.__ds-section-actions{display:flex;align-items:center;gap:4px;}';
  css += '.__ds-file-browser-content{display:flex;flex-direction:column;flex:1;overflow:hidden;}';
  css += '.__ds-file-browser-panel.__ds-file-collapsed .__ds-file-browser-content{display:none;}';
  css += '#__ds-workspace-bar{padding:4px 10px;font-size:11px;color:#8a857c;border-bottom:1px solid rgba(0,0,0,0.06);flex-shrink:0;}';
  css += '.__ds-workspace-path-text{font-family:monospace;word-break:break-all;}';
  css += '#__ds-file-tree{flex:1;overflow-y:auto;padding:4px 0;font-family:monospace;font-size:12px;}';
  css += '#__ds-file-tree::-webkit-scrollbar{width:4px;}#__ds-file-tree::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.12);border-radius:2px;}';
  css += '.__ds-file-item{display:flex;align-items:center;gap:4px;padding:3px 10px;cursor:pointer;transition:background 0.15s;white-space:nowrap;}';
  css += '.__ds-file-item:hover{background:rgba(168,184,156,0.12);}';
  css += '.__ds-file-item.__ds-file-selected{background:rgba(168,184,156,0.18);}';
  css += '.__ds-file-icon{font-size:13px;flex-shrink:0;}.__ds-file-name{overflow:hidden;text-overflow:ellipsis;}';
  css += '.__ds-file-size{font-size:10px;color:#9a948a;margin-left:auto;flex-shrink:0;}';
  css += '.__ds-file-dir{color:#5a784c;}.__ds-file-dir .__ds-file-name{color:#5a784c;}';
  css += '.__ds-file-loading{text-align:center;padding:20px;color:#9a948a;}';
  css += '.__ds-file-error{text-align:center;padding:20px;color:#c49a8c;}';
  css += '#__ds-file-preview{border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;max-height:35%;overflow:hidden;}';
  css += '#__ds-file-preview.__ds-hidden{display:none;}';
  css += '.__ds-preview-header{display:flex;justify-content:space-between;align-items:center;padding:4px 10px;background:rgba(0,0,0,0.03);font-size:11px;flex-shrink:0;}';
  css += '#__ds-preview-content{flex:1;overflow:auto;padding:8px 10px;font-size:11px;line-height:1.5;margin:0;white-space:pre-wrap;word-break:break-all;color:#4a4640;}';
  css += '.__ds-task-textarea{width:100%;height:58px;background:#f5f3ef;border:1px solid rgba(0,0,0,0.10);border-radius:6px;color:#3a3632;padding:8px 10px;font-size:12px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box;}';
  css += '.__ds-task-textarea:focus{border-color:rgba(168,184,156,0.5);}';
  css += '.__ds-file-browser-panel.__ds-file-collapsed{width:0!important;min-width:0!important;overflow:hidden;padding:0;}';
  css += '#__ds-history-list{flex:1;overflow-y:auto;padding:6px;}';
  css += '.__ds-history-empty{text-align:center;padding:30px 10px;color:#b0aba0;font-size:12px;}';
  css += '.__ds-history-card{margin-bottom:6px;border-radius:6px;background:#f0ede8;border:1px solid rgba(0,0,0,0.08);overflow:hidden;}';
  css += '.__ds-card-header{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;font-size:12px;transition:background 0.15s;}';
  css += '.__ds-card-header:hover{background:rgba(0,0,0,0.04);}';
  css += '.__ds-card-type-badge{font-size:10px;padding:1px 5px;border-radius:3px;font-weight:600;flex-shrink:0;}';
  css += '.__ds-card-type-call{background:rgba(212,196,168,0.25);color:#8a7a4a;}';
  css += '.__ds-card-type-output{background:rgba(168,184,156,0.2);color:#4a7a3a;}';
  css += '.__ds-card-type-error{background:rgba(196,154,140,0.2);color:#a04030;}';
  css += '.__ds-card-type-tool_detect{background:rgba(212,196,168,0.2);color:#8a7a4a;}';
  css += '.__ds-card-type-task_send{background:rgba(168,184,156,0.18);color:#4a7a3a;}';
  css += '.__ds-card-type-phase_complete{background:rgba(168,184,156,0.15);color:#5a8a4a;}';
  css += '.__ds-card-type-inject{background:rgba(180,160,140,0.2);color:#8a6a40;}';
  css += '.__ds-card-type-warn{background:rgba(200,170,120,0.2);color:#8a7030;}';
  css += '.__ds-card-type-success{background:rgba(140,180,140,0.2);color:#3a7a3a;}';
  css += '.__ds-card-type-info{background:rgba(150,160,180,0.15);color:#5a6580;}';
  css += '.__ds-card-header-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;overflow:hidden;}';
  css += '.__ds-card-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:#4a4640;}';
  css += '.__ds-card-preview{font-size:10px;color:#9a9590;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
  css += '.__ds-card-toggle{font-size:10px;color:#b0aba0;flex-shrink:0;transition:transform 0.2s;}';
  css += '.__ds-card-toggle.__ds-expanded{transform:rotate(90deg);}';
  css += '.__ds-card-body{display:none;padding:8px;border-top:1px solid rgba(0,0,0,0.06);font-size:11px;line-height:1.6;color:#5a564e;background:#faf9f7;max-height:300px;overflow-y:auto;}';
  css += '.__ds-card-body.__ds-expanded{display:block;}';
  css += '.__ds-card-content-text{white-space:pre-wrap;word-break:break-all;margin-bottom:6px;}';
  css += '.__ds-card-details{border-top:1px dashed rgba(0,0,0,0.08);padding-top:6px;margin-top:4px;}';
  css += '.__ds-detail-row{display:flex;gap:4px;padding:2px 0;font-size:10.5px;line-height:1.5;align-items:baseline;}';
  css += '.__ds-detail-label{color:#7a756c;flex-shrink:0;min-width:60px;}';
  css += '.__ds-detail-value{color:#3a3632;word-break:break-all;}';
  css += '.__ds-card-time{font-size:10px;color:#b0aba0;flex-shrink:0;}';
  css += '#__ds-panel-bottom{border-top:1px solid rgba(0,0,0,0.08);flex-shrink:0;}';
  css += '#__ds-control-bar{display:flex;gap:6px;padding:8px 10px;}';
  css += '.__ds-btn{flex:1;padding:6px 8px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;color:white;white-space:nowrap;}';
  css += '.__ds-btn:hover{opacity:0.9;transform:translateY(-1px);}';
  css += '.__ds-btn-inject{background:linear-gradient(135deg,#d4c4a8,#bca882);}';
  css += '.__ds-btn-submit{background:linear-gradient(135deg,#a8b89c,#8a9a7a);}';
  css += '.__ds-btn-restart{background:linear-gradient(135deg,#c4b498,#a89a78);}';
  css += '.__ds-btn-reset{background:linear-gradient(135deg,#8a867e,#6a6660);font-size:11px;}';
  css += '.__ds-btn-stop{background:linear-gradient(135deg,#c49a8c,#a88878);}';
  css += '.__ds-btn-primary{background:linear-gradient(135deg,#a8b89c,#8a9a7a);color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;}';
  css += '.__ds-btn-secondary{background:rgba(0,0,0,0.05);color:#7a756c;border:1px solid rgba(0,0,0,0.12);padding:8px 16px;border-radius:6px;cursor:pointer;}';
  css += '#__ds-status-bar{display:flex;gap:12px;padding:4px 10px;background:#f0ede8;font-size:11px;border-top:1px solid rgba(0,0,0,0.06);overflow-x:auto;}';
  css += '.__ds-status-item{display:flex;align-items:center;gap:4px;white-space:nowrap;}';
  css += '.__ds-status-label{color:#9a948a;}';
  css += '.__ds-status-disconnected{display:inline-block;width:8px;height:8px;border-radius:50%;background:#c0bab0;flex-shrink:0;}';
  css += '.__ds-status-connected{display:inline-block;width:8px;height:8px;border-radius:50%;background:#a8b89c;flex-shrink:0;box-shadow:0 0 4px rgba(168,184,156,0.5);}';
  css += '.__ds-status-on{color:#5a9a4a;}.__ds-status-off{color:#c45a4a;}';
  css += '.__ds-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9999999;display:flex;align-items:center;justify-content:center;}';
  css += '.__ds-modal-overlay.__ds-hidden{display:none;}';
  css += '.__ds-modal{background:#ffffff;border:1px solid rgba(0,0,0,0.10);border-radius:12px;width:440px;max-width:90vw;box-shadow:0 16px 64px rgba(0,0,0,0.15);}';
  css += '.__ds-modal-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,0.08);font-weight:600;font-size:14px;color:#3a3632;}';
  css += '.__ds-settings-tabs{display:flex;gap:0;margin-bottom:14px;border-bottom:1px solid rgba(0,0,0,0.10);}';
  css += '.__ds-settings-tab{padding:6px 14px;cursor:pointer;font-size:12px;color:#8a857c;border-bottom:2px solid transparent;transition:all 0.2s;}';
  css += '.__ds-settings-tab.__ds-tab-active{color:#5a8a4a;border-bottom-color:#5a8a4a;}';
  css += '.__ds-launcher-card{flex:1;display:flex;align-items:center;gap:10px;background:#f0ede8;border-radius:8px;padding:10px 12px;border:1px solid rgba(0,0,0,0.08);}';
  css += '.__ds-btn-launcher-action{padding:7px 10px;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.2s;color:white;}';
  css += '.__ds-btn-l-start{background:linear-gradient(135deg,#a8b89c,#8a9a7a);}';
  css += '.__ds-btn-l-stop{background:linear-gradient(135deg,#c49a8c,#a88878);}';
  css += '.__ds-btn-l-restart{background:linear-gradient(135deg,#c4b498,#a89a78);}';
  css += '.__ds-btn-l-refresh{background:linear-gradient(135deg,#7a7680,#5a5660);}';
  css += '</style>';
  return css;
}

function bindPanelEvents(panel) {
  document.getElementById('__ds-panel-toggle').onclick = function() {
    panel.classList.toggle('__ds-collapsed');
    document.getElementById('__ds-panel-toggle').textContent = panel.classList.contains('__ds-collapsed') ? '+' : '−';
  };
  document.getElementById('__ds-btn-inject').onclick = doInjectPrompt;
  document.getElementById('__ds-btn-submit').onclick = handleSubmitOrStop;
  document.getElementById('__ds-btn-restart').onclick = doRestartServer;
  document.getElementById('__ds-btn-reset').onclick = resetCurrentSession;
  document.getElementById('__ds-btn-toggle-files').onclick = toggleFileBrowser;
  document.getElementById('__ds-btn-refresh-files').onclick = function() { loadFileBrowser(); };
  document.getElementById('__ds-btn-goto-workspace').onclick = function() { loadFileBrowser(); };
  document.getElementById('__ds-btn-close-preview').onclick = closeFilePreview;
  document.getElementById('__ds-btn-clear-history').onclick = function() { executionHistory = []; updateHistoryUI(); };
  document.getElementById('__ds-btn-view-logs').onclick = function() {
    var preview = document.getElementById('__ds-log-preview');
    if (preview) { preview.style.display = preview.style.display === 'none' ? 'block' : 'none'; if (preview.style.display === 'block') __ds_viewRawLogs(); }
  };
  document.getElementById('__ds-btn-export-logs').onclick = function() { __ds_exportLogs(); };
  document.getElementById('__ds-btn-close-log-preview').onclick = function() { document.getElementById('__ds-log-preview').style.display = 'none'; };
  document.getElementById('__ds-btn-settings').onclick = openSettings;
  document.getElementById('__ds-btn-close-settings').onclick = closeSettings;
  document.getElementById('__ds-btn-cancel-settings').onclick = closeSettings;
  document.getElementById('__ds-btn-save-settings').onclick = saveSettings;
  document.getElementById('__ds-settings-overlay').onclick = function(e) { if (e.target === this) closeSettings(); };
  var tabWs = document.getElementById('__ds-tab-workspace');
  var tabLau = document.getElementById('__ds-tab-launcher');
  if (tabWs) tabWs.onclick = function() { switchSettingsTab('workspace'); };
  if (tabLau) tabLau.onclick = function() { switchSettingsTab('launcher'); };
  var btnLStart = document.getElementById('__ds-btn-launcher-start');
  var btnLStop = document.getElementById('__ds-btn-launcher-stop');
  var btnLRestart = document.getElementById('__ds-btn-launcher-restart');
  var btnLRefresh = document.getElementById('__ds-btn-launcher-refresh');
  if (btnLStart) btnLStart.onclick = doLauncherStart;
  if (btnLStop) btnLStop.onclick = doLauncherStop;
  if (btnLRestart) btnLRestart.onclick = doLauncherRestartAll;
  if (btnLRefresh) btnLRefresh.onclick = function() { refreshLauncherStatus(true); };
}

function makeDraggable(el) {
  var header = document.getElementById('__ds-panel-header');
  var isDragging = false, startX, startY, startLeft, startTop;
  header.onmousedown = function(e) {
    if (e.target.closest('.__ds-header-right')) return;
    isDragging = true;
    var rect = el.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    el.style.transition = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  };
  function onMouseMove(e) { if (!isDragging) return; el.style.left = (startLeft + e.clientX - startX) + 'px'; el.style.top = (startTop + e.clientY - startY) + 'px'; el.style.right = 'auto'; }
  function onMouseUp() { isDragging = false; el.style.transition = ''; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); }
}
