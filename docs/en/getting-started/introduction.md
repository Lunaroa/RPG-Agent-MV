# 1.1 Introduction

RPG-Agent-MV is a local desktop tool for RPG Maker MV creators. It connects an AI Agent to an existing RMMV project so it can help generate events, batch-edit existing events, and assist with script, plugin, and project-state work.

The product goal is to reduce repetitive event entry, bulk editing, and script investigation work. The creator describes the goal in natural language, while the tool reads project facts and keeps the resulting changes reviewable.

## Core Capabilities

RPG-Agent-MV currently focuses on:

- **Event generation**: generate RMMV event content and event commands from a natural-language request. New events enter a review and placement flow; the user decides their final position on the map.
- **Existing event edits**: batch-edit existing map events, such as dialogue, conditions, switches, variables, or related event logic.
- **Script and plugin assistance**: inspect plugin configuration and project state, then help write or adjust JavaScript or plugin-related logic.
- **Project-state reading**: read maps, events, assets, database entries, plugins, switches, variables, and related context to avoid detached, generic output.

## Interface Areas

The main desktop experience is organized around:

- **Editor**: inspect maps and events, handle placeable events, and review staged changes.
- **Console**: inspect assets, project management, run logs, and settings.
- **Agent panel**: submit natural-language requests, answer ASK confirmations, review event previews, and inspect task output.

## Agent System

Agent behavior is shaped by several mechanisms:

| Mechanism | Role |
|---|---|
| **MCP tools** | Read project facts and perform controlled map/event operations |
| **Skills** | Provide task-specific instructions, workflows, and constraints |
| **Subagents** | Handle separable helper tasks; the current product defaults to a single executor |
| **Rules** | Define standing runtime discipline, including write boundaries, ASK, failure handling, and safety constraints |

## Boundaries

RPG-Agent-MV does not promise to:

- Generate a complete game from scratch.
- Fully replace the RPG Maker MV editor.
- Automatically generate maps, art, or audio by default.
- Decide exact map coordinates for new events.
- Continue with fabricated results when configuration, assets, maps, or context are missing.

Story decisions, map choice, new-event placement, asset choice, and high-risk conflict handling still require user confirmation.

## Next

- Install and start the app: [Installation](installation.md)
- Run a safe first task: [First Task](quickstart.md)
- Fix project loading issues: [Project Detection Failed](../faq/project-detection.md)

