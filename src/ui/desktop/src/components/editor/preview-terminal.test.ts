import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendPreviewTerminalEntry,
  isPreviewTerminalNearBottom,
  previewTerminalEntryMatches,
  type PreviewTerminalEntry,
} from './previewTerminal.ts';

function entry(id: number, text = `line ${id}`): PreviewTerminalEntry {
  return { id, level: 'log', source: 'console', timestamp: id, text };
}

test('keeps the newest preview terminal entries within the session cap', () => {
  let entries: PreviewTerminalEntry[] = [];
  for (let id = 1; id <= 505; id += 1) entries = appendPreviewTerminalEntry(entries, entry(id));
  assert.equal(entries.length, 500);
  assert.equal(entries[0]?.id, 6);
  assert.equal(entries.at(-1)?.id, 505);
});

test('matches terminal text without requiring a permanent search control', () => {
  const command: PreviewTerminalEntry = { id: 1, level: 'command', source: 'input', timestamp: 1, text: '$gameMap.mapId()', requestId: '1-1' };
  assert.equal(previewTerminalEntryMatches(command, 'MAPID'), true);
  assert.equal(previewTerminalEntryMatches(command, '1-1'), true);
  assert.equal(previewTerminalEntryMatches(command, 'missing'), false);
});

test('auto-scrolls only while the output is already near the bottom', () => {
  assert.equal(isPreviewTerminalNearBottom({ scrollTop: 384, clientHeight: 100, scrollHeight: 500 }), true);
  assert.equal(isPreviewTerminalNearBottom({ scrollTop: 200, clientHeight: 100, scrollHeight: 500 }), false);
});
