import fs from 'node:fs';
import path from 'node:path';

import type {
  EditorActorBattleProfile,
  EditorBattleTestBattler,
  EditorEnemyCatalogEntry,
  EditorEquipmentCatalogEntry,
  EditorProjectCatalog,
  NamedCatalogEntry,
  ProjectAssetEntry,
} from '../../../../contract/types.ts';
import { readJson } from '../rmmv/json.ts';
import { assetBucketRelativePath, dataRelativePath, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import { hasStandardDualWieldTrait, standardEquipSlotTypeIds } from '../rmmv/equipment-slots.ts';
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
  const actors = readProjectJson(workflowRoot, project, dataFile('Actors.json'), []);
  const classes = readProjectJson(workflowRoot, project, dataFile('Classes.json'), []);
  const weapons = readProjectJson(workflowRoot, project, dataFile('Weapons.json'), []);
  const armors = readProjectJson(workflowRoot, project, dataFile('Armors.json'), []);
  const enemies = readProjectJson(workflowRoot, project, dataFile('Enemies.json'), []);
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
    actors: namedDatabaseList(actors),
    classes: namedDatabaseList(classes),
    skills: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Skills.json'), [])),
    items: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Items.json'), [])),
    weapons: equipmentDatabaseList(weapons),
    armors: equipmentDatabaseList(armors),
    states: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('States.json'), [])),
    enemies: enemyDatabaseList(enemies),
    troops: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Troops.json'), [])),
    tilesets: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Tilesets.json'), [])),
    commonEvents: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('CommonEvents.json'), [])),
    animations: namedDatabaseList(readProjectJson(workflowRoot, project, dataFile('Animations.json'), [])),
    battle: {
      sideView: system.optSideView === true,
      battleback1Name: stringValue(system.battleback1Name),
      battleback2Name: stringValue(system.battleback2Name),
      testBattlers: testBattlerList(system.testBattlers),
      actorProfiles: actorBattleProfiles(actors, classes, system.equipTypes),
      classProfiles: classBattleProfiles(classes),
    },
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

function equipmentDatabaseList(value: unknown): EditorEquipmentCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const record = asRecord(entry);
    if (!record) return [];
    const id = positiveInteger(record.id) ?? index;
    if (id <= 0) return [];
    return [{ id, name: stringValue(record.name) || `#${id}`, etypeId: integerValue(record.etypeId) ?? 0 }];
  });
}

function enemyDatabaseList(value: unknown): EditorEnemyCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const record = asRecord(entry);
    if (!record) return [];
    const id = positiveInteger(record.id) ?? index;
    if (id <= 0) return [];
    return [{
      id,
      name: stringValue(record.name) || `#${id}`,
      battlerName: stringValue(record.battlerName),
      battlerHue: integerValue(record.battlerHue) ?? 0,
    }];
  });
}

function actorBattleProfiles(actors: unknown, classes: unknown, equipTypes: unknown): EditorActorBattleProfile[] {
  if (!Array.isArray(actors)) return [];
  const classRecords = Array.isArray(classes) ? classes : [];
  return actors.flatMap((entry, index) => {
    const actor = asRecord(entry);
    if (!actor) return [];
    const actorId = positiveInteger(actor.id) ?? index;
    if (actorId <= 0) return [];
    const classId = positiveInteger(actor.classId) ?? 0;
    const classEntry = asRecord(classRecords[classId]);
    const actorDualWield = hasStandardDualWieldTrait(actor.traits);
    const classDualWield = hasStandardDualWieldTrait(classEntry?.traits);
    const dualWield = actorDualWield || classDualWield;
    return [{
      actorId,
      classId,
      initialLevel: positiveInteger(actor.initialLevel) ?? 1,
      maxLevel: positiveInteger(actor.maxLevel) ?? 99,
      initialEquips: integerArray(actor.equips),
      equipSlotTypeIds: standardEquipSlotTypeIds(equipTypes, dualWield),
      actorDualWield,
      classDualWield,
      dualWield,
    }];
  });
}

function testBattlerList(value: unknown): EditorBattleTestBattler[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const battler = asRecord(entry);
    const actorId = positiveInteger(battler?.actorId);
    if (!battler || actorId === null) return [];
    return [{ actorId, level: positiveInteger(battler.level) ?? 1, equips: integerArray(battler.equips) }];
  });
}

function classBattleProfiles(value: unknown): Array<{ classId: number; dualWield: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const classEntry = asRecord(entry);
    if (!classEntry) return [];
    const classId = positiveInteger(classEntry.id) ?? index;
    return classId > 0 ? [{ classId, dualWield: hasStandardDualWieldTrait(classEntry.traits) }] : [];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integerValue(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function positiveInteger(value: unknown): number | null {
  const integer = integerValue(value);
  return integer !== null && integer > 0 ? integer : null;
}

function integerArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => integerValue(item) ?? 0) : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
