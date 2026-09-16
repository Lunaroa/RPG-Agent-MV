import fs from 'node:fs';
import path from 'node:path';

import type { UiRuntimeSceneExport } from '../../../../contract/ui-designer.ts';
import { normalizeUiRuntimeSceneGeometry } from '../../../../contract/ui-designer-geometry.ts';
import { canonicalUiRuntimeSceneExport } from '../../../../contract/ui-designer-script.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import { writeMapPreviewIframeAppShell } from './map-preview-iframe-harness.ts';
import { validateUiRuntimeSceneExport } from './ui-designer-validation.ts';
import {
  attestOwnedIsolatedProject,
  cleanupOwnedIsolatedProject,
  createOwnedEmptyIsolatedProject,
  type IsolatedProjectOwnership,
} from './isolated-project-attestation.ts';

export class MapPreviewAppPreparationError extends Error {}

/**
 * Every resource the map runtime asks for is served straight from the project
 * resource root; the previous isolated copy exposed the full project tree as
 * well, so the pass-through covers everything (save/.git are denied separately).
 */
export const MAP_PREVIEW_PASSTHROUGH_PREFIXES = [''] as const;

/** Private project state that the preview protocol must never expose. */
export const MAP_PREVIEW_DENIED_PREFIXES = ['save/', '.git/'] as const;

export interface MapPreviewAppPreparation {
  engine: RpgMakerEngine;
  sourceProject: string;
  /** Serve-direct root: every project resource is read from here. */
  resourceRoot: string;
  /** Generated preview app and harness shell; primary protocol root. */
  appDirectory: string;
  ownership: IsolatedProjectOwnership;
  screenWidth: number;
  screenHeight: number;
  tileSize: number;
  uiRuntime: MapPreviewUiRuntimePayload;
  deniedPaths: string[];
}

export interface MapPreviewUiRuntimePayload {
  scenes: UiRuntimeSceneExport[];
  globalData: unknown;
}

/**
 * Serve-direct map preview preparation: builds only the tiny generated app
 * (injected index.html, marker, optionally injected js/main.js) and serves
 * project resources through the preview protocol's pass-through root. No
 * project copy and no project fingerprint, so starting a preview stays cheap
 * on multi-gigabyte projects.
 */
export function prepareMapPreviewApp(
  _workflowRoot: string,
  projectInput: string,
): MapPreviewAppPreparation {
  const project = fs.realpathSync.native(path.resolve(projectInput));
  const manifest = inspectRmmvProject(project);
  if (!manifest.editable || !manifest.runnableStructure) {
    throw new MapPreviewAppPreparationError(`The RPG Maker project is not runnable: ${manifest.missingRequired.join(', ')}`);
  }
  const resourceRoot = fs.realpathSync.native(path.resolve(manifest.resourceRoot));
  const ownershipChallenge = createOwnedEmptyIsolatedProject(project, {
    temporaryPrefix: 'rpg-agent-map-preview-app-',
  });
  const appDirectory = ownershipChallenge.temporaryProject;
  const assertAppOwnership = () => attestOwnedIsolatedProject(
    ownershipChallenge.sourceProject,
    appDirectory,
    ownershipChallenge.ownership,
  );
  const ownedWrite = (write: () => void): void => {
    assertAppOwnership();
    write();
    assertAppOwnership();
  };

  try {
    // The app shell rewrites index.html and js/main.js only inside the owned
    // preview directory.
    ownedWrite(() => writeMapPreviewIframeAppShell(
      appDirectory,
      readProjectText(resourceRoot, 'index.html'),
      readProjectText(resourceRoot, 'js/main.js'),
    ));
    const uiRuntime = buildMapPreviewUiRuntimePayload(resourceRoot);
    // Warm map syncs target the app data directory; keep it resolvable even
    // before the first synced map lands.
    ownedWrite(() => fs.mkdirSync(path.join(appDirectory, 'data'), { recursive: true }));
    assertAppOwnership();

    return {
      engine: manifest.engine,
      sourceProject: project,
      resourceRoot,
      appDirectory,
      ownership: { ...ownershipChallenge.ownership },
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      tileSize: manifest.tileSize,
      uiRuntime,
      deniedPaths: [],
    };
  } catch (error) {
    try { cleanupOwnedIsolatedProject(ownershipChallenge); } catch { /* Retain an unattested app. */ }
    throw error;
  }
}

