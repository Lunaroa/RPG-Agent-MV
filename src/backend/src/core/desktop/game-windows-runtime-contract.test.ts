import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  inspectWindowsExecutableArchitecture,
  isWindowsPlatformRuntimePath,
} from './game-windows-runtime-contract.ts';

test('reads supported PE machine architectures and rejects malformed executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-pe-'));
  try {
    for (const [name, machine, expected] of [
      ['x86.exe', 0x014c, 'x86'],
      ['x64.exe', 0x8664, 'x64'],
      ['arm64.exe', 0xaa64, 'arm64'],
    ] as const) {
      const file = path.join(root, name);
      fs.writeFileSync(file, peFixture(machine));
      assert.equal(inspectWindowsExecutableArchitecture(file), expected);
    }
    const invalid = path.join(root, 'invalid.exe');
    fs.writeFileSync(invalid, 'not a PE file', 'utf8');
    assert.throws(() => inspectWindowsExecutableArchitecture(invalid), /invalid DOS header/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps Windows platform runtime and updater launcher out of content updates', () => {
  assert.equal(isWindowsPlatformRuntimePath('Game.exe'), true);
  assert.equal(isWindowsPlatformRuntimePath('locales/en-US.pak'), true);
  assert.equal(isWindowsPlatformRuntimePath('.rpg-agent/updater/updater.cjs'), true);
  assert.equal(isWindowsPlatformRuntimePath('js/plugins/RPGAgentUpdater.js'), false);
  assert.equal(isWindowsPlatformRuntimePath('data/Map001.json'), false);
});

function peFixture(machine: number): Buffer {
  const value = Buffer.alloc(256);
  value.writeUInt16LE(0x5a4d, 0);
  value.writeUInt32LE(0x80, 0x3c);
  value.writeUInt32LE(0x00004550, 0x80);
  value.writeUInt16LE(machine, 0x84);
  return value;
}
