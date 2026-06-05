// 智谱 ChatGLM 输入区域深度探查
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  let page = context.pages().find(p => p.url().includes('chatglm.cn'));
  if (!page) page = await context.newPage();
  await page.goto('https://chatglm.cn/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));

  console.log('当前URL:', page.url());

  // 查找输入框父容器及周围所有button/div
  const result = await page.evaluate(() => {
    const out = {};
    const ta = document.querySelector('textarea.scroll-display-none');
    if (!ta) return { error: 'no textarea' };

    // 向上找5层父元素
    let p = ta.parentElement;
    out.parents = [];
    for (let i = 0; i < 8 && p; i++) {
      out.parents.push({
        tag: p.tagName,
        cls: (p.className || '').substring(0, 150),
        childCount: p.children.length,
        hasButtons: p.querySelectorAll('button').length,
        hasSvg: p.querySelectorAll('svg').length
      });
      p = p.parentElement;
    }

    // 查找带svg的元素（发送按钮可能不是button）
    out.svgElements = Array.from(document.querySelectorAll('.input-box svg, [class*="input-box"] svg, [class*="input-area"] svg')).map(s => ({
      tag: s.tagName, cls: s.getAttribute('class'),
      parentTag: s.parentElement?.tagName, parentCls: (s.parentElement?.className || '').substring(0, 100),
      grandparentCls: (s.parentElement?.parentElement?.className || '').substring(0, 100)
    })).slice(0, 10);

    // 在 input-box 容器中查找
    const inputBox = ta.closest('[class*="input-box"]');
    out.inputBox = inputBox ? {
      cls: inputBox.className,
      html: inputBox.outerHTML.substring(0, 1500)
    } : null;

    return out;
  });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
