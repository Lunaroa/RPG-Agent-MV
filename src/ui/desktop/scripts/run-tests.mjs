import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const roots = ['electron', 'scripts', 'src'];
const testFiles = roots.flatMap((root) => collectTests(path.resolve(root))).sort();
const vitestFiles = testFiles.filter((file) => /from\s+['"]vitest['"]/.test(readFileSync(file, 'utf8')));
const nodeTestFiles = testFiles.filter((file) => !vitestFiles.includes(file));
const requestedGroup = process.argv[2] || 'all';

if (!nodeTestFiles.length || !vitestFiles.length) {
  throw new Error('Expected both node:test and Vitest desktop test groups.');
}
if (!['all', 'node', 'vitest'].includes(requestedGroup)) {
  throw new Error(`Unknown desktop test group: ${requestedGroup}`);
}

if (requestedGroup !== 'vitest') {
  run(process.execPath, ['--import', 'tsx', '--test', ...nodeTestFiles], {
    TSX_TSCONFIG_PATH: path.resolve('tsconfig.app.json'),
  });
}
if (requestedGroup !== 'node') {
  run(process.execPath, [path.resolve('node_modules', 'vitest', 'vitest.mjs'), 'run', ...vitestFiles]);
}

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(fullPath);
    return /\.test\.[cm]?[jt]s$/.test(entry.name) ? [fullPath] : [];
  });
}

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
