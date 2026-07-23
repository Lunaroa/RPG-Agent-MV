import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TreeNode } from '../components/editor/editorTypes';
import { parseMapIdQuery, searchMapTree } from './mapTreeSearch';

const tree: TreeNode[] = [
  {
    id: 1,
    name: 'Town',
    order: 1,
    parentId: 0,
    expanded: false,
    mapFileExists: true,
    children: [
      {
        id: 14,
        name: 'Workshop',
        order: 2,
        parentId: 1,
        expanded: false,
        mapFileExists: true,
      },
    ],
  },
  {
    id: 20,
    name: 'Forest',
    order: 3,
    parentId: 0,
    expanded: false,
    mapFileExists: true,
  },
];

describe('map tree search', () => {
  test('matches names case-insensitively and retains the ancestor path', () => {
    const result = searchMapTree(tree, 'WORK');
    assert.deepEqual(result.tree.map((node) => node.id), [1]);
    assert.deepEqual(result.tree[0]?.children?.map((node) => node.id), [14]);
    assert.deepEqual(result.expandedAncestorIds, [1]);
  });

  test('treats numeric and MAP-prefixed searches as exact IDs', () => {
    assert.equal(parseMapIdQuery('14'), 14);
    assert.equal(parseMapIdQuery('MAP14'), 14);
    assert.equal(parseMapIdQuery('map014'), 14);
    assert.deepEqual(searchMapTree(tree, 'MAP014').tree[0]?.children?.map((node) => node.id), [14]);
    assert.deepEqual(searchMapTree(tree, '1').tree.map((node) => node.id), [1]);
  });

  test('keeps the original subtree when a parent itself matches', () => {
    const result = searchMapTree(tree, 'town');
    assert.equal(result.tree[0], tree[0]);
    assert.deepEqual(result.tree[0]?.children?.map((node) => node.id), [14]);
  });

  test('returns an empty tree when nothing matches', () => {
    assert.deepEqual(searchMapTree(tree, 'missing map'), { tree: [], expandedAncestorIds: [] });
  });
});
