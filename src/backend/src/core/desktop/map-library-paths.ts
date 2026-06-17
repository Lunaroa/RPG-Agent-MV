import fs from 'node:fs';
import path from 'node:path';

/** 地图制作：视觉地图库（相对 workflowRoot，位于 data/assets 下）。 */
export const MAP_LIBRARY_REL_DIR = path.join('data', 'assets', 'map-visual-library');

/** 旧路径：曾位于 RPG-Agent-MV/local-assets 下。 */
export const MAP_LIBRARY_LOCAL_ASSETS_FALLBACK_REL_DIR = path.join(
  'local-assets',
  'map-visual-library',
);

/** 历史路径：曾挂在已注销 cartographer agent 的 workspace 下。 */
export const MAP_LIBRARY_LEGACY_REL_DIR = path.join(
  'config',
  'agents',
  'rmmv-cartographer',
  'workspace',
  'map-visual-library',
);

const toPosix = (segments: string) => segments.split(path.sep).join('/');

const LOCAL_ASSETS_PREFIX = toPosix(MAP_LIBRARY_LOCAL_ASSETS_FALLBACK_REL_DIR);
const LEGACY_PREFIX = toPosix(MAP_LIBRARY_LEGACY_REL_DIR);
const CANONICAL_PREFIX = toPosix(MAP_LIBRARY_REL_DIR);

const FALLBACK_ROOTS = [
  MAP_LIBRARY_REL_DIR,
  MAP_LIBRARY_LOCAL_ASSETS_FALLBACK_REL_DIR,
  MAP_LIBRARY_LEGACY_REL_DIR,
];

export function mapLibraryRootPath(workflowRoot: string): string {
  for (const rel of FALLBACK_ROOTS) {
    const root = path.join(workflowRoot, rel);
    if (fs.existsSync(path.join(root, 'index.json'))) return root;
  }
  return path.join(workflowRoot, MAP_LIBRARY_REL_DIR);
}

export function mapLibraryIndexPath(workflowRoot: string): string {
  return path.join(mapLibraryRootPath(workflowRoot), 'index.json');
}

/** 将 index / selection 中的库内相对路径规范到 data/assets 前缀。 */
export function canonicalMapLibraryRelativePath(relative: string): string {
  const normalized = String(relative || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith(LEGACY_PREFIX)) {
    return `${CANONICAL_PREFIX}${normalized.slice(LEGACY_PREFIX.length)}`;
  }
  if (normalized.startsWith(LOCAL_ASSETS_PREFIX)) {
    return `${CANONICAL_PREFIX}${normalized.slice(LOCAL_ASSETS_PREFIX.length)}`;
  }
  return normalized;
}

export function resolveMapLibraryFilePath(workflowRoot: string, relative: string): string {
  const canonical = canonicalMapLibraryRelativePath(relative);
  const primary = path.resolve(workflowRoot, canonical);
  if (fs.existsSync(primary)) return primary;
  const raw = path.resolve(workflowRoot, String(relative || '').replace(/\\/g, '/'));
  if (raw !== primary && fs.existsSync(raw)) return raw;
  return primary;
}
