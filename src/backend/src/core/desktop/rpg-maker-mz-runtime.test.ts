import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  createRpgMakerMZRuntimeOutputSanitizer,
  RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
  RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
  resolveRpgMakerMZProjectRuntime,
} from './rpg-maker-mz-runtime.ts';

describe('RPG Maker MZ project-local runtime validation', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-maker-mz-runtime-'));
    fs.mkdirSync(path.join(root, 'locales'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game.rmmzproject'), 'RPGMZ 1.10.0', 'utf8');
    for (const relative of [
      ...RPG_MAKER_MZ_REQUIRED_PROJECT_RUNTIME_FILES,
      ...RPG_MAKER_MZ_REQUIRED_WEB_RUNTIME_FILES,
      'js/rmmz_core.js',
    ]) {
      const file = path.join(root, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const content = relative === 'Game.exe'
        ? Buffer.from([0x4d, 0x5a, 0, 0])
        : relative === 'js/rmmz_core.js'
          ? 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n'
          : 'fixture';
      fs.writeFileSync(file, content);
    }
    fs.writeFileSync(path.join(root, 'locales', 'en-US.pak'), 'fixture', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('accepts a complete MZ 1.10.0 runtime without requiring an editor marker', () => {
    fs.rmSync(path.join(root, 'game.rmmzproject'));
    const runtime = resolveRpgMakerMZProjectRuntime(root);
    assert.equal(runtime.executable, path.join(root, 'Game.exe'));
    assert.equal(runtime.projectRoot, root);
    assert.equal(runtime.engineVersion, '1.10.0');
  });

  test('rejects another core version without exposing the local project path', () => {
    fs.writeFileSync(
      path.join(root, 'js', 'rmmz_core.js'),
      'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.9.0";\n',
      'utf8',
    );
    assert.throws(
      () => resolveRpgMakerMZProjectRuntime(root),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /1\.10\.0/);
        assert.doesNotMatch(message, new RegExp(escapeRegex(root), 'i'));
        return true;
      },
    );
  });

  test('allows another recognizable MZ core version only for an explicit trial launch', () => {
    fs.writeFileSync(
      path.join(root, 'js', 'rmmz_core.js'),
      'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.9.0";\n',
      'utf8',
    );
    const runtime = resolveRpgMakerMZProjectRuntime(root, { allowUnsupportedVersion: true });
    assert.equal(runtime.engineVersion, '1.9.0');
    assert.equal(runtime.executable, path.join(root, 'Game.exe'));
  });

  test('rejects an incomplete project-local NW.js runtime', () => {
    fs.rmSync(path.join(root, 'nw.dll'));
    assert.throws(() => resolveRpgMakerMZProjectRuntime(root), /nw\.dll/);
  });

  test('rejects a runtime missing an MZ core library before launch', () => {
    fs.rmSync(path.join(root, 'js', 'libs', 'effekseer.wasm'));
    assert.throws(() => resolveRpgMakerMZProjectRuntime(root), /effekseer\.wasm/);
  });

  test('rejects a Game.exe that is not a Windows executable', () => {
    fs.writeFileSync(path.join(root, 'Game.exe'), 'not an executable', 'utf8');
    assert.throws(() => resolveRpgMakerMZProjectRuntime(root), /Windows executable/);
  });

  test('redacts the project-local runtime path when it is split across output chunks', () => {
    const executable = path.join(root, 'Game.exe');
    const normalized = executable.replaceAll('\\', '/');
    const splitAt = Math.floor(normalized.length / 2);
    const sanitizer = createRpgMakerMZRuntimeOutputSanitizer(executable);
    const output = [
      sanitizer.push(`runtime=${normalized.slice(0, splitAt)}`),
      sanitizer.push(`${normalized.slice(splitAt)}\n`),
      sanitizer.flush(),
    ].join('');
    assert.doesNotMatch(output, new RegExp(escapeRegex(root), 'i'));
    assert.match(output, /project-local RPG Maker MZ runtime/);
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
