# 5.2 Project Detection Failed

This page explains what to check when the project cannot be detected or project data cannot be read.

## Common Symptoms

- The project list is empty, or the current project name is wrong.
- The console reports that project data failed to load.
- The editor says the current project has no loadable maps.
- The Agent says it cannot read project context.

## Common Causes

- The selected directory is not an RPG Maker MV or supported MZ source project.
- An MZ project does not report a recognizable core version or contains mixed MV files. `game.rmmzproject` is not required for detection.
- The data layouts conflict, or required project data or core files are missing.
- Recognizable older cores and encrypted resources show compatibility warnings instead of being rejected only for those conditions; encrypted asset capabilities may remain limited.
- Project data files are missing or damaged.
- Map files are missing.
- The project has not been saved in its matching RPG Maker editor.
- Directory permissions are insufficient, or files are being used by another program.

## Troubleshooting Steps

1. Open the target project in its matching RPG Maker editor.
2. Confirm that the project contains maps.
3. Save the project. Older MZ cores may continue after confirmation; to use the fully validated baseline, back up the project and run Update Corescripts from RPG Maker MZ 1.10.0.
4. Return to RPG Agent MV and select or refresh the project.
5. In console project management, confirm that maps, events, database files, and audio can be read.

## If It Still Fails

Collect the symptom, project path, matching editor result, and visible error message. Ask the Agent to perform a read-only check, and explicitly say that it must not write changes. The app does not execute project scripts to guess a version and does not replace core scripts automatically.

## Related

- Project setup: [Project Setup](../projects/project.md)

