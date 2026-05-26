const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const EXTENSION_PATH = path.resolve(__dirname, '..');
var USER_DATA_DIR = path.resolve(__dirname, '..', '.browser-data-' + Date.now());

function cleanSingleton(dir) {
  var files = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  var fs = require('fs');
  for (var i = 0; i < files.length; i++) {
    try { fs.unlinkSync(path.join(dir, files[i])); } catch(e) {}
  }
}

async function copyProfile() {
  var src = path.resolve(__dirname, '..', '.browser-data');
  var fs = require('fs');
  if (!fs.existsSync(src)) { fs.mkdirSync(USER_DATA_DIR, { recursive: true }); return; }
  await copyDir(src, USER_DATA_DIR);
}

function copyDir(src, dst) {
  var fs = require('fs');
  return new Promise(function(resolve, reject) {
    fs.cp(src, dst, { recursive: true, force: true }, function(err) {
      if (err && err.code !== 'EBUSY') { console.log('[copy] 部分文件跳过:', err.message); }
      resolve();
    });
  });
}

async function cleanupProfile() {
  try {
    var fs = require('fs');
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    console.log('[cleanup] 临时目录已清理');
  } catch(e) {}
}
const TOOL_SERVER_URL = 'http://localhost:3002';

async function checkToolServer() {
  return new Promise(function(resolve) {
    var req = http.get(TOOL_SERVER_URL + '/health', function(res) {
      var body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(3000, function() { req.destroy(); resolve(null); });
  });
}

async function run() {
  console.log('═══════════════════════════════════════════');
  console.log('  DS-Agent v2.5 — 真实 DeepSeek 页面测试');
  console.log('═══════════════════════════════════════════\n');

  var health = await checkToolServer();
  if (health) {
    console.log('[OK] Tool Server 运行中 — v' + health.version + ' — ' + health.tools_count + ' tools');
  } else {
    console.log('[WARN] Tool Server 未检测到 (http://localhost:3002)');
    console.log('      请先启动: node server/tool-server.js\n');
  }

  console.log('[INFO] 启动浏览器... (首次使用可能需要登录 DeepSeek)');
  console.log('[INFO] 浏览器数据目录: ' + USER_DATA_DIR + '\n');

  await copyProfile();
  cleanSingleton(USER_DATA_DIR);

  var context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      '--disable-extensions-except=' + EXTENSION_PATH,
      '--load-extension=' + EXTENSION_PATH,
      '--ignore-certificate-errors',
      '--disable-web-security',
    ],
    devtools: false,
  });

  context.on('page', function(page) {
    console.log('[Browser] 新页面:', page.url());
  });

  var page = await context.newPage();
  page.setDefaultTimeout(30000);

  console.log('[STEP 1] 导航到 https://chat.deepseek.com/ ...');
  try {
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    console.log('[WARN] 导航超时或被拦截:', e.message.substring(0, 100));
  }

  await page.waitForTimeout(3000);

  var url = page.url();
  console.log('[STEP 2] 当前页面 URL:', url);

  var isLoginPage = url.indexOf('login') >= 0 || url.indexOf('auth') >= 0;
  if (isLoginPage) {
    console.log('\n[INFO] ⚠ 检测到登录页面，需要先登录 DeepSeek');
    console.log('[INFO] 请在打开的浏览器窗口中完成登录，然后按 Enter 继续...\n');
    await page.waitForTimeout(500); // 让日志先输出

    await new Promise(function(resolve) {
      process.stdin.once('data', function() { resolve(); });
    });

    await page.waitForTimeout(2000);
    console.log('[STEP 2a] 登录后当前 URL:', page.url());
  }

  console.log('\n[STEP 3] 等待扩展内容脚本注入...');
  var panelFound = false;
  var petFound = false;
  var monitorFound = false;

  try {
    await page.waitForFunction(function() {
      return !!document.getElementById('__ds-agent-panel');
    }, {}, { timeout: 15000 });
    panelFound = true;
    console.log('  [OK] Panel (#__ds-agent-panel) 已注入');
  } catch (e) {
    console.log('  [FAIL] Panel 未注入 — 检查 content_scripts 是否匹配当前 URL');
  }

  try {
    await page.waitForFunction(function() {
      return !!document.getElementById('__ds-pet-ball');
    }, {}, { timeout: 5000 });
    petFound = true;
    console.log('  [OK] Pet Ball (#__ds-pet-ball) 已注入');
  } catch (e) {
    console.log('  [FAIL] Pet Ball 未注入');
  }

  try {
    await page.waitForFunction(function() {
      return !!document.getElementById('__ds-log-panel');
    }, {}, { timeout: 5000 });
    monitorFound = true;
    console.log('  [OK] 日志面板 (__ds-log-panel) 已注入 — MONITOR 可能已加载');
  } catch (e) {
    console.log('  [WARN] 日志面板未找到 — MONITOR 可能未加载');
  }

  console.log('\n[STEP 4] DOM 结构检查...');
  var domInfo = await page.evaluate(function() {
    var assistantMsgs = document.querySelectorAll('div.ds-assistant-message-main-content');
    var inputEls = document.querySelectorAll('textarea');
    var chatInputFound = false;
    for (var i = 0; i < inputEls.length; i++) {
      if (inputEls[i].clientHeight > 0 && inputEls[i].offsetParent !== null) {
        chatInputFound = true;
        break;
      }
    }
    var btnFound = false;
    var btns = document.querySelectorAll('[role="button"],button');
    for (var j = 0; j < btns.length; j++) {
      var html = (btns[j].innerHTML || '');
      if (html.indexOf('m8.3125') >= 0 || html.indexOf('M8.3125') >= 0 || html.indexOf('<rect') >= 0) {
        btnFound = true;
        break;
      }
    }
    if (!btnFound) {
      var inputEl = document.querySelector('textarea');
      if (inputEl) {
        var walk = inputEl;
        for (var k = 0; k < 5; k++) {
          walk = walk.parentElement;
          if (!walk) break;
          var nearBtns = walk.querySelectorAll('button, [role="button"]');
          for (var n = 0; n < nearBtns.length; n++) {
            if (nearBtns[n].clientHeight > 0 && nearBtns[n].offsetParent !== null) {
              btnFound = true;
              break;
            }
          }
          if (btnFound) break;
        }
      }
    }
    return {
      assistantMessages: assistantMsgs.length,
      chatInput: chatInputFound,
      sendButton: btnFound,
      thinkContent: document.querySelectorAll('.ds-think-content').length,
      totalDivs: document.querySelectorAll('div').length,
      panelInDOM: !!document.getElementById('__ds-agent-panel'),
      petBallInDOM: !!document.getElementById('__ds-pet-ball'),
      logPanelInDOM: !!document.getElementById('__ds-log-panel'),
      panelVisible: (function() {
        var p = document.getElementById('__ds-agent-panel');
        return p ? p.classList.contains('visible') : false;
      })()
    };
  });
  console.log('  DOM 信息:', JSON.stringify(domInfo, null, 2));

  if (panelFound && petFound) {
    console.log('\n[STEP 5] 面板交互测试...');
    console.log('  面板当前可见: ' + (domInfo.panelVisible ? '是' : '否'));

    if (!domInfo.panelVisible) {
      var petBall = await page.$('#__ds-pet-ball');
      if (petBall) {
        console.log('  点击 Pet Ball 打开面板...');
        try {
          await petBall.click({ force: true });
          await page.waitForFunction(function() {
            var p = document.getElementById('__ds-agent-panel');
            return p && p.classList.contains('visible');
          }, {}, { timeout: 5000 });
          console.log('  [OK] 面板已展开');
        } catch (e) {
          console.log('  [FAIL] 面板展开失败:', e.message.substring(0, 100));
        }
      }
    }

    var panelStatus = await page.evaluate(function() {
      var p = document.getElementById('__ds-agent-panel');
      return {
        visible: p ? p.classList.contains('visible') : false,
        display: p ? p.style.display : 'N/A',
        width: p ? p.offsetWidth : 0,
        height: p ? p.offsetHeight : 0
      };
    });
    console.log('  面板尺寸: ' + panelStatus.width + 'x' + panelStatus.height);

    var fileExplorer = await page.evaluate(function() {
      var fe = document.getElementById('__ds-file-explorer');
      return fe ? { exists: true, visible: fe.offsetHeight > 0 } : { exists: false };
    });
    console.log('  文件资源管理器: ' + (fileExplorer.exists ? '已注入' : '未找到'));

    var toggleBtns = await page.evaluate(function() {
      return {
        toolsBtn: !!document.getElementById('__ds-tbtn-tools'),
        skillsBtn: !!document.getElementById('__ds-tbtn-skills')
      };
    });
    console.log('  Tools 按钮: ' + (toggleBtns.toolsBtn ? '[OK]' : '[MISSING]'));
    console.log('  Skills 按钮: ' + (toggleBtns.skillsBtn ? '[OK]' : '[MISSING]'));
  }

  if (monitorFound) {
    console.log('\n[STEP 6] 监控状态检查...');
    var logPanel = await page.evaluate(function() {
      var lp = document.getElementById('__ds-log-panel');
      return lp ? {
        exists: true,
        contentLength: (lp.innerText || '').length,
        preview: (lp.innerText || '').substring(0, 150)
      } : { exists: false };
    });
    console.log('  日志面板内容: ' + logPanel.contentLength + ' 字');
    if (logPanel.preview) console.log('  日志预览: ' + logPanel.preview);

    var statusBar = await page.evaluate(function() {
      var sb = document.getElementById('__ds-status-text');
      return sb ? sb.innerText : 'N/A';
    });
    console.log('  状态栏: ' + statusBar);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  测试结果汇总');
  console.log('═══════════════════════════════════════════');
  console.log('  Tool Server:          ' + (health ? '[OK]' : '[MISSING]'));
  console.log('  Panel (#__ds-panel):  ' + (domInfo.panelInDOM ? '[OK]' : '[FAIL]'));
  console.log('  Pet Ball:             ' + (domInfo.petBallInDOM ? '[OK]' : '[FAIL]'));
  console.log('  日志面板:              ' + (domInfo.logPanelInDOM ? '[OK]' : '[FAIL]'));
  console.log('  聊天输入框:            ' + (domInfo.chatInput ? '[OK]' : '[FAIL]'));
  console.log('  发送按钮(箭头):        ' + (domInfo.sendButton ? '[OK]' : '[FAIL]'));
  console.log('  AI 消息元素:           ' + (domInfo.assistantMessages > 0 ? '[OK] ' + domInfo.assistantMessages + ' 条' : '[NONE]'));
  console.log('  思考块:                ' + domInfo.thinkContent + ' 个');
  console.log('  面板可见:              ' + (domInfo.panelVisible ? '是' : '否'));
  console.log('═══════════════════════════════════════════\n');

  console.log('[INFO] 浏览器保持打开，可以手动测试。');
  console.log('[INFO] 按 Ctrl+C 退出测试。\n');

  process.on('SIGINT', async function() {
    console.log('\n[INFO] 正在清理...');
    await context.close();
    await cleanupProfile();
    process.exit(0);
  });

  await new Promise(function() {});
}

run().catch(async function(err) {
  console.error('[FATAL]', err);
  await cleanupProfile();
  process.exit(1);
});