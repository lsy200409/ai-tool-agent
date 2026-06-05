var { chromium } = require('playwright-core');

async function main() {
  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }

  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 查找所有 ds-button 类元素（DeepSeek 原生按钮）
  var result = await page.evaluate(function() {
    var info = [];

    // 查找所有 ds-button
    var btns = document.querySelectorAll('[class*="ds-button"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // 跳过隐藏元素

      info.push({
        tag: b.tagName.toLowerCase(),
        text: (b.innerText || '').trim().substring(0, 40),
        cls: (b.className || '').substring(0, 120),
        title: b.getAttribute('title') || '',
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
        innerHTML: (b.innerHTML || '').substring(0, 200)
      });
    }

    // 查找 ds-toggle-button
    var toggles = document.querySelectorAll('.ds-toggle-button');
    for (var j = 0; j < toggles.length; j++) {
      var t = toggles[j];
      var tRect = t.getBoundingClientRect();
      info.push({
        tag: 'toggle',
        text: (t.innerText || '').trim().substring(0, 40),
        cls: (t.className || '').substring(0, 120),
        rect: { top: Math.round(tRect.top), left: Math.round(tRect.left), w: Math.round(tRect.width), h: Math.round(tRect.height) }
      });
    }

    // 查找含"专家"/"快速"/"Expert"的元素
    var allEls = document.querySelectorAll('*');
    for (var k = 0; k < allEls.length; k++) {
      var el = allEls[k];
      var elText = (el.innerText || '').trim();
      if (el.children.length > 5) continue; // 跳过容器元素
      if (elText === '专家模式' || elText === '快速模式' || elText === 'Expert' || elText === '专家') {
        info.push({
          tag: 'keyword',
          elTag: el.tagName.toLowerCase(),
          text: elText.substring(0, 30),
          cls: (el.className || '').toString().substring(0, 80),
          rect: (function() { var r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; })()
        });
      }
    }

    return info;
  });

  console.log('═══ 可见的 ds-button 元素 ═══');
  result.filter(function(r) { return r.tag !== 'toggle' && r.tag !== 'keyword'; }).forEach(function(b) {
    console.log('  <' + b.tag + '> text="' + b.text + '" title="' + b.title + '"');
    console.log('    cls="' + b.cls + '"');
    console.log('    rect=' + JSON.stringify(b.rect));
    if (!b.text) console.log('    html="' + b.innerHTML.substring(0, 100) + '"');
  });

  console.log('\n═══ Toggle 按钮 ═══');
  result.filter(function(r) { return r.tag === 'toggle'; }).forEach(function(t) {
    console.log('  text="' + t.text + '" cls="' + t.cls + '" rect=' + JSON.stringify(t.rect));
  });

  console.log('\n═══ 专家/快速模式关键词 ═══');
  result.filter(function(r) { return r.tag === 'keyword'; }).forEach(function(k) {
    console.log('  <' + k.elTag + '> text="' + k.text + '" cls="' + k.cls + '" rect=' + JSON.stringify(k.rect));
  });

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
