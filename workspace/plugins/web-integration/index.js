module.exports = function register(api) {
  var http = require('http');
  var https = require('https');
  var url = require('url');

  api.logger.info('[web-integration] 初始化 Web 集成工具 v1.0.0');

  function doFetch(targetUrl, headers, timeout) {
    return new Promise(function(resolve, reject) {
      var parsed = url.parse(targetUrl);
      var mod = parsed.protocol === 'https:' ? https : http;
      var opts = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: 'GET',
        headers: Object.assign({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }, headers || {}),
        timeout: timeout || 15000
      };

      var req = mod.request(opts, function(res) {
        var buf = [];
        res.on('data', function(c) { buf.push(c); });
        res.on('end', function() {
          var body = Buffer.concat(buf).toString('utf-8');
          resolve({ status: res.statusCode, headers: res.headers, body: body, length: body.length });
        });
      });
      req.on('error', function(e) { reject(e); });
      req.on('timeout', function() { req.destroy(); reject(new Error('请求超时')); });
      req.end();
    });
  }

  function doWebhook(targetUrl, payload, headers, timeout) {
    return new Promise(function(resolve, reject) {
      var parsed = url.parse(targetUrl);
      var mod = parsed.protocol === 'https:' ? https : http;
      var body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      var buf = Buffer.from(body, 'utf-8');
      var opts = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Content-Length': buf.length
        }, headers || {}),
        timeout: timeout || 15000
      };

      var req = mod.request(opts, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() {
          var respBody = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode, body: respBody });
        });
      });
      req.on('error', function(e) { reject(e); });
      req.on('timeout', function() { req.destroy(); reject(new Error('请求超时')); });
      req.write(buf);
      req.end();
    });
  }

  api.registerTool(function(ctx) {
    return [
      {
        name: 'web_fetch',
        label: '抓取网页',
        description: '抓取指定URL的网页内容，可用于素材收集、竞品分析。返回HTML原文(前10000字符)及状态码。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '目标网页URL' },
            timeout: { type: 'number', description: '超时毫秒数，默认15000' }
          },
          required: ['url']
        },
        execute: async function(args) {
          try {
            var raw = await doFetch(args.url, null, args.timeout || 15000);
            var text = raw.body;
            text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
            text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
            text = text.replace(/<[^>]+>/g, ' ');
            text = text.replace(/\s+/g, ' ').trim();
            if (text.length > 10000) text = text.substring(0, 10000) + '...[已截断]';
            return JSON.stringify({ url: args.url, status: raw.status, title: extractTitle(raw.body), text: text, length: raw.length });
          } catch(e) {
            return JSON.stringify({ error: e.message, url: args.url });
          }
        }
      },
      {
        name: 'webhook_send',
        label: '发送 Webhook',
        description: '向指定URL发送HTTP POST请求，用于连接n8n/Make/Zapier等工作流平台或企业微信/钉钉/飞书机器人。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Webhook URL' },
            payload: { type: 'string', description: 'JSON格式的发送内容' },
            headers: { type: 'string', description: '额外的HTTP头，JSON格式，可选' }
          },
          required: ['url', 'payload']
        },
        execute: async function(args) {
          try {
            var hdrs = {};
            if (args.headers) {
              try { hdrs = JSON.parse(args.headers); } catch(e) {}
            }
            var result = await doWebhook(args.url, args.payload, hdrs, 15000);
            return JSON.stringify({ success: true, status: result.status, response: result.body.substring(0, 500) });
          } catch(e) {
            return JSON.stringify({ success: false, error: e.message });
          }
        }
      }
    ];
  });

  function extractTitle(html) {
    var m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : '';
  }
};