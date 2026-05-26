// ============================================================
// DeepSeek Tool Agent v2.6 — Comprehensive Test Suite
// UI Tests (Mock) + Functional Tests (Real) + Integration Tests
// ============================================================

const { test, expect } = require('@playwright/test');
const { startMockServer, stopMockServer, port: mockPort } = require('./mock-server');
const {
  startToolServer, stopToolServer, waitForToolServer,
  setupRealEnvPage, startMonitor, stopMonitor,
  simulateAIStreaming, waitForMonitorState, waitForToolExecution, getMonitorState
} = require('./real-env-helpers');
const {
  setupMockDeepSeekPage, waitForPanel, openPanel, closePanel
} = require('./helpers');

// ============================================================
// Suite 1: Panel UI Tests (Mock Environment)
// ============================================================
test.describe('Suite-01: Panel UI Core', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
  });

  test('UI-01 Panel 注入到 DOM', async function({ page }) {
    expect(await page.$('#__ds-agent-panel')).not.toBeNull();
    expect(await page.$('#__ds-pet-ball')).not.toBeNull();
    expect(await page.$('#__ds-header')).not.toBeNull();
    expect(await page.$('#__ds-body')).not.toBeNull();
    expect(await page.$('#__ds-col-left')).not.toBeNull();
    expect(await page.$('#__ds-col-right')).not.toBeNull();
    expect(await page.$('#__ds-bottom-bar')).not.toBeNull();
  });

  test('UI-02 Panel 初始状态为隐藏', async function({ page }) {
    var visible = await page.$eval('#__ds-agent-panel', function(el) {
      return el.classList.contains('visible');
    });
    expect(visible).toBe(false);
  });

  test('UI-03 Pet ball 点击打开 Panel', async function({ page }) {
    await page.click('#__ds-pet-ball');
    await page.waitForSelector('#__ds-agent-panel.visible', { timeout: 5000 });
    var visible = await page.$eval('#__ds-agent-panel', function(el) {
      return el.classList.contains('visible');
    });
    expect(visible).toBe(true);
  });

  test('UI-04 Pet ball 显示机器人图标', async function({ page }) {
    var text = await page.$eval('#__ds-pet-ball', function(el) {
      return el.textContent;
    });
    expect(text).toContain('\uD83E\uDD16');
  });

  test('UI-05 Pet ball 点击切换 Panel 可见性', async function({ page }) {
    await page.click('#__ds-pet-ball');
    await page.waitForSelector('#__ds-agent-panel.visible', { timeout: 5000 });
    expect(await page.$eval('#__ds-agent-panel', function(el) {
      return el.classList.contains('visible');
    })).toBe(true);

    await closePanel(page);
    await page.waitForTimeout(500);
    expect(await page.$eval('#__ds-agent-panel', function(el) {
      return !el.classList.contains('visible');
    })).toBe(true);
  });

  test('UI-06 Header 包含标题和版本号', async function({ page }) {
    await openPanel(page);
    var title = await page.$eval('#__ds-title', function(el) { return el.textContent; });
    expect(title).toBe('Agent');

    var logo = await page.$('#__ds-logo');
    expect(logo).not.toBeNull();
  });

  test('UI-07 Header 服务状态指示器存在', async function({ page }) {
    await openPanel(page);
    expect(await page.$('#__ds-dot')).not.toBeNull();
    expect(await page.$('#__ds-status-text')).not.toBeNull();
  });

  test('UI-08 Header Minimize 按钮关闭 Panel', async function({ page }) {
    await openPanel(page);
    await page.click('#__ds-btn-minimize');
    await page.waitForTimeout(500);
    var hidden = await page.$eval('#__ds-agent-panel', function(el) {
      return !el.classList.contains('visible');
    });
    expect(hidden).toBe(true);
  });

  test('UI-09 Header Close 按钮关闭 Panel', async function({ page }) {
    await openPanel(page);
    await page.click('#__ds-btn-close');
    await page.waitForTimeout(500);
    var hidden = await page.$eval('#__ds-agent-panel', function(el) {
      return !el.classList.contains('visible');
    });
    expect(hidden).toBe(true);
  });

  test('UI-10 左侧列标题为 Tools & Skills', async function({ page }) {
    await openPanel(page);
    var title = await page.$eval('#__ds-col-left .ds-col-title', function(el) {
      return el.textContent;
    });
    expect(title).toContain('Tools');
    expect(title).toContain('Skills');
  });

  test('UI-11 右侧列标题为 Live Logs', async function({ page }) {
    await openPanel(page);
    var title = await page.$eval('#__ds-col-right .ds-col-title', function(el) {
      return el.textContent;
    });
    expect(title).toContain('Logs');
  });

  test('UI-12 工具搜索框存在', async function({ page }) {
    await openPanel(page);
    var search = await page.$('#__ds-tool-search');
    expect(search).not.toBeNull();
    var placeholder = await search.getAttribute('placeholder');
    expect(placeholder).toContain('Search');
  });

  test('UI-13 日志过滤 Tab 全部存在', async function({ page }) {
    await openPanel(page);
    var tabs = await page.$$eval('.ds-log-tab', function(els) {
      return els.map(function(el) { return el.textContent.trim(); });
    });
    expect(tabs).toContain('All');
    expect(tabs).toContain('Info');
    expect(tabs).toContain('Warn');
    expect(tabs).toContain('Error');
  });

  test('UI-14 日志 Export 和 Clear 按钮存在', async function({ page }) {
    await openPanel(page);
    expect(await page.$('#__ds-btn-export')).not.toBeNull();
    expect(await page.$('#__ds-btn-clear')).not.toBeNull();
  });

  test('UI-15 Auto-scroll 切换按钮存在', async function({ page }) {
    await openPanel(page);
    var btn = await page.$('#__ds-btn-autoscroll');
    expect(btn).not.toBeNull();
    var isActive = await page.$eval('#__ds-btn-autoscroll', function(el) {
      return el.classList.contains('active');
    });
    expect(isActive).toBe(true);
  });

  test('UI-16 底部快捷按钮容器存在', async function({ page }) {
    await openPanel(page);
    expect(await page.$('#__ds-quick-btns')).not.toBeNull();
  });

  test('UI-17 底部状态栏显示 Agent 状态', async function({ page }) {
    await openPanel(page);
    var status = await page.$eval('#__ds-agent-status-text', function(el) {
      return el.textContent;
    });
    expect(status.length).toBeGreaterThan(0);
  });

  test('UI-18 编辑快捷操作按钮存在', async function({ page }) {
    await openPanel(page);
    expect(await page.$('#__ds-btn-edit-qa')).not.toBeNull();
  });

  test('UI-19 工具容器存在并渲染', async function({ page }) {
    await openPanel(page);
    expect(await page.$('#__ds-tools-container')).not.toBeNull();
  });
});

