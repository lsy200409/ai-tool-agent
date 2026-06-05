// 豆包深度探查 - 找发送按钮
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

    // 向上找父级
    let p = ta;
    out.parents = [];
    for (let i = 0; i < 10 && p; i++) {
      out.parents.push({
        tag: p.tagName,
        cls: (p.className || '').substring(0, 150),
        childCount: p.children.length,
        buttons: p.querySelectorAll('button').length,
        hasSvg: p.querySelectorAll('svg').length
      });
      p = p.parentElement;
    }

    // 找 textarea 父级内所有 button 和 div[role="button"]
    let topParent = ta.closest('[class*="semi"], [class*="input"], [class*="chat"], [class*="footer"], [class*="bottom"]');
    out.topParent = topParent ? {
      tag: topParent.tagName,
      cls: topParent.className?.substring(0, 200),
      html: topParent.outerHTML.substring(0, 3000)
    } : null;

    // 找页面上所有 button 中含 svg 且非 type=button 的
    out.allSvgButtons = Array.from(document.querySelectorAll('button')).filter(b => {
      const svg = b.querySelector('svg');
      return svg && b.clientHeight > 0;
    }).map(b => ({
      cls: (b.className || '').substring(0, 150),
      ariaLabel: b.getAttribute('aria-label'),
      title: b.title,
      text: b.textContent?.trim().substring(0, 20),
      disabled: b.disabled
    })).slice(0, 15);

    return out;
  });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
