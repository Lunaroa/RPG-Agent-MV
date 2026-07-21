import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bottomPanel = readFileSync(new URL('./BottomPanel.vue', import.meta.url), 'utf8');
const previewConsole = readFileSync(new URL('./PreviewConsolePanel.vue', import.meta.url), 'utf8');
const toolbar = readFileSync(new URL('./EditorToolbar.vue', import.meta.url), 'utf8');
const terminalTypes = readFileSync(new URL('./previewTerminal.ts', import.meta.url), 'utf8');

test('shares one bottom workbench shell between placement and preview', () => {
  assert.match(bottomPanel, /EditorBottomWorkbench/);
  assert.match(previewConsole, /EditorBottomWorkbench/);
  assert.match(previewConsole, /editor\.preview\.workbench/);
});

test('keeps the preview toolbar free of terminal controls', () => {
  assert.doesNotMatch(toolbar, /TerminalIcon|preview-console|toggle-preview-console/);
});

test('uses a continuous terminal with temporary keyboard find and local command entries', () => {
  assert.match(previewConsole, /@keydown\.ctrl\.f\.prevent="openFind"/);
  assert.match(previewConsole, /@keydown\.ctrl\.enter\.prevent="execute"/);
  assert.match(previewConsole, /class="terminal-scroll"[\s\S]*class="terminal-transcript"[\s\S]*class="terminal-prompt"/);
  assert.doesNotMatch(previewConsole, /class="terminal-output"/);
  assert.doesNotMatch(previewConsole, /border-top:1px solid #292f37/);
  assert.match(previewConsole, /MAX_INPUT_LINES = 6/);
  assert.match(previewConsole, /rows="1"/);
  assert.match(previewConsole, /Math\.max\(lineHeight, Math\.min\(input\.scrollHeight \|\| lineHeight, maxHeight\)\)/);
  assert.match(previewConsole, /isPreviewTerminalNearBottom\(terminal\)/);
  assert.doesNotMatch(previewConsole, /Search|Magnif|consoleFilter/);
  assert.match(terminalTypes, /MapPreviewConsoleLevel \| 'command'/);
  assert.match(terminalTypes, /MapPreviewConsoleEntry\['source'\] \| 'input'/);
});
