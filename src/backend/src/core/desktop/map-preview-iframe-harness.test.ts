import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { injectMapPreviewIframeHarness } from './map-preview-iframe-harness.ts';

const options = {
  sessionId: 'preview-session',
  channelToken: 'channel-token',
  mapId: 3,
  mapRevision: 'revision-a',
  operationId: 1,
  viewportWidth: 816,
  viewportHeight: 624,
  tileSize: 48,
  geometry: { pixelWidth: 960, pixelHeight: 720 },
  overrides: { switches: { '2': true }, variables: { '4': 9 }, selfSwitches: {} },
};

test('injects the immutable preview marker before every project script', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.indexOf('rpg-agent-preview-marker.js') < html.indexOf('js/plugins.js'));
    assert.ok(html.indexOf('rpg-agent-preview-iframe.js') < html.indexOf('js/main.js'));

    const marker = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-marker.js'), 'utf8');
    const context = vm.createContext({ window: {} });
    vm.runInContext(marker, context);
    const descriptor = Object.getOwnPropertyDescriptor((context as any).window, '__rpg_agent_debugger__');
    assert.deepEqual(
      descriptor && { value: descriptor.value, writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable },
      { value: true, writable: false, enumerable: false, configurable: false },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adds the iframe harness to the MZ dynamic loader after plugins', () => {
  const root = fixture('mz');
  try {
    injectMapPreviewIframeHarness(root, options);
    const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
    assert.match(main, /"js\/plugins\.js",\s*"js\/rpg-agent-preview-iframe\.js"/);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.equal((html.match(/rpg-agent-preview-iframe\.js/g) || []).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps native event movement while gating interpreters and player triggers', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    assert.doesNotMatch(harness, /Game_Event\.prototype\.update = function/);
    assert.doesNotMatch(harness, /Game_Event\.prototype\.updateSelfMovement = function/);
    assert.match(harness, /if \(canExecuteEvents\(\) && originalEventStart\)/);
    assert.match(harness, /if \(canExecuteEvents\(\)\) return originalInterpreterUpdate/);
    assert.match(harness, /if \(canExecuteEvents\(\)\) return originalUpdateParallel/);
    assert.match(harness, /Game_Player\.prototype\.canMove = function \(\) \{ return false; \}/);
    assert.match(harness, /requestAnimationFrame\(fpsLoop\)/);
    assert.match(harness, /suspended \|\| loading \|\| !initialized \|\| runtimeStage !== 'ready'/);
    assert.match(harness, /runtimeStage = 'ready';\s*loading = false;\s*resetFpsSample\(\);\s*post\('ready'/);
    assert.doesNotMatch(harness, /SceneManager\._scene instanceof Scene_Map/);
    assert.doesNotMatch(harness, /RTCPeerConnection|captureStream|toDataURL|toBlob|WebCodecs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticates parent commands with both session and channel token', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    assert.match(harness, /event\.source !== window\.parent/);
    assert.match(harness, /command\.sessionId !== config\.sessionId/);
    assert.match(harness, /command\.channelToken !== config\.channelToken/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('captures console output and evaluates code only through authenticated frame commands', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    assert.match(harness, /\['debug', 'log', 'info', 'warn', 'error'\]/);
    assert.match(harness, /return original\.apply\(console, values\)/);
    assert.match(harness, /seen\.indexOf\(value\) >= 0/);
    assert.match(harness, /\u2026\[truncated\]/);
    assert.match(harness, /var result = \(0, eval\)/);
    assert.match(harness, /typeof result\.then === 'function'/);
    assert.match(harness, /command\.type === 'evaluate'/);
    assert.match(harness, /postConsole\('error', 'exception'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('supports checkpointed event execution, finite input, and runtime map transfer messages', () => {
  const root = fixture('mz');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    assert.match(harness, /command\.type === 'set-event-execution'/);
    assert.match(harness, /captureExecutionCheckpoint\(\)/);
    assert.match(harness, /restoreExecutionCheckpoint\('execution-disabled'\)/);
    assert.match(harness, /command\.type === 'input-key'/);
    assert.match(harness, /message\.isNumberInput/);
    assert.match(harness, /message\.isItemChoice/);
    assert.match(harness, /scene instanceof Scene_Name/);
    assert.match(harness, /post\('input-waiting'/);
    assert.match(harness, /post\('runtime-map-changed'/);
    assert.match(harness, /reason: 'event-transfer'/);
    assert.match(harness, /recoverExecutionError/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports event state and validates standard current-map self switches', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    assert.match(harness, /eventStates\.push/);
    assert.match(harness, /active: active/);
    assert.match(harness, /visible: Boolean\(active && !event\._erased/);
    assert.match(harness, /\^\[1-9\]\\d\*,\[1-9\]\\d\*,\[ABCD\]\$/);
    assert.match(harness, /\$gameSelfSwitches\.setValue\(key\.split\(','\)/);
    assert.match(harness, /baselineUnsupportedVariableTypes/);
    assert.match(harness, /hasOwnProperty\.call\(baselineUnsupportedVariableTypes, id\)\) return/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recreates engine game state on map switches and reloads before reapplying preview overrides', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    const reset = harness.indexOf('resetEventExecution();', harness.indexOf('async function loadMap'));
    const setup = harness.indexOf('DataManager.setupNewGame();', reset);
    const baseline = harness.indexOf('captureBaseline();', setup);
    const overrides = harness.indexOf('applyOverrides(command.overrides || {});', baseline);
    const transfer = harness.indexOf('$gamePlayer.reserveTransfer(currentTargetMapId', overrides);
    assert.ok(reset >= 0);
    assert.ok(reset < setup && setup < baseline && baseline < overrides && overrides < transfer);
    assert.match(harness, /command\.purpose === 'switch' \|\| command\.purpose === 'reload'/);
    assert.match(harness, /reportLoadingStage\('resetting-game-state'\)/);
    assert.match(harness, /reportLoadingStage\('loading-map-resources'\)/);
    assert.match(harness, /loading = false;[\s\S]*post\('ready'/);
    assert.doesNotMatch(
      harness.slice(harness.indexOf('async function loadMap'), harness.indexOf('function handleCommand')),
      /if \(!initialized\)[\s\S]*restoreBaseline\(\)/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('upgrades only oversized MV WebGL tile layers to 32-bit indices', () => {
  const root = fixture('mv');
  try {
    injectMapPreviewIframeHarness(root, options);
    const harness = fs.readFileSync(path.join(root, 'js', 'rpg-agent-preview-iframe.js'), 'utf8');
    assert.match(harness, /Utils\.RPGMAKER_NAME !== 'MV'/);
    assert.match(harness, /count \* 4 > 65535/);
    assert.match(harness, /this\.indices instanceof Uint32Array/);
    assert.match(harness, /var IndexArray = requiresUint32 \? Uint32Array : Uint16Array/);
    assert.match(harness, /gl\.getExtension\('OES_element_index_uint'\)/);
    assert.match(harness, /gl\.UNSIGNED_INT : gl\.UNSIGNED_SHORT/);
    assert.match(harness, /render-full-map-tilemap/);
    assert.match(harness, /installMvFullMapTilemapSupport\(\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(engine: 'mv' | 'mz'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-preview-iframe-'));
  fs.mkdirSync(path.join(root, 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><script src="js/plugins.js"></script><script src="js/main.js"></script>',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'js', 'plugins.js'), '', 'utf8');
  fs.writeFileSync(
    path.join(root, 'js', 'main.js'),
    engine === 'mz'
      ? 'const scriptUrls = ["js/libs/effekseer.min.js", "js/plugins.js"];'
      : 'PluginManager.setup($plugins); SceneManager.run(Scene_Boot);',
    'utf8',
  );
  return root;
}
