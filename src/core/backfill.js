function buildCombinedResults() {
  var output = '【工具执行结果】\n';
  for (var i = 0; i < pendingToolCalls.length; i++) {
    var tc = pendingToolCalls[i];
    if (tc.result && tc.result.error) {
      var errMsg = typeof tc.result.error === 'string' ? tc.result.error : JSON.stringify(tc.result.error, null, 2);
      if (errMsg.length > 1000) errMsg = errMsg.substring(0, 1000) + '\n... [截断]';
      output += '❌ ' + tc.name + ' 执行失败:\n' + errMsg + '\n';
    } else if (tc.status === 'done') {
      var content = '';
      if (typeof tc.result === 'string') content = tc.result;
      else if (tc.result && tc.result.content !== undefined) content = tc.result.content;
      else if (tc.result && tc.result.stdout !== undefined) { content = tc.result.stdout; if (tc.result.stderr) content += '\n[stderr] ' + tc.result.stderr; }
      else if (tc.result) content = JSON.stringify(tc.result);
      var MAX_CHARS = 3000;
      if (content.length > MAX_CHARS) {
        content = content.substring(0, MAX_CHARS) + '\n... [截断，共' + content.length + '字符]';
      }
      output += '✅ ' + tc.name + ' 执行成功:\n' + content + '\n';
    } else { output += '⚠️ ' + tc.name + ': 状态未知\n'; }
  }
  if (originalTask) output += '\n原始任务: ' + originalTask + '\n';
  output += '\n请根据以上工具调用结果和用户原始任务继续完成任务，如果已完成则总结汇报。\n如果调用工具失败，请分析原因并尝试其他方法。';

  return output;
}

async function fillResultsBack(session, resultMessage) {
  setStageText('回填结果...');
  await waitForChatInput();
  var input = findChatInput();
  if (!input) { logPanel('error', '找不到输入框，无法回填'); return; }
  logPanel('info', '回填结果 (' + resultMessage.length + ' 字符)');
  setInputValue(input, resultMessage);
  await sleep(500);
  clickSendButton();
  logPanel('info', '结果已发送，重新开始监听');
  if (autoMode) {
    autoWatchRunning = true;
    if (typeof window.__ds_startMonitor === 'function') window.__ds_startMonitor();
    setStageText('监听中');
    updateAutoButtonState();
  } else { setStageText('等待用户发送'); }
}
