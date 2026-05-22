# v2.4 → v2.5 聚焦实施方案

> **核心目标**：轻量化网页 Agent 手脚架 + 面试展示  
> **策略**：优先核心链路 + 面板 UI 打磨，非核心功能延后  
> **日期**：2026-05-20 | **扩展ID**：`diaocpmadbepofacimmkigkkkeihnjio`  
> **API Key**：固定值 `ds-agent-key-3002`  

---

## 先读完这份总结，不着急动手

### 当前状态速览

**后端 tool-server.js 已有的 API 端点（已经很完整了！）：**

| 端点 | 功能 | 状态 |
|------|------|------|
| `GET /health` | 健康检查+系统信息 | ✅ |
| `POST /api/tool` | 通过 ToolRegistry 执行工具 | ✅ |
| `GET/POST /api/tools` | 工具列表 + 执行 | ✅ |
| `GET /api/plugins` + reload | 插件管理 | ✅ |
| `GET/POST /api/agent/personality` | 人格 CRUD | ✅ |
| `POST /api/agent/memory` | 记忆系统 | ✅ |
| `GET/POST /api/agent/skills` | 技能 CRUD (list/toggle/create/delete) | ✅ |
| `GET/POST /api/agent/tools` | 工具模式管理 (get/set_mode) | ✅ |
| `GET /api/agent/status` | 完整状态查询 | ✅ |
| `GET/POST /api/agent/quick-actions` | 快捷操作 CRUD | ✅ |
| `POST /api/log` | 日志写入 | ✅ |
| `GET /api/config` | 配置管理 | ✅ |
| `/api/read` `/api/write` 等 7 个旧端点 | 向下兼容 | ✅ |

**真正缺失的只有 2 个路径：**
1. ❌ 统一错误格式 `{error:{code,message}}` — 目前是 `{success:false, error:"message"}`
2. ❌ CORS 白名单 — 目前是 `*`

**前端面板的缺失项：**
1. ❌ 工具调用检测 → 执行 → 回填链路未打通（panel/parse/executor/backfill 都有代码，但 wiring 可能断裂）
2. ❌ 面板不读 storage 的动态配置（theme/position）
3. ❌ Popup 修改配置后后端不同步（大部分已有 API，只需前端调）

---

## 阶段一：核心执行链路打通 🔴（最优先，1天）

> **这是面试能展示的核心**：用户输入 → AI 输出 tool_call → 自动解析 → 自动执行 → 结果回填 → AI 基于结果继续

### 1.1 链路自查和修复

现有链路代码都在，需要逐段验证：

```
input-monitor.js (455行)
  ↓ 监听 AI 消息
parser.js (47行)
  ↓ 解析 tool_call
executor.js (84行)
  ↓ 执行工具
backfill.js (40行)
  ↓ 回填结果
panel.js (920行)
  ↓ 日志展示
```

**需要排查的点：**

| # | 排查项 | 文件 |
|---|--------|------|
| 1 | input-monitor 是否正确启动了 MutationObserver？ | input-monitor.js |
| 2 | parser 支持的 tool_call 格式与 AI 实际输出格式是否匹配？ | parser.js |
| 3 | executor 的 SW消息通道 → HTTP fallback 双通道是否都通畅？ | executor.js |
| 4 | backfill 的结果注入用的是什么格式？是否能触发 AI 继续？ | backfill.js |
| 5 | panel 的日志区是否实时显示了执行过程？ | panel.js |

### 1.2 后端 `/exec` 统一端点（从 openclaw 模式对齐）

openclaw 用 `/api/tool` 接收 `{name, args, mode}` 调用 toolRegistry。当前 tool-server.js 已有这个端点。只需：

```
新增: POST /exec 
接受: {tool, args, mode} → 调用 toolRegistry.executeTool()
返回: {success, result, logs}
```

这是面试展示的关键 — 一个干净的 RESTful 端点。

### 1.3 阶段一交付清单

- [ ] 核心链路诊断报告（哪些环节断链）
- [ ] 断链修复
- [ ] `POST /exec` 新端点
- [ ] CORS 改为 `chrome-extension://diaocpmadbepofacimmkigkkkeihnjio`
- [ ] 统一错误格式 `{error:{code,message}}`
- [ ] 端到端验证：手动触发 tool_call → 看到面板日志出现 → 输入框有结果

---

## 阶段二：面板 UI 最终打磨 🔴（1天）

> 目标是打开面板就能看到专业、完整的双栏布局

### 2.1 面板从后端加载数据

当前 `loadPanelData()` 中调用的 `loadTools()` / `loadSkills()` / `loadQuickActions()` 需要真正 fetch 后端 API：

```javascript
// actions.js 新增
async function loadToolsFromServer() {
  var resp = await apiGetJson('/api/tools');
  if (resp.success) return resp.tools;
  return [];
}
async function loadSkillsFromServer() {
  var resp = await apiGetJson('/api/agent/skills');
  if (resp.success) return resp.skills;
  return [];
}
```

