/**
 * AI Tool Agent — Playwright 登录调试脚本
 * 用于截图查看 DeepSeek 登录页面结构
 */

const { chromium } = require('playwright');
const path = require('path');

const EXTENSION_PATH = path.join(__dirname, '..');

async function main() {
  var browser = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      '--disable-extensions-except=' + EXTENSION_PATH,
      '--load-extension=' + EXTENSION_PATH,
      '--no-sandbox'
    ]
  });

  var page = await browser.newPage();
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 截图
  await page.screenshot({ path: 'test/screenshots/deepseek-landing.png', fullPage: true });
  console.log('截图已保存: test/screenshots/deepseek-landing.png');

  // 打印页面结构
  var pageInfo = await page.evaluate(function() {
    return {
      url: location.href,
      title: document.title,
      buttons: Array.from(document.querySelectorAll('button')).map(function(b) { return b.innerText.trim(); }).filter(Boolean),
      links: Array.from(document.querySelectorAll('a')).map(function(a) { return { text: a.innerText.trim(), href: a.href }; }).filter(function(l) { return l.text; }),
      inputs: Array.from(document.querySelectorAll('input')).map(function(i) { return { type: i.type, name: i.name, placeholder: i.placeholder }; }),
      textareas: Array.from(document.querySelectorAll('textarea')).map(function(t) { return { placeholder: t.placeholder, className: t.className }; })
    };
  });
  console.log('\n页面信息:');
  console.log('URL:', pageInfo.url);
  console.log('Title:', pageInfo.title);
  console.log('Buttons:', JSON.stringify(pageInfo.buttons, null, 2));
  console.log('Links:', JSON.stringify(pageInfo.links.slice(0, 10), null, 2));
  console.log('Inputs:', JSON.stringify(pageInfo.inputs, null, 2));
  console.log('Textareas:', JSON.stringify(pageInfo.textareas, null, 2));

  // 尝试点击登录按钮
  var loginBtn = await page.$('button:has-text("登录"), a:has-text("登录"), button:has-text("Log in"), a:has-text("Log in")');
  if (loginBtn) {
    console.log('\n找到登录按钮，点击...');
    await loginBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test/screenshots/deepseek-login.png', fullPage: true });
    console.log('登录页截图已保存: test/screenshots/deepseek-login.png');

    var loginPageInfo = await page.evaluate(function() {
      return {
        url: location.href,
        inputs: Array.from(document.querySelectorAll('input')).map(function(i) { return { type: i.type, name: i.name, placeholder: i.placeholder, id: i.id }; }),
        buttons: Array.from(document.querySelectorAll('button')).map(function(b) { return b.innerText.trim(); }).filter(Boolean)
      };
    });
    console.log('登录页 URL:', loginPageInfo.url);
    console.log('登录页 Inputs:', JSON.stringify(loginPageInfo.inputs, null, 2));
    console.log('登录页 Buttons:', JSON.stringify(loginPageInfo.buttons, null, 2));
  } else {
    console.log('\n未找到登录按钮');
  }

  // 不关闭浏览器，让用户手动查看
  console.log('\n浏览器保持打开，按 Ctrl+C 关闭');
  await new Promise(function() {});
}

main().catch(console.error);
