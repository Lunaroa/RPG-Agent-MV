import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EditorProjectCatalog, ProjectRelativeDirectoryListResult } from '../../api/client';
import {
  normalizePluginFileDirectory,
  resolvePluginParameterFileAssets,
  resolvePluginParameterFileAssetsFromCatalog,
} from './pluginParameterFileAssets';

function catalogWith(
  assets: Partial<EditorProjectCatalog['assets']>,
  engine: EditorProjectCatalog['engine'] = 'rpg-maker-mv',
): EditorProjectCatalog {
  const empty: EditorProjectCatalog['assets'] = {
    characters: [],
    faces: [],
    svActors: [],
    enemies: [],
    svEnemies: [],
    tilesets: [],
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
  };
  return {
    project: 'projects/sample',
    engine,
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
    tilesets: [],
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
    assets: { ...empty, ...assets },
  };
}

describe('pluginParameterFileAssets', () => {
  test('normalizes @dir and fails fast when directory is missing', () => {
    assert.equal(normalizePluginFileDirectory(' img/pictures/ '), 'img/pictures');
    assert.equal(resolvePluginParameterFileAssetsFromCatalog(catalogWith({}), '').ok, false);
    assert.equal(
      resolvePluginParameterFileAssetsFromCatalog(catalogWith({}), undefined).reason,
      'missing-directory',
    );
  });

  test('MV lists only top-level files under @dir while MZ keeps nested relative paths', () => {
    const pictures = [
      { name: 'Actor1', fileName: 'Actor1.png', url: 'rmmv-asset://a' },
      { name: 'ui/Badge', fileName: 'ui/Badge.png', url: 'rmmv-asset://b' },
    ];
    const mv = resolvePluginParameterFileAssetsFromCatalog(
      catalogWith({ pictures }, 'rpg-maker-mv'),
      'img/pictures',
    );
    assert.equal(mv.ok, true);
    if (!mv.ok) return;
    assert.deepEqual(mv.assets.map((asset) => asset.name), ['Actor1']);

    const mz = resolvePluginParameterFileAssetsFromCatalog(
      catalogWith({ pictures }, 'rpg-maker-mz'),
      'img/pictures',
    );
    assert.equal(mz.ok, true);
    if (!mz.ok) return;
    assert.equal(mz.media, 'image');
    assert.deepEqual(mz.assets.map((asset) => asset.name), ['Actor1', 'ui/Badge']);
  });

  test('scopes nested @dir to files under that subdirectory', () => {
    const catalog = catalogWith({
      pictures: [
        { name: 'Actor1', fileName: 'Actor1.png', url: 'rmmv-asset://a' },
        { name: 'ui/Badge', fileName: 'ui/Badge.png', url: 'rmmv-asset://b' },
        { name: 'ui/Frame', fileName: 'ui/Frame.png', url: 'rmmv-asset://c' },
      ],
    }, 'rpg-maker-mz');
    const resolved = resolvePluginParameterFileAssetsFromCatalog(catalog, 'img/pictures/ui/');
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.assets.map((asset) => asset.name), ['Badge', 'Frame']);
  });

  test('defers non-catalog project-relative @dir to disk listing', () => {
    const deferred = resolvePluginParameterFileAssetsFromCatalog(catalogWith({}), 'img/map');
    assert.equal(deferred.ok, 'needs-list');
    if (deferred.ok !== 'needs-list') return;
    assert.equal(deferred.directory, 'img/map');
    assert.equal(deferred.media, 'image');
  });

  test('lists arbitrary project-relative directories when they exist', async () => {
    const listRelativeDirectory = async (
      relativeDirectory: string,
      options: { recursive: boolean },
    ): Promise<ProjectRelativeDirectoryListResult> => {
      assert.equal(options.recursive, false);
      return {
        ok: true,
        directory: relativeDirectory,
        assets: [
          { name: 'map_upper', fileName: 'map_upper.png', url: 'rmmv-asset://map' },
        ],
      };
    };
    const resolved = await resolvePluginParameterFileAssets(
      catalogWith({}),
      'img/map',
      listRelativeDirectory,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.media, 'image');
    assert.deepEqual(resolved.assets.map((asset) => asset.name), ['map_upper']);
  });

  test('asks disk listing for nested files on MZ projects', async () => {
    const listRelativeDirectory = async (
      relativeDirectory: string,
      options: { recursive: boolean },
    ): Promise<ProjectRelativeDirectoryListResult> => {
      assert.equal(options.recursive, true);
      return {
        ok: true,
        directory: relativeDirectory,
        assets: [
          { name: 'flat', fileName: 'flat.png', url: 'rmmv-asset://flat' },
          { name: 'ui/nested', fileName: 'ui/nested.png', url: 'rmmv-asset://nested' },
        ],
      };
    };
    const resolved = await resolvePluginParameterFileAssets(
      catalogWith({}, 'rpg-maker-mz'),
      'img/map',
      listRelativeDirectory,
    );
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(resolved.assets.map((asset) => asset.name), ['flat', 'ui/nested']);
  });

  test('reports directory-not-found when the relative path is absent', async () => {
    const listRelativeDirectory = async (
      relativeDirectory: string,
    ): Promise<ProjectRelativeDirectoryListResult> => ({
      ok: false,
      reason: 'directory-not-found',
      directory: relativeDirectory,
    });
    const resolved = await resolvePluginParameterFileAssets(
      catalogWith({}),
      'img/missing-folder',
      listRelativeDirectory,
    );
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.reason, 'directory-not-found');
    assert.equal(resolved.directory, 'img/missing-folder');
  });
});
