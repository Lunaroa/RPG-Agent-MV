import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  UiProjectResourceCatalog,
  UiResourceEntry,
  UiDesignerSceneDataReadResult,
  UiRuntimeSceneExport,
} from '../../../../contract/ui-designer.ts';
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
}

const UI_DESIGNER_RUNTIME_VERSION = '>=1.0.0';
const UI_DESIGNER_SCENE_VERSION = '1.0.0';

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
  const scene = value as UiRuntimeSceneExport;
  return {
    scene,
    metadata: {
      id: entry.id,
      relativePath,
      sceneName: entry.sceneName,
      version: entry.version,
      runtimeVersion: entry.runtimeVersion,
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
  if (versionState === 'invalid' || runtimeState === 'invalid') {
    return {
      sceneName,
      version,
      runtimeVersion,
      compatibility: 'invalid',
      diagnostic: 'Scene data has an invalid version declaration.',
    };
  }
  if (versionState !== 'compatible' || runtimeState !== 'compatible') {
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