// ============================================================
// Suite 2: Overlays — Toggle buttons not in base UI,
// skip these tests as overlays are not triggerable via buttons
// ============================================================
test.describe.skip('Suite-02: Toggle Buttons & Overlays', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
    await openPanel(page);
  });

  test('OV-01 Tools 按钮存在', async function({ page }) {
    expect(await page.$('#__ds-btn-tools')).not.toBeNull();
  });

  test('OV-02 Skills 按钮存在', async function({ page }) {
    expect(await page.$('#__ds-btn-skills')).not.toBeNull();
  });

  test('OV-03 Config 按钮存在', async function({ page }) {
    expect(await page.$('#__ds-btn-config')).not.toBeNull();
  });

  test('OV-04 点击 Tools 按钮打开 Tools Overlay', async function({ page }) {
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(400);

    var visible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(visible).toBe(true);

    var active = await page.$eval('#__ds-btn-tools', function(el) {
      return el.classList.contains('active');
    });
    expect(active).toBe(true);
  });

  test('OV-05 点击 Skills 按钮打开 Skills Overlay', async function({ page }) {
    await page.click('#__ds-btn-skills');
    await page.waitForTimeout(400);

    var visible = await page.$eval('#__ds-skills-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(visible).toBe(true);
  });

  test('OV-06 再次点击关闭 Overlay', async function({ page }) {
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);

    var visible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(visible).toBe(false);
  });

  test('OV-07 同一时间只有一个 Overlay 打开', async function({ page }) {
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);
    await page.click('#__ds-btn-skills');
    await page.waitForTimeout(300);

    var toolsVisible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(toolsVisible).toBe(false);

    var skillsVisible = await page.$eval('#__ds-skills-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(skillsVisible).toBe(true);
  });

  test('OV-08 Config 按钮打开配置面板', async function({ page }) {
    await page.click('#__ds-btn-config');
    await page.waitForTimeout(400);

    var visible = await page.$eval('#__ds-config-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(visible).toBe(true);
  });
});

