/**
 * 截图脚本 - 为 Edge 商店生成 1280x800 截图
 * 使用 Playwright CDP 连接 Edge
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

(async () => {
  console.log('连接 Edge CDP...');
  const browser = await chromium.connectOverCDP('http://localhost:9223');
  const contexts = browser.contexts();
  console.log('可用上下文:', contexts.length);

  // 找到 DeepSeek 标签页
  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      const url = p.url();
      console.log('  页面:', url);
      if (url.includes('deepseek.com')) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  if (!page) {
    console.log('未找到 DeepSeek 页面，尝试第一个页面...');
    page = contexts[0]?.pages()[0];
  }

  if (!page) {
    console.error('没有可用的页面！');
    await browser.close();
    return;
  }

  console.log('使用页面:', page.url());

  // 设置视口大小为 1280x800
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log('视口已设为 1280x800');

  // 等待页面加载
  await page.waitForTimeout(2000);

  // 截图1: 首页（工具面板关闭状态）
  console.log('截图1: 首页...');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'screenshot-1-homepage.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 }
  });

  // 注入工具提示词 (Ctrl+Shift+I)
  console.log('注入工具提示词 (Ctrl+Shift+I)...');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyI');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForTimeout(3000);

  // 截图2: 工具提示词注入后（面板展开状态）
  console.log('截图2: 工具面板展开...');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'screenshot-2-panel-open.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 }
  });

  // 检查面板状态
  const panelState = await page.evaluate(() => {
    const panel = document.getElementById('__ds-agent-panel');
    if (!panel) return { exists: false };
    const style = window.getComputedStyle(panel);
    return {
      exists: true,
      visible: style.display !== 'none',
      display: style.display
    };
  });
  console.log('面板状态:', JSON.stringify(panelState));

  // 截图3: 尝试发送一条消息触发工具调用
  console.log('输入测试消息...');
  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.click();
    await page.waitForTimeout(500);
    await textarea.fill('请列出当前工作区的文件');
    await page.waitForTimeout(500);

    // 截图3: 输入消息后
    console.log('截图3: 输入消息...');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot-3-message-typed.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });

    // 发送消息
    console.log('发送消息...');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(8000);

    // 截图4: 工具执行中/完成后
    console.log('截图4: 工具执行结果...');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot-4-tool-result.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });

    // 等待更多内容
    await page.waitForTimeout(5000);

    // 截图5: AI 回复完成
    console.log('截图5: AI 回复完成...');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'screenshot-5-ai-response.png'),
      clip: { x: 0, y: 0, width: 1280, height: 800 }
    });
  } else {
    console.log('未找到输入框，跳过消息截图');
  }

  console.log('\n截图完成！保存在:', SCREENSHOT_DIR);
  console.log('文件列表:');
  fs.readdirSync(SCREENSHOT_DIR).forEach(f => {
    const stat = fs.statSync(path.join(SCREENSHOT_DIR, f));
    console.log('  ' + f + ' (' + Math.round(stat.size / 1024) + ' KB)');
  });

  // 不关闭浏览器，只断开连接
  await browser.close();
})().catch(err => {
  console.error('截图失败:', err.message);
  process.exit(1);
});
