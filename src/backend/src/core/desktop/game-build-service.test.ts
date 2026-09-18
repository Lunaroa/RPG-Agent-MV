import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { GameBuildPreset, GameReleaseConfig } from '../../../../contract/game-release.ts';
import { defaultProcessing } from './game-build-preset.ts';
import {
  buildGame,
  listAndroidIconCandidates,
  preflightGameBuild,
  readGameBuildReport,
  saveGameBuildSettings,
  startGameBuildWorker,
} from './game-build-service.ts';

test('Android build preflight blocks missing MV mobile audio without blocking Web output', async () => {
  await withProject(async ({ workflowRoot, project, release, preset }) => {
    write(project, 'audio/se/Sample.ogg', 'audio fixture');
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const web = preflightGameBuild(workflowRoot, project, { presetId: preset.id, releaseConfig: release });
    assert.equal(web.ok, true, web.blockers.join('\n'));
    const android: GameBuildPreset = { ...preset, target: 'android', architecture: 'per-abi', android: {
      applicationId: 'org.example.sample', displayName: 'Sample', versionCode: 1, orientation: 'landscape',
      minSdk: 24, targetSdk: 36, abis: ['arm64-v8a'], iconRelativePath: 'icon.png', signing: 'debug',
    } };
    saveGameBuildSettings(project, { presets: [android], selectedPresetId: android.id });
    const result = preflightGameBuild(workflowRoot, project, { presetId: android.id, releaseConfig: release });
    assert.ok(result.blockers.some(item => item.includes('audio/se/Sample.m4a')));
    assert.equal(fs.existsSync(path.join(project, 'audio/se/Sample.m4a')), false);
  });
});

test('release audit: plugin target metadata is advisory and disabled plugins do not block builds', async () => {
  await withProject(async ({ workflowRoot, project, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    write(project, 'js/plugins/SampleDualEngine.js', '/*:\n * @target MZ\n * @plugindesc Sample plugin\n */');
    for (const enabled of [true, false]) {
      write(project, 'js/plugins.js', `var $plugins = ${JSON.stringify([
        { name: 'SampleDualEngine', status: enabled, parameters: {}, description: '' },
      ])};`);
      const result = preflightGameBuild(workflowRoot, project, { presetId: preset.id, releaseConfig: release });
      assert.equal(result.ok, true, result.blockers.join('\n'));
      assert.equal(result.warnings.some((item) => item.includes('declares MZ')), enabled);
    }
    write(project, 'js/plugins.js', 'var $plugins = [{"name":"MissingPlugin","status":true,"parameters":{}}];');
    assert.equal(preflightGameBuild(workflowRoot, project, { presetId: preset.id, releaseConfig: release }).ok, false);
  });
});

test('release audit: binary diff preflight rejects delta and changed full baselines', async () => {
  await withProject(async ({ workflowRoot, project, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const full = await buildGame(workflowRoot, project, { presetId: preset.id, releaseConfig: release,
      outputConflict: 'new-directory', confirmManagedChanges: true });
    assert.equal(full.status, 'success', full.error);
    const deltaPreset: GameBuildPreset = { ...preset, packageType: 'file-delta', baseReleaseId: full.releaseId! };
    saveGameBuildSettings(project, { presets: [deltaPreset], selectedPresetId: preset.id });
    const delta = await buildGame(workflowRoot, project, { presetId: preset.id, outputConflict: 'new-directory', confirmManagedChanges: true });
    assert.equal(delta.status, 'success', delta.error);
    saveGameBuildSettings(project, { presets: [{ ...deltaPreset, packageType: 'binary-diff', baseReleaseId: delta.releaseId! }], selectedPresetId: preset.id });
    assert.match(preflightGameBuild(workflowRoot, project, { presetId: preset.id }).blockers.join('\n'), /requires a full baseline/);
    saveGameBuildSettings(project, { presets: [{ ...deltaPreset, packageType: 'binary-diff' }], selectedPresetId: preset.id });
    assert.equal(preflightGameBuild(workflowRoot, project, { presetId: preset.id }).ok, true);
    write(full.outputPath!, 'data/Map001.json', '{"displayName":"Changed baseline"}');
    assert.match(preflightGameBuild(workflowRoot, project, { presetId: preset.id }).blockers.join('\n'), /baseline file no longer matches/);
  });
});

test('lists explicit Android icon candidates without guessing among multiple files', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-icon-candidates-'));
  try {
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'icon'), { recursive: true });
    fs.writeFileSync(path.join(project, 'icon', 'readme.txt'), 'not artwork', 'utf8');
    assert.deepEqual(listAndroidIconCandidates(project), []);
    fs.writeFileSync(path.join(project, 'icon', 'app.png'), Buffer.from([1]));
    assert.deepEqual(listAndroidIconCandidates(project), ['icon/app.png']);
    fs.writeFileSync(path.join(project, 'icon', 'alternate.webp'), Buffer.from([2]));
    assert.deepEqual(listAndroidIconCandidates(project), ['icon/alternate.webp', 'icon/app.png']);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('builds a complete Web directory and ZIP without copying save or editor state', async () => {
  await withProject(async ({ workflowRoot, project, output, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const preflight = preflightGameBuild(workflowRoot, project, { presetId: preset.id, releaseConfig: release });
    assert.equal(preflight.ok, true, preflight.blockers.join('\n'));
    assert.ok(preflight.managedChanges.length >= 3);

    const result = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'overwrite',
      releaseConfig: release,
      releaseExpectedSourceHash: null,
      confirmManagedChanges: true,
    });
    assert.equal(result.status, 'success', result.error);
    assert.ok(result.releaseId);
    assert.ok(result.outputPath);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'index.html')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'data', 'RPGAgentRelease.json')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'js', 'plugins', 'RPGAgentVersion.js')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'save')), false);
    assert.equal(fs.existsSync(path.join(result.outputPath!, '.luna_rpg')), false);
    assert.equal(fs.existsSync(`${result.outputPath}.zip`), true);
    const report = readGameBuildReport(project, result.releaseId!);
    assert.equal(report.status, 'success');
    assert.equal(report.version, '1.2.3-beta.1');
    assert.ok(report.files.some((file) => file.path === 'data/Map001.json'));
    assert.equal(report.files.some((file) => file.path.includes('.luna_rpg')), false);
    assert.equal(path.dirname(result.outputPath!), output);

    const canceled = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'cancel',
    });
    assert.equal(canceled.status, 'canceled');
  });
});

