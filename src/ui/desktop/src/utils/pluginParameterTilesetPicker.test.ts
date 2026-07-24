import { describe, expect, it } from 'vitest';
import type { EditorProjectCatalog } from '../api/client';
import {
  buildPluginParameterTilesetOptions,
  formatPluginTilesetDisplayLabel,
  resolvePluginTilesetPreviewUrl,
} from './pluginParameterTilesetPicker';

function catalogStub(overrides: Partial<EditorProjectCatalog> = {}): EditorProjectCatalog {
  return {
    project: 'demo',
    engine: 'rpg-maker-mv',
    tileSize: 48,
    screenWidth: 816,
    screenHeight: 624,
    faceSize: 144,
    iconSize: 32,
    maps: [],
    switches: [],
    variables: [],
    elements: [],
    skillTypes: [],
    weaponTypes: [],
    armorTypes: [],
    equipTypes: [],
    actors: [],
    classes: [],
    skills: [],
    items: [],
    weapons: [],
    armors: [],
    states: [],
    enemies: [],
    troops: [],
    tilesets: [
      {
        id: 1,
        name: 'Field',
        tilesetNames: ['', '', '', '', '', 'World_A5', 'World_B', '', ''],
      },
      {
        id: 2,
        name: 'Empty',
        tilesetNames: ['', '', '', '', '', '', '', '', ''],
      },
    ],
    commonEvents: [],
    animations: [],
    battle: {
      sideView: false,
      battleback1Name: '',
      battleback2Name: '',
      testBattlers: [],
      actorProfiles: [],
      classProfiles: [],
    },
    assets: {
      characters: [],
      faces: [],
      svActors: [],
      enemies: [],
      svEnemies: [],
      tilesets: [
        { name: 'World_A5', fileName: 'World_A5.png', url: 'rmmv-asset://project/t/img/tilesets/World_A5.png' },
      ],
      animations: [],
      pictures: [],
      parallaxes: [],
      battlebacks1: [],
      battlebacks2: [],
      system: [],
      titles1: [],
      titles2: [],
      bgm: [],
      bgs: [],
      me: [],
      se: [],
      movies: [],
      effects: [],
    },
    ...overrides,
  } as EditorProjectCatalog;
}

describe('pluginParameterTilesetPicker', () => {
  it('builds gallery options with A5 preview urls', () => {
    const options = buildPluginParameterTilesetOptions(catalogStub());
    expect(options).toEqual([
      {
        id: 1,
        label: '1 · Field',
        previewUrl: 'rmmv-asset://project/t/img/tilesets/World_A5.png',
      },
      {
        id: 2,
        label: '2 · Empty',
        previewUrl: null,
      },
    ]);
  });

  it('resolves preview url and display label for the selected id', () => {
    const catalog = catalogStub();
    expect(resolvePluginTilesetPreviewUrl(catalog, 1)).toBe(
      'rmmv-asset://project/t/img/tilesets/World_A5.png',
    );
    expect(resolvePluginTilesetPreviewUrl(catalog, 2)).toBeNull();
    expect(formatPluginTilesetDisplayLabel(catalog, 1, '(None)')).toBe('1 · Field');
    expect(formatPluginTilesetDisplayLabel(catalog, 0, '(None)')).toBe('(None)');
  });
});
