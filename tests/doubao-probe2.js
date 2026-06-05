// 豆包 - 找真正的发送按钮
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('doubao.com'));
  if (!page) page = await context.newPage();
  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));

  const result = await page.evaluate(() => {
    const out = {};
    const ta = document.querySelector('textarea.semi-input-textarea');
    if (!ta) return { error: 'no textarea' };

    // 在 textarea 父级向上 4 层中找所有 button
    let top = ta.parentElement;
    for (let i = 0; i < 4; i++) {
      if (top.parentElement) top = top.parentElement;
    }

    // 找 textarea 同辈且在 textarea 之后的 button
    const siblings = [];
    let walker = ta.parentElement;
    while (walker) {
      // 找 walker 的所有子button
      walker.querySelectorAll('button').forEach(b => {
        if (b.clientHeight > 0) {
          siblings.push({
            cls: (b.className || '').substring(0, 100),
            text: b.textContent?.trim().substring(0, 30),
            hasSvg: !!b.querySelector('svg'),
            rect: b.getBoundingClientRect().width + 'x' + b.getBoundingClientRect().height,
            disabled: b.disabled
          });
        }
      });
      walker = walker.parentElement;
      if (!walker || siblings.length > 30) break;
    }
    out.siblingButtons = siblings;

    return out;
  });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
