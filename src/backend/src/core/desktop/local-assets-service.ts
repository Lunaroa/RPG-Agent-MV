import fs from 'node:fs';
import path from 'node:path';

/**
 * 本地资产库：从 RPG-Agent-MV/data/assets/manifest.json 读取路径映射，
 * 使导入流程不再依赖外部 RPG Maker MV 安装目录。
 */

interface LocalManifest {
  version: number;
  sources: Record<string, {
    originalPath: string;
    tilesetsJson?: string;
    tilesetImages: Record<string, string>;
    parallaxes: Record<string, string>;
  }>;
  pathMapping: Record<string, string>;
}

let cachedManifest: LocalManifest | null = null;
let cachedRoot: string | null = null;

const LOCAL_ASSETS_REL_DIR = path.join('data', 'assets');
const LOCAL_ASSETS_LEGACY_REL_DIR = 'local-assets';

function localAssetsRoot(workflowRoot: string): string {
  const canonical = path.join(workflowRoot, LOCAL_ASSETS_REL_DIR);
  if (fs.existsSync(path.join(canonical, 'manifest.json'))) return canonical;
  const legacy = path.join(workflowRoot, LOCAL_ASSETS_LEGACY_REL_DIR);
  if (fs.existsSync(path.join(legacy, 'manifest.json'))) return legacy;
  return canonical;
}

function loadManifest(workflowRoot: string): LocalManifest | null {
  const root = localAssetsRoot(workflowRoot);
  if (cachedManifest && cachedRoot === root) return cachedManifest;
  const manifestFile = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return null;
  try {
    cachedManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as LocalManifest;
    cachedRoot = root;
    return cachedManifest;
  } catch {
    return null;
  }
}

/** 清除缓存（测试或 manifest 更新后调用）。 */
export function clearLocalAssetsCache(): void {
  cachedManifest = null;
  cachedRoot = null;
}

/**
 * 根据条目的源工程路径，返回本地资产库中对应的源目录（含 data/Tilesets.json 和 img/）。
 * 如果本地没有该源的副本，返回 null。
 */
export function resolveLocalSourcePath(
  workflowRoot: string,
  entry: Record<string, unknown>,
): string | null {
  const batch = entry.importBatch as Record<string, unknown> | undefined;
  const sourceSlug = batch?.sourceSlug ? String(batch.sourceSlug) : '';
  if (sourceSlug) {
    const slugDir = path.join(localAssetsRoot(workflowRoot), 'sources', sourceSlug);
    if (fs.existsSync(slugDir)) return slugDir;
  }

  const manifest = loadManifest(workflowRoot);
  if (!manifest) return null;

  const source = entry.source as Record<string, unknown> | undefined;
  const originalPath = String(
    batch?.sourceProject || source?.originalProjectPath || '',
  );
  if (!originalPath) return null;

  // 查找哪个 source 的 originalPath 匹配
  for (const [slug, info] of Object.entries(manifest.sources)) {
    if (info.originalPath === originalPath) {
      const localDir = path.join(localAssetsRoot(workflowRoot), 'sources', slug);
      if (fs.existsSync(localDir)) return localDir;
    }
  }
  return null;
}

/**
 * 从本地资产库解析图块/远景图片的绝对路径。
 * category: 'tilesets' | 'parallaxes'
 */
export function resolveLocalAssetPath(
  workflowRoot: string,
  entry: Record<string, unknown>,
  category: 'tilesets' | 'parallaxes',
  assetName: string,
): string | null {
  const manifest = loadManifest(workflowRoot);
  if (!manifest) return null;

  const baseName = path.basename(assetName, path.extname(assetName));

  // 方式 1：通过条目的源工程找到对应 slug，再在 sources[slug] 里查
  const batch = entry.importBatch as Record<string, unknown> | undefined;
  const source = entry.source as Record<string, unknown> | undefined;
  const originalProjectPath = String(
    batch?.sourceProject || source?.originalProjectPath || '',
  );

  for (const info of Object.values(manifest.sources)) {
    if (info.originalPath !== originalProjectPath) continue;
    const imageMap = category === 'tilesets' ? info.tilesetImages : info.parallaxes;
    const relPath = imageMap[baseName];
    if (relPath) {
      const absPath = path.join(localAssetsRoot(workflowRoot), relPath);
      if (fs.existsSync(absPath)) return absPath;
    }
  }

  // 方式 2：用 pathMapping 按原始绝对路径查找
  const dependencies = entry.dependencies as Record<string, unknown> | undefined;
  const depKey = category === 'tilesets' ? 'tilesetImages' : 'parallaxes';
  const depList = dependencies?.[depKey];
  if (Array.isArray(depList)) {
    for (const item of depList) {
      const record = item as { name?: string; originalPath?: string };
      const itemBase = record.originalPath
        ? path.basename(record.originalPath, path.extname(record.originalPath))
        : record.name;
      if (itemBase !== baseName) continue;
      if (record.originalPath && manifest.pathMapping[record.originalPath]) {
        const absPath = path.join(localAssetsRoot(workflowRoot), manifest.pathMapping[record.originalPath]);
        if (fs.existsSync(absPath)) return absPath;
      }
    }
  }

  const sourceSlug = batch?.sourceSlug ? String(batch.sourceSlug) : '';
  if (sourceSlug) {
    const direct = path.join(localAssetsRoot(workflowRoot), 'sources', sourceSlug, 'img', category, `${baseName}.png`);
    if (fs.existsSync(direct)) return direct;
  }

  const localSource = resolveLocalSourcePath(workflowRoot, entry);
  if (localSource) {
    const direct = path.join(localSource, 'img', category, `${baseName}.png`);
    if (fs.existsSync(direct)) return direct;
  }

  return null;
}

/** 检查本地资产库 manifest 是否存在。 */
export function hasLocalAssets(workflowRoot: string): boolean {
  return loadManifest(workflowRoot) != null;
}
