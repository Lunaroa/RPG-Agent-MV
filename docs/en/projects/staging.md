# Direct Save, Review, And Recovery

[Back to User Guide](../README.md)

RPG Agent MV now uses direct save. Once an edit is confirmed, map, event, database, plugin, and asset changes are written directly to the selected game project. There is no separate project staging area and no Apply All step.

## Save Behavior

- A single-file edit uses atomic replacement so a partial JSON document is not left in the project.
- A multi-file operation either writes every file or writes none of them.
- The app checks the disk version before saving. If RPG Maker or another program changed the file, saving stops and asks for a reload instead of guessing how to merge.
- Inspector undo and redo cover only the current unsaved edit session. After saving, use Git version management or your own project backup for recovery.

Do not edit the same data file in RPG Maker and RPG Agent MV at the same time. If an external-change warning appears, reload project facts before recreating the edit.

## Review

Direct save does not remove the review step. After a task, check the Agent's change summary and blockers, inspect the actual map or database result, review the Git diff, and run the relevant playtest. Mechanical checks do not replace human review of story, presentation, plugin behavior, or playability.

The existing **Version Management** feature tracks Git project history. **Game Version** tracks the player-facing release version. They are independent systems.

## Playtest And Isolated Verification

The global **Play** action launches the saved source project, so saved edits are visible immediately. The game may write to its own `save/` directory.

Agent verification creates a system-temporary copy from the saved source and excludes player saves. It runs bounded structural and runtime probes, then checks that the source project and save data were not changed by the probe. A passed probe is not human acceptance of the final game.

## Recovery

1. Before saving, use the editor's undo or redo controls.
2. After saving with Git version management enabled, inspect the diff, preserve the current state if needed, and restore only the intended files from a known version.
3. Without version history, restore from your own project backup or make an explicit reverse edit.
4. On an external-edit conflict, reload first. Repeated save attempts do not merge the files.
