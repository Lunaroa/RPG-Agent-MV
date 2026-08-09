import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_RUNTIME_VERSION,
  type UiDesignerSceneDataReadResult,
  type UiProjectResourceCatalog,
  type UiResourceEntry,
} from '../../../../contract/ui-designer.ts';
import {
  canonicalUiRuntimeSceneExport,
  UI_DESIGNER_LEGACY_DOCUMENT_VERSION,
} from '../../../../contract/ui-designer-script.ts';
import {
  inspectRmmvProject,
  resourceRelativePath,
  resolveRmmvLayout,
} from '../rmmv/rmmv-layout.ts';
import { projectAssetThumbnailUrl, projectAssetUrl } from './asset-service.ts';
import { uiDesignerProjectCompatibility } from './ui-designer-compatibility.ts';
import { validateUiRuntimeSceneExport } from './ui-designer-validation.ts';

export interface UiDesignerResourceCatalogOptions {
  referencedPaths?: readonly string[];
  includeMissingReferences?: boolean;
  category?: UiResourceEntry['category'];
  query?: string;
  offset?: number;
  limit?: number;
}

const UI_DESIGNER_SCENE_VERSION = UI_DESIGNER_DOCUMENT_VERSION;

const RESOURCE_RULES: ReadonlyArray<{
  category: UiResourceEntry['category'];
  directory: string;
  extensions: readonly string[];
}> = [
  { category: 'image', directory: 'img', extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
  { category: 'audio', directory: 'audio', extensions: ['.ogg', '.m4a', '.wav', '.mp3'] },
  { category: 'video', directory: 'movies', extensions: ['.webm', '.mp4', '.ogv'] },
  { category: 'font', directory: 'fonts', extensions: ['.ttf', '.otf', '.woff', '.woff2'] },
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export class UiDesignerFrameFolderSelectionError extends Error {
  readonly code = 'UI_DESIGNER_FRAME_FOLDER_INVALID';

  constructor(message = 'The selected frame folder must be inside the project image resources.') {
    super(message);
    this.name = 'UiDesignerFrameFolderSelectionError';
  }
}

export class UiDesignerSceneDataReadError extends Error {
  readonly code: string;
  readonly recoverable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UiDesignerSceneDataReadError';
    this.code = code;
  }
}

/**
 * Enumerate project-owned UI resources from the layout selected by the shared
 * RMMV inspector. No project root or engine folder is guessed here: MV www
 * deployments and root-data MZ projects both resolve through rmmv-layout.
 */
export function inspectUiDesignerResources(
  projectRoot: string,
  options: UiDesignerResourceCatalogOptions = {},
): UiProjectResourceCatalog {
  const project = path.resolve(projectRoot);
  const manifest = inspectRmmvProject(project);
  const layout = resolveRmmvLayout(project);
  const referenced = new Set((options.referencedPaths || []).map((value) => normalizeResourceRelative(layout.resourceRootRelative, value)));
  const resources: UiResourceEntry[] = [];
  const known = new Set<string>();

  for (const rule of RESOURCE_RULES) {
    const directory = path.join(layout.resourceRoot, ...rule.directory.split('/'));
    for (const filePath of walkFiles(directory)) {
      const relativeToResource = normalizeResourceRelative('', path.relative(layout.resourceRoot, filePath));
      const projectRelative = resourceRelativePath(layout, relativeToResource);
      const key = relativeToResource;
      const stat = fs.statSync(filePath);
      const entry: UiResourceEntry = {
        id: `${rule.category}:${key}`,
        category: rule.category,
        path: relativeToResource,
        relativePath: relativeToResource,
        previewUrl: projectAssetUrl(project, projectRelative),
        name: path.basename(filePath),
        exists: true,
        referenced: referenced.has(key) || referenced.has(relativeToResource),
        size: stat.size,
        ...(rule.category === 'image'
          ? { thumbnailUrl: projectAssetThumbnailUrl(project, projectRelative, 128) }
          : {}),
      };
      resources.push(entry);
      known.add(key);
    }
  }

  resources.push(...inspectSceneDataResources(project, layout, referenced));

  if (options.includeMissingReferences !== false) {
    for (const relativePath of referenced) {
      if (known.has(relativePath)) continue;
      const category = categoryForRelativePath(relativePath);
      if (!category) continue;
      resources.push({
        id: `${category}:${relativePath}`,
        category,
        path: stripResourceRoot(layout.resourceRootRelative, relativePath),
        relativePath: stripResourceRoot(layout.resourceRootRelative, relativePath),
        previewUrl: projectAssetUrl(project, resourceRelativePath(layout, stripResourceRoot(layout.resourceRootRelative, relativePath))),
        name: path.basename(relativePath),
        exists: false,
        referenced: true,
      });
    }
  }

  resources.sort((left, right) => left.path.localeCompare(right.path));
  return {
    projectPath: project,
    engine: manifest.engine === 'rpg-maker-mz' ? 'MZ' : manifest.engine === 'rpg-maker-mv' ? 'MV' : 'unknown',
    projectCompatibility: uiDesignerProjectCompatibility(manifest),
    resources,
  };
}

/**
 * Asynchronously enumerate one bounded resource page. The renderer calls this
 * only after the user opens a resource picker; no project-switch path uses it.
 */
export async function inspectUiDesignerResourcesAsync(
  projectRoot: string,
  options: UiDesignerResourceCatalogOptions = {},
): Promise<UiProjectResourceCatalog> {
  const project = path.resolve(projectRoot);
  const manifest = inspectRmmvProject(project);
  const layout = resolveRmmvLayout(project);
  const referenced = new Set((options.referencedPaths || []).map((value) => normalizeResourceRelative(layout.resourceRootRelative, value)));
  const candidates: UiResourceEntry[] = [];
  const rules = options.category ? RESOURCE_RULES.filter((rule) => rule.category === options.category) : RESOURCE_RULES;

  for (const rule of rules) {
    const directory = path.join(layout.resourceRoot, ...rule.directory.split('/'));
    const files = await walkFilesAsync(directory);
    for (const filePath of files) {
      const relativeToResource = normalizeResourceRelative('', path.relative(layout.resourceRoot, filePath));
      const projectRelative = resourceRelativePath(layout, relativeToResource);
      const stat = await fs.promises.stat(filePath);
      candidates.push({
        id: `${rule.category}:${relativeToResource}`,
        category: rule.category,
        path: relativeToResource,
        relativePath: relativeToResource,
        previewUrl: projectAssetUrl(project, projectRelative),
        name: path.basename(filePath),
        exists: true,
        referenced: referenced.has(relativeToResource),
        size: stat.size,
        ...(rule.category === 'image' ? { thumbnailUrl: projectAssetThumbnailUrl(project, projectRelative, 128) } : {}),
      });
    }
  }

  if (!options.category || options.category === 'sceneData') {
    candidates.push(...await inspectSceneDataResourcesAsync(project, layout, referenced));
  }

  if (options.includeMissingReferences !== false) {
    for (const relativePath of referenced) {
      if (candidates.some((entry) => entry.relativePath === relativePath)) continue;
      const category = categoryForRelativePath(relativePath);
      if (!category || (options.category && options.category !== category)) continue;
      candidates.push(createMissingResourceEntry(project, layout, relativePath, category));
    }
  }

  candidates.sort((left, right) => left.path.localeCompare(right.path));
  return pageResourceCatalog(project, manifest, candidates, options);
}

/** Resolve only paths already referenced by the current document. This is a
 * lightweight probe and never recursively scans project resource folders. */
export async function inspectUiDesignerResourceReferences(
  projectRoot: string,
  referencedPaths: readonly string[],
): Promise<UiProjectResourceCatalog> {
  const project = path.resolve(projectRoot);
  const manifest = inspectRmmvProject(project);
  const layout = resolveRmmvLayout(project);
  const resourceRoot = await fs.promises.realpath(layout.resourceRoot).catch(() => layout.resourceRoot);
  const entries: UiResourceEntry[] = [];
  const seen = new Set<string>();
  for (const value of referencedPaths) {
    let relativePath: string;
    try { relativePath = normalizeResourceRelative(layout.resourceRootRelative, value); } catch { continue; }
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const category = categoryForRelativePath(relativePath);
    if (!category || !isSupportedResource(relativePath)) continue;
    const filePath = path.resolve(layout.resourceRoot, ...relativePath.split('/'));
    const projectRelative = resourceRelativePath(layout, relativePath);
    let exists = false;
    let size: number | undefined;
    let mtimeMs: number | undefined;
    try {
      const realPath = await fs.promises.realpath(filePath);
      if (!isContainedPath(resourceRoot, realPath)) continue;
      const stat = await fs.promises.stat(realPath);
      exists = stat.isFile();
      if (exists) { size = stat.size; mtimeMs = stat.mtimeMs; }
    } catch { exists = false; }
    entries.push({
      id: `${category}:${relativePath}`,
      category,
      path: relativePath,
      relativePath,
      previewUrl: projectAssetUrl(project, projectRelative),
      ...(category === 'image' ? { thumbnailUrl: projectAssetThumbnailUrl(project, projectRelative, 128) } : {}),
      name: path.basename(relativePath),
      exists,
      referenced: true,
      ...(size === undefined ? {} : { size }),
      ...(mtimeMs === undefined ? {} : { mtimeMs }),
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return pageResourceCatalog(project, manifest, entries, { offset: 0, limit: entries.length || 1 });
}

/**
 * Return only image files from a native-selected project image directory. The
 * renderer receives engine-relative paths and asset protocol URLs; it never
 * receives the selected absolute directory. Realpath containment rejects a
 * symlink that would escape the project resource root.
 */
export function selectUiDesignerFrameFolder(projectRoot: string, selectedDirectory: string): UiResourceEntry[] {
  const project = path.resolve(projectRoot);
  const layout = resolveRmmvLayout(project);
  let imageRoot: string;
  try {
    imageRoot = fs.realpathSync(path.join(layout.resourceRoot, 'img'));
  } catch {
    throw new UiDesignerFrameFolderSelectionError();
  }
  const selected = resolveExistingDirectory(selectedDirectory);
  if (!isContainedPath(imageRoot, selected)) throw new UiDesignerFrameFolderSelectionError();

  return walkImageFiles(selected)
    .map((filePath) => {
      const relativePath = normalizeResourceRelative('', path.relative(layout.resourceRoot, filePath));
      const projectRelative = resourceRelativePath(layout, relativePath);
      const stat = fs.statSync(filePath);
      return {
        id: `image:${relativePath}`,
        category: 'image',
        path: relativePath,
        relativePath,
        previewUrl: projectAssetUrl(project, projectRelative),
        thumbnailUrl: projectAssetThumbnailUrl(project, projectRelative, 128),
        name: path.basename(filePath),
        exists: true,
        referenced: false,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      } satisfies UiResourceEntry;
    })
    .sort((left, right) => left.relativePath!.localeCompare(right.relativePath!));
}

/**
 * Read one catalog-listed Runtime scene for an explicit, lossy editor import.
 * The renderer supplies only an engine-relative catalog path; the backend
 * resolves it through the inspected resource root and rejects symlink escapes,
 * unlisted files, malformed JSON, and unsupported Runtime versions.
 */
export function readUiDesignerSceneData(projectRoot: string, requestedPath: string): UiDesignerSceneDataReadResult {
  const project = path.resolve(projectRoot);
  const layout = resolveRmmvLayout(project);
  let relativePath: string;
  try {
    if (path.isAbsolute(requestedPath) || /^[A-Za-z]:[\\/]/.test(requestedPath)) throw new Error('absolute');
    relativePath = normalizeResourceRelative('', requestedPath);
  } catch {
    throw new UiDesignerSceneDataReadError('UI_DESIGNER_SCENE_DATA_PATH_INVALID', 'Scene data path is not a project-relative resource path.');
  }

  const catalog = inspectUiDesignerResources(project, { includeMissingReferences: false });
  const entry = catalog.resources.find((candidate) => candidate.category === 'sceneData'
    && (candidate.relativePath === relativePath || candidate.path === relativePath));
  if (!entry) {
    throw new UiDesignerSceneDataReadError('UI_DESIGNER_SCENE_DATA_NOT_CATALOGED', 'Scene data is not listed in the current project resource catalog.');
  }
  if (entry.compatibility !== 'compatible' || !entry.sceneName || !entry.version || !entry.runtimeVersion) {
    throw new UiDesignerSceneDataReadError('UI_DESIGNER_SCENE_DATA_UNSUPPORTED', entry.diagnostic || 'Scene data is not compatible with the current UI designer Runtime.');
  }

  const sceneDirectory = path.join(layout.resourceRoot, 'js', 'plugins', 'mzui-data');
  let sceneRoot: string;
  let filePath: string;
  try {
    sceneRoot = fs.realpathSync(sceneDirectory);
    filePath = path.resolve(layout.resourceRoot, ...relativePath.split('/'));
    const realFilePath = fs.realpathSync(filePath);
    if (!isContainedPath(sceneRoot, realFilePath) || !fs.statSync(realFilePath).isFile()) throw new Error('outside');
    filePath = realFilePath;
  } catch {
    throw new UiDesignerSceneDataReadError('UI_DESIGNER_SCENE_DATA_OUTSIDE_PROJECT', 'Scene data must remain inside the project Runtime scene directory.');
  }

  let value: unknown;
  let raw: Buffer;
  try {
    raw = fs.readFileSync(filePath);
    value = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new UiDesignerSceneDataReadError('UI_DESIGNER_SCENE_DATA_INVALID', 'Scene data is not valid JSON.');
  }
  const report = validateUiRuntimeSceneExport(value);
  if (!report.valid) {
    throw new UiDesignerSceneDataReadError('UI_DESIGNER_SCENE_DATA_INVALID', `Scene data validation failed: ${report.errors.map((issue) => issue.message).join('; ')}`);
  }

  const stat = fs.statSync(filePath);
  const scene = canonicalUiRuntimeSceneExport(value);
  return {
    scene,
    metadata: {
      id: entry.id,
      relativePath,
      sceneName: scene.meta.sceneName,
      version: scene.version,
      runtimeVersion: scene.runtimeVersion,
      compatibility: 'compatible',
      digest: crypto.createHash('sha256').update(raw).digest('hex'),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    },
    projectCompatibility: catalog.projectCompatibility || {
      engine: 'unknown',
      engineVersion: null,
      engineVersionSupported: false,
      warnings: ['Project compatibility could not be inspected.'],
    },
  };
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && isSupportedResource(filePath)) result.push(filePath);
    }
  };
  visit(root);
  return result;
}

async function walkFilesAsync(root: string): Promise<string[]> {
  try {
    const rootStat = await fs.promises.stat(root);
    if (!rootStat.isDirectory()) return [];
  } catch { return []; }
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && isSupportedResource(filePath)) result.push(filePath);
    }
  };
  await visit(root);
  return result;
}

