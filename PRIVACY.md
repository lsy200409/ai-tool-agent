# 隐私政策 / Privacy Policy

**最后更新 / Last Updated：2025年6月**

---

## 中文版

### 概述

AI Tool Agent 是一款浏览器扩展，为 AI 网页版添加本地工具调用能力。我们重视您的隐私，本政策说明我们如何处理您的数据。

### 数据收集

**我们不收集任何用户数据。**

具体而言：
- 不收集个人信息（姓名、邮箱、IP 地址等）
- 不收集浏览历史
- 不收集 AI 对话内容
- 不使用 Cookie 或任何追踪技术
- 不与任何第三方共享数据

### 数据处理

所有数据处理均在您的本地计算机上完成：

| 组件 | 运行位置 | 说明 |
|------|---------|------|
| 浏览器扩展 | 本地浏览器 | 注入工具提示词、拦截 SSE 流、显示工具面板 |
| 工具服务器 | 本地计算机 | 执行文件读写、命令等工具操作 |
| 工具执行结果 | 本地浏览器 | 回填到 AI 对话中 |

### 本地存储

扩展使用 `chrome.storage.local` 保存以下设置信息：
- 工具服务器连接状态
- 用户偏好设置

这些数据仅存储在您的浏览器中，不会上传到任何服务器。

### 工具执行

本扩展允许 AI 调用本地工具（文件读写、命令执行等）。所有工具执行：
- 需要用户在弹窗中明确确认后才执行
- 仅在本地计算机上运行
- 执行结果仅在本地 AI 对话中显示

### 第三方服务

本扩展与以下第三方网页交互：
- DeepSeek (chat.deepseek.com)
- ChatGPT (chatgpt.com)
- Kimi (kimi.moonshot.cn)
- 通义千问 (tongyi.aliyun.com)
- 智谱清言 (chatglm.cn)
- 豆包 (doubao.com)

这些平台各自有其隐私政策，本扩展不控制也不负责这些平台的数据处理方式。

### 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 与当前标签页内容交互，注入工具面板 |
| `storage` | 保存用户设置和连接状态 |
| `tabs` | 管理标签页切换事件 |
| `nativeMessaging` | 与本地工具服务器通信 |
| `alarms` | 定时检查服务器连接状态 |

### 变更通知

如果我们更新本隐私政策，会在 GitHub 仓库中发布新版本，并更新"最后更新"日期。

### 联系我们

如有隐私相关问题，请通过以下方式联系：
- GitHub Issues：https://github.com/lsy200409/ai-tool-agent/issues

---

## English Version

### Overview

AI Tool Agent is a browser extension that adds local tool-calling capabilities to AI web platforms. We value your privacy, and this policy explains how we handle your data.

### Data Collection

**We do not collect any user data.**

Specifically:
- No personal information (name, email, IP address, etc.)
- No browsing history
- No AI conversation content
- No cookies or tracking technologies
- No data shared with any third parties

### Data Processing

All data processing occurs on your local computer:

| Component | Location | Description |
|-----------|----------|-------------|
| Browser Extension | Local browser | Injects tool prompts, intercepts SSE streams, displays tool panel |
| Tool Server | Local computer | Executes file read/write, commands, and other tool operations |
| Tool Results | Local browser | Backfilled into AI conversation |

### Local Storage

The extension uses `chrome.storage.local` to save:
- Tool server connection status
- User preferences

This data is stored only in your browser and never uploaded to any server.

### Tool Execution

This extension allows AI to call local tools (file read/write, command execution, etc.). All tool executions:
- Require explicit user confirmation via a popup dialog
- Run only on your local computer
- Results are displayed only in the local AI conversation

### Third-Party Services

This extension interacts with the following third-party web platforms:
- DeepSeek (chat.deepseek.com)
- ChatGPT (chatgpt.com)
- Kimi (kimi.moonshot.cn)
- Tongyi Qianwen (tongyi.aliyun.com)
- Zhipu Qingyan (chatglm.cn)
- Doubao (doubao.com)

These platforms have their own privacy policies. This extension does not control or take responsibility for their data practices.

### Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Interact with current tab content, inject tool panel |
| `storage` | Save user settings and connection status |
| `tabs` | Manage tab switching events |
| `nativeMessaging` | Communicate with local tool server |
| `alarms` | Periodically check server connection status |

### Changes

If we update this privacy policy, we will publish the new version in our GitHub repository and update the "Last Updated" date.

### Contact

For privacy-related questions:
- GitHub Issues: https://github.com/lsy200409/ai-tool-agent/issues
