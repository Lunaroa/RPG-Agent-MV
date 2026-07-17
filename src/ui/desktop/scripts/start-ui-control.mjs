import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const productRoot = path.resolve(desktopRoot, '..', '..', '..');
const viteEntry = path.join(desktopRoot, 'node_modules', 'vite', 'bin', 'vite.js');

const child = spawn(process.execPath, [viteEntry, ...process.argv.slice(2)], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    AGENT_RPG_UI_CONTROL: '1',
    AGENT_RPG_ROOT: process.env.AGENT_RPG_ROOT?.trim() || productRoot,
  },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(`[ui-control] Could not start the background Electron validator: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
