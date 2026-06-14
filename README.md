# AI Tool Agent

**为 AI 网页版添加本地工具调用能力** — 安装扩展、启动服务器，让 DeepSeek / ChatGPT / Kimi / 通义千问 / 智谱清言 / 豆包 读写文件、执行命令、管理工作区。

[![Version](https://img.shields.io/badge/version-0.1.1-blue)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

简体中文 | [English](README.en.md)

---

## 目录

- [为什么选择 AI Tool Agent？](#为什么选择-ai-tool-agent)
- [支持平台](#支持平台)
- [工作原理](#工作原理)
- [快速开始](#快速开始)
- [使用方法](#使用方法)
- [可用工具](#可用工具)
- [插件系统](#插件系统)
- [配置说明](#配置说明)
- [故障排查](#故障排查)
- [项目结构](#项目结构)
- [安全说明](#安全说明)
- [贡献指南](#贡献指南)
- [许可证](#许可证)
- [免责声明](#免责声明)

---

## 为什么选择 AI Tool Agent？

| 没有 AI Tool Agent | 有 AI Tool Agent |
| --- | --- |
| AI 只能聊天 | AI 可以**读写文件** |
| AI 无法访问你的系统 | AI 可以**执行命令** |
| 手动复制粘贴结果 | 结果**自动回填**到对话 |
| 跨会话没有记忆 | **持久记忆**和人格设定 |
| 只能在单一平台使用 | 支持 **8 个平台** |

AI Tool Agent 是一款 Chrome/Edge 扩展，为 AI 网页版注入本地工具调用能力。它通过拦截 AI 的流式回复，检测工具调用标签，在本地执行工具，并将结果自动回填——全程无需手动操作。

---

## 支持平台

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| DeepSeek | ✅ 已测试 | 完整工具调用支持 |
| ChatGPT | ✅ 已测试 | GPT-4, GPT-4 Turbo |
| Kimi | ✅ 已测试 | Moonshot v1 8K/32K/128K |
| 通义千问 | ✅ 已测试 | 千问国内版 |
| Qwen International | ✅ 已测试 | chat.qwen.ai |
| 智谱清言 | ✅ 已测试 | glm-4-Plus |
| 智谱国际版 (z.ai) | ✅ 已测试 | GLM-4 Plus |
| 豆包 | ✅ 已测试 | doubao-seed-2.0 |

---

## 工作原理

### 架构总览

```text
┌──────────────────────────────────────────────────────────────────┐
│                        AI 网页 (如 DeepSeek)                     │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ SSE      │  │ 面板     │  │ 监控     │  │ 执行器   │       │
│  │ 拦截器   │  │ UI       │  │ 状态机   │  │ 工具调用 │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       └──────────────┴──────────────┴──────────────┘            │
│                          │ chrome.runtime.sendMessage           │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│              Service Worker (background.js)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  消息路由 │ 服务器状态 │ Native Host │ HTTP 回退           │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Native Messaging / HTTP
┌──────────────────────────┼──────────────────────────────────────┐
│               本地工具服务器 (Node.js, 端口 3002)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ read_file│  │write_file│  │exec_cmd  │  │ list_dir │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                    24 个工具 · 插件系统                            │
└─────────────────────────────────────────────────────────────────┘
```

### 工具调用流程

```text
1. 用户发送消息 → AI 开始流式回复
2. SSE 拦截器捕获流式数据块
3. 监控器在累积文本中检测 ◰ 工具调用标签
4. 执行器将工具请求发送到本地服务器
5. 服务器执行工具（读文件、运行命令等）
6. 结果回填到聊天输入框 → 自动发送
7. AI 收到工具结果 → 继续完成任务
```

---

## 快速开始

### 环境要求

- **浏览器**：Chrome 148+ 或 Edge
- **Node.js**：18+
- **操作系统**：Windows（Native Messaging）、macOS/Linux（HTTP 模式）

### 第 1 步：克隆并安装

```bash
git clone https://github.com/lsy200409/ai-tool-agent.git
cd ai-tool-agent
npm install
```

### 第 2 步：启动工具服务器

**方式 A — 双击启动（Windows，推荐）**

```
双击项目根目录的 start-server.bat
```

**方式 B — 命令行启动**

```bash
node server/launcher.js
```

服务器启动后监听：
- 工具 API：`http://localhost:3002`
- Launcher API：`http://localhost:3003`

### 第 3 步：加载扩展

1. 打开 `chrome://extensions/`（或 `edge://extensions/`）
2. 开启**开发者模式**
3. 点击**加载已解压的扩展**
4. 选择 `ai-tool-agent/` 目录

### 第 4 步：开始使用

1. 访问任意支持的 AI 平台（如 https://chat.deepseek.com/）
2. 点击左下角机器人图标打开工具面板
3. 确认状态显示"Connected"（绿色）
4. 按 **Ctrl+Shift+I**（或点击面板底部 🔧）注入工具提示词
5. 开始对话 — AI 会自动调用工具执行任务

### 第 5 步（可选）：Native Host 自动启动

以管理员身份运行：
```
native-messaging\register.bat
```

之后启动 Chrome 时会自动拉起工具服务器，无需手动运行 `start-server.bat`。

---

## 使用方法

### 注入工具提示词

AI 使用工具前，需要先注入工具定义到对话中，让 AI 学习如何调用工具。

**方式 1**：在支持的 AI 页面按 `Ctrl+Shift+I`

**方式 2**：点击面板底部的 🔧 按钮

注入成功后，日志会显示："工具提示词已注入 (33 个工具, 含插件)"

### 工具调用示例

当你让 AI 执行需要本地访问的任务时：

```
你：帮我看看当前目录下有什么文件

AI：<list_dir>
{"path": "."}
</list_dir>
```

扩展会自动：
1. 检测到 `<list_dir>` 标签
2. 在本地服务器执行 `list_dir`
3. 将结果回填给 AI
4. AI 根据目录内容继续回复

### 记忆管理

点击面板中的 🧠 按钮初始化 Agent 记忆，让 AI 在跨对话中保持上下文。

### 工具重试

工具调用失败时，点击面板中的 🔄 按钮重试上一次工具提示词。

### 文件浏览器

点击面板中的文件夹图标，直接浏览工作区文件。

---

## 可用工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `read_file` | `path` | 读取文件内容（仅工作区内） |
| `write_file` | `path`, `content` | 写入/创建文件 |
| `append_file` | `path`, `content` | 追加内容到文件 |
| `list_dir` | `path` | 列出目录内容 |
| `exec_command` | `command`, `cwd` | 执行系统命令 |
| `search_files` | `path`, `pattern` | 搜索文件（支持 glob） |
| `get_file_info` | `path` | 获取文件元信息 |
| + 插件工具 | — | 插件提供的扩展工具 |

### 工具调用格式

AI 使用 XML 标签调用工具：

```xml
<read_file>
{"path": "workspace/projects/example.txt"}
</read_file>
```

结果以结构化文本返回给 AI：

```xml
<tool_response status="success">
{
  "tool": "read_file",
  "content": "[文件内容...]"
}
</tool_response>
```

---

## 插件系统

AI Tool Agent 支持插件系统，可扩展工具能力。

### 插件结构

```text
workspace/plugins/
└── my-plugin/
    ├── SKILL.md          # 插件定义（必需）
    └── my-script.js      # 可选脚本
```

### SKILL.md 格式

```markdown
---
id: my-plugin
name: 我的自定义插件
version: 1.0.0
tools:
  - name: my_tool
    description: 执行自定义操作
    parameters:
      - name: input
        type: string
        required: true
---

# 我的插件

自定义工具实现细节...
```

### 内置插件

包含 5 个插件：
- **Web Search** — 通过浏览器搜索网页
- **Web Fetch** — 抓取并提取网页内容
- **Apply Patch** — 应用 unified diff 补丁到文件
- **Browser** — 浏览器自动化
- **Message** — 通过飞书/Lark 发送消息

---

## 配置说明

### 工作区配置

```text
workspace/
├── config/
│   ├── personality.json    # Agent 人格设定
│   └── tool-modes.json     # 工具权限模式
├── plugins/                # 插件目录
├── skills/                 # 自定义技能
├── memory/                 # 持久记忆
└── sessions/               # 会话历史
```

### 工具权限模式

每个工具可设置为以下三种模式之一：

| 模式 | 行为 |
| --- | --- |
| `auto` | 自动执行（无需确认） |
| `confirm` | 执行前询问用户 |
| `deny` | 完全禁止执行 |

默认：`exec_command` 设为 `confirm`，其余为 `auto`。

---

## 故障排查

### 服务器未运行

1. 检查 `http://localhost:3002/health` 是否可访问
2. 启动服务器：双击 `start-server.bat` 或 `node server/launcher.js`
3. 确认 Node.js 已安装：`node --version`

### 扩展上下文已失效

1. 刷新 AI 页面（F5）
2. 如果持续出现，在 `chrome://extensions/` 重新加载扩展
3. 系统会在 3 秒后自动尝试恢复连接

### 工具调用无响应

1. 确认面板状态显示"Connected"（绿色）
2. 确认已注入工具提示词（Ctrl+Shift+I）
3. 检查浏览器控制台是否有错误
4. 尝试点击 🔄 重试按钮

### 面板不显示

1. 点击页面左下角的机器人图标
2. 如果没有图标，刷新页面重试
3. 确认扩展已在 `chrome://extensions/` 中启用

---

## 项目结构

```text
ai-tool-agent/
├── src/                          # 扩展核心源码
│   ├── core/                     # 核心模块
│   │   ├── state.js              # 全局状态管理
│   │   ├── config.js             # 配置系统
│   │   ├── executor.js           # 工具执行 + 上下文守卫
│   │   ├── logger.js             # 日志系统
│   │   ├── tool-call-parser.js   # 工具调用标签解析器
│   │   └── backfill.js           # 结果回填构建器
│   ├── platforms/                # 平台适配器（8 个平台）
│   │   ├── platform-base.js      # 基础适配器（共享逻辑）
│   │   ├── platform-registry.js  # 适配器注册表
│   │   ├── deepseek.js           # DeepSeek 适配器
│   │   ├── chatgpt.js            # ChatGPT 适配器
│   │   ├── kimi.js               # Kimi 适配器
│   │   ├── qwen.js               # 通义千问适配器
│   │   └── ...                   # 更多适配器
│   ├── monitor/
│   │   └── input-monitor.js      # 状态机 + SSE 处理器
│   ├── ui/
│   │   ├── panel.js              # 面板 UI
│   │   ├── panel-css.js          # CSS 样式
│   │   ├── actions.js            # 工具注入、记忆、操作
│   │   ├── connection.js         # 服务器连接管理
│   │   └── file-browser.js       # 工作区文件浏览器
│   ├── background.js             # Service Worker
│   └── injected.js               # MAIN 世界 SSE 拦截器
│
├── server/                       # 本地工具服务器
│   ├── tool-server.js            # HTTP API（端口 3002）
│   ├── launcher.js               # 进程管理器（端口 3003）
│   ├── tool-registry.js          # 工具注册
│   └── plugin-loader.js          # 插件加载器
│
├── workspace/                    # AI 工作区（沙盒隔离）
├── native-messaging/             # Native Host 自动启动
├── popup/                        # 扩展弹窗
├── icons/                        # 扩展图标
├── scripts/                      # 构建和打包脚本
├── manifest.json                 # Chrome MV3 配置
└── package.json
```

---

## 安全说明

- **沙盒工作区**：AI 只能读写 `workspace/` 目录内的文件
- **确认对话框**：危险操作（如 `exec_command`）需用户确认
- **权限模式**：每个工具可设为 auto/confirm/deny
- **纯本地运行**：所有数据留在你的机器上，不上传云端，无遥测
- **无需 API Key**：使用你已有的浏览器登录即可

---

## 贡献指南

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -m "Add my feature"`
4. 推送到分支：`git push origin feature/my-feature`
5. 发起 Pull Request

### 添加新平台

要添加对新的 AI 平台的支持：

1. 创建 `src/platforms/your-platform.js`
2. 实现适配器接口（参考 `platform-base.js`）：
   - `dom` — 聊天元素的 CSS 选择器
   - `setInputValue(input, value)` — 设置输入框值
   - `sendMessage()` — 触发消息发送
   - `isUserMessage(el)` — 检测用户消息
3. 在 `platform-registry.js` 中注册
4. 在 `manifest.json` 的 content_scripts 中添加 URL 匹配

---

## 许可证

[MIT License](LICENSE)

---

## 免责声明

本扩展通过脚本注入与第三方 AI 平台交互，可能违反相关平台的服务条款。用户需自行评估并承担相关风险。详见 [DISCLAIMER.md](DISCLAIMER.md)。

---

*AI Tool Agent v0.1.1 · Chrome Extension MV3 · [GitHub](https://github.com/lsy200409/ai-tool-agent)*
