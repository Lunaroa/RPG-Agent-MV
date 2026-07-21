import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

import type { IsolatedProjectPreparation } from './isolated-project-preparation.ts';
import type { InteractiveProjectRuntime } from './interactive-playtest-runtime.ts';
import {
  buildMapPreviewLaunchCommand,
  classifyWarmPreviewPaths,
  createMapPreviewProfileDirectory,
  describeMapPreviewStartupTimeout,
  injectPreviewHarness,
  isCurrentMapPreviewFrame,
  MAP_PREVIEW_DEBUG_MARKER,
  MapPreviewService,
  MapPreviewPacketDecoder,
  mapPreviewDebugMarkerBootstrapSource,
  mapPreviewRuntimeFailureDetail,
  mapPreviewLoadPurpose,
  mapPreviewRequiresReload,
  sanitizeMapPreviewDiagnosticText,
} from './map-preview-service.ts';

function preparation(sourceProject: string, temporaryProject: string): IsolatedProjectPreparation {
  return {
    sourceProject,
    temporaryProject,
    sourceFingerprint: 'source-fingerprint',
    saveFingerprint: 'save-fingerprint',
    staging: { files: [], digest: 'staging-digest' },
    savesExcluded: true,
  };
}

function runtime(overrides: Partial<InteractiveProjectRuntime>): InteractiveProjectRuntime {
  return {
    engine: 'rpg-maker-mv',
    executable: path.join(os.tmpdir(), 'runtime', 'Game.exe'),
    runtimeRoot: path.join(os.tmpdir(), 'runtime'),
    source: 'official-install',
    launchStyle: 'external',
    evidenceExecutable: 'test-runtime',
    ...overrides,
  };
}

