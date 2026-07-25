import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeProjectAssetGridWindow } from './projectAssetGridWindow';

describe('computeProjectAssetGridWindow', () => {
  test('empty list yields zero rows and height', () => {
    const window = computeProjectAssetGridWindow({
      containerWidth: 400,
      containerHeight: 300,
      cellWidth: 100,
      cellHeight: 100,
      gap: 10,
      itemCount: 0,
      scrollTop: 0,
    });
    assert.equal(window.columnCount, 3);
    assert.equal(window.rowCount, 0);
    assert.equal(window.totalHeight, 0);
    assert.equal(window.startIndex, 0);
    assert.equal(window.endIndex, 0);
  });

  test('partially filled last row still counts full row height', () => {
    const window = computeProjectAssetGridWindow({
      containerWidth: 320,
      containerHeight: 240,
      cellWidth: 100,
      cellHeight: 100,
      gap: 10,
      itemCount: 5,
      scrollTop: 0,
      overscanRows: 0,
    });
    // floor((320 + 10) / 110) = 3 columns
    assert.equal(window.columnCount, 3);
    assert.equal(window.rowCount, 2);
    assert.equal(window.totalHeight, 100 * 2 + 10 * 1);
    assert.equal(window.startIndex, 0);
    assert.equal(window.endIndex, 5);
  });

  test('scroll offset past the end clamps to the last visible window', () => {
    const window = computeProjectAssetGridWindow({
      containerWidth: 210,
      containerHeight: 110,
      cellWidth: 100,
      cellHeight: 100,
      gap: 10,
      itemCount: 8,
      scrollTop: 10_000,
      overscanRows: 0,
    });
    // floor((210 + 10) / 110) = 2 columns
    assert.equal(window.columnCount, 2);
    assert.equal(window.rowCount, 4);
    assert.equal(window.totalHeight, 100 * 4 + 10 * 3);
    assert.equal(window.startRow, 2);
    assert.equal(window.endRow, 4);
    assert.equal(window.startIndex, 4);
    assert.equal(window.endIndex, 8);
  });

  test('container narrower than one cell still uses one column', () => {
    const window = computeProjectAssetGridWindow({
      containerWidth: 40,
      containerHeight: 200,
      cellWidth: 100,
      cellHeight: 100,
      gap: 10,
      itemCount: 3,
      scrollTop: 0,
      overscanRows: 0,
    });
    assert.equal(window.columnCount, 1);
    assert.equal(window.rowCount, 3);
    assert.equal(window.startIndex, 0);
    assert.equal(window.endIndex, 3);
  });
});
