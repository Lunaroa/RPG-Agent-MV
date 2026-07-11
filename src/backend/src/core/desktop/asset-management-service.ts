import fs from 'node:fs';
import path from 'node:path';

import type {
  ManagedAssetDetail,
  ManagedAssetRef,
  ManagedAssetScope,
  ProjectAssetImportLocalFileInput,
  ProjectAssetMutationSafetyCheck,
  ProjectAssetReference,
  ProjectAssetReferenceGraph,
  ProjectAssetReferenceGraphAsset,
  ProjectAssetReplaceMissingReferenceInput,
  ProjectAssetReplaceMissingReferenceResult,
  ProjectMissingAssetReference,
} from '../../../../contract/types.ts';
import { buildAssetInventory } from '../rmmv/asset-inventory.ts';
import { readJson } from '../rmmv/json.ts';
import { projectAssetUrl } from './asset-service.ts';
import {
  assetManagementAssetMissing,
  assetManagementCategoryMissing,
  assetManagementImportParamsMissing,
  assetManagementInvalidName,
  assetManagementInvalidPath,
  assetManagementMissingParams,
  assetManagementNotMissingReference,
  assetManagementOverwriteMustBeBoolean,
  assetManagementOverwriteRequired,
  assetManagementPathOutOfBounds,
  assetManagementReplacementAssetMissing,
  assetManagementReplacementSameAsMissing,
  assetManagementReplacementUnsupported,
  assetManagementSourceMissing,
  assetManagementSourceMustBeAbsolute,
  assetManagementSourceNotFile,
  assetManagementSourceRequired,
  assetManagementTargetNameExists,
  unsupportedAssetCategory,
  unsupportedAssetExtension,
} from './assetManagementLocalization.ts';
import {
  buildAssetReferenceGraph,
  checkAssetDeleteSafety,
  checkAssetRenameSafety,
  findReferencesForAsset,
  projectAssetRelativeDirectory,
  requireAssetCategory,
  RMMV_ASSET_CATEGORIES,
  type RmmvAssetReference,
  type RmmvMissingAssetReference,
  type RmmvProjectAsset,
  type RmmvAssetCategory,
} from './asset-reference-graph-service.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  isInside,
  stageProjectFilesAtomically,
  type StagedProjectFileMutation,
} from './staging-service.ts';

interface AssetTarget {
  scope: ManagedAssetScope;
  category: string;
  relativePath: string;
}

const INVENTORY_AUDIO_CATEGORIES = ['bgm', 'bgs', 'me', 'se'] as const;
const INVENTORY_IMAGE_CATEGORIES = {
  animations: 'animations',
  battlebacks1: 'battlebacks1',
  battlebacks2: 'battlebacks2',
  characters: 'characters',
  enemies: 'enemies',
  faces: 'faces',
  parallaxes: 'parallaxes',
  pictures: 'pictures',
  sv_actors: 'svActors',
  sv_enemies: 'svEnemies',
  system: 'system',
  tilesets: 'tilesets',
  titles1: 'titles1',
  titles2: 'titles2',
} as const;

export function getAssetDetail(workflowRoot: string, project: string, target: AssetTarget): ManagedAssetDetail {
  const resolved = resolveAssetPath(workflowRoot, project, target);
  if (!fs.existsSync(resolved.absolute)) throw new Error(assetManagementAssetMissing());
  const fileName = path.basename(resolved.absolute);
  const name = path.basename(fileName, path.extname(fileName));
  return {
    scope: target.scope,
    name,
    fileName,
    category: target.category,
    relativePath: resolved.relativePath,
    url: projectAssetUrl(project, resolved.relativePath),
    size: fs.statSync(resolved.absolute).size,
    staged: isAssetStaged(workflowRoot, project, resolved.relativePath),
    references: findProjectAssetReferences(workflowRoot, project, resolved.category, name),
  };
}

export function getAssetImportFileExtensions(categoryValue: string): string[] {
  const category = requireAssetCategory(categoryValue);
  const definition = RMMV_ASSET_CATEGORIES.find((item) => item.id === category);
  if (!definition) throw new Error(unsupportedAssetCategory(categoryValue));
  return definition.extensions.map((extension) => extension.replace(/^\./, ''));
}

