import fs from 'node:fs';
import path from 'node:path';

export const MAP_PREVIEW_SCHEME = {
  scheme: 'rpg-agent-preview',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
} as const;

export function normalizeMapPreviewProtocolKey(value: string): string {
  const key = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32,128}$/.test(key)) throw new Error('Invalid map preview protocol key.');
  return key;
}

export function resolveConfinedMapPreviewResource(rootInput: string, relativeInput: string): string {
  const root = fs.realpathSync.native(path.resolve(rootInput));
  if (!relativeInput || relativeInput.includes('\0') || path.isAbsolute(relativeInput)) {
    throw new Error('Invalid map preview resource path.');
  }
  const target = path.resolve(root, ...relativeInput.replace(/\\/g, '/').split('/'));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Map preview resource escaped its isolated root.');
  if (!fs.existsSync(target)) return target;
  const realTarget = fs.realpathSync.native(target);
  const realRelative = path.relative(root, realTarget);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error('Map preview resource symlink escaped its isolated root.');
  }
  return realTarget;
}

export interface MapPreviewResolutionEntry {
  resourceRoot: string;
  /** Optional pass-through root for shared asset trees served straight from the project. */
  fallback?: { root: string; prefixes: readonly string[] };
  /** Paths that must 404 (staged deletions, save data); prefixes deny whole trees. */
  denied?: { exact: Set<string>; prefixes: readonly string[] };
}

/** Isolated app files win; the fallback root only serves its allow-listed prefixes; denied paths always 404. */
export function resolveMapPreviewResource(entry: MapPreviewResolutionEntry, relative: string): string | null {
  const normalized = relative.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  if (entry.denied && (entry.denied.exact.has(lower) || entry.denied.prefixes.some((prefix) => lower.startsWith(prefix)))) {
    return null;
  }
  const primary = resolveConfinedMapPreviewResource(entry.resourceRoot, relative);
  if (fs.existsSync(primary) && fs.statSync(primary).isFile()) return primary;
  const fallback = entry.fallback;
  if (!fallback) return primary;
  if (!fallback.prefixes.some((prefix) => normalized.startsWith(prefix))) return primary;
  return resolveConfinedMapPreviewResource(fallback.root, relative);
}
