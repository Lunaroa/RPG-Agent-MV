import { describe, expect, it } from 'vitest';
import type { EditorProjectCatalog, PluginParameterSchemaField } from '../api/client';
import { resolvePluginParameterValueDecor } from './pluginParameterValueDecor';

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
    enemies: [],
    troops: [],
    tilesets: [],
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
      enemies: [],
      svEnemies: [],
      tilesets: [],
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
