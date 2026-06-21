# MCP Tools

[Back to User Guide](../README.md)

MCP tools expose project-aware actions to the Agent runtime.

Tools should have clear ownership: reading project facts, staging edits, registering pending events, inspecting assets, or running controlled diagnostics. They should not bypass the product's review and placement boundaries.

When a tool writes to a game project, it must use the established staging, validation, or controlled write path. Missing context should fail fast with a clear error.

Tool availability depends on the runtime environment. If a tool requires a feature, platform, or environment variable, the UI should show that reason rather than silently hiding the failure.

