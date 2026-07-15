import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./TroopFormationCanvas.vue', import.meta.url), 'utf8');

describe('TroopFormationCanvas pointer lifecycle', () => {
  test('cancels interrupted drags instead of committing their last pointer position', () => {
    assert.match(source, /@pointerup="finishDrag"/);
    assert.match(source, /@pointercancel="cancelDrag"/);
    assert.match(source, /function cancelDrag[\s\S]*?drag = null;[\s\S]*?renderFormation\(\);/);
    assert.doesNotMatch(source, /@pointercancel="finishDrag"/);
  });
});
