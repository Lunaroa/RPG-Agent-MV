import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { UiRuntimeSceneExport } from '../../../../contract/ui-designer.ts';
import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import {
  UiDesignerRuntimeModifiedError,
  UiDesignerRuntimeEnableRequiredError,
  UiDesignerRuntimeExportOverwriteRequiredError,
  UiDesignerSceneOverwriteRequiredError,
  inspectUiDesignerRuntime,
  stageUiDesignerRuntimeInstall,
  stageUiDesignerSceneExport,
  writeUiDesignerRuntimeExport,
} from './ui-designer-runtime-service.ts';
import { getProjectFileForRead } from './staging-service.ts';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-'));
  await bootstrapDatabase(tempRoot, {
    skipWorkspaceLegacyCleanup: true,
    skipRuntimeLegacyCleanup: true,
    pruneExpiredSessions: false,
  });
});

afterEach(() => {
  closeDatabase();
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('ui designer runtime staging', () => {
  test('inspects missing/configuration and stages runtime, scene, and plugin enable atomically', () => {
    const project = makeProject();
    const sourcePluginsBefore = fs.readFileSync(path.join(project, 'js', 'plugins.js'));
    assert.equal(inspectUiDesignerRuntime(tempRoot, project).state, 'missing');
    const install = stageUiDesignerRuntimeInstall(tempRoot, project, { enable: true });
    const result = stageUiDesignerSceneExport(tempRoot, project, scene());
    assert.equal(install.status, 'staged');
    assert.ok(install.transaction?.operationId);
    assert.equal(install.transaction?.sourceUnchanged, true);
    assert.equal(install.transaction?.stagingUnchanged, false);
    assert.deepEqual(fs.readFileSync(path.join(project, 'js', 'plugins.js')), sourcePluginsBefore);
    assert.equal(result.status, 'staged');
    assert.ok(result.transaction?.operationId);
    assert.equal(result.transaction?.sourceUnchanged, true);
    assert.equal(result.transaction?.stagingUnchanged, false);
    assert.ok(install.affectedFiles.some((relative) => relative.endsWith('MZUIRuntime.js')));
    assert.ok(result.sceneRelativePath?.endsWith('js/plugins/mzui-data/Scene_Sample.json'));
    assert.ok(!result.affectedFiles.some((relative) => relative.endsWith('manifest.json')));
    const stagedPluginConfig = getProjectFileForRead(tempRoot, project, 'js/plugins.js');
    assert.ok(stagedPluginConfig);
    const plugins = JSON.parse(fs.readFileSync(stagedPluginConfig!, 'utf8').slice(fs.readFileSync(stagedPluginConfig!, 'utf8').indexOf('['), fs.readFileSync(stagedPluginConfig!, 'utf8').lastIndexOf(']') + 1));
    assert.equal(plugins.find((entry: { name: string }) => entry.name === 'OtherPlugin').status, true);
    assert.equal(plugins.find((entry: { name: string }) => entry.name === 'MZUIRuntime').status, true);
    assert.equal(inspectUiDesignerRuntime(tempRoot, project).state, 'staged-pending');
  });

  test('requires explicit overwrite for an existing source or staged scene', () => {
    const project = makeProject();
    const first = stageUiDesignerSceneExport(tempRoot, project, scene());
    assert.equal(first.status, 'staged');
    assert.throws(
      () => stageUiDesignerSceneExport(tempRoot, project, scene()),
      (error: unknown) => error instanceof UiDesignerSceneOverwriteRequiredError && error.code === 'UI_DESIGNER_OVERWRITE_REQUIRED' && error.affectedFiles.length === 1,
    );
    assert.equal(stageUiDesignerSceneExport(tempRoot, project, scene(), { overwrite: true }).status, 'staged');
  });

  test('requires explicit force before replacing a modified runtime', () => {
    const project = makeProject();
    fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js'), 'var VERSION = "1.0.0"; // user edit', 'utf8');
    fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [{"name":"MZUIRuntime","status":true,"description":"","parameters":{}}];', 'utf8');
    assert.equal(inspectUiDesignerRuntime(tempRoot, project).state, 'content-mismatch');
    assert.throws(() => stageUiDesignerRuntimeInstall(tempRoot, project), (error: unknown) => error instanceof UiDesignerRuntimeEnableRequiredError);
    assert.throws(() => stageUiDesignerRuntimeInstall(tempRoot, project, { enable: true }), (error: unknown) => error instanceof UiDesignerRuntimeModifiedError);
    assert.equal(stageUiDesignerRuntimeInstall(tempRoot, project, { enable: true, forceModifiedRuntime: true }).status, 'staged');
  });

  test('does not hide a user edit in a staged runtime behind pending status', () => {
    const project = makeProject();
    stageUiDesignerRuntimeInstall(tempRoot, project, { enable: true });
    const stagedRuntime = getProjectFileForRead(tempRoot, project, 'js/plugins/MZUIRuntime.js');
    assert.ok(stagedRuntime);
    fs.writeFileSync(stagedRuntime!, 'var VERSION = "1.0.0"; // staged user edit', 'utf8');
    const inspected = inspectUiDesignerRuntime(tempRoot, project);
    assert.equal(inspected.state, 'content-mismatch');
    assert.equal(inspected.staging.pending, true);
    assert.equal(inspected.needsConfirmation, true);
    assert.throws(() => stageUiDesignerRuntimeInstall(tempRoot, project), (error: unknown) => error instanceof UiDesignerRuntimeEnableRequiredError);
    assert.throws(() => stageUiDesignerRuntimeInstall(tempRoot, project, { enable: true }), (error: unknown) => error instanceof UiDesignerRuntimeModifiedError);
  });

  test('exports validated runtime JSON independently with explicit overwrite', () => {
    const exportPath = path.join(tempRoot, 'exports', 'Scene_Sample.json');
    const first = writeUiDesignerRuntimeExport(exportPath, scene());
    assert.equal(first.path, path.resolve(exportPath));
    assert.equal(JSON.parse(fs.readFileSync(exportPath, 'utf8')).meta.sceneName, 'Scene_Sample');
    assert.throws(
      () => writeUiDesignerRuntimeExport(exportPath, scene()),
      (error: unknown) => error instanceof UiDesignerRuntimeExportOverwriteRequiredError
        && error.code === 'UI_DESIGNER_OVERWRITE_REQUIRED'
        && error.affectedFiles[0] === 'Scene_Sample.json',
    );
    const overwritten = writeUiDesignerRuntimeExport(exportPath, { ...scene(), code: { ready: '/* changed */', update: '' } }, { overwrite: true });
    assert.notEqual(overwritten.digest, first.digest);
    assert.match(fs.readFileSync(exportPath, 'utf8'), /changed/);
    // Simulate the crash window after the target was moved to a backup.  The
    // next access must recover the old target before applying the overwrite.
    const backupPath = `${exportPath}.backup-${process.pid}-recovery`;
    fs.copyFileSync(exportPath, backupPath);
    fs.rmSync(exportPath);
    const recovered = writeUiDesignerRuntimeExport(exportPath, scene(), { overwrite: true });
    assert.equal(recovered.path, path.resolve(exportPath));
    assert.ok(fs.existsSync(exportPath));
  });
});

function makeProject(): string {
  const project = path.join(tempRoot, 'project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  fs.mkdirSync(path.join(project, 'js'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [{"name":"OtherPlugin","status":true,"description":"keep","parameters":{"x":"1"}}];', 'utf8');
  return project;
}

function scene(): UiRuntimeSceneExport {
  return {
    version: '1.0.0',
    runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_Sample', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 300 }, exit: { type: 'fade', duration: 300 } },
    globalFilter: { blur: 0, glow: 0, preset: '' },
    nodes: [],
    zOrder: [],
    code: { ready: '', update: '' },
  };
}