test('records a failed build report when build preflight blocks the request', async () => {
  await withProject(async ({ workflowRoot, project, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const result = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'overwrite',
      releaseConfig: { ...release, channel: 'preview' },
      releaseExpectedSourceHash: null,
      confirmManagedChanges: true,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'preflight');
    assert.ok(result.releaseId);
    assert.ok(result.reportPath);
    const report = readGameBuildReport(project, result.releaseId!);
    assert.equal(report.status, 'failed');
    assert.equal(report.failedStage, 'preflight');
    assert.match(report.error || '', /preset channel/i);
  });
});

test('still writes a failure report when the saved release configuration is corrupt', async () => {
  await withProject(async ({ workflowRoot, project, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    fs.writeFileSync(path.join(project, 'data', 'RPGAgentRelease.json'), '{not-json', 'utf8');
    const result = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'overwrite',
      confirmManagedChanges: true,
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'preflight');
    assert.ok(result.releaseId);
    assert.ok(result.reportPath);
    const report = readGameBuildReport(project, result.releaseId!);
    assert.equal(report.status, 'failed');
    assert.match(report.error || '', /cannot be read/i);
    assert.ok(report.warnings.some((warning) => /recovered release metadata/i.test(warning)));
  });
});

test('builds file deltas against an exact report and records deletions', async () => {
  await withProject(async ({ workflowRoot, project, output, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const baseline = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'overwrite',
      releaseConfig: release,
      releaseExpectedSourceHash: null,
      confirmManagedChanges: true,
    });
    assert.equal(baseline.status, 'success', baseline.error);
    fs.writeFileSync(path.join(project, 'data', 'Map001.json'), '{"changed":true}\n', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'Map002.json'), '{"added":true}\n', 'utf8');
    fs.rmSync(path.join(project, 'img', 'pictures', 'unused.png'));

    const delta: GameBuildPreset = {
      ...preset,
      id: 'web-delta',
      name: 'Web delta',
      zip: false,
      packageType: 'file-delta',
      baseReleaseId: baseline.releaseId,
    };
    saveGameBuildSettings(project, { presets: [preset, delta], selectedPresetId: delta.id });
    const result = await buildGame(workflowRoot, project, {
      presetId: delta.id,
      outputConflict: 'new-directory',
    });
    assert.equal(result.status, 'success', result.error);
    assert.ok(result.outputPath?.endsWith('-2'));
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'data', 'Map001.json')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'data', 'Map002.json')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'index.html')), false);
    assert.ok(result.contentChanges?.added.includes('data/Map002.json'));
    assert.ok(result.contentChanges?.modified.includes('data/Map001.json'));
    assert.ok(result.contentChanges?.deleted.includes('img/pictures/unused.png'));
    const report = readGameBuildReport(project, result.releaseId!);
    assert.deepEqual(report.deletedFiles, ['img/pictures/unused.png']);
    assert.deepEqual(report.contentChanges, result.contentChanges);
    assert.equal(report.baseReleaseId, baseline.releaseId);
    assert.equal(path.dirname(result.outputPath!), output);
  });
});

