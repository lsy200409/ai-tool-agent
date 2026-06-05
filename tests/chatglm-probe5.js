// 智谱 ChatGLM 查找 input-box-container 的所有子元素
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  let page = context.pages().find(p => p.url().includes('chatglm.cn'));
  if (!page) page = await context.newPage();
  await page.goto('https://chatglm.cn/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));

  const result = await page.evaluate(() => {
    const out = {};
    const ibc = document.querySelector('.input-box-container');
    if (ibc) {
      out.inputBoxContainer = {
        childCount: ibc.children.length,
        html: ibc.outerHTML.substring(0, 2500),
        children: Array.from(ibc.children).map(c => ({
          tag: c.tagName, cls: (c.className || '').substring(0, 100),
          childCount: c.children.length, html: c.outerHTML.substring(0, 200)
        }))
      };
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();
