// 深度 DOM 探查 - 连接已打开的页面进行探测
// 用法: node dom-probe-deep.js <hostname-pattern>
// 例如: node dom-probe-deep.js qianwen
const { chromium } = require('playwright-core');

const pattern = process.argv[2];
if (!pattern) { console.error('用法: node dom-probe-deep.js <hostname-pattern>'); process.exit(1); }

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  // 找到匹配的页面
  const page = context.pages().find(p => {
    try { return new URL(p.url()).hostname.includes(pattern); } catch(e) { return false; }
  });

  if (!page) {
    console.error('未找到匹配页面，当前打开的页面:');
    context.pages().forEach(p => console.log('  ', p.url()));
    await browser.close();
    process.exit(1);
  }

  console.log('探测页面:', page.url());

  const result = await page.evaluate(() => {
    const out = {};

    // 1. 输入框
    out.textareas = Array.from(document.querySelectorAll('textarea')).slice(0, 8).map(t => ({
      cls: t.className, id: t.id, name: t.name, placeholder: t.placeholder,
      visible: t.clientHeight > 0, rows: t.rows,
      parentCls: t.parentElement?.className?.substring(0, 100),
      grandparentTag: t.parentElement?.parentElement?.tagName,
      grandparentCls: t.parentElement?.parentElement?.className?.substring(0, 100)
    }));

    out.contenteditable = Array.from(document.querySelectorAll('[contenteditable="true"]')).slice(0, 8).map(t => ({
      tag: t.tagName, cls: t.className?.substring(0, 100), id: t.id,
      role: t.getAttribute('role'), contentEditable: t.contentEditable,
      placeholder: t.getAttribute('data-placeholder') || t.getAttribute('aria-label') || t.getAttribute('placeholder'),
      visible: t.clientHeight > 0,
      lexical: t.getAttribute('data-lexical-editor') === 'true',
      parentCls: t.parentElement?.className?.substring(0, 100)
    }));

    // 2. 发送按钮 - 全面搜索
    out.sendButtons = [];
    // 按选择器搜索
    const sendSelectors = [
      'button[class*="send"]', 'div[class*="send-button"]', 'div[class*="send-btn"]',
      'button[aria-label*="send" i]', 'button[aria-label*="发送" i]',
      'button[type="submit"]', '[data-testid*="send"]',
      '.message-input-right-button-send', '.send-button-container',
      '[class*="SendButton"]', 'button.semi-button-primary'
    ];
    sendSelectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(b => {
          out.sendButtons.push({
            source: 'selector', tag: b.tagName, cls: b.className?.substring(0, 120), id: b.id,
            sel, visible: b.clientHeight > 0, disabled: b.disabled || b.classList.contains('disabled'),
            ariaLabel: b.getAttribute('aria-label'),
            innerHTML: b.innerHTML?.substring(0, 200)
          });
        });
      } catch(e) {}
    });

    // 3. 输入区域附近的交互元素
    const inputEl = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    out.inputAreaElements = [];
    if (inputEl) {
      let parent = inputEl.parentElement;
      for (let i = 0; i < 8 && parent; i++) {
        // 查找所有可点击元素
        const clickables = parent.querySelectorAll('button, [role="button"], [class*="send"], a[class*="btn"]');
        clickables.forEach(b => {
          if (b.clientHeight > 0) {
            out.inputAreaElements.push({
              tag: b.tagName, cls: (typeof b.className === 'string' ? b.className : b.className?.baseVal || '')?.substring(0, 120), id: b.id,
              ariaLabel: b.getAttribute('aria-label'),
              textContent: b.textContent?.trim().substring(0, 40),
              level: i + 1,
              hasSvg: b.querySelector('svg') !== null,
              onlySvg: b.querySelector('svg') !== null && b.textContent?.trim().length < 5,
              innerHTML: b.innerHTML?.substring(0, 200)
            });
          }
        });
        parent = parent.parentElement;
      }
    }

    // 4. 消息相关 class 统计
    const all = document.querySelectorAll('body *');
    const map = new Map();
    all.forEach(e => {
      if (e.className && typeof e.className === 'string') {
        e.className.split(/\s+/).forEach(c => {
          if (c && (c.includes('message') || c.includes('chat-') || c.includes('assistant') ||
              c.includes('user-') || c.includes('markdown') || c.includes('response') ||
              c.includes('think') || c.includes('bubble') || c.includes('conversation') ||
              c.includes('answer') || c.includes('reply') || c.includes('content') ||
              c.includes('segment') || c.includes('turn'))) {
            map.set(c, (map.get(c) || 0) + 1);
          }
        });
      }
    });
    out.messageClasses = Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);

    // 5. AI 消息容器候选 - 更全面
    const aiSelectors = [
      '[data-message-author-role="assistant"]',
      '.assistant-message', '[class*="assistant-message"]',
      '[class*="chat-content-item-assistant"]',
      '[class*="segment-assistant"]',
      '.markdown', '.markdown-body', '[class*="markdown-body"]',
      '[class*="message-content"]', '[class*="text-assistant"]',
      '[class*="chat-message"]', '[class*="bot-message"]',
      '[class*="ai-message"]', '[class*="response-content"]',
      '[class*="answer-content"]', '.ds-assistant-message-main-content',
      '.qwen-chat-message', '[class*="bubble-content"]',
      '[class*="reply-content"]', '[class*="answer-box"]',
      '[class*="model-response"]', '[class*="output-content"]'
    ];
    out.aiCandidates = [];
    aiSelectors.forEach(sel => {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          out.aiCandidates.push({
            sel, count: els.length,
            sample: els[0].outerHTML.substring(0, 300),
            textSample: els[0].textContent?.substring(0, 150)
          });
        }
      } catch(e) {}
    });

    // 6. 消息列表/对话容器
    const listSelectors = [
      '[class*="message-list"]', '[class*="chat-list"]', '[class*="conversation-list"]',
      '[class*="messages-container"]', '[class*="chat-container"]',
      '[class*="chat-content"]', '[class*="dialog-container"]',
      '[class*="chat-detail"]', '[class*="conversation-inner"]'
    ];
    out.messageListCandidates = [];
    listSelectors.forEach(sel => {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          out.messageListCandidates.push({
            sel, count: els.length,
            sample: els[0].outerHTML.substring(0, 300)
          });
        }
      } catch(e) {}
    });

    // 7. 思考内容
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

    // 8. 框架检测
    out.frameworks = {
      react: !!document.querySelector('[data-reactroot]') || !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
      vue: !!window.__VUE__ || !!document.querySelector('[data-v-]'),
      lexical: !!document.querySelector('[data-lexical-editor]'),
      next: !!window.__NEXT_DATA__,
      semi: !!document.querySelector('[class*="semi-"]'),
      antd: !!document.querySelector('[class*="ant-"]') || !!document.querySelector('[class*="css-"]'),
      tailwind: !!document.querySelector('[class*="bg-"]') || !!document.querySelector('[class*="flex-"]')
    };

    // 9. 特殊探测 - 查找用户消息和AI消息的区分方式
    out.messageStructure = [];
    // 查找消息列表的直接子元素
    const messageListEl = document.querySelector('[class*="chat-content-list"]') ||
                          document.querySelector('[class*="message-list"]') ||
                          document.querySelector('[class*="conversation-inner"]') ||
                          document.querySelector('[class*="chat-detail"]');
    if (messageListEl) {
      const children = Array.from(messageListEl.children).slice(0, 6);
      children.forEach((child, idx) => {
        out.messageStructure.push({
          index: idx,
          tag: child.tagName,
          cls: child.className?.substring(0, 150),
          childCount: child.children.length,
          textPreview: child.textContent?.substring(0, 80)
        });
      });
    }

    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
