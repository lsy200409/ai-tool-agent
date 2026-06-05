// 增强版 DOM 探查脚本
// 用法: node dom-probe-v2.js <url>
const { chromium } = require('playwright-core');

const url = process.argv[2];
if (!url) { console.error('用法: node dom-probe-v2.js <url>'); process.exit(1); }

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  let page = context.pages().find(p => {
    try { return p.url().includes(new URL(url).hostname); } catch(e) { return false; }
  });
  if (!page) {
    page = await context.newPage();
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch(e) { console.log('导航超时:', e.message); }
    await new Promise(r => setTimeout(r, 6000));
  }

  console.log('当前URL:', page.url());
  console.log('标题:', await page.title());

  const result = await page.evaluate(() => {
    const out = {};
    out.location = { href: location.href, host: location.host };

    // 1. 输入框 - textarea
    out.textareas = Array.from(document.querySelectorAll('textarea')).slice(0, 8).map(t => ({
      cls: t.className,
      id: t.id,
      name: t.name,
      placeholder: t.placeholder,
      visible: t.clientHeight > 0,
      parentCls: t.parentElement?.className?.substring(0, 80),
      grandparentCls: t.parentElement?.parentElement?.className?.substring(0, 80)
    }));

    // 2. 输入框 - contenteditable
    out.contenteditable = Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0, 8).map(t => ({
      tag: t.tagName,
      cls: t.className,
      id: t.id,
      role: t.getAttribute('role'),
      contentEditable: t.contentEditable,
      placeholder: t.getAttribute('data-placeholder') || t.getAttribute('aria-label') || t.getAttribute('placeholder'),
      visible: t.clientHeight > 0,
      lexical: t.getAttribute('data-lexical-editor') === 'true',
      parentCls: t.parentElement?.className?.substring(0, 80)
    }));

    // 3. 发送按钮 - 多种选择器
    const sendSelectors = [
      'button[class*="send"]', 'div[class*="send-button"]', 'div[class*="send-btn"]',
      'button[aria-label*="send" i]', 'button[aria-label*="发送" i]',
      'button[type="submit"]', '[data-testid*="send"]',
      'button[class*="submit"]', '[class*="SendButton"]',
      // DeepSeek 特有
      'div[role="button"].ds-button--primary',
      // ChatGPT 特有
      '[data-testid="send-button"]',
      // 千问国际版
      '.message-input-right-button-send',
      // 豆包 Semi Design
      'button.semi-button-primary'
    ];
    out.sendButtons = [];
    sendSelectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(b => {
          out.sendButtons.push({
            tag: b.tagName, cls: b.className?.substring(0, 100), id: b.id,
            sel, visible: b.clientHeight > 0, disabled: b.disabled,
            ariaLabel: b.getAttribute('aria-label'),
            textContent: b.textContent?.trim().substring(0, 30),
            innerHTML: b.innerHTML?.substring(0, 100)
          });
        });
      } catch(e) {}
    });

    // 4. 输入区域附近的按钮（向上遍历查找）
    const inputEl = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    out.nearbyButtons = [];
    if (inputEl) {
      let parent = inputEl.parentElement;
      for (let i = 0; i < 6 && parent; i++) {
        const buttons = parent.querySelectorAll('button, [role="button"], div[class*="send"]');
        buttons.forEach(b => {
          if (b.clientHeight > 0) {
            out.nearbyButtons.push({
              tag: b.tagName, cls: b.className?.substring(0, 100), id: b.id,
              ariaLabel: b.getAttribute('aria-label'),
              textContent: b.textContent?.trim().substring(0, 30),
              level: i + 1,
              hasSvg: b.querySelector('svg') !== null,
              innerHTML: b.innerHTML?.substring(0, 150)
            });
          }
        });
        parent = parent.parentElement;
      }
    }

    // 5. 消息相关 class 统计
    const all = document.querySelectorAll('body *');
    const map = new Map();
    all.forEach(e => {
      if (e.className && typeof e.className === 'string') {
        e.className.split(/\s+/).forEach(c => {
          if (c && (c.includes('message') || c.includes('chat-') || c.includes('assistant') ||
              c.includes('user-message') || c.includes('markdown') || c.includes('response') ||
              c.includes('think') || c.includes('bubble') || c.includes('conversation'))) {
            map.set(c, (map.get(c) || 0) + 1);
          }
        });
      }
    });
    out.messageClasses = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);

    // 6. AI 消息容器候选 - 更全面的选择器
    const aiSelectors = [
      '[data-message-author-role="assistant"]',
      '.assistant-message', '[class*="assistant-message"]',
      '[class*="assistant"]', '[class*="markdown-body"]',
      '.markdown', 'div[class*="message-content"]',
      '[class*="text-assistant"]', '[class*="chat-message"]',
      '[class*="bot-message"]', '[class*="ai-message"]',
      '[class*="response-content"]', '[class*="answer-content"]',
      '.ds-assistant-message-main-content',
      '.qwen-chat-message',
      'div[class*="bubble-content"]',
      'div[class*="reply-content"]'
    ];
    out.aiCandidates = [];
    aiSelectors.forEach(sel => {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          out.aiCandidates.push({
            sel, count: els.length,
            sample: els[0].outerHTML.substring(0, 250),
            textSample: els[0].textContent?.substring(0, 100)
          });
        }
      } catch(e) {}
    });

    // 7. 思考/推理内容
    const thinkSelectors = [
      '[class*="think"]', '[class*="reasoning"]', '[class*="thought"]',
      '.ds-think-content', '[class*="thinking-content"]'
    ];
    out.thinkCandidates = [];
    thinkSelectors.forEach(sel => {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          out.thinkCandidates.push({
            sel, count: els.length,
            sample: els[0].outerHTML.substring(0, 200)
          });
        }
      } catch(e) {}
    });

    // 8. 消息列表容器
    const listSelectors = [
      '[class*="message-list"]', '[class*="chat-list"]', '[class*="conversation-list"]',
      '[class*="messages-container"]', '[class*="chat-container"]',
      '[data-testid="conversation-turn-"]'
    ];
    out.messageListCandidates = [];
    listSelectors.forEach(sel => {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          out.messageListCandidates.push({
            sel, count: els.length,
            sample: els[0].outerHTML.substring(0, 200)
          });
        }
      } catch(e) {}
    });

    // 9. data-testid 属性统计
    out.dataTestIds = [];
    document.querySelectorAll('[data-testid]').forEach(el => {
      const tid = el.getAttribute('data-testid');
      if (tid && (tid.includes('send') || tid.includes('message') || tid.includes('chat') ||
          tid.includes('input') || tid.includes('conversation') || tid.includes('turn'))) {
        out.dataTestIds.push({ tag: el.tagName, testid: tid, cls: el.className?.substring(0, 60) });
      }
    });

    // 10. 框架检测
    out.frameworks = {
      react: !!document.querySelector('[data-reactroot]') || !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
      vue: !!window.__VUE__ || !!document.querySelector('[data-v-]'),
      lexical: !!document.querySelector('[data-lexical-editor]'),
      next: !!window.__NEXT_DATA__,
      semi: !!document.querySelector('[class*="semi-"]'),
      antd: !!document.querySelector('[class*="ant-"]'),
      tailwind: !!document.querySelector('[class*="bg-"]')
    };

    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
