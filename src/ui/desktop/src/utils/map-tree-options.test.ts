/**
 * Run: node --experimental-strip-types --test src/utils/map-tree-options.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildMapPickerOptions } from './map-tree-options.ts';

describe('buildMapPickerOptions', () => {
  test('includes root and nested maps with hierarchy', () => {
    const options = buildMapPickerOptions([
      { id: 1, name: 'World', parentId: 0, order: 0, expanded: true },
      { id: 2, name: 'Town', parentId: 1, order: 0, expanded: true },
    ]);
    assert.deepEqual(options[0], { id: 0, label: '根目录' });
    assert.match(options[1]?.label ?? '', /MAP 1 · World/);
    assert.match(options[2]?.label ?? '', /Town/);
  });
});
