const { test, expect } = require('@playwright/test');
const { startMockServer, stopMockServer, port: mockPort } = require('./mock-server');
const {
  startToolServer, stopToolServer, waitForToolServer,
  setupRealEnvPage, startMonitor, stopMonitor,
  simulateAIStreaming, waitForMonitorState, getMonitorState
} = require('./real-env-helpers');

test.describe('DS-Agent v2.5 真实环境集成测试', function() {
  test.beforeAll(async function() {
    var alive = await waitForToolServer(3000);
    if (alive) {
      console.log('[BeforeAll] Tool Server 已在运行，复用');
    } else {
      console.log('[BeforeAll] 启动 Tool Server...');
      try {
        await startToolServer();
        await waitForToolServer(10000);
      } catch (e) {
        console.log('[BeforeAll] Tool Server 启动失败:', e.message);
      }
    }

    console.log('[BeforeAll] 启动 Mock HTTP Server...');
    await startMockServer();
    console.log('[BeforeAll] Mock HTTP Server 就绪: http://localhost:' + mockPort);
  });

  test.afterAll(async function() {
    await stopMockServer();
    console.log('[AfterAll] Mock HTTP Server 已停止');
    await stopToolServer();
    console.log('[AfterAll] Tool Server 已停止');
  });

  test.beforeEach(async function({ page }) {
    await setupRealEnvPage(page);

    await page.evaluate(function() {
      window.__ds_toolResults = [];
      window.__ds_lastToolResult = undefined;

      var origFetch = window.fetch;
      window.fetch = function(url, options) {
        if (typeof url === 'string' && url.indexOf('/api/tool') >= 0) {
          return origFetch.apply(this, arguments).then(function(resp) {
            return resp.clone().json().then(function(data) {
              window.__ds_toolResults.push(data);
              window.__ds_lastToolResult = data;
              console.log('[Test:fetch] Tool result captured:', JSON.stringify(data).substring(0, 200));
              return resp;
            }).catch(function() {
              return resp;
            });
          });
        }
        return origFetch.apply(this, arguments);
      };
    });
  });

  test.afterEach(async function({ page }) {
    await stopMonitor(page);
  });

  test('TC-R1: exec_command 工具调用 — echo "hello integration test"', async function({ page }) {
    await page.evaluate(function() { window.__ds_setStreaming(true); });
    await page.evaluate(function() { window.__ds_addAssistantMessage(''); });

    var toolCallText = '我来帮你执行测试命令。\n\n<tool_call name="exec_command">\n{"command": "echo hello integration test"}\n</tool_call>\n\n命令已执行完成。';

    await page.evaluate(function(args) {
      var els = document.querySelectorAll('.ds-assistant-message-main-content');
      var last = els[els.length - 1];
      if (last) last.textContent = args[0];
    }, [toolCallText]);

    await page.waitForTimeout(500);
    await page.evaluate(function() { window.__ds_setStreaming(false); });

    await startMonitor(page);

    await page.waitForTimeout(3000);

    var toolResults = await page.evaluate(function() { return window.__ds_toolResults; });
    console.log('[TC-R1] Tool results:', JSON.stringify(toolResults));

    expect(toolResults.length).toBeGreaterThan(0);
    var result = toolResults[0];
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello integration test');
  });

  test('TC-R2: exec_command 畸形 JSON 修复 — 嵌套双引号未转义', async function({ page }) {
    await startMonitor(page);
    await page.evaluate(function() { window.__ds_setStreaming(true); });

    await page.evaluate(function() { window.__ds_addAssistantMessage(''); });

    var malformedJSON = '<tool_call name="exec_command">\n{"command": "echo "malformed json test""}\n</tool_call>';
    await page.evaluate(function(args) {
      var els = document.querySelectorAll('.ds-assistant-message-main-content');
      var last = els[els.length - 1];
      if (last) last.textContent = args[0];
    }, [malformedJSON]);

    await page.waitForTimeout(500);
    await page.evaluate(function() { window.__ds_setStreaming(false); });

    await page.waitForTimeout(3000);

    var toolResults = await page.evaluate(function() { return window.__ds_toolResults; });
    console.log('[TC-R2] Tool results:', JSON.stringify(toolResults).substring(0, 500));

    var execResults = [];
    for (var i = 0; i < toolResults.length; i++) {
      if (toolResults[i].success === true || toolResults[i].stdout) {
        execResults.push(toolResults[i]);
      }
    }

    expect(execResults.length).toBeGreaterThan(0);
    var result = execResults[0];
    expect(result.success !== false).toBe(true);
    console.log('[TC-R2] stdout:', result.stdout);
  });

  test('TC-R3: read_file 工具调用 — 读取 workspace 中的测试文件', async function({ page }) {
    var testFilePath = 'f:/桌面/web_free_agent/deepseek-tool-agent/workspace/README.md';

    await startMonitor(page);
    await page.evaluate(function() { window.__ds_setStreaming(true); });
    await page.evaluate(function() { window.__ds_addAssistantMessage(''); });

    var readFileText = '让我读取文件看看。\n\n<tool_call name="read_file">\n{"path": "' + testFilePath + '"}\n</tool_call>\n\n文件内容如上。';

    await page.evaluate(function(args) {
      var els = document.querySelectorAll('.ds-assistant-message-main-content');
      var last = els[els.length - 1];
      if (last) last.textContent = args[0];
    }, [readFileText]);

    await page.waitForTimeout(500);
    await page.evaluate(function() { window.__ds_setStreaming(false); });

    await page.waitForTimeout(3000);

    var toolResults = await page.evaluate(function() { return window.__ds_toolResults; });
    console.log('[TC-R3] Tool results count:', toolResults.length);

    var hasContent = false;
    for (var i = 0; i < toolResults.length; i++) {
      if (toolResults[i].content || toolResults[i].success !== false) {
        hasContent = true;
      }
    }
    expect(hasContent).toBe(true);
  });

  test('TC-R4: list_dir 工具调用 — 列出项目根目录', async function({ page }) {
    var testDirPath = 'f:/桌面/web_free_agent/deepseek-tool-agent/src';

    await startMonitor(page);
    await page.evaluate(function() { window.__ds_setStreaming(true); });
    await page.evaluate(function() { window.__ds_addAssistantMessage(''); });

    var listDirText = '让我看看有哪些文件。\n\n<tool_call name="list_dir">\n{"path": "' + testDirPath + '"}\n</tool_call>\n\n目录列表如上。';

    await page.evaluate(function(args) {
      var els = document.querySelectorAll('.ds-assistant-message-main-content');
      var last = els[els.length - 1];
      if (last) last.textContent = args[0];
    }, [listDirText]);

    await page.waitForTimeout(500);
    await page.evaluate(function() { window.__ds_setStreaming(false); });

    await page.waitForTimeout(3000);

    var toolResults = await page.evaluate(function() { return window.__ds_toolResults; });
    console.log('[TC-R4] Tool results:', JSON.stringify(toolResults).substring(0, 500));

    var dirResult = null;
    for (var i = 0; i < toolResults.length; i++) {
      if (toolResults[i].files || toolResults[i].entries) {
        dirResult = toolResults[i];
        break;
      }
      if (toolResults[i].success !== false && !toolResults[i].error) {
        dirResult = toolResults[i];
      }
    }

    expect(dirResult).not.toBeNull();
  });
});