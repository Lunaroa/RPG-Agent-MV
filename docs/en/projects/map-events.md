# Maps, Events, And Assets

[Back to User Guide](../README.md)

RPG Agent MV reads maps, events, database entries, plugins, and assets from the connected RPG Maker MV project so Agent work can be grounded in the real game.

Existing events can be inspected and edited through controlled flows. The Agent should identify the target map and event from project facts or from explicit user selection before proposing changes.

New events are handled as pending content. The Agent can draft the event, register it, and show a preview, but placement stays under user control. The user chooses the target map location on the map editor canvas, then the system writes the placed event and keeps it reviewable.

Assets are used as project facts. The Agent may reference available faces, characters, tilesets, audio, and plugins, but missing assets should be reported clearly rather than invented.

Project management reads all 15 MV database areas without the former 80-entry cutoff: actors, classes, skills, items, weapons, armors, enemies, troops, states, animations, tilesets, common events, system, types, and terms. The Inspector shows the effective staged value, field differences, and validation errors. Database and common-event drafts support undo and redo until saved to staging.

Agent database edits follow validate, dry-run, and stage steps. Applying an Agent-owned operation requires explicit approval and is blocked when the source or draft has drifted. Unknown plugin fields and notes are preserved, but custom plugin semantics are not validated.

Native pickers install `.js` plugins and category-compatible assets. New plugins start disabled; overwrites preserve configuration; plugin deletion stages the file and configuration together. Asset lists reflect staged additions, renames, and deletions immediately. Renames rewrite every known safe reference or are blocked, and deletion is allowed only for unreferenced assets.

