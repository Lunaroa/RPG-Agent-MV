import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  formatProjectAssetBytes,
  formatProjectAssetModified,
  formatProjectAssetTypeName,
} from './projectAssetListFormatting.ts';

describe('formatProjectAssetBytes', () => {
  test('formats bytes, KB, and MB with one trimmed decimal', () => {
    assert.equal(formatProjectAssetBytes(0), '0 B');
    assert.equal(formatProjectAssetBytes(983), '983 B');
    assert.equal(formatProjectAssetBytes(1024), '1 KB');
    assert.equal(formatProjectAssetBytes(12_590), '12.3 KB');
    assert.equal(formatProjectAssetBytes(4_400_000), '4.2 MB');
  });

  test('rejects invalid input', () => {
    assert.equal(formatProjectAssetBytes(Number.NaN), '');
    assert.equal(formatProjectAssetBytes(-5), '');
  });
});

describe('formatProjectAssetModified', () => {
  test('formats as Y/M/D HH:MM in local time', () => {
    const ms = new Date(2026, 6, 5, 16, 4, 30).getTime();
    assert.equal(formatProjectAssetModified(ms), '2026/7/5 16:04');
  });

  test('pads hours and minutes', () => {
    const ms = new Date(2026, 0, 2, 3, 7).getTime();
    assert.equal(formatProjectAssetModified(ms), '2026/1/2 03:07');
  });

  test('rejects invalid input', () => {
    assert.equal(formatProjectAssetModified(0), '');
    assert.equal(formatProjectAssetModified(Number.NaN), '');
  });
});

describe('formatProjectAssetTypeName', () => {
  test('uppercases the extension without the dot', () => {
    assert.equal(formatProjectAssetTypeName('.png'), 'PNG');
    assert.equal(formatProjectAssetTypeName('ogg'), 'OGG');
  });

  test('empty extension yields empty text', () => {
    assert.equal(formatProjectAssetTypeName(''), '');
    assert.equal(formatProjectAssetTypeName('  '), '');
  });
});
