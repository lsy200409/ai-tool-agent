---
name: skill-creator
description: 创建、编辑、改进技能。当需要创建新技能或改进现有技能时使用。触发词："创建技能"、"编写技能"、"改进这个技能"、"新建技能"。
---

# 技能创建器

此技能指导如何创建有效的 Agent 技能。

## 关于技能

技能是模块化的、自包含的包，为 AI Agent 提供专业知识和操作指导。每个技能由一个 `SKILL.md` 文件组成。

### 技能目录结构

```
skill-name/
├── SKILL.md          (必需 - YAML frontmatter + Markdown 指令)
├── scripts/          (可选 - 可执行脚本)
├── references/       (可选 - 参考文档)
└── assets/           (可选 - 模板/资源文件)
```

### SKILL.md 格式

```markdown
---
name: skill-name
description: 技能描述 — 包含何时使用此技能的详细说明
---

# 技能标题

## 概述
简要说明此技能的功能

## 使用指南
具体的使用步骤和指令...
```

## 创建流程

### 步骤 1：确定技能名称

- 使用小写字母、数字和连字符
- 中文名称可保留但需要使用英文连字符格式作为目录名
- 长度不超过 64 字符
- 名称应简洁描述技能功能

### 步骤 2：编写 SKILL.md

创建文件 `workspace/skills/<skill-name>/SKILL.md`，内容必须包含：

1. **YAML frontmatter**（必需）：
   - `name:` 技能名称
   - `description:` 详细描述，包括何时触发此技能

2. **Markdown body**：具体的操作指令

### 步骤 3：使用 API 注册技能

通过以下 API 创建技能：

```json
POST /api/agent/skills
{
  "action": "create",
  "name": "skill-name",
  "description": "技能描述",
  "content": "# 技能标题\n\n## 概述\n..."
}
```

或直接使用 `write_file` 工具写入 `workspace/skills/<skill-name>/SKILL.md`，技能会被自动发现。

## 最佳实践

1. **保持简洁**：指令要精炼，AI 本身已经很聪明
2. **描述清晰**：YAML description 是技能触发的关键，要描述清楚使用场景
3. **渐进式加载**：description 始终在上下文中，body 在触发后加载
4. **不要创建多余的说明文件**：只需要 SKILL.md