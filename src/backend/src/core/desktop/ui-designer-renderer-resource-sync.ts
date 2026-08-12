import fs from 'node:fs';
import path from 'node:path';

import type { ProjectAssetChangeManifest } from '../../../../contract/types.ts';
import { normalizeProjectAssetChangeManifest } from '../../../../contract/ui-designer-resources.ts';

export interface UiDesignerRendererResourceSyncTarget {
  sourceProject: string;
  temporaryProject: string;
  sessionId: string;
  generation: number;
  resourceRevision: number;
  assertOwned(): void;
}

export interface UiDesignerRendererResourceSyncReceipt {
  sessionId: string;
  generation: number;
  resourceRevision: number;
  upsertedRelativePaths: string[];
  deletedRelativePaths: string[];
}

function resolveInside(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, ...relativePath.split('/'));
  if (absolute === absoluteRoot || !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error('UI designer renderer resource path escaped its project root.');
  }
  return absolute;
}

/** Copies/deletes only inside an attested isolated project; the source project is read-only. */
export function syncUiDesignerRendererResources(
  target: UiDesignerRendererResourceSyncTarget,
  manifestInput: ProjectAssetChangeManifest,
): UiDesignerRendererResourceSyncReceipt {
  if (!Number.isSafeInteger(target.generation) || target.generation < 0) {
    throw new Error('UI designer renderer generation must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(target.resourceRevision) || target.resourceRevision < 0) {
    throw new Error('UI designer renderer resource revision must be a non-negative safe integer.');
  }
  const manifest = normalizeProjectAssetChangeManifest(manifestInput);
  target.assertOwned();

  const sources = new Map<string, string>();
  for (const relativePath of manifest.upsertRelativePaths) {
    const source = resolveInside(target.sourceProject, relativePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`UI designer renderer resource source is missing: ${relativePath}`);
    }
    sources.set(relativePath, source);
  }

  for (const relativePath of manifest.deleteRelativePaths) {
    const destination = resolveInside(target.temporaryProject, relativePath);
    fs.rmSync(destination, { force: true });
  }
  for (const relativePath of manifest.upsertRelativePaths) {
    const source = sources.get(relativePath)!;
    const destination = resolveInside(target.temporaryProject, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  target.assertOwned();
  return {
    sessionId: target.sessionId,
    generation: target.generation,
    resourceRevision: target.resourceRevision + 1,
    upsertedRelativePaths: manifest.upsertRelativePaths,
    deletedRelativePaths: manifest.deleteRelativePaths,
  };
}
