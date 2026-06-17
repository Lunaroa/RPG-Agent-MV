import fs from 'node:fs';
import path from 'node:path';

import type { EditorProjectCatalog, NamedCatalogEntry, ProjectAssetEntry } from '../../../../contract/types.ts';
import { readJson } from '../rmmv/json.ts';
import { assetBucketRelativePath, dataRelativePath, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { projectAssetUrl } from './asset-service.ts';
import { buildMapIndex } from './map-service.ts';
import { getProjectFileForRead, getProjectStagingStatus } from './staging-service.ts';

const ASSET_BUCKETS = {
  characters: { bucket: 'characters', extensions: new Set(['.png']) },
  faces: { bucket: 'faces', extensions: new Set(['.png']) },
  svActors: { bucket: 'svActors', extensions: new Set(['.png']) },
  enemies: { bucket: 'enemies', extensions: new Set(['.png']) },
  svEnemies: { bucket: 'svEnemies', extensions: new Set(['.png']) },
  tilesets: { bucket: 'tilesets', extensions: new Set(['.png']) },
  animations: { bucket: 'animations', extensions: new Set(['.png']) },
  pictures: { bucket: 'pictures', extensions: new Set(['.png']) },
  parallaxes: { bucket: 'parallaxes', extensions: new Set(['.png']) },
  battlebacks1: { bucket: 'battlebacks1', extensions: new Set(['.png']) },
  battlebacks2: { bucket: 'battlebacks2', extensions: new Set(['.png']) },
  system: { bucket: 'system', extensions: new Set(['.png']) },
  titles1: { bucket: 'titles1', extensions: new Set(['.png']) },
  titles2: { bucket: 'titles2', extensions: new Set(['.png']) },
  bgm: { bucket: 'bgm', extensions: new Set(['.ogg', '.m4a']) },
  bgs: { bucket: 'bgs', extensions: new Set(['.ogg', '.m4a']) },
  me: { bucket: 'me', extensions: new Set(['.ogg', '.m4a']) },
  se: { bucket: 'se', extensions: new Set(['.ogg', '.m4a']) },
  movies: { bucket: 'movies', extensions: new Set(['.webm', '.mp4']) },
} as const;

export function buildEditorProjectCatalog(workflowRoot: string, project: string): EditorProjectCatalog {
  const layout = resolveRmmvLayout(project);
  const dataFile = (fileName: string) => dataRelativePath(layout, fileName);
  const assetDir = (key: keyof typeof ASSET_BUCKETS) => assetBucketRelativePath(layout, ASSET_BUCKETS[key].bucket);
  const system = readProjectJson(workflowRoot, project, dataFile('System.json'), {});
  return {
    project,
    maps: buildMapIndex(workflowRoot, project).maps,
    switches: namedStringList(system.switches),
    variables: namedStringList(system.variables),
    elements: namedStringList(system.elements),
    skillTypes: namedStringList(system.skillTypes),
    weaponTypes: namedStringList(system.weaponTypes),
    armorTypes: namedStringList(system.armorTypes),
    equipTypes: namedStringList(system.equipTypes),
    actors: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Actors.json'), [])),
    classes: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Classes.json'), [])),
    skills: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Skills.json'), [])),
    items: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Items.json'), [])),
    weapons: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Weapons.json'), [])),
    armors: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Armors.json'), [])),
    states: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('States.json'), [])),
    enemies: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Enemies.json'), [])),
    troops: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Troops.json'), [])),
    tilesets: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Tilesets.json'), [])),
    commonEvents: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('CommonEvents.json'), [])),
    animations: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Animations.json'), [])),
    assets: {
      characters: listProjectAssets(workflowRoot, project, assetDir('characters'), ASSET_BUCKETS.characters.extensions),
      faces: listProjectAssets(workflowRoot, project, assetDir('faces'), ASSET_BUCKETS.faces.extensions),
      svActors: listProjectAssets(workflowRoot, project, assetDir('svActors'), ASSET_BUCKETS.svActors.extensions),
      enemies: listProjectAssets(workflowRoot, project, assetDir('enemies'), ASSET_BUCKETS.enemies.extensions),
      svEnemies: listProjectAssets(workflowRoot, project, assetDir('svEnemies'), ASSET_BUCKETS.svEnemies.extensions),
      tilesets: listProjectAssets(workflowRoot, project, assetDir('tilesets'), ASSET_BUCKETS.tilesets.extensions),
      animations: listProjectAssets(workflowRoot, project, assetDir('animations'), ASSET_BUCKETS.animations.extensions),
      pictures: listProjectAssets(workflowRoot, project, assetDir('pictures'), ASSET_BUCKETS.pictures.extensions),
      parallaxes: listProjectAssets(workflowRoot, project, assetDir('parallaxes'), ASSET_BUCKETS.parallaxes.extensions),
      battlebacks1: listProjectAssets(workflowRoot, project, assetDir('battlebacks1'), ASSET_BUCKETS.battlebacks1.extensions),
      battlebacks2: listProjectAssets(workflowRoot, project, assetDir('battlebacks2'), ASSET_BUCKETS.battlebacks2.extensions),
      system: listProjectAssets(workflowRoot, project, assetDir('system'), ASSET_BUCKETS.system.extensions),
      titles1: listProjectAssets(workflowRoot, project, assetDir('titles1'), ASSET_BUCKETS.titles1.extensions),
      titles2: listProjectAssets(workflowRoot, project, assetDir('titles2'), ASSET_BUCKETS.titles2.extensions),
      bgm: listProjectAssets(workflowRoot, project, assetDir('bgm'), ASSET_BUCKETS.bgm.extensions),
      bgs: listProjectAssets(workflowRoot, project, assetDir('bgs'), ASSET_BUCKETS.bgs.extensions),
      me: listProjectAssets(workflowRoot, project, assetDir('me'), ASSET_BUCKETS.me.extensions),
      se: listProjectAssets(workflowRoot, project, assetDir('se'), ASSET_BUCKETS.se.extensions),
      movies: listProjectAssets(workflowRoot, project, assetDir('movies'), ASSET_BUCKETS.movies.extensions),
    },
  };
}

