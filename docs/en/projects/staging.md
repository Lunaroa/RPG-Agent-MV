# Staging, Apply, And Revert

[Back to User Guide](../README.md)

RPG-Agent-MV keeps generated changes reviewable before they are written back to the game project.

Staged changes represent draft edits produced by the desktop app or the Agent. Review them before applying. If the change is wrong, discard it instead of editing the staged files by hand.

Applying writes the staged change into the selected RPG Maker MV project. For project-level changes, confirm that the target project and affected files are correct.

Discarding removes the staged draft and leaves the source project unchanged.

When version management is available, create or confirm a clean baseline before broad edits. Do not use a full test run as a substitute for reviewing the actual project diff.

