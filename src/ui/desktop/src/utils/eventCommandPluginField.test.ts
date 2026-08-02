import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CommandField } from '../composables/eventCommandCatalog';
import { commandFieldToPluginParameterField } from './eventCommandPluginField';

function field(partial: Partial<CommandField>): CommandField {
  return {
    label: '字段',
    path: [0],
    kind: 'text',
    ...partial,
  } as CommandField;
}

describe('event command plugin field adapter', () => {
  test('maps database catalogs to the existing plugin field tables', () => {
    assert.deepEqual(
      commandFieldToPluginParameterField(field({ kind: 'database', catalog: 'switches' })),
      {
        key: '0',
        label: '字段',
        description: '',
        kind: 'database',
        rawType: 'System.switches',
        databaseTable: 'System.switches',
      },
    );
    assert.equal(
      commandFieldToPluginParameterField(field({ kind: 'database', catalog: 'maps' }))?.kind,
      'map',
    );
    assert.equal(
      commandFieldToPluginParameterField(field({ kind: 'database', catalog: 'animations' }))?.databaseTable,
      'Animations',
    );
  });

  test('maps project asset buckets to the plugin file picker media directories', () => {
    assert.deepEqual(
      commandFieldToPluginParameterField(field({ kind: 'asset', asset: 'se', path: [0, 'name'] })),
      {
        key: '0.name',
        label: '字段',
        description: '',
        kind: 'file',
        rawType: 'file',
        directory: 'audio/se',
      },
    );
    assert.equal(
      commandFieldToPluginParameterField(field({ kind: 'asset', asset: 'pictures' }))?.directory,
      'img/pictures',
    );
  });

  test('leaves event-only or unknown catalogs on their existing specialized controls', () => {
    assert.equal(
      commandFieldToPluginParameterField(field({ kind: 'database', catalog: 'equipTypes' })),
      null,
    );
    assert.equal(
      commandFieldToPluginParameterField(field({ kind: 'asset', asset: 'unknown' as never })),
      null,
    );
    assert.equal(commandFieldToPluginParameterField(field({ kind: 'eventTarget' })), null);
  });
});
