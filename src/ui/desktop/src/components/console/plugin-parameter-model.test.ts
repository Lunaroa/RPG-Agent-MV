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
  createDefaultPluginParameterValue,
  createPluginParameterForm,
  isPluginParameterSchemaFieldEditable,
  isSpecialPluginParameterType,
  normalizePluginParameterValue,
  pluginParameterPayloadsEqual,
  removePluginParameterArrayItem,
  replacePluginParameterChildValue,
  serializePluginParameterValue,
  validatePluginParameterValue,
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

  test('preserves unknown nested keys while editing known structured fields', () => {
    const plugin = pluginFixture();
    plugin.parameterSchema!.fields = [
      field('settings', 'struct', {
        fields: [
          field('title', 'text'),
          field('groups', 'array', {
            item: field('$group', 'struct', {
              fields: [field('name', 'text')],
            }),
          }),
        ],
      }),
    ];
    plugin.parameters = {
      settings: '{"title":"Ready","futureFlag":"keep","groups":"[\\"{\\\\\\"name\\\\\\":\\\\\\"A\\\\\\",\\\\\\"futureChild\\\\\\":\\\\\\"stay\\\\\\"}\\"]"}',
    };

    const form = createPluginParameterForm(plugin);
    expect(form.settings).toEqual({
      title: 'Ready',
      futureFlag: 'keep',
      groups: [{ name: 'A', futureChild: 'stay' }],
    });
    (form.settings as Record<string, unknown>).title = 'Changed';

    expect(buildPluginParameterPayload(plugin, form)).toEqual({
      settings: '{"title":"Changed","futureFlag":"keep","groups":"[\\"{\\\\\\"name\\\\\\":\\\\\\"A\\\\\\",\\\\\\"futureChild\\\\\\":\\\\\\"stay\\\\\\"}\\"]"}',
    });
  });

  test('creates typed defaults for every nested dialog level', () => {
    const nested = field('$item', 'struct', {
      fields: [
        field('title', 'text', { defaultValue: 'Untitled' }),
        field('enabled', 'boolean', { defaultValue: 'true' }),
        field('children', 'array', {
          item: field('$child', 'struct', {
            fields: [field('name', 'text')],
          }),
        }),
      ],
    });

    expect(createDefaultPluginParameterValue(nested)).toEqual({
      title: 'Untitled',
      enabled: 'true',
      children: [],
    });
    expect(isPluginParameterSchemaFieldEditable(nested)).toBe(true);
    expect(isPluginParameterSchemaFieldEditable(field('raw', 'json'))).toBe(false);
    expect(isPluginParameterSchemaFieldEditable(field('legacy', 'text', {
      editable: false,
    }))).toBe(false);
  });

  test('commits one nested dialog level without mutating its parent draft', () => {
    const original = {
      groups: [
        { name: 'First', children: [{ id: 'a' }] },
        { name: 'Second', children: [] },
      ],
      untouched: 'keep',
    };
    const editedItem = replacePluginParameterChildValue(
      original.groups[0],
      { kind: 'struct', key: 'children' },
      [{ id: 'b' }],
    );
    const editedGroups = replacePluginParameterChildValue(
      original.groups,
      { kind: 'array', index: 0 },
      editedItem,
    );
    const editedRoot = replacePluginParameterChildValue(
      original,
      { kind: 'struct', key: 'groups' },
      editedGroups,
    ) as typeof original;

    expect(editedRoot).toEqual({
      groups: [
        { name: 'First', children: [{ id: 'b' }] },
        { name: 'Second', children: [] },
      ],
      untouched: 'keep',
    });
    expect(original.groups[0].children).toEqual([{ id: 'a' }]);
    expect(removePluginParameterArrayItem(editedRoot.groups, 1)).toEqual([
      { name: 'First', children: [{ id: 'b' }] },
    ]);
  });

  test('compares payloads independent of object key insertion order', () => {
    expect(pluginParameterPayloadsEqual(
      { first: '1', nested: { second: 2, third: 3 } },
      { nested: { third: 3, second: 2 }, first: '1' },
    )).toBe(true);
  });

  test('strips and restores the MV note outer quote wrapper', () => {
    const note = field('memo', 'multiline', { rawType: 'note' });
    const plugin = pluginFixture();
    // After plugins.js JSON.parse, note values look like "content" with outer quotes.
    plugin.parameters.memo = '"line one\nline two"';
    plugin.parameterSchema.fields = [
      ...plugin.parameterSchema.fields,
      note,
    ];
    plugin.parameterCount = plugin.parameterSchema.fields.length;

    const form = createPluginParameterForm(plugin);
    expect(form.memo).toBe('line one\nline two');

    form.memo = 'edited note';
    expect(buildPluginParameterPayload(plugin, form).memo).toBe('"edited note"');

    const untouched = createPluginParameterForm(plugin);
    expect(buildPluginParameterPayload(plugin, untouched).memo).toBe(
      plugin.parameters.memo,
    );
    expect(isSpecialPluginParameterType(note)).toBe(true);
    expect(isSpecialPluginParameterType(field('title', 'text'))).toBe(false);

    const simple = field('title', 'multiline', { rawType: 'note' });
    expect(normalizePluginParameterValue(simple, '"plain"')).toBe('plain');
    expect(serializePluginParameterValue(simple, 'plain')).toBe('"plain"');
  });

  test('validates number bounds and decimals without rejecting an existing empty value', () => {
    const amount = field('amount', 'number', {
      min: 0,
      max: 10,
      decimals: 2,
    });

    expect(validatePluginParameterValue(amount, '', 'amount', '')).toBeNull();
    expect(validatePluginParameterValue(amount, '', 'amount', '1')).toEqual({
      kind: 'number-required',
      path: 'amount',
    });
    expect(validatePluginParameterValue(amount, '-1', 'amount', '1')).toEqual({
      kind: 'number-min',
      path: 'amount',
      min: 0,
    });
    expect(validatePluginParameterValue(amount, '11', 'amount', '1')).toEqual({
      kind: 'number-max',
      path: 'amount',
      max: 10,
    });
    expect(validatePluginParameterValue(amount, '1.234', 'amount', '1')).toEqual({
      kind: 'number-decimals',
      path: 'amount',
      decimals: 2,
    });
    expect(validatePluginParameterValue(amount, '1.23', 'amount', '1')).toBeNull();
  });

  test('validates nested values and preserves untouched location storage', () => {
    const nested = field('settings', 'struct', {
      fields: [
        field('points', 'array', {
          item: field('$item', 'location'),
        }),
      ],
    });
    expect(validatePluginParameterValue(
      nested,
      { points: [{ mapId: '3', x: '-1', y: '5' }] },
      'settings',
      { points: [{ mapId: '3', x: '4', y: '5' }] },
    )).toEqual({
      kind: 'location-invalid',
      path: 'settings.points[0]',
    });

    const plugin = pluginFixture();
    const form = createPluginParameterForm(plugin);
    form.enabled = 'false';
    expect(buildPluginParameterPayload(plugin, form).position).toBe(
      '{"mapId":3,"x":4,"y":5}',
    );
    form.position = { mapId: '3', x: '9', y: '5' };
    expect(buildPluginParameterPayload(plugin, form).position).toBe(
      '{"mapId":"3","x":"9","y":"5"}',
    );
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
