# Interface Overview

[Back to User Guide](../README.md)

RPG Agent MV is organized around the current project, the Agent conversation, and the controlled review surfaces for generated work.

The main editor area shows the selected project context. Map and event surfaces are for inspection, review, and controlled placement. They are not a full replacement for RPG Maker MV's native editor.

The Agent panel is where production requests are entered, clarified, and continued. When the Agent needs a decision, it should use an ASK card instead of burying the question in plain text.

The console and detail panels expose project facts, staged changes, asset information, database entries, plugin diagnostics, and session status. Use them to inspect what the Agent read or changed before applying anything to the game project.

The global **Play / Stop** control launches only the current project-root `Game.exe`. Interactive playtesting runs the source project and excludes staged changes; the game may write to its own `save/` directory.

Project management exposes all 15 MV database areas and common events. Database and common-event drafts support undo and redo until they are saved to staging. Plugins can be installed from a native `.js` picker, while assets can be imported by category, renamed only when every known reference can be rewritten, and deleted only when unreferenced.

New event content follows a strict placement boundary. The Agent may generate or register a pending event, but it must not guess an exact map coordinate such as a village entrance, doorway, current location, or "suitable position". The user confirms placement on the map editor canvas.

