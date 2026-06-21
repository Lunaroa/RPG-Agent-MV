# 5.3 Model And Runtime Checks

This page explains what to check when the model is unavailable, a run fails, or local state conflicts with the current task.

## Check Model And Provider

Settings should contain a configured provider and default model. A provider needs at least:

- Name or ID.
- Correct Base URL.
- Valid API key.
- Usable default model.
- Saved and synced runtime configuration.

## Run A Check

If Settings provides a runtime check, run it before continuing. When the check fails, do not continue with a complex task.

Common failure causes include:

- No usable model.
- Invalid API key.
- Incorrect Base URL.
- The current runtime entry is blocked by configuration.
- The model does not support a capability required by the task.

## Fix Order

1. Configure the provider.
2. Fetch the model list.
3. Select a default model.
4. Save and sync settings.
5. Confirm the model works with a simple task.

## Environment And Local-State Conflicts

Some failures are not model failures. They may come from local state:

- Environment variables point to the wrong project.
- Provider configuration was not saved or synced to the executor.
- RPG Maker MV is occupying or rewriting project files.
- The current worktree contains unreviewed changes.

Recommended order: confirm the current project path, confirm provider and model configuration, save the project in RPG Maker MV, check Git status or editor staging, then ask the Agent to read project facts again.

Do not continue by adding temporary compatibility paths, copying the project, or bypassing configuration errors. If a path or configuration is unclear, confirm it first.

## Related

- Installation and startup: [Installation](../getting-started/installation.md)