function walkImageFiles(root: string): string[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(filePath);
    }
  };
  visit(root);
  return result;
}

async function inspectSceneDataResourcesAsync(
  project: string,
  layout: ReturnType<typeof resolveRmmvLayout>,
  referenced: ReadonlySet<string>,
): Promise<UiResourceEntry[]> {
  const directory = path.join(layout.resourceRoot, 'js', 'plugins', 'mzui-data');
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return []; }
  const files = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => normalizeResourceRelative('', path.relative(layout.resourceRoot, left)).localeCompare(normalizeResourceRelative('', path.relative(layout.resourceRoot, right))));
  return Promise.all(files.map(async (filePath) => {
    const relativePath = normalizeResourceRelative('', path.relative(layout.resourceRoot, filePath));
    const projectRelative = resourceRelativePath(layout, relativePath);
    const stat = await fs.promises.stat(filePath);
    const metadata = await readSceneDataMetadataAsync(filePath, path.basename(filePath, '.json'));
    return {
      id: `sceneData:${relativePath}`,
      category: 'sceneData',
      path: relativePath,
      relativePath,
      previewUrl: projectAssetUrl(project, projectRelative),
      name: path.basename(filePath),
      exists: true,
      referenced: referenced.has(relativePath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ...metadata,
    } satisfies UiResourceEntry;
  }));
}

