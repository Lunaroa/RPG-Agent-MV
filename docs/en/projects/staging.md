# Staging, Apply, And Revert

[Back to User Guide](../README.md)

RPG Agent MV keeps generated changes reviewable before they are written back to the game project. Saving a draft to staging does not mutate the source project.

Staged changes represent draft edits produced by the desktop app or the Agent. Database operations also bind ownership, session, plan hash, affected files, and source hashes. Review field differences and validation errors before applying. Do not edit staged files by hand.

Applying writes the staged change into the selected RPG Maker MV or supported MZ project. Agent database operations require approval bound to the current session and operation. Desktop Apply All lists included Agent operations and runs the same preflight. Multi-file changes are all-or-nothing.

Discarding removes the staged draft and leaves the source project unchanged. Database and common-event Inspector actions can also revert only the current staged entry without removing unrelated edits in the same file.

Source drift, draft drift, or ownership conflicts block apply. RPG Agent MV does not automatically merge or repair these conflicts.

The global **Play** action runs only the source project from the configured `System.json` start location and excludes staging. It checks the project-local runtime first, then a saved runtime or validated official install location. If none is available, it asks once for a complete Windows runtime for the same engine. MZ 1.10.0 remains the fully validated baseline; another recognizable MZ version is only allowed to attempt a normal playtest launch. It does not scan arbitrary game folders or download a runner. The game may write to `save/`. When staging exists, its summary must be confirmed again whenever it changes.

Agent verification instead uses an isolated system-temporary copy, excludes saves and the MZ runtime, overlays all current staging, and launches that temporary app with the validated `Game.exe` that remains in the source project. It returns verified only when its screenshot, map, coordinate, ready, idle, JavaScript-error, source-integrity, save-integrity, and cleanup evidence all pass. Interactive playtest cards prove process lifecycle only, not story or playability quality.

When version management is available, create or confirm a clean baseline before broad edits. Do not use a full test run as a substitute for reviewing the actual project diff.

