// 通用 DOM 探查脚本
// 用法: node dom-probe.js <url>
const { chromium } = require('playwright-core');

const url = process.argv[2];
if (!url) { console.error('用法: node dom-probe.js <url>'); process.exit(1); }

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  let page = context.pages().find(p => p.url().includes(new URL(url).hostname) || p.url().includes(new URL(url).host));
  if (!page) {
    page = await context.newPage();
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); }
    catch(e) { console.log('导航超时:', e.message); }
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('当前URL:', page.url());
  console.log('标题:', await page.title());

  const result = await page.evaluate(() => {
    const out = {};
    out.location = { href: location.href, host: location.host };

    // 1. 输入框
    out.textareas = Array.from(document.querySelectorAll('textarea')).slice(0, 5).map(t => ({
      cls: t.className, placeholder: t.placeholder, visible: t.clientHeight > 0
    }));
    out.contenteditable = Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0, 5).map(t => ({
      tag: t.tagName, cls: t.className, role: t.getAttribute('role'),
      placeholder: t.getAttribute('data-placeholder') || t.getAttribute('aria-label'),
      visible: t.clientHeight > 0
    }));

    // 2. 发送按钮
    const sendSelectors = ['button[class*="send"]', 'div[class*="send-button"]', 'button[aria-label*="send" i]', 'button[aria-label*="发送" i]', 'button[type="submit"]'];
    out.sendButtons = [];
    sendSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(b => {
        out.sendButtons.push({ tag: b.tagName, cls: b.className, sel, visible: b.clientHeight > 0, disabled: b.disabled });
      });
    });

    // 3. 消息相关 class
    const all = document.querySelectorAll('body *');
    const map = new Map();
    all.forEach(e => {
      if (e.className && typeof e.className === 'string') {
        e.className.split(/\s+/).forEach(c => {
          if (c && (c.includes('message') || c.includes('chat-') || c.includes('assistant') || c.includes('user-message') || c.includes('markdown') || c.includes('response'))) {
            map.set(c, (map.get(c) || 0) + 1);
          }
        });
      }
    });
    out.messageClasses = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25);

    // 4. AI 消息容器候选
    const aiSelectors = [
      '[data-message-author-role="assistant"]',
      '.assistant-message',
      '[class*="assistant"]',
      '[class*="markdown-body"]',
      '.markdown',
      'div[class*="message-content"]'
    ];
    out.aiCandidates = [];
    aiSelectors.forEach(sel => {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        out.aiCandidates.push({ sel, count: els.length, sample: els[0].outerHTML.substring(0, 200) });
      }
    });

    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