async function readSceneDataMetadataAsync(
  filePath: string,
  filenameSceneName: string,
): Promise<Pick<UiResourceEntry, 'sceneName' | 'version' | 'runtimeVersion' | 'compatibility' | 'diagnostic'>> {
  if (!/^Scene_[A-Za-z0-9_$]+$/.test(filenameSceneName)) {
    return { compatibility: 'invalid', diagnostic: 'Scene data filename is not a valid Scene_* identifier.' };
  }
  let value: unknown;
  try { value = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as unknown; }
  catch { return { compatibility: 'invalid', diagnostic: 'Scene data is not valid JSON.' }; }
  if (!isRecord(value)) return { compatibility: 'invalid', diagnostic: 'Scene data must be a JSON object.' };
  const version = typeof value.version === 'string' ? value.version : undefined;
  const runtimeVersion = typeof value.runtimeVersion === 'string' ? value.runtimeVersion : undefined;
  const meta = isRecord(value.meta) ? value.meta : undefined;
  const sceneName = typeof meta?.sceneName === 'string' ? meta.sceneName : undefined;
  if (!version) return { sceneName, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene data is missing its version.' };
  if (!runtimeVersion) return { sceneName, version, compatibility: 'invalid', diagnostic: 'Scene data is missing its runtime version.' };
  const versionState = compareUiVersion(version, UI_DESIGNER_SCENE_VERSION);
  const runtimeState = compareRuntimeVersion(runtimeVersion, UI_DESIGNER_RUNTIME_VERSION);
  const migratableLegacy = version === UI_DESIGNER_LEGACY_DOCUMENT_VERSION && runtimeVersion === '>=1.0.0';
  if (versionState === 'invalid' || runtimeState === 'invalid') return { sceneName, version, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene data has an invalid version declaration.' };
  if (!migratableLegacy && (versionState !== 'compatible' || runtimeState !== 'compatible')) return {
    sceneName,
    version,
    runtimeVersion,
    compatibility: versionState === 'unsupported-version' || runtimeState === 'unsupported-version' ? 'unsupported-version' : 'outdated',
    diagnostic: `Scene data requires ${UI_DESIGNER_SCENE_VERSION}/${UI_DESIGNER_RUNTIME_VERSION}.`,
  };
  if (!sceneName || !/^Scene_[A-Za-z0-9_$]+$/.test(sceneName)) return { sceneName, version, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene data has an invalid scene name.' };
  if (sceneName !== filenameSceneName) return { sceneName, version, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene filename and scene metadata do not match.' };
  return { sceneName, version, runtimeVersion, compatibility: 'compatible' };
}

function createMissingResourceEntry(
  project: string,
  layout: ReturnType<typeof resolveRmmvLayout>,
  relativePath: string,
  category: UiResourceEntry['category'],
): UiResourceEntry {
  const projectRelative = resourceRelativePath(layout, relativePath);
  return {
    id: `${category}:${relativePath}`,
    category,
    path: relativePath,
    relativePath,
    previewUrl: projectAssetUrl(project, projectRelative),
    ...(category === 'image' ? { thumbnailUrl: projectAssetThumbnailUrl(project, projectRelative, 128) } : {}),
    name: path.basename(relativePath),
    exists: false,
    referenced: true,
  };
}

function pageResourceCatalog(
  project: string,
  manifest: ReturnType<typeof inspectRmmvProject>,
  resources: UiResourceEntry[],
  options: UiDesignerResourceCatalogOptions,
): UiProjectResourceCatalog {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const filtered = query ? resources.filter((resource) => `${resource.name} ${resource.path}`.toLocaleLowerCase().includes(query)) : resources;
  const total = filtered.length;
  const limit = Math.min(200, Math.max(1, Math.floor(Number(options.limit) || 100)));
  const offset = Math.min(total, Math.max(0, Math.floor(Number(options.offset) || 0)));
  return {
    projectPath: project,
    engine: manifest.engine === 'rpg-maker-mz' ? 'MZ' : manifest.engine === 'rpg-maker-mv' ? 'MV' : 'unknown',
    projectCompatibility: uiDesignerProjectCompatibility(manifest),
    resources: filtered.slice(offset, offset + limit),
    total,
    offset,
    limit,
    hasMore: offset + limit < total,
  };
}

function resolveExistingDirectory(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new UiDesignerFrameFolderSelectionError();
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    if (!fs.statSync(resolved).isDirectory()) throw new UiDesignerFrameFolderSelectionError();
    return resolved;
  } catch (error) {
    if (error instanceof UiDesignerFrameFolderSelectionError) throw error;
    throw new UiDesignerFrameFolderSelectionError();
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isSupportedResource(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return RESOURCE_RULES.some((rule) => rule.extensions.includes(extension));
}

/**
 * Scene JSON is exposed as shallow project metadata only. It deliberately does
 * not use the .mzui source parser/validator here: the catalog is a file list,
 * while runtime scene validation remains the explicit export/staging boundary.
 */
function inspectSceneDataResources(
  project: string,
  layout: ReturnType<typeof resolveRmmvLayout>,
  referenced: ReadonlySet<string>,
): UiResourceEntry[] {
  const directory = path.join(layout.resourceRoot, 'js', 'plugins', 'mzui-data');
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];

  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => normalizeResourceRelative('', path.relative(layout.resourceRoot, left)).localeCompare(
      normalizeResourceRelative('', path.relative(layout.resourceRoot, right)),
    ));

  return files.map((filePath) => {
    const relativePath = normalizeResourceRelative('', path.relative(layout.resourceRoot, filePath));
    const projectRelative = resourceRelativePath(layout, relativePath);
    const stat = fs.statSync(filePath);
    const metadata = readSceneDataMetadata(filePath, path.basename(filePath, '.json'));
    return {
      id: `sceneData:${relativePath}`,
      category: 'sceneData',
      path: relativePath,
      relativePath,
      previewUrl: projectAssetUrl(project, projectRelative),
      name: path.basename(filePath),
      exists: true,
      referenced: referenced.has(relativePath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ...metadata,
    } satisfies UiResourceEntry;
  });
}

function readSceneDataMetadata(filePath: string, filenameSceneName: string): Pick<UiResourceEntry, 'sceneName' | 'version' | 'runtimeVersion' | 'compatibility' | 'diagnostic'> {
  if (!/^Scene_[A-Za-z0-9_$]+$/.test(filenameSceneName)) {
    return { compatibility: 'invalid', diagnostic: 'Scene data filename is not a valid Scene_* identifier.' };
  }
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return { compatibility: 'invalid', diagnostic: 'Scene data is not valid JSON.' };
  }

  if (!isRecord(value)) return { compatibility: 'invalid', diagnostic: 'Scene data must be a JSON object.' };
  const version = typeof value.version === 'string' ? value.version : undefined;
  const runtimeVersion = typeof value.runtimeVersion === 'string' ? value.runtimeVersion : undefined;
  const meta = isRecord(value.meta) ? value.meta : undefined;
  const sceneName = typeof meta?.sceneName === 'string' ? meta.sceneName : undefined;
  if (!version) return { sceneName, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene data is missing its version.' };
  if (!runtimeVersion) return { sceneName, version, compatibility: 'invalid', diagnostic: 'Scene data is missing its runtime version.' };
  const versionState = compareUiVersion(version, UI_DESIGNER_SCENE_VERSION);
  const runtimeState = compareRuntimeVersion(runtimeVersion, UI_DESIGNER_RUNTIME_VERSION);
  const migratableLegacy = version === UI_DESIGNER_LEGACY_DOCUMENT_VERSION && runtimeVersion === '>=1.0.0';
  if (versionState === 'invalid' || runtimeState === 'invalid') {
    return {
      sceneName,
      version,
      runtimeVersion,
      compatibility: 'invalid',
      diagnostic: 'Scene data has an invalid version declaration.',
    };
  }
  if (!migratableLegacy && (versionState !== 'compatible' || runtimeState !== 'compatible')) {
    return {
      sceneName,
      version,
      runtimeVersion,
      compatibility: versionState === 'unsupported-version' || runtimeState === 'unsupported-version'
        ? 'unsupported-version'
        : 'outdated',
      diagnostic: `Scene data requires ${UI_DESIGNER_SCENE_VERSION}/${UI_DESIGNER_RUNTIME_VERSION}.`,
    };
  }
  if (!sceneName || !/^Scene_[A-Za-z0-9_$]+$/.test(sceneName)) {
    return { sceneName, version, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene data has an invalid scene name.' };
  }
  if (sceneName !== filenameSceneName) {
    return { sceneName, version, runtimeVersion, compatibility: 'invalid', diagnostic: 'Scene filename and scene metadata do not match.' };
  }
  return { sceneName, version, runtimeVersion, compatibility: 'compatible' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compareUiVersion(value: string, expected: string): 'compatible' | 'outdated' | 'unsupported-version' | 'invalid' {
  const actualParts = parseVersion(value);
  const expectedParts = parseVersion(expected);
  if (!actualParts || !expectedParts) return 'invalid';
  const comparison = compareVersionParts(actualParts, expectedParts);
  return comparison === 0 ? 'compatible' : comparison < 0 ? 'outdated' : 'unsupported-version';
}

function compareRuntimeVersion(value: string, expected: string): 'compatible' | 'outdated' | 'unsupported-version' | 'invalid' {
  const actual = value.match(/^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/);
  const expectedMatch = expected.match(/^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/);
  if (!actual || !expectedMatch) return 'invalid';
  const actualParts = actual.slice(1).map(Number) as [number, number, number];
  const expectedParts = expectedMatch.slice(1).map(Number) as [number, number, number];
  const comparison = compareVersionParts(actualParts, expectedParts);
  return comparison === 0 ? 'compatible' : comparison < 0 ? 'outdated' : 'unsupported-version';
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
  if (!match) return null;
  return match.slice(1).map(Number) as [number, number, number];
}

function compareVersionParts(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function categoryForRelativePath(relativePath: string): UiResourceEntry['category'] | null {
  const normalized = relativePath.toLowerCase();
  if (normalized.startsWith('img/')) return 'image';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('movies/')) return 'video';
  if (normalized.startsWith('fonts/')) return 'font';
  return null;
}

function normalizeResourceRelative(resourceRootRelative: string, value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const withoutRoot = stripResourceRoot(resourceRootRelative, normalized);
  if (!withoutRoot || withoutRoot.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid UI resource path: ${value}`);
  }
  return withoutRoot;
}

function stripResourceRoot(resourceRootRelative: string, relativePath: string): string {
  const prefix = resourceRootRelative ? `${resourceRootRelative}/` : '';
  return prefix && relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath;
}
