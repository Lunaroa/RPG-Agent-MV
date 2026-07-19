import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  inspectSelectedInteractiveProjectRuntime,
  RPG_MAKER_MZ_REQUIRED_OFFICIAL_RUNTIME_FILES,
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
    const configured = createMVOfficialTestRuntime(path.join(root, 'mv-install'));
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv', {
      configuredRuntimeRoot: configured,
    });
    assert.equal(result.runtime?.source, 'configured');
    assert.equal(result.runtime?.launchStyle, 'external');
    assert.equal(result.runtime?.privateExecutable, configured);
    assert.equal(result.runtime?.evidenceExecutable, 'configured-rpg-maker-mv-nwjs');
  });

  test('uses a complete saved MZ 1.10.0 runtime for a source-only project', () => {
    const configured = createMZOfficialRuntime(path.join(root, 'mz-install'));
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mz', {
      configuredRuntimeRoot: configured,
    });
    assert.equal(result.runtime?.source, 'configured');
    assert.equal(result.runtime?.launchStyle, 'external');
    assert.equal(result.runtime?.evidenceExecutable, 'configured-rpg-maker-mz-nwjs');
  });

  test('uses an official MZ nw.exe selected from nwjs-win without requiring a deployed game', () => {
    const install = path.join(root, 'mz-install');
    const executable = createMZOfficialRuntime(install, '1.8.0');
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mz', {
      configuredRuntimeRoot: executable,
    });
    assert.equal(result.runtime?.source, 'configured');
    assert.equal(result.runtime?.launchStyle, 'external');
    assert.equal(result.runtime?.privateExecutable, executable);
    assert.equal(result.runtime?.runtimeRoot, path.dirname(executable));
    assert.equal(validateSelectedInteractiveProjectRuntime(executable, 'rpg-maker-mz'), true);
  });

  test('rejects the legacy saved-directory form for an official MZ nwjs-win runtime', () => {
    const install = path.join(root, 'mz-install');
    const executable = createMZOfficialRuntime(install);
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mz', {
      configuredRuntimeRoot: path.dirname(executable),
    });
    assert.deepEqual(result.selectionRequired, { engine: 'rpg-maker-mz', reason: 'invalid' });
    assert.deepEqual(
      inspectSelectedInteractiveProjectRuntime(path.dirname(executable), 'rpg-maker-mz'),
      { valid: false, reason: 'legacy-location' },
    );
  });

  test('skips the MV deployment runtime and uses the official nwjs-win-test runtime', () => {
    const install = path.join(root, 'mv-install');
    const deploymentExecutable = createMVOfficialRuntime(install);
    const executable = createMVOfficialTestRuntime(install);
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv', {
      officialRuntimeRoots: [deploymentExecutable, executable],
    });
    assert.equal(result.runtime?.source, 'official-install');
    assert.equal(result.runtime?.privateExecutable, executable);
    assert.equal(validateSelectedInteractiveProjectRuntime(executable, 'rpg-maker-mv'), true);
    assert.deepEqual(
      inspectSelectedInteractiveProjectRuntime(deploymentExecutable, 'rpg-maker-mv'),
      { valid: false, reason: 'deployment-runtime' },
    );
  });

  test('does not launch a source-only MV project when only the deployment runtime exists', () => {
    const deploymentExecutable = createMVOfficialRuntime(path.join(root, 'mv-install'));
    const result = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv', {
      officialRuntimeRoots: [deploymentExecutable],
    });
    assert.deepEqual(result.selectionRequired, { engine: 'rpg-maker-mv', reason: 'missing' });

    const configured = resolveInteractiveProjectRuntime(source, 'rpg-maker-mv', {
      configuredRuntimeRoot: deploymentExecutable,
    });
    assert.deepEqual(configured.selectionRequired, { engine: 'rpg-maker-mv', reason: 'invalid' });
  });

  test('rejects an MV test runner when an adjacent deployment manifest can take over the entry point', () => {
    const executable = createMVOfficialTestRuntime(path.join(root, 'mv-install'));
    writeFixture(path.join(path.dirname(executable), 'package.json'), false, '{"main":"www/index.html"}');
    assert.deepEqual(
      inspectSelectedInteractiveProjectRuntime(executable, 'rpg-maker-mv'),
      { valid: false, reason: 'deployment-runtime' },
    );
  });

  test('rejects legacy MV directory settings instead of migrating them', () => {
    const executable = createMVOfficialTestRuntime(path.join(root, 'mv-install'));
    assert.deepEqual(
      inspectSelectedInteractiveProjectRuntime(path.dirname(executable), 'rpg-maker-mv'),
      { valid: false, reason: 'legacy-location' },
    );
  });

  test('allows a complete older MZ runtime to be selected for a trial launch', () => {
    const configured = createMZOfficialRuntime(path.join(root, 'mz-install'), '1.9.0');
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
    const mv = createMVOfficialTestRuntime(path.join(root, 'mv-install'));
    const mz = createMZOfficialRuntime(path.join(root, 'mz-install'));
    assert.equal(validateSelectedInteractiveProjectRuntime(mv, 'rpg-maker-mv'), true);
    assert.equal(validateSelectedInteractiveProjectRuntime(mv, 'rpg-maker-mz'), false);
    assert.equal(validateSelectedInteractiveProjectRuntime(mz, 'rpg-maker-mz'), true);
    assert.equal(validateSelectedInteractiveProjectRuntime(mz, 'rpg-maker-mv'), false);
  });

  test('reports safe engine-specific validation reasons for invalid executable selections', () => {
    const otherExecutable = path.join(root, 'other.exe');
    writeFixture(otherExecutable, true);
    assert.deepEqual(
      inspectSelectedInteractiveProjectRuntime(otherExecutable, 'rpg-maker-mz'),
      { valid: false, reason: 'wrong-file' },
    );
    assert.deepEqual(
      inspectSelectedInteractiveProjectRuntime(otherExecutable, 'rpg-maker-mv'),
      { valid: false, reason: 'wrong-file' },
    );
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

function createMZOfficialRuntime(installRoot: string, version = '1.10.0'): string {
  const runtimeRoot = path.join(installRoot, 'nwjs-win');
  for (const relative of RPG_MAKER_MZ_REQUIRED_OFFICIAL_RUNTIME_FILES) {
    writeFixture(path.join(runtimeRoot, ...relative.split('/')), relative === 'nw.exe');
  }
  writeFixture(path.join(runtimeRoot, 'locales', 'en-US.pak'));
  writeFixture(path.join(installRoot, 'RPGMZ.exe'), true);
  writeFixture(
    path.join(installRoot, 'newdata', 'js', 'rmmz_core.js'),
    false,
    `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${version}";\n`,
  );
  return path.join(runtimeRoot, 'nw.exe');
}

function createMVOfficialRuntime(installRoot: string): string {
  const runtimeRoot = path.join(installRoot, 'nwjs-win');
  createMVRuntime(runtimeRoot, false);
  fs.rmSync(path.join(runtimeRoot, 'pnacl'), { recursive: true, force: true });
  fs.rmSync(path.join(runtimeRoot, 'nacl_irt_x86_64.nexe'), { force: true });
  fs.rmSync(path.join(runtimeRoot, 'nacl64.exe'), { force: true });
  writeFixture(path.join(installRoot, 'RPGMV.exe'), true);
  writeFixture(
    path.join(installRoot, 'newdata', 'js', 'rpg_core.js'),
    false,
    'Utils.RPGMAKER_NAME = "MV";\nUtils.RPGMAKER_VERSION = "1.6.1";\n',
  );
  return path.join(runtimeRoot, 'game.exe');
}

function createMVOfficialTestRuntime(installRoot: string): string {
  const runtimeRoot = path.join(installRoot, 'nwjs-win-test');
  createMVRuntime(runtimeRoot, false);
  writeFixture(path.join(installRoot, 'RPGMV.exe'), true);
  writeFixture(
    path.join(installRoot, 'newdata', 'js', 'rpg_core.js'),
    false,
    'Utils.RPGMAKER_NAME = "MV";\nUtils.RPGMAKER_VERSION = "1.6.1";\n',
  );
  return path.join(runtimeRoot, 'game.exe');
}

function writeFixture(filePath: string, executable = false, text = 'fixture'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, executable ? Buffer.from([0x4d, 0x5a, 0, 0]) : text);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
