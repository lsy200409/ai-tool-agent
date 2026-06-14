/**
 * 补充截图 - 面板展开状态
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223');
  const contexts = browser.contexts();
  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      if (p.url().includes('deepseek.com')) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.error('未找到 DeepSeek 页面'); await browser.close(); return; }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(1000);

  // 强制展开面板
  console.log('强制展开面板...');
  await page.evaluate(() => {
    if (typeof togglePanel === 'function') togglePanel(true);
  });
  await page.waitForTimeout(1500);

  // 验证面板状态
  const state = await page.evaluate(() => {
    const panel = document.getElementById('__ds-agent-panel');
    if (!panel) return { exists: false };
    return { exists: true, display: window.getComputedStyle(panel).display };
  });
  console.log('面板状态:', JSON.stringify(state));

  // 截图: 面板展开
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'screenshot-2-panel-open.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 }
  });
  console.log('截图已保存: screenshot-2-panel-open.png');

  // 列出所有截图
  console.log('\n截图文件列表:');
  fs.readdirSync(SCREENSHOT_DIR).forEach(f => {
    const stat = fs.statSync(path.join(SCREENSHOT_DIR, f));
    console.log('  ' + f + ' (' + Math.round(stat.size / 1024) + ' KB)');
  });

  await browser.close();
})().catch(err => { console.error('失败:', err.message); process.exit(1); });
