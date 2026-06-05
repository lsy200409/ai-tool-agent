var { chromium } = require('playwright-core');
var fs = require('fs');
var path = require('path');

var T0 = Date.now();
var LOG = path.resolve(__dirname, '..', 'daily-sim-' + Date.now() + '.json');
var results = [];

function ts() { return ((Date.now() - T0) / 1000).toFixed(1); }
function p(msg) { console.log('[' + ts() + 's] ' + msg); }
function rec(id, pass, detail) {
  results.push({ id: id, pass: pass, detail: detail, t: ts() + 's' });
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + ' [' + id + '] ' + (detail || '').substring(0, 120));
}

async function typeAndSend(page, text) {
  // Focus textarea
  var ta = await page.$('textarea');
  if (!ta) throw new Error('textarea not found');
  await ta.click();
  await page.waitForTimeout(300);

  // Set value via React-compatible method
  await page.evaluate(function(t) {
    var el = document.querySelector('textarea');
    var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, t);
    else el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: t, inputType: 'insertText' }));
  }, text);

  await page.waitForTimeout(600);

  // Find and click send button
  var clicked = await page.evaluate(function() {
    var ta = document.querySelector('textarea');
    var taR = ta ? ta.getBoundingClientRect() : { bottom: 0, right: 0 };
    var btns = Array.from(document.querySelectorAll('button')).filter(function(b) {
      return !b.disabled && b.getBoundingClientRect().width > 0;
    });
    // Score buttons by proximity to textarea
    var best = null, bs = 0;
    btns.forEach(function(b) {
      var r = b.getBoundingClientRect();
      var svg = !!b.querySelector('svg');
      var empty = !(b.textContent || '').trim();
      var near = Math.abs(r.top - taR.bottom) < 150;
      var s = 0;
      if (svg && empty && near) s = 100;
      else if (svg && near) s = 70;
      else if (svg && empty) s = 40;
      if (s > bs) { bs = s; best = b; }
    });
    if (best && bs >= 40) { best.click(); return true; }
    // Fallback: Enter
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return false;
  });
  await page.waitForTimeout(500);
  return clicked;
}

async function waitForResponse(page, timeout) {
  var deadline = Date.now() + (timeout || 120000);
  var lastLen = 0, stable = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    var info = await page.evaluate(function() {
      var ss = window.__ds_streamState ? window.__ds_streamState() : {};
      var ms = window.__ds_monitorState || {};
      return {
        active: ss.active || false,
        len: (ss.accumulatedText || '').length,
        preview: (ss.accumulatedText || '').substring(0, 200).replace(/\n/g, ' '),
        finish: ss.finishReason || '',
        state: ms.state || '?',
        tools: ms.toolCalls || 0,
        toolNames: ms.toolNames || [],
        execResults: ms.execResults || 0
      };
    });
    if (info.len > 0 && info.len !== lastLen) { lastLen = info.len; stable = 0; }
    else if (!info.active && info.len > 0) { stable++; }

    // 工具调用链：如果检测到工具调用，等执行+注入+AI再回复
    if (info.tools > 0 && info.state === 'executing_tools') {
      p('  工具执行中... (tools=' + info.tools + ', state=' + info.state + ')');
    }

    // 流结束 + 文本稳定 → 第一轮AI回复完成
    if (!info.active && info.len > 0 && stable >= 3) {
      // 如果有工具调用，需要等工具执行完+结果注入+AI再回复
      if (info.tools > 0) {
        p('  检测到工具调用(' + info.tools + '个)，等待执行+注入+AI再回复...');
        var toolDeadline = Date.now() + 90000;
        while (Date.now() < toolDeadline) {
          await page.waitForTimeout(3000);
          var toolInfo = await page.evaluate(function() {
            var ss = window.__ds_streamState ? window.__ds_streamState() : {};
            var ms = window.__ds_monitorState || {};
            return {
              active: ss.active || false,
              len: (ss.accumulatedText || '').length,
              state: ms.state || '?',
              tools: ms.toolCalls || 0,
              execResults: ms.execResults || 0
            };
          });
          p('  工具链: state=' + toolInfo.state + ' len=' + toolInfo.len + ' tools=' + toolInfo.tools);
          // 等到monitor回到listening/idle且流不活跃，说明工具链完成
          if ((toolInfo.state === 'listening' || toolInfo.state === 'idle') && !toolInfo.active && toolInfo.len > lastLen) {
            p('  工具链完成！AI最终回复' + toolInfo.len + '字');
            return toolInfo;
          }
        }
        p('  工具链等待超时');
        return info;
      }
      return info;
    }
  }
  return { len: lastLen, timeout: true };
}

