import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  prepareRmmvDeployCandidate,
  prepareRmmvPlaytestPlan,
  runPlaytest,
} from './runtime-deploy-service.ts';

describe('RMMV runtime playtest and deploy service', () => {
  let root: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rpg-runtime-'));
    project = path.join(root, 'projects', 'Project');
    writeCompleteProject(project);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('marks a complete project with Game.exe as runnable without claiming execution success', () => {
    const plan = prepareRmmvPlaytestPlan(root, project, {
      mapId: 1,
      startX: 3,
      startY: 4,
      generatedAt: '2026-06-14T10:00:00.000Z',
    });

    assert.equal(plan.status, 'runnable');
    assert.equal(plan.execution, 'not-started');
    assert.equal(plan.command?.executable, path.join(project, 'Game.exe'));
    assert.equal(plan.command?.cwd, project);
    assert.equal(plan.mapId, 1);
    assert.equal(plan.startX, 3);
    assert.equal(plan.startY, 4);
    assert.equal(plan.issues.some((issue) => issue.severity === 'blocker'), false);
    assert.equal(fs.existsSync(plan.artifactPath), true);
    assert.equal(JSON.parse(fs.readFileSync(plan.artifactPath, 'utf8')).status, 'runnable');
  });

  test('blocks playtest when an engine file is missing', () => {
    fs.rmSync(path.join(project, 'www', 'js', 'rpg_core.js'));

    const plan = prepareRmmvPlaytestPlan(root, project, {
      mapId: 1,
      generatedAt: '2026-06-14T10:01:00.000Z',
    });

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.issues.some((issue) => issue.code === 'engine-rpg_core.js-missing'), true);
  });

  test('warns for disabled missing plugin files and blocks enabled missing plugin files', () => {
    writePlugins(project, [
      { name: 'PresentPlugin', status: true },
      { name: 'MissingDisabled', status: false },
    ]);
    fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'PresentPlugin.js'), 'var PresentPlugin = {};', 'utf8');

    const warningPlan = prepareRmmvPlaytestPlan(root, project, {
      mapId: 1,
      generatedAt: '2026-06-14T10:02:00.000Z',
    });

    assert.equal(warningPlan.status, 'runnable');
    assert.equal(warningPlan.issues.some((issue) => issue.code === 'disabled-plugin-file-missing' && issue.severity === 'warning'), true);

    writePlugins(project, [{ name: 'MissingEnabled', status: true }]);
    const blockedPlan = prepareRmmvPlaytestPlan(root, project, {
      mapId: 1,
      generatedAt: '2026-06-14T10:03:00.000Z',
    });

    assert.equal(blockedPlan.status, 'blocked');
    assert.equal(blockedPlan.issues.some((issue) => issue.code === 'enabled-plugin-file-missing' && issue.severity === 'blocker'), true);
  });

  test('blocks playtest without Game.exe or configured NW.js runner', () => {
    fs.rmSync(path.join(project, 'Game.exe'));

    const plan = prepareRmmvPlaytestPlan(root, project, {
      mapId: 1,
      generatedAt: '2026-06-14T10:04:00.000Z',
    });

    assert.equal(plan.status, 'blocked');
    assert.equal(plan.command, undefined);
    assert.equal(plan.issues.some((issue) => issue.code === 'runtime-runner-missing'), true);
  });

  test('runs an explicit runner and captures stdout and stderr evidence', async () => {
    writeNodeRunner(project, `
      console.log('runner stdout evidence');
      console.error('runner stderr evidence');
      process.exit(0);
    `);

    const result = await runPlaytest(root, project, {
      mapId: 1,
      nwjsRunner: process.execPath,
      timeoutMs: 5000,
      generatedAt: '2026-06-14T10:04:10.000Z',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.execution, 'completed');
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.command?.executable, process.execPath);
    assert.match(fs.readFileSync(result.stdoutPath, 'utf8'), /runner stdout evidence/);
    assert.match(fs.readFileSync(result.stderrPath, 'utf8'), /runner stderr evidence/);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /runner stdout evidence/);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /runner stderr evidence/);
    assert.equal(JSON.parse(fs.readFileSync(result.artifactPath, 'utf8')).status, 'completed');
    assert.equal(result.runnerStarted, true);
    assert.equal(typeof result.processExited, 'boolean');
    assert.equal(result.timedOut, false);
    assert.equal(Array.isArray(result.evidenceFiles), true);
    assert.equal(result.evidenceFiles.length >= 3, true);
    assert.equal(result.evidenceFiles.every((filePath) => filePath.startsWith(path.join(root, 'runtime', 'out', 'playtest'))), true);
  });

  test('marks a runner timeout as a stopped failed run with logs', async () => {
    writeNodeRunner(project, `
      import fs from 'node:fs';
      fs.writeSync(1, 'runner started before timeout\\n');
      setInterval(() => {}, 1000);
    `);

    const result = await runPlaytest(root, project, {
      mapId: 1,
      nwjsRunner: process.execPath,
      timeoutMs: 1000,
      generatedAt: '2026-06-14T10:04:20.000Z',
    });

    assert.equal(result.status, 'timed-out');
    assert.equal(result.execution, 'timed-out');
    assert.equal(result.timedOut, true);
    assert.match(fs.readFileSync(result.stdoutPath, 'utf8'), /runner started before timeout/);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /timeout: 1000ms elapsed/);
    assert.equal(JSON.parse(fs.readFileSync(result.artifactPath, 'utf8')).status, 'timed-out');
    assert.equal(result.runnerStarted, true);
    assert.equal(typeof result.processExited, 'boolean');
    assert.equal(result.evidenceFiles.includes(result.logPath), true);
  });

  test('runs probe mode with explicit runner and returns structured probe result', async () => {
    const generatedAt = '2026-06-14T10:05:10.000Z';
    fs.mkdirSync(path.join(project, 'www', 'save'), { recursive: true });
    fs.writeFileSync(path.join(project, 'www', 'save', 'file1.rpgsave'), 'source-save', 'utf8');
    writeProbeRunner(project, {
      status: 'pass',
      generatedAt,
      root,
      emitLog: true,
      screenshot: true,
    });

    const result = await runPlaytest(root, project, {
      mapId: 1,
      nwjsRunner: process.execPath,
      probe: true,
      timeoutMs: 5000,
      generatedAt,
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.probeStatus, 'pass');
    assert.equal(result.execution, 'completed');
    assert.equal(result.runnerStarted, true);
    assert.equal(typeof result.processExited, 'boolean');
    assert.equal(result.timedOut, false);
    assert.equal(result.blockers.length, 0);
    assert.equal(result.screenEvidence.required, true);
    assert.equal(result.screenEvidence.exists, true);
    assert.equal(result.screenEvidence.nonBlank, true);
    assert.equal(result.startMapVerified.required, true);
    assert.equal(result.startMapVerified.verified, true);
    assert.equal(result.startMapVerified.expectedStartMapId, 1);
    assert.equal(result.startMapVerified.currentMapId, 1);
    assert.equal(result.idleOrReadyEvidence.required, true);
    assert.equal(result.idleOrReadyEvidence.verified, true);
    assert.equal(result.idleOrReadyEvidence.mode, 'idle');
    assert.equal(result.saveIsolation.enabled, true);
    assert.equal(result.saveIsolation.strategy, 'temporary-project-copy');
    assert.equal(result.saveIsolation.excludedFromProbeWorkspace, true);
    assert.equal(result.saveIsolation.sourceUnchanged, true);
    assert.equal(result.saveIsolation.cleaned, true);
    assert.equal(fs.existsSync(result.saveIsolation.probeWorkspace || ''), false);
    assert.equal(fs.readFileSync(path.join(project, 'www', 'save', 'file1.rpgsave'), 'utf8'), 'source-save');
    assert.equal(result.evidenceFiles.includes(result.artifactPath), true);
    const probeStdout = result.evidenceFiles.find((filePath) => filePath.endsWith('probe.stdout.log'));
    const probeStderr = result.evidenceFiles.find((filePath) => filePath.endsWith('probe.stderr.log'));
    assert.equal(typeof probeStdout, 'string');
    assert.equal(typeof probeStderr, 'string');
    assert.ok(probeStdout);
    assert.ok(probeStderr);
    assert.match(fs.readFileSync(probeStdout, 'utf8'), /probe runner stdout/);
    assert.match(fs.readFileSync(probeStderr, 'utf8'), /probe runner stderr/);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /probeStatus: pass/);
  });

  test('classifies project plugin runtime JavaScript errors from probe evidence', async () => {
    const generatedAt = '2026-06-14T10:05:15.000Z';
    writeProbeRunner(project, {
      status: 'fail',
      generatedAt,
      root,
      sceneName: 'Scene_Boot',
      expectedStartMapId: 1,
      currentMapId: 0,
      runtimeErrors: [
        {
          message: 'Uncaught ReferenceError: Window_QuestData is not defined',
          source: 'chrome-extension://fixture/www/js/plugins/DarkPlasma_WordWrapForJapanese.js',
          line: 346,
          column: 5,
          stack: 'ReferenceError: Window_QuestData is not defined\n    at chrome-extension://fixture/www/js/plugins/DarkPlasma_WordWrapForJapanese.js:346:5',
        },
      ],
    });

    const result = await runPlaytest(root, project, {
      mapId: 1,
      nwjsRunner: process.execPath,
      probe: true,
      timeoutMs: 5000,
      generatedAt,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.probeStatus, 'fail');
    assert.equal(result.runtimeFailure?.code, 'project-runtime-js-error');
    assert.equal(result.runtimeFailure?.causedBy, 'rmmv-project');
    assert.equal(result.runtimeFailure?.blocksSceneMap, true);
    assert.equal(result.runtimeFailure?.blocksStartMap, true);
    assert.equal(result.runtimeFailure?.primaryError?.type, 'ReferenceError');
    assert.equal(result.runtimeFailure?.primaryError?.sourceKind, 'rmmv-plugin');
    assert.equal(result.runtimeFailure?.primaryError?.relativePath, 'www/js/plugins/DarkPlasma_WordWrapForJapanese.js');
    assert.equal(result.runtimeFailure?.primaryError?.pluginName, 'DarkPlasma_WordWrapForJapanese');
    assert.equal(result.blockers.some((blocker) => blocker.includes('Project runtime JavaScript error blocked playable proof before Scene_Map')), true);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /runtimeFailure: Project runtime JavaScript error blocked playable proof before Scene_Map/);

    const probeJsonPath = result.evidenceFiles.find((filePath) => filePath.endsWith('nwjs-playable-probe.json'));
    assert.equal(typeof probeJsonPath, 'string');
    assert.ok(probeJsonPath);
    const probeJson = JSON.parse(fs.readFileSync(probeJsonPath, 'utf8'));
    assert.equal(probeJson.failureClassification.code, 'project-runtime-js-error');
    assert.equal(probeJson.runtimeJsErrors[0].pluginName, 'DarkPlasma_WordWrapForJapanese');
  });

  test('marks probe as blocked when required keywords are missing in logs', async () => {
    const generatedAt = '2026-06-14T10:05:20.000Z';
    writeProbeRunner(project, {
      status: 'pass',
      generatedAt,
      root,
      emitLog: true,
      screenshot: false,
    });

    const result = await runPlaytest(root, project, {
      mapId: 1,
      nwjsRunner: process.execPath,
      probe: true,
      probeKeywords: ['KEYWORD_DOES_NOT_EXIST'],
      timeoutMs: 5000,
      generatedAt,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.probeStatus, 'pass');
    assert.equal(result.timedOut, false);
    assert.equal(result.runnerStarted, true);
    assert.equal(typeof result.processExited, 'boolean');
    assert.equal(result.screenEvidence.exists, false);
    assert.equal(result.startMapVerified.verified, true);
    assert.equal(result.idleOrReadyEvidence.verified, true);
    assert.equal(result.saveIsolation.enabled, true);
    assert.equal(result.blockers.some((blocker) => blocker === 'screen evidence artifact is missing'), true);
    assert.equal(result.blockers.some((blocker) => blocker === 'Missing required log keyword: KEYWORD_DOES_NOT_EXIST'), true);
  });

  test('blocks probe mode when no playtest runner is available', async () => {
    const generatedAt = '2026-06-14T10:05:30.000Z';
    fs.rmSync(path.join(project, 'Game.exe'));

    const result = await runPlaytest(root, project, {
      mapId: 1,
      probe: true,
      timeoutMs: 200,
      generatedAt,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.execution, 'blocked');
    assert.equal(result.runnerStarted, false);
    assert.equal(result.processExited, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.blockers.some((blocker) => blocker.startsWith('runtime-runner-missing')), true);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /runtime-runner-missing/);
    assert.equal(result.probeStatus, undefined);
    assert.equal(result.screenEvidence.required, true);
    assert.equal(result.screenEvidence.exists, false);
    assert.equal(result.startMapVerified.required, true);
    assert.equal(result.saveIsolation.strategy, 'not-run');
    assert.equal(result.idleOrReadyEvidence.required, true);
  });

  test('timeouts probe-run mode when probe never reaches a final state', async () => {
    const generatedAt = '2026-06-14T10:05:40.000Z';
    writeProbeRunner(project, {
      status: 'running',
      generatedAt,
      root,
      emitLog: true,
      keepAlive: true,
    });

    const result = await runPlaytest(root, project, {
      mapId: 1,
      nwjsRunner: process.execPath,
      probe: true,
      timeoutMs: 1000,
      generatedAt,
    });

    assert.equal(result.status, 'timed-out');
    assert.equal(result.execution, 'timed-out');
    assert.equal(result.probeStatus, 'fail');
    assert.equal(result.timedOut, true);
    assert.equal(result.runnerStarted, true);
    assert.equal(typeof result.processExited, 'boolean');
    assert.equal(result.screenEvidence.exists, false);
    assert.equal(result.startMapVerified.verified, false);
    assert.equal(result.idleOrReadyEvidence.verified, false);
    assert.equal(result.saveIsolation.enabled, true);
    assert.equal(result.blockers.some((blocker) => blocker.includes('Timed out before playable probe produced a final result')), true);
  });

  test('run mode remains blocked when no real runner is available', async () => {
    fs.rmSync(path.join(project, 'Game.exe'));

    const result = await runPlaytest(root, project, {
      mapId: 1,
      timeoutMs: 200,
      generatedAt: '2026-06-14T10:04:30.000Z',
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.execution, 'blocked');
    assert.equal(result.command, undefined);
    assert.equal(result.exitCode, null);
    assert.equal(result.issues.some((issue) => issue.code === 'runtime-runner-missing'), true);
    assert.match(fs.readFileSync(result.logPath, 'utf8'), /runtime-runner-missing/);
    assert.equal(JSON.parse(fs.readFileSync(result.artifactPath, 'utf8')).status, 'blocked');
  });

  test('copies a Windows deploy candidate and excludes save/runtime/secrets/node_modules', () => {
    fs.mkdirSync(path.join(project, 'www', 'save'), { recursive: true });
    fs.writeFileSync(path.join(project, 'www', 'save', 'file1.rpgsave'), 'save', 'utf8');
    fs.mkdirSync(path.join(project, 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(project, 'runtime', 'trace.json'), '{}', 'utf8');
    fs.mkdirSync(path.join(project, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(project, 'secrets', 'token.txt'), 'secret', 'utf8');
    fs.mkdirSync(path.join(project, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules', 'pkg', 'index.js'), '', 'utf8');

    const manifest = prepareRmmvDeployCandidate(root, project, {
      target: 'windows',
      generatedAt: '2026-06-14T10:05:00.000Z',
    });

    assert.equal(manifest.status, 'ready');
    assert.equal(fs.existsSync(path.join(manifest.targetDir, 'www', 'index.html')), true);
    assert.equal(fs.existsSync(path.join(manifest.targetDir, 'Game.exe')), true);
    assert.equal(fs.existsSync(path.join(manifest.targetDir, 'www', 'save')), false);
    assert.equal(fs.existsSync(path.join(manifest.targetDir, 'runtime')), false);
    assert.equal(fs.existsSync(path.join(manifest.targetDir, 'secrets')), false);
    assert.equal(fs.existsSync(path.join(manifest.targetDir, 'node_modules')), false);
    assert.equal(manifest.excluded.some((entry) => entry.path === 'www/save'), true);
    assert.equal(manifest.excluded.some((entry) => entry.path === 'runtime'), true);
    assert.equal(manifest.excluded.some((entry) => entry.path === 'secrets'), true);
    assert.equal(manifest.excluded.some((entry) => entry.path === 'node_modules'), true);
    assert.equal(JSON.parse(fs.readFileSync(manifest.manifestPath, 'utf8')).target, 'windows');
  });
});

function writeCompleteProject(projectRoot: string): void {
  const dataDir = path.join(projectRoot, 'www', 'data');
  const jsDir = path.join(projectRoot, 'www', 'js');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(jsDir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Game.exe'), 'nwjs runner placeholder for tests', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ main: 'www/index.html' }), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'www', 'index.html'), '<!doctype html><script src="js/rpg_core.js"></script>', 'utf8');
  for (const fileName of [
    'rpg_core.js',
    'rpg_managers.js',
    'rpg_objects.js',
    'rpg_scenes.js',
    'rpg_sprites.js',
    'rpg_windows.js',
    'main.js',
  ]) {
    fs.writeFileSync(path.join(jsDir, fileName), `// ${fileName}\n`, 'utf8');
  }
  writePlugins(projectRoot, []);
  fs.writeFileSync(path.join(dataDir, 'System.json'), JSON.stringify({
    gameTitle: 'Runtime Fixture',
    switches: ['', 'Intro'],
    variables: ['', 'Progress'],
    startMapId: 1,
    startX: 0,
    startY: 0,
  }), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'MapInfos.json'), JSON.stringify([
    null,
    { id: 1, name: 'Start', parentId: 0, order: 1 },
  ]), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'Map001.json'), JSON.stringify({
    width: 17,
    height: 13,
    tilesetId: 1,
    events: [null],
    data: Array(17 * 13 * 6).fill(0),
  }), 'utf8');
}

function writeNodeRunner(projectRoot: string, source: string): void {
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    type: 'module',
    main: 'fake-runner.mjs',
  }), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'fake-runner.mjs'), source, 'utf8');
}

