# 🛠️ DeepSeek Tool Agent

> **DeepSeek Web Extension — Local Tool Calling & Agent Framework**
> 为 DeepSeek 网页版添加本地工具调用能力

---

## 🌟 功能 / Features

### 中文
- **工具调用管道**：自动检测 AI 回复中的 `<tool_call>` 标签，提取工具名和参数
- **本地工具执行**：通过 SW 消息通道或 HTTP fallback 执行工具并返回结果
- **结果回填**：工具执行结果自动写入 DeepSeek 输入框并发送，形成完整循环
- **多轮执行**：AI 可连续调用多个工具，每次返回结果后自动继续
- **工作区隔离**：AI 仅可读写 `workspace/` 目录，源代码安全隔离
- **按钮状态监控**：通过发送按钮图标（箭头↗/停止⏹）变化精准判断 AI 生成状态
- **文件浏览器**：在面板中浏览工作区文件，支持预览
- **插件系统骨架**：预留 `plugins/` 目录，支持未来 OpenClaw 插件接入
- **消息网关预留**：`gateway/bridge.js` 为外部平台消息接入做准备

### English
- **Tool Calling Pipeline**: Automatically detect `<tool_call>` tags in AI responses, extract tool names and parameters
- **Local Tool Execution**: Execute tools via SW message channel or HTTP fallback
- **Result Backfill**: Tool results are automatically written back to DeepSeek's input and sent
- **Multi-round Execution**: AI can call multiple tools in sequence with result feedback
- **Workspace Isolation**: AI can only read/write within `workspace/` directory
- **Button State Monitoring**: Detect AI generation status via send button icon changes (arrow↗/stop⏹)
- **File Browser**: Browse and preview workspace files in the panel
- **Plugin System Skeleton**: `plugins/` directory ready for OpenClaw plugin integration
- **Message Gateway**: `gateway/bridge.js` prepared for external platform integration

---

## 📁 项目结构 / Project Structure

```
deepseek-tool-agent/
├── src/                      # 插件核心源码
│   ├── core/                 # 核心引擎
│   │   ├── state.js          # 全局状态与 Session 管理
│   │   ├── logger.js         # 日志系统与执行历史
│   │   ├── parser.js         # tool_call 解析
│   │   ├── executor.js       # 工具执行（SW / HTTP fallback）
│   │   └── backfill.js       # 结果回填构建
│   ├── dom/                  # 页面交互层
│   │   ├── input.js          # 输入框读写与发送按钮
│   │   └── ai-message.js     # AI 消息检测与流式判断
│   ├── tools/                # 工具注册表
│   │   ├── registry.js       # 工具注册与系统提示词构建
│   │   └── builtin.js        # 7 个内置工具注册
│   ├── gateway/              # 消息网关（外部平台接口预留）
│   │   └── bridge.js
│   ├── plugins/              # 插件系统骨架
│   │   └── loader.js
│   ├── ui/                   # 面板 UI
│   │   ├── panel.js          # 面板构建与 CSS
│   │   ├── actions.js        # 按钮动作与设置
│   │   ├── connection.js     # 服务器连接与心跳
│   │   └── file-browser.js   # 文件浏览器
│   ├── router.js             # 初始化与消息路由
│   ├── background.js         # Service Worker
│   └── injected.js           # 页面注入脚本
│
├── server/                   # 工具服务器
│   ├── tool-server.js        # HTTP 工具服务器（端口 3002）
│   └── launcher.js           # 进程守护启动器
│
├── workspace/                # AI 工作区（AI 可读写）
│   ├── config/               # 插件配置
│   │   ├── settings.json
│   │   └── plugin_manifest.json
│   ├── memory/               # 记忆持久化
│   │   ├── session_logs/
│   │   └── knowledge_base/
│   └── projects/             # 用户项目文件
│
├── popup/                    # 扩展弹窗
├── native-messaging/         # Native Host 配置文件
├── scripts/                  # 启动脚本
├── manifest.json             # 扩展配置
└── package.json
```

---

## 🚀 快速开始 / Quick Start

### 前置条件 / Prerequisites
- Edge 浏览器（或 Chrome 148+）
- Node.js 18+

### 安装 / Installation

1. **克隆仓库 / Clone**
   ```bash
   git clone <your-repo-url>
   cd deepseek-tool-agent
   npm install
   ```

2. **加载扩展 / Load Extension**
   - 打开 `edge://extensions/` 或 `chrome://extensions/`
   - 开启「开发者模式」
   - 点击「加载已解压的扩展」，选择项目根目录

3. **启动工具服务器 / Start Tool Server**
   ```bash
   node server/tool-server.js
   ```

4. **打开 DeepSeek**
   - 访问 `https://chat.deepseek.com`
   - 在页面右上角会出现 🛠️ 工具面板

5. **首次使用**
   - 点击「💉 注入提示词」将工具提示词注入到输入框
   - 或在设置中配置工作区路径
   - 在面板中输入任务，点击「🚀 发送任务」

---

## 🔧 可用工具 / Available Tools

| 工具名 | 说明 | English |
|--------|------|---------|
| `read_file` | 读取本地文件内容 | Read file content |
| `write_file` | 写入/创建文件 | Write or create file |
| `append_file` | 追加内容到文件 | Append to file |
| `list_dir` | 列出目录 | List directory |
| `exec_command` | 执行 cmd 命令 | Execute command |
| `search_files` | 搜索文件 | Search files |
| `get_file_info` | 获取文件信息 | Get file info |

---

## 🧪 测试 / Testing

```bash
# 端到端多轮循环测试
node test-edge.js full "你的测试任务描述"

# 单次发送并查看 AI 回复
node test-edge.js say "你的消息"

# 检测 tool_call
node test-edge.js detect
```

---

## 🔌 插件系统 / Plugin System

插件通过 `plugins/loader.js` 加载。当前为骨架阶段，后续将支持：

- OpenClaw 插件适配（飞书 CLI、ima 知识库等）
- 记忆系统（RAG 数据库）
- 自定义技能（Skill）

---

## 📜 许可证 / License

Private — 内部使用，未经授权不得公开分发

---

*Built for DeepSeek Web · Powered by Chrome Extension API*
