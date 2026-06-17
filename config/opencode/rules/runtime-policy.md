# 已迁移

桌面 Agent 运行规则的**唯一正文**在 [`../AGENTS.md`](../AGENTS.md)。

后端在启动 opencode 前会把该文件同步到 `RPG-Agent-MV/.opencode/AGENTS.md`；opencode 通过 `OPENCODE_CONFIG_DIR` 加载全局 `AGENTS.md`，因此游戏工程 cwd 与产品根分离时规则仍会注入。

请直接编辑 `config/opencode/AGENTS.md`，不要在本文件维护重复正文。
