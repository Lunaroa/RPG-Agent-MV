import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveGameBuildRuntimeSource } from './game-build-runtime-source.ts';

test('resolves managed runtime files from the installed product root for bundled workers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-runtime-source-'));
  const previousInstallRoot = process.env.AGENT_RPG_INSTALL_ROOT;
  try {
    const installRoot = path.join(root, 'install');
    const expected = path.join(installRoot, 'src', 'backend', 'src', 'core', 'desktop', 'managed-runtime');
    fs.mkdirSync(expected, { recursive: true });
    process.env.AGENT_RPG_INSTALL_ROOT = installRoot;
    assert.equal(
      resolveGameBuildRuntimeSource(path.join(root, 'missing-adjacent'), 'managed-runtime', path.join(root, 'user-data')),
      expected,
    );
  } finally {
    if (previousInstallRoot === undefined) delete process.env.AGENT_RPG_INSTALL_ROOT;
    else process.env.AGENT_RPG_INSTALL_ROOT = previousInstallRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