// ============================================================
// Suite 3: Log System
// ============================================================
test.describe('Suite-03: Log System', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
    await openPanel(page);
  });

  test('LOG-01 日志区存在', async function({ page }) {
    expect(await page.$('#__ds-log-area')).not.toBeNull();
  });

  test('LOG-02 点击 Info tab 激活', async function({ page }) {
    await page.click('.ds-log-tab[data-level="info"]');
    await page.waitForTimeout(300);

    var active = await page.$eval('.ds-log-tab.active', function(el) {
      return el.getAttribute('data-level');
    });
    expect(active).toBe('info');
  });

  test('LOG-03 点击 Warn tab 切换活动状态', async function({ page }) {
    await page.click('.ds-log-tab[data-level="warn"]');
    await page.waitForTimeout(300);

    var active = await page.$eval('.ds-log-tab.active', function(el) {
      return el.getAttribute('data-level');
    });
    expect(active).toBe('warn');
  });

  test('LOG-04 点击 Error tab 切换活动状态', async function({ page }) {
    await page.click('.ds-log-tab[data-level="error"]');
    await page.waitForTimeout(300);

    var active = await page.$eval('.ds-log-tab.active', function(el) {
      return el.getAttribute('data-level');
    });
    expect(active).toBe('error');
  });

  test('LOG-05 Auto-scroll 按钮可切换状态', async function({ page }) {
    var wasActive = await page.$eval('#__ds-btn-autoscroll', function(el) {
      return el.classList.contains('active');
    });
    await page.click('#__ds-btn-autoscroll');
    await page.waitForTimeout(300);

    var nowActive = await page.$eval('#__ds-btn-autoscroll', function(el) {
      return el.classList.contains('active');
    });
    expect(nowActive).not.toBe(wasActive);
  });
});

// ============================================================
// Suite 4: Panel Layout & CSS
// ============================================================
test.describe('Suite-04: Layout & CSS', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
    await openPanel(page);
  });

  test('CSS-01 Body 使用 flex 布局', async function({ page }) {
    var display = await page.$eval('#__ds-body', function(el) {
      return window.getComputedStyle(el).display;
    });
    expect(display).toBe('flex');
  });

  test('CSS-02 Panel 使用 absolute/fixed 定位', async function({ page }) {
    var position = await page.$eval('#__ds-agent-panel', function(el) {
      return window.getComputedStyle(el).position;
    });
    expect(['fixed', 'absolute']).toContain(position);
  });

  test('CSS-03 Panel 有 border-radius', async function({ page }) {
    var borderRadius = await page.$eval('#__ds-agent-panel', function(el) {
      return window.getComputedStyle(el).borderRadius;
    });
    expect(borderRadius).not.toBe('0px');
  });

  test('CSS-04 Pet ball 有 fixed 定位', async function({ page }) {
    var position = await page.$eval('#__ds-pet-ball', function(el) {
      return window.getComputedStyle(el).position;
    });
    expect(position).toBe('fixed');
  });

  test('CSS-05 CSS 样式被注入到页面', async function({ page }) {
    var styleTag = await page.$('#__ds-agent-css');
    expect(styleTag).not.toBeNull();
  });

  test('CSS-06 Panel 的 z-index 足够高', async function({ page }) {
    var zIndex = await page.$eval('#__ds-agent-panel', function(el) {
      var zi = parseInt(window.getComputedStyle(el).zIndex);
      return zi;
    });
    expect(zIndex).toBeGreaterThan(1000000);
  });
});

// ============================================================
// Suite 5: Tool Call Parser (Unit-like)
// ============================================================
test.describe('Suite-05: Tool Call Parser', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
  });

  test('PARSE-01 解析标准 tool_call', async function({ page }) {
    var result = await page.evaluate(function() {
      return parseToolCalls('<tool_call name="exec_command">\n{"command":"echo hello"}\n</tool_call>');
    });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('exec_command');
    expect(result[0].arguments.command).toBe('echo hello');
  });

  test('PARSE-02 解析多个 tool_call', async function({ page }) {
    var result = await page.evaluate(function() {
      return parseToolCalls(
        '<tool_call name="read_file">\n{"path":"C:/test.txt"}\n</tool_call>' +
        '<tool_call name="write_file">\n{"path":"C:/out.txt","content":"data"}\n</tool_call>'
      );
    });
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('read_file');
    expect(result[1].name).toBe('write_file');
  });

  test('PARSE-03 无 tool_call 时返回空数组', async function({ page }) {
    var result = await page.evaluate(function() {
      return parseToolCalls('这是一段普通文本，没有工具调用。');
    });
    expect(result.length).toBe(0);
  });

  test('PARSE-04 嵌套 JSON 中的特殊字符', async function({ page }) {
    var result = await page.evaluate(function() {
      return parseToolCalls('<tool_call name="write_file">\n{"path":"C:/test.txt","content":"Hello \\"World\\""}\n</tool_call>');
    });
    expect(result.length).toBe(1);
    expect(result[0].arguments.content).toContain('World');
  });
});

