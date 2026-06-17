/**
 * Run: node --experimental-strip-types --test src/utils/mvTileFlags.test.ts
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { flagSummaryTokens, summarizeTileStackFlags } from './mvTileFlags.ts';

describe('mv tile flags summary', () => {
  test('uses the top non-star tile for passability', () => {
    const flags = new Array(32).fill(0);
    flags[1] = 0x0f;
    flags[2] = 0x10;

    const summary = summarizeTileStackFlags([1, 2], flags);

    assert.equal(summary.star, true);
    assert.equal(summary.passage, 'blocked');
    assert.deepEqual(flagSummaryTokens(summary), ['X']);
  });

  test('detects directional passage and core MV tile markers', () => {
    const flags = new Array(32).fill(0);
    flags[3] = 0x02 | 0x20 | 0x40 | 0x80 | 0x100 | (7 << 12);

    const summary = summarizeTileStackFlags([3], flags);

    assert.equal(summary.passage, 'directional');
    assert.equal(summary.ladder, true);
    assert.equal(summary.bush, true);
    assert.equal(summary.counter, true);
    assert.equal(summary.damage, true);
    assert.equal(summary.terrainTag, 7);
    assert.deepEqual(flagSummaryTokens(summary), ['DIR', 'L', 'B', 'C', 'D', 'T7']);
  });

  test('marks missing flag data instead of pretending the cell is normal', () => {
    const summary = summarizeTileStackFlags([999], []);

    assert.equal(summary.passage, 'unknown');
    assert.equal(summary.flagsMissing, true);
    assert.equal(summary.hasOverlay, true);
    assert.deepEqual(flagSummaryTokens(summary), ['?']);
  });

  test('keeps ordinary passable cells quiet', () => {
    const flags = new Array(32).fill(0);
    const summary = summarizeTileStackFlags([1, 2], flags);

    assert.equal(summary.passage, 'passable');
    assert.equal(summary.hasOverlay, false);
    assert.deepEqual(flagSummaryTokens(summary), []);
  });
});
