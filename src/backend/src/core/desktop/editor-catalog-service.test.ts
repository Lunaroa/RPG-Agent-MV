import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { buildEditorProjectCatalog } from './editor-catalog-service.ts';
import { writeStagedProjectBuffer } from './staging-service.ts';

describe('editor catalog service', () => {
  test('reads flat data layout without hardcoded www/data paths', async () => {
    const root = tempRoot();
    const project = path.join(root, 'projects', 'FlatProject');
    try {
      await bootstrapDatabase(root, { importLegacyJson: false });
      writeFlatProject(project);
      writeStagedImages(root, project);

      const catalog = buildEditorProjectCatalog(root, project);

      assert.equal(catalog.switches[0].name, 'Intro');
      assert.equal(catalog.variables[0].name, 'Progress');
      assert.equal(catalog.elements[0].name, 'Fire');
      assert.equal(catalog.skillTypes[0].name, 'Magic');
      assert.equal(catalog.weaponTypes[0].name, 'Sword');
      assert.equal(catalog.armorTypes[0].name, 'Shield');
      assert.equal(catalog.equipTypes[0].name, 'Weapon');
      assert.equal(catalog.actors[0].name, 'Hero');
      assert.equal(catalog.skills[0].name, 'Spark');
      assertIncludes(catalog.assets.characters.map((asset) => asset.fileName), 'Hero.png');
      assertIncludes(catalog.assets.faces.map((asset) => asset.fileName), 'HeroFace.png');
      assertIncludes(catalog.assets.svActors.map((asset) => asset.fileName), 'HeroSv.png');
      assertIncludes(catalog.assets.enemies.map((asset) => asset.fileName), 'Slime.png');
      assertIncludes(catalog.assets.svEnemies.map((asset) => asset.fileName), 'SideSlime.png');
      assertIncludes(catalog.assets.tilesets.map((asset) => asset.fileName), 'Outside_A1.png');
      assertIncludes(catalog.assets.animations.map((asset) => asset.fileName), 'Slash.png');
      assertIncludes(catalog.assets.pictures.map((asset) => asset.fileName), 'Portrait.png');
      assertIncludes(catalog.assets.parallaxes.map((asset) => asset.fileName), 'Clouds.png');
      assertIncludes(catalog.assets.battlebacks1.map((asset) => asset.fileName), 'Grassland.png');
      assertIncludes(catalog.assets.battlebacks2.map((asset) => asset.fileName), 'Forest.png');
      assertIncludes(catalog.assets.system.map((asset) => asset.fileName), 'Window.png');
      assertIncludes(catalog.assets.titles1.map((asset) => asset.fileName), 'Book.png');
      assertIncludes(catalog.assets.titles2.map((asset) => asset.fileName), 'Sword.png');
      assert.equal(catalog.assets.bgm[0].fileName, 'Theme.ogg');
      assertIncludes(catalog.assets.characters.map((asset) => asset.fileName), 'StagedHero.png');
      assertIncludes(catalog.assets.faces.map((asset) => asset.fileName), 'StagedFace.png');
      assertIncludes(catalog.assets.svActors.map((asset) => asset.fileName), 'StagedSvActor.png');
      assertIncludes(catalog.assets.enemies.map((asset) => asset.fileName), 'StagedEnemy.png');
      assertIncludes(catalog.assets.svEnemies.map((asset) => asset.fileName), 'StagedSvEnemy.png');
      assertIncludes(catalog.assets.tilesets.map((asset) => asset.fileName), 'StagedTileset.png');
      assertIncludes(catalog.assets.system.map((asset) => asset.fileName), 'StagedSystem.png');
      assertIncludes(catalog.assets.titles1.map((asset) => asset.fileName), 'StagedTitle1.png');
      assertIncludes(catalog.assets.titles2.map((asset) => asset.fileName), 'StagedTitle2.png');
    } finally {
      closeDatabase();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rpg-catalog-'));
}

function writeFlatProject(project: string): void {
  const dataDir = path.join(project, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const dir of [
    'characters',
    'faces',
    'sv_actors',
    'enemies',
    'sv_enemies',
    'tilesets',
    'animations',
    'pictures',
    'parallaxes',
    'battlebacks1',
    'battlebacks2',
    'system',
    'titles1',
    'titles2',
  ]) {
    fs.mkdirSync(path.join(project, 'img', dir), { recursive: true });
  }
  fs.mkdirSync(path.join(project, 'audio', 'bgm'), { recursive: true });
  writeJson(path.join(dataDir, 'System.json'), {
    switches: [null, 'Intro'],
    variables: [null, 'Progress'],
    elements: [null, 'Fire'],
    skillTypes: [null, 'Magic'],
    weaponTypes: [null, 'Sword'],
    armorTypes: [null, 'Shield'],
    equipTypes: [null, 'Weapon'],
  });
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1 }]);
  writeJson(path.join(dataDir, 'Map001.json'), { width: 17, height: 13, tilesetId: 1, data: [], events: [null] });
  writeJson(path.join(dataDir, 'Actors.json'), [null, { id: 1, name: 'Hero' }]);
  writeJson(path.join(dataDir, 'Classes.json'), []);
  writeJson(path.join(dataDir, 'Skills.json'), [null, { id: 1, name: 'Spark' }]);
  writeJson(path.join(dataDir, 'Items.json'), []);
  writeJson(path.join(dataDir, 'Weapons.json'), []);
  writeJson(path.join(dataDir, 'Armors.json'), []);
  writeJson(path.join(dataDir, 'States.json'), []);
  writeJson(path.join(dataDir, 'Enemies.json'), []);
  writeJson(path.join(dataDir, 'Troops.json'), []);
  writeJson(path.join(dataDir, 'Tilesets.json'), []);
  writeJson(path.join(dataDir, 'CommonEvents.json'), []);
  writeJson(path.join(dataDir, 'Animations.json'), []);
  fs.writeFileSync(path.join(project, 'img', 'characters', 'Hero.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'faces', 'HeroFace.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'sv_actors', 'HeroSv.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'enemies', 'Slime.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'sv_enemies', 'SideSlime.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'tilesets', 'Outside_A1.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'animations', 'Slash.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'pictures', 'Portrait.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'parallaxes', 'Clouds.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'battlebacks1', 'Grassland.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'battlebacks2', 'Forest.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'system', 'Window.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'titles1', 'Book.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'img', 'titles2', 'Sword.png'), 'png', 'utf8');
  fs.writeFileSync(path.join(project, 'audio', 'bgm', 'Theme.ogg'), 'ogg', 'utf8');
}

function writeStagedImages(root: string, project: string): void {
  for (const [relativePath, content] of [
    ['img/characters/StagedHero.png', 'character'],
    ['img/faces/StagedFace.png', 'face'],
    ['img/sv_actors/StagedSvActor.png', 'sv actor'],
    ['img/enemies/StagedEnemy.png', 'enemy'],
    ['img/sv_enemies/StagedSvEnemy.png', 'sv enemy'],
    ['img/tilesets/StagedTileset.png', 'tileset'],
    ['img/system/StagedSystem.png', 'system'],
    ['img/titles1/StagedTitle1.png', 'title1'],
    ['img/titles2/StagedTitle2.png', 'title2'],
  ] as const) {
    writeStagedProjectBuffer(root, project, relativePath, Buffer.from(content, 'utf8'));
  }
}

function assertIncludes(values: string[], expected: string): void {
  assert.ok(values.includes(expected), `Expected ${expected} in ${values.join(', ')}`);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
}