test('builds a runnable Windows directory with an external update launcher and exact release baseline', async () => {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-windows-build-'));
  const project = path.join(workflowRoot, 'projects', 'sample');
  const output = path.join(workflowRoot, 'output');
  try {
    createMvProject(project);
    createWindowsRuntime(project, 'x64');
    const release: GameReleaseConfig = {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: '2.0.0',
      channel: 'stable',
      update: { enabled: true, indexUrl: 'https://updates.invalid/releases.json', checkOnStart: true, policy: 'optional' },
      saveCompatibility: {
        legacy: 'allow', older: 'allow', same: 'allow', newer: 'warn', differentChannel: 'warn',
      },
    };
    const preset: GameBuildPreset = {
      id: 'windows-release',
      name: 'Windows release',
      target: 'windows',
      architecture: 'x64',
      channel: 'stable',
      outputDirectory: output,
      zip: false,
      packageType: 'full',
      processing: defaultProcessing(),
    };
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const result = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'overwrite',
      releaseConfig: release,
      releaseExpectedSourceHash: null,
      confirmManagedChanges: true,
    });
    assert.equal(result.status, 'success', result.error);
    assert.equal(fs.existsSync(path.join(result.outputPath!, 'Game.exe')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, '.rpg-agent', 'updater', 'updater.cjs')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, '.rpg-agent', 'updater', 'launcher.js')), true);
    assert.equal(fs.existsSync(path.join(result.outputPath!, '.rpg-agent', 'updater', 'filesystem.cjs')), true);
    const baseline = JSON.parse(fs.readFileSync(path.join(result.outputPath!, '.rpg-agent', 'current-release.json'), 'utf8'));
    assert.equal(baseline.releaseId, result.releaseId);
    const report = readGameBuildReport(project, result.releaseId!);
    assert.equal(report.runtime.architecture, 'x64');
    assert.equal(report.files.some((file) => file.path === 'Game.exe'), true);
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
});

test('runs packaging in a worker and reports ordered progress without blocking the caller', async () => {
  await withProject(async ({ workflowRoot, project, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    const progress: Array<{ stage: string; percent: number }> = [];
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 2);
    try {
      const handle = startGameBuildWorker(workflowRoot, project, {
        operationId: 'worker-build-test',
        presetId: preset.id,
        outputConflict: 'overwrite',
        releaseConfig: release,
        releaseExpectedSourceHash: null,
        confirmManagedChanges: true,
      }, (event) => progress.push({ stage: event.stage, percent: event.percent }));
      const result = await handle.result;
      assert.equal(result.status, 'success', result.error);
      assert.ok(ticks > 0);
      assert.equal(progress.at(-1)?.stage, 'complete');
      assert.equal(progress.at(-1)?.percent, 100);
      assert.deepEqual([...progress.map((event) => event.percent)].sort((a, b) => a - b), progress.map((event) => event.percent));
    } finally {
      clearInterval(timer);
    }
  });
});

