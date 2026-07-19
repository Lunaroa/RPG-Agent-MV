import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./map-brush-edit.ts', import.meta.url), 'utf8');

describe('interactive map brush autotile scope', () => {
  test('uses the shared affected-neighbour policy for persisted strokes', () => {
    assert.match(source, /autotileResolution: RMMV_INTERACTIVE_AUTOTILE_RESOLUTION/);
    assert.doesNotMatch(source, /autotileResolution:\s*['"]full['"]/);
  });
});
