# DeepSeek Agent 初始工作区
## 目录说明

- config/        — 插件配置与设置（AI 通过工具读写）
- memory/        — 记忆持久化
  - session_logs/      — 历史会话摘要
  - knowledge_base/    — 知识库（RAG 数据源）
- projects/      — 用户项目文件

## 规则
1. AI 可以在 workspace/ 内自由读写文件
2. AI 不可修改 workspace/ 之外的目录
3. 用户偏好和重要信息写入 memory/
