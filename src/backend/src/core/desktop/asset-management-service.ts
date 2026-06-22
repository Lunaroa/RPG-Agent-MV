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
  deleteStagedProjectFile,
  getProjectFileForRead,
  getProjectStagingStatus,
  isInside,
  writeStagedProjectBuffer,
  writeStagedProjectJson,
} from './staging-service.ts';

interface AssetTarget {
  scope: ManagedAssetScope;
  category: string;
  relativePath: string;
}

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
  const update = replaceProjectAssetReferences(workflowRoot, project, category, missingName, replacementName, references);
  if (update.updatedReferences === 0) {
    throw new Error(assetManagementReplacementUnsupported());
  }
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

  const stagedEntry = getProjectStagingStatus(workflowRoot, project).files.find((entry) => entry.relativePath === targetRelative);
  const sourceTarget = path.join(path.resolve(project), ...targetRelative.split('/'));
  const targetExists = Boolean(stagedEntry) || Boolean(getProjectFileForRead(workflowRoot, project, targetRelative)) || fs.existsSync(sourceTarget);
  if (targetExists && input.overwrite !== true) {
    throw new Error(assetManagementOverwriteRequired());
  }

  writeStagedProjectBuffer(workflowRoot, project, targetRelative, fs.readFileSync(sourceFile));
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
  writeStagedProjectBuffer(workflowRoot, project, nextRelative, fs.readFileSync(resolved.absolute));
  deleteStagedProjectFile(workflowRoot, project, resolved.relativePath);
  replaceProjectAssetReferences(workflowRoot, project, resolved.category, before, nextName, safety.references);
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
  deleteStagedProjectFile(workflowRoot, project, resolved.relativePath);
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

function replaceProjectAssetReferences(
  workflowRoot: string,
  project: string,
  category: RmmvAssetCategory,
  before: string,
  after: string,
  references: RmmvAssetReference[],
): { updatedReferences: number; updatedFiles: string[] } {
  const refsByFile = new Map<string, RmmvAssetReference[]>();
  let updatedReferences = 0;
  const updatedFiles = new Set<string>();
  for (const reference of references) {
    const list = refsByFile.get(reference.file) || [];
    list.push(reference);
    refsByFile.set(reference.file, list);
  }
  for (const [relative, refs] of refsByFile.entries()) {
    if (category === 'plugins' && relative.endsWith('plugins.js')) {
      const updated = replacePluginConfigReference(workflowRoot, project, relative, before, after);
      if (updated > 0) {
        updatedReferences += updated;
        updatedFiles.add(relative);
      }
      continue;
    }
    if (!relative.endsWith('.json')) continue;
    const file = getProjectFileForRead(workflowRoot, project, relative);
    if (!file) continue;
    const value = readJson(file);
    let fileUpdated = 0;
    for (const ref of refs) {
      if (setJsonPathValue(value, ref.path, after)) fileUpdated += 1;
    }
    if (fileUpdated > 0) {
      writeStagedProjectJson(workflowRoot, project, relative, value);
      updatedReferences += fileUpdated;
      updatedFiles.add(relative);
    }
  }
  return { updatedReferences, updatedFiles: Array.from(updatedFiles).sort() };
}

function replacePluginConfigReference(workflowRoot: string, project: string, relative: string, before: string, after: string): number {
  const file = getProjectFileForRead(workflowRoot, project, relative);
  if (!file) return 0;
  const raw = fs.readFileSync(file, 'utf8');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return 0;
  const entries = JSON.parse(raw.slice(start, end + 1)) as Array<Record<string, unknown>>;
  let updated = 0;
  for (const entry of entries) {
    if (entry && entry.name === before) {
      entry.name = after;
      updated += 1;
    }
  }
  if (updated > 0) {
    const next = `${raw.slice(0, start)}${JSON.stringify(entries, null, 2)}${raw.slice(end + 1)}`;
    writeStagedProjectBuffer(workflowRoot, project, relative, Buffer.from(next, 'utf8'));
  }
  return updated;
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
