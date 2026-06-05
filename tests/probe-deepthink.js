var { chromium } = require('playwright-core');

var T0 = Date.now();
function ts() { return '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; }

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  探测 DeepSeek 深度思考按钮                           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  var browser = await chromium.connectOverCDP('http://localhost:9222');
  var ctx = browser.contexts()[0];
  var page = ctx.pages().find(function(pg) { return pg.url().indexOf('chat.deepseek.com') >= 0; });
  if (!page) { console.log('ERROR: 未找到 DeepSeek 页面!'); process.exit(1); }

  // 探测所有可交互元素
  var result = await page.evaluate(function() {
    var info = [];

    // 1. 所有 button 元素
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      info.push({
        tag: 'button',
        text: (b.innerText || '').trim().substring(0, 40),
        cls: (b.className || '').substring(0, 80),
        title: b.getAttribute('title') || '',
        ariaLabel: b.getAttribute('aria-label') || '',
        id: b.id || '',
        rect: (function() { var r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()
      });
    }

    // 2. 所有 role="button" 元素
    var roleBtns = document.querySelectorAll('[role="button"]');
    for (var j = 0; j < roleBtns.length; j++) {
      var rb = roleBtns[j];
      if (rb.tagName !== 'BUTTON') {
        info.push({
          tag: rb.tagName.toLowerCase(),
          text: (rb.innerText || '').trim().substring(0, 40),
          cls: (rb.className || '').substring(0, 80),
          title: rb.getAttribute('title') || '',
          ariaLabel: rb.getAttribute('aria-label') || '',
          id: rb.id || ''
        });
      }
    }

    // 3. 查找 textarea 周围的结构
    var ta = document.querySelector('textarea');
    if (ta) {
      var taRect = ta.getBoundingClientRect();
      info.push({ tag: 'textarea-location', rect: { top: Math.round(taRect.top), bottom: Math.round(taRect.bottom), left: Math.round(taRect.left) } });

      // 向上遍历5层父元素
      var parent = ta.parentElement;
      for (var k = 0; k < 6 && parent; k++) {
        var parentBtns = parent.querySelectorAll('button, [role="button"]');
        var parentBtnInfo = [];
        for (var l = 0; l < parentBtns.length; l++) {
          var pb = parentBtns[l];
          parentBtnInfo.push({
            text: (pb.innerText || '').trim().substring(0, 30),
            cls: (pb.className || '').substring(0, 60),
            title: pb.getAttribute('title') || ''
          });
        }
        info.push({
          tag: 'parent-L' + k,
          parentTag: parent.tagName.toLowerCase(),
          parentCls: (parent.className || '').substring(0, 60),
          buttonsInParent: parentBtnInfo
        });
        parent = parent.parentElement;
      }
    }

    // 4. 查找含 "deep" "think" "R1" 的所有元素
    var allElements = document.querySelectorAll('*');
    for (var m = 0; m < allElements.length; m++) {
      var el = allElements[m];
      var elText = (el.innerText || '').trim();
      var elCls = (el.className || '').toString().toLowerCase();
      if (elText.indexOf('深度思考') >= 0 || elText.indexOf('DeepThink') >= 0 ||
          elText.indexOf('R1') >= 0 || elCls.indexOf('deepthink') >= 0 ||
          elCls.indexOf('deep-think') >= 0 || elCls.indexOf('reasoning') >= 0) {
        info.push({
          tag: 'keyword-match',
          elTag: el.tagName.toLowerCase(),
          text: elText.substring(0, 50),
          cls: (el.className || '').toString().substring(0, 80),
          id: el.id || ''
        });
      }
    }

    return info;
  });

  console.log('\n═══ 所有按钮 ═══');
  result.filter(function(r) { return r.tag === 'button'; }).forEach(function(b) {
    console.log('  text="' + b.text + '" cls="' + b.cls + '" title="' + b.title + '" aria="' + b.ariaLabel + '" id="' + b.id + '" size=' + JSON.stringify(b.rect));
  });

  console.log('\n═══ role=button 元素 ═══');
  result.filter(function(r) { return r.tag !== 'button' && r.tag !== 'textarea-location' && r.tag.indexOf('parent') < 0 && r.tag !== 'keyword-match'; }).forEach(function(b) {
    console.log('  <' + b.tag + '> text="' + b.text + '" cls="' + b.cls + '" title="' + b.title + '"');
  });

  console.log('\n═══ Textarea 父级结构 ═══');
  result.filter(function(r) { return r.tag.indexOf('parent') >= 0; }).forEach(function(p) {
    console.log('  ' + p.tag + ': <' + p.parentTag + ' cls="' + p.parentCls + '">');
    if (p.buttonsInParent && p.buttonsInParent.length > 0) {
      p.buttonsInParent.forEach(function(b) {
        console.log('    btn: text="' + b.text + '" cls="' + b.cls + '" title="' + b.title + '"');
      });
    }
  });

  console.log('\n═══ 关键词匹配 ═══');
  result.filter(function(r) { return r.tag === 'keyword-match'; }).forEach(function(k) {
    console.log('  <' + k.elTag + '> text="' + k.text + '" cls="' + k.cls + '" id="' + k.id + '"');
  });

  process.exit(0);
}

main().catch(function(e) { console.error(e); process.exit(1); });
