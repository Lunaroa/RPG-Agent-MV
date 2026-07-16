# RPG Agent MV User Guide

[简体中文](../README.md) | English

RPG Agent MV is a local AI production tool for RPG Maker MV and RPG Maker MZ 1.10.0 creators. It helps generate event drafts, batch-edit existing events, and assist with script, plugin, and project-state work through natural-language requests.

This guide covers first use, project management, Agent workflows, extension points, and common troubleshooting paths.

The app is not a replacement for the RPG Maker editor. MV and strictly supported MZ projects share project management, map, event, database, asset, plugin, staging, versioning, and playtest flows. Authors must still confirm third-party plugin semantics and final in-game results.

## Contents

### 1. Getting Started

| Page | Contents |
|---|---|
| [Introduction](getting-started/introduction.md) | Product position, main capabilities, and boundaries |
| [Installation](getting-started/installation.md) | Requirements, startup flow, and first checks |
| [Interface Overview](getting-started/interface.md) | Editor, Agent panel, console areas, and review surfaces |
| [First Task](getting-started/quickstart.md) | A safe first event-generation workflow |
| [Settings](getting-started/settings.md) | Model, provider, permission, language, and rule settings |

### 2. Project Management

| Page | Contents |
|---|---|
| [Project Setup](projects/project.md) | Connecting, switching, and preparing an RMMV project |
| [Maps, Events, And Assets](projects/map-events.md) | Map context, event drafts, placement, and asset inspection |
| [Staging, Apply, And Revert](projects/staging.md) | Staging changes, applying safely, discarding, and review |

### 3. Agent Workflow

| Page | Contents |
|---|---|
| [Requests And Confirmation](agent-workflow/request.md) | Writing requests, stating constraints, and answering ASK cards |
| [From Generation To Landing](agent-workflow/generate.md) | Event registration, preview, manual placement, and controlled edits |
| [Sessions And Logs](agent-workflow/sessions.md) | Continuing sessions, reading logs, and diagnosing failed runs |
| [Dynamic Workflow](agent-workflow/dynamic-workflow.md) | Proposing, approving, executing, and reporting dynamic workflows |

### 4. Agent System

| Page | Contents |
|---|---|
| [MCP Tools](agent-system/mcp-tools.md) | Tool responsibilities and extension boundaries |
| [Skills](agent-system/skill.md) | Skill structure, loading rules, and maintenance |
| [Subagents](agent-system/subagent.md) | Subtask execution and default executor behavior |
| [Rules](agent-system/rules.md) | Product rules, personal preferences, and game-level rules |

### 5. FAQ

| Page | Contents |
|---|---|
| [FAQ](faq/questions.md) | Common questions and practical answers |
| [Project Detection Failed](faq/project-detection.md) | What to check when the project cannot be read |
| [Model And Runtime Checks](faq/model-check.md) | What to check when the model or runtime fails |
| [MZ 1.10.0 Official Compatibility Evidence](faq/mz-official-evidence.md) | Official requirements, implementation areas, and focused tests |

## Quick Links

- New user entry: [Introduction](getting-started/introduction.md)
- First task: [First Task](getting-started/quickstart.md)
- Project setup: [Project Setup](projects/project.md)
- Request confirmation: [Requests And Confirmation](agent-workflow/request.md)
- Extension and rules: [MCP Tools](agent-system/mcp-tools.md)
- Project detection failures: [Project Detection Failed](faq/project-detection.md)
- Model failures: [Model And Runtime Checks](faq/model-check.md)
- MZ compatibility evidence: [MZ 1.10.0 Official Compatibility Evidence](faq/mz-official-evidence.md)

## Version

- Documentation version: v0.4.0-en
- Last updated: 2026-07-16
- Applies to: RPG Agent MV v0.4.0
