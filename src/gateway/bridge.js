// 消息桥接 — 预留外部消息入口
// 开放给外部平台的 HTTP/WS 接口，接收消息并自动发送到输入框

var __bridgeCallback = null;
// 安全令牌，防止未授权脚本注入消息
var _bridgeToken = Math.random().toString(36).substring(2, 15);

function setBridgeCallback(callback) {
  __bridgeCallback = callback;
}

function getBridgeToken() { return _bridgeToken; }

function bridgeReceiveMessage(message, token) {
  // 安全检查：验证令牌，防止未授权调用
  if (token !== _bridgeToken) {
    console.warn('[Bridge] 未授权的桥接消息，已忽略');
    return;
  }
  if (!message || !message.text) return;
  var input = findChatInput();
  if (!input) return;
  setInputValue(input, message.text);
  setTimeout(function() { clickSendButton(); }, 600);
  logPanel('info', '桥接消息已接收并发送: ' + message.text.substring(0, 40));
}
