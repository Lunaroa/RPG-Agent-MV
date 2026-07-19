# 2.1 Project Setup

This page explains the requirements for connecting an RPG Maker MV or MZ project, the recommended project state, and what to check when switching projects.

## Project Requirements

RPG Agent MV must connect to a complete RPG Maker MV or MZ project directory with readable data and core scripts. The target project should at least:

- Open correctly in its matching RPG Maker editor.
- For MZ, contain a root `data` directory, complete MZ core scripts, and a recognizable core version. `game.rmmzproject` is optional provenance metadata, not an import requirement.
- MZ 1.10.0 is the fully validated baseline. Older cores and encrypted resources require compatibility confirmation; encrypted asset capabilities may remain limited while project data stays editable.
- Contain map data and database data.
- Contain the assets required by the task.
- Be readable from the local path used by RPG Agent MV.

If the project is incomplete or the path cannot be accessed, the Agent should stop and explain the reason instead of fabricating a result.

## Setup Steps

1. Open and save the target in its matching RPG Maker editor. Older MZ cores may continue after a warning; to use the fully validated baseline, back up the project and update its core scripts from RPG Maker MZ 1.10.0.
2. Start RPG Agent MV.
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

After switching projects, confirm the MV/MZ badge beside the project name. If data reading fails, save the project in its matching editor, then return to RPG Agent MV and refresh. Engine detection is automatic and cannot be switched manually.

## MZ Playtest Runtime

Editing depends only on the source project. Normal playtest first validates a project-local runtime. A source-only MZ project asks once for `nwjs-win/nw.exe` from a local MZ installation; a source-only MV project first tries the standard installed `nwjs-win/Game.exe` and asks only when necessary. Paths are stored per engine and used in place without copying the runtime. MZ 1.10.0 remains the fully validated baseline; another recognizable MZ core version may attempt a launch, but a successful run is evidence for that playtest rather than a complete compatibility guarantee. Selection never executes the runner, scans arbitrary game folders, or downloads files. Isolated Battle Test keeps the stricter project-local runtime boundary.

If the local runtime is missing or incomplete, map, event, database, asset, plugin, and staging work remains available. Normal playtest can use the saved selection flow above; isolated workflows that require a project-local runtime still fail before launch with the missing runtime file named explicitly.

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