test('cancels a packaging worker and resolves with a canceled result', async () => {
  await withProject(async ({ workflowRoot, project, output, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    fs.writeFileSync(path.join(project, 'large-test-asset.bin'), Buffer.alloc(16 * 1024 * 1024, 1));
    let handle: ReturnType<typeof startGameBuildWorker>;
    handle = startGameBuildWorker(workflowRoot, project, {
      operationId: 'worker-cancel-test',
      presetId: preset.id,
      outputConflict: 'overwrite',
      releaseConfig: release,
      releaseExpectedSourceHash: null,
      confirmManagedChanges: true,
    }, (event) => {
      if (event.stage === 'copy-project') handle.cancel();
    });
    const result = await handle.result;
    assert.equal(result.status, 'canceled');
    assert.deepEqual(result.artifacts, []);
    const abandonedStaging = fs.existsSync(output)
      ? fs.readdirSync(output).filter((entry) => entry.startsWith('.rpg-agent-build-'))
      : [];
    assert.deepEqual(abandonedStaging, []);
  });
});

test('finishes the report after output publication has crossed the cancellation boundary', async () => {
  await withProject(async ({ workflowRoot, project, release, preset }) => {
    saveGameBuildSettings(project, { presets: [preset], selectedPresetId: preset.id });
    let canceled = false;
    const result = await buildGame(workflowRoot, project, {
      presetId: preset.id,
      outputConflict: 'overwrite',
      releaseConfig: release,
      releaseExpectedSourceHash: null,
      confirmManagedChanges: true,
    }, {
      isCanceled: () => canceled,
      reportProgress: (event) => {
        if (event.stage === 'write-report') canceled = true;
      },
    });
    assert.equal(result.status, 'success', result.error);
    assert.ok(result.releaseId);
    assert.ok(result.outputPath);
    assert.equal(fs.existsSync(result.outputPath!), true);
    assert.equal(readGameBuildReport(project, result.releaseId!).status, 'success');
  });
});

async function withProject(
  run: (fixture: {
    workflowRoot: string;
    project: string;
    output: string;
    release: GameReleaseConfig;
    preset: GameBuildPreset;
  }) => Promise<void>,
): Promise<void> {
  const workflowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-build-service-'));
  const project = path.join(workflowRoot, 'projects', 'sample-game');
  const output = path.join(workflowRoot, 'output');
  try {
    createMvProject(project);
    const release: GameReleaseConfig = {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: '1.2.3-beta.1',
      channel: 'stable',
      update: { enabled: false, indexUrl: '', checkOnStart: true, policy: 'optional' },
      saveCompatibility: {
        legacy: 'allow', older: 'allow', same: 'allow', newer: 'warn', differentChannel: 'warn',
      },
    };
    const preset: GameBuildPreset = {
      id: 'web-release',
      name: 'Web release',
      target: 'web',
      architecture: 'web',
      channel: 'stable',
      outputDirectory: output,
      zip: true,
      packageType: 'full',
      processing: defaultProcessing(),
    };
    await run({ workflowRoot, project, output, release, preset });
  } finally {
    fs.rmSync(workflowRoot, { recursive: true, force: true });
  }
}

function createMvProject(project: string): void {
  fs.mkdirSync(project, { recursive: true });
  write(project, 'Game.rpgproject', 'RPGMV 1.6.2');
  write(project, 'index.html', '<html><body><script src="js/main.js"></script></body></html>');
  write(project, 'package.json', '{"name":"sample","main":"index.html"}');
  for (const script of [
    'rpg_core.js', 'rpg_managers.js', 'rpg_objects.js', 'rpg_scenes.js',
    'rpg_sprites.js', 'rpg_windows.js', 'main.js',
  ]) write(project, `js/${script}`, script === 'rpg_core.js' ? 'Utils.RPGMAKER_NAME = "MV"; Utils.RPGMAKER_VERSION = "1.6.2";' : '');
  write(project, 'js/plugins.js', 'var $plugins =\n[];\n');
  write(project, 'data/System.json', JSON.stringify({ gameTitle: 'Sample Game', hasEncryptedImages: false, hasEncryptedAudio: false }));
  write(project, 'data/MapInfos.json', JSON.stringify([null, { id: 1, name: 'Start', parentId: 0, order: 1 }]));
  write(project, 'data/Map001.json', '{"displayName":"Start"}');
  for (const directory of ['audio', 'fonts', 'img', 'js/plugins', 'movies']) {
    fs.mkdirSync(path.join(project, ...directory.split('/')), { recursive: true });
  }
  write(project, 'img/pictures/unused.png', 'image fixture');
  write(project, 'save/file1.rpgsave', 'private save');
}

function createWindowsRuntime(project: string, architecture: 'x86' | 'x64' | 'arm64'): void {
  const machine = { x86: 0x014c, x64: 0x8664, arm64: 0xaa64 }[architecture];
  const executable = Buffer.alloc(256);
  executable.writeUInt16LE(0x5a4d, 0);
  executable.writeUInt32LE(0x80, 0x3c);
  executable.writeUInt32LE(0x00004550, 0x80);
  executable.writeUInt16LE(machine, 0x84);
  fs.writeFileSync(path.join(project, 'Game.exe'), executable);
  for (const name of [
    'nw.dll', 'nw_elf.dll', 'node.dll', 'icudtl.dat', 'resources.pak', 'libEGL.dll',
    'libGLESv2.dll', 'd3dcompiler_47.dll', 'ffmpeg.dll', 'nw_100_percent.pak', 'nw_200_percent.pak',
  ]) write(project, name, name);
  write(project, 'locales/en-US.pak', 'locale');
}

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
