export function printHelp() {
  console.log(`RPG-Agent-MV-MV maintenance command line tools

Usage:
  npm --prefix src/backend run cli -- <command> [options]

Desktop:
  npm --prefix src/ui/desktop run dev

RMMV business tools:
  RMMV project operations are exposed only through the rmmv MCP server injected into opencode sessions.
  This backend entrypoint intentionally does not expose scan, event, patch, map, story, or inventory commands.
  Runtime commands below prepare auditable playtest/deploy artifacts. playtest-plan is dry-run only; playtest-run starts a runner; playtest-probe starts a runner and requires screen/start-map/save-isolation/idle evidence.

Dev tools:
  npm run playtest:plan -- --project <path> [--map-id 1] [--nwjs <path>] [--timeout-ms 15000] [--format json]          # dry-run plan; no runner starts
  npm run playtest:run -- --project <path> [--map-id 1] [--nwjs <path>] [--timeout-ms 15000] [--format json]           # starts runner; logs process evidence only
  npm run playtest:probe -- --project <path> [--map-id 1] [--nwjs <path>] [--timeout-ms 15000] [--probe-keywords "keyword1,keyword2"] [--format json]
  npm --prefix src/backend run cli -- playtest-plan --project <path> [--map-id 1] [--nwjs <path>] [--timeout-ms 15000] [--probe] [--probe-keywords "keyword1,keyword2"] [--apply] [--format json]
  npm --prefix src/backend run cli -- deploy-source --project <path> [--target web|windows] [--format json]
  npm run release:electron  # packages current desktop build as Windows win-unpacked under runtime/out/release/electron
  npm --prefix src/backend run cli -- release-check [--format json]  # source + Web dist + Electron package proof
  npm --prefix src/backend run cli -- release-source [--apply] [--format json]  # source tree only; does not package Electron/Web artifacts
  npm --prefix src/backend run cli -- ui-control --command capture-current [--label current] [--format json]
  npm --prefix src/backend run cli -- ui-control --command navigate --target console-settings [--format json]
  npm --prefix src/backend run cli -- ui-control --command open-event-editor --map-id 1 --event-id 3 [--format json]
  npm --prefix src/backend run cli -- ui-control --command state [--format json]
  npm --prefix src/backend run cli -- ui-control --command read --test-id chat-input [--format json]
  npm --prefix src/backend run cli -- ui-control --command wait --test-id chat-input [--condition visible] [--format json]
  npm --prefix src/backend run cli -- ui-control --command input --test-id chat-input --text "测试消息" [--format json]
  npm --prefix src/backend run cli -- ui-control --command key --test-id chat-input --key Enter [--format json]
  npm --prefix src/backend run cli -- ui-control --command click --test-id chat-send [--format json]
  npm --prefix src/backend run cli -- workspace-prune-legacy [--dry-run]
`);
}

