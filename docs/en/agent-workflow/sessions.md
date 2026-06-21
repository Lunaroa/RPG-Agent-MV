# Sessions And Logs

[Back to User Guide](../README.md)

Sessions preserve the conversation and runtime state for a production task.

Continue an existing session when the next request depends on prior context. Start a new session when the previous task has ended, when permissions changed, or when the Agent became blocked by stale state.

Logs and transcripts are for diagnosis. They can show tool calls, ASK decisions, runtime errors, and generated summaries. Use them to understand what the Agent saw before applying further changes.

If the runtime reports a permission denial, end the current session and start a fresh turn after checking that the project and product roots are allowed.

