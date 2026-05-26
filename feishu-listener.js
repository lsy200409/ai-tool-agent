var larkCli = process.env.APPDATA + '\\npm\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe';
var spawn = require('child_process').spawn;
var http = require('http');

var TOOL_SERVER = 'http://localhost:3002/api/feishu/messages';

var recentKeys = [];
var DEDUP_WINDOW = 10000;
var COOLDOWN_MS = 500;
var lastForwardTime = 0;

function getSenderId(msg) {
  if (msg.sender_id) return String(msg.sender_id);
  if (msg.event && msg.event.sender && msg.event.sender.sender_id) {
    var sid = msg.event.sender.sender_id;
    if (typeof sid === 'object' && sid.open_id) return sid.open_id;
    if (typeof sid === 'object' && sid.union_id) return sid.union_id;
    return String(sid);
  }
  return '';
}

function makeKey(senderId, content) {
  var h = 0;
  var key = senderId + '::' + content;
  for (var i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return h;
}

function isBotMessage(msg) {
  if (msg.event && msg.event.sender) {
    var sender = msg.event.sender;
    if (sender.sender_type === 'bot' || sender.sender_id === 'bot') return true;
    if (sender.sender_id && typeof sender.sender_id === 'object' && sender.sender_id.open_id) {
      var oid = sender.sender_id.open_id;
      if (oid && oid.indexOf('ou_') === 0) return false;
    }
  }
  return false;
}

function isDuplicate(msg) {
  var key = makeKey(getSenderId(msg), msg.content);
  var now = Date.now();
  recentKeys = recentKeys.filter(function(e) { return now - e.time < DEDUP_WINDOW; });
  for (var i = 0; i < recentKeys.length; i++) {
    if (recentKeys[i].key === key) return true;
  }
  recentKeys.push({ key: key, time: now });
  if (recentKeys.length > 50) recentKeys = recentKeys.slice(-50);
  return false;
}

function postMessage(msg) {
  var payload = JSON.stringify({
    senderId: msg.sender_id || '',
    chatId: msg.chat_id || '',
    content: msg.content || '',
    messageType: msg.message_type || 'text',
    timestamp: msg.create_time || Date.now()
  });
  var buf = Buffer.from(payload, 'utf-8');
  var req = http.request('http://localhost:3002/api/feishu/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length }
  }, function(res) {
    var body = '';
    res.on('data', function(c) { body += c; });
    res.on('end', function() {
      try { var r = JSON.parse(body); console.log('[FEISHU→DS] 已转发:', r.id, msg.content.substring(0, 40)); }
      catch(e) { console.log('[FEISHU→DS] 转发失败:', body); }
    });
  });
  req.on('error', function(e) { console.log('[FEISHU→DS] 连接失败:', e.message); });
  req.write(buf);
  req.end();
}

var child = spawn(larkCli, [
  'event', 'consume', 'im.message.receive_v1',
  '--as', 'bot',
  '--max-events', '99',
  '--timeout', '3600s'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', function(data) {
  var text = data.toString().trim();
  if (!text) return;
  try {
    var msg = JSON.parse(text);
    if (msg.type === 'im.message.receive_v1' && msg.content) {
      if (isBotMessage(msg)) {
        console.log('[飞书] 跳过Bot消息:', msg.content.substring(0, 40));
        return;
      }
      if (isDuplicate(msg)) {
        console.log('[飞书] 跳过重复(sender+内容 10s内):', msg.content.substring(0, 40));
        return;
      }
      var now = Date.now();
      if (now - lastForwardTime < COOLDOWN_MS) {
        console.log('[飞书] 冷却中，跳过:', msg.content.substring(0, 40));
        return;
      }
      lastForwardTime = now;
      console.log('[飞书] 收到:', msg.content);
      postMessage(msg);
    }
  } catch(e) {
    console.log('[CLI]', text);
  }
});

child.stderr.on('data', function(data) {
  var text = data.toString().trim();
  if (text) console.log('[CLI]', text);
});

child.on('close', function(code) {
  console.log('[CLI] 停止 (exit ' + code + ')');
});

process.stdin.resume();
console.log('[监听] 飞书→DeepSeek 桥接已启动 (含防重复机制)');
console.log('[监听] 从飞书发消息给机器人，将自动转发到 Agent');