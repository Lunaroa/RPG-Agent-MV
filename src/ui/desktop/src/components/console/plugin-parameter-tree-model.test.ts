import { describe, expect, test } from 'vitest';
import type { PluginParameterSchemaField } from '../../api/client';
import type { PluginParameterRow } from './plugin-parameter-model';
import {
  buildPluginParameterTree,
  flattenPluginParameterTree,
} from './plugin-parameter-tree-model';

function row(
  key: string,
  parent = '',
  extra: Partial<PluginParameterRow> = {},
): PluginParameterRow {
  const field: PluginParameterSchemaField = {
    key,
    label: key,
    kind: 'text',
    description: '',
    parent: parent || undefined,
  };
  return {
    key,
    label: key,
    description: '',
    field,
    editable: true,
    readonlyReason: '',
    summary: `value:${key}`,
    fullValue: `raw:${key}`,
    ...extra,
  };
}

describe('plugin parameter tree model', () => {
  test('keeps declaration order and starts with every parent collapsed', () => {
    const rows = [
      row('root'),
      row('childA', 'root'),
      row('grandchild', 'childA'),
      row('childB', 'root'),
      row('sibling'),
    ];
    const tree = buildPluginParameterTree(rows);

    expect(flattenPluginParameterTree(tree, new Set()).map((entry) => entry.key))
      .toEqual(['root', 'sibling']);
    expect(
      flattenPluginParameterTree(tree, new Set(['root', 'childA']))
        .map(({ key, depth }) => [key, depth]),
    ).toEqual([
      ['root', 0],
      ['childA', 1],
      ['grandchild', 2],
      ['childB', 1],
      ['sibling', 0],
    ]);
  });

  test('supports seven levels without changing row values', () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      row(`level${index + 1}`, index ? `level${index}` : ''));
    const tree = buildPluginParameterTree(rows);
    const expanded = new Set(rows.map((entry) => entry.key));
    const visible = flattenPluginParameterTree(tree, expanded);

    expect(visible).toHaveLength(7);
    expect(visible[6]).toMatchObject({
      key: 'level7',
      depth: 6,
      fullValue: 'raw:level7',
    });
  });

  test('search shows a matching child with its ancestors', () => {
    const tree = buildPluginParameterTree([
      row('root'),
      row('branch', 'root'),
      row('needle', 'branch', { description: 'Find this value' }),
      row('other', 'root'),
    ]);

    expect(flattenPluginParameterTree(tree, new Set(), 'find this').map((entry) => entry.key))
      .toEqual(['root', 'branch', 'needle']);
  });

  test('searching a parent includes its complete subtree', () => {
    const tree = buildPluginParameterTree([
      row('root', '', { label: 'Display settings' }),
      row('first', 'root'),
      row('second', 'root'),
      row('unrelated'),
    ]);

    expect(flattenPluginParameterTree(tree, new Set(), 'display').map((entry) => entry.key))
      .toEqual(['root', 'first', 'second']);
    expect(flattenPluginParameterTree(tree, new Set(['unrelated'])).map((entry) => entry.key))
      .toEqual(['root', 'unrelated']);
  });

  test('keeps missing parents at root with a structured issue', () => {
    const tree = buildPluginParameterTree([
      row('orphan', 'missing'),
      row('child', 'orphan'),
    ]);
    const visible = flattenPluginParameterTree(tree, new Set(['orphan']));

    expect(visible.map(({ key, depth }) => [key, depth])).toEqual([
      ['orphan', 0],
      ['child', 1],
    ]);
    expect(visible[0]?.hierarchyIssue).toEqual({
      kind: 'missing-parent',
      parentKey: 'missing',
    });
  });

  test('breaks circular chains at root and preserves their descendants', () => {
    const tree = buildPluginParameterTree([
      row('first', 'second'),
      row('second', 'first'),
      row('child', 'first'),
    ]);
    const visible = flattenPluginParameterTree(tree, new Set(['first', 'second']));

    expect(visible.map(({ key, depth }) => [key, depth])).toEqual([
      ['first', 0],
      ['child', 1],
      ['second', 0],
    ]);
    expect(visible[0]?.hierarchyIssue?.kind).toBe('circular-parent');
    expect(visible[2]?.hierarchyIssue?.kind).toBe('circular-parent');
  });
});
