# MCP Tools

[Back to User Guide](../README.md)

MCP tools expose project-aware actions to the Agent runtime.

Tools should have clear ownership: reading project facts, saving reviewed edits, registering pending events, inspecting assets, or running controlled diagnostics. They should not bypass the product's review and placement boundaries.

When a tool writes to a game project, it must use the established validation and atomic direct-save path. Missing context should fail fast with a clear error.

`RmmvReadContext` exposes paged full database catalogs and complete source entries. The main Agent uses `RmmvDatabase` to validate and dry-run a batch, then passes the exact changes and plan hash to `RmmvDatabaseCommit`. The commit requires native approval, rechecks source fingerprints, and saves all affected files atomically. `RmmvMap` saves supported map edits directly. `RmmvVerify` copies the saved source project and runs the bounded isolated probe. Read-only sub-agents cannot call these save or verification paths; the sole controlled write exception is registering a pending event draft that has not entered the game project.

Tool availability depends on the runtime environment. If a tool requires a feature, platform, or environment variable, the UI should show that reason rather than silently hiding the failure.

The main Agent can also call the **workflow propose** tool (`workflow.propose`) to submit an orchestration script that fans out read-only sub-agents (see [Dynamic Workflow](../agent-workflow/dynamic-workflow.md)). The tool is available only to non-read-only agents, and the script runs only after the user approves it on the desktop approval card.

