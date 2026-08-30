import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { RPG_MAKER_MZ_ENGINE_FILES, SUPPORTED_RPG_MAKER_MZ_VERSION } from '../rmmv/rpg-maker-engine.ts';
import {
  UI_DESIGNER_RUNTIME_VERSION,
  UiDesignerRuntimeEnableRequiredError,
  UiDesignerRuntimeModifiedError,
  inspectUiDesignerRuntime,
  installUiDesignerRuntime,
} from './ui-designer-runtime-service.ts';

let tempRoot = '';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-runtime-'));
});

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('ui designer runtime direct installation', () => {
  test('installs and enables the runtime directly while preserving other plugins', () => {
    const project = makeMvProject();
    const before = inspectUiDesignerRuntime(tempRoot, project);
    assert.equal(before.state, 'missing');
    assert.deepEqual(before.affectedFiles.sort(), ['js/plugins.js', 'js/plugins/MZUIRuntime.js'].sort());

    const result = installUiDesignerRuntime(tempRoot, project, { enable: true });

    assert.equal(result.status, 'installed');
    assert.deepEqual(result.affectedFiles.sort(), ['js/plugins.js', 'js/plugins/MZUIRuntime.js'].sort());
    assert.equal(fs.existsSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js')), true);
    const plugins = parsePlugins(path.join(project, 'js', 'plugins.js'));
    assert.equal(plugins.find((entry) => entry.name === 'OtherPlugin')?.status, true);
    assert.deepEqual(plugins.find((entry) => entry.name === 'OtherPlugin')?.parameters, { x: '1' });
    assert.equal(plugins.find((entry) => entry.name === 'MZUIRuntime')?.status, true);
    assert.equal(result.runtime.state, 'enabled-compatible');
    assert.deepEqual(result.runtime.affectedFiles, []);
  });

  test('allows a second direct installation without creating pending work', () => {
    const project = makeMvProject();
    installUiDesignerRuntime(tempRoot, project, { enable: true });
    const runtimeBefore = fs.readFileSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js'));
    const pluginsBefore = fs.readFileSync(path.join(project, 'js', 'plugins.js'));

    const second = installUiDesignerRuntime(tempRoot, project, { enable: true });

    assert.deepEqual(second.affectedFiles, []);
    assert.equal(second.runtime.state, 'enabled-compatible');
    assert.deepEqual(fs.readFileSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js')), runtimeBefore);
    assert.deepEqual(fs.readFileSync(path.join(project, 'js', 'plugins.js')), pluginsBefore);
  });

  test('requires an explicit enable request before changing project files', () => {
    const project = makeMvProject();
    const pluginsBefore = fs.readFileSync(path.join(project, 'js', 'plugins.js'));

    assert.throws(
      () => installUiDesignerRuntime(tempRoot, project),
      (error: unknown) => error instanceof UiDesignerRuntimeEnableRequiredError,
    );
    assert.equal(fs.existsSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js')), false);
    assert.deepEqual(fs.readFileSync(path.join(project, 'js', 'plugins.js')), pluginsBefore);
  });

  test('does not silently replace a same-version modified runtime', () => {
    const project = makeMvProject();
    const runtimePath = path.join(project, 'js', 'plugins', 'MZUIRuntime.js');
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, `var VERSION = "${UI_DESIGNER_RUNTIME_VERSION}"; // project edit`, 'utf8');

    assert.equal(inspectUiDesignerRuntime(tempRoot, project).state, 'file-unconfigured');
    assert.throws(
      () => installUiDesignerRuntime(tempRoot, project, { enable: true }),
      (error: unknown) => error instanceof UiDesignerRuntimeModifiedError,
    );
    const forced = installUiDesignerRuntime(tempRoot, project, { enable: true, forceModifiedRuntime: true });
    assert.equal(forced.runtime.state, 'enabled-compatible');
  });

  test('installs into the MZ project resource root', () => {
    const project = makeMzProject();
    const result = installUiDesignerRuntime(tempRoot, project, { enable: true });

    assert.equal(result.runtime.state, 'enabled-compatible');
    assert.equal(fs.existsSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js')), true);
  });
});

function makeMvProject(): string {
  const project = path.join(tempRoot, 'mv-project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  fs.mkdirSync(path.join(project, 'js'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8');
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
  fs.writeFileSync(
    path.join(project, 'js', 'plugins.js'),
    'var $plugins = [{"name":"OtherPlugin","status":true,"description":"keep","parameters":{"x":"1"}}];\n',
    'utf8',
  );
  return project;
}

function makeMzProject(): string {
  const project = path.join(tempRoot, 'mz-project');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ 1.8.1', 'utf8');
  fs.writeFileSync(
    path.join(project, 'data', 'System.json'),
    JSON.stringify({
      tileSize: 48,
      faceSize: 144,
      iconSize: 32,
      advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
    }),
    'utf8',
  );
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8');
  for (const relativePath of RPG_MAKER_MZ_ENGINE_FILES) {
    const filePath = path.join(project, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = relativePath === 'js/rmmz_core.js'
      ? `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${SUPPORTED_RPG_MAKER_MZ_VERSION}";\n`
      : '';
    fs.writeFileSync(filePath, content, 'utf8');
  }
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8');
  return project;
}

function parsePlugins(filePath: string): Array<{ name: string; status: boolean; parameters: unknown }> {
  const source = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));
}
