import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TreeNode } from '../components/editor/editorTypes.ts';
import { projectMapTreeMove, resolveMapTreeDropPosition } from './mapTreeDragPreview.ts';

describe('map tree drag preview', () => {
  test('resolves the fixed before, inside, and after drop zones', () => {
    assert.equal(resolveMapTreeDropPosition(100, 100, 40), 'before');
    assert.equal(resolveMapTreeDropPosition(111, 100, 40), 'inside');
    assert.equal(resolveMapTreeDropPosition(129, 100, 40), 'inside');
    assert.equal(resolveMapTreeDropPosition(140, 100, 40), 'after');
  });

  test('projects root moves before and after without mutating the source tree', () => {
    const tree = fixture();
    const before = projectMapTreeMove(tree, 4, 2, 'before');
    const after = projectMapTreeMove(tree, 1, 4, 'after');

    assert.equal(before.valid, true);
    assert.deepEqual(before.tree.map((node) => node.id), [1, 4, 2]);
    assert.equal(after.valid, true);
    assert.deepEqual(after.tree.map((node) => node.id), [2, 4, 1]);
    assert.deepEqual(tree.map((node) => node.id), [1, 2, 4]);
    assert.deepEqual(tree[0].children?.map((node) => node.id), [3]);
  });

  test('moves a complete subtree inside a target and appends it after existing children', () => {
    const tree = fixture();
    const projection = projectMapTreeMove(tree, 1, 2, 'inside');

    assert.equal(projection.valid, true);
    assert.deepEqual(projection.tree.map((node) => node.id), [2, 4]);
    assert.deepEqual(projection.tree[0].children?.map((node) => node.id), [5, 1]);
    assert.deepEqual(projection.tree[0].children?.[1].children?.map((node) => node.id), [3]);
  });

  test('rejects self, descendant, and adjacent no-op moves', () => {
    const tree = fixture();
    assert.equal(projectMapTreeMove(tree, 1, 1, 'inside').failure, 'same-node');
    assert.equal(projectMapTreeMove(tree, 1, 3, 'inside').failure, 'descendant');
    assert.equal(projectMapTreeMove(tree, 1, 2, 'before').failure, 'no-op');
    assert.equal(projectMapTreeMove(tree, 2, 1, 'after').failure, 'no-op');
    assert.equal(projectMapTreeMove(tree, 5, 2, 'inside').failure, 'no-op');
  });
});

function fixture(): TreeNode[] {
  return [
    node(1, [node(3)]),
    node(2, [node(5)]),
    node(4),
  ];
}

function node(id: number, children?: TreeNode[]): TreeNode {
  return {
    id,
    name: `Map ${id}`,
    order: id,
    parentId: 0,
    expanded: true,
    mapFileExists: true,
    ...(children ? { children } : {}),
  };
}
