// Forwards electron / electron-builder mirror URLs as environment variables
// to a child npm or build command. Keeps the mirrors centralized here so the
// per-package .npmrc files only need `registry=` (custom .npmrc keys warn on
// modern npm).
import { spawnSync } from 'node:child_process';

const DEFAULT_MIRRORS = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

for (const [name, value] of Object.entries(DEFAULT_MIRRORS)) {
  if (!process.env[name]) process.env[name] = value;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('with-electron-mirrors: missing command');
  process.exit(64);
}

// Pass through as a single shell-quoted string so node does not emit DEP0190
// (which fires only when `args` is supplied alongside `shell: true`).
const commandLine = args
  .map((token) => (/^[\w@./:=+-]+$/.test(token) ? token : JSON.stringify(token)))
  .join(' ');

const result = spawnSync(commandLine, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);