import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { acquireUiControlServerLock, prepareUiControlServerInfo } from './ui-control-server-state.ts';

describe('UI control server ownership', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  test('refuses to overwrite a live background bridge', () => {
    const filePath = temporaryServerInfo({ pid: 42 });
    assert.throws(() => prepareUiControlServerInfo(filePath, () => true), /already running/);
    assert.equal(fs.existsSync(filePath), true);
  });

  test('removes metadata only after proving that its process is dead', () => {
    const filePath = temporaryServerInfo({ pid: 42 });
    prepareUiControlServerInfo(filePath, () => false);
    assert.equal(fs.existsSync(filePath), false);
  });

  test('refuses invalid metadata whose owner cannot be proven dead', () => {
    const filePath = temporaryServerInfo({ invalid: true });
    assert.throws(() => prepareUiControlServerInfo(filePath, () => false), /no valid process ID/);
    assert.equal(fs.existsSync(filePath), true);
  });

  test('allows only one live bridge to own the workspace lock', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-control-lock-'));
    temporaryDirectories.push(directory);
    const lockPath = path.join(directory, 'server.lock');
    const release = acquireUiControlServerLock(lockPath, 42, (pid) => pid === 42);
    assert.throws(() => acquireUiControlServerLock(lockPath, 43, (pid) => pid === 42), /already running/);
    release();
    assert.equal(fs.existsSync(lockPath), false);
  });

  function temporaryServerInfo(value: unknown): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-control-server-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'server.json');
    fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
    return filePath;
  }
});
