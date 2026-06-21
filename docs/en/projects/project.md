# 2.1 Project Setup

This page explains the requirements for connecting an RMMV project, the recommended project state, and what to check when switching projects.

## Project Requirements

RPG-Agent-MV must connect to a real, complete RPG Maker MV project. The target project should at least:

- Open correctly in RPG Maker MV.
- Contain map data and database data.
- Contain the assets required by the task.
- Be readable from the local path used by RPG-Agent-MV.

If the project is incomplete or the path cannot be accessed, the Agent should stop and explain the reason instead of fabricating a result.

## Setup Steps

1. Open the target project in RPG Maker MV and save it.
2. Start RPG-Agent-MV.
3. Confirm the current project in the console.
4. Open the map tree in the editor.
5. Select a map and confirm the canvas displays correctly.
6. Start Agent tasks only after the project state looks correct.

If the project cannot be loaded, see [Project Detection Failed](../faq/project-detection.md).

## Recommended Project State

These project habits help the Agent read context correctly:

- Clear map names.
- Named key switches and variables.
- Stable names for characters, places, and quest lines.
- No large set of unreviewed changes.
- The project is in a Git worktree.

Stable naming makes it easier for the Agent to identify target objects and context.

## Switching Projects

After switching projects in the console, confirm that the current project name matches the target project. If data reading fails after a switch, save the project in RPG Maker MV, then return to RPG-Agent-MV and refresh.

## Game-Level Rules

If a project needs long-lived instructions, such as world tone, naming tables, or story areas that must not be changed, place an `AGENTS.md` file in the game project directory. The Agent treats it as supplemental rules for that project.

## Controlled Editing And Version Management

Map and event editing are available by default; version management does not need to be enabled first. Edits enter staging and can be reviewed before being kept.

Version management is an optional enhancement on the console home page. When enabled, it records event identity, syncs story-page fingerprints, and saves local version snapshots. It does not require a remote repository or online sync.

To enable it:

1. Open **Console** from the left navigation.
2. Click **Enable Version Management**. The app first saves a snapshot; if that fails, version management is not enabled.
3. Optionally enter a version note, such as "initial draft".
4. If you do not want a snapshot yet, choose the edit-only option when available.

Before modifying maps or events, the Agent should read project facts. After writing, the user can review staged changes and run logs; with version management enabled, the user can also save named local versions.

