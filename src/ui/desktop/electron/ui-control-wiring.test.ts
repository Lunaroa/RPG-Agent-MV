import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('./ui-control-bridge.ts', import.meta.url), 'utf8');
const commandSource = readFileSync(new URL('./ui-control-command.ts', import.meta.url), 'utf8');
const launcherSource = readFileSync(new URL('../scripts/start-ui-control.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts?: Record<string, string> };

describe('background UI control wiring', () => {
  test('keeps ordinary development separate from the explicit validator launcher', () => {
    assert.equal(packageJson.scripts?.dev, 'vite');
    assert.equal(packageJson.scripts?.['dev:ui-control'], 'node scripts/start-ui-control.mjs');
    assert.match(launcherSource, /AGENT_RPG_UI_CONTROL: '1'/);
    assert.match(launcherSource, /AGENT_RPG_ROOT:/);
  });

  test('loads the hidden renderer before exposing the bridge and uses in-memory workspace settings', () => {
    assert.match(mainSource, /inMemoryWorkspaceSettings: backgroundUiControlMode/);
    assert.match(mainSource, /screen\.getPrimaryDisplay\(\)\.workArea/);
    assert.match(mainSource, /useContentSize: windowPolicy\.useContentSize/);
    assert.match(mainSource, /await mainWindow\.load(?:URL|File)[\s\S]+await startUiControlBridge/);
    assert.match(mainSource, /if \(!backgroundUiControlMode\) initAutoUpdater/);
    assert.doesNotMatch(mainSource, /offscreen\s*:/);
  });

  test('never shows, restores, or focuses the capture target', () => {
    assert.match(bridgeSource, /assertBackgroundWindowState\(win\)/);
    assert.match(bridgeSource, /captureBackgroundPage\(win\)/);
    assert.match(bridgeSource, /layout: 'primary-work-area'/);
    assert.doesNotMatch(bridgeSource, /win\.(?:show|showInactive|restore|focus)\s*\(/);
  });

  test('keeps pointer phases available only through the background validator bridge', () => {
    assert.match(bridgeSource, /normalizeUiControlCommand/);
    assert.match(commandSource, /'pointer'/);
    assert.match(commandSource, /pointer command requires phase down, move, or up/);
    assert.match(commandSource, /command\.offsetX = offsetX/);
    assert.match(commandSource, /command\.offsetY = offsetY/);
    assert.match(commandSource, /pointer command button must be 0, 1, or 2/);
    assert.match(commandSource, /command\.button = button/);
    assert.doesNotMatch(mainSource, /pointer command requires phase/);
  });

  test('allows the standalone map overview route in the background validator', () => {
    assert.match(commandSource, /'map-overview'/);
  });

  test('keeps product plugin routes available through the hidden validator', () => {
    assert.match(commandSource, /'plugin-marketplace'/);
    assert.match(commandSource, /'ui-designer'/);
    assert.match(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'), /'plugin-marketplace': \{ path: '\/plugin-marketplace' \}/);
    assert.match(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'), /'ui-designer': \{ path: '\/ui-designer' \}/);
  });

  test('exposes only bounded read-only particle diagnostics from the isolated frame', () => {
    assert.match(bridgeSource, /var particleLimit = 32/);
    assert.match(bridgeSource, /scene && scene\._mzuiCanvasRuntime/);
    assert.match(bridgeSource, /layerType:/);
    assert.match(bridgeSource, /childType:/);
    assert.match(bridgeSource, /particlePooled/);
    assert.doesNotMatch(bridgeSource, /PREVIEW_FRAME_DIAGNOSTIC_SCRIPT[\s\S]*command\.(?:script|code|expression)/);
  });
});
