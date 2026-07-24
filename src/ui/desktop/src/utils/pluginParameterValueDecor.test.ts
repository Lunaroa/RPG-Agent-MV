import { describe, expect, it } from 'vitest';
import type { EditorProjectCatalog, PluginParameterSchemaField } from '../api/client';
import {
  resolvePluginParameterValueDecor,
  resolveTilesetPreviewSheetName,
} from './pluginParameterValueDecor';

function field(
  partial: Partial<PluginParameterSchemaField> & Pick<PluginParameterSchemaField, 'key' | 'kind'>,
): PluginParameterSchemaField {
  return {
    label: partial.key,
    description: '',
    editable: true,
    ...partial,
  } as PluginParameterSchemaField;
}

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
    actors: [
      { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0 },
    ],
    classes: [{ id: 1, name: 'Knight' }],
    skills: [],
    items: [],
    weapons: [],
    armors: [],
    states: [],
    enemies: [
      { id: 1, name: 'Slime', battlerName: 'Slime', battlerHue: 0 },
    ],
    troops: [],
    tilesets: [
      {
        id: 1,
        name: 'Field',
        tilesetNames: ['', '', '', '', '', 'World_A5', 'World_B', '', ''],
      },
    ],
    commonEvents: [],
    animations: [
      { id: 1, name: 'Hit', animation1Name: 'Attack1' },
      { id: 2, name: 'Empty', animation1Name: '' },
    ],
    battle: {
      sideView: false,
      battleback1Name: '',
      battleback2Name: '',
      testBattlers: [],
      actorProfiles: [],
      classProfiles: [],
    },
    assets: {
      characters: [{ name: 'Actor1', fileName: 'Actor1.png', url: 'rmmv-asset://project/t/img/characters/Actor1.png' }],
      faces: [],
      svActors: [],
      enemies: [
        { name: 'Slime', fileName: 'Slime.png', url: 'rmmv-asset://project/t/img/enemies/Slime.png' },
      ],
      svEnemies: [
        { name: 'Slime', fileName: 'Slime.png', url: 'rmmv-asset://project/t/img/sv_enemies/Slime.png' },
      ],
      tilesets: [
        { name: 'World_A5', fileName: 'World_A5.png', url: 'rmmv-asset://project/t/img/tilesets/World_A5.png' },
        { name: 'World_B', fileName: 'World_B.png', url: 'rmmv-asset://project/t/img/tilesets/World_B.png' },
      ],
      animations: [
        { name: 'Attack1', fileName: 'Attack1.png', url: 'rmmv-asset://project/t/img/animations/Attack1.png' },
      ],
      pictures: [
        { name: 'Pic', fileName: 'Pic.png', url: 'rmmv-asset://project/t/img/pictures/Pic.png' },
      ],
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

describe('resolveTilesetPreviewSheetName', () => {
  it('prefers A5 then first non-empty sheet', () => {
    expect(resolveTilesetPreviewSheetName(['', '', '', '', '', 'A5', 'B'])).toBe('A5');
    expect(resolveTilesetPreviewSheetName(['A1', '', '', '', '', '', 'B'])).toBe('A1');
    expect(resolveTilesetPreviewSheetName(['', '', ''])).toBeNull();
  });
});

describe('resolvePluginParameterValueDecor', () => {
  it('adds a database icon without media for class references', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'classId', kind: 'database', databaseTable: 'Classes' }),
      1,
      catalogStub(),
    );
    expect(decor.iconId).toBe('class');
    expect(decor.icon).toBeTruthy();
    expect(decor.media).toBeNull();
  });

  it('resolves actor walking media from catalog', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'actorId', kind: 'database', databaseTable: 'Actors' }),
      1,
      catalogStub(),
    );
    expect(decor.iconId).toBe('actor');
    expect(decor.media).toEqual({
      kind: 'actor',
      characterName: 'Actor1',
      characterIndex: 0,
    });
  });

  it('resolves animation sheet media when animation1Name exists', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'animId', kind: 'database', databaseTable: 'Animations' }),
      1,
      catalogStub(),
    );
    expect(decor.iconId).toBe('animation');
    expect(decor.media).toEqual({
      kind: 'image',
      url: 'rmmv-asset://project/t/img/animations/Attack1.png',
    });
  });

  it('keeps animation icon only when sheet name is missing', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'animId', kind: 'database', databaseTable: 'Animations' }),
      2,
      catalogStub(),
    );
    expect(decor.iconId).toBe('animation');
    expect(decor.media).toBeNull();
  });

  it('resolves IconSet media for skills with iconIndex', () => {
    const catalog = catalogStub({
      skills: [{ id: 1, name: 'Attack', iconIndex: 76 }],
      assets: {
        ...catalogStub().assets,
        system: [
          { name: 'IconSet', fileName: 'IconSet.png', url: 'rmmv-asset://project/t/img/system/IconSet.png' },
        ],
      },
    });
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'skillId', kind: 'database', databaseTable: 'Skills' }),
      1,
      catalog,
    );
    expect(decor.iconId).toBe('skill');
    expect(decor.media).toEqual({ kind: 'icon', iconIndex: 76 });
  });

  it('keeps class as type icon only without IconSet media', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'classId', kind: 'database', databaseTable: 'Classes' }),
      1,
      catalogStub(),
    );
    expect(decor.iconId).toBe('class');
    expect(decor.media).toBeNull();
  });

  it('resolves enemy battler image from front-view assets', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'enemyId', kind: 'database', databaseTable: 'Enemies' }),
      1,
      catalogStub(),
    );
    expect(decor.iconId).toBe('enemy');
    expect(decor.media).toEqual({
      kind: 'image',
      url: 'rmmv-asset://project/t/img/enemies/Slime.png',
    });
  });

  it('resolves enemy battler from sv_enemies when sideView is on', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'enemyId', kind: 'database', databaseTable: 'Enemies' }),
      1,
      catalogStub({
        battle: {
          ...catalogStub().battle,
          sideView: true,
        },
      }),
    );
    expect(decor.media).toEqual({
      kind: 'image',
      url: 'rmmv-asset://project/t/img/sv_enemies/Slime.png',
    });
  });

  it('resolves tileset sheet media preferring A5', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'tilesetId', kind: 'database', databaseTable: 'Tilesets' }),
      1,
      catalogStub(),
    );
    expect(decor.iconId).toBe('tileset');
    expect(decor.media).toEqual({
      kind: 'image',
      url: 'rmmv-asset://project/t/img/tilesets/World_A5.png',
    });
  });

  it('resolves file image thumbs from catalog assets', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'pic', kind: 'file', directory: 'img/pictures' }),
      'Pic',
      catalogStub(),
    );
    expect(decor.icon).toBeNull();
    expect(decor.media).toEqual({
      kind: 'image',
      url: 'rmmv-asset://project/t/img/pictures/Pic.png',
    });
  });

  it('skips non-image file directories', () => {
    const decor = resolvePluginParameterValueDecor(
      field({ key: 'bgm', kind: 'file', directory: 'audio/bgm' }),
      'Theme',
      catalogStub(),
    );
    expect(decor.media).toBeNull();
  });
});