function writeProbeRunner(
  projectRoot: string,
  options: {
    status: 'pass' | 'fail' | 'running';
    generatedAt: string;
    root: string;
    emitLog?: boolean;
    screenshot?: boolean;
    keepAlive?: boolean;
    sceneName?: string;
    expectedStartMapId?: number;
    currentMapId?: number;
    runtimeErrors?: Array<{
      message: string;
      source?: string;
      line?: number;
      column?: number;
      stack?: string;
    }>;
  },
): void {
  const probeStamp = safeStamp(options.generatedAt);
  const probeArtifact = path.join(options.root, 'runtime', 'out', 'playtest', probeStamp, 'probe');
  const target = {
    generatedAt: options.generatedAt,
    marker: {
      resultPath: path.join(probeArtifact, 'nwjs-playable-probe.json'),
      screenPath: path.join(probeArtifact, 'nwjs-playable-screen.png'),
      logMessage: options.emitLog ? 'probe runner stdout heartbeat' : '',
      stderrMessage: options.emitLog ? 'probe runner stderr heartbeat' : '',
      status: options.status,
      keepAlive: Boolean(options.keepAlive),
      writeScreenshot: Boolean(options.screenshot),
      sceneName: options.sceneName || 'Scene_Map',
      expectedStartMapId: options.expectedStartMapId || 1,
      currentMapId: options.currentMapId ?? 1,
      runtimeErrors: options.runtimeErrors || [],
    },
  };
  fs.mkdirSync(path.dirname(path.join(projectRoot, 'playtest-probe-manifest.json')), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'playtest-probe-manifest.json'),
    JSON.stringify(target.marker, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    type: 'module',
    main: 'fake-probe-runner.mjs',
  }), 'utf8');
  fs.writeFileSync(
    path.join(projectRoot, 'fake-probe-runner.mjs'),
    `
import fs from 'node:fs';
import path from 'node:path';

const marker = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'playtest-probe-manifest.json'), 'utf8'));
const result = {
  status: marker.status === 'running' ? 'running' : marker.status,
  detail: marker.status === 'pass'
    ? 'Injectable probe script produced pass.'
    : 'Injectable probe script produced runtime state.',
  ready: true,
  sceneName: marker.sceneName,
  map: {
    sceneName: marker.sceneName,
    expectedStartMapId: marker.expectedStartMapId,
    currentMapId: marker.currentMapId,
    onStartMap: marker.expectedStartMapId === marker.currentMapId,
    player: {
      visible: true,
      characterName: 'Player',
    }
  },
  events: {
    complete: marker.status === 'pass',
  },
  errors: marker.runtimeErrors,
};

if (marker.logMessage) console.log(marker.logMessage);
if (marker.stderrMessage) console.error(marker.stderrMessage);

if (marker.writeScreenshot) {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGP4TyFgGDVg1IBRA4aLAQBdePwur/3haQAAAABJRU5ErkJggg==';
  fs.writeFileSync(marker.screenPath, Buffer.from(png, 'base64'));
}

if (marker.status !== 'running') {
  fs.writeFileSync(marker.resultPath, JSON.stringify(result), 'utf8');
  process.exit(0);
} else if (marker.keepAlive) {
  setInterval(() => {}, 1000);
} else {
  process.exit(0);
}
`,
    'utf8',
  );
}

function safeStamp(value: string): string {
  return value.replace(/[:.]/g, '-').replace(/[^A-Za-z0-9_-]/g, '-');
}

function writePlugins(projectRoot: string, entries: { name: string; status: boolean }[]): void {
  fs.mkdirSync(path.join(projectRoot, 'www', 'js'), { recursive: true });
  const payload = entries.map((entry) => ({
    name: entry.name,
    status: entry.status,
    description: '',
    parameters: {},
  }));
  fs.writeFileSync(path.join(projectRoot, 'www', 'js', 'plugins.js'), `var $plugins = ${JSON.stringify(payload)};`, 'utf8');
}