export function buildStagedAwareAssetInventory(workflowRoot: string, project: string) {
  const inventory = buildAssetInventory(project);
  const graph = buildAssetReferenceGraph(workflowRoot, project);
  for (const category of INVENTORY_AUDIO_CATEGORIES) {
    inventory.audio[category] = effectiveInventoryBucket(graph.assets, category, inventory.audio[category]?.dir || '');
  }
  for (const [bucket, category] of Object.entries(INVENTORY_IMAGE_CATEGORIES)) {
    inventory.images[bucket] = effectiveInventoryBucket(graph.assets, category as RmmvAssetCategory, inventory.images[bucket]?.dir || '');
  }
  inventory.summary.audio = Object.fromEntries(INVENTORY_AUDIO_CATEGORIES.map((category) => [category, {
    exists: inventory.audio[category].exists,
    count: inventory.audio[category].count,
  }]));
  inventory.summary.images = Object.fromEntries(Object.keys(INVENTORY_IMAGE_CATEGORIES).map((bucket) => [bucket, {
    exists: inventory.images[bucket].exists,
    count: inventory.images[bucket].count,
  }]));
  const animationSheets = new Set(inventory.images.animations.names);
  inventory.animations = inventory.animations.map((animation) => ({
    ...animation,
    missingSheets: [animation.animation1Name, animation.animation2Name]
      .filter(Boolean)
      .filter((name) => !animationSheets.has(name)),
  }));
  inventory.summary.animations = {
    total: inventory.animations.length,
    named: inventory.animations.filter((animation) => animation.name).length,
    withMissingSheets: inventory.animations.filter((animation) => animation.missingSheets.length > 0).length,
  };
  return inventory;
}

export function buildProjectAssetReferenceGraph(workflowRoot: string, project: string): ProjectAssetReferenceGraph {
  const graph = buildAssetReferenceGraph(workflowRoot, project);
  return {
    generatedAt: graph.generatedAt,
    projectRoot: graph.projectRoot,
    summary: graph.summary,
    categories: graph.categories.map((category) => ({
      id: category.id,
      directory: category.directory,
    })),
    assets: graph.assets.map(mapGraphAsset),
    references: graph.references.map(mapGraphReference),
    missingReferences: graph.missingReferences.map(mapMissingGraphReference),
    unusedAssets: graph.unusedAssets.map(mapGraphAsset),
  };
}

export function checkProjectAssetDeleteSafety(workflowRoot: string, project: string, target: AssetTarget): ProjectAssetMutationSafetyCheck {
  const result = checkAssetDeleteSafety(workflowRoot, project, target);
  return {
    ok: result.ok,
    action: result.action,
    target: result.target,
    references: result.references.map(mapGraphReference),
    blockers: result.blockers,
  };
}

export function checkProjectAssetRenameSafety(
  workflowRoot: string,
  project: string,
  target: AssetTarget,
  nextName: string,
): ProjectAssetMutationSafetyCheck {
  const result = checkAssetRenameSafety(workflowRoot, project, target, nextName);
  return {
    ok: result.ok,
    action: result.action,
    target: result.target,
    nextName: result.nextName,
    nextRelativePath: result.nextRelativePath,
    references: result.references.map(mapGraphReference),
    blockers: result.blockers,
  };
}

export function replaceMissingAssetReference(
  workflowRoot: string,
  project: string,
  request: ProjectAssetReplaceMissingReferenceInput,
): ProjectAssetReplaceMissingReferenceResult {
  const graph = buildAssetReferenceGraph(workflowRoot, project);
  const category = requireAssetCategory(request.category);
  const missingName = request.missingName.trim();
  const replacementName = request.replacementName.trim();
  if (!missingName || !replacementName) throw new Error(assetManagementMissingParams());
  if (replacementName === missingName) throw new Error(assetManagementReplacementSameAsMissing());
  const replacementAsset = graph.assets.find((asset) => asset.category === category && asset.name === replacementName);
  if (!replacementAsset) throw new Error(assetManagementReplacementAssetMissing());
  const missingReferences = graph.missingReferences.filter((reference) =>
    reference.category === category && reference.name === missingName);
  if (!missingReferences.length) throw new Error(assetManagementNotMissingReference());
  const references = mapReferences(missingReferences);
  const update = prepareProjectAssetReferenceMutations(workflowRoot, project, category, missingName, replacementName, references);
  if (update.updatedReferences !== references.length) {
    throw new Error(assetManagementReplacementUnsupported());
  }
  stageProjectFilesAtomically(workflowRoot, project, update.mutations);
  return {
    category: request.category,
    missingName,
    replacementName,
    updatedReferences: update.updatedReferences,
    updatedFiles: update.updatedFiles,
  };
}

