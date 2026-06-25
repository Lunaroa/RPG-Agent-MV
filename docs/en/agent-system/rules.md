# Rules

[Back to User Guide](../README.md)

RPG Agent MV uses layered rules: product rules, user preferences, and game-project rules.

Product rules protect the workflow: no guessed event coordinates, no uncontrolled writes, no compatibility workarounds that hide missing requirements, and no broad task expansion without user approval.

User preferences shape collaboration and output style. They do not override safety boundaries.

Game-project rules describe the specific RPG Maker MV project. They can define naming, story, switch and variable conventions, plugin usage, or content language. The Agent should read them before editing that project.

If rules conflict, stop and ask for clarification rather than guessing.

