var { chromium } = require('playwright-core');

async function main() {
  console.log('连接 Chrome CDP...');
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }

  console.log('当前页面: ' + page.url());

  // 通过 chrome.management API 不行（CDP没有），用 chrome.runtime.reload
  // 方法：在页面中通过 postMessage 触发扩展重新加载
  // 最简单：直接刷新页面，content_scripts 会重新注入
  console.log('刷新页面以重新加载扩展...');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 验证扩展是否加载
  var extState = await page.evaluate(function() {
    return new Promise(function(resolve) {
      var timeout = setTimeout(function() {
        resolve({
          sse: !!window.__ds_sse_interceptor_ready,
          panel: !!document.getElementById('__ds-agent-panel'),
          pet: !!document.getElementById('__ds-pet-ball'),
          monitorState: (window.__ds_monitorState || {}).state || 'unknown'
        });
      }, 3000);

      window.addEventListener('message', function handler(e) {
        if (e.data && e.data.type === '__ds_test_state_response') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve({
            sse: !!window.__ds_sse_interceptor_ready,
            panel: !!document.getElementById('__ds-agent-panel'),
            pet: !!document.getElementById('__ds-pet-ball'),
            monitorState: e.data.state,
            pollCount: e.data.pollCount
          });
        }
      });
      window.postMessage({ type: '__ds_test_query_state' }, '*');
    });
  });

  console.log('扩展状态:', JSON.stringify(extState, null, 2));

  if (extState.sse && extState.panel) {
    console.log('✅ 扩展已重新加载成功');
  } else {
    console.log('❌ 扩展加载不完整，可能需要手动在 chrome://extensions 点击刷新');
  }

  await browser.close();
}

main().catch(function(e) { console.error(e); process.exit(1); });
