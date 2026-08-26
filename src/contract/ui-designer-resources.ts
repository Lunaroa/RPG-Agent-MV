import type { UiButtonImageStates, UiFrame } from './ui-designer.ts';
import type { ProjectAssetChangeManifest } from './types.ts';

export type UiDesignerResourceKind = 'image' | 'audio' | 'video' | 'font' | 'sceneData';
export type UiDesignerManagedAssetKind = Exclude<UiDesignerResourceKind, 'sceneData'>;

export const PROJECT_ASSET_CHANGE_MANIFEST_VERSION = '1.0.0' as const;

export const UI_BUTTON_WINDOW_SKIN_RESOURCE_PATH = 'img/system/Window.png';

const RESOURCE_PATH_KEYS = new Set([
  'path',
  'backgroundPath',
  'fontFile',
  'hoverSe',
  'clickSe',
  'trackImage',
  'fillImage',
  'posterPath',
  'imagePath',
]);
const IMAGE_STATE_KEYS = new Set<keyof UiButtonImageStates>(['normal', 'hover', 'pressed', 'disabled']);

const IMAGE_CATEGORY_IDS = new Set([
  'img',
  'animations',
  'battlebacks1',
  'battlebacks2',
  'characters',
  'enemies',
  'faces',
  'parallaxes',
  'pictures',
  'svActors',
  'svEnemies',
  'system',
  'tilesets',
  'titles1',
  'titles2',
]);
const AUDIO_CATEGORY_IDS = new Set(['bgm', 'bgs', 'me', 'se']);

export function uiDesignerResourceKindForProjectAssetCategory(
  categoryId: string,
): UiDesignerManagedAssetKind | null {
  const baseId = String(categoryId || '').replace(/\\/g, '/').split('/')[0];
  if (IMAGE_CATEGORY_IDS.has(baseId)) return 'image';
  if (AUDIO_CATEGORY_IDS.has(baseId)) return 'audio';
  if (baseId === 'movies') return 'video';
  if (baseId === 'fonts') return 'font';
  return null;
}

export function projectAssetCategoryMatchesUiDesignerResourceKind(
  categoryId: string,
  kind: UiDesignerManagedAssetKind,
): boolean {
  return uiDesignerResourceKindForProjectAssetCategory(categoryId) === kind;
}

/**
 * Normalize a persisted resource path. Empty strings are valid clears; every
 * non-empty value must remain inside the selected game project.
 */
export function normalizeUiDesignerProjectRelativeResourcePath(value: string): string {
  if (typeof value !== 'string') throw new Error('UI Designer resource path must be a string.');
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) return '';
  if (normalized.includes('\0')) throw new Error('UI Designer resource path must not contain NUL.');
  if (
    normalized.startsWith('/')
    || normalized.startsWith('//')
    || /^[A-Za-z]:\//.test(normalized)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
  ) {
    throw new Error('UI Designer resource path must be project-relative.');
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error('UI Designer resource path must not escape the project.');
  }
  return segments.filter((segment) => segment && segment !== '.').join('/');
}

function normalizeManifestPath(value: string): string {
  const normalized = normalizeUiDesignerProjectRelativeResourcePath(value);
  if (!normalized) throw new Error('Project asset change manifest paths must not be empty.');
  return normalized;
}

/** Canonicalize a renderer resource change set and make its two path sets disjoint. */
export function normalizeProjectAssetChangeManifest(
  value: ProjectAssetChangeManifest,
): ProjectAssetChangeManifest {
  if (!value || value.schemaVersion !== PROJECT_ASSET_CHANGE_MANIFEST_VERSION) {
    throw new Error('Project asset change manifest version is unsupported.');
  }
  if (!Array.isArray(value.upsertRelativePaths) || !Array.isArray(value.deleteRelativePaths)) {
    throw new Error('Project asset change manifest path sets must be arrays.');
  }
  const upserts = new Set(value.upsertRelativePaths.map(normalizeManifestPath));
  const deletes = new Set(value.deleteRelativePaths.map(normalizeManifestPath));
  for (const relativePath of upserts) deletes.delete(relativePath);
  return {
    schemaVersion: PROJECT_ASSET_CHANGE_MANIFEST_VERSION,
    upsertRelativePaths: [...upserts].sort(),
    deleteRelativePaths: [...deletes].sort(),
  };
}

