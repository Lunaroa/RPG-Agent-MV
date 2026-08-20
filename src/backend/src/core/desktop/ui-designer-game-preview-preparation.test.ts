import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import vm from 'node:vm';

import type { UiRuntimeSceneExport } from '../../../../contract/ui-designer.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { cleanupIsolatedProject } from './isolated-project-preparation.ts';
import {
  prepareUiDesignerGamePreviewProject,
  UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME,
} from './ui-designer-game-preview-preparation.ts';

let root = '';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-game-preview-'));
  await bootstrapDatabase(root, {
    skipWorkspaceLegacyCleanup: true,
    skipRuntimeLegacyCleanup: true,
    pruneExpiredSessions: false,
  });
});

afterEach(() => {
  closeDatabase();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});

test('prepares an isolated game project that boots the current in-memory UI scene', () => {
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  fs.mkdirSync(path.join(project, 'js'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.exe'), 'runner', 'utf8');
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [{"name":"ExistingPlugin","status":true,"description":"keep","parameters":{}}];', 'utf8');
  const sourcePlugins = fs.readFileSync(path.join(project, 'js', 'plugins.js'), 'utf8');

  const preparation = prepareUiDesignerGamePreviewProject(root, project, scene());
  try {
    const isolated = preparation.temporaryProject;
    const previewScene = JSON.parse(fs.readFileSync(path.join(isolated, 'js', 'plugins', 'mzui-data', 'Scene_Sample.json'), 'utf8'));
    const launcher = fs.readFileSync(path.join(isolated, 'js', 'plugins', `${UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME}.js`), 'utf8');
    const pluginsSource = fs.readFileSync(path.join(isolated, 'js', 'plugins.js'), 'utf8');
    const plugins = JSON.parse(pluginsSource.slice(pluginsSource.indexOf('['), pluginsSource.lastIndexOf(']') + 1));

    assert.equal(preparation.sceneName, 'Scene_Sample');
    assert.equal(previewScene.meta.description, 'current unsaved state');
    assert.match(launcher, /SceneManager\.goto\(SceneClass\)/);
    assert.ok(plugins.findIndex((entry: { name: string }) => entry.name === 'MZUIRuntime') < plugins.findIndex((entry: { name: string }) => entry.name === UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME));
    assert.equal(plugins.find((entry: { name: string }) => entry.name === 'MZUIRuntime').parameters.AutoRegister, 'false');
    assert.equal(plugins.find((entry: { name: string }) => entry.name === 'ExistingPlugin').status, true);
    assert.equal(fs.readFileSync(path.join(project, 'js', 'plugins.js'), 'utf8'), sourcePlugins);

    let originalStartCalls = 0;
    const registered: Array<{ sceneName: string; sceneBase: string; scene: UiRuntimeSceneExport }> = [];
    const transitions: unknown[] = [];
    class PreviewScene {}
    function SceneBoot() {}
    SceneBoot.prototype.start = () => { originalStartCalls += 1; };
    const windowObject: Record<string, unknown> = {};
    windowObject.MZUIRuntime = {
      registerScene(sceneName: string, sceneBase: string, currentScene: UiRuntimeSceneExport) {
        registered.push({ sceneName, sceneBase, scene: currentScene });
        windowObject[sceneName] = PreviewScene;
        return PreviewScene;
      },
    };
    vm.runInNewContext(launcher, {
      window: windowObject,
      Scene_Boot: SceneBoot,
      SceneManager: { goto: (target: unknown) => transitions.push(target) },
    });
    new (SceneBoot as unknown as new () => { start(): void })().start();

    assert.equal(originalStartCalls, 1);
    assert.equal(registered.length, 1);
    assert.equal(registered[0]?.sceneName, 'Scene_Sample');
    assert.equal(registered[0]?.sceneBase, 'Scene_Base');
    assert.equal(registered[0]?.scene.meta.description, 'current unsaved state');
    assert.deepEqual(transitions, [PreviewScene]);
  } finally {
    cleanupIsolatedProject(preparation);
  }
});

function scene(): UiRuntimeSceneExport {
  return {
    version: '1.1.0',
    runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Sample', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: 'current unsaved state' },
    transitions: { enter: { type: 'fade', duration: 300 }, exit: { type: 'fade', duration: 300 } },
    globalFilter: { blur: 0, glow: 0, preset: '' },
    nodes: [],
    zOrder: [],
    sceneScript: { version: '1.1.0', source: '' },
  };
}
