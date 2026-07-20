import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  desktopDevToolsShortcut,
  registerDesktopDevToolsShortcuts,
  type DesktopDevToolsInput,
} from './desktop-devtools-shortcuts.ts';

test('maps only focused non-repeating F12 key-down shortcuts', () => {
  assert.equal(desktopDevToolsShortcut(input()), 'editor');
  assert.equal(desktopDevToolsShortcut(input({ shift: true })), 'map-preview');
  assert.equal(desktopDevToolsShortcut(input({ type: 'keyUp' })), null);
  assert.equal(desktopDevToolsShortcut(input({ key: 'F11' })), null);
  assert.equal(desktopDevToolsShortcut(input({ isAutoRepeat: true })), null);
  assert.equal(desktopDevToolsShortcut(input({ control: true })), null);
  assert.equal(desktopDevToolsShortcut(input({ alt: true })), null);
  assert.equal(desktopDevToolsShortcut(input({ meta: true })), null);
});

test('toggles detached editor tools without invoking map preview', async () => {
  const harness = shortcutHarness();
  harness.dispatch(input());
  assert.equal(harness.prevented, 1);
  assert.deepEqual(harness.editorActions, [{ mode: 'detach', activate: true }]);
  assert.equal(harness.previewCalls, 0);

  harness.devToolsOpened = true;
  harness.dispatch(input());
  assert.deepEqual(harness.editorActions, [{ mode: 'detach', activate: true }, 'close']);
});

test('routes Shift+F12 to the warm preview without touching editor tools', async () => {
  const harness = shortcutHarness({ status: 'opened' });
  harness.dispatch(input({ shift: true }));
  await Promise.resolve();
  assert.equal(harness.prevented, 1);
  assert.equal(harness.previewCalls, 1);
  assert.deepEqual(harness.previewResults, [{ status: 'opened' }]);
  assert.deepEqual(harness.editorActions, []);
});

test('wires shortcuts only into the normal desktop window without a global accelerator', () => {
  const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const preloadSource = readFileSync(new URL('./preload.ts', import.meta.url), 'utf8');
  assert.match(
    mainSource,
    /if \(!backgroundUiControlMode\) \{[\s\S]{0,200}registerDesktopDevToolsShortcuts\(mainWindow\.webContents/,
  );
  assert.match(mainSource, /toggleMapPreview: toggleMapPreviewDevTools/);
  assert.doesNotMatch(mainSource, /globalShortcut/);
  assert.doesNotMatch(preloadSource, /toggleDevTools|openDevTools/);
});

function input(patch: Partial<DesktopDevToolsInput> = {}): DesktopDevToolsInput {
  return {
    type: 'keyDown',
    key: 'F12',
    shift: false,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false,
    ...patch,
  };
}

function shortcutHarness(previewResult: { status: 'opened' } = { status: 'opened' }) {
  let listener: ((event: { preventDefault(): void }, input: DesktopDevToolsInput) => void) | null = null;
  const state = {
    prevented: 0,
    previewCalls: 0,
    previewResults: [] as unknown[],
    previewErrors: [] as unknown[],
    editorActions: [] as unknown[],
    devToolsOpened: false,
    dispatch(value: DesktopDevToolsInput) {
      assert.ok(listener);
      listener({ preventDefault: () => { state.prevented += 1; } }, value);
    },
  };
  registerDesktopDevToolsShortcuts({
    on(_event, value) { listener = value; },
    isDevToolsOpened: () => state.devToolsOpened,
    openDevTools: (options) => { state.editorActions.push(options); },
    closeDevTools: () => { state.editorActions.push('close'); },
  }, {
    async toggleMapPreview() { state.previewCalls += 1; return previewResult; },
    onMapPreviewResult(result) { state.previewResults.push(result); },
    onMapPreviewError(error) { state.previewErrors.push(error); },
  });
  return state;
}
