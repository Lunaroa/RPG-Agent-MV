# 1.2 Installation

This page explains the requirements, startup path, and first checks for RPG Agent MV.

## Requirements

Before using RPG Agent MV, prepare:

- A real RPG Maker MV project that opens correctly in RPG Maker MV.
- A working model provider, API key, and default model.
- A local project path that RPG Agent MV can read.
- A Git worktree for the RMMV project is recommended, so changes can be reviewed and organized.

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
| Project is not shown | Confirm that RPG Maker MV can open the project, save it in RMMV, then reload it in RPG Agent MV |
| Model is unavailable | Check provider, API key, Base URL, and default model; see [Model And Runtime Checks](../faq/model-check.md) |
| Map cannot open | Check map files, tilesets, and local assets |
| App repeatedly crashes | Close the app, confirm backend processes have exited, then restart |

## Next

After startup works, continue with [First Task](quickstart.md).

