import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
  RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
} from './rpg-maker-mz-runtime.ts';
import {
  resolveInteractiveProjectRuntime,
  validateSelectedInteractiveProjectRuntime,
} from './interactive-playtest-runtime.ts';

describe('interactive project runtime resolution', () => {
  let root: string;
  let source: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-runtime-'));
    source = path.join(root, 'source');
    fs.mkdirSync(source, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('prefers a complete project-local MV runtime', () => {
    createMVRuntime(source, true);
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv');
    assert.equal(result.runtime?.source, 'project-local');
    assert.equal(result.runtime?.launchStyle, 'embedded');
    assert.equal(result.runtime?.executable, path.join(source, 'game.exe'));
  });

  test('uses a saved MV runtime for a source-only project', () => {
    const configured = path.join(root, 'configured-runtime');
    createMVRuntime(configured, false);
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv', {
      configuredRuntimeRoot: configured,
    });
    assert.equal(result.runtime?.source, 'configured');
    assert.equal(result.runtime?.launchStyle, 'external');
    assert.equal(result.runtime?.privateExecutable, path.join(configured, 'game.exe'));
    assert.equal(result.runtime?.evidenceExecutable, 'configured-rpg-maker-mv-nwjs');
  });

  test('uses a complete saved MZ 1.10.0 runtime for a source-only project', () => {
    const configured = path.join(root, 'configured-runtime');
    createMZRuntime(configured);
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mz', {
      configuredRuntimeRoot: configured,
    });
    assert.equal(result.runtime?.source, 'configured');
    assert.equal(result.runtime?.launchStyle, 'external');
    assert.equal(result.runtime?.evidenceExecutable, 'configured-rpg-maker-mz-nwjs');
  });

  test('allows a complete older MZ runtime to be selected for a trial launch', () => {
    const configured = path.join(root, 'configured-runtime');
    createMZRuntime(configured, '1.9.0');
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mz', {
      configuredRuntimeRoot: configured,
    });
    assert.equal(result.runtime?.source, 'configured');
    assert.equal(result.runtime?.launchStyle, 'external');
    assert.equal(validateSelectedInteractiveProjectRuntime(configured, 'rpg-maker-mz'), true);
  });

  test('requests a new selection when a saved runtime is invalid without exposing its path', () => {
    const configured = path.join(root, 'invalid-private-runtime');
    fs.mkdirSync(configured, { recursive: true });
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv', {
      configuredRuntimeRoot: configured,
    });
    assert.deepEqual(result.selectionRequired, { engine: 'rpg-maker-mv', reason: 'invalid' });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(escapeRegex(configured), 'i'));
  });

  test('accepts only complete matching manual selections', () => {
    const mv = path.join(root, 'mv-runtime');
    const mz = path.join(root, 'mz-runtime');
    createMVRuntime(mv, false);
    createMZRuntime(mz);
    assert.equal(validateSelectedInteractiveProjectRuntime(mv, 'rpg-maker-mv'), true);
    assert.equal(validateSelectedInteractiveProjectRuntime(mv, 'rpg-maker-mz'), false);
    assert.equal(validateSelectedInteractiveProjectRuntime(mz, 'rpg-maker-mz'), true);
    assert.equal(validateSelectedInteractiveProjectRuntime(mz, 'rpg-maker-mv'), false);
  });
});

function createMVRuntime(root: string, includeCore: boolean): void {
  const files = [
    'game.exe', 'nw.dll', 'nw_elf.dll', 'node.dll', 'icudtl.dat', 'resources.pak',
    'libEGL.dll', 'libGLESv2.dll', 'd3dcompiler_47.dll', 'ffmpeg.dll',
    'nw_100_percent.pak', 'nw_200_percent.pak', 'nacl_irt_x86_64.nexe', 'nacl64.exe',
  ];
  for (const relative of files) writeFixture(path.join(root, relative), relative === 'game.exe');
  writeFixture(path.join(root, 'locales', 'en-US.pak'));
  fs.mkdirSync(path.join(root, 'pnacl'), { recursive: true });
  if (includeCore) {
    writeFixture(path.join(root, 'js', 'rpg_core.js'), false, 'Utils.RPGMAKER_NAME = "MV";\nUtils.RPGMAKER_VERSION = "1.6.1";\n');
  }
}

function createMZRuntime(root: string, version = '1.10.0'): void {
  for (const relative of [
    ...RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
    ...RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
  ]) {
    writeFixture(path.join(root, ...relative.split('/')), relative === 'Game.exe');
  }
  writeFixture(
    path.join(root, 'js', 'rmmz_core.js'),
    false,
    `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${version}";\n`,
  );
  writeFixture(path.join(root, 'locales', 'en-US.pak'));
}

function writeFixture(filePath: string, executable = false, text = 'fixture'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, executable ? Buffer.from([0x4d, 0x5a, 0, 0]) : text);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
