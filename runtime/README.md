# Runtime

`runtime/` is local-only runtime state. Release source packages keep this README so the directory exists, but must not include generated contents.

Current runtime outputs:

| Path | Producer | Contents |
|------|----------|----------|
| `sessions/` | desktop Agent session runtime | per-session metadata, event stream, chat log, dispatch outputs |
| `out/` | backend CLI and release tooling | command output, generated reports, release source staging |
| `agent-console-staging/` | staging service | draft writes, snapshots, and staging manifests |
| `agent-console-playtest/` | map playtest service | temporary playtest launch files |
| `secrets/.env` | bootstrap / settings | local provider credentials and runtime secrets |
| `project-registry.json` | project service | local project registration state |
| `screenshots/` | desktop asset preview protocol | generated asset preview images |

Legacy files such as `runtime/rmmv.db*`, `console-settings.json`, `providers/`, `map-selection/`, and `sessions.json` are cleanup targets. Persistent product data belongs under `data/`, not here.
