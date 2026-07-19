# 1.2 Installation

This page explains the requirements, startup path, and first checks for RPG Agent MV.

## Requirements

Before using RPG Agent MV, prepare:

- A complete RPG Maker MV or MZ project directory with readable project data and core scripts. MZ 1.10.0 is the fully validated baseline; older cores and encrypted resources show compatibility warnings, and encrypted asset capabilities may remain limited.
- A working model provider, API key, and default model.
- A local project path that RPG Agent MV can read.
- A Git worktree for the RMMV project is recommended, so changes can be reviewed and organized.
- Editing needs only an MV/MZ source project. The top-bar Play action prefers a project-local runtime, then a saved runtime or validated official install location. If none is available, the desktop app asks once for a complete Windows runtime folder for the same engine and remembers it. It never scans arbitrary game folders or downloads a runner.

## Get And Start

RPG Agent MV is a local desktop app. When using an installer or packaged build, follow the release notes for that exact version. Do not use unknown installers or archives, and do not submit API keys or local credentials on unofficial pages.

Running from source requires Node.js 22.5 or later.

Install dependencies from the product root:

```powershell
cd RPG-Agent-MV
npm run install:deps
```

Dependency installation does not build the local Agent runtime. If you want to use the local Agent directly from source, or build an installer on the current machine, explicitly build the runtime tool once:

```powershell
npm run build:opencode-runtime
```

Public installers include the required runtime tools, so ordinary users do not need to build them manually.

Start the desktop app from the product root:

```powershell
npm --prefix src/ui/desktop run dev
```

## In-App Updates

The signed **NSIS installed build** checks only GitHub Releases ([Lunaroa/RPG-Agent-MV](https://github.com/Lunaroa/RPG-Agent-MV)). It does not use a fallback mirror or custom update URL.

When an update is available, the app prompts before downloading and again before restarting. The updater attempts a blockmap differential download and uses the full installer when a differential update is unavailable. Source/`npm run dev` mode does not check for updates. You can also use **Settings → Interface → Check for updates**.

The installed build must contain trusted publisher information. Unsigned builds, missing update configuration, and unexpected repositories are rejected without an insecure fallback.

### Maintainer release

1. Set the same `version` in the product root and desktop/backend packages.
2. Configure a Windows code-signing certificate and `GH_TOKEN` or `GITHUB_TOKEN`.
3. Ensure the Git worktree is clean, then publish:

```powershell
cd RPG-Agent-MV
npm run release:electron:publish
```

The command checks the worktree, versions, and token before it builds a signed installer and runs the release boundary check. Any failure stops publication. Verify that the GitHub Release contains `latest.yml`, the installer `.exe`, and the matching `.blockmap`.

## First Checks After Startup

After the first startup, check these in order:

1. The left navigation can open the editor and console.
2. The console shows the current project.
3. The editor can load at least one map.
4. Settings contain a usable model.
5. The Agent panel can send a simple request.

If any item fails, fix the environment or project setup before running complex event tasks.

## Common Startup Problems

| Symptom | What to check |
|---|---|
| Project is not shown | Confirm the directory contains readable `data/System.json`, `MapInfos.json`, map files, and matching core scripts; an editor project marker is not required |
| MV/MZ source project cannot start | Select a complete Windows runtime folder for the same engine containing `Game.exe` and the full NW.js payload. MZ 1.10.0 is the fully validated baseline; another recognizable MZ version may attempt a launch without receiving a complete compatibility guarantee. The selection is stored locally; the app does not scan private game folders or download a runner |
| Model is unavailable | Check provider, API key, Base URL, and default model; see [Model And Runtime Checks](../faq/model-check.md) |
| Map cannot open | Check map files, tilesets, and local assets |
| App repeatedly crashes | Close the app, confirm backend processes have exited, then restart |

## Next

After startup works, continue with [First Task](quickstart.md).

