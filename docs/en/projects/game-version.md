# Game Version And Save Compatibility

[Back to User Guide](../README.md)

**Game Version** is the player-facing release version. It is independent from Git **Version Management**, is stored in the game's `RPGAgentRelease.json`, and is consumed by managed runtime plugins.

This built-in module is disabled by default. Enable **Game Version** in the **Module market** before its navigation entry appears. Disabling the module hides the product entry without deleting existing release configuration or managed runtime plugins from the game project.

Versions use `a.b.c` or `a.b.c-suffix`, such as `1.0.0` and `1.2.3-beta.2`. Update ordering compares the three decimal components with arbitrary precision. The suffix is display or channel metadata and does not affect ordering. Each repeated build receives a new internal release ID, so a same-version repair can replace a broken package without rewriting history.

Startup checks can download a compatible Windows update in the background and ask before installation after verification. Automatic checks only offer a numerically newer version; reinstalling or repairing a different build of the same numeric version requires a manual update check.

## JavaScript API

```js
const version = globalThis.RPGAgentVersion.getVersion();
const parts = globalThis.RPGAgentVersion.getParts();
const compared = globalThis.RPGAgentVersion.compare('1.2.0'); // -1, 0, or 1
const compatible = globalThis.RPGAgentVersion.isAtLeast('1.1.0');
const saveOrigin = globalThis.RPGAgentVersion.getSaveOriginVersion();
const saveChannel = globalThis.RPGAgentVersion.getSaveOriginChannel();
```

MZ exposes `GetCurrentVersion`, `GetSaveOriginVersion`, `CompareVersion`, `IsAtLeast`, and `CheckForUpdates` through its plugin-command UI. MV uses text commands:

```text
RPGAgentVersion GetCurrentVersion 1
RPGAgentVersion GetSaveOriginVersion 2
RPGAgentVersion CompareVersion 1.2.3 3
RPGAgentVersion IsAtLeast 1.2.3 4
RPGAgentVersion CheckForUpdates
```

## Save Origin And Migration

New saves record their original game version and channel in both full save contents and save-list metadata. Re-saving after an upgrade keeps that original value. Legacy, older, same-version, newer, and cross-channel saves can each be allowed, warned, blocked, or sent to a developer callback.

```js
const unregister = globalThis.RPGAgentVersion.registerSaveMigration((context) => {
  if (context.originVersion === '1.0.0' && context.currentVersion === '1.1.0') {
    context.contents.system ??= {};
    context.contents.system.releaseMigration = '1.1.0';
  }
  return true;
});
```

Migration callbacks must finish synchronously. Returning `false` or throwing blocks the load. Test migrations against copies of real old saves; the runtime does not infer game-specific data transformations.