export function importLocalAssetFile(
  workflowRoot: string,
  project: string,
  request: ProjectAssetImportLocalFileInput,
): ManagedAssetDetail {
  const input = normalizeImportLocalAssetRequest(request);
  const category = requireAssetCategory(input.category);
  const definition = RMMV_ASSET_CATEGORIES.find((item) => item.id === category);
  if (!definition) throw new Error(unsupportedAssetCategory(input.category));

  const sourceFile = normalizeLocalSourceFile(input.sourceFile);
  const stat = fs.statSync(sourceFile);
  if (!stat.isFile()) throw new Error(assetManagementSourceNotFile());

  const sourceFileName = path.basename(sourceFile);
  const sourceExtension = path.extname(sourceFileName);
  const sourceExtensionLower = sourceExtension.toLowerCase();
  if (!definition.extensions.includes(sourceExtensionLower)) {
    throw new Error(unsupportedAssetExtension(category, sourceExtension));
  }

  const targetName = input.targetName === undefined || input.targetName.trim() === ''
    ? path.basename(sourceFileName, sourceExtension)
    : normalizeImportTargetName(input.targetName);
  const targetRelative = `${projectAssetRelativeDirectory(workflowRoot, project, category)}/${targetName}${sourceExtension}`;
  assertProjectRelativeTarget(project, targetRelative);

  const graph = buildAssetReferenceGraph(workflowRoot, project);
  const occupied = graph.assets.filter((asset) => asset.category === category && asset.name === targetName);
  if (occupied.length > 1) throw new Error(assetManagementTargetNameExists());
  if (occupied.length === 1 && input.overwrite !== true) {
    throw new Error(assetManagementOverwriteRequired());
  }

  const mutations: StagedProjectFileMutation[] = [{
    relativePath: targetRelative,
    content: fs.readFileSync(sourceFile),
  }];
  if (occupied[0] && occupied[0].relativePath !== targetRelative) {
    mutations.push({ relativePath: occupied[0].relativePath, delete: true });
  }
  stageProjectFilesAtomically(workflowRoot, project, mutations);
  return getAssetDetail(workflowRoot, project, {
    scope: 'project',
    category,
    relativePath: targetRelative,
  });
}

export function renameAsset(
  workflowRoot: string,
  project: string,
  target: AssetTarget,
  nextNameValue: string,
): ManagedAssetDetail {
  const nextName = normalizeAssetName(nextNameValue);
  const resolved = resolveAssetPath(workflowRoot, project, target);
  if (!fs.existsSync(resolved.absolute)) throw new Error(assetManagementAssetMissing());
  const ext = path.extname(resolved.absolute);
  const before = path.basename(resolved.absolute, ext);
  const safety = checkAssetRenameSafety(workflowRoot, project, { category: resolved.category, relativePath: resolved.relativePath, name: before }, nextName);
  if (!safety.ok) throw new Error(safety.blockers.join('; '));
  const nextFileName = `${nextName}${ext}`;
  const nextRelative = `${path.posix.dirname(resolved.relativePath)}/${nextFileName}`;

  if (getProjectFileForRead(workflowRoot, project, nextRelative)) throw new Error(assetManagementTargetNameExists());
  const update = prepareProjectAssetReferenceMutations(
    workflowRoot,
    project,
    resolved.category,
    before,
    nextName,
    safety.references,
  );
  if (update.updatedReferences !== safety.references.length) throw new Error(assetManagementReplacementUnsupported());
  stageProjectFilesAtomically(workflowRoot, project, [
    { relativePath: nextRelative, content: fs.readFileSync(resolved.absolute) },
    { relativePath: resolved.relativePath, delete: true },
    ...update.mutations,
  ]);
  return getAssetDetail(workflowRoot, project, { ...target, relativePath: nextRelative });
}

export function deleteAsset(workflowRoot: string, project: string, target: AssetTarget): { deleted: true } {
  const resolved = resolveAssetPath(workflowRoot, project, target);
  if (!fs.existsSync(resolved.absolute)) throw new Error(assetManagementAssetMissing());
  const safety = checkAssetDeleteSafety(workflowRoot, project, {
    category: resolved.category,
    relativePath: resolved.relativePath,
    name: path.basename(resolved.absolute, path.extname(resolved.absolute)),
  });
  if (!safety.ok) throw new Error(safety.blockers.join('; '));
  stageProjectFilesAtomically(workflowRoot, project, [{ relativePath: resolved.relativePath, delete: true }]);
  return { deleted: true };
}

