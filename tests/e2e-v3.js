// 全面端到端测试 v3
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];

  const platforms = [
    { name: 'Kimi', pattern: 'kimi' },
    { name: '千问国际版', pattern: 'qwen.ai' },
    { name: '豆包', pattern: 'doubao' },
    { name: '通义千问', pattern: 'qianwen' },
    { name: '智谱ChatGLM', pattern: 'chatglm' }
  ];

  for (const ck of platforms) {
    const page = context.pages().find(p => p.url().includes(ck.pattern));
    if (!page) { console.log(ck.name + ': 页面未打开'); continue; }

    console.log('\n=== ' + ck.name + ' ===');
    console.log('URL:', page.url());

    // CDP 网络监控
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    const apiRequests = [];
    client.on('Network.requestWillBeSent', (params) => {
      const url = params.request.url;
      if (url.includes('.js') || url.includes('.css') || url.includes('.png') || url.includes('.svg') ||
          url.includes('.woff') || url.includes('alicdn') || url.includes('google') ||
          url.includes('aliyun') || url.includes('arms') || url.includes('localhost') ||
          url.includes('byteacctimg') || url.includes('flow-doubao') || url.includes('bytegoofy') ||
          url.includes('volces') || url.includes('mcs.doubao') || url.includes('opt.doubao') ||
          url.includes('aplus.qwen') || url.includes('pagead2') || url.includes('alilog') ||
          url.includes('tongyi') || url.includes('mst') || url.includes('sentry') ||
          url.includes('.gif') || url.includes('.ico') || url.includes('.webp')) return;
      apiRequests.push({
        method: params.request.method,
        url: url.substring(0, 250)
      });
    });

    // 发送消息
    const sendResult = await page.evaluate(() => {
      const platform = window.PlatformRegistry ? PlatformRegistry.detect() : null;
      if (!platform) return { error: 'no platform' };

      // 找输入框
      var input = null;
      for (var i = 0; i < platform.dom.chatInputSelectors.length; i++) {
        var el = document.querySelector(platform.dom.chatInputSelectors[i]);
        if (el && el.clientHeight > 0) { input = el; break; }
      }
      if (!input) return { error: 'no input' };

      // setInputValue
      platform.setInputValue(input, 'hello');

      // 找发送按钮
      var btn = platform.dom.findSendButton();
      if (!btn) return { error: 'no send button', inputTag: input.tagName, inputValue: input.value || input.textContent?.substring(0, 30) };

      // 检查 disabled
      var isDisabled = btn.disabled || btn.classList.contains('disabled') || btn.classList.contains('cursor-not-allowed');
      if (isDisabled) return { error: 'send button disabled', inputTag: input.tagName, inputValue: input.value || input.textContent?.substring(0, 30), btnCls: (typeof btn.className === 'string' ? btn.className : '').substring(0, 80) };

      btn.click();
      return { success: true, inputTag: input.tagName, inputValue: input.value || input.textContent?.substring(0, 30), btnTag: btn.tagName, btnCls: (typeof btn.className === 'string' ? btn.className : '').substring(0, 80) };
    });
    console.log('发送结果:', JSON.stringify(sendResult));

    if (sendResult.success) {
      // 等待回复
      await new Promise(r => setTimeout(r, 12000));

      // 检查 SSE 拦截
      const sseResult = await page.evaluate(() => {
        const d = window.__ds_interceptor_debug ? window.__ds_interceptor_debug() : {};
        const s = window.__ds_streamState ? window.__ds_streamState() : {};
        // 获取 fetch_match 调试事件
        var fetchMatches = (d.streamEvents || []).filter(e => e.type === 'fetch_match');
        return {
          wrapperTotal: d.wrapperCalledTotal,
          wrapperMatch: d.wrapperCalledMatchingUrl,
          streamActive: s.active,
          accumulatedLen: s.accumulatedText?.length,
          accumulatedPreview: s.accumulatedText?.substring(0, 150),
          finishReason: s.finishReason,
          fetchMatches: fetchMatches.slice(-3),
          urlsSeen: d.urlsSeen?.slice(-8)
        };
      });
      console.log('SSE状态:', JSON.stringify(sseResult, null, 2));

      // 检查 API 请求
      var chatRequests = apiRequests.filter(r =>
        r.url.includes('chat') || r.url.includes('completion') || r.url.includes('message') ||
        r.url.includes('samantha') || r.url.includes('ChatService')
      );
      console.log('聊天API请求 (' + chatRequests.length + '):');
      chatRequests.forEach(r => console.log('  [' + r.method + '] ' + r.url));
    }

    await client.send('Network.disable');
  }

  await browser.close();
})();