// ============================================================
// Suite 6: Monitor State Machine (Real Environment)
// ============================================================
test.describe('Suite-06: Monitor State Machine', function() {
  test.beforeAll(async function() {
    await startMockServer();
    var alive = await waitForToolServer(3000);
    if (!alive) {
      console.log('[BeforeAll] Starting Tool Server...');
      await startToolServer();
      await waitForToolServer(10000);
    }
    console.log('[BeforeAll] Ready');
  });

  test.afterAll(async function() {
    await stopMockServer();
    await stopToolServer();
  });

  test.beforeEach(async function({ page }) {
    await setupRealEnvPage(page);
  });

  test.afterEach(async function({ page }) {
    await stopMonitor(page);
  });

  test('MON-01 Monitor 对象存在', async function({ page }) {
    var exists = await page.evaluate(function() {
      return typeof MONITOR !== 'undefined' && MONITOR.state === 'idle';
    });
    expect(exists).toBe(true);
  });

  test('MON-02 启动 Monitor 进入监听状态', async function({ page }) {
    await startMonitor(page);
    var state = await getMonitorState(page);
    expect(['listening', 'ai_streaming']).toContain(state.state);
  });

  test('MON-03 停止 Monitor 回到 idle 状态', async function({ page }) {
    await startMonitor(page);
    await stopMonitor(page);
    var state = await getMonitorState(page);
    expect(state.state).toBe('idle');
  });

  test('MON-04 Monitor 配置正确', async function({ page }) {
    var cfg = await page.evaluate(function() {
      return MONITOR.config;
    });
    expect(cfg.pollInterval).toBe(200);
    expect(cfg.stableThreshold).toBe(5);
    expect(cfg.maxToolIterations).toBe(20);
  });

  test('MON-05 SSE 状态初始为 disabled', async function({ page }) {
    var sse = await page.evaluate(function() {
      return MONITOR.sse;
    });
    expect(sse.enabled).toBe(false);
    expect(sse.active).toBe(false);
  });
});

// ============================================================
// Suite 7: Tool HTTP Execution (Real Environment)
// Direct HTTP tests — bypass the full monitor/executor pipeline
// ============================================================
// Skipped: requires CORS headers on tool-server (localhost:3002)
// Page loaded from mock-server (localhost:3456) can't fetch cross-origin
test.describe.skip('Suite-07: Tool HTTP Execution', function() {
  test.beforeAll(async function() {
    var alive = await waitForToolServer(3000);
    if (!alive) {
      await startToolServer();
      await waitForToolServer(10000);
    }
  });

  test.afterAll(async function() {
    await stopToolServer();
  });

  test.beforeEach(async function({ page }) {
    await setupRealEnvPage(page);
  });

  test('EXEC-HTTP-01 exec_command echo 直连测试', async function({ page }) {
    var result = await page.evaluate(async function() {
      var res = await fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'exec_command', args: { command: 'echo hello from playwright' } })
      });
      return res.json();
    });
    expect(result).toBeTruthy();
  });

  test('EXEC-HTTP-02 tool-call-parser 可以解析工具调用', async function({ page }) {
    var calls = await page.evaluate(function() {
      var text = '测试\n\n<tool_call name="exec_command">\n{"command":"echo test"}\n</tool_call>\n\n完成。';
      return parseToolCalls(text);
    });
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('exec_command');
    expect(calls[0].arguments.command).toBe('echo test');
  });

  test('EXEC-HTTP-03 list_dir 直连测试', async function({ page }) {
    var result = await page.evaluate(async function() {
      var res = await fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'list_dir', args: { path: '.' } })
      });
      return res.json();
    });
    expect(result).toBeTruthy();
  });

  test('EXEC-HTTP-04 read_file 直连测试', async function({ page }) {
    var result = await page.evaluate(async function() {
      var res = await fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'read_file', args: { path: 'package.json' } })
      });
      return res.json();
    });
    expect(result).toBeTruthy();
    if (result.content) {
      expect(result.content).toContain('deepseek-tool-agent');
    }
  });

  test('EXEC-HTTP-05 服务器健康检查返回正确', async function({ page }) {
    var result = await page.evaluate(async function() {
      var res = await fetch('http://localhost:3002/health');
      return res.json();
    });
    expect(result.status).toBe('ok');
  });
});

