// 消息桥接 — 预留外部消息入口
// 开放给外部平台的 HTTP/WS 接口，接收消息并自动发送到输入框

var __bridgeCallback = null;

function setBridgeCallback(callback) {
  __bridgeCallback = callback;
}

function bridgeReceiveMessage(message) {
  if (!message || !message.text) return;
  var input = findChatInput();
  if (!input) return;
  setInputValue(input, message.text);
  setTimeout(function() { clickSendButton(); }, 600);
  logPanel('info', '桥接消息已接收并发送: ' + message.text.substring(0, 40));
}
