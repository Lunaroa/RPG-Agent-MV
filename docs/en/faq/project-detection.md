# 5.2 Project Detection Failed

This page explains what to check when the project cannot be detected or project data cannot be read.

## Common Symptoms

- The project list is empty, or the current project name is wrong.
- The console reports that project data failed to load.
- The editor says the current project has no loadable maps.
- The Agent says it cannot read project context.

## Common Causes

- The selected directory is not an RPG Maker MV project.
- Project data files are missing or damaged.
- Map files are missing.
- The project has not been saved in RPG Maker MV.
- Directory permissions are insufficient, or files are being used by another program.

## Troubleshooting Steps

1. Open the target project in RPG Maker MV.
2. Confirm that the project contains maps.
3. Save the project in RPG Maker MV.
4. Return to RPG Agent MV and select or refresh the project.
5. In console project management, confirm that maps, events, database files, and audio can be read.

## If It Still Fails

Collect the symptom, project path, RPG Maker MV result, and visible error message. Ask the Agent to perform a read-only check, and explicitly say that it must not write changes.

## Related

- Project setup: [Project Setup](../projects/project.md)

