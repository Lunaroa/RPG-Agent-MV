import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isPrimaryMapTreeNodeClick, toggleMapTreeNodeExpansion } from './mapTreeNodeInteraction.ts';

describe('map tree node interaction', () => {
  test('keeps single clicks for selection and suppresses the second click in a double click', () => {
    assert.equal(isPrimaryMapTreeNodeClick(1), true);
    assert.equal(isPrimaryMapTreeNodeClick(2), false);
  });

  test('expands a collapsed parent node', () => {
    let expanded = false;
    const changed = toggleMapTreeNodeExpansion({
      isLeaf: false,
      expanded: false,
      expand: () => { expanded = true; },
      collapse: () => assert.fail('collapsed node should not collapse'),
    });
    assert.equal(changed, true);
    assert.equal(expanded, true);
  });

  test('collapses an expanded parent node', () => {
    let collapsed = false;
    const changed = toggleMapTreeNodeExpansion({
      isLeaf: false,
      expanded: true,
      expand: () => assert.fail('expanded node should not expand'),
      collapse: () => { collapsed = true; },
    });
    assert.equal(changed, true);
    assert.equal(collapsed, true);
  });

  test('does nothing for a leaf node', () => {
    const changed = toggleMapTreeNodeExpansion({
      isLeaf: true,
      expanded: false,
      expand: () => assert.fail('leaf should not expand'),
      collapse: () => assert.fail('leaf should not collapse'),
    });
    assert.equal(changed, false);
  });
});
