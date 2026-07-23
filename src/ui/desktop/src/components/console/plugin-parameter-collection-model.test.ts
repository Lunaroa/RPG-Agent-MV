import { describe, expect, test } from 'vitest';
import type {
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import {
  PLUGIN_PARAMETER_CLIPBOARD_LIMIT,
  buildPluginParameterCollectionColumns,
  buildPluginParameterCollectionRows,
  buildSelectedPluginParameterRawArray,
  filterPluginParameterCollectionRows,
  movePluginParameterArrayItem,
  parsePluginParameterRawStrict,
  removePluginParameterArrayItems,
  replacePluginParameterArrayItem,
  serializePluginParameterRaw,
} from './plugin-parameter-collection-model';

const labels = {
  enabled: 'Enabled',
  disabled: 'Disabled',
  empty: 'Empty',
  itemCount: (count: number) => `${count} items`,
  structuredValue: 'Open editor',
  location: (map: string, x: number, y: number) => `${map} (${x}, ${y})`,
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

const deepField = field('root', 'struct', {
  fields: [
    field('title', 'text'),
    field('groups', 'array', {
      item: field('$group', 'struct', {
        fields: [
          field('name', 'text'),
          field('enabled', 'boolean'),
          field('children', 'array', {
            item: field('$child', 'struct', {
              fields: [
                field('id', 'text'),
                field('details', 'struct', {
                  fields: [
                    field('notes', 'array', {
                      item: field('$note', 'struct', {
                        fields: [
                          field('body', 'multiline'),
                          field('meta', 'struct', {
                            fields: [field('priority', 'number')],
                          }),
                        ],
                      }),
                    }),
                  ],
                }),
              ],
            }),
          }),
        ],
      }),
    }),
  ],
});

describe('plugin parameter collection model', () => {
  test('round-trips seven generic nested levels in exact RPG Maker storage form', () => {
    const value = {
      title: 'Example',
      unknownRoot: 'preserve',
      groups: [{
        name: 'Main',
        enabled: 'true',
        unknownGroup: 'preserve too',
        children: [{
          id: 'child',
          details: {
            notes: [{
              body: 'First line\nSecond line',
              meta: { priority: '7', future: 'untouched' },
            }],
          },
        }],
      }],
    };

    const raw = serializePluginParameterRaw(deepField, value);
    expect(raw).toContain('"groups":"[');
    const parsed = parsePluginParameterRawStrict(deepField, raw);
    expect(parsed).toEqual({ ok: true, value });
  });

  test('rejects syntax, root type, and malformed nested storage without a replacement value', () => {
    const syntax = parsePluginParameterRawStrict(deepField, '{\n  "title": "broken",\n}');
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) {
      expect(syntax.error.reason).toBe('syntax');
      expect(syntax.error.line).toBeGreaterThanOrEqual(2);
      expect(syntax.error.column).toBeGreaterThanOrEqual(1);
    }

    const wrongRoot = parsePluginParameterRawStrict(deepField, '[]');
    expect(wrongRoot).toMatchObject({
      ok: false,
      error: { reason: 'root-type', path: 'root' },
    });

    const wrongNested = parsePluginParameterRawStrict(
      deepField,
      '{"title":"Example","groups":[{"name":"not encoded"}]}',
    );
    expect(wrongNested).toMatchObject({
      ok: false,
      error: { reason: 'nested-type', path: 'root.groups' },
    });
  });

  test('builds direct struct columns and searches readable and raw values', () => {
    const arrayField = deepField.fields![1];
    const entries = [
      { name: 'Alpha', enabled: 'true', children: [] },
      { name: 'Beta', enabled: 'false', children: [{ id: 'needle' }] },
    ];
    expect(buildPluginParameterCollectionColumns(arrayField).map((entry) => entry.key))
      .toEqual(['name', 'enabled', 'children']);

    const rows = buildPluginParameterCollectionRows(
      arrayField,
      entries,
      null as EditorProjectCatalog | null,
      labels,
    );
    expect(filterPluginParameterCollectionRows(rows, 'enabled').map((row) => row.index))
      .toEqual([0, 1]);
    expect(filterPluginParameterCollectionRows(rows, 'needle').map((row) => row.index))
      .toEqual([1]);
    expect(filterPluginParameterCollectionRows(rows, 'ALPHA').map((row) => row.index))
      .toEqual([0]);
  });

  test('replaces, removes, and reorders items immutably', () => {
    const original = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(replacePluginParameterArrayItem(original, 1, { id: 'changed' })).toEqual([
      { id: 'a' },
      { id: 'changed' },
      { id: 'c' },
    ]);
    expect(removePluginParameterArrayItems(original, [0, 2])).toEqual([{ id: 'b' }]);
    expect(movePluginParameterArrayItem(original, 2, 0)).toEqual([
      { id: 'c' },
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(original).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  test('copies selected items in array order as complete raw JSON and refuses overflow', () => {
    const arrayField = deepField.fields![1];
    const entries = [
      { name: 'First', enabled: 'true', children: [] },
      { name: 'Second', enabled: 'false', children: [] },
      { name: 'Third', enabled: 'true', children: [] },
    ];
    const copied = buildSelectedPluginParameterRawArray(arrayField, entries, [2, 0]);
    const parsed = parsePluginParameterRawStrict(arrayField, copied.text);
    expect(parsed).toEqual({
      ok: true,
      value: [entries[0], entries[2]],
    });
    expect(copied.overLimit).toBe(false);

    const huge = buildSelectedPluginParameterRawArray(
      field('values', 'array', { item: field('$item', 'text') }),
      ['x'.repeat(PLUGIN_PARAMETER_CLIPBOARD_LIMIT)],
      [0],
    );
    expect(huge.overLimit).toBe(true);
    expect(huge.text.length).toBeGreaterThan(PLUGIN_PARAMETER_CLIPBOARD_LIMIT);
  });
});
