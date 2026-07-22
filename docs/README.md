# RPG Agent MV 用户手册

简体中文 | [English](en/README.md)

> 面向 RPG Maker MV 与 RPG Maker MZ 1.10.0 制作者的本地 AI 制作工具。RPG Agent MV 支持通过自然语言生成事件、批量修改既有事件，并辅助处理脚本、插件和项目状态问题。

本手册分为三部分：第 1 章介绍安装、界面与首次任务；第 2 至第 3 章说明项目管理与 Agent 工作流；第 4 至第 5 章说明扩展机制、配置和问题排查。

当前版本不是 RPG Maker 编辑器的复刻。文中的“编辑器”“数据库”“资产库”均指 RPG Agent MV 已接入的受控能力；MV 与 MZ 工程共用项目管理、地图、事件、数据库、素材、插件、暂存和版本保存流程。MZ 1.10.0 是完整验证基线，旧版核心需确认兼容警告；第三方插件的业务语义及最终游戏效果仍需作者确认。

## 目录结构

```text
RPG Agent MV 用户手册
│
├── 1. 快速入门
│   ├── 1.1 产品介绍
│   ├── 1.2 安装与启动
│   ├── 1.3 界面概览
│   ├── 1.4 快速上手
│   └── 1.5 设置
│
├── 2. 项目管理
│   ├── 2.1 接入与切换项目
│   ├── 2.2 地图、事件与资产
│   └── 2.3 暂存、应用与回退
│
├── 3. Agent 工作流
│   ├── 3.1 需求描述与确认
│   ├── 3.2 从生成到落地
│   ├── 3.3 会话与日志
│   └── 3.4 动态工作流
│
├── 4. Agent 体系
│   ├── 4.1 MCP 工具
│   ├── 4.2 Skill
│   ├── 4.3 Subagent
│   └── 4.4 Rules
│
└── 5. 常见问题
    ├── 5.1 FAQ
    ├── 5.2 项目识别失败
    └── 5.3 模型与运行检测
```

## 文件列表

### 1. 快速入门

| 文件 | 内容 |
|------|------|
| [1.1-introduction.md](./1-getting-started/1.1-introduction.md) | 产品定位、核心能力和边界 |
| [1.2-installation.md](./1-getting-started/1.2-installation.md) | 运行前提、启动流程和基础自检 |
| [1.3-interface.md](./1-getting-started/1.3-interface.md) | 编辑器、Agent 面板和控制台 |
| [1.4-quickstart.md](./1-getting-started/1.4-quickstart.md) | 首次事件生成任务 |
| [1.5-settings.md](./1-getting-started/1.5-settings.md) | 模型、供应商、权限与规则 |

### 2. 项目管理

| 文件 | 内容 |
|------|------|
| [2.1-project.md](./2-projects/2.1-project.md) | 项目接入、切换和 Git 基线 |
| [2.2-map-events.md](./2-projects/2.2-map-events.md) | 地图、事件模式和待放置事件 |
| [2.3-staging.md](./2-projects/2.3-staging.md) | 暂存、应用、丢弃和改动对比 |

### 3. Agent 工作流

| 文件 | 内容 |
|------|------|
| [3.1-request.md](./3-agent-workflow/3.1-request.md) | 需求描述、边界约束和 ASK 确认 |
| [3.2-generate.md](./3-agent-workflow/3.2-generate.md) | 事件注册、预览和人工放置流程 |
| [3.3-sessions.md](./3-agent-workflow/3.3-sessions.md) | 会话延续、运行日志和问题定位 |
| [3.4-dynamic-workflow.md](./3-agent-workflow/3.4-dynamic-workflow.md) | 动态工作流的提议、审批、执行和报告 |

### 4. Agent 体系

| 文件 | 内容 |
|------|------|
| [4.1-mcp-tools.md](./4-agent-system/4.1-mcp-tools.md) | MCP 工具职责和扩展方式 |
| [4.2-skill.md](./4-agent-system/4.2-skill.md) | Skill 结构、加载规则和维护方式 |
| [4.3-subagent.md](./4-agent-system/4.3-subagent.md) | 子任务能力和默认执行者配置 |
| [4.4-rules.md](./4-agent-system/4.4-rules.md) | 产品规则、个人偏好与游戏级规则 |

### 5. 常见问题

| 文件 | 内容 |
|------|------|
| [5.1-questions.md](./5-faq/5.1-questions.md) | 高频问题 |
| [5.2-project-detection.md](./5-faq/5.2-project-detection.md) | 项目无法识别时的排查步骤 |
| [5.3-model-check.md](./5-faq/5.3-model-check.md) | 模型不可用、运行失败和本地状态冲突 |

## 快速入口

- 新用户入口：[1.1 产品介绍](./1-getting-started/1.1-introduction.md)
- 首次任务：[1.4 快速上手](./1-getting-started/1.4-quickstart.md)
- 项目接入：[2.1 接入与切换项目](./2-projects/2.1-project.md)
- 需求确认：[3.1 需求描述与确认](./3-agent-workflow/3.1-request.md)
- 扩展与规则：[第 4 章 Agent 体系](./4-agent-system/4.1-mcp-tools.md)
- 问题排查：[5.1 FAQ](./5-faq/5.1-questions.md)

## 版本信息

- 文档版本：v0.4.0
- 最后更新：2026-07-16
- 适用于：RPG Agent MV v0.4.0