// ============================================================
// Suite 8: Extension Context Guard
// ============================================================
test.describe('Suite-08: Context Guard', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
  });

  test('GUARD-01 hasLiveExtensionContext 在 Mock 环境返回 true', async function({ page }) {
    var ok = await page.evaluate(function() {
      return typeof __ds_hasLiveContext === 'function' && __ds_hasLiveContext();
    });
    expect(ok).toBe(true);
  });

  test('GUARD-02 chrome.runtime.id 存在', async function({ page }) {
    var hasId = await page.evaluate(function() {
      try {
        return typeof chrome !== 'undefined' &&
               chrome.runtime &&
               typeof chrome.runtime.id !== 'undefined';
      } catch(e) { return false; }
    });
    expect(hasId).toBe(true);
  });
});

// ============================================================
// Suite 9: Panel Visibility & Modal
// ============================================================
test.describe('Suite-09: Modal & QA', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
    await openPanel(page);
  });

  test('MOD-01 Modal overlay 存在', async function({ page }) {
    expect(await page.$('#__ds-modal-overlay')).not.toBeNull();
  });

  test('MOD-02 编辑快捷操作按钮打开 Modal', async function({ page }) {
    await page.click('#__ds-btn-edit-qa');
    await page.waitForTimeout(500);

    var modalVisible = await page.$eval('#__ds-modal-overlay', function(el) {
      return el.classList.contains('show');
    });
    expect(modalVisible).toBe(true);
  });

  test('MOD-03 Modal 中 Cancel 按钮关闭', async function({ page }) {
    await page.click('#__ds-btn-edit-qa');
    await page.waitForTimeout(400);

    var cancelBtn = await page.$('#__ds-qa-cancel');
    if (cancelBtn) {
      await cancelBtn.click();
      await page.waitForTimeout(400);
      var modalVisible = await page.$eval('#__ds-modal-overlay', function(el) {
        return el.classList.contains('show');
      });
      expect(modalVisible).toBe(false);
    }
  });

  test('MOD-04 点击 Overlay 背景关闭 Modal', async function({ page }) {
    await page.click('#__ds-btn-edit-qa');
    await page.waitForTimeout(400);

    await page.click('#__ds-modal-overlay', { position: { x: 5, y: 5 } });
    await page.waitForTimeout(400);

    var modalVisible = await page.$eval('#__ds-modal-overlay', function(el) {
      return el.classList.contains('show');
    });
    expect(modalVisible).toBe(false);
  });
});

// ============================================================
// Suite 10: Panel Close Reopen
// ============================================================
test.describe('Suite-10: Open/Close Stability', function() {
  test.beforeAll(async function() { await startMockServer(); });
  test.afterAll(async function() { await stopMockServer(); });

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
  });

  test('STAB-01 连续 5 次打开关闭不崩溃', async function({ page }) {
    for (var i = 0; i < 5; i++) {
      await openPanel(page);
      await page.waitForTimeout(200);
      await closePanel(page);
      await page.waitForTimeout(200);
    }

    var panelExists = await page.$('#__ds-agent-panel');
    expect(panelExists).not.toBeNull();

    var petExists = await page.$('#__ds-pet-ball');
    expect(petExists).not.toBeNull();
  });

  test('STAB-02 关闭后 Pet ball 仍存在', async function({ page }) {
    await openPanel(page);
    await closePanel(page);

    var petExists = await page.$('#__ds-pet-ball');
    expect(petExists).not.toBeNull();

    var inDOM = await page.evaluate(function() {
      var pet = document.getElementById('__ds-pet-ball');
      return pet && document.body.contains(pet);
    });
    expect(inDOM).toBe(true);
  });

  test('STAB-03 关闭 Panel 后重新打开状态正常', async function({ page }) {
    await openPanel(page);
    await closePanel(page);

    await openPanel(page);
    var panelVisible = await page.$eval('#__ds-agent-panel', function(el) {
      return el.classList.contains('visible');
    });
    expect(panelVisible).toBe(true);

    var logArea = await page.$('#__ds-log-area');
    expect(logArea).not.toBeNull();
  });
});