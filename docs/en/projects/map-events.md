# Maps, Events, And Assets

[Back to User Guide](../README.md)

RPG Agent MV reads maps, events, database entries, plugins, and assets from the connected RPG Maker MV or supported MZ project so Agent work can be grounded in the real game.

Existing events can be inspected and edited through controlled flows. The Agent should identify the target map and event from project facts or from explicit user selection before proposing changes.

For MZ, map mode exposes Auto plus Layers 1–4 and uses the project's 16, 24, 32, or 48 pixel tile size consistently for painting, hit tests, event coordinates, and thumbnails. Auto mode handles A1–A4 autotiles, lower/upper placement, and autoshadows; a manual layer changes only that layer. Right-click samples a tile or range, and Shift preserves the sampled autotile shape. MZ remains the official four tile layers plus shadow and region planes—no infinite or private map layers are added. The map tree can be reordered while parent cycles are rejected.

Event mode lists the current map's events and searches IDs, names, notes, and command text across maps. MZ event tools include a shared coordinate picker, pure movement-route simulation, project balloon preview, command 109 Skip blocks, and the Acquire quick event. Route preview never executes project scripts and stops at random, script, or unknown plugin steps.

New events are handled as pending content. The Agent can draft the event, register it, and show a preview, but placement stays under user control. The user chooses the target map location on the map editor canvas, then the system writes the placed event and keeps it reviewable.

Assets are used as project facts. The Agent may reference available faces, characters, tilesets, audio, and plugins, but missing assets should be reported clearly rather than invented.

Project management reads all 15 database areas without the former 80-entry cutoff: actors, classes, skills, items, weapons, armors, enemies, troops, states, animations, tilesets, common events, system, types, and terms. The Inspector shows the effective staged value, field differences, and validation errors. MZ particle animations use `effects` resources; MV-compatible animations retain the frame editor. Database and common-event drafts support undo and redo until saved to staging.

The MZ particle editor covers display type, scale, speed, rotation, offsets, bottom alignment, flash timings, and sound timings. Preview creates a system-temporary app that loads only the validated MZ core, Effekseer, the selected effect, and required sound effects; project plugins are not loaded. MV-compatible animations continue to use the frame editor.

For tilesets, the Inspector renders the assigned A1–A5 and B–E images and lets the user paint passage (`○ / × / ☆`), four-direction passage, ladder, bush, counter, damage-floor, and terrain-tag values from 0 through 7. Engine-calculated autotile directions remain read-only, the upper-left B tile is fixed to `☆`, and one drag is recorded as one undo step before the draft is saved to staging.

Agent database edits follow validate, dry-run, and stage steps. Applying an Agent-owned operation requires explicit approval and is blocked when the source or draft has drifted. Unknown plugin fields and notes are preserved, but custom plugin semantics are not validated.

Native pickers install `.js` plugins and category-compatible assets. New plugins start disabled; overwrites preserve configuration; plugin deletion stages the file and configuration together. Asset lists reflect staged additions, renames, and deletions immediately. Renames rewrite every known safe reference or are blocked, and deletion is allowed only for unreferenced assets.

