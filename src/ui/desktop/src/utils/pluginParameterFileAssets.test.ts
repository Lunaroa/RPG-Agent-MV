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

  test('lists whole files under a standard @dir without selecting sprite cells', () => {
    const catalog = catalogWith({
      pictures: [
        { name: 'Actor1', fileName: 'Actor1.png', url: 'rmmv-asset://a' },
        { name: 'ui/Badge', fileName: 'ui/Badge.png', url: 'rmmv-asset://b' },
      ],
    });
    const resolved = resolvePluginParameterFileAssetsFromCatalog(catalog, 'img/pictures');
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.media, 'image');
    assert.deepEqual(resolved.assets.map((asset) => asset.name), ['Actor1', 'ui/Badge']);
  });

  test('scopes nested @dir to files under that subdirectory', () => {
    const catalog = catalogWith({
      pictures: [
        { name: 'Actor1', fileName: 'Actor1.png', url: 'rmmv-asset://a' },
        { name: 'ui/Badge', fileName: 'ui/Badge.png', url: 'rmmv-asset://b' },
        { name: 'ui/Frame', fileName: 'ui/Frame.png', url: 'rmmv-asset://c' },
      ],
    });
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
    ): Promise<ProjectRelativeDirectoryListResult> => ({
      ok: true,
      directory: relativeDirectory,
      assets: [
        { name: 'map_upper', fileName: 'map_upper.png', url: 'rmmv-asset://map' },
      ],
    });
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
