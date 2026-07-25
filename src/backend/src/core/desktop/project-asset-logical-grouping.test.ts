import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  groupProjectAssetLogicalEntries,
  PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE,
} from './project-asset-logical-grouping.ts';

describe('project asset logical grouping', () => {
  test('collapses audio containers into one logical entry with two variants', () => {
    const entries = groupProjectAssetLogicalEntries([
      { fileName: 'Foo.ogg', relativePath: 'audio/bgm/Foo.ogg', bytes: 10, mtimeMs: 1 },
      { fileName: 'Foo.m4a', relativePath: 'audio/bgm/Foo.m4a', bytes: 20, mtimeMs: 3 },
    ], ['.ogg', '.m4a', '.rpgmvo', '.rpgmvm']);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.name, 'Foo');
    assert.equal(entries[0]!.variants.length, 2);
    assert.equal(entries[0]!.primary.extension, '.ogg');
    assert.equal(entries[0]!.bytes, 30);
    assert.equal(entries[0]!.mtimeMs, 3);
    assert.equal(entries[0]!.encrypted, false);
  });

  test('flags encrypted-only entries and selects the encrypted primary', () => {
    const entries = groupProjectAssetLogicalEntries([
      { fileName: 'Secret.rpgmvp', relativePath: 'img/pictures/Secret.rpgmvp', bytes: 8, mtimeMs: 2 },
    ], ['.png', '.jpg', '.jpeg', '.webp', '.rpgmvp']);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.encrypted, true);
    assert.equal(entries[0]!.primary.extension, '.rpgmvp');
    assert.equal(entries[0]!.primary.encrypted, true);
  });

  test('primary selection follows the declared preference order', () => {
    assert.ok(PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE.indexOf('.png')
      < PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE.indexOf('.rpgmvp'));
    assert.ok(PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE.indexOf('.ogg')
      < PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE.indexOf('.rpgmvo'));

    const entries = groupProjectAssetLogicalEntries([
      { fileName: 'Art.rpgmvp', relativePath: 'img/pictures/Art.rpgmvp', bytes: 1, mtimeMs: 1 },
      { fileName: 'Art.webp', relativePath: 'img/pictures/Art.webp', bytes: 2, mtimeMs: 2 },
      { fileName: 'Art.png', relativePath: 'img/pictures/Art.png', bytes: 3, mtimeMs: 3 },
    ], ['.png', '.jpg', '.jpeg', '.webp', '.rpgmvp']);

    assert.equal(entries[0]!.primary.extension, '.png');
    assert.deepEqual(entries[0]!.variants.map((variant) => variant.extension), ['.png', '.webp', '.rpgmvp']);
  });

  test('groups by case-insensitive basename and preserves first casing', () => {
    const entries = groupProjectAssetLogicalEntries([
      { fileName: 'Hero.ogg', relativePath: 'audio/bgm/Hero.ogg', bytes: 1, mtimeMs: 1 },
      { fileName: 'hero.m4a', relativePath: 'audio/bgm/hero.m4a', bytes: 2, mtimeMs: 2 },
    ], ['.ogg', '.m4a', '.rpgmvo', '.rpgmvm']);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.name, 'Hero');
    assert.equal(entries[0]!.variants.length, 2);
  });

  test('ignores files outside the accepted extension set without dropping them silently into another group', () => {
    const entries = groupProjectAssetLogicalEntries([
      { fileName: 'Theme.ogg', relativePath: 'audio/bgm/Theme.ogg', bytes: 1, mtimeMs: 1 },
      { fileName: 'Theme.txt', relativePath: 'audio/bgm/Theme.txt', bytes: 2, mtimeMs: 2 },
    ], ['.ogg', '.m4a']);

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.variants.length, 1);
    assert.equal(entries[0]!.variants[0]!.extension, '.ogg');
  });
});
