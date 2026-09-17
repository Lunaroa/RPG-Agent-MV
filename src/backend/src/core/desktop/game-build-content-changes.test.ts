import assert from 'node:assert/strict';
import test from 'node:test';

import type { GameBuildFileManifestEntry } from '../../../../contract/game-release.ts';
import { compareGameBuildContent } from './game-build-content-changes.ts';

test('classifies added, modified, and deleted update content in stable path order', () => {
  const baseline = new Map([
    entry('data/Map001.json', 'map-old'),
    entry('img/pictures/removed.png', 'removed'),
    entry('js/main.js', 'same'),
  ].map((value) => [value.path, value]));
  const target = [
    entry('js/main.js', 'same'),
    entry('data/Map002.json', 'map-new'),
    entry('data/Map001.json', 'map-updated'),
  ];

  assert.deepEqual(compareGameBuildContent('release-base', target, baseline, 'web'), {
    baseReleaseId: 'release-base',
    added: ['data/Map002.json'],
    modified: ['data/Map001.json'],
    deleted: ['img/pictures/removed.png'],
  });
});

test('excludes the Windows shell while retaining game content changes', () => {
  const baseline = new Map([
    entry('Game.exe', 'runtime-old'),
    entry('locales/en-US.pak', 'locale-old'),
    entry('www/data/Map001.json', 'map-old'),
  ].map((value) => [value.path, value]));
  const target = [
    entry('Game.exe', 'runtime-new'),
    entry('locales/en-US.pak', 'locale-new'),
    entry('www/data/Map001.json', 'map-new'),
  ];

  assert.deepEqual(compareGameBuildContent('release-base', target, baseline, 'windows'), {
    baseReleaseId: 'release-base',
    added: [],
    modified: ['www/data/Map001.json'],
    deleted: [],
  });
});

function entry(path: string, sha256: string): GameBuildFileManifestEntry {
  return { path, sha256, bytes: 1, processing: 'none' };
}
