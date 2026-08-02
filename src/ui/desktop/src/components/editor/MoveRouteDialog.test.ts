import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./MoveRouteDialog.vue', import.meta.url), 'utf8');

describe('movement route audio picker', () => {
  test('uses the plugin file picker for SE and writes only the name field', () => {
    assert.match(source, /PluginParameterFilePickerDialog/);
    assert.match(source, /directory="audio\/se"/);
    assert.match(source, /media="audio"/);
    assert.match(source, /:z-index="LAYER_Z\.pluginParameterDialog"/);
    assert.match(source, /@commit="commitSeSelection"/);
    assert.match(source, /isTopmostEditorDialog\(LAYER_Z\.subDialog\)/);
    assert.match(source, /setSeParam\('name', name\)/);
    assert.match(source, /setSeParam\('volume', numberValue/);
    assert.match(source, /setSeParam\('pitch', numberValue/);
    assert.match(source, /setSeParam\('pan', numberValue/);
  });
});