export function cleanupMapPreviewApp(preparation: MapPreviewAppPreparation): void {
  cleanupOwnedIsolatedProject({
    sourceProject: preparation.sourceProject,
    temporaryProject: preparation.appDirectory,
    ownership: preparation.ownership,
  });
}

function buildMapPreviewUiRuntimePayload(resourceRoot: string): MapPreviewUiRuntimePayload {
  const sceneDirectoryRelative = 'data/ui-scenes';
  const mapSceneFileName = mapUiSceneFileName(resourceRoot, sceneDirectoryRelative);
  const scenes = mapSceneFileName ? [mapSceneFileName].map((fileName) => {
    const file = optionalResourceFile(resourceRoot, `${sceneDirectoryRelative}/${fileName}`);
    if (!file) throw new MapPreviewAppPreparationError(`UI scene is missing: ${fileName}`);
    let value: unknown;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) {
      throw new MapPreviewAppPreparationError(`UI scene ${fileName} is not valid JSON: ${errorMessage(error)}`);
    }
    let scene: UiRuntimeSceneExport;
    try {
      scene = normalizeUiRuntimeSceneGeometry(canonicalUiRuntimeSceneExport(value));
    } catch (error) {
      throw new MapPreviewAppPreparationError(`UI scene ${fileName} could not be prepared: ${errorMessage(error)}`);
    }
    const validation = validateUiRuntimeSceneExport(scene);
    if (!validation.valid) {
      throw new MapPreviewAppPreparationError(
        `UI scene ${fileName} is invalid: ${validation.errors.map((issue) => issue.message).join('; ')}`,
      );
    }
    if (`${scene.meta.sceneName}.mzui` !== fileName) {
      throw new MapPreviewAppPreparationError(`UI scene ${fileName} does not match its scene name ${scene.meta.sceneName}.`);
    }
    return scene;
  }) : [];

  let globalData: unknown = {};
  if (scenes.length) {
    const globalFile = optionalResourceFile(resourceRoot, 'data/GlobalUI.json');
    if (globalFile) {
      try { globalData = JSON.parse(fs.readFileSync(globalFile, 'utf8').replace(/^\uFEFF/, '')); }
      catch (error) {
        throw new MapPreviewAppPreparationError(`Global UI data is not valid JSON: ${errorMessage(error)}`);
      }
      if ((!globalData || typeof globalData !== 'object') && !Array.isArray(globalData)) {
        throw new MapPreviewAppPreparationError('Global UI data must be a JSON object or array.');
      }
    }
  }
  return { scenes, globalData };
}

function mapUiSceneFileName(
  resourceRoot: string,
  sceneDirectoryRelative: string,
): string | null {
  const sourceDirectory = path.join(resourceRoot, ...sceneDirectoryRelative.split('/'));
  if (!fs.existsSync(sourceDirectory)) return null;
  const directoryStat = fs.lstatSync(sourceDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new MapPreviewAppPreparationError('The UI scene directory is not a safe project directory.');
  }
  const entry = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .find((candidate) => candidate.name.toLowerCase() === 'scene_map.mzui');
  if (!entry) return null;
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new MapPreviewAppPreparationError(`UI scene ${entry.name} is not a safe project file.`);
  }
  return entry.name;
}

function optionalResourceFile(
  resourceRoot: string,
  rootRelative: string,
): string | null {
  const source = path.join(resourceRoot, ...rootRelative.split('/'));
  return isFile(source) ? source : null;
}

function readProjectText(
  resourceRoot: string,
  rootRelative: string,
): string {
  const file = path.join(resourceRoot, ...rootRelative.split('/'));
  if (!isFile(file)) throw new MapPreviewAppPreparationError(`Required project file is missing: ${rootRelative}`);
  return fs.readFileSync(file, 'utf8');
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
