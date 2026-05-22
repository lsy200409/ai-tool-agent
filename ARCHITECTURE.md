# DeepSeek Tool Agent v2.4 — 项目架构文档

> **项目类型**：Chrome Extension (Manifest V3) + 本地 Node.js 工具服务器  
> **版本**：v2.4.0 | **最后更新**：2026-05-20  
> **总代码量**：~7,200 行（不含备份/测试/截图）

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Browser                           │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ popup    │  │ content      │  │ background (SW)     │   │
│  │ (管理弹窗) │  │ script      │  │ (Service Worker)    │   │
│  │          │  │              │  │                     │   │
│  │popup.html│  │ panel.js     │  │ background.js       │   │
│  │popup.js  │──│ injected.js  │◄─┤ actions.js           │   │
│  │(9页签)   │  │ router.js    │  │ state.js            │   │
│  └──────────┘  │ input-monitor│  │ connection.js        │   │
│                │ dom/*        │  │ bridge.js            │   │
│                └──────┬───────┘  └────────┬────────────┘   │
│                       │ chrome.runtime.sendMessage / storage │
└───────────────────────┼────────────────────────────────────┘
                        │ HTTP / WebSocket
                        ▼
┌─────────────────────────────────────────────────────────────┐
│               Local Tool Server (Node.js)                   │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐   │
│  │ tool-server   │  │ tool-registry│  │ plugin-loader     │   │
│  │ :3002         │  │             │  │                  │   │
│  │ HTTP API      │◄─│ 7 内置工具   │◄─│ openclaw 插件     │   │
│  │ WebSocket     │  │ + 插件工具   │  │ 技能加载          │   │
│  └──────────────┘  └────────────┘  └──────────────────┘   │
│  ┌──────────────┐  ┌────────────┐                          │
│  │ cross-platform│  │ launcher   │                          │
│  │ OS 适配层     │  │ 启动入口   │                          │
│  └──────────────┘  └────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户在 DeepSeek 聊天 → AI 输出 tool_call 语句
    ↓
input-monitor (DOM Observer) 检测到新消息
    ↓
parser 解析 tool_call → 提取 {tool_name, args}
    ↓
executor 通过 fetch(tool-server:3002) 发送执行请求
    ↓
tool-server 执行本地操作（文件读写/命令执行/API调用）
    ↓
结果返回 executor → backfill 将结果注入聊天输入框
    ↓
用户点击发送 → AI 基于工具结果继续对话
```

---

## 二、前端部分 (Frontend)

### 2.1 扩展清单 & 配置

| 文件 | 行数 | 功能说明 |
|------|------|----------|
| [manifest.json](../manifest.json) | 58 | MV3 扩展声明文件。定义名称、版本(v2.4.0)、权限(activeTab/storage/tabs/alarms/nativeMessaging)、content_scripts 注入规则、action.popup 指向、icons |
| [package.json](../package.json) | 17 | Node.js 项目配置。无运行时依赖（纯 vanilla JS），含 start/test 脚本 |

### 2.2 Popup 管理弹窗（插件设置界面）

基于 **chromium-ui-react** 设计 token 的 9 页签管理面板，通过 `chrome.storage.sync` 与悬浮面板桥接。

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [popup.html](../popup/popup.html) | 358 | 完整 HTML 结构：Header + 左侧导航栏(8页签) + 右侧内容区 + Modal overlay + Toast。CSS 内联，使用 Chromium 设计变量(`--cr-*`) |
| [popup.js](../popup/popup.js) | 844 | 全部交互逻辑：storage 读写(防抖300ms)、9 页签切换、CRUD 操作、Modal 系统、Toast、导出/导入配置 |

**Popup 页签功能矩阵：**

| # | 页签 | 控件数 | 核心功能 |
|---|------|--------|----------|
| 1 | Connection | 6 | 后端 URL / API Key(Show-Hide) / 超时 / WS URL / 连接状态指示(绿红点) / **[Test Connection]** 按钮(fetch health) |
| 2 | Tools | 3+ | 工具列表(名称/描述/Mode Badge) / **[+ Add]** 弹窗编辑器(名称/描述/模板/模式) / **[✎ Edit]** / **[✕ Delete]** + confirm |
| 3 | Skills | 3+ | 技能列表(名称/描述/ON-OFF) / **[+ Add]** 弹窗 / **[✕ Delete]** + confirm |
| 4 | Quick Actions | 5 | Label+Command 输入组(最多5个) / **[+ Add]** 自动聚焦 / **[Import Preset]** (5个内置) / **[✕ Remove]** |
| 5 | Logs | 7 | 级别 Tab(All/Info/Warn/Error) / Max entries / Notification Toggle / **[Export Now]** Blob下载 / **[Clear Logs]** sendMessage / 实时预览(最近20条) |
| 6 | Appearance | 5 | Theme(Light/Dark/System) / Panel Position(4角) / Draggable Toggle / Font Size Slider(12-18) / **实时 Preview 小窗** |
| 7 | Data | 4 | **[Export Config]** JSON下载 / **[Import Config]** FileReader合并 / **[Reset Defaults]** confirm / **[Clear All]** 输入DELETE确认 |
| 8 | About | 3 | 版本号展示 / **[Run Diagnostics]** 收集信息+clipboard / **[Open GitHub]** tabs.create |

**Popup 核心导出/机制：**

```javascript
// Storage 键名: ds_agent_config (单一对象)
// 防抖保存: 所有 input/change → 300ms debounce → chrome.storage.sync.set()
// 跨上下文同步: chrome.storage.onChanged.addListener → refreshCurrentPage()
// Modal 系统: showModal(title, bodyHTML, onSave) → 动态注入 overlay
// Toast: showToast(msg) → 底部居中, 2s 自动消失
```

### 2.3 Content Script — 注入层

注入到 `chat.deepseek.com` 页面的脚本集合，运行在 **Isolated World**。

#### 2.3.1 入口与路由

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [injected.js](../src/injected.js) | 562 | **Page Context 原语层**。暴露 `window.__findChatInput` / `__setInputValue` / `__clickSendButton` / `__detectStreaming` 等 DOM 操作函数供 content script 调用。纯 page-context DOM 查询，无业务逻辑 |
| [router.js](../src/router.js) | 72 | **路由分发器**。监听来自 background 的消息，根据 action 类型分发给对应处理模块。集成 `__ds_startMonitor()` 启动监控 |

**injected.js 导出的 Page Context 函数：**

| 函数签名 | 功能 |
|----------|------|
| `window.__findChatInput()` | 定位 DeepSeek 聊天输入框 textarea |
| `window.__setInputValue(el, value)` | 设置输入框值（React setter → native赋值 → execCommand 三层 fallback）|
| `window.__clickSendButton()` | 点击发送按钮（通过 SVG path `m8.3125` 匹配）|
| `window.__detectStreaming()` | 检测 AI 是否正在流式输出（SVG button 可见性）|
| `window.__getLastAIMessage()` | 获取 AI 最后一条回复的文本内容 |
| `window.__ds_startMonitor()` | 启动 input-monitor 监控循环 |

#### 2.3.2 UI 面板（悬浮双栏面板）

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [panel.js](../src/ui/panel.js) | 920 | **主面板 UI**。Chromium-native 双栏布局：左栏 Tools&Skills / 右栏 Live Logs / 底部快捷操作栏。包含完整的 CSS（设计 token）、HTML 构建、事件绑定、拖拽、QA 编辑器 |

**panel.js 架构分解：**

| 模块 | 行范围 | 功能 |
|------|--------|------|
| CSS Tokens (`injectPanelCSS`) | L1-L296 | Chromium 设计变量(`--cr-*`) + 全部组件样式（Header/Sidebar/Tool Cards/Toggle/Badge/Log/Pet Ball/Modal）|
| HTML 构建 (`buildPanelHTML`) | L337-L450 | 双栏结构：Header(标题+状态+最小化/关闭) + Body(左55% Tools&Skills / 右45% Live Logs) + Bottom Bar(快捷按钮+状态) + QA Modal |
| 事件绑定 (`bindPanelEvents`) | L462-L497 | Header拖拽 / Init / Search(防抖200ms) / Log Tabs / Export/Clear / AutoScroll / QA Edit / Add Skill |
| Pet Ball 拖拽 | L508-L545 | mousedown→mousemove→mouseup 三阶段，位移阈值 <5px 判定为 click 触发 togglePanel |
| Panel 拖拽 | L550-L581 | Header 区域拖拽移动整个面板位置 |
| Toggle 显示 | L600-L621 | `togglePanel(show)` 同时操作 classList + inline style.display（双重保障）|
| 工具卡片渲染 | L630-L685 | `renderToolsList(tools)` → 过滤搜索 → 卡片列表 → Mode 循环切换(AUTO⚡→MANUAL●→OFF○) |
| 技能渲染 | L693-L720 | `renderSkillsList(skills)` → Toggle 开关 pill（蓝=ON/灰=OFF）|
| 快捷操作 | L728-L755 | 底部 Pill 按钮 + 状态摘要 "Ready · N tools · M auto" |
| 日志系统 | L763-L825 | `renderLogs()` 级别过滤 / `exportLogs()` Blob下载 / `logPanel()` 追加+裁剪(上限500) |
| QA 编辑器 | L835-L901 | Modal 弹窗：Label+Prompt 输入组(2-5项) / Save/Cancel |
| Server 状态 | L833-L850 | 绿/红圆点 + Connected/Disconnected 文本 |
| Window 导出 | L920-L932 | 14 个 window.* 函数供外部(actions.js)调用 |
| 自执行初始化 | L938-L950 | IIFE: injectCSS → injectHTML → pet可见 → 1s后健康检查 |

**面板布局结构：**

```
┌──────────────────────────────────────────────────┐
│ [DS] Agent v2.4    ●Connected         −    ×   │ ← Header (可拖拽)
├─────────────────────────┬────────────────────────┤
│ Tools & Skills     🔍    │ Live Logs          ⋯  │ ← 列标题
├─────────────────────────┤ [All][Info][Warn][Err]│ ← 日志级别Tab
│ ⚡ ToolName    AUTO   + │ Export  Clear          │ ← 工具栏
│ ● MANUAL      OFF   -  │ ┌──────────────────┐   │
│ ○ ManTool     —     -  │ │ 14:32 info msg..  │   │ ← 日志区
│ ▪ QuickTransl  +      │ │ 14:33 warn msg..  │   │   (可滚动)
│ SkillName    [toggle] │ │ 14:34 error msg.. │   │
│ + Add Skill           │ └──────────────────┘   │
│                         │ ⏬ auto-scroll         │
├─────────────────────────┴────────────────────────┤
│ ⊙ Summarize  ☀ Retry 🔴New │ Ready · 7 · 3 auto ✎│ ← 底部操作栏
└──────────────────────────────────────────────────┘
```

#### 2.3.3 业务逻辑层

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [actions.js](../src/ui/actions.js) | 482 | **API 调用中枢**。封装所有与后端通信的函数：initAgent/loadTools/loadSkills/loadQuickActions/executeTool/getServerHealth 等。通过 `chrome.runtime.sendMessage` 或直接 `fetch` 与 server 通信 |
| [state.js](../src/core/state.js) | 119 | **全局状态管理**。维护 sessionInfo（会话ID/记忆/人格）、executionHistory（执行历史）、agentStatus。提供 getState/updateState/getSessionId 等访问接口 |
| [connection.js](../src/ui/connection.js) | 152 | **连接管理**。checkServerStatus() 健康检查、连接状态缓存、重连逻辑、WebSocket 管理（可选实时推送）|

**actions.js 核心函数表：**

| 函数 | 调用方式 | 功能 |
|------|----------|------|
| `initAgent()` | sendMessage(bg) | 初始化 Agent：发送人格/记忆/系统提示到 server |
| `loadTools()` | fetch(server) | 从 server 获取可用工具列表 → renderToolsList() |
| `loadSkills()` | fetch(server) | 从 server 获取技能列表 → renderSkillsList() |
| `loadQuickActions()` | storage.get | 读取快捷操作配置 → updateQuickActionButtons() |
| `executeTool(name, args)` | fetch(server:3002/exec) | 执行指定工具并返回结果 |
| `getServerHealth()` | fetch(server:3002/health) | 检查 server 是否在线 |
| `triggerQuickAction(idx)` | setInputValue+clickSend | 将快捷操作的 prompt 注入输入框并发送 |

#### 2.3.4 DOM 操作层

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [input.js](../src/dom/input.js) | 105 | **输入框操作**。`findChatInput()` 定位 DeepSeek 输入框、`setInputValue()` 三层 React 兼容赋值（descriptor setter → .value= → execCommand）、事件模拟 |
| [ai-message.js](../src/dom/ai-message.js) | 73 | **AI 消息解析**。`getLastAIMessageContent()` 获取最新回复、`isStreamingActive()` 检测流式输出状态、`findMessageContainer()` 定位消息容器 |

**setInputValue 三层 Fallback 详解：**

```javascript
function setInputValue(element, value) {
  element.focus();
  var setOk = false;
  // Layer 1: React descriptor setter (兼容旧版 React)
  try {
    var setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element) || HTMLTextAreaElement.prototype,
      'value'
    ).set;
    if (setter && typeof setter === 'function') {
      setter.call(element, value); setOk = true;
    }
  } catch(e) {}
  // Layer 2: Native assignment
  if (!setOk) { try { element.value = value; setOk = true; } catch(e) {} }
  // Layer 3: execCommand (最终兜底)
  if (!setOk) { try { document.execCommand('insertText', false, value); setOk = true; } catch(e) {} }
  // 统一触发事件
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new InputEvent('input', { data: value, inputType: 'insertText', bubbles: true }));
}
```

#### 2.3.5 核心处理流水线

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [parser.js](../src/core/parser.js) | 47 | **工具调用解析器**。从 AI 回复文本中提取 `tool_call` 格式语句，正则匹配 `{tool_name: "xxx", args: {...}}` 格式，返回结构化对象 |
| [executor.js](../src/core/executor.js) | 85 | **工具执行器**。接收 parsed result → 调用 actions.executeTool() → 处理结果 → 传递给 backfill。支持 AUTO/MANUAL/OFF 三种模式 |
| [backfill.js](../src/core/backfill.js) | 40 | **结果回填器**。将工具执行结果格式化为自然语言文本，通过 setInputValue 注入聊天输入框，等待用户确认发送给 AI |
| [logger.js](../src/core/logger.js) | 190 | **日志系统**。多级别(info/warn/error/success)日志记录，带时间戳，支持控制台输出和面板 logArea 同步显示 |

**核心流水线协作：**

```
AI 输出: "Let me search for that file..."
  + tool_call: {name: "file_search", args: {path: "./src", pattern: "*.js"}}
       │
       ▼
  parser.js → 解析出 {tool: "file_search", args: {path: "./src", pattern: "*.js"}}
       │
       ▼
  executor.js → 检查工具模式:
    AUTO: 直接执行 → fetch POST /exec → 等待结果
    MANUAL: 弹出确认面板 → 用户审批后执行
    OFF:   跳过，仅记录
       │
       ▼
  backfill.js → 结果格式化:
    "[DS-Result] file_search found 23 files matching *.js in ./src"
       │
       ▼
  input.js → setInputValue(textarea, result_text)
       │
       ▼
  用户看到输入框中有结果文本 → 点击发送 → AI 继续基于结果回答
```

#### 2.3.6 输入监控层

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [input-monitor.js](../src/monitor/input-monitor.js) | 455 | **5 层监控架构**。DOM Observer → Content Parser → Tool Coordinator → Result Injector → UI Bridge。监控聊天区域变化，自动检测 AI 的 tool_call 输出 |

**input-monitor.js 五层架构：**

| 层 | 名称 | 职责 |
|----|------|------|
| Layer 1 | Observer | MutationObserver 监听 chat 容器的 childList/characterData 变化 |
| Layer 2 | Parser | 变化发生时提取新消息内容，判断是否为 AI 回复 |
| Layer 3 | Coordinator | 检测到 tool_call 时触发 parser.parse() → executor.execute() |
| Layer 4 | Injector | 执行完成后调用 backfill.inject() → input.setValue() |
| Layer 5 | UI Bridge | 更新面板状态：日志追加、工具状态刷新、进度指示 |

#### 2.3.7 通信桥接

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [bridge.js](../src/gateway/bridge.js) | 18 | **消息桥接**。content script ↔ injected.js (page context) 的 postMessage 通信通道。解决 Isolated World 无法共享全局变量的问题 |

**通信模型：**

```
content script (isolated world)  ←──postMessage──→  page context (injected.js)
        │                                                      │
   window.postMessage({                                     window.addEventListener(
     type: '__ds_from_content',                                 'message', function(e) {
     payload: {...}                                              if (e.data?.type === '__ds_from_page') ...
   })                                                        })
```

#### 2.3.8 工具 & 插件注册

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [builtin.js](../src/tools/builtin.js) | 8 | **内置工具定义**。声明 7 个内置工具的元数据（file_search/file_read/write/web_search/web_fetch/shell_exec/code_analyze）|
| [registry.js](../src/tools/registry.js) | 40 | **工具注册表**。管理所有已注册工具的 Map，提供 register/get/list/findByMode 等查询接口 |
| [loader.js](../src/plugins/loader.js) | 17 | **插件加载器前端部分**。扫描 workspace/plugins 目录，读取 plugin.json，初始化插件实例 |

#### 2.3.9 辅助 UI

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [file-browser.js](../src/ui/file-browser.js) | 104 | **文件浏览器组件**。树形目录浏览、文件选择、路径拼接。用于需要用户选择文件的操作场景 |

---

## 三、后端部分 (Backend)

### 3.1 本地工具服务器

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [tool-server.js](../server/tool-server.js) | 644 | **HTTP 服务器主入口** (port 3002)。Express-style 路由：`GET /health`、`POST /exec`(工具执行)、`POST /init`(Agent 初始化)、`GET /tools`(工具列表)、`GET /skills`(技能列表)、WebSocket `/ws`(可选实时推送)。CORS 全开 |
| [launcher.js](../server/launcher.js) | 275 | **服务器启动器**。检查端口占用、自动寻找空闲端口、创建 workspace 目录结构、初始化配置文件、启动 HTTP 服务、输出启动信息 |

**tool-server.js API 端点：**

| Method | Path | 功能 | Request Body | Response |
|--------|------|------|-------------|----------|
| GET | `/health` | 健康检查 | — | `{healthy: true, uptime: ...}` |
| POST | `/exec` | 执行工具 | `{tool, args, mode}` | `{success, result, error}` |
| POST | `/init` | 初始化 Agent | `{personality, memory, prompt}` | `{sessionId, status}` |
| GET | `/tools` | 获取工具列表 | — | `[{name, description, mode}]` |
| GET | `/skills` | 获取技能列表 | — | `[{name, description, enabled}]` |
| WS | `/ws` | 实时推送（可选） | — | 双向 JSON 消息 |

### 3.2 工具注册与执行

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [tool-registry.js](../server/tool-registry.js) | 451 | **服务端工具注册表**。比前端 registry 更完整：注册 7 个内置工具的实现逻辑（每个工具含 execute(args) 函数）、参数校验、沙箱限制、超时控制、结果格式化 |

**内置工具实现详情：**

| 工具名 | 功能 | 参数 | 安全限制 |
|--------|------|------|----------|
| `file_search` | 递归搜索文件 | `path`, `pattern`, `max_depth` | 限 workspace 目录内 |
| `file_read` | 读取文件内容 | `path`, `encoding`, `max_size` | 限 64KB |
| `file_write` | 写入/创建文件 | `path`, `content`, `mode` | 限 workspace 目录内 |
| `web_search` | 网络搜索 | `query`, `engine` | 调用外部 API |
| `web_fetch` | 抓取网页内容 | `url`, `selector` | 限 HTTP/HTTPS |
| `shell_exec` | 执行 shell 命令 | `command`, `cwd`, `timeout` | 白名单命令 |
| `code_analyze` | 代码静态分析 | `path`, `language` | 只读分析 |

### 3.3 插件系统

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [plugin-loader.js](../server/plugin-loader.js) | 334 | **openclaw 兼容插件加载器**。扫描 `workspace/plugins/` 和 `server/builtin-skills/` 目录，解析 SKILL.md / plugin.json，动态 require() 加载插件代码，注册为可执行工具或技能。支持热加载 |

**插件/技能目录结构：**

```
workspace/
├── plugins/
│   └── example-plugin/
│       ├── plugin.json      # 插件元数据
│       └── index.js         # 插件实现
├── skills/
│   ├── code-review/
│   │   └── SKILL.md        # 技能说明文档
│   └── skill-creator/
│       └── SKILL.md
server/
└── builtin-skills/          # 内置技能
    └── code-review/
        └── SKILL.md
```

### 3.4 跨平台适配

| 文件 | 行数 | 核心功能 |
|------|------|----------|
| [cross-platform.js](../server/cross-platform.js) | 160 | **OS 适配层**。检测操作系统(windows/linux/darwin)，适配文件路径分隔符、shell 命令差异、临时目录位置、环境变量读取。统一 `execCommand()` 接口屏蔽平台差异 |

---

## 四、工作区与配置 (Workspace)

### 4.1 配置文件

| 文件 | 用途 |
|------|------|
| `workspace/config/tools_config.json` | 工具启用/禁用及默认模式配置 |
| `workspace/config/personality.json` | AI 人格设定（角色/风格/约束）|
| `workspace/config/settings.json` | 用户偏好设置（主题/字体/位置等）|
| `workspace/config/quick_actions.json` | 快捷操作预设（label + command 对）|
| `workspace/config/plugin_manifest.json` | 已安装插件清单 |
| `workspace/config/skills_manifest.json` | 已安装技能清单 |

### 4.2 数据存储

| 目录/文件 | 内容 |
|-----------|------|
| `workspace/sessions/*.json` | 会话历史记录（按时间戳命名）|
| `workspace/logs/` | 运行日志文件 |
| `workspace/plugins/*/` | 用户自定义插件 |
| `workspace/skills/*/` | 用户自定义技能 |

### 4.3 Chrome 存储

| 存储类型 | 键名 | 内容 |
|----------|------|------|
| `chrome.storage.sync` | `ds_agent_config` | Popup 管理面板的全部设置（API地址/工具列表/技能/快捷操作/外观等单一对象）|
| `chrome.storage.local` | 会话缓存 | 临时数据（可选）|

---

## 五、扩展权限与安全

### manifest.json 权限表

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前标签页 DOM（注入 content script）|
| `storage` | chrome.storage.sync/local 持久化配置 |
| `nativeMessaging` | 与本地 Node.js server 通信（备用方案）|
| `tabs` | 创建标签页（About 页打开 GitHub）|
| `alarms` | 定时任务（健康检查/心跳）|

### 安全措施

| 措施 | 实现 |
|------|------|
| 文件操作沙箱 | tool-executor 限制在 workspace 目录内 |
| 命令白名单 | shell_exec 仅允许预定义的安全命令 |
| 超时保护 | 所有工具执行默认 10s 超时可配 |
| Isolated World | content script 无法访问页面敏感变量 |
| CORS 限制 | server 仅接受 localhost 来源 |

---

## 六、技术栈总结

| 层 | 技术 | 说明 |
|----|------|------|
| **UI 渲染** | Vanilla JS + innerHTML | 无框架依赖，纯字符串拼接 + DOM API |
| **CSS 设计** | chromium-ui-react tokens | `--cr-*` 变量体系（Google 色/间距/圆角/阴影）|
| **状态管理** | chrome.storage.sync | 单一 config 对象 + onChanged 事件同步 |
| **通信** | chrome.runtime.sendMessage | content ↔ background ↔ popup 三端消息传递 |
| **DOM 桥接** | window.postMessage | 跨 Isolated World 通信 |
| **HTTP Server** | Node.js http 模块 | 轻量级，无 Express 依赖 |
| **工具执行** | child_process.spawn | 沙箱化的子进程执行 |
| **插件系统** | 动态 require() | openclaw 兼容格式 |
| **测试** | Node.js + CDP | 集成测试 + 远程浏览器自动化 |

---

## 七、文件依赖关系图

```
manifest.json
  ├── content_scripts:
  │   ├── src/injected.js ────── page context DOM 原语
  │   ├── src/router.js ──────── 消息路由分发
  │   ├── src/monitor/input-monitor.js ── 5层监控
  │   │   ├── src/core/parser.js ────── tool_call 解析
  │   │   ├── src/core/executor.js ───── 工具执行调度
  │   │   └── src/core/backfill.js ──── 结果回填
  │   ├── src/dom/input.js ────── 输入框操作
  │   ├── src/dom/ai-message.js ── AI消息检测
  │   └── src/ui/panel.js ─────── 主面板 UI (920行)
  │       ├── src/ui/actions.js ──── API 调用 (482行)
  │       ├── src/core/state.js ──── 全局状态
  │       ├── src/ui/connection.js ─ 连接管理
  │       └── src/core/logger.js ─── 日志系统
  │
  ├── background:
  │   └── src/background.js ───── Service Worker (420行)
  │
  └── action.popup:
      └── popup/
          ├── popup.html ────────── 9页签管理界面 (358行)
          └── popup.js ──────────── storage CRUD (844行)

server/ (独立 Node.js 进程)
  ├── server/tool-server.js ──── HTTP API (644行)
  ├── server/tool-registry.js ─── 工具实现 (451行)
  ├── server/plugin-loader.js ─── 插件加载 (334行)
  ├── server/cross-platform.js ─ OS适配 (160行)
  └── server/launcher.js ─────── 启动器 (275行)
```

---

*文档生成时间：2026-05-20 | 基于 v2.4.0 代码快照*
