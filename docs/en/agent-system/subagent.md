# Subagents

[Back to User Guide](../README.md)

Subagents handle bounded subtasks while the main Agent keeps responsibility for the user-facing workflow.

Use subagents for independent investigation, project inspection, or narrow implementation work. Do not use them to bypass ASK approval, staging, or placement rules.

Foreground subagents must finish before the main session can close cleanly. If a subagent is stuck, stop it or wait for its result before continuing.

Subagent output should be treated as evidence for the main workflow, not as an automatic final write to the game project.

When a task needs to fan out multiple sub-agents in parallel or as a pipeline, the main Agent submits an orchestration script via the dynamic workflow; after user approval, the orchestrator dispatches read-only sub-agents through `agent()` / `parallel()` / `pipeline()` primitives, with progress shown in the sub-agent panel. See [Dynamic Workflow](../agent-workflow/dynamic-workflow.md).