function resolveAssetPath(workflowRoot: string, project: string, target: AssetTarget): { absolute: string; relativePath: string; category: RmmvAssetCategory } {
  const category = requireAssetCategory(target.category);
  const relativePath = normalizeRelative(target.relativePath || defaultRelative(workflowRoot, project, category));
  const root = path.resolve(project);
  const sourceAbsolute = path.resolve(root, ...relativePath.split('/'));
  assertInside(root, sourceAbsolute);
  const absolute = getProjectFileForRead(workflowRoot, project, relativePath) || sourceAbsolute;
  const stagingRoot = path.join(path.resolve(workflowRoot), 'runtime', 'agent-console-staging');
  if (!isInside(root, absolute) && !isInside(stagingRoot, absolute)) throw new Error(assetManagementPathOutOfBounds());
  return { absolute, relativePath, category };
}

function defaultRelative(workflowRoot: string, project: string, category: string): string {
  return projectAssetRelativeDirectory(workflowRoot, project, category);
}

function isAssetStaged(workflowRoot: string, project: string, relativePath: string): boolean {
  return getProjectStagingStatus(workflowRoot, project).files
    .some((entry) => entry.relativePath === relativePath && !entry.delete);
}

function findProjectAssetReferences(workflowRoot: string, project: string, category: string, assetName: string): ManagedAssetRef[] {
  return findReferencesForAsset(workflowRoot, project, { category, name: assetName })
    .map((reference) => ({ file: reference.file, path: reference.path }));
}

function effectiveInventoryBucket(assets: RmmvProjectAsset[], category: RmmvAssetCategory, dir: string) {
  const matching = assets
    .filter((asset) => asset.category === category)
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  const files = matching.map((asset) => asset.fileName);
  const names = [...new Set(matching.map((asset) => asset.name))].sort((left, right) => left.localeCompare(right));
  return {
    dir,
    exists: matching.length > 0 || Boolean(dir && fs.existsSync(dir)),
    count: names.length,
    names,
    files,
  };
}

function mapGraphAsset(asset: RmmvProjectAsset): ProjectAssetReferenceGraphAsset {
  return {
    category: asset.category,
    name: asset.name,
    fileName: asset.fileName,
    relativePath: asset.relativePath,
    size: asset.size,
    staged: asset.staged,
  };
}

function mapGraphReference(reference: RmmvAssetReference): ProjectAssetReference {
  return {
    category: reference.category,
    name: reference.name,
    file: reference.file,
    path: reference.path,
    source: reference.source,
  };
}

function mapMissingGraphReference(reference: RmmvMissingAssetReference): ProjectMissingAssetReference {
  return {
    ...mapGraphReference(reference),
    category: reference.category,
    name: reference.name,
    expectedRelativePaths: reference.expectedRelativePaths,
  };
}

function mapReferences(references: RmmvMissingAssetReference[]): RmmvAssetReference[] {
  return references.map((reference) => ({
    category: reference.category,
    name: reference.name,
    file: reference.file,
    path: reference.path,
    source: reference.source,
  }));
}

function prepareProjectAssetReferenceMutations(
  workflowRoot: string,
  project: string,
  category: RmmvAssetCategory,
  before: string,
  after: string,
  references: RmmvAssetReference[],
): { mutations: StagedProjectFileMutation[]; updatedReferences: number; updatedFiles: string[] } {
  const refsByFile = new Map<string, RmmvAssetReference[]>();
  let updatedReferences = 0;
  const mutations: StagedProjectFileMutation[] = [];
  for (const reference of references) {
    const list = refsByFile.get(reference.file) || [];
    list.push(reference);
    refsByFile.set(reference.file, list);
  }
  for (const [relative, refs] of [...refsByFile.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const file = getProjectFileForRead(workflowRoot, project, relative);
    if (!file) throw new Error(assetManagementReplacementUnsupported());
    if (/(?:^|\/)js\/plugins\.js$/i.test(relative)) {
      const raw = fs.readFileSync(file, 'utf8');
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start < 0 || end <= start) throw new Error(assetManagementReplacementUnsupported());
      const entries = JSON.parse(raw.slice(start, end + 1)) as unknown[];
      const root = { plugins: entries };
      for (const ref of refs) {
        if (!rewriteJsonPathReference(root, ref.path, category, before, after)) {
          throw new Error(assetManagementReplacementUnsupported());
        }
        updatedReferences += 1;
      }
      const next = `${raw.slice(0, start)}${JSON.stringify(entries, null, 2)}${raw.slice(end + 1)}`;
      mutations.push({ relativePath: relative, content: Buffer.from(next, 'utf8') });
      continue;
    }
    if (!relative.toLowerCase().endsWith('.json')) throw new Error(assetManagementReplacementUnsupported());
    const value = readJson(file);
    for (const ref of refs) {
      if (!rewriteJsonPathReference(value, ref.path, category, before, after)) {
        throw new Error(assetManagementReplacementUnsupported());
      }
      updatedReferences += 1;
    }
    mutations.push({
      relativePath: relative,
      content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
    });
  }
  return {
    mutations,
    updatedReferences,
    updatedFiles: mutations.map((mutation) => mutation.relativePath),
  };
}

