import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearProjectAssetSelection,
  emptyProjectAssetSelection,
  hitTestProjectAssetMarquee,
  projectAssetCellRectAtIndex,
  projectAssetRectsIntersect,
  pruneProjectAssetSelection,
  selectAllProjectAssets,
  selectProjectAssetExclusive,
  selectProjectAssetRange,
  selectProjectAssetsByMarquee,
  toggleProjectAssetSelection,
  viewportPointToContentPoint,
} from './projectAssetSelection';

const IDS = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

describe('projectAssetSelection click model', () => {
  test('exclusive click selects only the target and sets the anchor', () => {
    const next = selectProjectAssetExclusive('c');
    assert.deepEqual(next.selectedIds, ['c']);
    assert.equal(next.anchorId, 'c');
  });

  test('toggle adds then removes while always updating the anchor', () => {
    const added = toggleProjectAssetSelection(selectProjectAssetExclusive('a'), 'c');
    assert.deepEqual(added.selectedIds, ['a', 'c']);
    assert.equal(added.anchorId, 'c');

    const removed = toggleProjectAssetSelection(added, 'a');
    assert.deepEqual(removed.selectedIds, ['c']);
    assert.equal(removed.anchorId, 'a');
  });

  test('shift range uses the full ordered list, not a visible window', () => {
    // Simulate a virtualized window that only rendered d..f while the full list is a..h.
    const visibleOnly = ['d', 'e', 'f'];
    assert.equal(visibleOnly.includes('a'), false);

    const state = selectProjectAssetExclusive('a');
    const ranged = selectProjectAssetRange(IDS, state, 'f');
    assert.deepEqual(ranged.selectedIds, ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(ranged.anchorId, 'a');
  });

  test('shift range without a usable anchor falls back to exclusive select', () => {
    const ranged = selectProjectAssetRange(IDS, emptyProjectAssetSelection(), 'd');
    assert.deepEqual(ranged.selectedIds, ['d']);
    assert.equal(ranged.anchorId, 'd');
  });

  test('shift range throws when the target is not in the ordered list', () => {
    assert.throws(
      () => selectProjectAssetRange(IDS, selectProjectAssetExclusive('a'), 'missing'),
      /not in the ordered list/,
    );
  });

  test('select all and clear', () => {
    const all = selectAllProjectAssets(IDS, selectProjectAssetExclusive('c'));
    assert.deepEqual(all.selectedIds, [...IDS]);
    assert.equal(all.anchorId, 'c');
    assert.deepEqual(clearProjectAssetSelection(), emptyProjectAssetSelection());
  });

  test('prune drops deleted ids and repairs the anchor', () => {
    const state = {
      selectedIds: Object.freeze(['a', 'c', 'e']),
      anchorId: 'e',
    };
    const pruned = pruneProjectAssetSelection(state, ['a', 'b', 'c']);
    assert.deepEqual(pruned.selectedIds, ['a', 'c']);
    assert.equal(pruned.anchorId, 'c');
  });
});

describe('projectAssetSelection layout / marquee', () => {
  const layout = { columnCount: 3, cellSize: 100, gap: 10 };

  test('cell geometry follows index → row/column math', () => {
    // index 4 → row 1, col 1 with 3 columns
    assert.deepEqual(projectAssetCellRectAtIndex(4, layout), {
      x: 110,
      y: 110,
      width: 100,
      height: 100,
    });
  });

  test('marquee hits off-screen cells via layout math, not the visible window', () => {
    // Content is tall: 8 items / 3 cols → 3 rows. A viewport might only show row 0,
    // but a marquee covering row 2 must still hit g/h.
    const marquee = { left: 0, top: 220, right: 320, bottom: 330 };
    const hits = hitTestProjectAssetMarquee(IDS, layout, marquee);
    assert.deepEqual(hits, ['g', 'h']);
    assert.equal(hits.includes('a'), false);
  });

  test('marquee selection replaces the set and anchors on the last hit', () => {
    const next = selectProjectAssetsByMarquee(
      IDS,
      layout,
      { left: 0, top: 0, right: 210, bottom: 100 },
    );
    // Row 0 cells a,b,c (x 0/110/220) — right=210 intersects a and b only.
    assert.deepEqual(next.selectedIds, ['a', 'b']);
    assert.equal(next.anchorId, 'b');
  });

  test('inverted marquee corners still hit the same cells', () => {
    const forward = hitTestProjectAssetMarquee(
      IDS,
      layout,
      { left: 0, top: 0, right: 100, bottom: 100 },
    );
    const inverted = hitTestProjectAssetMarquee(
      IDS,
      layout,
      { left: 100, top: 100, right: 0, bottom: 0 },
    );
    assert.deepEqual(inverted, forward);
    assert.deepEqual(forward, ['a']);
  });

  test('viewport points convert with scroll offsets into content space', () => {
    assert.deepEqual(viewportPointToContentPoint(40, 50, 0, 220), { x: 40, y: 270 });
  });

  test('rectsIntersect is strict edge-touch exclusive on a shared edge', () => {
    // Adjacent cells that only share an edge (gap=0) should not count as intersecting
    // when using left<right strict inequality — used for gap-separated cells here.
    assert.equal(
      projectAssetRectsIntersect(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 100, top: 0, right: 200, bottom: 100 },
      ),
      false,
    );
    assert.equal(
      projectAssetRectsIntersect(
        { left: 0, top: 0, right: 100, bottom: 100 },
        { left: 99, top: 0, right: 200, bottom: 100 },
      ),
      true,
    );
  });
});
