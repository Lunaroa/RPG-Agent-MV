import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  buildDesktopWindowPolicy,
  isBackgroundUiControlMode,
  uiControlProfilePath,
} from './ui-control-mode.ts';

describe('UI control window mode', () => {
  test('requires explicit background opt-in', () => {
    assert.equal(isBackgroundUiControlMode({}), false);
    assert.equal(isBackgroundUiControlMode({ VITE_DEV_SERVER_URL: 'http://localhost:5173' }), false);
    assert.equal(isBackgroundUiControlMode({ AGENT_RPG_UI_CONTROL: '0' }), false);
    assert.equal(isBackgroundUiControlMode({ AGENT_RPG_UI_CONTROL: '1' }), true);
  });

  test('keeps normal development visible and persistent', () => {
    const policy = buildDesktopWindowPolicy({ width: 1440, height: 900, x: 12, y: 24, shouldMaximize: true }, false);
    assert.deepEqual(policy, {
      backgroundUiControl: false,
      width: 1440,
      height: 900,
      x: 12,
      y: 24,
      show: true,
      skipTaskbar: false,
      focusable: true,
      paintWhenInitiallyHidden: true,
      backgroundThrottling: true,
      useContentSize: false,
      shouldMaximize: true,
      persistWindowState: true,
    });
  });

  test('uses the primary work area as a hidden maximized-layout viewport', () => {
    const policy = buildDesktopWindowPolicy(
      { width: 1280, height: 800, x: 50, y: 70, shouldMaximize: true },
      true,
      { x: 0, y: 0, width: 1920, height: 1040 },
    );
    assert.equal(policy.width, 1920);
    assert.equal(policy.height, 1040);
    assert.equal(policy.show, false);
    assert.equal(policy.skipTaskbar, true);
    assert.equal(policy.focusable, false);
    assert.equal(policy.paintWhenInitiallyHidden, true);
    assert.equal(policy.backgroundThrottling, false);
    assert.equal(policy.useContentSize, true);
    assert.equal(policy.shouldMaximize, false);
    assert.equal(policy.persistWindowState, false);
    assert.equal(policy.x, 0);
    assert.equal(policy.y, 0);

    const root = path.join(path.parse(process.cwd()).root, 'workspace', 'sample');
    assert.equal(
      uiControlProfilePath(root),
      path.join(root, 'runtime', 'out', 'ui-control', 'electron-profile'),
    );
  });

  test('fails fast when the primary work area is unavailable', () => {
    assert.throws(
      () => buildDesktopWindowPolicy({ width: 1280, height: 800, shouldMaximize: false }, true),
      /valid primary display work area/,
    );
  });
});
