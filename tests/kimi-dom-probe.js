// 探查 Kimi 页面的 DOM 结构
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  // 查找或打开 Kimi 页面
  let kimiPage = context.pages().find(p => p.url().includes('kimi.com') || p.url().includes('moonshot.cn'));
  if (!kimiPage) {
    kimiPage = await context.newPage();
    await kimiPage.goto('https://kimi.com', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('当前URL:', kimiPage.url());

  const result = await kimiPage.evaluate(() => {
    const out = {};

    // 1. 输入框
    out.textareas = Array.from(document.querySelectorAll('textarea')).map(t => ({
      cls: t.className,
      placeholder: t.placeholder,
      visible: t.clientHeight > 0
    }));

    // 2. contenteditable
    out.contenteditable = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(t => ({
      tag: t.tagName,
      cls: t.className,
      role: t.getAttribute('role'),
      visible: t.clientHeight > 0
    }));

    // 3. 发送按钮
    out.sendButtons = Array.from(document.querySelectorAll('.send-button-container, .send-button, [class*="send-button"]')).map(t => ({
      tag: t.tagName,
      cls: t.className,
      disabled: t.className.indexOf('disabled') >= 0,
      visible: t.clientHeight > 0
    }));

    // 4. 消息列表
    out.messageLists = Array.from(document.querySelectorAll('[class*="chat-message-list"], [class*="message-list"]')).map(t => ({
      tag: t.tagName,
      cls: t.className,
      childCount: t.children.length,
      childClasses: Array.from(t.children).slice(0, 5).map(c => c.className)
    }));

    // 5. 包含 message/chat 关键字的class
    const all = document.querySelectorAll('main *');
    const map = new Map();
    all.forEach(e => {
      if (e.className && typeof e.className === 'string') {
        const cls = e.className.split(' ')[0];
        if (cls.includes('message') || cls.includes('chat-') || cls.includes('assistant')) {
          map.set(cls, (map.get(cls) || 0) + 1);
        }
      }
    });
    out.relatedClasses = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);

    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