### 2.2 面板 Header 连接状态实时更新

已有 `updateServerStatusUI(online)` — 需要每 10 秒轮询 `/health`：

```javascript
setInterval(function() {
  fetch(API_BASE + '/health').then(function(r) {
    updateServerStatusUI(r.ok);
  }).catch(function() {
    updateServerStatusUI(false);
  });
}, 10000);
```

### 2.3 阶段二交付清单

- [ ] 面板打开后工具列表从后端加载（非空列表）
- [ ] 面板打开后技能列表从后端加载
- [ ] 快捷操作按钮从后端/配置加载
- [ ] Header 连接状态绿灯/红灯实时切换
- [ ] 底部状态栏显示 "Ready · N tools · M auto"

---

## 阶段三：Popup 管理面板联调 🟡（1天）

### 3.1 Popup CRUD 同步后端

Popup 已有的 8 个页签中，大部分控件只读写 `chrome.storage.sync`。需要增加后端同步：

| 页签 | 操作 | 当前 | 需增加 |
|------|------|------|--------|
| Connection | Test Connection | 直接 fetch | ✅ 已 OK |
| Tools | 添加/编辑/删除 | storage | + `POST/PUT/DELETE /api/agent/tools` |
| Skills | 添加/删除/开关 | storage | + `POST/DELETE /api/agent/skills` |
| Quick Actions | 编辑 | storage | + `POST /api/agent/quick-actions` save |

### 3.2 后端补充 tools CRUD 端点

tool-server.js 的 AGENT_API 已有 `tools_set_mode` 和 `tools_list`，需补：

```
POST   /api/agent/tools/create   {name, description, template, mode}
DELETE /api/agent/tools/:name
```

### 3.3 阶段三交付清单

- [ ] Popup 添加工具 → 后端持久化 + 面板刷新可见
- [ ] Popup 删除工具 → 后端删除 + 面板同步
- [ ] Popup 技能开关 → 后端 toggle + 面板同步
- [ ] Popup Quick Actions → 后端保存 + 面板同步

---

## 阶段四：收尾联调 🟢（0.5天）

### 4.1 快速检查清单

- [ ] 打开 chat.deepseek.com → [DS] 小球可见
- [ ] 点击小球 → 面板展开 → Header 显示 "● Connected"
- [ ] 左栏显示工具列表 + 技能列表
- [ ] 右栏显示日志系统
- [ ] 发送消息给 AI → AI 输出 tool_call → 面板日志出现执行记录
- [ ] 结果回填到输入框
- [ ] 点击浏览器图标 → Popup 弹出 → 8 个页签切换正常
- [ ] Popup Test Connection 绿色

### 4.2 延后功能清单（不阻塞 v2.5）

| 功能 | 原因 |
|------|------|
| WebSocket 实时日志推送 | 轮询已够用，WS 是锦上添花 |
| 桌面通知 | 面试不涉及 |
| 速率限制中间件 | 本地工具服务器，无外部暴露 |
| MANUAL 模式审批 UI | 自动模式已满足核心需求 |
| 后端代码重构分层（Router/Middleware/Services） | 当前单体已够用，重构不影响面试展示 |
| 单元测试 | 面试不涉及 |

---

## 最终交付结果

### 面试可展示的核心场景

```
1. 演示者打开 chat.deepseek.com
2. 右下角 [DS] 蓝色小球自动出现
3. 点击小球 → 专业双栏面板展开
4. Header 显示 "● Connected" + 连接状态
5. 左栏：7 个工具卡片 + 技能列表 + 搜索框
6. 右栏：实时日志系统（All/Info/Warn/Error Tab）
7. 底部：快捷操作按钮 + 状态摘要
8. 在聊天中输入：请帮我在 workspace 目录下创建一个 hello.txt 文件
9. AI 自动输出 tool_call
10. 面板日志区实时出现：
    14:32:05 INFO  Detected tool_call
    14:32:05 INFO  Executing: write_file
    14:32:05 SUCCESS File written: workspace/hello.txt
11. 输入框自动填入执行结果
12. 点击发送 → AI 确认文件创建成功
```

### 代码改动清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `server/tool-server.js` | 修改 | +50行：新增 `/exec` + tools create/delete + CORS白名单 + 统一错误格式 |
| `src/ui/panel.js` | 修改 | +30行：loadPanelData 从后端加载工具/技能 + 定时健康检查 |
| `src/ui/actions.js` | 修改 | +40行：loadToolsFromServer / loadSkillsFromServer / testConnection |
| `popup/popup.js` | 修改 | +30行：CRUD 操作同步后端 API |
| `src/injected.js` | 检查 | 确认 page context 函数正常 |
| `src/core/parser.js` | 检查 | 确认 tool_call 格式解析正确 |
| `src/core/executor.js` | 检查 | 确认双通道执行正常 |
| `src/monitor/input-monitor.js` | 检查 | 确认监控启动正常 |

**总计**：修改 4 个文件，检查 4 个文件，净增 ~150 行

---

*准备就绪，可以随时开始阶段一。*