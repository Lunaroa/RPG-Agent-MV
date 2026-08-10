import fs from 'node:fs';
import path from 'node:path';

import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import type { RpgMakerEngine } from '../rmmv/rpg-maker-engine.ts';
import {
  snapshotProjectStaging,
  type IsolatedStagingSnapshot,
} from './isolated-project-preparation.ts';
import { writeMapPreviewIframeAppShell } from './map-preview-iframe-harness.ts';
import { getProjectFileForRead } from './staging-service.ts';
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

/** Denied on top of staged deletions so the live project's private state never leaves disk. */
export const MAP_PREVIEW_DENIED_PREFIXES = ['save/', '.git/'] as const;

export interface MapPreviewAppPreparation {
  engine: RpgMakerEngine;
  sourceProject: string;
  /** Serve-direct root: everything not generated or staged is read from here. */
  resourceRoot: string;
  /** Generated preview app (harness shell + staged overlays); primary protocol root. */
  appDirectory: string;
  ownership: IsolatedProjectOwnership;
  screenWidth: number;
  screenHeight: number;
  tileSize: number;
  staging: IsolatedStagingSnapshot;
  /** Resource-root-relative staged deletions the protocol must 404. */
  deniedPaths: string[];
}

export interface MapPreviewAppPreparationDependencies {
  getEffectiveFile: typeof getProjectFileForRead;
}

/**
 * Serve-direct map preview preparation: builds only the tiny generated app
 * (injected index.html, marker, optionally injected js/main.js) plus staged
 * draft overlays, and serves every other project resource through the preview
 * protocol's pass-through root. No project copy and no project fingerprint, so
 * starting a preview stays cheap on multi-gigabyte projects.
 */
export function prepareMapPreviewApp(
  workflowRoot: string,
  projectInput: string,
  dependencies: Partial<MapPreviewAppPreparationDependencies> = {},
): MapPreviewAppPreparation {
  const project = fs.realpathSync.native(path.resolve(projectInput));
  const manifest = inspectRmmvProject(project);
  if (!manifest.editable || !manifest.runnableStructure) {
    throw new MapPreviewAppPreparationError(`The RPG Maker project is not runnable: ${manifest.missingRequired.join(', ')}`);
  }
  const getEffectiveFile = dependencies.getEffectiveFile || getProjectFileForRead;
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
    const staging = snapshotProjectStaging(workflowRoot, project);
    const deniedPaths: string[] = [];
    for (const entry of staging.files) {
      assertAppOwnership();
      const rootRelative = resourceRootRelative(project, resourceRoot, entry.relativePath);
      if (!rootRelative) continue;
      if (entry.delete) {
        deniedPaths.push(rootRelative);
        continue;
      }
      const draft = getEffectiveFile(workflowRoot, project, entry.relativePath);
      if (!draft || !isFile(draft)) throw new MapPreviewAppPreparationError(`Staged draft is missing: ${entry.relativePath}`);
      const target = confinedAppPath(appDirectory, rootRelative);
      ownedWrite(() => fs.mkdirSync(path.dirname(target), { recursive: true }));
      ownedWrite(() => fs.copyFileSync(draft, target));
    }

    // The app shell rewrites index.html (and js/main.js for dynamic-plugin
    // engines) from their effective contents, so staged drafts stay honored.
    ownedWrite(() => writeMapPreviewIframeAppShell(
      appDirectory,
      readEffectiveText(workflowRoot, project, resourceRoot, getEffectiveFile, 'index.html'),
      readEffectiveText(workflowRoot, project, resourceRoot, getEffectiveFile, 'js/main.js'),
    ));
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
      staging,
      deniedPaths,
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

function readEffectiveText(
  workflowRoot: string,
  project: string,
  resourceRoot: string,
  getEffectiveFile: typeof getProjectFileForRead,
  rootRelative: string,
): string {
  const projectRelative = normalizeRelative(path.relative(project, path.join(resourceRoot, ...rootRelative.split('/'))));
  const file = getEffectiveFile(workflowRoot, project, projectRelative)
    || path.join(resourceRoot, ...rootRelative.split('/'));
  if (!isFile(file)) throw new MapPreviewAppPreparationError(`Required project file is missing: ${rootRelative}`);
  return fs.readFileSync(file, 'utf8');
}

/** Project-relative staged path -> resource-root-relative path, or null when outside the root. */
function resourceRootRelative(project: string, resourceRoot: string, projectRelative: string): string | null {
  const absolute = path.resolve(project, ...normalizeRelative(projectRelative).split('/'));
  const relative = normalizeRelative(path.relative(resourceRoot, absolute));
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return null;
  return relative;
}

function confinedAppPath(appDirectory: string, relative: string): string {
  const base = path.resolve(appDirectory);
  const target = path.resolve(base, ...relative.split('/'));
  const relation = path.relative(base, target);
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new MapPreviewAppPreparationError(`Unsafe preview overlay path: ${relative}`);
  }
  return target;
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}
