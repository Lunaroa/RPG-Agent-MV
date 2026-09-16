# Packaging And Online Updates

[Back to User Guide](../README.md)

**Package Game** builds saved RPG Maker MV or MZ projects without opening RPG Maker. Build transformations run only in an isolated copy and never replace source assets with compressed, obfuscated, or encrypted output.

This built-in module is disabled by default. Enable **Package Game** in the **Module market** before its navigation entry appears. Disabling the module does not delete presets, key references, build reports, or produced artifacts. Game Version and Package Game can be enabled independently.

Each project can keep named presets for target, architecture, output, full or delta package type, content processing, Android options, and optional upload. A successful build records the exact file manifest, SHA-256 values, internal release ID, processing modes, artifacts, and Git commit when available. A build request blocked during preflight records a failed report with its stage and recovery reason instead of presenting a partial artifact as successful.

## Targets

- **Web** produces a deployable directory and optional ZIP. Updating the hosted site updates browser players.
- **Windows** produces a runnable directory from the project's complete RPG Maker/NW.js export and an optional ZIP. A separately installed, engine- and architecture-matched managed runtime can also be used. The product does not download NW.js distributions with unresolved redistribution terms; when neither source is available, preflight lists the required runtime files and stops. An external updater applies verified content after the game exits and keeps rollback data.
- **Android** uses the managed WebView shell and Gradle toolchain to build real per-ABI APKs for `arm64-v8a`, `armeabi-v7a`, and `x86_64`.

Content categories can be compressed, obfuscated, or encrypted independently. Encryption uses AES-256-GCM and installs a matching runtime loader into the build copy. Because the client must decrypt its own content, the key is ultimately recoverable; this raises the casual extraction barrier but is not DRM.

## Publication And Trust

Local publication creates `releases.json` plus immutable artifacts under `games/<game>/<channel>/<release-id>/`. WebDAV and HTTP PUT adapters upload artifacts first and the index last. The server should support cross-origin static downloads; HTTPS is strongly recommended.

A release can provide localized titles, summaries, and optional maintenance notices, with one explicit default language. Players fall back to that language when their locale is unavailable. Publication is blocked when the default entry is missing or language codes are duplicated.

Every download is checked by byte length and SHA-256. Optional manifest signing creates an ECDSA P-256 identity. The private key remains in operating-system encrypted storage while only the public key is embedded in the game. A missing, changed, or incorrectly signed game manifest is rejected. Without a trusted signature, hashes detect corruption but do not prove developer origin.

Windows updates are applied outside the running game and can roll back after a failed startup health check. Android content updates use verified private version directories and atomic activation. APK updates additionally check application ID, version code, and signing certificate before handing the APK to Android's system installer.

## Cross-platform save boundary

The first release preserves saves across upgrades on the same platform, but it does not hand one physical save file directly between Web, Windows, and Android. Web uses browser-origin storage, Windows uses the local game save directory, and Android WebView uses app-private storage. Their paths, permissions, lifetimes, and cleanup rules differ, so treating them as one live file would create uncontrolled overwrite and data-loss risks.

All three targets still use the same game-save data contract and version fields. A later player-initiated export/import adapter can therefore validate the game, origin version, channel, and content digest before importing. That route does not require accounts or cloud saves, but it needs separate acceptance with real old saves and each platform's plugin set; it does not block the first Web, Windows, and Android packages.

The first Android build installs a pinned, verified toolchain after explicit license acceptance: Microsoft OpenJDK 17, Android command-line tools, Gradle 9.4.1, Android Gradle Plugin 9.2.1, Compile SDK 36, Build Tools 36.0.0, and AndroidX WebKit 1.17.0. Release APKs require a stable JKS identity. Changing the application ID or signing identity creates a new app rather than an in-place update.

The Android icon is an explicit project-relative preset field. A new Android preset auto-selects an image only when the resource-root `icon/` folder contains exactly one PNG, JPEG, or WebP candidate. No candidate or multiple candidates require a deliberate selection; filenames and sort order are never used as a guess.

Before shipping, test on a clean Windows machine, real devices for each Android ABI, and the actual update server, including save compatibility, interrupted downloads, offline startup, update application, and rollback.
