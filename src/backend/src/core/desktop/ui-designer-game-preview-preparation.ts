import fs from 'node:fs';
import path from 'node:path';

import type { UiRuntimeSceneExport } from '../../../../contract/ui-designer.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import {
  cleanupIsolatedProject,
  prepareIsolatedStagedProject,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts';
import {
  attestOwnedIsolatedProject,
  type IsolatedProjectOwnershipChallenge,
} from './isolated-project-attestation.ts';
import { RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS } from './rpg-maker-mz-runtime.ts';
import {
  bundledUiDesignerRuntime,
  UI_DESIGNER_RUNTIME_PLUGIN_NAME,
  UI_DESIGNER_RUNTIME_RELATIVE_PATH,
  UI_DESIGNER_SCENE_DIRECTORY,
  writeUiDesignerRuntimeExport,
} from './ui-designer-runtime-service.ts';
import { readProjectUiDesignerGlobalData } from './ui-designer-service.ts';

export const UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME = 'RpgAgentUiDesignerPreview';

export interface UiDesignerGamePreviewPreparation extends IsolatedProjectPreparation {
  engine: RpgMakerEngine;
  sceneName: string;
  executable?: string;
}

export interface UiDesignerGamePreviewPreparationDependencies {
  temporaryProjectPath?: string;
  ownershipChallenge?: IsolatedProjectOwnershipChallenge;
}

export function prepareUiDesignerGamePreviewProject(
  workflowRoot: string,
  project: string,
  scene: UiRuntimeSceneExport,
  dependencies: UiDesignerGamePreviewPreparationDependencies = {},
): UiDesignerGamePreviewPreparation {
  const sourceLayout = inspectRmmvProject(project);
  const isolated = prepareIsolatedStagedProject(workflowRoot, project, {
    temporaryPrefix: 'rmmv-agent-ui-preview-',
    ...(dependencies.temporaryProjectPath ? { temporaryProjectPath: dependencies.temporaryProjectPath } : {}),
    ...(dependencies.ownershipChallenge ? { ownershipChallenge: dependencies.ownershipChallenge } : {}),
    ...(sourceLayout.engine === 'rpg-maker-mz'
      ? { excludeRelativePaths: RPG_MAKER_MZ_PROJECT_RUNTIME_COPY_EXCLUSIONS }
      : {}),
  });
  try {
    const assertOwnership = () => attestOwnedIsolatedProject(
      isolated.sourceProject,
      isolated.temporaryProject,
      isolated.ownership,
    );
    const layout = inspectRmmvProject(isolated.temporaryProject);
    const sceneName = String(scene?.meta?.sceneName || '');
    if (!/^Scene_[A-Za-z0-9_$]+$/.test(sceneName)) {
      throw new UiDesignerGamePreviewPreparationError('UI designer preview scene name is invalid.');
    }

    const pluginsDirectory = path.join(layout.resourceRoot, 'js', 'plugins');
    const pluginsPath = path.join(layout.resourceRoot, 'js', 'plugins.js');
    const runtimePath = path.join(layout.resourceRoot, ...UI_DESIGNER_RUNTIME_RELATIVE_PATH.split('/'));
    const scenePath = path.join(layout.resourceRoot, ...UI_DESIGNER_SCENE_DIRECTORY.split('/'), `${sceneName}.json`);
    const launcherPath = path.join(pluginsDirectory, `${UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME}.js`);
    const entries = readPluginEntries(pluginsPath)
      .filter((entry) => entry.name !== UI_DESIGNER_RUNTIME_PLUGIN_NAME && entry.name !== UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME);
    entries.push({
      name: UI_DESIGNER_RUNTIME_PLUGIN_NAME,
      status: true,
      description: 'MZ UI designer runtime',
      parameters: { AutoRegister: 'false' },
    });
    entries.push({
      name: UI_DESIGNER_GAME_PREVIEW_PLUGIN_NAME,
      status: true,
      description: 'UI designer isolated game preview launcher',
      parameters: {},
    });

    assertOwnership();
    fs.mkdirSync(pluginsDirectory, { recursive: true });
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    fs.writeFileSync(runtimePath, bundledUiDesignerRuntime().source, { encoding: 'utf8' });
    writeUiDesignerRuntimeExport(scenePath, scene, { overwrite: true });
    const canonicalScene = JSON.parse(fs.readFileSync(scenePath, 'utf8')) as UiRuntimeSceneExport;
    // Preview reads $global from the designer's saved global data even before
    // it is published as data/GlobalUI.json in the source project. Embed it in
    // the launcher instead of writing a file: packaged game runtimes may lack
    // Node integration, so the runtime's fs-based load would silently fail.
    const globalData = readProjectUiDesignerGlobalData(project);
    fs.writeFileSync(launcherPath, previewLauncherSource(canonicalScene, globalData.metadata ? globalData.data : null), { encoding: 'utf8' });
    fs.writeFileSync(pluginsPath, serializePluginEntries(entries), { encoding: 'utf8' });
    assertOwnership();

    const stable = verifyIsolatedSourceState(workflowRoot, isolated);
    if (!stable.sourceUnchanged) throw new UiDesignerGamePreviewPreparationError('Source project content changed while preparing UI preview.');
    if (!stable.savesUnchanged) throw new UiDesignerGamePreviewPreparationError('Source project save content changed while preparing UI preview.');
    if (!stable.stagingUnchanged) throw new UiDesignerGamePreviewPreparationError(`Staged project content changed while preparing UI preview.${stable.stagingError ? ` ${stable.stagingError}` : ''}`);

    const executable = layout.engine === 'rpg-maker-mv' ? path.join(isolated.temporaryProject, 'Game.exe') : undefined;
    if (layout.engine === 'rpg-maker-mv' && (!executable || !isFile(executable))) {
      throw new UiDesignerGamePreviewPreparationError('Game.exe was not found in the isolated RPG Maker MV project.');
    }
    return { ...isolated, engine: layout.engine, sceneName, ...(executable ? { executable } : {}) };
  } catch (error) {
    try { cleanupIsolatedProject(isolated); } catch { /* Report preparation failure first. */ }
    throw error;
  }
}

