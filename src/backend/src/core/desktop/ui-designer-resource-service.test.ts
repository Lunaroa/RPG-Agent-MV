import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  inspectUiDesignerResources,
  inspectUiDesignerResourcesAsync,
  inspectUiDesignerResourceReferences,
  readUiDesignerSceneData,
  selectUiDesignerFrameFolder,
  UiDesignerFrameFolderSelectionError,
  UiDesignerSceneDataReadError,
} from './ui-designer-resource-service.ts';

let tempRoot = '';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-resources-'));
});

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('ui designer resource catalog', () => {
  test('loads one category asynchronously in a bounded page and resolves references without a recursive scan', async () => {
    const project = path.join(tempRoot, 'async-project');
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(project, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
    fs.writeFileSync(path.join(project, 'img', 'pictures', 'one.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(project, 'img', 'pictures', 'two.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(project, 'audio', 'theme.ogg'), Buffer.from('audio'));

    const page = await inspectUiDesignerResourcesAsync(project, { category: 'image', limit: 1 });
    assert.equal(page.total, 2);
    assert.equal(page.resources.length, 1);
    assert.equal(page.hasMore, true);
    assert.equal(page.resources[0]?.category, 'image');

    const references = await inspectUiDesignerResourceReferences(project, ['img/pictures/one.png', 'img/pictures/missing.png']);
    assert.equal(references.resources.length, 2);
    assert.equal(references.resources.find((entry) => entry.relativePath === 'img/pictures/one.png')?.exists, true);
    assert.equal(references.resources.find((entry) => entry.relativePath === 'img/pictures/missing.png')?.exists, false);
  });

  test('uses the inspected root-data layout and returns project asset URLs', () => {
    const project = path.join(tempRoot, 'project');
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(project, 'audio', 'bgm'), { recursive: true });
    fs.mkdirSync(path.join(project, 'movies'), { recursive: true });
    fs.mkdirSync(path.join(project, 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
    fs.writeFileSync(path.join(project, 'img', 'pictures', 'sample.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(project, 'audio', 'bgm', 'theme.ogg'), Buffer.from('audio'));
    fs.writeFileSync(path.join(project, 'movies', 'intro.webm'), Buffer.from('video'));
    fs.writeFileSync(path.join(project, 'fonts', 'ui.woff2'), Buffer.from('font'));

    const catalog = inspectUiDesignerResources(project, {
      referencedPaths: ['img/pictures/sample.png', 'img/pictures/missing.png'],
    });
    assert.equal(catalog.engine, 'MV');
    assert.equal(catalog.projectPath, path.resolve(project));
    assert.equal(catalog.projectCompatibility?.engine, 'MV');
    assert.equal(catalog.projectCompatibility?.engineVersionSupported, true);
    assert.equal(catalog.resources.filter((entry) => entry.exists).length, 4);
    const image = catalog.resources.find((entry) => entry.name === 'sample.png');
    assert.ok(image);
    assert.equal(image.category, 'image');
    assert.equal(image.referenced, true);
    assert.equal(image.path, 'img/pictures/sample.png');
    assert.equal(image.relativePath, 'img/pictures/sample.png');
    assert.match(image.previewUrl || '', /^rmmv-asset:\/\/project\//);
    assert.match(image.thumbnailUrl || '', /^rmmv-asset:\/\/project-thumbnail\//);
    const missing = catalog.resources.find((entry) => entry.name === 'missing.png');
    assert.equal(missing?.exists, false);
    assert.equal(missing?.referenced, true);
  });

  test('uses the MV www resource root without persisting the www prefix', () => {
    const project = path.join(tempRoot, 'mv-www-project');
    fs.mkdirSync(path.join(project, 'www', 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(project, 'www', 'audio'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(project, 'www', 'data', 'System.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'www', 'data', 'MapInfos.json'), '[null]', 'utf8');
    fs.writeFileSync(path.join(project, 'www', 'img', 'pictures', 'sample.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(project, 'www', 'audio', 'sample.ogg'), Buffer.from('audio'));

    const catalog = inspectUiDesignerResources(project);
    assert.equal(catalog.engine, 'MV');
    const image = catalog.resources.find((entry) => entry.name === 'sample.png');
    assert.equal(image?.relativePath, 'img/pictures/sample.png');
    assert.match(image?.previewUrl || '', /^rmmv-asset:\/\/project\//);
    assert.ok(!(image?.relativePath || '').startsWith('www/'));
  });

  test('catalogs MV scene-data files as shallow metadata with compatibility markers', () => {
    const project = path.join(tempRoot, 'mv-scene-data');
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'js', 'plugins', 'mzui-data'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
    const sceneDirectory = path.join(project, 'js', 'plugins', 'mzui-data');
    fs.writeFileSync(path.join(sceneDirectory, 'Scene_Sample.json'), JSON.stringify({
      version: '1.0.0', runtimeVersion: '>=1.0.0', meta: { sceneName: 'Scene_Sample' }, nodes: 'not parsed here',
    }), 'utf8');
    fs.writeFileSync(path.join(sceneDirectory, 'Scene_Future.json'), JSON.stringify({
      version: '2.0.0', runtimeVersion: '>=2.0.0', meta: { sceneName: 'Scene_Future' },
    }), 'utf8');
    fs.writeFileSync(path.join(sceneDirectory, 'Scene_Old.json'), JSON.stringify({
      version: '0.9.0', runtimeVersion: '>=0.9.0', meta: { sceneName: 'Scene_Old' },
    }), 'utf8');
    fs.writeFileSync(path.join(sceneDirectory, 'Scene_Broken.json'), '{not-json', 'utf8');
    fs.writeFileSync(path.join(sceneDirectory, 'notes.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');

    const catalog = inspectUiDesignerResources(project);
    const entries = catalog.resources.filter((entry) => entry.category === 'sceneData');
    assert.deepEqual(entries.map((entry) => entry.relativePath), [
      'js/plugins/mzui-data/notes.json',
      'js/plugins/mzui-data/Scene_Broken.json',
      'js/plugins/mzui-data/Scene_Future.json',
      'js/plugins/mzui-data/Scene_Old.json',
      'js/plugins/mzui-data/Scene_Sample.json',
    ]);
    const compatible = entries.find((entry) => entry.name === 'Scene_Sample.json');
    assert.equal(compatible?.compatibility, 'compatible');
    assert.equal(compatible?.sceneName, 'Scene_Sample');
    assert.equal(compatible?.version, '1.0.0');
    assert.equal(compatible?.runtimeVersion, '>=1.0.0');
    assert.ok(Number.isFinite(compatible?.mtimeMs));
    assert.ok(!(compatible?.relativePath || '').startsWith('www/'));
    assert.match(compatible?.previewUrl || '', /^rmmv-asset:\/\/project\//);
    assert.equal(entries.find((entry) => entry.name === 'Scene_Future.json')?.compatibility, 'unsupported-version');
    assert.equal(entries.find((entry) => entry.name === 'Scene_Old.json')?.compatibility, 'outdated');
    assert.equal(entries.find((entry) => entry.name === 'Scene_Broken.json')?.compatibility, 'invalid');
    assert.equal(entries.find((entry) => entry.name === 'notes.json')?.compatibility, 'invalid');
    assert.equal(entries.find((entry) => entry.name === 'Scene_Sample.json')?.size, fs.statSync(path.join(sceneDirectory, 'Scene_Sample.json')).size);
  });

  test('selects a project image folder for frame import without exposing absolute paths', () => {
    const project = path.join(tempRoot, 'frame-folder-project');
    const folder = path.join(project, 'www', 'img', 'animations', 'sample');
    fs.mkdirSync(path.join(project, 'www', 'data'), { recursive: true });
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(project, 'www', 'data', 'System.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'www', 'data', 'MapInfos.json'), '[null]', 'utf8');
    fs.writeFileSync(path.join(folder, '002.png'), Buffer.from('two'));
    fs.writeFileSync(path.join(folder, '001.png'), Buffer.from('one'));
    fs.writeFileSync(path.join(folder, 'ignore.txt'), 'ignore', 'utf8');

    const entries = selectUiDesignerFrameFolder(project, folder);
    assert.deepEqual(entries.map((entry) => entry.relativePath), [
      'img/animations/sample/001.png',
      'img/animations/sample/002.png',
    ]);
    assert.ok(entries.every((entry) => entry.category === 'image' && entry.exists && entry.referenced === false));
    assert.ok(entries.every((entry) => !path.isAbsolute(entry.path)));
    assert.ok(entries.every((entry) => !(entry.relativePath || '').startsWith('www/')));
    assert.ok(entries.every((entry) => /^rmmv-asset:\/\/project\//.test(entry.previewUrl || '')));

    assert.throws(
      () => selectUiDesignerFrameFolder(project, path.join(tempRoot, 'outside')),
      (error: unknown) => error instanceof UiDesignerFrameFolderSelectionError && error.code === 'UI_DESIGNER_FRAME_FOLDER_INVALID',
    );
  });

  test('reads only catalog-listed compatible scene data with metadata and project compatibility', () => {
    const project = path.join(tempRoot, 'scene-read-project');
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    const sceneDirectory = path.join(project, 'js', 'plugins', 'mzui-data');
    fs.mkdirSync(sceneDirectory, { recursive: true });
    fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
    const scene = {
      version: '1.0.0', runtimeVersion: '>=1.0.0',
      meta: { sceneName: 'Scene_Readable', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
      transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
      globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
    };
    const scenePath = path.join(sceneDirectory, 'Scene_Readable.json');
    fs.writeFileSync(scenePath, JSON.stringify(scene), 'utf8');
    const result = readUiDesignerSceneData(project, 'js/plugins/mzui-data/Scene_Readable.json');
    assert.equal(result.scene.meta.sceneName, 'Scene_Readable');
    assert.equal(result.scene.version, '1.1.0');
    assert.equal(result.scene.runtimeVersion, '>=1.1.0');
    assert.equal(result.scene.sceneScript.version, '1.1.0');
    assert.equal('code' in result.scene, false);
    assert.equal(result.metadata.relativePath, 'js/plugins/mzui-data/Scene_Readable.json');
    assert.equal(result.metadata.version, '1.1.0');
    assert.equal(result.metadata.runtimeVersion, '>=1.1.0');
    assert.equal(result.metadata.compatibility, 'compatible');
    assert.equal(result.metadata.digest.length, 64);
    assert.equal(result.projectCompatibility.engine, 'MV');

    assert.throws(
      () => readUiDesignerSceneData(project, path.join(sceneDirectory, 'Scene_Readable.json')),
      (error: unknown) => error instanceof UiDesignerSceneDataReadError && error.code === 'UI_DESIGNER_SCENE_DATA_PATH_INVALID',
    );
    fs.writeFileSync(path.join(sceneDirectory, 'Scene_Future.json'), JSON.stringify({ ...scene, meta: { ...scene.meta, sceneName: 'Scene_Future' }, version: '2.0.0' }), 'utf8');
    assert.throws(
      () => readUiDesignerSceneData(project, 'js/plugins/mzui-data/Scene_Future.json'),
      (error: unknown) => error instanceof UiDesignerSceneDataReadError && error.code === 'UI_DESIGNER_SCENE_DATA_UNSUPPORTED',
    );
  });

  test('uses the MZ root resource layout', () => {
    const project = path.join(tempRoot, 'mz-project');
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'img', 'pictures'), { recursive: true });
    fs.mkdirSync(path.join(project, 'js'), { recursive: true });
    fs.mkdirSync(path.join(project, 'js', 'plugins', 'mzui-data'), { recursive: true });
    fs.writeFileSync(path.join(project, 'game.rmmzproject'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html>', 'utf8');
    fs.writeFileSync(path.join(project, 'package.json'), '{}', 'utf8');
    for (const fileName of ['rmmz_core.js', 'rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js', 'main.js', 'plugins.js']) {
      fs.writeFileSync(path.join(project, 'js', fileName), fileName === 'rmmz_core.js' ? 'Utils.RPGMAKER_NAME = "MZ"; Utils.RPGMAKER_VERSION = "1.10.0";' : '', 'utf8');
    }
    fs.writeFileSync(path.join(project, 'data', 'System.json'), JSON.stringify({
      gameTitle: 'Sample', versionId: 1, tileSize: 48, faceSize: 144, iconSize: 32,
      advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
    }), 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
    fs.writeFileSync(path.join(project, 'img', 'pictures', 'sample.png'), Buffer.from('png'));
    fs.writeFileSync(path.join(project, 'js', 'plugins', 'mzui-data', 'Scene_Mz.json'), JSON.stringify({
      version: '1.0.0', runtimeVersion: '>=1.0.0', meta: { sceneName: 'Scene_Mz' },
    }), 'utf8');

    const catalog = inspectUiDesignerResources(project);
    assert.equal(catalog.engine, 'MZ');
    assert.equal(catalog.projectCompatibility?.engine, 'MZ');
    assert.equal(catalog.projectCompatibility?.engineVersion, '1.10.0');
    assert.equal(catalog.projectCompatibility?.engineVersionSupported, true);
    const image = catalog.resources.find((entry) => entry.name === 'sample.png');
    assert.equal(image?.relativePath, 'img/pictures/sample.png');
    assert.ok(!(image?.previewUrl || '').includes('/www/'));
    const sceneData = catalog.resources.find((entry) => entry.category === 'sceneData');
    assert.equal(sceneData?.relativePath, 'js/plugins/mzui-data/Scene_Mz.json');
    assert.equal(sceneData?.compatibility, 'compatible');
    assert.equal(sceneData?.sceneName, 'Scene_Mz');
  });

  test('surfaces the shared MZ compatibility warning without blocking catalog inspection', () => {
    const project = path.join(tempRoot, 'mz-old-project');
    fs.mkdirSync(path.join(project, 'data'), { recursive: true });
    fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(project, 'game.rmmzproject'), '{}', 'utf8');
    fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html>', 'utf8');
    fs.writeFileSync(path.join(project, 'package.json'), '{}', 'utf8');
    for (const fileName of ['rmmz_core.js', 'rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js', 'main.js', 'plugins.js']) {
      fs.writeFileSync(path.join(project, 'js', fileName), fileName === 'rmmz_core.js' ? 'Utils.RPGMAKER_NAME = "MZ"; Utils.RPGMAKER_VERSION = "1.9.0";' : '', 'utf8');
    }
    fs.writeFileSync(path.join(project, 'data', 'System.json'), JSON.stringify({
      gameTitle: 'Sample', versionId: 1, tileSize: 48, faceSize: 144, iconSize: 32,
      advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
    }), 'utf8');
    fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');

    const catalog = inspectUiDesignerResources(project);
    assert.equal(catalog.projectCompatibility?.engine, 'MZ');
    assert.equal(catalog.projectCompatibility?.engineVersion, '1.9.0');
    assert.equal(catalog.projectCompatibility?.engineVersionSupported, true);
    assert.match(catalog.projectCompatibility?.warnings.join(' ') || '', /outside the validated/i);
  });

  test('resolves the engine-native main font profile from data/System.json', () => {
    const mvProject = (name: string, locale: string | null) => {
      const project = path.join(tempRoot, name);
      fs.mkdirSync(path.join(project, 'data'), { recursive: true });
      fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
      fs.writeFileSync(path.join(project, 'data', 'System.json'), JSON.stringify(locale === null ? {} : { locale }), 'utf8');
      fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
      return project;
    };

    const zh = inspectUiDesignerResources(mvProject('mv-zh', 'zh-CN'));
    assert.equal(zh.engine, 'MV');
    assert.equal(zh.mainFontFace, 'SimHei, Heiti TC, sans-serif');
    assert.equal(zh.mainFontSize, 28);

    const ko = inspectUiDesignerResources(mvProject('mv-ko', 'ko-KR'));
    assert.equal(ko.mainFontFace, 'Dotum, AppleGothic, sans-serif');

    const fallback = inspectUiDesignerResources(mvProject('mv-default', 'ja-JP'));
    assert.equal(fallback.mainFontFace, 'GameFont');
    assert.equal(fallback.mainFontSize, 28);

    const broken = path.join(tempRoot, 'mv-broken');
    fs.mkdirSync(path.join(broken, 'data'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'Game.rpgproject'), 'RPGMV', 'utf8');
    fs.writeFileSync(path.join(broken, 'data', 'System.json'), '{not-json', 'utf8');
    fs.writeFileSync(path.join(broken, 'data', 'MapInfos.json'), '[null]', 'utf8');
    const brokenCatalog = inspectUiDesignerResources(broken);
    assert.equal(brokenCatalog.mainFontFace, undefined);
    assert.equal(brokenCatalog.mainFontSize, undefined);

    const mz = path.join(tempRoot, 'mz-font');
    fs.mkdirSync(path.join(mz, 'data'), { recursive: true });
    fs.mkdirSync(path.join(mz, 'js', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(mz, 'game.rmmzproject'), '{}', 'utf8');
    fs.writeFileSync(path.join(mz, 'index.html'), '<!doctype html>', 'utf8');
    fs.writeFileSync(path.join(mz, 'package.json'), '{}', 'utf8');
    for (const fileName of ['rmmz_core.js', 'rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js', 'main.js', 'plugins.js']) {
      fs.writeFileSync(path.join(mz, 'js', fileName), fileName === 'rmmz_core.js' ? 'Utils.RPGMAKER_NAME = "MZ"; Utils.RPGMAKER_VERSION = "1.9.0";' : '', 'utf8');
    }
    fs.writeFileSync(path.join(mz, 'data', 'System.json'), JSON.stringify({
      gameTitle: 'Sample', versionId: 1, tileSize: 48, faceSize: 144, iconSize: 32,
      advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624, fontFace: 'CustomFace, serif', fontSize: 31 },
    }), 'utf8');
    fs.writeFileSync(path.join(mz, 'data', 'MapInfos.json'), '[null]', 'utf8');
    const mzCatalog = inspectUiDesignerResources(mz);
    assert.equal(mzCatalog.engine, 'MZ');
    assert.equal(mzCatalog.mainFontFace, 'CustomFace, serif');
    assert.equal(mzCatalog.mainFontSize, 31);
  });
});
