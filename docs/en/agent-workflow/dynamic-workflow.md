# Dynamic Workflow

[Back to User Guide](../README.md)

The dynamic workflow lets the main Agent fan out read-only sub-agents through an orchestration script that the user approves before execution.

## When to use it

Use it when a task naturally splits into parallel or pipelined sub-agent work — e.g. inspecting several maps at once, cross-checking asset references, or gathering context from multiple sources before summarizing. Simple single-step tasks are still handled directly by the main Agent; the workflow is not mandatory.

## Flow

1. **Propose** — The main Agent calls `workflow.propose` to submit an orchestration script. The script is persisted for human review.
2. **Approve** — The desktop pauses the Agent at the tool call and shows a risk-approval card with the script. Choose:
   - **Allow once** — run only this time;
   - **Always allow** — auto-approve subsequent proposals;
   - **Deny** — abandon the workflow.
3. **Execute** — After approval, the orchestrator dispatches read-only sub-agents per the script's `agent()` / `parallel()` / `pipeline()` primitives, with schema validation and concurrency limits. Sub-agent start/end is shown live in the sub-agent panel.
4. **Report** — On completion, the run report is wired into the session stream for review.

## Boundaries

- Workflow propose is available only to **non-read-only** main agents; read-only sub-agents cannot propose workflows.
- The session does not end early while a workflow is running; stopping the session cancels outstanding work.
- Workflow artifacts (run records, reports) live in the product runtime directory, not in the RMMV project.

## Related

- [MCP Tools](../agent-system/mcp-tools.md)
- [Subagents](../agent-system/subagent.md)
- [Sessions And Logs](sessions.md)
