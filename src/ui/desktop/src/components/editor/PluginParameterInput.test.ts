import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./PluginParameterInput.vue', import.meta.url), 'utf8');

describe('nested plugin parameter picker layers', () => {
  test('forwards the parent picker layer through struct and array inputs', () => {
    const recursiveInputs = source.match(/<PluginParameterInput[\s\S]*?\/>/g) || [];
    assert.equal(recursiveInputs.length, 2);
    assert.equal(
      recursiveInputs.filter((input) => input.includes(':overlay-z-index="pickerLayerZ"')).length,
      2,
    );
  });
});
