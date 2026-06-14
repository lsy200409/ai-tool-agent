# AI Tool Agent v0.1.1

> **Chrome Extension — 为 AI 网页版注入本地工具调用、记忆管理和 SSE 流拦截能力**
> 
> 点击 [github.com/lsy200409/deepseek-tool-agent](https://github.com/lsy200409/deepseek-tool-agent)

[![Version](https://img.shields.io/badge/version-0.1.1-blue)](manifest.json)
[![Tests](https://img.shields.io/badge/tests-48%20passed-green)](tests/full-suite.spec.js)
[![License](https://img.shields.io/badge/license-MIT-orange)](#-许可证)

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    DeepSeek Web Page                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ injected │  │  panel   │  │ monitor  │  │ executor │   │
│  │ SSE拦截  │  │ UI面板   │  │ 输入监控  │  │ 工具执行 │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       │              │              │              │        │
│       └──────────────┴──────────────┴──────────────┘        │
│                          │ chrome.runtime.sendMessage       │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│              Service Worker (background.js)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  消息路由 │ 服务器状态 │ Native Host │ HTTP Fallback  │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ Native Messaging / HTTP
┌──────────────────────────┼──────────────────────────────────┐
│               Local Tool Server (Node.js)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ read_file│  │write_file│  │exec_cmd  │  │ list_dir │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                    24 Tools · 5 Plugins                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🌟 核心功能

### v0.1.1 功能

| 功能 | 描述 |
|------|------|
| **SSE 流拦截** | `window.fetch` 劫持 + `ReadableStream.tee()` 实现实时 AI 流解析，无需轮询 |
| **Extension Context 守卫** | 自动检测 SW 上下文失效，3 秒恢复 + HTTP 直连回退 |
| **KeepAlive 长连接** | 20 秒心跳端口防止 Service Worker 闲置超时（Chrome 30 秒限制） |
| **CSS 模块化** | 508 行 Chromium Design Tokens 样式从面板分离至 `panel-css.js` |
| **底部栏快捷操作** | 🔧 工具提示词注入 · 🧠 记忆管理 · 🔄 工具重试提示 |
| **SSE 状态指示灯** | 面板头部蓝色脉冲徽章，流式输出时激活 |

### 基础功能

- **工具调用管道** — 自动检测 AI 回复中的 `<tool_call>` 标签，提取工具名和参数
- **本地工具执行** — 24 个工具（7 内置 + 5 插件），通过 SW 消息通道或 HTTP fallback
- **结果回填** — 工具执行结果自动写入输入框并发送，支持多轮连续执行
- **内存隔离** — AI 仅可读写 `workspace/` 目录，源代码完全隔离
- **DeepSeek++ 兼容** — 支持 `<tool_name>params</tool_name>` XML 格式解析
- **扩展上下文自动恢复** — 闲置后 SW 终止自动重建连接，无需手动刷新

---

## 📁 项目结构

```
deepseek-tool-agent/
├── src/                          # 扩展核心源码
│   ├── core/
│   │   ├── state.js              # 全局状态管理
│   │   ├── config.js             # 配置系统
│   │   ├── executor.js           # 工具执行 + Context Guard + HTTP 回退
│   │   ├── parser.js             # tool_call 标签解析
│   │   ├── tool-call-parser.js   # DeepSeek++ XML 格式兼容解析
│   │   └── backfill.js           # 结果回填构建
│   ├── dom/
│   │   ├── input.js              # 输入框读写、发送按钮操作
│   │   └── ai-message.js         # AI 消息检测与流式判断
│   ├── tools/
│   │   ├── registry.js           # 工具注册表 (__toolRegistry)
│   │   └── builtin.js            # 7 个内置工具
│   ├── monitor/
│   │   └── input-monitor.js      # 输入监控 + 状态机 + KeepAlive
│   ├── ui/
│   │   ├── panel.js              # 面板 UI 构建 (Chromium tokens)
│   │   ├── panel-css.js          # 分离的 CSS 模块 (508 行)
│   │   ├── actions.js            # 工具注入、记忆管理、工具重试
│   │   ├── connection.js         # 服务器连接、心跳、启动引导
│   │   └── file-browser.js       # 工作区文件浏览器
│   ├── router.js                 # 初始化路由 + 消息中心
│   ├── background.js             # Service Worker + 自动启动
│   └── injected.js               # 页面注入 (SSE fetch 劫持)
│
├── server/
│   ├── tool-server.js            # HTTP 工具服务器 (端口 3002)
│   ├── launcher.js               # 进程守护启动器 (端口 3003)
│   └── tool-registry.js          # 工具注册与加载
│
├── workspace/                    # AI 工作区 (隔离目录)
│   ├── config/                   # 插件配置、人格
│   ├── plugins/                  # 可扩展插件目录
│   └── skills/                   # 自定义技能
│
├── native-messaging/             # Native Host 自动启动
│   ├── native-host.js            # Node.js 宿主进程
│   ├── com.deepseek.tool_agent.json
│   └── register.bat              # Windows 注册脚本
│
├── tests/                        # Playwright 测试套件
│   ├── full-suite.spec.js        # 53 个测试用例
│   ├── helpers.js                # Mock 环境辅助
│   ├── mock-server.js            # 本地测试服务器
│   └── panel.spec.js             # 面板测试
│
├── scripts/                      # 辅助脚本
├── popup/                        # 扩展弹窗
├── manifest.json                 # Chrome MV3 配置
├── start-server.bat              # 一键启动脚本
└── package.json
```

---

## 🚀 快速开始

### 环境要求

- **浏览器**: Chrome 148+ / Edge
- **Node.js**: 18+
- **Windows** (Native Messaging 仅支持 Windows)

### 1. 克隆并安装

```bash
git clone https://github.com/lsy200409/deepseek-tool-agent.git
cd deepseek-tool-agent
npm install
```

### 2. 启动工具服务器

**方式 A — 双击启动（推荐）**
```
双击项目根目录的 start-server.bat
```

**方式 B — 命令行**
```bash
node server/launcher.js
```

服务器启动后监听：
- 工具 API: `http://localhost:3002`
- Launcher API: `http://localhost:3003/api/launcher/status`

### 3. 加载扩展

1. 打开 `chrome://extensions/`
2. 开启 **开发者模式**
3. 点击 **加载已解压的扩展**
4. 选择 `deepseek-tool-agent/` 目录

### 4. 开始使用

1. 访问 `https://chat.deepseek.com/`
2. 点击左下角圆形机器人图标打开工具面板
3. 查看状态行确认 "Connected"
4. 点击底部 **🔧 工具提示词** 注入工具列表
5. 点击 **🧠 记忆管理** 初始化 Agent 记忆
6. 开始对话 — AI 会自动调用工具执行任务

### 5. (可选) 安装 Native Host 自动启动

以管理员身份运行：
```
native-messaging\register.bat
```
之后启动 Chrome 时会自动拉起工具服务器，无需手动运行 `start-server.bat`。

---

## 🔧 可用工具

| 工具 | 参数 | 描述 |
|------|------|------|
| `read_file` | `path` | 读取文件内容（仅 workspaces 目录内） |
| `write_file` | `path`, `content` | 写入/创建文件 |
| `append_file` | `path`, `content` | 追加内容到文件 |
| `list_dir` | `path` | 列出目录内容 |
| `exec_command` | `command`, `cwd` | 执行系统命令 |
| `search_files` | `path`, `pattern` | 搜索文件（支持 glob） |
| `get_file_info` | `path` | 获取文件元信息 |
| + Plugin Tools | | 5 个插件提供的扩展工具 |

### 工具调用格式

AI 在回复中使用 XML 标签调用工具：

```xml
<read_file>
{"path": "workspace/projects/example.txt"}
</read_file>
```

工具执行结果会以结构化格式返回给 AI：

```
<tool_response status="success">
{
  "tool": "read_file",
  "content": "[文件内容...]"
}
</tool_response>

---
原始任务: [用户原始问题]
请根据以上工具调用结果和用户原始任务继续完成任务...
```

### 错误重试

当工具返回错误时，会包含详细分析和重试建议：

```
<tool_response status="error">
{
  "tool": "read_file",
  "error": "扩展上下文已失效",
  "code": "CONTEXT_INVALIDATED"
}
</tool_response>

---
原始任务: [用户原始问题]
⚠️ 检测到扩展上下文中断。系统将在3秒后自动恢复连接。
继续执行: 请根据以上工具调用结果和用户原始任务继续完成任务。
如果工具失败请尝试：
1. 使用备用命令（exec_command "type path\to\file" 代替 read_file）
2. 等待3秒后重试
3. 如果持续失败，告知用户可能的连接问题
```

---

## 🏗️ 技术架构

### SSE 流拦截

```
window.fetch → ReadableStream.tee() → 分流
  ├─ reader1 → 原始流 (不中断 AI 输出)
  └─ reader2 → parseSSEStream → window.postMessage
                                   ├─ __ds_stream_start
                                   ├─ __ds_stream_chunk
                                   └─ __ds_stream_end
```

### Extension Context 自愈

```
闲置 >30 秒 → SW 终止
     │
     ▼
下次 message → onSuspend 触发
     │
     ├─ KeepAlive 长连接尝试重连
     ├─ __executorContextInvalidSince 计时器
     ├─ 3 秒后自动 recoverContextIfPossible()
     └─ 失败 → HTTP 直连回退 (localhost:3002)
```

### 工具调用链路

```
AI 流式输出
  → SSE 文本积累
  → tool-call-parser 提取 <tool_call>
  → executor.js sendMessageWithRetry()
    ├─ SW 活跃 → chrome.runtime.sendMessage
    │   → background.js → native-host.js → tool-server.js
    └─ SW 失效 → HTTP fetch localhost:3002/exec
  → backfill.js 构建结果
  → input-monitor.js 注入回填
  → dom/input.js 写入输入框 + 自动发送
```

---

## 🧪 测试

```bash
# 全部测试 (53 用例)
npx playwright test tests/full-suite.spec.js

# 仅 UI 面板测试
npx playwright test tests/full-suite.spec.js --grep "Suite-01"

# 仅 Parser 测试
npx playwright test tests/full-suite.spec.js --grep "Suite-05"

# 仅 Context Guard 测试
npx playwright test tests/full-suite.spec.js --grep "Suite-08"
```

| 测试套件 | 用例数 | 状态 |
|----------|--------|------|
| Suite-01 Panel UI Core | 17 | ✅ |
| Suite-03 SSE Injection | 5 | ✅ |
| Suite-04 CSS Styles | 5 | ✅ |
| Suite-05 Tool Call Parser | 4 | ✅ |
| Suite-06 Monitor State Machine | 5 | ✅ |
| Suite-08 Context Guard | 2 | ✅ |
| Suite-09 Modal | 4 | ✅ |
| Suite-10 Stability | 3 | ✅ |
| Suite-02 Toggle Buttons | 8 | ⏭️ |
| Suite-07 Real Tool Exec | 5 | ⏭️ |

---

## 🔍 故障排查

### 服务器未运行

1. 检查 `http://localhost:3002/health` 是否可访问
2. 双击 `start-server.bat` 启动服务器
3. 检查 Node.js 是否已安装 (`node --version`)

### 扩展上下文已失效

1. 刷新 DeepSeek 页面 (F5)
2. 如果持续出现，重新加载扩展 (`chrome://extensions/` → 刷新)
3. 系统会在 3 秒后自动尝试恢复连接

### 工具调用无响应

1. 确认面板状态显示 "Connected" (绿色)
2. 检查浏览器控制台是否有错误
3. 尝试使用底部 **🔄 工具重试** 按钮

---

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)

---

## 🙏 致谢

- [DeepSeek++](https://github.com/zhu1090093659/deepseek-pp) — 架构参考
- Chrome Extensions MV3 — Service Worker 消息通道
- Playwright — E2E 测试框架

---

*Built for AI Web · v0.1.1 · Powered by Chrome Extension MV3*