function rewriteJsonPathReference(
  root: unknown,
  jsonPath: string,
  category: RmmvAssetCategory,
  before: string,
  after: string,
): boolean {
  const current = getJsonPathValue(root, jsonPath);
  const replacement = rewriteAssetReferenceValue(current, category, before, after);
  if (replacement === undefined) return false;
  return setJsonPathValue(root, jsonPath, replacement);
}

function rewriteAssetReferenceValue(
  current: unknown,
  category: RmmvAssetCategory,
  before: string,
  after: string,
): string | undefined {
  if (typeof current !== 'string') return undefined;
  if (current === before) return after;
  if (category === 'plugins') return undefined;
  const separatorIndex = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
  const prefix = current.slice(0, separatorIndex + 1);
  const fileName = current.slice(separatorIndex + 1);
  const extension = path.extname(fileName);
  if (path.basename(fileName, extension) !== before) return undefined;
  return `${prefix}${after}${extension}`;
}

function getJsonPathValue(root: unknown, jsonPath: string): unknown {
  const segments = parseJsonPath(jsonPath);
  if (!segments.length) return undefined;
  let current = root as any;
  for (const segment of segments) {
    current = current?.[segment as any];
    if (current === undefined || current === null) return current;
  }
  return current;
}

function setJsonPathValue(root: unknown, jsonPath: string, value: string): boolean {
  const segments = parseJsonPath(jsonPath);
  if (!segments.length) return false;
  let current = root as any;
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = current?.[segments[index] as any];
    if (current === undefined || current === null) return false;
  }
  const key = segments[segments.length - 1] as any;
  if (current === undefined || current === null) return false;
  current[key] = value;
  return true;
}

function parseJsonPath(jsonPath: string): Array<string | number> {
  if (!jsonPath.startsWith('$')) return [];
  const segments: Array<string | number> = [];
  let index = 1;
  while (index < jsonPath.length) {
    if (jsonPath[index] === '.') {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(jsonPath.slice(index + 1));
      if (!match) return [];
      segments.push(match[0]);
      index += match[0].length + 1;
      continue;
    }
    if (jsonPath[index] === '[') {
      const close = jsonPath.indexOf(']', index);
      if (close < 0) return [];
      const token = jsonPath.slice(index + 1, close);
      if (/^\d+$/.test(token)) {
        segments.push(Number(token));
      } else if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        segments.push(JSON.parse(token.replace(/^'/, '"').replace(/'$/, '"')));
      } else {
        return [];
      }
      index = close + 1;
      continue;
    }
    return [];
  }
  return segments;
}

function normalizeAssetName(value: string): string {
  const name = value.trim();
  if (!name || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) throw new Error(assetManagementInvalidName());
  return name;
}

function normalizeImportTargetName(value: string): string {
  const name = normalizeAssetName(value);
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error(assetManagementInvalidName());
  return name;
}

function normalizeRelative(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(assetManagementInvalidPath());
  return normalized;
}

function normalizeLocalSourceFile(value: string): string {
  const source = String(value || '').trim();
  if (!source) throw new Error(assetManagementSourceRequired());
  if (!path.isAbsolute(source)) throw new Error(assetManagementSourceMustBeAbsolute());
  const absolute = path.resolve(source);
  if (!fs.existsSync(absolute)) throw new Error(assetManagementSourceMissing());
  return absolute;
}

function normalizeImportLocalAssetRequest(request: ProjectAssetImportLocalFileInput): ProjectAssetImportLocalFileInput {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error(assetManagementImportParamsMissing());
  if (typeof request.category !== 'string' || !request.category.trim()) throw new Error(assetManagementCategoryMissing());
  if (typeof request.sourceFile !== 'string' || !request.sourceFile.trim()) throw new Error(assetManagementSourceRequired());
  if (request.targetName !== undefined && typeof request.targetName !== 'string') throw new Error(assetManagementInvalidName());
  if (request.overwrite !== undefined && typeof request.overwrite !== 'boolean') throw new Error(assetManagementOverwriteMustBeBoolean());
  return {
    category: request.category,
    sourceFile: request.sourceFile,
    targetName: request.targetName,
    overwrite: request.overwrite,
  };
}

function assertProjectRelativeTarget(project: string, relativePath: string): void {
  const target = path.join(path.resolve(project), ...relativePath.split('/'));
  assertInside(path.resolve(project), target);
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(assetManagementPathOutOfBounds());
}
