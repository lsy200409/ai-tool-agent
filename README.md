# AI Tool Agent

**为 AI 网页版添加本地工具调用能力** — 安装扩展、启动服务器，让 DeepSeek 读写文件、执行命令、管理工作区。

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](manifest.json)
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
- [代理架构](#代理架构)
- [插件系统](#插件系统)
- [技能系统](#技能系统)
- [MCP 集成](#mcp-集成)
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
| 只能在单一平台使用 | 支持 **9 个平台**（DeepSeek 最佳） |
| 长任务容易丢失目标 | **任务规划** + 工具历史回溯 |
| 工具结果撑爆上下文 | **智能截断** + 可寻址历史 |

AI Tool Agent 是一款 Chrome/Edge 扩展，为 AI 网页版注入本地工具调用能力。它通过拦截 AI 的流式回复，检测工具调用标签，在本地执行工具，并将结果自动回填——全程无需手动操作。

---

## 支持平台

| 平台 | 工具调用 | 说明 |
| --- | --- | --- |
| DeepSeek | ✅ 完整支持 | 主要适配平台，工具调用稳定可靠 |
| ChatGPT | ✅ 支持 | GPT-4 / GPT-4 Turbo，长文本注入已修复 |
| Kimi | ✅ 支持 | Moonshot v1，二进制流解析已优化 |
| 通义千问 | ✅ 支持 | 千问国内版，contenteditable 输入兼容 |
| Qwen International | ✅ 支持 | chat.qwen.ai，长文本注入已修复 |
| 智谱清言 | ✅ 支持 | glm-4-Plus，长文本注入已修复 |
| 智谱国际版 (z.ai) | ✅ 支持 | GLM-4 Plus，Svelte 框架适配已完成 |
| 豆包 | ✅ 支持 | doubao-seed-2.0，SSE 累积内容模式已适配 |
| 自定义 | ⚠️ 可扩展 | 参照平台适配器接口自行添加 |

> **提示**：本项目以 DeepSeek 为主要开发和测试平台，其他平台的适配已基本完善。如果你主要使用 DeepSeek，可以获得最佳体验。

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
│  │ read_file│  │write_file│  │exec_cmd  │  │task_plan │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │list_dir  │  │search    │  │MCP 客户端 │  │插件沙箱  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│              48+ 个工具 · 插件系统 · MCP 协议 · 技能系统         │
└─────────────────────────────────────────────────────────────────┘
```

### 工具调用流程

```text
1. 用户发送消息 → AI 开始流式回复
2. SSE 拦截器捕获流式数据块
3. 监控器在累积文本中检测 <tool_call> 标签
4. 执行器将工具请求发送到本地服务器
5. 服务器执行工具（读文件、运行命令等）
6. 结果截断后回填到聊天输入框 → 自动发送
7. AI 收到工具结果 → 继续完成任务或输出 <task_complete> 结束
```

---

## 快速开始

### 环境要求

- **浏览器**：Chrome 148+ 或 Edge
- **Node.js**：18+
- **操作系统**：Windows（Native Messaging）、macOS/Linux（HTTP 模式）

### 第 1 步：下载并安装

从 [Releases](https://github.com/lsy2009/ai-tool-agent/releases) 下载最新版本，或克隆仓库：

```bash
git clone https://github.com/lsy2009/ai-tool-agent.git
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

注入成功后，日志会显示工具数量和分类信息。提示词包含：
- 环境说明（操作系统、命令执行方式）
- 工具使用决策树（何时用哪个工具）
- 常见错误用法（禁止模式）
- 思考节奏指导（调用前思考、结果验证）

### 工具调用示例

当你让 AI 执行需要本地访问的任务时：

```xml
你：帮我看看当前目录下有什么文件

AI：<tool_call name="list_dir">
{"path": "."}
</tool_call>

扩展自动执行 → 结果回填 → AI 继续回复
```

### 任务规划

对于复杂任务（3步以上），AI 会自动调用 `task_plan` 工具制定计划：

```xml
AI：<tool_call name="task_plan">
{"steps": [
  {"description": "读取配置文件", "status": "pending"},
  {"description": "解析配置项", "status": "pending"},
  {"description": "生成报告", "status": "pending"}
]}
</tool_call>
```

每完成一步，AI 更新计划状态，避免长任务丢失目标。

### 记忆管理

点击面板中的 🧠 按钮初始化 Agent 记忆，让 AI 在跨对话中保持上下文。记忆系统支持：
- **TF-IDF + 时间衰减** 混合搜索
- **RRF 融合排序**（关键词 + 近时间）
- 自动中文/英文分词

### 工具重试

工具调用失败时，点击面板中的 🔄 按钮重试上一次工具提示词。

### 文件浏览器

点击面板中的文件夹图标，直接浏览工作区文件。

---

## 可用工具

### 内置工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `read_file` | `path` | 读取文件内容 |
| `write_file` | `path`, `content` | 写入/创建文件 |
| `append_file` | `path`, `content` | 追加内容到文件 |
| `list_dir` | `path` | 列出目录内容 |
| `exec_command` | `command`, `cwd` | 执行系统命令（支持 WSL） |
| `search_files` | `path`, `pattern` | 搜索文件（支持 glob） |
| `get_file_info` | `path` | 获取文件元信息 |
| `task_plan` | `steps` | 创建/更新任务计划（外部化记忆） |
| `get_tool_history` | `iteration` | 查询工具调用历史（上下文截断时找回结果） |

### 管理工具

| 工具 | 说明 |
| --- | --- |
| `plugin_list` | 列出已安装插件 |
| `plugin_install` | 从代码创建插件 |
| `plugin_install_url` | 从 URL 下载安装插件 |
| `plugin_reload` | 热重载所有插件 |
| `plugin_uninstall` | 卸载插件 |
| `skill_list` | 列出可用技能 |
| `skill_create` | 创建自定义技能 |
| `skill_toggle` | 启用/禁用技能 |
| `memory_init` | 初始化记忆系统 |
| `memory_save` | 保存记忆条目 |
| `memory_load` | 加载所有记忆 |
| `memory_clear` | 清空记忆 |

### 工具调用格式

AI 使用 XML 标签调用工具：

```xml
<tool_call name="read_file">
{"path": "workspace/projects/example.txt"}
</tool_call>
```

结果以结构化文本返回给 AI（超长结果自动截断）：

```xml
<tool_response status="ok">
{"tool":"read_file","content":"[文件内容...]"}
</tool_response>
```

### 结果截断策略

为防止上下文爆炸，工具结果自动截断：

| 字段 | 最大长度 | 截断提示 |
| --- | --- | --- |
| `content` / `stdout` | 3,000 字符 | `... [截断，共X字符。如需完整内容请用 read_file 分段读取]` |
| `stderr` / `error` | 1,000 字符 | `... [截断]` |
| 总结果 | 8,000 字符 | 保留头尾，中间截断 |

被截断的结果可通过 `get_tool_history` 工具找回完整记录。

---

## 代理架构

AI Tool Agent 的代理循环参考了 Claude Code 和 Codex 的设计最佳实践：

### 状态机

```text
idle ──► listening ──► ai_streaming ──► ai_done ──► executing_tools
  ▲           │              │              │              │
  └───────────┴──────────────┴──────────────┴──────────────┘
                       (stop / 超时 / 熔断 / task_complete)
```

### 核心机制

| 机制 | 说明 |
| --- | --- |
| **显式完成标记** | AI 可输出 `<task_complete>` 主动声明任务完成，不再仅依赖 DOM 稳定性推断 |
| **工具结果截断** | 超长结果自动截断，防止上下文爆炸 |
| **任务规划** | `task_plan` 工具将计划外部化，避免长任务丢失目标 |
| **工具历史回溯** | `get_tool_history` 在上下文截断后找回之前的结果 |
| **可行动化错误** | 错误信息附带修复建议（ENOENT→检查路径、EPERM→权限、timeout→简化命令） |
| **去重检查** | 相同 name+arguments 不重复执行 |
| **熔断器** | 连续失败 5 次触发熔断，防止无限循环 |
| **超时保护** | 状态卡 180 秒强制恢复，5 分钟卡死强制重置 |

### Steering Engineering

系统采用多层级的驾驭工程（Steering Engineering）设计：

| 层级 | 手段 | 示例 |
| --- | --- | --- |
| L0 | Prompt 指令 | 工具使用决策树、负面示例、思考节奏 |
| L1 | 工具描述约束 | "何时使用/何时不使用"对比声明 |
| L2 | 工具实现校验 | 结果截断、路径安全检查、命令分级 |
| L3 | 工具集裁剪 | 不暴露 delete_file 等高危工具 |
| L4 | 审批门控 | 敏感操作弹窗确认 |

---

## 插件系统

AI Tool Agent 支持插件系统，可扩展工具能力。

### 插件结构

```text
workspace/plugins/
└── my-plugin/
    ├── plugin.json        # 插件定义（必需）
    └── index.js           # 插件入口
```

### plugin.json 格式

```json
{
  "id": "my-plugin",
  "name": "我的自定义插件",
  "version": "1.0.0",
  "description": "插件描述",
  "entry": "index.js",
  "requiredEngineVersion": "^0.2.0"
}
```

### 插件沙箱

插件运行在受限沙箱中：

| 模块类别 | 模块 | 策略 |
| --- | --- | --- |
| 白名单 | path, url, crypto, events, stream, buffer... | 直接放行 |
| 代理 | fs, http, https, child_process | 返回受限代理（路径限制/SSRF 防护/命令分级） |
| 黑名单 | cluster, dns, net, os, vm, worker_threads... | 抛错拒绝 |

### 内置插件

- **Web Search** — 通过浏览器搜索网页
- **Web Fetch** — 抓取并提取网页内容
- **Apply Patch** — 应用 unified diff 补丁到文件
- **Browser** — 浏览器自动化
- **Message** — 通过飞书/Lark 发送消息
- **Memory** — TF-IDF + 时间衰减的智能记忆搜索
- **CLI-Anything** — 为任意软件生成 CLI 接口（133+ 可用 CLI）

---

## 技能系统

技能（Skill）是轻量级的知识注入，通过 Markdown 文件定义：

```text
workspace/skills/
├── code-review/SKILL.md       # 代码审查技能
├── api-design/SKILL.md        # API 设计技能
└── lark/
    ├── lark-doc/SKILL.md      # 飞书文档技能
    └── lark-sheets/SKILL.md   # 飞书表格技能
```

技能使用 YAML Frontmatter + Markdown 格式，支持二级目录嵌套和热加载。

---

## MCP 集成

支持 Model Context Protocol (MCP) 服务器，通过 stdio 或 SSE 连接外部工具：

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "transport": "stdio"
    }
  }
}
```

MCP 工具自动注册到工具列表，与内置工具统一调用。

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
└── sessions/               # 会话历史 + 任务计划 + 工具历史
```

### 工具权限模式

每个工具可设置为以下三种模式之一：

| 模式 | 行为 |
| --- | --- |
| `auto` | 自动执行（无需确认） |
| `confirm` | 执行前询问用户 |
| `deny` | 完全禁止执行 |

默认：`exec_command` 设为 `confirm`，其余为 `auto`。

### 命令安全分级

`exec_command` 内置 4 级安全分类：

| 级别 | 行为 | 示例 |
| --- | --- | --- |
| `safe` | 直接执行 | ls, cat, git status, Get-ChildItem |
| `auto_approve` | 执行 + 日志 | git, npm, node, powershell, curl |
| `sensitive` | 需用户确认 | rm, docker, apt, npm install |
| `dangerous` | 永远拒绝 | rm -rf /, curl \| sh, fork bomb |

链式命令（`&&`/`||`/`;`/`|`）取最高风险级别。WSL/bash/sh 前缀命令递归检查子命令。

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

### 非 DeepSeek 平台工具面板空白

1. 确认服务器已启动且面板显示"Connected"
2. 面板会在首次加载失败后 3 秒自动重试
3. 检查 CORS 白名单是否包含当前平台域名

### WSL 命令输出乱码

系统已内置 `sanitizeCommandOutput` 自动清洗 UTF-16 LE 和 GBK 编码残留。如仍有乱码，请确认服务器已重启。

---

## 项目结构

```text
ai-tool-agent/
├── src/                          # 扩展核心源码
│   ├── core/                     # 核心模块
│   │   ├── state.js              # 全局状态管理
│   │   ├── store.js              # 不可变 Store（参考 Claude Code）
│   │   ├── config.js             # 配置系统 + 端点定义
│   │   ├── executor.js           # 工具执行 + 可行动化错误处理
│   │   ├── logger.js             # 日志系统
│   │   ├── tool-call-parser.js   # 工具调用标签解析器 + task_complete 检测
│   │   └── backfill.js           # 结果回填构建器 + 截断
│   ├── platforms/                # 平台适配器（9 个平台）
│   │   ├── platform-base.js      # 基础适配器（共享逻辑）
│   │   ├── platform-registry.js  # 适配器注册表 + 自动检测
│   │   ├── deepseek.js           # DeepSeek 适配器
│   │   ├── chatgpt.js            # ChatGPT 适配器
│   │   ├── kimi.js               # Kimi 适配器（二进制流）
│   │   ├── qwen.js               # 通义千问适配器
│   │   ├── qwen-intl.js          # 千问国际版适配器
│   │   ├── chatglm.js            # 智谱清言适配器
│   │   ├── zai.js                # 智谱国际版适配器（Svelte）
│   │   └── doubao.js             # 豆包适配器
│   ├── monitor/
│   │   └── input-monitor.js      # 5 状态状态机 + 熔断器 + 工具链迭代
│   ├── ui/
│   │   ├── panel.js              # 面板 UI + 审批弹窗
│   │   ├── panel-css.js          # CSS 样式
│   │   ├── actions.js            # 工具注入 + 增强提示词
│   │   ├── connection.js         # 服务器连接管理
│   │   └── file-browser.js       # 工作区文件浏览器
│   ├── gateway/
│   │   └── bridge.js             # content ↔ injected postMessage 桥接
│   ├── dom/
│   │   ├── input.js              # 输入框操作（原生 setter + React 兼容）
│   │   └── ai-message.js         # AI 消息解析
│   ├── background.js             # Service Worker
│   ├── sse-interceptor.js        # MAIN 世界 SSE 流拦截器
│   ├── injected.js               # MAIN 世界 DOM 原语层
│   └── router.js                 # 消息路由分发
│
├── server/                       # 本地工具服务器
│   ├── tool-server.js            # HTTP API（端口 3002）+ Agent API
│   ├── launcher.js               # 进程管理器（端口 3003）
│   ├── tool-registry.js          # 工具注册 + 安全约束 + 命令分级
│   ├── tool-factory.js           # 工具工厂（两阶段验证，Fail-closed）
│   ├── plugin-loader.js          # 插件加载器（vm 沙箱）
│   ├── sandbox-proxies.js        # 沙箱代理（fs/http/child_process）
│   ├── mcp-client.js             # MCP 协议客户端（stdio/SSE）
│   ├── cross-platform.js         # OS 适配层（Windows/Linux/Mac/WSL2）
│   ├── ssrf-guard.js             # SSRF 防护（IP 范围阻断）
│   ├── sanitization.js           # 参数净化（ASCII Smuggling 防御）
│   ├── errors.js                 # 错误分层体系
│   └── builtin-skills/           # 内置技能
│
├── workspace/                    # AI 工作区
│   ├── config/                   # 配置文件
│   ├── plugins/                  # 插件目录
│   ├── skills/                   # 技能目录
│   ├── memory/                   # 持久记忆
│   └── sessions/                 # 会话 + 计划 + 历史
│
├── native-messaging/             # Native Host 自动启动
├── popup/                        # 扩展弹窗（9 页签设置界面）
├── icons/                        # 扩展图标
├── scripts/                      # 构建和打包脚本
├── manifest.json                 # Chrome MV3 配置
└── package.json
```

---

## 安全说明

### 沙盒工作区

- AI 默认可读写 `workspace/` 目录内的文件
- 工作区外写入操作允许但受敏感路径检查
- 核心系统目录（`C:\Windows`、`/etc`、`/usr`）永远禁止访问

### 路径安全

| 路径类别 | 行为 | 示例 |
| --- | --- | --- |
| NEVER_ALLOW | 永远拒绝，不可确认 | `.ssh`, `.env`, `.gitconfig`, `.bashrc` |
| FORBIDDEN | 永远拒绝 | `C:\Windows`, `/etc`, `/usr` |
| SENSITIVE | 需用户确认 | 用户目录、APPDATA |
| UNC 路径 | 永远拒绝 | `\\server\share`（防 NTLM 泄露） |

### 命令安全

- 4 级分类：safe → auto_approve → sensitive → dangerous
- PowerShell/cmd/pwsh 子命令递归检查
- 链式命令取最高风险级别
- Null 字节注入检测

### 其他安全措施

- **确认对话框**：敏感操作需用户确认（弹窗不会意外消失）
- **权限模式**：每个工具可设为 auto/confirm/deny
- **SSRF 防护**：私有 IP 和云元数据地址阻断
- **ASCII Smuggling**：参数净化防御
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
   - `sse` — SSE 流解析配置（apiPattern、extractContent、detectStreamEnd）
   - `setInputValue(input, value)` — 设置输入框值（优先使用原生 setter）
   - `sendMessage()` — 触发消息发送
   - `isUserMessage(el)` — 检测用户消息
3. 在 `platform-registry.js` 中注册
4. 在 `manifest.json` 的 content_scripts 中添加 URL 匹配
5. 在 `server/tool-server.js` 的 CORS 白名单中添加平台域名

---

## 致谢

本项目的设计思路和工具调用方案受到以下项目的启发：

- [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) — 工具调用提示词注入、SSE 流式解析、多平台适配器架构的核心思路来源
- [DeepSeek++](https://github.com/zhu1090093659/deepseek-pp) — XML 格式工具调用解析参考
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — 代理循环设计、工具结果截断、任务规划工具的参考
- [CLI-Anything](https://github.com/HKUDS/CLI-Anything) — CLI 集成方案

## 许可证

[MIT License](LICENSE)

---

## 免责声明

本扩展通过脚本注入与第三方 AI 平台交互，可能违反相关平台的服务条款。用户需自行评估并承担相关风险。详见 [DISCLAIMER.md](DISCLAIMER.md)。

---

*AI Tool Agent v0.2.0 · Chrome Extension MV3 · [GitHub](https://github.com/lsy2009/ai-tool-agent)*
