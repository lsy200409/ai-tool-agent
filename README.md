# AI Tool Agent

**Give AI web chat local tool-calling abilities** — install the extension, start the server, and let DeepSeek / ChatGPT / Kimi / Qwen / GLM / Doubao read files, run commands, and manage your workspace.

[![Version](https://img.shields.io/badge/version-0.1.1-blue)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-orange)](LICENSE)

简体中文 | [English](README.en.md)

---

## Table of Contents

- [Why AI Tool Agent?](#why-ai-tool-agent)
- [Supported Platforms](#supported-platforms)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Available Tools](#available-tools)
- [Plugin System](#plugin-system)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Why AI Tool Agent?

| Without AI Tool Agent | With AI Tool Agent |
| --- | --- |
| AI can only chat | AI can **read/write files** |
| AI can't access your system | AI can **execute commands** |
| Copy-paste results manually | Results **auto-inject** back to chat |
| No memory across sessions | **Persistent memory** and personality |
| Only works on one platform | **8 platforms** supported |

AI Tool Agent is a Chrome/Edge extension that injects local tool-calling capabilities into AI web chat platforms. It works by intercepting the AI's streaming response, detecting tool call tags, executing them locally, and feeding results back — all automatically.

---

## Supported Platforms

| Platform | Status | Notes |
| --- | --- | --- |
| DeepSeek | ✅ tested | Full tool calling support |
| ChatGPT | ✅ tested | GPT-4, GPT-4 Turbo |
| Kimi | ✅ tested | Moonshot v1 8K/32K/128K |
| Qwen (通义千问) | ✅ tested | Qwen domestic |
| Qwen International | ✅ tested | chat.qwen.ai |
| GLM (智谱清言) | ✅ tested | glm-4-Plus |
| GLM International (z.ai) | ✅ tested | GLM-4 Plus |
| Doubao (豆包) | ✅ tested | doubao-seed-2.0 |

---

## How It Works

### Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                        AI Web Page (e.g. DeepSeek)              │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ SSE      │  │ Panel    │  │ Monitor  │  │ Executor │       │
│  │ 拦截器   │  │ UI 面板  │  │ 状态机   │  │ 工具执行 │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       └──────────────┴──────────────┴──────────────┘            │
│                          │ chrome.runtime.sendMessage           │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│              Service Worker (background.js)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Message Router │ Server Status │ Native Host │ HTTP Fallback │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Native Messaging / HTTP
┌──────────────────────────┼──────────────────────────────────────┐
│               Local Tool Server (Node.js, port 3002)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ read_file│  │write_file│  │exec_cmd  │  │ list_dir │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                    24 Tools · Plugin System                      │
└─────────────────────────────────────────────────────────────────┘
```

### Tool calling flow

```text
1. User sends message → AI starts streaming response
2. SSE interceptor captures stream chunks
3. Monitor detects ◰ tool call tags in accumulated text
4. Executor sends tool request to local server
5. Server executes tool (read file, run command, etc.)
6. Result backfills into chat input → auto-sends
7. AI receives tool result → continues task
```

---

## Quick Start

### Requirements

- **Browser**: Chrome 148+ or Edge
- **Node.js**: 18+
- **OS**: Windows (Native Messaging), macOS/Linux (HTTP mode)

### Step 1: Clone and install

```bash
git clone https://github.com/lsy200409/ai-tool-agent.git
cd ai-tool-agent
npm install
```

### Step 2: Start the tool server

**Option A — Double-click (Windows, recommended)**

```
Double-click start-server.bat in the project root
```

**Option B — Command line**

```bash
node server/launcher.js
```

Server starts on:
- Tool API: `http://localhost:3002`
- Launcher API: `http://localhost:3003`

### Step 3: Load the extension

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `ai-tool-agent/` directory

### Step 4: Start using

1. Visit any supported AI platform (e.g. https://chat.deepseek.com/)
2. Click the robot icon in the bottom-left to open the tool panel
3. Verify the status shows "Connected" (green)
4. Press **Ctrl+Shift+I** (or click 🔧 in the panel) to inject tool prompts
5. Start chatting — AI will automatically call tools when needed

### Step 5 (Optional): Native Host auto-start

Run as Administrator:
```
native-messaging\register.bat
```

After this, the tool server starts automatically with Chrome — no need to run `start-server.bat` manually.

---

## Usage

### Inject tool prompts

Before AI can use tools, you need to inject the tool definitions into the conversation. This teaches the AI how to call tools.

**Method 1**: Press `Ctrl+Shift+I` on any supported AI page

**Method 2**: Click the 🔧 button in the panel footer

After injection, you'll see a log entry: "工具提示词已注入 (33 个工具, 含插件)"

### Tool calling example

When you ask AI to do something that requires local access:

```
You: 帮我看看当前目录下有什么文件

AI: <list_dir>
{"path": "."}
</list_dir>
```

The extension automatically:
1. Detects the `<list_dir>` tag
2. Executes `list_dir` on the local server
3. Feeds the result back to AI
4. AI responds with the directory listing

### Memory management

Click 🧠 in the panel to initialize agent memory. This gives AI persistent context across conversations.

### Tool retry

If a tool call fails, click 🔄 in the panel to retry with the last tool prompt.

### File browser

Click the folder icon in the panel to browse your workspace files directly.

---

## Available Tools

| Tool | Parameters | Description |
| --- | --- | --- |
| `read_file` | `path` | Read file contents (workspace only) |
| `write_file` | `path`, `content` | Write/create a file |
| `append_file` | `path`, `content` | Append content to a file |
| `list_dir` | `path` | List directory contents |
| `exec_command` | `command`, `cwd` | Execute a system command |
| `search_files` | `path`, `pattern` | Search files (glob support) |
| `get_file_info` | `path` | Get file metadata |
| + Plugin tools | — | Extended tools from plugins |

### Tool call format

AI uses XML tags to call tools:

```xml
<read_file>
{"path": "workspace/projects/example.txt"}
</read_file>
```

Results are returned to AI as structured text:

```xml
<tool_response status="success">
{
  "tool": "read_file",
  "content": "[file contents...]"
}
</tool_response>
```

---

## Plugin System

AI Tool Agent supports a plugin system for extending tool capabilities.

### Plugin structure

```text
workspace/plugins/
└── my-plugin/
    ├── SKILL.md          # Plugin definition (required)
    └── my-script.js      # Optional scripts
```

### SKILL.md format

```markdown
---
id: my-plugin
name: My Custom Plugin
version: 1.0.0
tools:
  - name: my_tool
    description: Does something custom
    parameters:
      - name: input
        type: string
        required: true
---

# My Plugin

Custom tool implementation details...
```

### Built-in plugins

5 plugins are included:
- **Web Search** — Search the web via browser
- **Web Fetch** — Fetch and extract web page content
- **Apply Patch** — Apply unified diff patches to files
- **Browser** — Browser automation
- **Message** — Send messages via Feishu/Lark

---

## Configuration

### Workspace config

```text
workspace/
├── config/
│   ├── personality.json    # Agent personality settings
│   └── tool-modes.json     # Tool permission modes
├── plugins/                # Plugin directory
├── skills/                 # Custom skills
├── memory/                 # Persistent memory
└── sessions/               # Session history
```

### Tool permission modes

Each tool can be set to one of three modes:

| Mode | Behavior |
| --- | --- |
| `auto` | Execute automatically (no confirmation) |
| `confirm` | Ask user before execution |
| `deny` | Block execution entirely |

Default: `exec_command` is set to `confirm`, all others to `auto`.

---

## Troubleshooting

### Server not running

1. Check `http://localhost:3002/health`
2. Start server: double-click `start-server.bat` or `node server/launcher.js`
3. Verify Node.js is installed: `node --version`

### Extension context invalidated

1. Refresh the AI page (F5)
2. If persistent, reload the extension at `chrome://extensions/`
3. The system auto-recovers in 3 seconds

### Tool calls not working

1. Confirm panel shows "Connected" (green)
2. Make sure you've injected tool prompts (Ctrl+Shift+I)
3. Check browser console for errors
4. Try the 🔄 retry button

### Panel not visible

1. Click the robot icon in the bottom-left corner of the page
2. If missing, refresh the page and try again
3. Check that the extension is enabled at `chrome://extensions/`

---

## File Structure

```text
ai-tool-agent/
├── src/                          # Extension source code
│   ├── core/                     # Core modules
│   │   ├── state.js              # Global state management
│   │   ├── config.js             # Configuration system
│   │   ├── executor.js           # Tool execution + Context Guard
│   │   ├── logger.js             # Logging system
│   │   ├── tool-call-parser.js   # Tool call tag parser
│   │   └── backfill.js           # Result backfill builder
│   ├── platforms/                # Platform adapters (8 platforms)
│   │   ├── platform-base.js      # Base adapter with shared logic
│   │   ├── platform-registry.js  # Adapter registry
│   │   ├── deepseek.js           # DeepSeek adapter
│   │   ├── chatgpt.js            # ChatGPT adapter
│   │   ├── kimi.js               # Kimi adapter
│   │   ├── qwen.js               # Qwen adapter
│   │   └── ...                   # More adapters
│   ├── monitor/
│   │   └── input-monitor.js      # State machine + SSE handler
│   ├── ui/
│   │   ├── panel.js              # Panel UI
│   │   ├── panel-css.js          # CSS styles
│   │   ├── actions.js            # Tool injection, memory, actions
│   │   ├── connection.js         # Server connection management
│   │   └── file-browser.js       # Workspace file browser
│   ├── background.js             # Service Worker
│   └── injected.js               # MAIN world SSE interceptor
│
├── server/                       # Local tool server
│   ├── tool-server.js            # HTTP API (port 3002)
│   ├── launcher.js               # Process manager (port 3003)
│   ├── tool-registry.js          # Tool registration
│   └── plugin-loader.js          # Plugin loader
│
├── workspace/                    # AI workspace (sandboxed)
├── native-messaging/             # Native Host for auto-start
├── popup/                        # Extension popup
├── icons/                        # Extension icons
├── scripts/                      # Build and packaging scripts
├── manifest.json                 # Chrome MV3 manifest
└── package.json
```

---

## Security

- **Sandboxed workspace**: AI can only read/write files inside `workspace/`
- **Confirmation dialog**: Dangerous operations (like `exec_command`) require user approval
- **Permission modes**: Each tool can be set to auto/confirm/deny
- **Local only**: All data stays on your machine — no cloud, no telemetry
- **No API keys needed**: Works with your existing browser login

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

### Adding a new platform

To add support for a new AI platform:

1. Create `src/platforms/your-platform.js`
2. Implement the adapter interface (see `platform-base.js`):
   - `dom` — CSS selectors for chat elements
   - `setInputValue(input, value)` — Set input field value
   - `sendMessage()` — Trigger message send
   - `isUserMessage(el)` — Detect user messages
3. Register in `platform-registry.js`
4. Add URL patterns to `manifest.json` content_scripts

---

## License

[MIT License](LICENSE)

---

## Disclaimer

This extension interacts with third-party AI platforms through script injection, which may violate their terms of service. Users must assess and bear the associated risks themselves. See [DISCLAIMER.md](DISCLAIMER.md) for full details.

---

*AI Tool Agent v0.1.1 · Chrome Extension MV3 · [GitHub](https://github.com/lsy200409/ai-tool-agent)*
