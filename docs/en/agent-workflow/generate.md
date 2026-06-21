# From Generation To Landing

[Back to User Guide](../README.md)

The generation flow starts with project facts, not isolated text. The Agent should inspect the current project, choose the controlled write path, and show what will change.

For new events, the safe flow is: draft content, register or stage the pending event, preview it, ask the user to place it on the map, then write the placed event.

For existing events, the safe flow is: identify the exact event, propose or stage the edit, review the diff or preview, then apply.

For scripts and plugins, the Agent should state assumptions and avoid guessing third-party plugin semantics when the project does not provide enough information.

Game content is not automatically translated. Dialogue, event text, names, and asset labels stay in the project's original language unless the user explicitly asks for translation.