test('injects the preview harness only into an isolated RPG Maker app root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-injection-'));
  try {
    const resources = path.join(root, 'www');
    fs.mkdirSync(path.join(resources, 'js'), { recursive: true });
    fs.writeFileSync(
      path.join(resources, 'index.html'),
      '<!doctype html><script src="js/plugins.js"></script><script src="js/main.js"></script>',
      'utf8',
    );
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', main: 'www/index.html' }), 'utf8');
    fs.writeFileSync(path.join(resources, 'package.json'), JSON.stringify({ name: 'sample-web', main: 'index.html' }), 'utf8');

    injectPreviewHarness(root, resources, {
      token: 'preview-session-token',
      port: 45678,
      mapId: 3,
      viewportWidth: 816,
      viewportHeight: 624,
      geometry: {
        mapId: 3,
        widthTiles: 80,
        heightTiles: 80,
        tileSize: 48,
        pixelWidth: 3840,
        pixelHeight: 3840,
      },
      mapRevision: 'a'.repeat(64),
      operationId: 1,
      overrides: { switches: { '2': true }, variables: { '4': 9 }, selfSwitches: {} },
    });

    const html = fs.readFileSync(path.join(resources, 'index.html'), 'utf8');
    assert.ok(html.indexOf('rpg-agent-map-preview.js') < html.indexOf('js/main.js'));
    const harness = fs.readFileSync(path.join(resources, 'js', 'rpg-agent-map-preview.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(harness));
    assert.match(harness, /Game_Interpreter\.prototype\.update/);
    assert.match(harness, /renderer\.render\(SceneManager\._scene\)/);
    assert.match(harness, /canvas\.toBlob\(function \(blob\)/);
    assert.match(harness, /reader\.readAsArrayBuffer\(blob\)/);
    assert.doesNotMatch(harness, /toDataURL\(/);
    assert.doesNotMatch(harness, /setTimeout\([\s\S]{0,120}, 67\)/);
    assert.match(harness, /pixels <= 67108864 \? 'full' : 'tiled'/);
    assert.match(harness, /phase: 'frame-meta'/);
    assert.match(harness, /command\.type === 'ack-frame'/);
    assert.match(harness, /command\.type === 'suspend'/);
    assert.match(harness, /const originalOnError = prototype\._onError/);
    assert.match(harness, /failedResources\.add\(resource\)/);
    assert.match(harness, /resources: Array\.from\(failedResources\)/);
    assert.match(harness, /command\.type === 'resume'/);
    assert.match(harness, /command\.type === 'toggle-devtools'/);
    assert.match(harness, /runtimeWindow\.showDevTools/);
    assert.match(harness, /runtimeWindow\.closeDevTools/);
    assert.match(harness, /phase: 'devtools'/);
    assert.match(harness, /preview-debug-marker-conflict/);
    assert.ok(harness.indexOf(MAP_PREVIEW_DEBUG_MARKER) < harness.indexOf('__rpgAgentMapPreviewInstalled'));
    assert.match(harness, /SceneManager\.stop\(\)/);
    assert.match(harness, /SceneManager\.resume\(\)/);
    assert.match(harness, /mapRevision: currentMapRevision/);
    assert.match(harness, /operationId: currentOperationId/);
    assert.match(harness, /loadMap\('fresh'/);
    assert.match(harness, /command\.purpose === 'switch' \|\| command\.purpose === 'reload'/);
    assert.match(harness, /restoreOverrideBaseline\(\)/);
    assert.match(harness, /SceneManager\._scene !== previousScene/);
    assert.match(harness, /New game initialization may only run once per preview runtime/);
    assert.match(harness, /"pixelWidth":3840/);
    assert.match(harness, /"switches":\{"2":true\}/);
    assert.match(harness, /captureBaselineState/);
    assert.match(harness, /RPG Maker boot sequence/);
    assert.match(harness, /SceneManager\.catchException/);
    assert.match(harness, /SceneManager\.isGameActive = function \(\) \{ return true; \}/);
    assert.match(harness, /Scene_Base\.prototype\.requestAutosave = function \(\) \{\}/);
    assert.match(harness, /isMZ \? Promise\.resolve\(false\) : false/);
    assert.match(harness, /phase: 'state'/);
    assert.match(harness, /baselineSwitchValues\[id\]/);
    assert.match(harness, /DataManager\.loadGlobalInfo/);
    assert.match(harness, /Utils\.RPGMAKER_NAME === 'MZ'[\s\S]{0,180}Scene_Map\.prototype\.createMenuButton = function \(\) \{ this\._menuButton = null; \}/);
    assert.match(harness, /reserveTransfer\(targetMapId, 0, 0, 2, 2\)/);
    assert.doesNotMatch(harness, /reserveTransfer\(targetMapId, 0, 0, 2, 0\)/);
    assert.match(harness, /Game_Event\.prototype\.update = function \(\) \{\}/);
    assert.match(harness, /preview-session-token/);
    assert.ok(harness.indexOf('send(PACKET_HANDSHAKE, { token: config.token });')
      < harness.indexOf("loadMap('fresh', currentMapId, currentGeometry"));
    assert.equal((harness.match(/DataManager\.setupNewGame\(\)/g) || []).length, 1);

    for (const packagePath of [path.join(root, 'package.json'), path.join(resources, 'package.json')]) {
      const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as Record<string, any>;
      assert.equal(manifest.window.show, false);
      assert.equal(manifest.window.show_in_taskbar, false);
      assert.match(manifest.window.inject_js_start, /rpg-agent-map-preview\.js$/);
      assert.equal(manifest.name, 'rmmv-agent-map-preview-preview-sess');
      assert.equal(manifest['single-instance'], false);
      assert.match(manifest['chromium-args'], /--disable-raf-throttling/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installs the stable preview debug marker as an immutable non-enumerable property', () => {
  const result = evaluatePreviewDebugMarker();
  assert.equal(result.value, true);
  assert.equal(result.conflict, '');
  assert.equal(result.descriptor?.value, true);
  assert.equal(result.descriptor?.writable, false);
  assert.equal(result.descriptor?.enumerable, false);
  assert.equal(result.descriptor?.configurable, false);
  assert.equal(Reflect.set(result.window, MAP_PREVIEW_DEBUG_MARKER, false), false);
  assert.equal(Reflect.deleteProperty(result.window, MAP_PREVIEW_DEBUG_MARKER), false);
});

test('accepts the identical preview marker and reports incompatible project definitions without overwriting them', () => {
  const compatible = evaluatePreviewDebugMarker({
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  assert.equal(compatible.conflict, '');

  const incompatible = evaluatePreviewDebugMarker({
    value: false,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  assert.match(incompatible.conflict, /incompatible/);
  assert.equal(incompatible.value, false);
});

test('reports unavailable developer tools without starting a preview runtime', async () => {
  let runtimeResolutionCalls = 0;
  const service = new MapPreviewService(os.tmpdir(), {
    resolveProjectRuntime() {
      runtimeResolutionCalls += 1;
      throw new Error('runtime resolution must not run');
    },
  });
  assert.deepEqual(await service.toggleDevTools(), {
    code: 'preview-runtime-unavailable',
    error: 'Start a map preview before opening its developer tools.',
  });
  assert.equal(runtimeResolutionCalls, 0);
});

test('decodes fragmented and combined preview packets without whole-buffer concatenation', () => {
  const packets: Array<{ type: number; payload: string }> = [];
  const decoder = new MapPreviewPacketDecoder((type, payload) => {
    packets.push({ type, payload: payload.toString('utf8') });
  }, 64);
  const first = testPacket(1, Buffer.from('abc'));
  const second = testPacket(2, Buffer.from('0123456789'));
  const combined = Buffer.concat([first, second]);
  decoder.push(combined.subarray(0, 2));
  decoder.push(combined.subarray(2, 7));
  decoder.push(combined.subarray(7, 13));
  decoder.push(combined.subarray(13));
  assert.deepEqual(packets, [
    { type: 1, payload: 'abc' },
    { type: 2, payload: '0123456789' },
  ]);
});

test('rejects preview packet payloads above the configured limit', () => {
  const decoder = new MapPreviewPacketDecoder(() => undefined, 4);
  assert.throws(() => decoder.push(testPacket(3, Buffer.from('12345')).subarray(0, 5)), /size limit/);
});

function testPacket(type: number, payload: Buffer): Buffer {
  const packet = Buffer.allocUnsafe(5 + payload.length);
  packet.writeUInt8(type, 0);
  packet.writeUInt32BE(payload.length, 1);
  payload.copy(packet, 5);
  return packet;
}

function evaluatePreviewDebugMarker(descriptor?: PropertyDescriptor): {
  window: Record<string, unknown>;
  value: unknown;
  descriptor: PropertyDescriptor | undefined;
  conflict: string;
} {
  const window: Record<string, unknown> = {};
  if (descriptor) Object.defineProperty(window, MAP_PREVIEW_DEBUG_MARKER, descriptor);
  const script = new vm.Script(`(function () {
${mapPreviewDebugMarkerBootstrapSource()}
return {
  value: window[${JSON.stringify(MAP_PREVIEW_DEBUG_MARKER)}],
  descriptor: Object.getOwnPropertyDescriptor(window, ${JSON.stringify(MAP_PREVIEW_DEBUG_MARKER)}),
  conflict: previewDebugMarkerConflict
};
}())`);
  return { window, ...script.runInNewContext({ window }) };
}

test('rejects a nonstandard app entry instead of silently falling back', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-entry-'));
  try {
    fs.mkdirSync(path.join(root, 'js'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><main></main>', 'utf8');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample', main: 'index.html' }), 'utf8');
    assert.throws(() => injectPreviewHarness(root, root, {
      token: 'preview-session-token',
      port: 45678,
      mapId: 1,
      viewportWidth: 816,
      viewportHeight: 624,
      geometry: { mapId: 1, widthTiles: 1, heightTiles: 1, tileSize: 48, pixelWidth: 48, pixelHeight: 48 },
      mapRevision: 'b'.repeat(64),
      operationId: 1,
      overrides: { switches: {}, variables: {}, selfSwitches: {} },
    }), /standard js\/main\.js entry/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('distinguishes warm resume, same-map reload, and cross-map switch', () => {
  assert.equal(mapPreviewLoadPurpose(6, 6, false), null);
  assert.equal(mapPreviewLoadPurpose(6, 6, true), 'reload');
  assert.equal(mapPreviewLoadPurpose(6, 3, true), 'switch');
});

test('forces a same-map reload without requiring a revision change', () => {
  assert.equal(mapPreviewRequiresReload(6, 'revision-a', 6, 'revision-a', false, false), false);
  assert.equal(mapPreviewRequiresReload(6, 'revision-a', 6, 'revision-a', false, true), true);
  assert.equal(mapPreviewRequiresReload(6, 'revision-a', 6, 'revision-b', false, false), true);
  assert.equal(mapPreviewRequiresReload(6, 'revision-a', 3, 'revision-a', false, false), true);
  assert.equal(mapPreviewRequiresReload(6, 'revision-a', 6, 'revision-a', true, false), true);
});

test('rejects frames from stale operations, maps, and revisions', () => {
  const session = { operationId: 4, mapId: 3, mapRevision: 'revision-current' };
  assert.equal(isCurrentMapPreviewFrame(session, session, 4), true);
  assert.equal(isCurrentMapPreviewFrame({ ...session, operationId: 3 }, session, 4), false);
  assert.equal(isCurrentMapPreviewFrame({ ...session, mapId: 2 }, session, 4), false);
  assert.equal(isCurrentMapPreviewFrame({ ...session, mapRevision: 'revision-old' }, session, 4), false);
});

test('creates a unique browser profile inside each isolated preview project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-profile-'));
  try {
    const first = createMapPreviewProfileDirectory(root);
    const second = createMapPreviewProfileDirectory(root);
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), root);
    assert.equal(path.dirname(second), root);
    assert.ok(fs.statSync(first).isDirectory());
    assert.ok(fs.statSync(second).isDirectory());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('places the isolated browser profile before every RPG Maker app argument', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-launch-'));
  try {
    const source = path.join(root, 'source');
    const isolated = path.join(root, 'isolated');
    fs.mkdirSync(source);
    fs.mkdirSync(isolated);
    fs.writeFileSync(path.join(source, 'Game.exe'), 'source-runtime');
    fs.writeFileSync(path.join(isolated, 'Game.exe'), 'copied-runtime');
    const profile = createMapPreviewProfileDirectory(isolated);
    const snapshot = preparation(source, isolated);
    const profileArgument = `--user-data-dir=${profile}`;

    assert.deepEqual(
      buildMapPreviewLaunchCommand(runtime({}), snapshot, profile).args,
      [profileArgument, isolated, 'test'],
    );
    assert.deepEqual(
      buildMapPreviewLaunchCommand(runtime({ engine: 'rpg-maker-mz' }), snapshot, profile).args,
      [profileArgument, isolated],
    );
    const embedded = buildMapPreviewLaunchCommand(runtime({
      executable: path.join(source, 'Game.exe'),
      runtimeRoot: source,
      source: 'project-local',
      launchStyle: 'embedded',
    }), snapshot, profile);
    assert.deepEqual(embedded.args, [profileArgument]);
    assert.equal(embedded.executable, path.join(isolated, 'Game.exe'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('classifies a process-started timeout without exposing Chromium output', () => {
  const failure = describeMapPreviewStartupTimeout('runtime-process-started');
  assert.equal(failure.failureCode, 'runtime-handshake-timeout');
  assert.equal(failure.message, 'Map preview runtime startup timed out during runtime-process-started.');
  assert.doesNotMatch(failure.message, /Runtime output|Unable to decode PNG/);
});

test('returns structured runtime failure details with project-relative resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-diagnostic-'));
  try {
    const source = path.join(root, 'source');
    const isolated = path.join(root, 'isolated');
    fs.mkdirSync(source);
    fs.mkdirSync(isolated);
    const snapshot = preparation(source, isolated);
    const missingFromIsolated = path.join(isolated, 'www', 'img', 'characters', 'Missing Actor.png');
    const missingFromSource = path.join(source, 'www', 'img', 'tilesets', 'Example.png');
    const external = path.join(os.tmpdir(), 'outside-preview', 'private.png');
    const detail = mapPreviewRuntimeFailureDetail({
      stage: 'renderer-resources',
      operationId: 4,
      sourceMapId: 2,
      targetMapId: 3,
      scene: 'Scene_Map',
      transferring: false,
      resourcesReady: false,
      resources: [pathToFileURL(missingFromIsolated).href, missingFromSource, external],
      message: `Failed at ${missingFromIsolated}`,
    }, snapshot);

    assert.equal(detail.stage, 'renderer-resources');
    assert.equal(detail.operationId, 4);
    assert.equal(detail.sourceMapId, 2);
    assert.equal(detail.targetMapId, 3);
    assert.deepEqual(detail.resources, [
      'img/characters/Missing Actor.png',
      'img/tilesets/Example.png',
      '[external-path]',
    ]);
    assert.equal(detail.message, 'Failed at img/characters/Missing Actor.png');
    assert.doesNotMatch(JSON.stringify(detail), new RegExp(escapeForTest(root), 'i'));

    const partialDetail = mapPreviewRuntimeFailureDetail({
      stage: 'runtime-process-started',
      targetMapId: 3,
      message: 'Runtime stopped',
    }, snapshot);
    assert.equal('transferring' in partialDetail, false);
    assert.equal('resourcesReady' in partialDetail, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('redacts browser profiles and encoded project paths from diagnostic text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-redact-'));
  try {
    const source = path.join(root, 'source project');
    const isolated = path.join(root, 'isolated project');
    fs.mkdirSync(source);
    fs.mkdirSync(isolated);
    const snapshot = preparation(source, isolated);
    const profile = path.join(isolated, '.rpg-agent-preview-profile-session', 'Cache', 'entry');
    const encodedAsset = pathToFileURL(path.join(source, 'www', 'img', 'pictures', 'Example File.png')).href;
    const result = sanitizeMapPreviewDiagnosticText(`${profile}\n${encodedAsset}`, snapshot);

    assert.match(result, /\[preview-profile\]\/Cache\/entry/);
    assert.match(result, /img\/pictures\/Example%20File\.png/);
    assert.doesNotMatch(result, /source project|isolated project|[A-Z]:\\/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function escapeForTest(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('allows only map data and MapInfos changes to reuse a warm preview', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-classify-'));
  try {
    fs.mkdirSync(path.join(root, 'www', 'data'), { recursive: true });
    const safe = classifyWarmPreviewPaths(root, [
      'www/data/Map004.json',
      'www/data/MapInfos.json',
      'www/data/Map021.json',
    ]);
    assert.deepEqual([...safe.changedMapIds], [4, 21]);
    assert.equal(safe.mapInfosChanged, true);
    assert.deepEqual(safe.unsafePaths, []);

    const unsafe = classifyWarmPreviewPaths(root, [
      'www/data/System.json',
      'www/js/plugins.js',
      'www/img/tilesets/Example.png',
    ]);
    assert.deepEqual([...unsafe.changedMapIds], []);
    assert.equal(unsafe.mapInfosChanged, false);
    assert.deepEqual(unsafe.unsafePaths, [
      'www/data/System.json',
      'www/js/plugins.js',
      'www/img/tilesets/Example.png',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