async function getExtState(page) {
  return await page.evaluate(function() {
    var ms = window.__ds_monitorState || {};
    return {
      injected: !!window.__ds_sse_interceptor_ready,
      monitor: ms.state ? { state: ms.state, autoWatch: ms.autoWatch } : null,
      stream: window.__ds_streamState ? { active: (window.__ds_streamState().active || false), len: (window.__ds_streamState().accumulatedText || '').length } : null,
      panel: !!document.getElementById('__ds-agent-panel'),
      pet: !!document.getElementById('__ds-pet-ball'),
      wsTab: !!document.querySelector('.ds-left-tab[data-tab="workspace"]'),
      fileTree: !!document.getElementById('__ds-file-tree'),
      toolsCount: (function() { var c = document.getElementById('__ds-tools-container'); return c ? c.querySelectorAll('.ds-tool-card').length : 0; })(),
      logCount: (window.__ds_executionHistory || []).length
    };
  });
}

// ═══════════════════════════════════════════════════
// 大学生日常使用场景模拟
// ═══════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  大学生日常使用场景模拟测试 — Playwright + Chrome CDP  ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');

  // ── 连接 Chrome ──
  p('连接 Chrome CDP (localhost:9222)...');
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }
  p('已连接: ' + page.url());

  // 监听页面控制台
  page.on('console', function(msg) {
    var t = msg.text();
    if (t.indexOf('[Monitor]') >= 0 || t.indexOf('[SSE]') >= 0 || t.indexOf('[Tool]') >= 0) {
      console.log('    [PAGE] ' + t.substring(0, 200));
    }
  });

  // ══════════════════════════════════════════════
  // 场景1: 打开新对话，检查扩展注入
  // ══════════════════════════════════════════════
  console.log('\n══ 场景1: 打开新对话，检查扩展注入 ══');
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  var s1 = await getExtState(page);
  p('扩展状态: injected=' + s1.injected + ' monitor=' + JSON.stringify(s1.monitor) + ' pet=' + s1.pet);
  rec('S1-注入检查', s1.injected, 'SSE拦截器: ' + s1.injected);
  rec('S1-悬浮球', s1.pet, '悬浮球可见: ' + s1.pet);
  rec('S1-面板', s1.panel, '面板DOM存在: ' + s1.panel);

  // ══════════════════════════════════════════════
  // 场景1.5: 注入工具提示词
  // ══════════════════════════════════════════════
  console.log('\n══ 场景1.5: 注入工具提示词 ══');
  // Click the inject button in the panel (ISOLATED world)
  var injectResult = await page.evaluate(function() {
    var btn = document.getElementById('__ds-btn-inject-tools');
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  });
  p('注入按钮: ' + JSON.stringify(injectResult));
  
  // Wait for the prompt to be typed and sent
  await page.waitForTimeout(5000);
  
  // Wait for DeepSeek to acknowledge the tool prompt
  var r1b = await waitForResponse(page, 60000);
  p('工具提示词注入后AI回复: ' + r1b.len + '字');
  rec('S1.5-工具注入', r1b.len > 0, 'AI确认工具提示词: ' + r1b.len + '字');

  // ══════════════════════════════════════════════
  // 场景2: 日常问答 — "什么是操作系统"
  // ══════════════════════════════════════════════
  console.log('\n══ 场景2: 日常问答 — "什么是操作系统？" ══');
  await typeAndSend(page, '什么是操作系统？请用中文简短回答');
  var r2 = await waitForResponse(page, 60000);
  p('AI回复: ' + r2.len + '字, monitor=' + r2.state);
  rec('S2-日常问答', r2.len > 0, 'AI回复' + r2.len + '字, 预览: ' + (r2.preview || '').substring(0, 80));

  // ══════════════════════════════════════════════
  // 场景3: 触发工具调用 — "帮我执行一个命令"
  // ══════════════════════════════════════════════
  console.log('\n══ 场景3: 触发工具调用 — 执行命令 ══');
  await page.waitForTimeout(3000);
  await typeAndSend(page, '请使用exec_command工具帮我执行命令: echo "Hello from DeepSeek Tool Agent"');
  var r3 = await waitForResponse(page, 90000);
  p('AI回复: ' + r3.len + '字, 工具调用=' + r3.tools + ', 工具名=' + JSON.stringify(r3.toolNames));
  rec('S3-工具调用', r3.len > 0, '回复' + r3.len + '字, 工具调用' + r3.tools + '次');
  rec('S3-工具检测', r3.tools > 0, '检测到' + r3.tools + '次工具调用, 工具: ' + JSON.stringify(r3.toolNames));

  // ══════════════════════════════════════════════
  // 场景4: 文件操作 — "读取工作区文件"
  // ══════════════════════════════════════════════
  console.log('\n══ 场景4: 文件操作 — 读取工作区文件 ══');
  await page.waitForTimeout(3000);
  await typeAndSend(page, '请使用read_file工具读取工作区的config/skills_manifest.json文件');
  var r4 = await waitForResponse(page, 90000);
  p('AI回复: ' + r4.len + '字, 工具=' + r4.tools);
  rec('S4-文件读取', r4.len > 0, '回复' + r4.len + '字, 工具调用' + r4.tools + '次');

  // ══════════════════════════════════════════════
  // 场景5: 连续对话 — 监控链稳定性
  // ══════════════════════════════════════════════
  console.log('\n══ 场景5: 连续对话 — 监控链稳定性 ══');
  await page.waitForTimeout(3000);
  await typeAndSend(page, '再帮我用list_dir工具列出工作区根目录的文件');
  var r5 = await waitForResponse(page, 90000);
  p('第3轮AI回复: ' + r5.len + '字, monitor=' + r5.state);
  rec('S5-连续对话', r5.len > 0, '第3轮回复' + r5.len + '字, monitor=' + r5.state);

  // 检查监控链是否仍在idle
  var s5 = await getExtState(page);
  p('监控状态: ' + JSON.stringify(s5.monitor));
  rec('S5-监控链', s5.monitor && (s5.monitor.state === 'idle' || s5.monitor.state === 'listening'), '监控链最终状态: ' + (s5.monitor ? s5.monitor.state : 'null'));

  // ══════════════════════════════════════════════
  // 场景6: 刷新后恢复
  // ══════════════════════════════════════════════
  console.log('\n══ 场景6: 刷新页面后扩展恢复 ══');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  var s6 = await getExtState(page);
  p('刷新后: injected=' + s6.injected + ' monitor=' + JSON.stringify(s6.monitor));
  rec('S6-刷新恢复', s6.injected, '刷新后注入: ' + s6.injected + ', 监控: ' + JSON.stringify(s6.monitor));

  // ══════════════════════════════════════════════
  // 场景7: 刷新后再次对话
  // ══════════════════════════════════════════════
  console.log('\n══ 场景7: 刷新后再次对话 ══');
  await typeAndSend(page, '刷新后测试：1+2等于几？');
  var r7 = await waitForResponse(page, 60000);
  p('刷新后AI回复: ' + r7.len + '字');
  rec('S7-刷新后对话', r7.len > 0, '刷新后回复' + r7.len + '字');

  // ══════════════════════════════════════════════
  // 场景8: 面板UI检查
  // ══════════════════════════════════════════════
  console.log('\n══ 场景8: 面板UI完整性 ══');
  var s8 = await getExtState(page);
  p('面板: tools=' + s8.toolsCount + ' wsTab=' + s8.wsTab + ' fileTree=' + s8.fileTree + ' logs=' + s8.logCount);
  rec('S8-工具列表', s8.toolsCount > 0, '工具卡片: ' + s8.toolsCount + '个');
  rec('S8-WorkspaceTab', s8.wsTab, 'Workspace标签: ' + s8.wsTab);
  rec('S8-文件浏览器', s8.fileTree, '文件树DOM: ' + s8.fileTree);
  rec('S8-执行日志', s8.logCount > 0, '日志条目: ' + s8.logCount + '条');

  // ══════════════════════════════════════════════
  // 场景9: 点击悬浮球打开面板
  // ══════════════════════════════════════════════
  console.log('\n══ 场景9: 悬浮球交互 ══');
  var petEl = await page.$('#__ds-pet-ball');
  if (petEl) {
    // Simulate mousedown + mouseup with no movement (triggers togglePanel)
    var box = await petEl.boundingBox();
    if (box) {
      var cx = box.x + box.width / 2;
      var cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.waitForTimeout(50);
      await page.mouse.up();
    }
  }
  await page.waitForTimeout(1000);
  var panelVisible = await page.evaluate(function() {
    var p = document.getElementById('__ds-agent-panel');
    return p && p.offsetParent !== null;
  });
  p('悬浮球点击: ' + !!petEl + ', 面板可见: ' + panelVisible);
  rec('S9-悬浮球', !!petEl, '悬浮球元素: ' + !!petEl);
  rec('S9-面板切换', panelVisible, '面板可见: ' + panelVisible);

  // ══════════════════════════════════════════════
  // 场景10: Workspace Tab 切换
  // ══════════════════════════════════════════════
  console.log('\n══ 场景10: Workspace Tab 切换 ══');
  var wsTabClicked = await page.evaluate(function() {
    var tab = document.querySelector('.ds-left-tab[data-tab="workspace"]');
    if (!tab) return false;
    tab.click();
    return true;
  });
  await page.waitForTimeout(2000);
  var wsPanelActive = await page.evaluate(function() {
    var wsPanel = document.getElementById('__ds-left-workspace');
    return wsPanel && wsPanel.classList.contains('active');
  });
  p('Workspace Tab: clicked=' + wsTabClicked + ' active=' + wsPanelActive);
  rec('S10-WorkspaceTab', wsPanelActive, 'Workspace面板激活: ' + wsPanelActive);

  // ══════════════════════════════════════════════
  // 汇总
  // ══════════════════════════════════════════════
  var passed = results.filter(function(r) { return r.pass; }).length;
  var failed = results.filter(function(r) { return !r.pass; }).length;

  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  测试汇总                                            ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  results.forEach(function(r) {
    console.log('  ' + (r.pass ? 'OK' : 'XX') + '  ' + r.id + ': ' + r.detail.substring(0, 100));
  });
  console.log('');
  console.log('  通过: ' + passed + '/' + results.length);
  console.log('  失败: ' + failed + '/' + results.length);
  console.log('  耗时: ' + ts() + 's');
  console.log('  日志: ' + LOG);

  fs.writeFileSync(LOG, JSON.stringify({
    time: new Date().toISOString(),
    duration: ts() + 's',
    passed: passed,
    failed: failed,
    total: results.length,
    results: results
  }, null, 2));

  // 断开CDP但保持浏览器
  await browser.close();
  console.log('\n浏览器保持打开，可手动查看。');
}

main().catch(function(e) {
  console.error('测试崩溃: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});