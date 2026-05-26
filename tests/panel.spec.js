const { test, expect } = require('@playwright/test');
const { startMockServer, stopMockServer } = require('./mock-server');
const {
  setupMockDeepSeekPage,
  waitForPanel,
  openPanel,
  closePanel,
} = require('./helpers');

test.beforeAll(async function() {
  await startMockServer();
});

test.afterAll(async function() {
  await stopMockServer();
});

test.describe('DS-Agent v2.5 Panel UI', function() {

  test.beforeEach(async function({ page }) {
    await setupMockDeepSeekPage(page);
    await waitForPanel(page);
  });

  test('TC01 - Extension 注入面板 DOM', async function({ page }) {
    var panel = await page.$('#__ds-agent-panel');
    expect(panel).not.toBeNull();

    var pet = await page.$('#__ds-pet-ball');
    expect(pet).not.toBeNull();

    var header = await page.$('#__ds-header');
    expect(header).not.toBeNull();
  });

  test('TC02 - Pet ball 点击展开面板', async function({ page }) {
    var pet = await page.$('#__ds-pet-ball');
    expect(pet).not.toBeNull();

    await page.click('#__ds-pet-ball');
    await page.waitForSelector('#__ds-agent-panel.visible', { timeout: 5000 });

    var panelVisible = await page.evaluate(function() {
      var p = document.getElementById('__ds-agent-panel');
      return p && p.classList.contains('visible') && p.style.display === 'flex';
    });
    expect(panelVisible).toBe(true);
  });

  test('TC03 - Pet ball 点击关闭面板', async function({ page }) {
    await openPanel(page);
    await closePanel(page);

    var panelHidden = await page.evaluate(function() {
      var p = document.getElementById('__ds-agent-panel');
      return p && !p.classList.contains('visible');
    });
    expect(panelHidden).toBe(true);
  });

  test('TC04 - 展开后左侧列为 File Explorer', async function({ page }) {
    await openPanel(page);

    var fileTree = await page.$('#__ds-file-tree');
    expect(fileTree).not.toBeNull();

    var colTitle = await page.$eval('#__ds-col-left .ds-col-title', function(el) {
      return el.textContent;
    });
    expect(colTitle).toBe('File Explorer');
  });

  test('TC05 - Workspace Tab 和 Plugins Tab 存在', async function({ page }) {
    await openPanel(page);

    var tabWs = await page.$('#__ds-fe-tab-workspace');
    expect(tabWs).not.toBeNull();
    var tabPl = await page.$('#__ds-fe-tab-plugins');
    expect(tabPl).not.toBeNull();

    var wsActive = await page.$eval('#__ds-fe-tab-workspace', function(el) {
      return el.classList.contains('active');
    });
    expect(wsActive).toBe(true);
  });

  test('TC06 - Plugins Tab 切换到插件目录', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-fe-tab-plugins');
    await page.waitForTimeout(500);

    var plActive = await page.$eval('#__ds-fe-tab-plugins', function(el) {
      return el.classList.contains('active');
    });
    expect(plActive).toBe(true);

    var wsActive = await page.$eval('#__ds-fe-tab-workspace', function(el) {
      return el.classList.contains('active');
    });
    expect(wsActive).toBe(false);
  });

  test('TC07 - 切换回 Workspace Tab', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-fe-tab-plugins');
    await page.waitForTimeout(300);
    await page.click('#__ds-fe-tab-workspace');
    await page.waitForTimeout(300);

    var wsActive = await page.$eval('#__ds-fe-tab-workspace', function(el) {
      return el.classList.contains('active');
    });
    expect(wsActive).toBe(true);
  });

  test('TC08 - Toggle 按钮存在', async function({ page }) {
    await openPanel(page);

    var btnTools = await page.$('#__ds-btn-tools');
    expect(btnTools).not.toBeNull();
    var btnSkills = await page.$('#__ds-btn-skills');
    expect(btnSkills).not.toBeNull();
  });

  test('TC09 - 工具按钮弹出 Tools Overlay', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(400);

    var toolsVisible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(toolsVisible).toBe(true);

    var btnActive = await page.$eval('#__ds-btn-tools', function(el) {
      return el.classList.contains('active');
    });
    expect(btnActive).toBe(true);
  });

  test('TC10 - 技能按钮弹出 Skills Overlay', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-btn-skills');
    await page.waitForTimeout(400);

    var skillsVisible = await page.$eval('#__ds-skills-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(skillsVisible).toBe(true);

    var btnActive = await page.$eval('#__ds-btn-skills', function(el) {
      return el.classList.contains('active');
    });
    expect(btnActive).toBe(true);
  });

  test('TC11 - 再次点击同一按钮关闭 Overlay', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);

    var toolsVisible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(toolsVisible).toBe(false);
  });

  test('TC12 - 同一时间只有一个 Overlay', async function({ page }) {
    await openPanel(page);

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

  test('TC13 - 点击面板外部关闭 Overlay', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);

    await page.click('#chat-messages');
    await page.waitForTimeout(300);

    var toolsVisible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(toolsVisible).toBe(false);
  });

  test('TC14 - 关闭面板时 Overlay 随之关闭', async function({ page }) {
    await openPanel(page);
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);

    await closePanel(page);

    await openPanel(page);
    var toolsVisible = await page.$eval('#__ds-tools-overlay', function(el) {
      return el.classList.contains('visible');
    });
    expect(toolsVisible).toBe(false);
  });

  test('TC15 - Header Close 按钮关闭面板', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-btn-close');
    await page.waitForTimeout(300);

    var panelHidden = await page.evaluate(function() {
      var p = document.getElementById('__ds-agent-panel');
      return p && !p.classList.contains('visible');
    });
    expect(panelHidden).toBe(true);
  });

  test('TC16 - Header Minimize 按钮关闭面板', async function({ page }) {
    await openPanel(page);

    await page.click('#__ds-btn-minimize');
    await page.waitForTimeout(300);

    var panelHidden = await page.evaluate(function() {
      var p = document.getElementById('__ds-agent-panel');
      return p && !p.classList.contains('visible');
    });
    expect(panelHidden).toBe(true);
  });

  test('TC17 - 日志过滤 Tab 存在', async function({ page }) {
    await openPanel(page);

    var tabs = await page.$$eval('.ds-log-tab', function(els) {
      return els.map(function(el) { return el.textContent.trim(); });
    });
    expect(tabs).toContain('All');
    expect(tabs).toContain('Info');
    expect(tabs).toContain('Warn');
    expect(tabs).toContain('Error');
  });

  test('TC18 - 日志过滤切换功能', async function({ page }) {
    await openPanel(page);

    await page.click('.ds-log-tab[data-level="info"]');
    await page.waitForTimeout(200);

    var activeTab = await page.$eval('.ds-log-tab.active', function(el) {
      return el.getAttribute('data-level');
    });
    expect(activeTab).toBe('info');
  });

  test('TC19 - Auto-scroll 切换', async function({ page }) {
    await openPanel(page);

    var btn = await page.$('#__ds-btn-autoscroll');
    expect(btn).not.toBeNull();

    var wasActive = await page.$eval('#__ds-btn-autoscroll', function(el) {
      return el.classList.contains('active');
    });
    await btn.click();
    await page.waitForTimeout(200);

    var nowActive = await page.$eval('#__ds-btn-autoscroll', function(el) {
      return el.classList.contains('active');
    });
    expect(nowActive).not.toBe(wasActive);
  });

  test('TC20 - Export 按钮存在', async function({ page }) {
    await openPanel(page);
    var btn = await page.$('#__ds-btn-export');
    expect(btn).not.toBeNull();
  });

  test('TC21 - Clear 按钮存在', async function({ page }) {
    await openPanel(page);
    var btn = await page.$('#__ds-btn-clear');
    expect(btn).not.toBeNull();
  });

  test('TC22 - 刷新按钮存在', async function({ page }) {
    await openPanel(page);
    var refreshBtn = await page.$('#__ds-btn-fe-refresh');
    expect(refreshBtn).not.toBeNull();
  });

  test('TC23 - 底部快捷按钮存在', async function({ page }) {
    await openPanel(page);
    var quickBtns = await page.$('#__ds-quick-btns');
    expect(quickBtns).not.toBeNull();
  });

  test('TC24 - 状态栏显示 Agent 状态', async function({ page }) {
    await openPanel(page);
    var statusText = await page.$('#__ds-agent-status-text');
    expect(statusText).not.toBeNull();
  });

  test('TC25 - 编辑快捷操作按钮存在', async function({ page }) {
    await openPanel(page);
    var editBtn = await page.$('#__ds-btn-edit-qa');
    expect(editBtn).not.toBeNull();
  });

  test('TC26 - 服务状态指示器存在', async function({ page }) {
    await openPanel(page);
    var dot = await page.$('#__ds-dot');
    expect(dot).not.toBeNull();
    var statusText = await page.$('#__ds-status-text');
    expect(statusText).not.toBeNull();
  });

  test('TC27 - Panel 有正确的 CSS 布局结构', async function({ page }) {
    await openPanel(page);

    var bodyDisplay = await page.$eval('#__ds-body', function(el) {
      return window.getComputedStyle(el).display;
    });
    expect(bodyDisplay).toBe('flex');

    var colRight = await page.$('#__ds-col-right');
    expect(colRight).not.toBeNull();
    var colLeft = await page.$('#__ds-col-left');
    expect(colLeft).not.toBeNull();
  });

  test('TC28 - 文件预览面板初始为隐藏', async function({ page }) {
    await openPanel(page);

    var preview = await page.$('#__ds-file-preview');
    expect(preview).not.toBeNull();

    var isHidden = await page.$eval('#__ds-file-preview', function(el) {
      return el.classList.contains('__ds-hidden');
    });
    expect(isHidden).toBe(true);
  });

  test('TC29 - 文件树容器存在', async function({ page }) {
    await openPanel(page);

    var fileTree = await page.$('#__ds-file-tree');
    expect(fileTree).not.toBeNull();

    var hasChildren = await page.$eval('#__ds-file-tree', function(el) {
      return el.children.length > 0;
    });
    expect(hasChildren).toBe(true);
  });

  test('TC30 - Tools Overlay 包含搜索框', async function({ page }) {
    await openPanel(page);
    await page.click('#__ds-btn-tools');
    await page.waitForTimeout(300);

    var searchInput = await page.$('#__ds-tool-search');
    expect(searchInput).not.toBeNull();

    var placeholder = await searchInput.getAttribute('placeholder');
    expect(placeholder).toContain('Search');
  });

  test('TC31 - Skills Overlay 包含添加技能按钮', async function({ page }) {
    await openPanel(page);
    await page.click('#__ds-btn-skills');
    await page.waitForTimeout(300);

    var addBtn = await page.$('#__ds-btn-add-skill');
    expect(addBtn).not.toBeNull();
  });
});