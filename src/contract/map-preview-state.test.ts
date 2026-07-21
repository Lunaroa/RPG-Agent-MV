import assert from 'node:assert/strict';
import test from 'node:test';

import { mapPreviewSelfSwitchKey, parseMapPreviewSelfSwitchKey, parseMapPreviewVariableInput } from './map-preview-state.ts';

test('parses preview variable input as a finite number or the original string', () => {
  assert.equal(parseMapPreviewVariableInput('001'), 1);
  assert.equal(parseMapPreviewVariableInput('1e3'), 1000);
  assert.equal(parseMapPreviewVariableInput(' 12 '), 12);
  assert.equal(parseMapPreviewVariableInput(''), '');
  assert.equal(parseMapPreviewVariableInput('   '), '');
  assert.equal(parseMapPreviewVariableInput('  plain text  '), '  plain text  ');
  assert.equal(parseMapPreviewVariableInput('Infinity'), 'Infinity');
});

test('accepts only canonical positive self switch keys', () => {
  assert.equal(mapPreviewSelfSwitchKey(1, 16, 'A'), '1,16,A');
  assert.deepEqual(parseMapPreviewSelfSwitchKey('1,16,D'), { mapId: 1, eventId: 16, letter: 'D' });
  assert.equal(parseMapPreviewSelfSwitchKey('0,16,A'), null);
  assert.equal(parseMapPreviewSelfSwitchKey('1,16,E'), null);
  assert.equal(parseMapPreviewSelfSwitchKey('01,16,A'), null);
});
