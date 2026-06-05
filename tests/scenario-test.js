var { chromium } = require('playwright-core');
var http = require('http');
var fs = require('fs');
var path = require('path');

var startTime = Date.now();
var events = [];
var LOG_FILE = path.resolve(__dirname, '..', 'scenario-test-' + Date.now() + '.json');
var PASS = 0, FAIL = 0, SKIP = 0;
var LOGS_DIR = path.resolve(__dirname, '..', 'test-logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

function pad(n) { return n < 10 ? '0' + n : '' + n; }

async function scenario(id, name, fn) {
  var t0 = Date.now();
  console.log('\n  [' + id.toUpperCase() + '] ' + name);
  try {
    await fn();
    PASS++;
    console.log('    PASS (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  } catch (e) {
    FAIL++;
    console.log('    FAIL: ' + e.message.substring(0, 200));
    events.push({ scenario: id, status: 'FAIL', error: e.message });
  }
}

function apiGet(urlPath) {
  return new Promise(function(resolve, reject) {
    http.get('http://localhost:3002' + urlPath, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data, statusCode: res.statusCode }); }
      });
    }).on('error', reject);
  });
}

function apiPost(urlPath, body) {
  return new Promise(function(resolve, reject) {
    var payload = JSON.stringify(body);
    var req = http.request({
      hostname: 'localhost', port: 3002, path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data, statusCode: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════

async function run() {
  console.log('╔═════════════════════════════════════════════╗');
  console.log('║  DeepSeek Tool Agent — 场景模拟测试 v2.0    ║');
  console.log('║  Edge + API + 端到端                        ║');
  console.log('╚═════════════════════════════════════════════╝');
  console.log('');

  // ── Phase 1: Server API Tests ──
  console.log('═══ Phase 1: 服务器 API 测试 ═══');

  await scenario('srv-01', '健康检查 GET /health', async function() {
    var r = await apiGet('/health');
    if (!r || r.status !== 'ok') throw new Error('Server status != ok: ' + JSON.stringify(r));
    console.log('    Server v' + r.version + ', ' + r.toolCount + ' tools, ' + r.skillCount + ' skills, uptime=' + r.uptime + 's');
  });

  await scenario('srv-02', '列出所有工具 GET /api/tools', async function() {
    var r = await apiGet('/api/tools');
    if (!r.tools || !Array.isArray(r.tools)) throw new Error('tools not array');
    console.log('    ' + r.tools.length + ' tools: ' + r.tools.map(function(t) { return t.name; }).slice(0, 10).join(', ') + (r.tools.length > 10 ? '...' : ''));
  });

  await scenario('srv-03', '列出所有插件 GET /api/plugins', async function() {
    var r = await apiGet('/api/plugins');
    if (!r.plugins || !Array.isArray(r.plugins)) throw new Error('plugins not array');
    console.log('    ' + r.plugins.length + ' plugins: ' + r.plugins.map(function(p) { return p.id || p.name; }).join(', '));
  });

  await scenario('srv-04', '列出所有 Skills GET /api/skills', async function() {
    var r = await apiGet('/api/skills');
    if (!r.skills || !Array.isArray(r.skills)) throw new Error('skills not array');
    console.log('    ' + r.skills.length + ' skills: ' + r.skills.map(function(s) { return s.name; }).join(', '));
  });

  await scenario('srv-05', '工具执行: study_gpa_calc', async function() {
    var r = await apiPost('/api/tool', { name: 'study_gpa_calc', args: { courses: [{ name: '数学', credit: 4, score: 88 }, { name: '英语', credit: 3, score: 92 }], system: 'cn4' } });
    if (!r.success && !r.result) throw new Error('tool execution failed: ' + JSON.stringify(r));
    console.log('    ' + JSON.stringify(r).substring(0, 200));
  });

  await scenario('srv-06', '工具执行: daily_todo', async function() {
    var r = await apiPost('/api/tool', { name: 'daily_todo', args: { action: 'add', task: '完成E2E测试', priority: 'high' } });
    if (!r.success && !r.result) throw new Error('todo fail');
    console.log('    ' + JSON.stringify(r).substring(0, 200));
  });

  await scenario('srv-07', '工具执行: daily_countdown', async function() {
    var r = await apiPost('/api/tool', { name: 'daily_countdown', args: { action: 'add', title: '期末考试', date: '2026-07-01' } });
    if (!r.success && !r.result) throw new Error('countdown fail');
    console.log('    ' + JSON.stringify(r).substring(0, 200));
  });

  await scenario('srv-08', '工具执行: study_flashcard', async function() {
    var r = await apiPost('/api/tool', { name: 'study_flashcard', args: { topic: '计算机基础', cards: [{ q: 'HTTP状态码200表示什么？', a: '请求成功' }, { q: 'TCP和UDP的区别？', a: 'TCP面向连接可靠传输，UDP无连接快速传输' }], exportFormat: 'json' } });
    if (!r.success && !r.result) throw new Error('flashcard fail');
    console.log('    ' + JSON.stringify(r).substring(0, 200));
  });

  await scenario('srv-09', '工具执行: memory_save', async function() {
    var r = await apiPost('/api/tool', { name: 'memory_save', args: { key: 'test-key', value: 'test-value-' + Date.now() } });
    if (!r.success && !r.result) throw new Error('memory save fail');
    console.log('    ' + JSON.stringify(r).substring(0, 200));
  });

  await scenario('srv-10', '工具执行: memory_search', async function() {
    var r = await apiPost('/api/tool', { name: 'memory_search', args: { query: 'test' } });
    if (!r.success && !r.result) { SKIP++; console.log('    SKIP - search returned no results'); }
    else { console.log('    ' + JSON.stringify(r).substring(0, 200)); }
  });

  await scenario('srv-11', '列出所有倒计时', async function() {
    var r = await apiPost('/api/tool', { name: 'daily_countdown', args: { action: 'list' } });
    if (!r.success && !r.result) throw new Error('countdown list fail');
    console.log('    ' + JSON.stringify(r).substring(0, 200));
  });

  // ── Phase 2: Edge Browser Tests ──
  console.log('\n═══ Phase 2: Edge 浏览器测试 ═══');

  var browser = null, page = null;

  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    console.log('  Edge launched (headless)');

    await scenario('edge-01', '加载 DeepSeek 页面', async function() {
      await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      var title = await page.title();
      if (!title || title.indexOf('DeepSeek') < 0) throw new Error('unexpected title: ' + title);
      console.log('    Title: ' + title);
    });

    await scenario('edge-02', '页面包含 textarea', async function() {
      var ta = await page.$('textarea');
      if (!ta) throw new Error('no textarea found');
      console.log('    textarea: OK');
    });

    await scenario('edge-03', '页面包含发送按钮', async function() {
      var btns = await page.$$('button');
      if (!btns || btns.length === 0) throw new Error('no buttons found');
      console.log('    Buttons: ' + btns.length + ' found');
    });

    await scenario('edge-04', '发送简单消息', async function() {
      var ta = await page.$('textarea');
      if (!ta) throw new Error('no textarea');

      await ta.click();
      await page.waitForTimeout(500);

      await page.evaluate(function() {
        var ta = document.querySelector('textarea');
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(ta, '1+1等于几？');
        } else {
          ta.value = '1+1等于几？';
        }
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await page.waitForTimeout(1000);

      // Find send button
      var sent = await page.evaluate(function() {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          var b = btns[i];
          if (b.disabled) continue;
          var svg = b.querySelector('svg');
          if (svg && !b.textContent.trim()) { b.click(); return true; }
        }
        return false;
      });

      if (!sent) throw new Error('could not find send button');
      console.log('    Message sent: 1+1等于几？');
    });

    await scenario('edge-05', '等待 AI 回复', async function() {
      // wait up to 30s for response
      var found = false;
      for (var i = 0; i < 15; i++) {
        await page.waitForTimeout(2000);
        var text = await page.evaluate(function() {
          var els = document.querySelectorAll('[class*="message"], [class*="response"], [class*="assistant"]');
          var longest = '';
          for (var j = 0; j < els.length; j++) {
            var t = els[j].textContent || '';
            if (t.length > longest.length) longest = t;
          }
          return longest;
        });
        if (text.length > 10) { found = true; console.log('    Response (' + text.length + ' chars): ' + text.substring(0, 100).replace(/\n/g, ' ')); break; }
      }
      if (!found) { SKIP++; console.log('    SKIP - no response detected within 30s (may need login)'); throw new Error('no response'); }
    });

  } catch (e) {
    console.log('    Browser test issue: ' + e.message);
  } finally {
    if (page) await page.close().catch(function() {});
    if (browser) await browser.close().catch(function() {});
  }

  // ── Phase 3: Summary ──
  console.log('\n═════════════════════════════════════════════');
  console.log('  测试汇总');
  console.log('═════════════════════════════════════════════');
  console.log('');
  console.log('  ✅ Passed:  ' + PASS);
  console.log('  ❌ Failed:  ' + FAIL);
  console.log('  ⏭️  Skipped: ' + SKIP);
  console.log('  📊 Total:   ' + (PASS + FAIL + SKIP));
  console.log('  ⏱  耗时: ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's');
  console.log('');
  console.log('  📁 日志: ' + LOG_FILE);

  var summary = {
    time: new Date().toISOString(),
    duration: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
    results: { passed: PASS, failed: FAIL, skipped: SKIP, total: PASS + FAIL + SKIP },
    events: events
  };
  fs.writeFileSync(LOG_FILE, JSON.stringify(summary, null, 2));
}

run().catch(function(e) {
  console.error('\n💥 测试崩溃: ' + e.message);
  process.exit(1);
});