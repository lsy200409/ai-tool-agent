// 智谱 ChatGLM 完整页面结构
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
    // 整个 search-container
    const sc = document.querySelector('.search-container');
    out.searchContainerHTML = sc ? sc.outerHTML.substring(0, 3000) : 'not found';

    // 整个 input-outer
    const io = document.querySelector('.input-outer');
    out.inputOuterHTML = io ? io.outerHTML.substring(0, 2500) : 'not found';

    return out;
  });
  console.log('=== search-container ===');
  console.log(result.searchContainerHTML);
  console.log('\n=== input-outer ===');
  console.log(result.inputOuterHTML);

  await browser.close();
})();
