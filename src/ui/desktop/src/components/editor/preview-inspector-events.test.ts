import assert from 'node:assert/strict';
import test from 'node:test';

import { filterPreviewSelfSwitchEvents, previewEventMatchesQuery } from './previewInspectorEvents.ts';

const events = [
  { id: 16, name: 'Gate Keeper', note: '', x: 4, y: 7 },
  { id: 21, name: 'Sample Event', note: '', x: 8, y: 9 },
];

test('matches self-switch events by bare, padded, displayed ID, and name', () => {
  for (const query of ['16', '016', 'EV016', 'ev016', 'keeper']) {
    assert.equal(previewEventMatchesQuery(events[0], query), true, query);
  }
  assert.equal(previewEventMatchesQuery(events[0], '21'), false);
  assert.deepEqual(filterPreviewSelfSwitchEvents(events, 'sample'), [events[1]]);
  assert.deepEqual(filterPreviewSelfSwitchEvents(events, ''), events);
});
