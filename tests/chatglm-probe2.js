// 智谱 ChatGLM 真实聊天页探查
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  let page = context.pages().find(p => p.url().includes('chatglm.cn'));
  if (!page) {
    page = await context.newPage();
  }

  // 尝试进入聊天页（不同可能的URL）
  const urls = [
    'https://chatglm.cn/',
    'https://chatglm.cn/main/chat?lang=zh',
    'https://chatglm.cn/chat?lang=zh'
  ];

  for (const u of urls) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await new Promise(r => setTimeout(r, 3000));
      const r = await page.evaluate(() => ({
        url: location.href,
        textareas: Array.from(document.querySelectorAll('textarea')).filter(t => t.clientHeight > 0).length,
        cedit: Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(t => t.clientHeight > 0).length,
        bodyTxt: document.body.innerText.substring(0, 300)
      }));
      console.log('URL:', u, '-> 实际:', r.url, 'textarea可见:', r.textareas, 'contenteditable可见:', r.cedit);
      if (r.textareas > 0 || r.cedit > 0) {
        console.log('Body snippet:', r.bodyTxt);
        // 列出可见输入框详细信息
        const detail = await page.evaluate(() => {
          return {
            textareas: Array.from(document.querySelectorAll('textarea')).filter(t => t.clientHeight > 0).map(t => ({
              cls: t.className, placeholder: t.placeholder, parentCls: t.parentElement?.className?.substring(0, 80)
            })),
            cedit: Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(t => t.clientHeight > 0).map(t => ({
              tag: t.tagName, cls: t.className?.substring(0, 100), role: t.getAttribute('role'),
              placeholder: t.getAttribute('placeholder') || t.getAttribute('data-placeholder')
            })),
            // 所有可见 button
            buttons: Array.from(document.querySelectorAll('button')).filter(b => b.clientHeight > 0).map(b => ({
              cls: b.className?.substring(0, 100), text: b.textContent?.trim().substring(0, 20),
              disabled: b.disabled, hasSvg: !!b.querySelector('svg')
            })).slice(0, 20)
          };
        });
        console.log('\n=== 详细DOM ===');
        console.log(JSON.stringify(detail, null, 2));
        break;
      }
    } catch(e) { console.log('URL', u, '失败:', e.message.substring(0, 80)); }
  }

  await browser.close();
})();