export class UiDesignerGamePreviewPreparationError extends Error {}

interface PluginEntry {
  name: string;
  status: boolean;
  description: string;
  parameters: Record<string, unknown>;
}

function readPluginEntries(filePath: string): PluginEntry[] {
  if (!isFile(filePath)) throw new UiDesignerGamePreviewPreparationError('plugins.js was not found in the isolated project.');
  const source = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw new UiDesignerGamePreviewPreparationError('The isolated plugins.js does not contain a plugin array.');
  let parsed: unknown;
  try { parsed = JSON.parse(source.slice(start, end + 1)); }
  catch (error) { throw new UiDesignerGamePreviewPreparationError(`The isolated plugins.js is invalid: ${errorMessage(error)}`); }
  if (!Array.isArray(parsed)) throw new UiDesignerGamePreviewPreparationError('The isolated plugins.js plugin value must be an array.');
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UiDesignerGamePreviewPreparationError(`Plugin entry ${index + 1} is invalid.`);
    const entry = value as Record<string, unknown>;
    return {
      name: String(entry.name || ''),
      status: Boolean(entry.status),
      description: String(entry.description || ''),
      parameters: entry.parameters && typeof entry.parameters === 'object' && !Array.isArray(entry.parameters)
        ? entry.parameters as Record<string, unknown>
        : {},
    };
  });
}

function serializePluginEntries(entries: readonly PluginEntry[]): string {
  return `var $plugins =\n${JSON.stringify(entries, null, 2)};\n`;
}

function previewLauncherSource(scene: UiRuntimeSceneExport, globalData: unknown): string {
  const encodedScene = encodeInlineJson(scene);
  const encodedGlobalData = globalData === null || globalData === undefined ? 'null' : encodeInlineJson(globalData);
  return [
    '/* Generated only inside an isolated UI designer preview project. */',
    '(function () {',
    "  'use strict';",
    `  var scene = ${encodedScene};`,
    `  var globalData = ${encodedGlobalData};`,
    '  var sceneName = scene.meta.sceneName;',
    '  var start = Scene_Boot.prototype.start;',
    '  Scene_Boot.prototype.start = function () {',
    '    var runtime = window.MZUIRuntime;',
    "    if (!runtime || typeof runtime.registerScene !== 'function') throw new Error('UI preview runtime was not registered.');",
    '    // Install before boot continues so DataManager.createGameObjects and the',
    '    // mounted scene both see the embedded data; the runtime was bundled by',
    '    // this same preparation, so installGlobalData is guaranteed to exist.',
    '    if (globalData !== null) runtime.installGlobalData(globalData);',
    '    // Always register through the runtime so a scene named after a built-in',
    '    // (Scene_Menu, Scene_Title, ...) replaces the native class instead of',
    '    // booting straight into it.',
    "    var SceneClass = typeof runtime.isRegistered === 'function' && runtime.isRegistered(sceneName)",
    '      ? window[sceneName]',
    '      : runtime.registerScene(sceneName, scene.meta.sceneBase, scene);',
    '    start.apply(this, arguments);',
    '    SceneManager.goto(SceneClass);',
    '  };',
    '})();',
    '',
  ].join('\n');
}

function encodeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
