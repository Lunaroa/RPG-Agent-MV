import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { AssetLibrarySkillEntry } from '../../../../contract/types.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import { resolveAssetRequest } from './asset-service.ts';
import {
  buildAssetLibraryCatalog,
  importAssetLibraryEntry,
  validateAssetLibraryImport,
} from './asset-library-service.ts';
import { withTestLanguage } from '../i18n/with-test-language.ts';
import { getProjectFileForRead } from './staging-service.ts';

describe('static asset library', { concurrency: false }, () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-library-'));
    project = path.join(root, 'projects', 'Project');
    fs.mkdirSync(path.join(root, 'data', 'assets', 'sources', 'pack', 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data', 'assets', 'skill-library'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data', 'assets', 'map-visual-library'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'img', 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'assets', 'sources', 'pack', 'img', 'pictures', 'Portrait.png'), 'library');
    fs.writeFileSync(path.join(project, 'www', 'img', 'pictures', 'ProjectOnly.png'), 'project');
    fs.writeFileSync(path.join(project, 'www', 'img', 'system', 'IconSet.png'), 'icons');
    writeJson(path.join(root, 'data', 'assets', 'map-visual-library', 'index.json'), { entries: [] });
    writeJson(path.join(project, 'www', 'data', 'System.json'), {
      skillTypes: ['', 'Magic'],
      weaponTypes: [''],
      elements: ['', 'Fire'],
    });
    writeJson(path.join(project, 'www', 'data', 'Animations.json'), [null, { id: 1, name: 'Flame' }]);
    writeJson(path.join(project, 'www', 'data', 'States.json'), [null]);
    writeJson(path.join(project, 'www', 'data', 'CommonEvents.json'), [null]);
    writeJson(path.join(project, 'www', 'data', 'Skills.json'), [null]);
    writeJson(path.join(root, 'data', 'assets', 'skill-library', 'index.json'), {
      schemaVersion: 1,
      entries: [skillEntry()],
    });
    await bootstrapDatabase(root, { dbPath: path.join(root, 'data', 'test.db'), importLegacyJson: false });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('always lists every asset category even when count is zero', () => withTestLanguage(() => {
    const catalog = buildAssetLibraryCatalog(root);
    assert.equal(catalog.categories.length, 7);
    const characters = catalog.categories.find((category) => category.id === 'characters');
    assert.equal(characters?.count, 0);
    assert.equal(characters?.label, '角色与脸图');
  }));

  test('lists only static entries and resolves library source URLs inside data/assets', () => withTestLanguage(() => {
    const catalog = buildAssetLibraryCatalog(root);
    assert.equal(catalog.entries.some((entry) => entry.name === 'Portrait'), true);
    assert.equal(catalog.entries.some((entry) => entry.name === 'ProjectOnly'), false);
    assert.equal(catalog.entries.some((entry) => entry.name === 'Fire'), true);
    const file = catalog.entries.find((entry) => entry.kind === 'file');
    assert.ok(file && file.kind === 'file');
    assert.match(file.url, /^rmmv-asset:\/\/library\/source\//);
    assert.equal(resolveAssetRequest(root, file.url), path.join(root, 'data', 'assets', 'sources', 'pack', 'img', 'pictures', 'Portrait.png'));
    assert.throws(() => resolveAssetRequest(root, 'rmmv-asset://shared/pack/img/pictures/Portrait.png'));
  }));

  test('imports static files and skills through staging without mutating library sources', () => withTestLanguage(() => {
    const catalog = buildAssetLibraryCatalog(root);
    const file = catalog.entries.find((entry) => entry.kind === 'file');
    const skill = catalog.entries.find((entry) => entry.kind === 'skill');
    assert.ok(file);
    assert.ok(skill);
    assert.equal(validateAssetLibraryImport(root, project, skill.assetId).ok, true);
    const fileResult = importAssetLibraryEntry(root, project, file.assetId);
    const skillResult = importAssetLibraryEntry(root, project, skill.assetId);
    assert.equal(fileResult.relativePath, 'www/img/pictures/Portrait.png');
    assert.equal(fs.existsSync(path.join(project, 'www', 'img', 'pictures', 'Portrait.png')), false);
    const stagedPortrait = getProjectFileForRead(root, project, 'www/img/pictures/Portrait.png');
    assert.ok(stagedPortrait);
    assert.equal(fs.readFileSync(stagedPortrait, 'utf8'), 'library');
    assert.equal(fs.readFileSync(path.join(root, 'data', 'assets', 'sources', 'pack', 'img', 'pictures', 'Portrait.png'), 'utf8'), 'library');
    assert.equal(skillResult.importedId, 1);
    const stagedSkills = getProjectFileForRead(root, project, 'www/data/Skills.json');
    assert.ok(stagedSkills);
    assert.equal((readJson(stagedSkills) as any[])[1].name, 'Fire');
    assert.equal((readJson(path.join(project, 'www', 'data', 'Skills.json')) as any[])[1], undefined);
  }));

  test('imports static files and skills into flat data projects without adding www prefix', () => withTestLanguage(() => {
    const flatProject = path.join(root, 'projects', 'FlatProject');
    fs.mkdirSync(path.join(flatProject, 'data'), { recursive: true });
    fs.mkdirSync(path.join(flatProject, 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(flatProject, 'img', 'system'), { recursive: true });
    fs.writeFileSync(path.join(flatProject, 'img', 'system', 'IconSet.png'), 'icons');
    writeJson(path.join(flatProject, 'data', 'System.json'), {
      skillTypes: ['', 'Magic'],
      weaponTypes: [''],
      elements: ['', 'Fire'],
    });
    writeJson(path.join(flatProject, 'data', 'Animations.json'), [null, { id: 1, name: 'Flame' }]);
    writeJson(path.join(flatProject, 'data', 'States.json'), [null]);
    writeJson(path.join(flatProject, 'data', 'CommonEvents.json'), [null]);
    writeJson(path.join(flatProject, 'data', 'Skills.json'), [null]);

    const catalog = buildAssetLibraryCatalog(root);
    const file = catalog.entries.find((entry) => entry.kind === 'file');
    const skill = catalog.entries.find((entry) => entry.kind === 'skill');
    assert.ok(file);
    assert.ok(skill);
    assert.equal(validateAssetLibraryImport(root, flatProject, skill.assetId).ok, true);

    const fileResult = importAssetLibraryEntry(root, flatProject, file.assetId);
    const skillResult = importAssetLibraryEntry(root, flatProject, skill.assetId);

    assert.equal(fileResult.relativePath, 'img/pictures/Portrait.png');
    assert.equal(fs.existsSync(path.join(flatProject, 'img', 'pictures', 'Portrait.png')), false);
    assert.equal(fs.readFileSync(getProjectFileForRead(root, flatProject, 'img/pictures/Portrait.png')!, 'utf8'), 'library');
    assert.equal(skillResult.importedId, 1);
    assert.equal((readJson(getProjectFileForRead(root, flatProject, 'data/Skills.json')!) as any[])[1].name, 'Fire');
    assert.equal((readJson(path.join(flatProject, 'data', 'Skills.json')) as any[])[1], undefined);
  }));

  test('rejects skill import when a declared dependency is incompatible', () => withTestLanguage(() => {
    writeJson(path.join(project, 'www', 'data', 'Animations.json'), [null, { id: 1, name: 'Wrong' }]);
    const validation = validateAssetLibraryImport(root, project, skillEntry().assetId);
    assert.equal(validation.ok, false);
    assert.match(validation.issues.join('\n'), /动画不兼容/);
    assert.throws(() => importAssetLibraryEntry(root, project, skillEntry().assetId), /导入校验失败/);
  }));

  test('rejects malformed static skill packages with undeclared references', () => withTestLanguage(() => {
    const malformed = skillEntry();
    malformed.dependencies.animations = [];
    writeJson(path.join(root, 'data', 'assets', 'skill-library', 'index.json'), {
      schemaVersion: 1,
      entries: [malformed],
    });
    assert.throws(() => buildAssetLibraryCatalog(root), /未声明动画/);
  }));
});

function skillEntry(): AssetLibrarySkillEntry {
  return {
    kind: 'skill',
    assetId: 'skill:test:fire',
    category: 'skills',
    name: 'Fire',
    sourcePackage: 'test',
    skill: {
      id: 0,
      name: 'Fire',
      description: 'Fire spell',
      stypeId: 1,
      animationId: 1,
      damage: { elementId: 1, formula: 'a.mat * 2', type: 1 },
      effects: [],
    },
    dependencies: {
      skillTypes: [{ id: 1, name: 'Magic' }],
      weaponTypes: [],
      elements: [{ id: 1, name: 'Fire' }],
      animations: [{ id: 1, name: 'Flame' }],
      states: [],
      commonEvents: [],
      plugins: [],
      resources: ['img/system/IconSet.png'],
    },
  };
}
