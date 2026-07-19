import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildPaletteRectSelection,
  paletteSelectionButton,
  paletteSelectionReleaseMatches,
} from './tilePaletteSelection.ts';

const pickCell = (col: number, row: number) => ({ tileId: row * 8 + col + 1 });

describe('tile palette pointer selection', () => {
  test('accepts left and right selection on tile tabs but only left selection on the R tab', () => {
    assert.equal(paletteSelectionButton(0, false), 0);
    assert.equal(paletteSelectionButton(2, false), 2);
    assert.equal(paletteSelectionButton(1, false), null);
    assert.equal(paletteSelectionButton(0, true), 0);
    assert.equal(paletteSelectionButton(2, true), null);
  });

  test('only the button that started a selection may release it', () => {
    assert.equal(paletteSelectionReleaseMatches(2, 2), true);
    assert.equal(paletteSelectionReleaseMatches(2, 0), false);
    assert.equal(paletteSelectionReleaseMatches(0, 2), false);
    assert.equal(paletteSelectionReleaseMatches(null, 0), false);
  });

  test('builds the same normalized 4 by 2 brush in every drag direction', () => {
    const expected = buildPaletteRectSelection({ col: 1, row: 2 }, { col: 4, row: 3 }, pickCell);
    assert.ok(expected);
    assert.equal(expected.width, 4);
    assert.equal(expected.height, 2);
    assert.equal(expected.hotspotX, 0);
    assert.equal(expected.hotspotY, 0);
    assert.deepEqual(expected.cells.map((cell) => [cell.dx, cell.dy, cell.tileId]), [
      [0, 0, 18], [1, 0, 19], [2, 0, 20], [3, 0, 21],
      [0, 1, 26], [1, 1, 27], [2, 1, 28], [3, 1, 29],
    ]);

    for (const [start, end] of [
      [{ col: 4, row: 3 }, { col: 1, row: 2 }],
      [{ col: 1, row: 3 }, { col: 4, row: 2 }],
      [{ col: 4, row: 2 }, { col: 1, row: 3 }],
    ] as const) {
      assert.deepEqual(buildPaletteRectSelection(start, end, pickCell), expected);
    }
  });

  test('uses the same brush builder after either accepted pointer button', () => {
    const buildForButton = (button: number) => {
      assert.notEqual(paletteSelectionButton(button, false), null);
      return buildPaletteRectSelection({ col: 0, row: 0 }, { col: 3, row: 1 }, pickCell);
    };
    assert.deepEqual(buildForButton(2), buildForButton(0));
  });

  test('treats a right click as a one-cell top-left-anchored brush', () => {
    assert.equal(paletteSelectionButton(2, false), 2);
    assert.deepEqual(buildPaletteRectSelection({ col: 5, row: 6 }, { col: 5, row: 6 }, pickCell), {
      cells: [{ dx: 0, dy: 0, tileId: 54 }],
      width: 1,
      height: 1,
      hotspotX: 0,
      hotspotY: 0,
    });
  });

  test('does not create a brush when the selected tile page has no valid picks', () => {
    assert.equal(buildPaletteRectSelection({ col: 0, row: 0 }, { col: 3, row: 1 }, () => null), null);
  });
});
