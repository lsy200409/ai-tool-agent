// 智谱 ChatGLM 深度探查
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  // 导航到聊天页
  let page = context.pages().find(p => p.url().includes('chatglm.cn'));
  if (!page) {
    page = await context.newPage();
  }
  await page.goto('https://chatglm.cn/main/alltoolsdetail?lang=zh', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));

  console.log('当前URL:', page.url());

  // 1. 列出所有 textarea 和 contenteditable
  let result = await page.evaluate(() => {
    const out = {};
    out.textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({
      cls: t.className, placeholder: t.placeholder, visible: t.clientHeight > 0,
      parentCls: t.parentElement?.className?.substring(0, 100)
    }));
    out.contenteditable = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(t => ({
      tag: t.tagName, cls: t.className?.substring(0, 100), role: t.getAttribute('role'),
      placeholder: t.getAttribute('placeholder') || t.getAttribute('data-placeholder'),
      visible: t.clientHeight > 0
    }));
    // 查找聊天容器
    out.chat = document.querySelector('.main-chat-search, [class*="chat-input"], [class*="conversation-input"]')?.outerHTML?.substring(0, 500);
    return out;
  });
  console.log('=== 初始页面 ===');
  console.log(JSON.stringify(result, null, 2));

  // 2. 尝试点击搜索框或聊天入口
  console.log('\n=== 尝试点击聊天区域 ===');
  try {
    await page.click('textarea.scroll-display-none', { timeout: 5000 });
    await page.fill('textarea.scroll-display-none', '你好');
    await new Promise(r => setTimeout(r, 2000));

    result = await page.evaluate(() => {
      return {
        url: location.href,
        textareas: Array.from(document.querySelectorAll('textarea')).map(t => ({
          cls: t.className, placeholder: t.placeholder, visible: t.clientHeight > 0,
          parentCls: t.parentElement?.className?.substring(0, 100)
        })),
        contenteditable: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(t => ({
          tag: t.tagName, cls: t.className?.substring(0, 100), role: t.getAttribute('role'),
          visible: t.clientHeight > 0
        })),
        buttons: Array.from(document.querySelectorAll('button')).slice(0, 15).map(b => ({
          cls: b.className?.substring(0, 100), text: b.textContent?.trim().substring(0, 30),
          visible: b.clientHeight > 0, disabled: b.disabled
        }))
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } catch(e) { console.log('点击失败:', e.message); }

  await browser.close();
})();
