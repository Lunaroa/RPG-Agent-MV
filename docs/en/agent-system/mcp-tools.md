# MCP Tools

[Back to User Guide](../README.md)

MCP tools expose project-aware actions to the Agent runtime.

Tools should have clear ownership: reading project facts, staging edits, registering pending events, inspecting assets, or running controlled diagnostics. They should not bypass the product's review and placement boundaries.

When a tool writes to a game project, it must use the established staging, validation, or controlled write path. Missing context should fail fast with a clear error.

`RmmvReadContext` exposes paged full database catalogs and complete entries, preferring the effective staged version. The main Agent uses `RmmvDatabase` for validate, dry-run, stage, and discard. `RmmvDatabaseApply` accepts only an existing operation identifier and requires native approval plus a fresh preflight. `RmmvVerify` runs the bounded isolated-copy probe. Read-only sub-agents cannot call these write or verification paths.

Tool availability depends on the runtime environment. If a tool requires a feature, platform, or environment variable, the UI should show that reason rather than silently hiding the failure.

The main Agent can also call the **workflow propose** tool (`workflow.propose`) to submit an orchestration script that fans out read-only sub-agents (see [Dynamic Workflow](../agent-workflow/dynamic-workflow.md)). The tool is available only to non-read-only agents, and the script runs only after the user approves it on the desktop approval card.

