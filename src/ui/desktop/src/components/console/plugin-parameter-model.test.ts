import { describe, expect, test } from 'vitest';
import { reactive } from 'vue';
import type {
  EditorProjectCatalog,
  ManagedPluginEntry,
  PluginHeaderMetadata,
  PluginParameterSchemaField,
} from '../../api/client';
import {
  buildPluginParameterPayload,
  buildPluginParameterRows,
  clonePluginParameterValue,
  createPluginParameterForm,
  pluginParameterPayloadsEqual,
} from './plugin-parameter-model';

const labels = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  empty: 'Empty',
  itemCount: (count: number) => `${count} items`,
  structuredValue: 'Edit structured value',
  location: (map: string, x: number, y: number) => `${map} (${x}, ${y})`,
};

const header: PluginHeaderMetadata = {
  target: ['MZ'],
  plugindesc: 'Parameter fixture.',
  help: '',
  helpSections: [],
  author: '',
  url: '',
  base: [],
  orderAfter: [],
  displayPath: 'js/plugins/ParameterFixture.js',
};

function field(
  key: string,
  kind: PluginParameterSchemaField['kind'],
  extra: Partial<PluginParameterSchemaField> = {},
): PluginParameterSchemaField {
  return {
    key,
    label: key,
    kind,
    description: '',
    ...extra,
  };
}

function pluginFixture(): ManagedPluginEntry {
  return {
    index: 0,
    name: 'ParameterFixture',
    status: true,
    description: '',
    parameters: {
      enabled: 'true',
      mode: 'safe',
      actorId: '2',
      position: '{"mapId":3,"x":4,"y":5}',
      settings: '{"title":"Ready","speed":"3"}',
      levels: '["1","5"]',
      unsupported: '{"kept":true}',
      legacy: 'preserve me',
    },
    parameterCount: 8,
    fileName: 'ParameterFixture.js',
    fileRelativePath: 'js/plugins/ParameterFixture.js',
    fileExists: true,
    parameterSchema: {
      source: 'rmmv-plugin-header',
      warnings: [],
      fields: [
        field('enabled', 'boolean', {
          options: [
            { label: 'On', value: 'true' },
            { label: 'Off', value: 'false' },
          ],
        }),
        field('mode', 'select', {
          options: [
            { label: 'Safe Mode', value: 'safe' },
            { label: 'Fast Mode', value: 'fast' },
          ],
        }),
        field('actorId', 'database', { databaseTable: 'Actors' }),
        field('position', 'location'),
        field('settings', 'struct', {
          fields: [
            field('title', 'text'),
            field('speed', 'number'),
          ],
        }),
        field('levels', 'array', {
          item: field('$item', 'number'),
        }),
        field('unsupported', 'json', {
          editable: false,
          unsupportedReason: 'Unsupported parameter type.',
        }),
      ],
    },
    parameterSchemaWarnings: [],
    commandHints: [],
    targets: ['MZ'],
    header,
  };
}

const catalog = {
  actors: [{ id: 2, name: 'Sample Actor' }],
  maps: [{ id: 3, name: 'Sample Map' }],
} as EditorProjectCatalog;

describe('plugin parameter model', () => {
  test('clones reactive plugin parameters without throwing before the dialog opens', () => {
    const plugin = reactive(pluginFixture()) as ManagedPluginEntry;

    expect(clonePluginParameterValue(reactive({
      enabled: 'true',
      nested: { value: 'sample' },
      entries: ['first'],
    }))).toEqual({
      enabled: 'true',
      nested: { value: 'sample' },
      entries: ['first'],
    });

    const form = reactive(createPluginParameterForm(plugin));
    expect(form.settings).toEqual({ title: 'Ready', speed: '3' });
    form.settings = { title: 'Changed', speed: '7' };

    expect(buildPluginParameterPayload(plugin, form)).toMatchObject({
      settings: '{"title":"Changed","speed":"7"}',
      unsupported: '{"kept":true}',
      legacy: 'preserve me',
    });
  });

  test('builds schema rows first and appends unknown configuration parameters as readonly', () => {
    const plugin = pluginFixture();
    const form = createPluginParameterForm(plugin);
    const rows = buildPluginParameterRows(plugin, form, catalog, labels, 'Readonly');

    expect(rows.map((row) => row.key)).toEqual([
      'enabled',
      'mode',
      'actorId',
      'position',
      'settings',
      'levels',
      'unsupported',
      'legacy',
    ]);
    expect(rows.find((row) => row.key === 'enabled')?.summary).toBe('On');
    expect(rows.find((row) => row.key === 'mode')?.summary).toBe('Safe Mode');
    expect(rows.find((row) => row.key === 'actorId')?.summary).toBe('2 · Sample Actor');
    expect(rows.find((row) => row.key === 'position')?.summary).toBe('3 · Sample Map (4, 5)');
    expect(rows.find((row) => row.key === 'levels')?.summary).toBe('2 items');
    expect(rows.find((row) => row.key === 'unsupported')?.editable).toBe(false);
    expect(rows.find((row) => row.key === 'legacy')?.editable).toBe(false);
  });

  test('overwrites only editable schema fields while preserving readonly and unknown values', () => {
    const plugin = pluginFixture();
    const form = createPluginParameterForm(plugin);
    form.enabled = 'false';
    form.settings = { title: 'Changed', speed: '7' };
    form.levels = ['2', '8'];
    form.unsupported = '{"changed":true}';
    form.legacy = 'changed';

    const payload = buildPluginParameterPayload(plugin, form);
    expect(payload.enabled).toBe('false');
    expect(payload.settings).toBe('{"title":"Changed","speed":"7"}');
    expect(payload.levels).toBe('["2","8"]');
    expect(payload.unsupported).toBe('{"kept":true}');
    expect(payload.legacy).toBe('preserve me');
  });

  test('round-trips nested struct arrays without exposing their encoded storage format', () => {
    const plugin = pluginFixture();
    const entry = field('$item', 'struct', {
      fields: [
        field('title', 'text'),
        field('enabled', 'boolean'),
      ],
    });
    plugin.parameterSchema!.fields = [
      field('entries', 'array', { item: entry }),
    ];
    plugin.parameters = {
      entries: '["{\\"title\\":\\"First\\",\\"enabled\\":\\"true\\"}"]',
      untouched: 'keep',
    };

    const form = createPluginParameterForm(plugin);
    expect(form.entries).toEqual([{ title: 'First', enabled: 'true' }]);
    (form.entries as Array<Record<string, unknown>>)[0].enabled = 'false';

    expect(buildPluginParameterPayload(plugin, form)).toEqual({
      entries: '["{\\"title\\":\\"First\\",\\"enabled\\":\\"false\\"}"]',
      untouched: 'keep',
    });
  });

  test('compares payloads independent of object key insertion order', () => {
    expect(pluginParameterPayloadsEqual(
      { first: '1', nested: { second: 2, third: 3 } },
      { nested: { third: 3, second: 2 }, first: '1' },
    )).toBe(true);
  });

  test('makes every row readonly when the plugin file is missing', () => {
    const plugin = pluginFixture();
    plugin.fileExists = false;
    const rows = buildPluginParameterRows(
      plugin,
      createPluginParameterForm(plugin),
      catalog,
      labels,
      'Readonly',
    );
    expect(rows.every((row) => !row.editable)).toBe(true);
    expect(buildPluginParameterPayload(plugin, {})).toEqual(plugin.parameters);
  });
});
