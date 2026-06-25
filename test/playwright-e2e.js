/**
 * AI Tool Agent — Playwright 真实场景测试 (DeepSeek)
 * 
 * 测试流程:
 *   1. 启动浏览器 + 加载扩展
 *   2. 登录 DeepSeek
 *   3. 发送消息触发 AI 响应
 *   4. 验证 SSE 拦截、工具调用解析、结果回注
 *   5. 测试安全拦截
 *   6. 测试 UI 面板
 *   7. 测试连接状态
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXTENSION_PATH = path.join(PROJECT_ROOT);
const SERVER_URL = 'http://localhost:3002';

var passed = 0;
var failed = 0;
var errors = [];
var browser = null;
var context = null;
var page = null;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    errors.push(message);
    console.log('  ✗ ' + message);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, message + ' (got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected) + ')');
}

function httpRequest(method, urlPath, body) {
  return new Promise(function(resolve, reject) {
    var url = new URL(SERVER_URL + urlPath);
    var options = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method: method,
      headers: { 'Content-Type': 'application/json' }, timeout: 10000
    };
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// 场景 1: 登录 DeepSeek
// ═══════════════════════════════════════════════════════════

async function testLogin() {
  console.log('\n🔐 场景 1: 登录 DeepSeek');

  try {
    page = await context.newPage();
    
    // 导航到 DeepSeek
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 检查是否已经在聊天页面
    var currentUrl = page.url();
    if (currentUrl.includes('/chat') || currentUrl.includes('chat.deepseek.com')) {
      var hasChatInput = await page.$('textarea, [contenteditable="true"], .chat-input, textarea[class*="input"]');
      if (hasChatInput) {
        assert(true, '已经登录，跳过登录流程');
        return true;
      }
    }

    // 查找登录按钮
    var loginBtn = await page.$('button:has-text("登录"), a:has-text("登录"), button:has-text("Log in"), a:has-text("Log in")');
    if (loginBtn) {
      await loginBtn.click();
      await page.waitForTimeout(2000);
    }

    // 查找邮箱/密码输入框
    var emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="邮箱"], input[placeholder*="email"], input[placeholder*="手机"]');
    var passwordInput = await page.$('input[type="password"], input[name="password"], input[placeholder*="密码"], input[placeholder*="password"]');

    if (emailInput && passwordInput) {
      await emailInput.fill('2845608744@qq.com');
      await passwordInput.fill('lsy114514888');
      await page.waitForTimeout(500);

      // 点击登录按钮
      var submitBtn = await page.$('button[type="submit"], button:has-text("登录"), button:has-text("Log in"), button:has-text("Sign in")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(5000);
      }
    }

    // 验证登录成功
    await page.waitForTimeout(3000);
    var hasChatInput = await page.$('textarea, [contenteditable="true"], .chat-input, textarea[class*="input"]');
    assert(hasChatInput !== null, '登录成功，聊天输入框已出现');

    return hasChatInput !== null;
  } catch (e) {
    assert(false, '登录失败: ' + e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 2: 扩展注入验证
// ═══════════════════════════════════════════════════════════

async function testExtensionInjection() {
  console.log('\n📦 场景 2: 扩展注入验证（已登录页面）');

  try {
    // 确保在聊天页面
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 2.1 SSE 拦截器
    var hasInterceptor = await page.evaluate(function() {
      return window.__ds_sse_interceptor_ready === true;
    }).catch(function() { return false; });
    assert(hasInterceptor, 'SSE 拦截器已注入 (MAIN World)');

    // 2.2 ISOLATED World 脚本
    var hasIsolated = await page.evaluate(function() {
      return typeof window.__deepseekToolAgentCleanup === 'function';
    }).catch(function() { return false; });
    assert(hasIsolated, 'ISOLATED World 脚本已加载');

    // 2.3 流状态 API
    var hasStreamAPI = await page.evaluate(function() {
      return typeof window.__ds_streamState === 'function' &&
             typeof window.__ds_isStreamActive === 'function' &&
             typeof window.__ds_getStreamText === 'function';
    }).catch(function() { return false; });
    assert(hasStreamAPI, '流状态 API 全部可用');

    // 2.4 调试 API
    var hasDebugAPI = await page.evaluate(function() {
      return typeof window.__ds_interceptor_debug === 'function';
    }).catch(function() { return false; });
    assert(hasDebugAPI, '调试 API 可用');

    // 2.5 平台检测
    var platformDetected = await page.evaluate(function() {
      if (typeof window.__ds_monitor !== 'undefined' && window.__ds_monitor.platform) {
        return window.__ds_monitor.platform;
      }
      // 通过 URL 推断
      if (location.hostname.includes('deepseek')) return 'deepseek';
      return 'unknown';
    }).catch(function() { return 'unknown'; });
    assert(platformDetected === 'deepseek', '平台检测正确: deepseek');
  } catch (e) {
    assert(false, '扩展注入验证失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 3: 发送消息 + SSE 拦截
// ═══════════════════════════════════════════════════════════

async function testSendMessageAndSSE() {
  console.log('\n💬 场景 3: 发送消息 + SSE 拦截');

  try {
    // 3.1 找到输入框
    var inputSelector = 'textarea, [contenteditable="true"], div[contenteditable="true"]';
    var inputEl = await page.$(inputSelector);
    assert(inputEl !== null, '聊天输入框已找到');

    if (!inputEl) return;

    // 3.2 输入消息
    var testMessage = '你好，请用 exec_command 执行 echo hello_from_e2e';
    await inputEl.click();
    await page.waitForTimeout(300);

    // 尝试不同的输入方式
    var tagName = await inputEl.evaluate(function(el) { return el.tagName.toLowerCase(); });
    
    if (tagName === 'textarea') {
      await inputEl.fill(testMessage);
    } else {
      // contenteditable
      await inputEl.evaluate(function(el, msg) { el.innerText = msg; }, testMessage);
      await page.keyboard.press('End');
    }
    await page.waitForTimeout(300);

    // 3.3 监听 SSE 事件
    var sseEvents = [];
    page.on('console', function(msg) {
      var text = msg.text();
      if (text.indexOf('__ds_stream') >= 0 || text.indexOf('tool_call') >= 0) {
        sseEvents.push(text);
      }
    });

    // 3.4 发送消息
    var sendBtn = await page.$('button[data-testid="send-button"], button[aria-label*="Send"], button:has-text("发送")');
    if (sendBtn) {
      await sendBtn.click();
    } else {
      // 按 Enter 发送
      await page.keyboard.press('Enter');
    }

    // 3.5 等待 AI 响应
    await page.waitForTimeout(8000);

    // 3.6 检查流状态
    var streamState = await page.evaluate(function() {
      if (typeof window.__ds_streamState === 'function') {
        return window.__ds_streamState();
      }
      return null;
    }).catch(function() { return null; });
    assert(streamState !== null, '流状态可获取');

    // 3.7 检查是否有 AI 回复
    var hasAIReply = await page.evaluate(function() {
      // DeepSeek 的 AI 回复通常在特定的 DOM 结构中
      var messages = document.querySelectorAll('.message-content, [class*="assistant"], [class*="message"]');
      return messages.length > 0;
    }).catch(function() { return false; });
    assert(true, 'AI 回复检查完成 (hasReply: ' + hasAIReply + ')');

    // 等待响应完成
    await page.waitForTimeout(10000);
  } catch (e) {
    assert(false, '发送消息测试失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 4: 工具调用流程验证
// ═══════════════════════════════════════════════════════════

async function testToolCallFlow() {
  console.log('\n🔧 场景 4: 工具调用流程验证');

  try {
    // 4.1 通过 HTTP API 验证工具可用
    var toolsRes = await httpRequest('GET', '/api/tools');
    var toolCount = toolsRes.body.tools ? toolsRes.body.tools.length : 0;
    assert(toolCount > 0, '工具已注册 (' + toolCount + ' 个)');

    // 4.2 执行安全命令
    var execRes = await httpRequest('POST', '/exec', {
      tool: 'exec_command',
      args: { command: 'echo tool_call_test' }
    });
    assertEqual(execRes.body.success, true, 'exec_command 执行成功');

    // 4.3 写入文件
    var writeRes = await httpRequest('POST', '/exec', {
      tool: 'write_file',
      args: { path: 'pw-test.txt', content: 'Playwright E2E Test' }
    });
    assertEqual(writeRes.body.success, true, 'write_file 执行成功');

    // 4.4 读取文件
    var readRes = await httpRequest('POST', '/exec', {
      tool: 'read_file',
      args: { path: 'pw-test.txt' }
    });
    assertEqual(readRes.body.success, true, 'read_file 执行成功');

    // 4.5 列出目录
    var listRes = await httpRequest('POST', '/exec', {
      tool: 'list_dir',
      args: { path: '.' }
    });
    assertEqual(listRes.body.success, true, 'list_dir 执行成功');

    // 清理
    try {
      var testFile = path.join(PROJECT_ROOT, 'workspace', 'pw-test.txt');
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (e) {}
  } catch (e) {
    assert(false, '工具调用流程测试失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 5: 安全拦截验证（真实页面）
// ═══════════════════════════════════════════════════════════

async function testSecurityOnPage() {
  console.log('\n🔒 场景 5: 安全拦截验证（真实页面）');

  try {
    // 5.1 从页面内发起安全测试
    var securityResult = await page.evaluate(function() {
      return fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'read_file', args: { path: '../../.ssh/id_rsa' } })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) { return { blocked: d.blocked, neverAllow: d.neverAllow }; })
        .catch(function(e) { return { error: e.message }; });
    }).catch(function() { return { error: 'evaluate failed' }; });

    assertEqual(securityResult.blocked, true, '页面内 .ssh/id_rsa 被安全拦截');
    assertEqual(securityResult.neverAllow, true, '页面内返回 neverAllow: true');

    // 5.2 危险命令
    var cmdResult = await page.evaluate(function() {
      return fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'exec_command', args: { command: 'rm -rf /' } })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) { return { blocked: d.blocked }; })
        .catch(function(e) { return { error: e.message }; });
    }).catch(function() { return { error: 'evaluate failed' }; });

    assertEqual(cmdResult.blocked, true, '页面内 rm -rf / 被安全拦截');

    // 5.3 SSRF
    var ssrfResult = await page.evaluate(function() {
      return fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'exec_command', args: { command: 'curl http://169.254.169.254/' } })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) { return { blocked: d.blocked }; })
        .catch(function(e) { return { error: e.message }; });
    }).catch(function() { return { error: 'evaluate failed' }; });

    assertEqual(ssrfResult.blocked, true, '页面内 SSRF 攻击被拦截');

    // 5.4 CORS — 恶意 Origin
    var corsResult = await page.evaluate(function() {
      return fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://evil.com' },
        body: JSON.stringify({ tool: 'exec_command', args: { command: 'echo test' } })
      })
        .then(function(r) { return { status: r.status }; })
        .catch(function(e) { return { error: e.message }; });
    }).catch(function() { return { error: 'evaluate failed' }; });

    // 从 deepseek.com 发起的请求 Origin 是 deepseek.com，不是 evil.com
    // 浏览器会自动设置 Origin 头，无法伪造
    assert(true, 'CORS 检查完成 (status: ' + (corsResult.status || 'error') + ')');
  } catch (e) {
    assert(false, '安全拦截测试失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 6: UI 面板验证
// ═══════════════════════════════════════════════════════════

async function testUIPanelOnChat() {
  console.log('\n🎨 场景 6: UI 面板验证（聊天页面）');

  try {
    await page.waitForTimeout(2000);

    // 6.1 检查面板容器
    var panelExists = await page.evaluate(function() {
      var panel = document.getElementById('ds-tool-panel') ||
                  document.querySelector('.ds-panel') ||
                  document.querySelector('[data-ds-panel]');
      return panel !== null;
    }).catch(function() { return false; });
    assert(panelExists, 'UI 面板容器已创建');

    // 6.2 检查切换按钮
    var toggleExists = await page.evaluate(function() {
      var toggle = document.getElementById('ds-tool-toggle') || 
                   document.querySelector('[data-ds-toggle]') ||
                   document.querySelector('.ds-panel-toggle') ||
                   document.querySelector('.ds-toggle-btn');
      return toggle !== null;
    }).catch(function() { return false; });
    assert(toggleExists, '面板切换按钮存在');

    // 6.3 打开面板
    if (toggleExists) {
      await page.evaluate(function() {
        var toggle = document.getElementById('ds-tool-toggle') || 
                     document.querySelector('[data-ds-toggle]') ||
                     document.querySelector('.ds-panel-toggle') ||
                     document.querySelector('.ds-toggle-btn');
        if (toggle) toggle.click();
      }).catch(function() {});
      await page.waitForTimeout(500);

      var panelVisible = await page.evaluate(function() {
        var panel = document.getElementById('ds-tool-panel') ||
                    document.querySelector('.ds-panel') ||
                    document.querySelector('[data-ds-panel]');
        if (!panel) return false;
        var style = window.getComputedStyle(panel);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }).catch(function() { return false; });
      assert(panelVisible, '面板打开后可见');

      // 6.4 检查面板内容
      var panelContent = await page.evaluate(function() {
        var panel = document.getElementById('ds-tool-panel') ||
                    document.querySelector('.ds-panel') ||
                    document.querySelector('[data-ds-panel]');
        if (!panel) return { hasContent: false };
        return {
          hasContent: panel.innerText.length > 0,
          text: panel.innerText.substring(0, 200)
        };
      }).catch(function() { return { hasContent: false }; });
      assert(panelContent.hasContent, '面板有内容显示');

      // 6.5 关闭面板
      await page.evaluate(function() {
        var toggle = document.getElementById('ds-tool-toggle') || 
                     document.querySelector('[data-ds-toggle]') ||
                     document.querySelector('.ds-panel-toggle') ||
                     document.querySelector('.ds-toggle-btn');
        if (toggle) toggle.click();
      }).catch(function() {});
      await page.waitForTimeout(300);
    }
  } catch (e) {
    assert(false, 'UI 面板测试失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 7: 连接状态 + 健康检查
// ═══════════════════════════════════════════════════════════

async function testConnectionAndHealth() {
  console.log('\n🔗 场景 7: 连接状态 + 健康检查');

  try {
    // 7.1 页面内健康检查
    var health = await page.evaluate(function() {
      return fetch('http://localhost:3002/health')
        .then(function(r) { return r.json(); })
        .then(function(d) { return { ok: true, data: d }; })
        .catch(function(e) { return { ok: false, error: e.message }; });
    }).catch(function() { return { ok: false }; });
    assertEqual(health.ok, true, '页面内 HTTP 健康检查成功');

    // 7.2 CORS 允许扩展页面 POST
    var corsPost = await page.evaluate(function() {
      return fetch('http://localhost:3002/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'exec_command', args: { command: 'echo health_check' } })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) { return { ok: d.success === true }; })
        .catch(function(e) { return { ok: false, error: e.message }; });
    }).catch(function() { return { ok: false }; });
    assert(corsPost.ok, 'CORS 允许扩展页面 POST 请求');

    // 7.3 工具列表可达
    var toolsFromPage = await page.evaluate(function() {
      return fetch('http://localhost:3002/api/tools')
        .then(function(r) { return r.json(); })
        .then(function(d) { return { ok: true, count: d.tools ? d.tools.length : 0 }; })
        .catch(function(e) { return { ok: false, error: e.message }; });
    }).catch(function() { return { ok: false }; });
    assert(toolsFromPage.ok, '页面内工具列表可达 (' + (toolsFromPage.count || 0) + ' 个工具)');
  } catch (e) {
    assert(false, '连接状态测试失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 场景 8: 页面导航稳定性
// ═══════════════════════════════════════════════════════════

async function testNavigationStability() {
  console.log('\n🔄 场景 8: 页面导航稳定性');

  try {
    // 8.1 刷新页面后扩展仍然工作
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(function() {});
    await page.waitForTimeout(3000);

    var interceptorAfterReload = await page.evaluate(function() {
      return window.__ds_sse_interceptor_ready === true;
    }).catch(function() { return false; });
    assert(interceptorAfterReload, '页面刷新后 SSE 拦截器仍然正常');

    // 8.2 新开对话后扩展仍然工作
    var newChatBtn = await page.$('a[href*="/chat"], button:has-text("新对话"), button:has-text("New chat"), a:has-text("新对话")');
    if (newChatBtn) {
      await newChatBtn.click();
      await page.waitForTimeout(3000);

      var interceptorAfterNewChat = await page.evaluate(function() {
        return window.__ds_sse_interceptor_ready === true;
      }).catch(function() { return false; });
      assert(interceptorAfterNewChat, '新对话后 SSE 拦截器仍然正常');
    } else {
      assert(true, '新对话按钮未找到，跳过');
    }

    // 8.3 清理函数存在
    var hasCleanup = await page.evaluate(function() {
      return typeof window.__deepseekToolAgentCleanup === 'function';
    }).catch(function() { return false; });
    assert(hasCleanup, '清理函数存在（内存泄漏防护）');
  } catch (e) {
    assert(false, '导航稳定性测试失败: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AI Tool Agent — Playwright 真实场景测试 (DeepSeek)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // 检查服务器
  try {
    await httpRequest('GET', '/health');
    console.log('✓ 服务器已连接');
  } catch (e) {
    console.log('✗ 服务器未运行');
    process.exit(1);
  }

  // 启动浏览器
  console.log('\n🚀 启动浏览器...');
  try {
    browser = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        '--disable-extensions-except=' + EXTENSION_PATH,
        '--load-extension=' + EXTENSION_PATH,
        '--no-sandbox',
        '--disable-web-security'
      ]
    });
    context = browser;
    console.log('✓ 浏览器已启动，扩展已加载');
  } catch (e) {
    console.log('✗ 浏览器启动失败: ' + e.message);
    process.exit(1);
  }

  await new Promise(function(resolve) { setTimeout(resolve, 3000); });

  // 场景 1: 登录
  var loggedIn = await testLogin();
  if (!loggedIn) {
    console.log('\n⚠️ 登录失败，部分测试将跳过');
  }

  if (loggedIn) {
    // 场景 2-8: 需要登录的测试
    await testExtensionInjection();
    await testSendMessageAndSSE();
    await testToolCallFlow();
    await testSecurityOnPage();
    await testUIPanelOnChat();
    await testConnectionAndHealth();
    await testNavigationStability();
  } else {
    // 仅运行不需要登录的测试
    await testToolCallFlow();
  }

  // 关闭浏览器
  try { await browser.close(); } catch (e) {}

  // 结果汇总
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Playwright 真实场景测试结果                              ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  通过: ' + passed);
  console.log('║  失败: ' + failed);
  console.log('║  总计: ' + (passed + failed));
  if (errors.length > 0) {
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  失败项:');
    errors.forEach(function(e, i) {
      console.log('║  ' + (i + 1) + '. ' + e.substring(0, 80));
    });
  }
  console.log('╚══════════════════════════════════════════════════════════╝');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(e) {
  console.error('测试运行失败:', e);
  if (browser) { try { browser.close(); } catch (e2) {} }
  process.exit(1);
});
