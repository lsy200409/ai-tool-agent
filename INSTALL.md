# AI Tool Agent 安装指南

## 环境要求

- **Node.js 18+** — https://nodejs.org/ （下载 LTS 版本，安装时勾选"Add to PATH"）
- **Chrome 或 Edge 浏览器**

## 安装步骤

### 第1步：安装 Node.js 依赖

双击运行 `setup.bat`，或在项目目录打开终端执行：

```bash
npm install
```

### 第2步：启动本地工具服务器

双击运行 `start-server.bat`，或在终端执行：

```bash
npm run server
```

看到以下提示说明服务器启动成功：

```
工具服务器运行中: http://localhost:3002
```

> 服务器需要保持运行，关闭终端窗口会停止服务。

### 第3步：加载浏览器扩展

#### Chrome 浏览器

1. 打开 `chrome://extensions/`
2. 右上角开启 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 选择本项目的根目录（包含 manifest.json 的文件夹）
5. 扩展图标出现在浏览器工具栏

#### Edge 浏览器

1. 打开 `edge://extensions/`
2. 左下角开启 **"开发人员模式"**
3. 点击 **"加载解压缩的扩展"**
4. 选择本项目的根目录（包含 manifest.json 的文件夹）
5. 扩展图标出现在浏览器工具栏

### 第4步：使用

1. 打开 https://chat.deepseek.com
2. 登录你的 DeepSeek 账号
3. 按 **Ctrl+Shift+I** 注入工具提示词（每次新对话只需注入一次）
4. 正常对话，AI 会自动调用工具

## 工具调用示例

向 AI 发送以下消息即可触发工具调用：

- "列出当前目录的文件"
- "读取 workspace/config/settings.json 的内容"
- "创建一个文件 hello.txt，内容是 Hello World"
- "执行命令 dir"

## 工具执行安全确认

所有工具执行前会弹出确认对话框，你可以：

- **确认执行** — 点击绿色按钮
- **拒绝执行** — 点击红色按钮

## 工作区说明

项目根目录下的 `workspace/` 是 AI 工具的工作区：

```
workspace/
├── config/          # 配置文件
├── plugins/         # 插件目录
└── skills/          # 技能目录
```

AI 可以读写工作区内的文件，执行命令也限定在工作区范围内。

## 自启动（可选）

如果希望电脑开机后自动启动工具服务器：

1. 按 Win+R，输入 `shell:startup`，回车
2. 右键 → 新建快捷方式
3. 位置填：`cmd /k "cd /d <项目路径> && node server/launcher.js"`
4. 名称填：AI Tool Agent 服务器

## 常见问题

### 扩展加载后看不到工具面板

- 确认工具服务器已启动（http://localhost:3002）
- 刷新 DeepSeek 页面
- 按 Ctrl+Shift+I 重新注入提示词

### 工具服务器启动失败

- 确认 Node.js 已安装：`node --version`
- 确认端口 3002 未被占用
- 尝试手动启动：`node server/tool-server.js`

### AI 不调用工具

- 确认已按 Ctrl+Shift+I 注入提示词
- 确认工具服务器正在运行
- 打开浏览器控制台（F12）查看是否有错误信息

### 扩展连接状态显示"未连接"

- 检查工具服务器是否运行
- 点击扩展图标，查看连接状态
- 重启工具服务器后刷新页面

## 支持的 AI 平台

| 平台 | 状态 | 网址 |
|------|------|------|
| DeepSeek | ✅ 完整支持 | chat.deepseek.com |
| ChatGPT | ⚠️ 基本可用 | chatgpt.com |
| Kimi | ⚠️ 基本可用 | kimi.moonshot.cn |
| 通义千问 | ⚠️ 基本可用 | tongyi.aliyun.com |
| 智谱清言 | ⚠️ 基本可用 | chatglm.cn |
| 豆包 | ⚠️ 实验性 | doubao.com |

## 更多信息

- GitHub: https://github.com/lsy200409/ai-tool-agent
- 问题反馈: https://github.com/lsy200409/ai-tool-agent/issues
