const { test, expect } = require('@playwright/test');

test('DIAG - Extension 加载检查', async function({ browser }) {
  var context = browser.contexts()[0];

  var pages = context.pages();
  console.log('Pages count:', pages.length);
  for (var i = 0; i < pages.length; i++) {
    console.log('Page', i, 'URL:', pages[i].url());
  }

  var bgPages = context.backgroundPages();
  console.log('Background pages count:', bgPages.length);

  var workers = context.serviceWorkers();
  console.log('Service workers count:', workers.length);
  for (var j = 0; j < workers.length; j++) {
    console.log('SW', j, 'URL:', workers[j].url());
  }

  expect(pages.length).toBeGreaterThan(0);
});