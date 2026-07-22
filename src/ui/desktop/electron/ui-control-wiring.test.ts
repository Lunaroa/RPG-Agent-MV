import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('./ui-control-bridge.ts', import.meta.url), 'utf8');
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
    assert.match(bridgeSource, /'pointer'/);
    assert.match(bridgeSource, /pointer command requires phase down, move, or up/);
    assert.match(bridgeSource, /command\.offsetX = offsetX/);
    assert.match(bridgeSource, /command\.offsetY = offsetY/);
    assert.match(bridgeSource, /pointer command button must be 0, 1, or 2/);
    assert.match(bridgeSource, /command\.button = button/);
    assert.doesNotMatch(mainSource, /pointer command requires phase/);
  });

  test('allows the standalone map overview route in the background validator', () => {
    assert.match(bridgeSource, /'map-overview'/);
  });
});
