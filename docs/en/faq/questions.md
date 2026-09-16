# FAQ

[Back to User Guide](../README.md)

## Does RPG Agent MV replace RPG Maker MV?

No. It assists with project-aware production work, but final review, complex map design, plugin semantics, and creative judgment stay with the creator.

## Can the Agent place a new event automatically?

It can draft and register a pending event, but it must not guess final coordinates. The user places the event on the map editor canvas.

## Will it translate my game?

No. Product UI language and game content language are separate. Dialogue, event text, names, and asset labels stay as they are unless you explicitly request translation.

## Should I keep every generated change?

No. Review the actual saved result and Git diff. If a change is wrong, stop further writes and recover it with editor undo, Git version history, or a project backup.

## What should I do when the model fails?

Check provider, model, API key, base URL, and runtime permissions. See [Model And Runtime Checks](model-check.md).