function readProjectJson(workflowRoot: string, project: string, relativePath: string, fallback: any): any {
  const file = getProjectFileForRead(workflowRoot, project, relativePath);
  return file ? readJson(file) : fallback;
}

function namedStringList(value: unknown): NamedCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((name, id) => id > 0 && typeof name === 'string'
    ? [{ id, name: name || `#${id}` }]
    : []);
}

function namedDatabaseList(value: unknown): NamedCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const id = Number((entry as Record<string, unknown>).id ?? index);
    if (!Number.isInteger(id) || id <= 0) return [];
    return [{ id, name: String((entry as Record<string, unknown>).name || `#${id}`) }];
  });
}

function listProjectAssets(workflowRoot: string, project: string, directory: string, extensions: ReadonlySet<string>): ProjectAssetEntry[] {
  const files = new Map<string, boolean>();
  const absolute = path.join(project, ...directory.split('/'));
  if (fs.existsSync(absolute)) {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.set(entry.name, true);
    }
  }
  const prefix = `${directory}/`;
  for (const entry of getProjectStagingStatus(workflowRoot, project).files) {
    if (!entry.relativePath.startsWith(prefix)) continue;
    const fileName = entry.relativePath.slice(prefix.length);
    if (!fileName || fileName.includes('/') || !extensions.has(path.extname(fileName).toLowerCase())) continue;
    if (entry.delete) files.delete(fileName);
    else files.set(fileName, true);
  }
  return [...files.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      name: path.basename(fileName, path.extname(fileName)),
      fileName,
      url: projectAssetUrl(project, `${directory}/${fileName}`),
    }));
}