/** Build the final file state from ordered project mutations; the last operation for a path wins. */
export function projectAssetChangeManifestFromMutations(
  mutations: readonly { relativePath: string; delete?: boolean }[],
): ProjectAssetChangeManifest {
  const states = new Map<string, 'upsert' | 'delete'>();
  for (const mutation of mutations) {
    states.set(normalizeManifestPath(mutation.relativePath), mutation.delete ? 'delete' : 'upsert');
  }
  return {
    schemaVersion: PROJECT_ASSET_CHANGE_MANIFEST_VERSION,
    upsertRelativePaths: [...states].filter(([, state]) => state === 'upsert').map(([relativePath]) => relativePath).sort(),
    deleteRelativePaths: [...states].filter(([, state]) => state === 'delete').map(([relativePath]) => relativePath).sort(),
  };
}

export function mergeProjectAssetChangeManifests(
  manifests: readonly (ProjectAssetChangeManifest | null | undefined)[],
): ProjectAssetChangeManifest {
  const mutations: Array<{ relativePath: string; delete?: boolean }> = [];
  for (const raw of manifests) {
    if (!raw) continue;
    const manifest = normalizeProjectAssetChangeManifest(raw);
    mutations.push(...manifest.deleteRelativePaths.map((relativePath) => ({ relativePath, delete: true })));
    mutations.push(...manifest.upsertRelativePaths.map((relativePath) => ({ relativePath })));
  }
  return projectAssetChangeManifestFromMutations(mutations);
}

export function isUiDesignerProjectRelativeResourcePath(value: string): boolean {
  try {
    normalizeUiDesignerProjectRelativeResourcePath(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeUiButtonImageStates(value: UiButtonImageStates): UiButtonImageStates {
  const next = {} as UiButtonImageStates;
  for (const key of IMAGE_STATE_KEYS) {
    next[key] = normalizeUiDesignerProjectRelativeResourcePath(value[key]);
  }
  return next;
}

export function normalizeUiDesignerFrames(value: UiFrame[]): UiFrame[] {
  if (!Array.isArray(value)) throw new Error('UI Designer frames must be an array.');
  return value.map((frame) => ({
    ...frame,
    path: normalizeUiDesignerProjectRelativeResourcePath(frame.path),
  }));
}

/** Normalize every resource-bearing property reachable from Inspector edits. */
export function normalizeUiDesignerResourceProperty(property: string, value: unknown): unknown {
  if (RESOURCE_PATH_KEYS.has(property)) {
    if (typeof value !== 'string') throw new Error(`UI Designer resource ${property} must be a string.`);
    return normalizeUiDesignerProjectRelativeResourcePath(value);
  }
  if (property === 'imageStates') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('UI Designer imageStates must be an object.');
    }
    const states = value as Record<string, unknown>;
    if ([...IMAGE_STATE_KEYS].some((key) => typeof states[key] !== 'string')) {
      throw new Error('UI Designer imageStates must contain four string paths.');
    }
    return normalizeUiButtonImageStates(states as unknown as UiButtonImageStates);
  }
  if (property === 'frames') {
    return normalizeUiDesignerFrames(value as UiFrame[]);
  }
  return value;
}

export function assertUiDesignerDocumentResourcePaths(value: unknown, parentKey = ''): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertUiDesignerDocumentResourcePaths(entry, parentKey);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const resourceValue = RESOURCE_PATH_KEYS.has(key)
      || (parentKey === 'imageStates' && IMAGE_STATE_KEYS.has(key as keyof UiButtonImageStates))
      || (parentKey === 'frames' && key === 'path');
    if (resourceValue && typeof entry === 'string') {
      normalizeUiDesignerProjectRelativeResourcePath(entry);
    }
    assertUiDesignerDocumentResourcePaths(entry, key);
  }
}
