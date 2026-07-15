/**
 * Run: node --experimental-strip-types --test src/utils/assetReferenceGraphView.test.ts
 * (from RPG-Agent-MV/src/ui/desktop)
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildAssetReferenceRows,
  buildMissingReferenceGroups,
  buildReplacementMap,
  buildUnusedAssetRows,
  classifyReferenceSource,
  projectAssetKey,
  referenceSourceLabel,
} from './assetReferenceGraphView.ts';
import type { ProjectAssetReferenceGraph } from '../api/client';

describe('assetReferenceGraphView', () => {
  test('keeps backend reference evidence when building UI asset rows', () => {
    const rows = buildAssetReferenceRows(makeGraph(), 'characters hero');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, 'characters::www/img/characters/Hero.png');
    assert.equal(rows[0].asset.name, 'Hero');
    assert.deepEqual(rows[0].refs.map((ref) => ({
      file: ref.file,
      path: ref.path,
      source: ref.source,
    })), [
      {
        file: 'www/data/Actors.json',
        path: '$[1].characterName',
        source: 'Actor character image',
      },
      {
        file: 'www/data/Map001.json',
        path: '$.events[1].pages[0].image.characterName',
        source: 'Map event page image',
      },
    ]);
  });

  test('groups missing references and offers only same-bucket replacement candidates', () => {
    const groups = buildMissingReferenceGroups(makeGraph());

    assert.equal(groups.length, 2);
    const missingSe = groups.find((group) => group.key === 'se::MissingBell');
    assert.ok(missingSe);
    assert.equal(missingSe.references.length, 2);
    assert.deepEqual(missingSe.expectedRelativePaths, ['www/audio/se/MissingBell.m4a', 'www/audio/se/MissingBell.ogg']);
    assert.deepEqual(missingSe.replacementCandidates.map((asset) => asset.name), ['Bell']);

    const missingFace = groups.find((group) => group.key === 'faces::MissingFace');
    assert.ok(missingFace);
    assert.deepEqual(missingFace.replacementCandidates.map((asset) => asset.name), ['HeroFace']);
  });

  test('preserves valid replacement selection and falls back to graph candidates', () => {
    const groups = buildMissingReferenceGroups(makeGraph());

    assert.deepEqual(buildReplacementMap(groups, { 'se::MissingBell': 'Bell' }), {
      'faces::MissingFace': 'HeroFace',
      'se::MissingBell': 'Bell',
    });
    assert.deepEqual(buildReplacementMap(groups, { 'se::MissingBell': 'MissingBell' }), {
      'faces::MissingFace': 'HeroFace',
      'se::MissingBell': 'Bell',
    });
  });

  test('uses category and relative path for stable asset keys', () => {
    assert.equal(projectAssetKey(makeGraph().assets[0]), 'characters::www/img/characters/Hero.png');
  });

  test('unused rows are driven by backend unusedAssets instead of guessed from references', () => {
    const rows = buildUnusedAssetRows(makeGraph(), 'unused');

    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, 'pictures::www/img/pictures/Unused.png');
    assert.equal(rows[0].refs.length, 0);
  });

  test('classifies reference source kind for UI evidence badges', () => {
    assert.equal(classifyReferenceSource({
      category: 'characters',
      name: 'Hero',
      file: 'www/data/Map001.json',
      path: '$.events[1].pages[0].image.characterName',
      source: 'Map event page image',
    }), 'map');
    assert.equal(classifyReferenceSource({
      category: 'se',
      name: 'Bell',
      file: 'www/data/CommonEvents.json',
      path: '$[1].list[0].parameters[0].name',
      source: 'Common event SE',
    }), 'commonEvent');
    assert.equal(classifyReferenceSource({
      category: 'plugins',
      name: 'MissingPlugin',
      file: 'www/js/plugins.js',
      path: '$[0].name',
      source: 'Plugin configuration',
    }), 'plugin');
    assert.equal(classifyReferenceSource({
      category: 'characters',
      name: 'Hero',
      file: 'www/data/Actors.json',
      path: '$[1].characterName',
      source: 'Actor character image',
    }), 'database');
    assert.equal(referenceSourceLabel({
      category: 'system',
      name: 'Window',
      file: 'www/data/System.json',
      path: '$.windowTone',
      source: 'System config',
    }, 'zh-CN'), '配置');
    assert.equal(referenceSourceLabel({
      category: 'system',
      name: 'Window',
      file: 'www/data/System.json',
      path: '$.windowTone',
      source: 'System config',
    }, 'en-US'), 'Config');
  });
});

function makeGraph(): ProjectAssetReferenceGraph {
  return {
    generatedAt: '2026-06-14T00:00:00.000Z',
    projectRoot: '/tmp/project-fixture',
    summary: {
      assets: 4,
      references: 4,
      missingReferences: 3,
      unusedAssets: 1,
    },
    categories: [
      { id: 'characters', directory: 'img/characters' },
      { id: 'faces', directory: 'img/faces' },
      { id: 'se', directory: 'audio/se' },
    ],
    assets: [
      {
        category: 'characters',
        name: 'Hero',
        fileName: 'Hero.png',
        relativePath: 'www/img/characters/Hero.png',
        size: 10,
        staged: false,
      },
      {
        category: 'faces',
        name: 'HeroFace',
        fileName: 'HeroFace.png',
        relativePath: 'www/img/faces/HeroFace.png',
        size: 11,
        staged: false,
      },
      {
        category: 'se',
        name: 'Bell',
        fileName: 'Bell.ogg',
        relativePath: 'www/audio/se/Bell.ogg',
        size: 12,
        staged: false,
      },
      {
        category: 'pictures',
        name: 'Unused',
        fileName: 'Unused.png',
        relativePath: 'www/img/pictures/Unused.png',
        size: 13,
        staged: false,
      },
    ],
    references: [
      {
        category: 'characters',
        name: 'Hero',
        file: 'www/data/Actors.json',
        path: '$[1].characterName',
        source: 'Actor character image',
      },
      {
        category: 'characters',
        name: 'Hero',
        file: 'www/data/Map001.json',
        path: '$.events[1].pages[0].image.characterName',
        source: 'Map event page image',
      },
    ],
    missingReferences: [
      {
        category: 'se',
        name: 'MissingBell',
        file: 'www/data/Map001.json',
        path: '$.events[1].pages[0].list[0].parameters[0].name',
        source: 'Map event command SE',
        expectedRelativePaths: ['www/audio/se/MissingBell.ogg', 'www/audio/se/MissingBell.m4a'],
      },
      {
        category: 'se',
        name: 'MissingBell',
        file: 'www/data/CommonEvents.json',
        path: '$[1].list[0].parameters[0].name',
        source: 'Common event SE',
        expectedRelativePaths: ['www/audio/se/MissingBell.ogg'],
      },
      {
        category: 'faces',
        name: 'MissingFace',
        file: 'www/data/Map001.json',
        path: '$.events[1].pages[0].list[0].parameters[0]',
        source: 'Map event command face',
        expectedRelativePaths: ['www/img/faces/MissingFace.png'],
      },
    ],
    unusedAssets: [
      {
        category: 'pictures',
        name: 'Unused',
        fileName: 'Unused.png',
        relativePath: 'www/img/pictures/Unused.png',
        size: 13,
        staged: false,
      },
    ],
  };
}
