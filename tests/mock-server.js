const http = require('http');
const fs = require('fs');
const path = require('path');

var MOCK_HTML = fs.readFileSync(path.resolve(__dirname, 'mock-chat.html'), 'utf-8');
var MOCK_DEEPSEEK_HTML = fs.readFileSync(path.resolve(__dirname, 'mock-deepseek.html'), 'utf-8');
var MOCK_PORT = 3456;
var server = null;

function startMockServer() {
  return new Promise(function(resolve, reject) {
    server = http.createServer(function(req, res) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.url.indexOf('mock-deepseek') >= 0) {
        res.end(MOCK_DEEPSEEK_HTML);
      } else {
        res.end(MOCK_HTML);
      }
      console.log('[MockServer] 200 ' + req.url);
    });
    server.listen(MOCK_PORT, function() {
      console.log('[MockServer] started on http://localhost:' + MOCK_PORT);
      resolve(server);
    });
    server.on('error', reject);
  });
}

function stopMockServer() {
  return new Promise(function(resolve) {
    if (server) { server.close(function() { resolve(); }); }
    else { resolve(); }
  });
}

module.exports = { startMockServer, stopMockServer, port: MOCK_PORT };