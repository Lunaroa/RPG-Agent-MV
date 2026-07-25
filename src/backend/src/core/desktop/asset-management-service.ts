import fs from 'node:fs';
import path from 'node:path';

import { projectAssetCategoryLabel } from '../../../../contract/project-asset-category-labels.ts';
import {
  parseProjectAssetBrowserNodeId,
  projectAssetBrowserNodeId,
  PROJECT_ASSET_PICTURES_CATEGORY_ID,
  projectAssetBrowserAllowsPictureSubfolders,
} from '../../../../contract/project-asset-browser-nodes.ts';
import type {
  ManagedAssetDetail,
  ManagedAssetRef,
  ManagedAssetScope,
  ProjectAssetCopyBatchInput,
  ProjectAssetCopyBatchResult,
  ProjectAssetCopyItemResult,
  ProjectAssetDeleteBatchResult,
  ProjectAssetDeleteItemResult,
  ProjectAssetDeleteTargetInput,
  ProjectAssetImportBatchResult,
  ProjectAssetImportItemInput,
  ProjectAssetImportItemResult,
  ProjectAssetImportLocalFileInput,
  ProjectAssetImportLocalFilesInput,
  ProjectAssetMutationSafetyCheck,
  ProjectAssetReference,
  ProjectAssetReferenceGraph,
  ProjectAssetReferenceGraphAsset,
  ProjectAssetReplaceMissingReferenceInput,
  ProjectAssetReplaceMissingReferenceResult,
  ProjectMissingAssetReference,
} from '../../../../contract/types.ts';
import { resolveLanguage } from '../i18n/request-language.ts';
import { buildAssetInventory } from '../rmmv/asset-inventory.ts';
import { readJson } from '../rmmv/json.ts';
import type { ProjectReadIssue } from '../rmmv/project-scanner.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { projectAssetUrl } from './asset-service.ts';
import { invalidateProjectAssetBrowserCache, invalidateProjectAssetListingCache } from './project-asset-browser-service.ts';
import {
  assetManagementAssetMissing,
  assetManagementCategoryMissing,
  assetManagementDeletePartialFailure,
  assetManagementImportBatchEmpty,
  assetManagementImportDuplicateTarget,
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
  assetManagementSubfolderMissing,
  assetManagementSubfolderNameOccupied,
  assetManagementSubfolderUnsupported,
  assetManagementTargetNameExists,
  assetManagementTrashFailed,
  assetManagementTrashPortMissing,
  unsupportedAssetCategory,
  unsupportedAssetExtension,
} from './assetManagementLocalization.ts';
import {
  applyProjectAssetReferenceGraphDelete,
  applyProjectAssetReferenceGraphRename,
} from './project-asset-reference-graph-cache.ts';
import { invalidateProjectAssetReferenceGraphCache } from './project-asset-reference-graph-cache-store.ts';
import {
  buildAssetReferenceGraph,
  getProjectAssetReferenceGraph,
  putProjectAssetReferenceGraph,
  checkAssetDeleteSafetyAgainstGraph,
  checkAssetRenameSafety,
  findLogicalAssetVariants,
  findReferencesForAsset,
  projectAssetRelativeDirectory,
  requireAssetCategory,
  RMMV_ASSET_CATEGORIES,
  type RmmvAssetReference,
  type RmmvMissingAssetReference,
  type RmmvProjectAsset,
  type RmmvAssetCategory,
  type ProjectAssetReferenceGraphBuildDependencies,
} from './asset-reference-graph-service.ts';
import {
  applyProjectFilesAtomically,
  findProjectStagingPathConflict,
  getProjectFileForRead,
  getProjectStagingStatus,
  isInside,
  stageProjectFilesAtomically,
  type StagedProjectFileMutation,
} from './staging-service.ts';
import {
  stagingChangedDuringAssetDelete,
  stagingOperationReservationBlocksAssetMutation,
  stagingUnappliedDraftBlocksAssetMutation,
} from './stagingServiceLocalization.ts';

interface AssetTarget {
  scope: ManagedAssetScope;
  category: string;
  relativePath: string;
  name?: string;
}

export interface ProjectAssetTrashPort {
  trashItem(absolutePath: string): Promise<void>;
}

export interface ProjectAssetDeleteDependencies {
  trashItem: (absolutePath: string) => Promise<void>;
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
  const name = assetNameFromRelative(workflowRoot, project, resolved.category, resolved.relativePath);
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
    inventory.audio[category] = effectiveInventoryBucketFromGraph(
      graph.assets,
      category,
      inventory.audio[category]?.dir || '',
    );
  }
  for (const [bucket, category] of Object.entries(INVENTORY_IMAGE_CATEGORIES)) {
    inventory.images[bucket] = effectiveInventoryBucketFromGraph(
      graph.assets,
      category as RmmvAssetCategory,
      inventory.images[bucket]?.dir || '',
    );
  }
  inventory.effects = effectiveInventoryBucketFromGraph(graph.assets, 'effects', inventory.effects?.dir || '');
  return refreshAssetInventorySummary(inventory);
}

function buildReadOnlyStagedAwareAssetInventory(
  workflowRoot: string,
  project: string,
  options: { tolerateAnimationReadFailure?: boolean } = {},
) {
  const inventory = buildAssetInventory(project, options);
  const stagedFiles = getProjectStagingStatus(workflowRoot, project).files;
  for (const category of INVENTORY_AUDIO_CATEGORIES) {
    inventory.audio[category] = effectiveInventoryBucketFromStaging(
      workflowRoot,
      project,
      category,
      inventory.audio[category],
      stagedFiles,
    );
  }
  for (const [bucket, category] of Object.entries(INVENTORY_IMAGE_CATEGORIES)) {
    inventory.images[bucket] = effectiveInventoryBucketFromStaging(
      workflowRoot,
      project,
      category as RmmvAssetCategory,
      inventory.images[bucket],
      stagedFiles,
    );
  }
  inventory.effects = effectiveInventoryBucketFromStaging(
    workflowRoot,
    project,
    'effects',
    inventory.effects,
    stagedFiles,
  );
  return refreshAssetInventorySummary(inventory);
}

function refreshAssetInventorySummary(inventory: ReturnType<typeof buildAssetInventory>) {
  inventory.summary.audio = Object.fromEntries(INVENTORY_AUDIO_CATEGORIES.map((category) => [category, {
    exists: inventory.audio[category].exists,
    count: inventory.audio[category].count,
  }]));
  inventory.summary.images = Object.fromEntries(Object.keys(INVENTORY_IMAGE_CATEGORIES).map((bucket) => [bucket, {
    exists: inventory.images[bucket].exists,
    count: inventory.images[bucket].count,
  }]));
  inventory.summary.effects = { exists: inventory.effects.exists, count: inventory.effects.count };
  const animationSheets = new Set(inventory.images.animations.names);
  inventory.animations = inventory.animations.map((animation) => ({
    ...animation,
    missingSheets: [animation.animation1Name, animation.animation2Name]
      .filter(Boolean)
      .filter((name) => !animationSheets.has(name)),
    missingEffects: animation.effectName && !inventory.effects.names.includes(animation.effectName)
      ? [animation.effectName]
      : [],
  }));
  inventory.summary.animations = {
    total: inventory.animations.length,
    named: inventory.animations.filter((animation) => animation.name).length,
    withMissingSheets: inventory.animations.filter((animation) => animation.missingSheets.length > 0).length,
    withMissingEffects: inventory.animations.filter((animation) => animation.missingEffects.length > 0).length,
  };
  return inventory;
}

export function buildProjectManagementAssetInventory(
  workflowRoot: string,
  project: string,
): { assets: ReturnType<typeof buildStagedAwareAssetInventory> | null; readIssues: ProjectReadIssue[] } {
  try {
    return {
      assets: buildReadOnlyStagedAwareAssetInventory(workflowRoot, project, { tolerateAnimationReadFailure: true }),
      readIssues: [],
    };
  } catch (error) {
    const manifest = inspectRmmvProject(project);
    return {
      assets: null,
      readIssues: [{
        scope: 'assets',
        relativePath: projectRelativeErrorPath(project, error)
          || `${manifest.dataRootRelative}/Animations.json`,
        code: error instanceof SyntaxError ? 'invalid-structure' : 'read-failed',
        message: safeAssetInventoryError(error),
      }],
    };
  }
}

export function buildProjectAssetReferenceGraph(workflowRoot: string, project: string): ProjectAssetReferenceGraph {
  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
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
  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const result = checkAssetDeleteSafetyAgainstGraph(graph, target);
  return {
    ok: result.ok,
    action: result.action,
    target: result.target,
    references: result.references.map(mapGraphReference),
    blockers: result.blockers,
  };
}

export function checkProjectAssetDeleteSafetyBatch(
  workflowRoot: string,
  project: string,
  targets: readonly ProjectAssetDeleteTargetInput[],
  dependencies: ProjectAssetReferenceGraphBuildDependencies = {},
): ProjectAssetMutationSafetyCheck[] {
  const graph = getProjectAssetReferenceGraph(workflowRoot, project, dependencies);
  return targets.map((target) => {
    const result = checkAssetDeleteSafetyAgainstGraph(graph, target);
    return {
      ok: result.ok,
      action: result.action,
      target: result.target,
      references: result.references.map(mapGraphReference),
      blockers: result.blockers,
    };
  });
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
  invalidateProjectAssetBrowserCache(project);
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
  const batch = importLocalAssetFiles(workflowRoot, project, {
    category: input.category,
    files: [{
      sourceFile: input.sourceFile,
      targetName: input.targetName,
      overwrite: input.overwrite,
    }],
  });
  const item = batch.results[0];
  if (!item) throw new Error(assetManagementImportParamsMissing());
  if (item.status === 'imported' && item.detail) return item.detail;
  throw new Error(item.error || assetManagementImportParamsMissing());
}

export function importLocalAssetFiles(
  workflowRoot: string,
  project: string,
  request: ProjectAssetImportLocalFilesInput,
): ProjectAssetImportBatchResult {
  const input = normalizeImportLocalAssetFilesRequest(request);
  const { categoryId, subpath } = parseProjectAssetBrowserNodeId(input.category);
  if (subpath) {
    const engine = inspectRmmvProject(project).engine;
    if (
      categoryId !== PROJECT_ASSET_PICTURES_CATEGORY_ID
      || !projectAssetBrowserAllowsPictureSubfolders(engine)
    ) {
      throw new Error(
        `Project asset import into subfolders is only supported for MZ pictures; got: ${input.category}`,
      );
    }
  }
  const category = requireAssetCategory(categoryId);
  const definition = RMMV_ASSET_CATEGORIES.find((item) => item.id === category);
  if (!definition) throw new Error(unsupportedAssetCategory(input.category));

  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const results: ProjectAssetImportItemResult[] = [];
  const pending: Array<{
    sourceFile: string;
    targetName: string;
    targetRelative: string;
    mutations: StagedProjectFileMutation[];
  }> = [];
  const claimedNames = new Set<string>();

  for (const file of input.files) {
    const prepared = prepareImportLocalAssetItem(
      workflowRoot,
      project,
      category,
      definition.extensions,
      graph,
      file,
      claimedNames,
      subpath,
    );
    if (prepared.status !== 'ready') {
      results.push({
        sourceFile: prepared.sourceFile,
        targetName: prepared.targetName,
        relativePath: prepared.relativePath,
        status: prepared.status,
        error: prepared.error,
      });
      continue;
    }
    claimedNames.add(prepared.targetName);
    pending.push({
      sourceFile: prepared.sourceFile,
      targetName: prepared.targetName,
      targetRelative: prepared.targetRelative,
      mutations: prepared.mutations,
    });
    results.push({
      sourceFile: prepared.sourceFile,
      targetName: prepared.targetName,
      relativePath: prepared.targetRelative,
      status: 'imported',
    });
  }

  if (pending.length) {
    try {
      const mutations = pending.flatMap((item) => item.mutations);
      applyProjectFilesAtomically(workflowRoot, project, mutations);
      invalidateProjectAssetBrowserCache(project);
      for (const item of results) {
        if (item.status !== 'imported' || !item.relativePath) continue;
        item.detail = getAssetDetail(workflowRoot, project, {
          scope: 'project',
          category,
          relativePath: item.relativePath,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of results) {
        if (item.status !== 'imported') continue;
        item.status = 'failed';
        item.error = message;
        delete item.detail;
      }
    }
  }

  return { results };
}

type PreparedImportItem =
  | {
    status: 'ready';
    sourceFile: string;
    targetName: string;
    targetRelative: string;
    mutations: StagedProjectFileMutation[];
  }
  | {
    status: 'skipped' | 'failed';
    sourceFile: string;
    targetName: string | null;
    relativePath: string | null;
    error: string;
  };

function prepareImportLocalAssetItem(
  workflowRoot: string,
  project: string,
  category: RmmvAssetCategory,
  allowedExtensions: readonly string[],
  graph: ProjectAssetReferenceGraph,
  file: ProjectAssetImportItemInput,
  claimedNames: ReadonlySet<string>,
  subpath = '',
): PreparedImportItem {
  const sourceFileRaw = String(file.sourceFile || '');
  let sourceFile: string;
  try {
    sourceFile = normalizeLocalSourceFile(sourceFileRaw);
  } catch (error) {
    return {
      status: 'failed',
      sourceFile: sourceFileRaw,
      targetName: null,
      relativePath: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const stat = fs.statSync(sourceFile);
    if (!stat.isFile()) {
      return {
        status: 'failed',
        sourceFile,
        targetName: null,
        relativePath: null,
        error: assetManagementSourceNotFile(),
      };
    }
  } catch (error) {
    return {
      status: 'failed',
      sourceFile,
      targetName: null,
      relativePath: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const sourceFileName = path.basename(sourceFile);
  const sourceExtension = path.extname(sourceFileName);
  const sourceExtensionLower = sourceExtension.toLowerCase();
  if (!allowedExtensions.includes(sourceExtensionLower)) {
    return {
      status: 'failed',
      sourceFile,
      targetName: null,
      relativePath: null,
      error: unsupportedAssetExtension(
        projectAssetCategoryLabel(category, resolveLanguage()),
        sourceExtension,
        allowedExtensions,
      ),
    };
  }

  let targetName: string;
  try {
    const rawBase = file.targetName === undefined || String(file.targetName).trim() === ''
      ? path.basename(sourceFileName, sourceExtension)
      : String(file.targetName);
    const leafName = rawBase.replace(/\\/g, '/').split('/').filter(Boolean).pop() || rawBase;
    const cleanSubpath = subpath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    targetName = cleanSubpath
      ? normalizeImportTargetName(`${cleanSubpath}/${leafName}`)
      : normalizeImportTargetName(leafName);
  } catch (error) {
    return {
      status: 'failed',
      sourceFile,
      targetName: null,
      relativePath: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (claimedNames.has(targetName)) {
    return {
      status: 'failed',
      sourceFile,
      targetName,
      relativePath: null,
      error: assetManagementImportDuplicateTarget(targetName),
    };
  }

  const targetRelative = `${projectAssetRelativeDirectory(workflowRoot, project, category)}/${targetName}${sourceExtension}`;
  try {
    assertProjectRelativeTarget(project, targetRelative);
  } catch (error) {
    return {
      status: 'failed',
      sourceFile,
      targetName,
      relativePath: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const occupied = graph.assets.filter((asset) => asset.category === category && asset.name === targetName);
  if (occupied.length > 1) {
    return {
      status: 'failed',
      sourceFile,
      targetName,
      relativePath: targetRelative,
      error: assetManagementTargetNameExists(),
    };
  }
  if (occupied.length === 1 && file.overwrite !== true) {
    return {
      status: 'skipped',
      sourceFile,
      targetName,
      relativePath: targetRelative,
      error: assetManagementOverwriteRequired(),
    };
  }

  const candidateRelativePaths = [
    targetRelative,
    ...(occupied[0] && occupied[0].relativePath !== targetRelative ? [occupied[0].relativePath] : []),
  ];
  const stagedConflict = findProjectStagingPathConflict(workflowRoot, project, candidateRelativePaths);
  if (stagedConflict?.kind === 'draft') {
    return {
      status: 'failed',
      sourceFile,
      targetName,
      relativePath: targetRelative,
      error: stagingUnappliedDraftBlocksAssetMutation(stagedConflict.relativePath),
    };
  }
  if (stagedConflict?.kind === 'operation') {
    return {
      status: 'failed',
      sourceFile,
      targetName,
      relativePath: targetRelative,
      error: stagingOperationReservationBlocksAssetMutation(
        stagedConflict.relativePath,
        stagedConflict.operationId,
      ),
    };
  }

  const mutations: StagedProjectFileMutation[] = [{
    relativePath: targetRelative,
    content: fs.readFileSync(sourceFile),
  }];
  if (occupied[0] && occupied[0].relativePath !== targetRelative) {
    mutations.push({ relativePath: occupied[0].relativePath, delete: true });
  }

  return {
    status: 'ready',
    sourceFile,
    targetName,
    targetRelative,
    mutations,
  };
}

export function renameAsset(
  workflowRoot: string,
  project: string,
  target: AssetTarget,
  nextNameValue: string,
): ManagedAssetDetail {
  const nextName = normalizeAssetName(nextNameValue);
  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const category = requireAssetCategory(target.category);
  const before = target.name?.trim()
    ? normalizeAssetName(target.name)
    : assetNameFromRelative(
      workflowRoot,
      project,
      category,
      normalizeRelative(target.relativePath || defaultRelative(workflowRoot, project, category)),
    );
  const variants = findLogicalAssetVariants(graph, category, before, target.relativePath);
  if (!variants.length) throw new Error(assetManagementAssetMissing());

  const safety = checkAssetRenameSafety(workflowRoot, project, {
    category,
    relativePath: variants[0]!.relativePath,
    name: before,
  }, nextName);
  if (!safety.ok) throw new Error(safety.blockers.join('; '));

  const relativeDir = projectAssetRelativeDirectory(workflowRoot, project, category);
  const renamePairs = variants.map((variant) => {
    const extension = path.extname(variant.fileName);
    const nextRelative = `${relativeDir}/${nextName}${extension}`;
    const sourceAbsolute = path.resolve(project, ...variant.relativePath.split('/'));
    assertInside(path.resolve(project), sourceAbsolute);
    if (!fs.existsSync(sourceAbsolute)) throw new Error(assetManagementAssetMissing());
    return {
      beforeRelative: variant.relativePath,
      nextRelative,
      sourceAbsolute,
    };
  });
  for (const pair of renamePairs) {
    if (getProjectFileForRead(workflowRoot, project, pair.nextRelative)) {
      throw new Error(assetManagementTargetNameExists());
    }
  }

  const update = prepareProjectAssetReferenceMutations(
    workflowRoot,
    project,
    category,
    before,
    nextName,
    safety.references,
  );
  if (update.updatedReferences !== safety.references.length) {
    throw new Error(assetManagementReplacementUnsupported());
  }

  const mutations: StagedProjectFileMutation[] = [
    ...renamePairs.flatMap((pair) => ([
      { relativePath: pair.nextRelative, content: fs.readFileSync(pair.sourceAbsolute) },
      { relativePath: pair.beforeRelative, delete: true as const },
    ])),
    ...update.mutations,
  ];
  applyProjectFilesAtomically(workflowRoot, project, mutations);

  const nextGraph = applyProjectAssetReferenceGraphRename(
    graph,
    category,
    before,
    nextName,
    safety.references,
  );
  if (nextGraph) putProjectAssetReferenceGraph(project, nextGraph);
  else invalidateProjectAssetReferenceGraphCache(project);
  invalidateProjectAssetListingCache(project);

  return getAssetDetail(workflowRoot, project, {
    ...target,
    relativePath: renamePairs[0]!.nextRelative,
  });
}

export interface ProjectAssetSubfolderMutationResult {
  previousNodeId: string;
  nextNodeId: string;
  directory: string;
}

function requireUserPictureSubfolder(project: string, nodeId: string): { subpath: string } {
  const { categoryId, subpath } = parseProjectAssetBrowserNodeId(nodeId);
  if (
    categoryId !== PROJECT_ASSET_PICTURES_CATEGORY_ID
    || !subpath
    || !projectAssetBrowserAllowsPictureSubfolders(inspectRmmvProject(project).engine)
  ) {
    throw new Error(assetManagementSubfolderUnsupported(nodeId));
  }
  return { subpath };
}

function normalizeFolderLeafName(value: string): string {
  const name = String(value || '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(assetManagementInvalidName());
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
    throw new Error(assetManagementInvalidName());
  }
  return name;
}

/**
 * Rename an MZ pictures disk subfolder (e.g. pictures/ui → pictures/hud).
 * Rewrites nested logical asset names and references via renameAsset.
 */
export function renameProjectAssetSubfolder(
  workflowRoot: string,
  project: string,
  nodeId: string,
  nextFolderNameValue: string,
): ProjectAssetSubfolderMutationResult {
  const { subpath } = requireUserPictureSubfolder(project, nodeId);
  const segments = subpath.split('/').filter(Boolean);
  const leaf = segments[segments.length - 1]!;
  const parentSubpath = segments.slice(0, -1).join('/');
  const nextLeaf = normalizeFolderLeafName(nextFolderNameValue);
  const nextSubpath = parentSubpath ? `${parentSubpath}/${nextLeaf}` : nextLeaf;
  const nextNodeId = projectAssetBrowserNodeId(PROJECT_ASSET_PICTURES_CATEGORY_ID, nextSubpath);
  const relativeRoot = projectAssetRelativeDirectory(workflowRoot, project, PROJECT_ASSET_PICTURES_CATEGORY_ID);
  const oldDirectory = `${relativeRoot}/${subpath}`;
  const newDirectory = `${relativeRoot}/${nextSubpath}`;
  const projectRoot = path.resolve(project);
  const oldAbsolute = path.resolve(projectRoot, ...oldDirectory.split('/'));
  const newAbsolute = path.resolve(projectRoot, ...newDirectory.split('/'));
  assertInside(projectRoot, oldAbsolute);
  assertInside(projectRoot, newAbsolute);

  if (nextLeaf === leaf) {
    return { previousNodeId: nodeId, nextNodeId: nodeId, directory: oldDirectory };
  }
  if (fs.existsSync(newAbsolute)) {
    throw new Error(assetManagementSubfolderNameOccupied(nextLeaf));
  }

  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const prefix = `${subpath}/`;
  const nested = graph.assets
    .filter((asset) => asset.category === PROJECT_ASSET_PICTURES_CATEGORY_ID && asset.name.startsWith(prefix))
    .sort((left, right) => right.name.length - left.name.length);

  for (const asset of nested) {
    const rest = asset.name.slice(prefix.length);
    const nextName = `${nextSubpath}/${rest}`;
    renameAsset(workflowRoot, project, {
      scope: 'project',
      category: PROJECT_ASSET_PICTURES_CATEGORY_ID,
      relativePath: asset.relativePath,
      name: asset.name,
    }, nextName);
  }

  if (fs.existsSync(oldAbsolute)) {
    if (fs.existsSync(newAbsolute)) {
      fs.rmSync(oldAbsolute, { recursive: true, force: true });
    } else {
      fs.mkdirSync(path.dirname(newAbsolute), { recursive: true });
      fs.renameSync(oldAbsolute, newAbsolute);
    }
  } else if (nested.length === 0) {
    throw new Error(assetManagementSubfolderMissing(oldDirectory));
  }

  invalidateProjectAssetBrowserCache(project);
  invalidateProjectAssetListingCache(project);
  invalidateProjectAssetReferenceGraphCache(project);
  return { previousNodeId: nodeId, nextNodeId, directory: newDirectory };
}

/**
 * Delete an MZ pictures disk subfolder and all nested picture assets (via trash).
 * Without `force`, referenced assets block the whole folder — nothing is deleted
 * and the blocked items are returned so the UI can ask for confirmation.
 */
export async function deleteProjectAssetSubfolder(
  workflowRoot: string,
  project: string,
  nodeId: string,
  options: { force?: boolean } = {},
  dependencies?: ProjectAssetDeleteDependencies,
): Promise<ProjectAssetDeleteBatchResult> {
  const { subpath } = requireUserPictureSubfolder(project, nodeId);
  const relativeRoot = projectAssetRelativeDirectory(workflowRoot, project, PROJECT_ASSET_PICTURES_CATEGORY_ID);
  const directory = `${relativeRoot}/${subpath}`;
  const projectRoot = path.resolve(project);
  const absolute = path.resolve(projectRoot, ...directory.split('/'));
  assertInside(projectRoot, absolute);

  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const prefix = `${subpath}/`;
  const nested = graph.assets.filter(
    (asset) => asset.category === PROJECT_ASSET_PICTURES_CATEGORY_ID && asset.name.startsWith(prefix),
  );
  const targets: ProjectAssetDeleteTargetInput[] = nested.map((asset) => ({
    category: PROJECT_ASSET_PICTURES_CATEGORY_ID,
    name: asset.name,
    relativePath: asset.relativePath,
  }));

  let batch: ProjectAssetDeleteBatchResult = { results: [] };
  if (targets.length) {
    if (!options.force) {
      // All-or-nothing: surface every blocked asset before touching the disk.
      const safety = checkProjectAssetDeleteSafetyBatch(workflowRoot, project, targets);
      const blocked = safety.filter((item) => !item.ok);
      if (blocked.length) {
        return {
          results: blocked.map((item) => ({
            target: item.target,
            status: 'blocked' as const,
            references: item.references,
            error: item.blockers.join('; '),
          })),
        };
      }
    }
    batch = await deleteProjectAssets(workflowRoot, project, targets, options, dependencies);
    const failed = batch.results.filter((item) => item.status !== 'deleted');
    if (failed.length) return batch;
  }

  if (fs.existsSync(absolute)) {
    const trashItem = dependencies?.trashItem;
    if (!trashItem) throw new Error(assetManagementTrashPortMissing());
    try {
      await trashItem(absolute);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(assetManagementTrashFailed(directory, reason));
    }
  } else if (targets.length === 0) {
    throw new Error(assetManagementSubfolderMissing(directory));
  }

  invalidateProjectAssetBrowserCache(project);
  invalidateProjectAssetListingCache(project);
  invalidateProjectAssetReferenceGraphCache(project);
  return batch;
}

export async function deleteProjectAssets(
  workflowRoot: string,
  project: string,
  targets: readonly ProjectAssetDeleteTargetInput[],
  options: { force?: boolean } = {},
  dependencies?: ProjectAssetDeleteDependencies,
): Promise<ProjectAssetDeleteBatchResult> {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(assetManagementMissingParams());
  }
  const trashItem = dependencies?.trashItem;
  if (!trashItem) throw new Error(assetManagementTrashPortMissing());

  const force = options.force === true;
  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const results: ProjectAssetDeleteItemResult[] = [];
  const deletedLogical: Array<{ category: RmmvAssetCategory; name: string }> = [];
  const allDeletedRelativePaths: string[] = [];

  for (const target of targets) {
    const category = requireAssetCategory(target.category);
    const earlyRelativePaths = target.relativePath ? [normalizeRelative(target.relativePath)] : [];
    if (earlyRelativePaths.length) {
      const earlyConflict = findProjectStagingPathConflict(workflowRoot, project, earlyRelativePaths);
      if (earlyConflict?.kind === 'draft') {
        results.push({
          target: { category, name: String(target.name || ''), relativePath: target.relativePath || null },
          status: 'failed',
          references: [],
          error: stagingUnappliedDraftBlocksAssetMutation(earlyConflict.relativePath),
        });
        continue;
      }
      if (earlyConflict?.kind === 'operation') {
        results.push({
          target: { category, name: String(target.name || ''), relativePath: target.relativePath || null },
          status: 'failed',
          references: [],
          error: stagingOperationReservationBlocksAssetMutation(
            earlyConflict.relativePath,
            earlyConflict.operationId,
          ),
        });
        continue;
      }
    }

    let name: string;
    try {
      name = target.name?.trim()
        ? normalizeAssetName(target.name)
        : assetNameFromRelative(
          workflowRoot,
          project,
          category,
          normalizeRelative(target.relativePath || defaultRelative(workflowRoot, project, category)),
        );
    } catch (error) {
      results.push({
        target: { category, name: String(target.name || ''), relativePath: target.relativePath || null },
        status: 'failed',
        references: [],
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const safety = checkAssetDeleteSafetyAgainstGraph(graph, { category, name, relativePath: target.relativePath });
    const mappedReferences = safety.references.map(mapGraphReference);
    const variants = findLogicalAssetVariants(graph, category, name, target.relativePath);
    const candidateRelativePaths = [
      ...variants.map((variant) => variant.relativePath),
      ...(target.relativePath ? [normalizeRelative(target.relativePath)] : []),
    ];
    const stagedConflict = findProjectStagingPathConflict(workflowRoot, project, candidateRelativePaths);
    if (stagedConflict?.kind === 'draft') {
      results.push({
        target: safety.target,
        status: 'failed',
        references: mappedReferences,
        error: stagingUnappliedDraftBlocksAssetMutation(stagedConflict.relativePath),
      });
      continue;
    }
    if (stagedConflict?.kind === 'operation') {
      results.push({
        target: safety.target,
        status: 'failed',
        references: mappedReferences,
        error: stagingOperationReservationBlocksAssetMutation(
          stagedConflict.relativePath,
          stagedConflict.operationId,
        ),
      });
      continue;
    }

    if (!force && safety.references.length) {
      results.push({
        target: safety.target,
        status: 'blocked',
        references: mappedReferences,
        error: safety.blockers.join('; '),
      });
      continue;
    }

    if (!variants.length) {
      results.push({
        target: safety.target,
        status: 'failed',
        references: mappedReferences,
        error: assetManagementAssetMissing(),
      });
      continue;
    }

    const deletedRelativePaths: string[] = [];
    const failedParts: string[] = [];
    for (const variant of variants) {
      const absolute = path.resolve(project, ...variant.relativePath.split('/'));
      assertInside(path.resolve(project), absolute);
      if (!fs.existsSync(absolute)) {
        failedParts.push(`${variant.relativePath}: ${assetManagementAssetMissing()}`);
        continue;
      }
      try {
        await trashItem(absolute);
        if (fs.existsSync(absolute)) {
          failedParts.push(assetManagementTrashFailed(
            variant.relativePath,
            'trash port returned without removing the source file',
          ));
          continue;
        }
        deletedRelativePaths.push(variant.relativePath);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failedParts.push(assetManagementTrashFailed(variant.relativePath, reason));
      }
    }

    allDeletedRelativePaths.push(...deletedRelativePaths);

    if (failedParts.length) {
      results.push({
        target: safety.target,
        status: 'failed',
        references: mappedReferences,
        deletedRelativePaths,
        error: deletedRelativePaths.length
          ? assetManagementDeletePartialFailure(deletedRelativePaths, failedParts)
          : failedParts.join('; '),
      });
      if (deletedRelativePaths.length) deletedLogical.push({ category, name });
      continue;
    }

    results.push({
      target: safety.target,
      status: 'deleted',
      references: mappedReferences,
      deletedRelativePaths,
    });
    deletedLogical.push({ category, name });
  }

  if (allDeletedRelativePaths.length) {
    const raced = findProjectStagingPathConflict(workflowRoot, project, allDeletedRelativePaths);
    if (raced) {
      invalidateProjectAssetReferenceGraphCache(project);
      invalidateProjectAssetListingCache(project);
      throw new Error(stagingChangedDuringAssetDelete(allDeletedRelativePaths));
    }
  }

  let nextGraph = graph;
  let cacheValid = true;
  for (const item of deletedLogical) {
    const updated = applyProjectAssetReferenceGraphDelete(nextGraph, item.category, item.name);
    if (!updated) {
      cacheValid = false;
      break;
    }
    nextGraph = updated;
  }
  if (cacheValid && deletedLogical.length) putProjectAssetReferenceGraph(project, nextGraph);
  else if (deletedLogical.length) invalidateProjectAssetReferenceGraphCache(project);
  if (deletedLogical.length) invalidateProjectAssetListingCache(project);

  return { results };
}

/** Single-target throw wrapper; production IPC uses deleteProjectAssets batch results. */
export async function deleteAsset(
  workflowRoot: string,
  project: string,
  target: AssetTarget,
  options: { force?: boolean } = {},
  dependencies?: ProjectAssetDeleteDependencies,
): Promise<{ deleted: true }> {
  const batch = await deleteProjectAssets(workflowRoot, project, [target], options, dependencies);
  const result = batch.results[0];
  if (!result) throw new Error(assetManagementMissingParams());
  if (result.status === 'blocked') throw new Error(result.error || 'blocked');
  if (result.status === 'failed') throw new Error(result.error || assetManagementAssetMissing());
  return { deleted: true };
}

/**
 * Copy logical assets (all variants) inside the library, or into another category
 * when request.targetCategory is set. Copies are named "name_2" style and applied
 * immediately through one scoped atomic apply, mirroring import's batch structure.
 */
export function copyProjectAssets(
  workflowRoot: string,
  project: string,
  request: ProjectAssetCopyBatchInput,
): ProjectAssetCopyBatchResult {
  if (!request || !Array.isArray(request.targets) || request.targets.length === 0) {
    throw new Error(assetManagementMissingParams());
  }
  const requestedTarget = request.targetCategory === undefined || request.targetCategory === null
    ? null
    : parseProjectAssetBrowserNodeId(request.targetCategory);
  if (requestedTarget?.subpath) {
    const engine = inspectRmmvProject(project).engine;
    if (
      requestedTarget.categoryId !== PROJECT_ASSET_PICTURES_CATEGORY_ID
      || !projectAssetBrowserAllowsPictureSubfolders(engine)
    ) {
      throw new Error(
        `Project asset copy into subfolders is only supported for MZ pictures; got: ${request.targetCategory}`,
      );
    }
  }
  const requestedTargetCategory = requestedTarget
    ? requireAssetCategory(requestedTarget.categoryId)
    : null;
  const targetSubpath = requestedTarget?.subpath ?? '';
  const graph = getProjectAssetReferenceGraph(workflowRoot, project);
  const results: ProjectAssetCopyItemResult[] = [];
  const pending: Array<{
    result: ProjectAssetCopyItemResult;
    category: RmmvAssetCategory;
    copiedRelativePaths: string[];
    mutations: StagedProjectFileMutation[];
  }> = [];
  const claimedNames = new Set<string>();

  for (const rawTarget of request.targets) {
    const sourceCategory = requireAssetCategory(rawTarget.category);
    const category = requestedTargetCategory ?? sourceCategory;
    const failWith = (error: string, name = String(rawTarget.name || '')): void => {
      results.push({
        target: { category: sourceCategory, name, relativePath: rawTarget.relativePath || null },
        status: 'failed',
        error,
      });
    };

    let name: string;
    try {
      name = rawTarget.name?.trim()
        ? normalizeAssetName(rawTarget.name)
        : assetNameFromRelative(
          workflowRoot,
          project,
          sourceCategory,
          normalizeRelative(rawTarget.relativePath || defaultRelative(workflowRoot, project, sourceCategory)),
        );
    } catch (error) {
      failWith(error instanceof Error ? error.message : String(error));
      continue;
    }

    const variants = findLogicalAssetVariants(graph, sourceCategory, name, rawTarget.relativePath);
    if (!variants.length) {
      failWith(assetManagementAssetMissing(), name);
      continue;
    }

    const leafName = name.includes('/') ? name.split('/').pop()! : name;
    const copyBaseName = targetSubpath ? `${targetSubpath}/${leafName}` : name;
    const copiedName = nextAvailableCopyName(graph, category, copyBaseName, claimedNames);
    const directory = projectAssetRelativeDirectory(workflowRoot, project, category);
    const copiedRelativePaths = variants.map(
      (variant) => `${directory}/${copiedName}${path.extname(variant.relativePath)}`,
    );
    try {
      for (const relativePath of copiedRelativePaths) assertProjectRelativeTarget(project, relativePath);
    } catch (error) {
      failWith(error instanceof Error ? error.message : String(error), name);
      continue;
    }

    const stagedConflict = findProjectStagingPathConflict(workflowRoot, project, [
      ...variants.map((variant) => variant.relativePath),
      ...copiedRelativePaths,
    ]);
    if (stagedConflict?.kind === 'draft') {
      failWith(stagingUnappliedDraftBlocksAssetMutation(stagedConflict.relativePath), name);
      continue;
    }
    if (stagedConflict?.kind === 'operation') {
      failWith(
        stagingOperationReservationBlocksAssetMutation(stagedConflict.relativePath, stagedConflict.operationId),
        name,
      );
      continue;
    }

    const mutations: StagedProjectFileMutation[] = [];
    let readError: string | null = null;
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index]!;
      const absolute = path.resolve(project, ...variant.relativePath.split('/'));
      try {
        assertInside(path.resolve(project), absolute);
        mutations.push({ relativePath: copiedRelativePaths[index]!, content: fs.readFileSync(absolute) });
      } catch (error) {
        readError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    if (readError) {
      failWith(readError, name);
      continue;
    }

    claimedNames.add(copiedName);
    const result: ProjectAssetCopyItemResult = {
      target: { category: sourceCategory, name, relativePath: rawTarget.relativePath || null },
      status: 'copied',
      copiedName,
      copiedRelativePaths,
    };
    results.push(result);
    pending.push({ result, category, copiedRelativePaths, mutations });
  }

  if (pending.length) {
    try {
      applyProjectFilesAtomically(workflowRoot, project, pending.flatMap((item) => item.mutations));
      invalidateProjectAssetBrowserCache(project);
      invalidateProjectAssetReferenceGraphCache(project);
      for (const item of pending) {
        item.result.detail = getAssetDetail(workflowRoot, project, {
          scope: 'project',
          category: item.category,
          relativePath: item.copiedRelativePaths[0],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of pending) {
        item.result.status = 'failed';
        item.result.error = message;
        delete item.result.detail;
      }
    }
  }

  return { results };
}

/** First free "name_2"-style copy name inside the target category (graph assets + intra-batch claims). */
function nextAvailableCopyName(
  graph: ProjectAssetReferenceGraph,
  category: RmmvAssetCategory,
  baseName: string,
  claimedNames: ReadonlySet<string>,
): string {
  const isTaken = (candidate: string): boolean =>
    claimedNames.has(candidate)
    || graph.assets.some((asset) => asset.category === category && asset.name === candidate);
  let suffix = 2;
  let candidate = `${baseName}_${suffix}`;
  while (isTaken(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }
  return candidate;
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

function effectiveInventoryBucketFromGraph(assets: RmmvProjectAsset[], category: RmmvAssetCategory, dir: string) {
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

function effectiveInventoryBucketFromStaging(
  workflowRoot: string,
  project: string,
  category: RmmvAssetCategory,
  source: { dir: string; exists: boolean; files: string[] },
  stagedFiles: Array<{ relativePath: string; delete?: boolean }>,
) {
  const definition = RMMV_ASSET_CATEGORIES.find((item) => item.id === category);
  if (!definition) throw new Error(unsupportedAssetCategory(category));
  const relativeDir = projectAssetRelativeDirectory(workflowRoot, project, category);
  const relativePrefix = `${relativeDir}/`;
  const extensions = new Set(definition.extensions.map((extension) => extension.toLowerCase()));
  const effectiveFiles = new Set(source.files);
  for (const staged of stagedFiles) {
    const normalized = staged.relativePath.replace(/\\/g, '/');
    if (!normalized.startsWith(relativePrefix)) continue;
    const fileName = normalized.slice(relativePrefix.length);
    if (!fileName || !extensions.has(path.extname(fileName).toLowerCase())) continue;
    if (staged.delete) effectiveFiles.delete(fileName);
    else effectiveFiles.add(fileName);
  }
  const files = [...effectiveFiles].sort((left, right) => left.localeCompare(right));
  const names = [...new Set(files.map((fileName) => fileName.slice(0, -path.extname(fileName).length)))]
    .sort((left, right) => left.localeCompare(right));
  return {
    dir: source.dir,
    exists: source.exists || files.length > 0,
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
    if (/(?:^|\/)js\/plugins\/(?:[^/]+\/)*[^/]+\.js$/i.test(relative)) {
      const raw = fs.readFileSync(file, 'utf8');
      const next = rewriteAssetReferenceValue(raw, category, before, after);
      if (next === undefined || next === raw) throw new Error(assetManagementReplacementUnsupported());
      updatedReferences += refs.length;
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
  const normalized = current.replace(/\\/g, '/');
  const extension = path.posix.extname(normalized);
  const stem = extension ? normalized.slice(0, -extension.length) : normalized;
  const definition = RMMV_ASSET_CATEGORIES.find((candidate) => candidate.id === category);
  const candidates = [
    before,
    ...(definition ? [
      `${definition.directory}/${before}`,
      `www/${definition.directory}/${before}`,
    ] : []),
  ];
  const matched = candidates.find((candidate) => stem === candidate);
  if (matched) {
    const next = `${stem.slice(0, stem.length - before.length)}${after}${extension}`;
    return current.includes('\\') && !current.includes('/') ? next.replaceAll('/', '\\') : next;
  }
  let next = current;
  let changed = false;
  for (const candidate of candidates.sort((left, right) => right.length - left.length)) {
    const replacement = `${candidate.slice(0, candidate.length - before.length)}${after}`;
    const result = replaceEmbeddedPath(next, candidate, replacement);
    next = result.value;
    changed ||= result.changed;
  }
  return changed ? next : undefined;
}

function projectRelativeErrorPath(project: string, error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = (error as { path?: unknown }).path;
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return null;
  const root = path.resolve(project);
  const resolved = path.resolve(candidate);
  if (!isInside(root, resolved)) return null;
  return path.relative(root, resolved).replace(/\\/g, '/');
}

function safeAssetInventoryError(error: unknown): string {
  if (error instanceof SyntaxError) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; syscall?: unknown };
    if (typeof record.code === 'string') {
      return `${record.code}${typeof record.syscall === 'string' ? ` (${record.syscall})` : ''}`;
    }
  }
  return 'Unable to read project assets.';
}

function replaceEmbeddedPath(value: string, before: string, after: string): { value: string; changed: boolean } {
  const variants = [before, before.replaceAll('/', '\\')].filter((entry, index, list) => list.indexOf(entry) === index);
  let next = value;
  let changed = false;
  for (const variant of variants) {
    let offset = 0;
    while (offset < next.length) {
      const index = next.indexOf(variant, offset);
      if (index < 0) break;
      const beforeChar = index > 0 ? next[index - 1] : '';
      const tail = next.slice(index + variant.length);
      const extension = /^\.[A-Za-z0-9]+/.exec(tail)?.[0] || '';
      const afterChar = tail[extension.length] || '';
      const beforeBoundary = !beforeChar || !/[A-Za-z0-9_./\\-]/.test(beforeChar);
      const afterBoundary = !afterChar || !/[A-Za-z0-9_./\\-]/.test(afterChar);
      if (!beforeBoundary || !afterBoundary) {
        offset = index + variant.length;
        continue;
      }
      const replacement = variant.includes('\\') ? after.replaceAll('/', '\\') : after;
      next = `${next.slice(0, index)}${replacement}${next.slice(index + variant.length)}`;
      offset = index + replacement.length;
      changed = true;
    }
  }
  return { value: next, changed };
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
  const name = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!name || name.split('/').some((part) => !part || part === '.' || part === '..' || /[<>:"|?*\u0000-\u001f]/.test(part))) {
    throw new Error(assetManagementInvalidName());
  }
  return name;
}

function normalizeImportTargetName(value: string): string {
  return normalizeAssetName(value);
}

function assetNameFromRelative(
  workflowRoot: string,
  project: string,
  category: RmmvAssetCategory,
  relativePath: string,
): string {
  const directory = projectAssetRelativeDirectory(workflowRoot, project, category);
  const normalized = normalizeRelative(relativePath);
  const directoryPrefix = `${directory}/`;
  const matchesCaseSensitive = normalized.startsWith(directoryPrefix);
  const matchesCaseInsensitive = process.platform === 'win32'
    && normalized.toLowerCase().startsWith(directoryPrefix.toLowerCase());
  if (!matchesCaseSensitive && !matchesCaseInsensitive) throw new Error(assetManagementInvalidPath());
  const fileName = normalized.slice(directory.length + 1);
  return fileName.slice(0, -path.posix.extname(fileName).length);
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

function normalizeImportLocalAssetFilesRequest(
  request: ProjectAssetImportLocalFilesInput,
): ProjectAssetImportLocalFilesInput {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error(assetManagementImportParamsMissing());
  if (typeof request.category !== 'string' || !request.category.trim()) throw new Error(assetManagementCategoryMissing());
  if (!Array.isArray(request.files) || request.files.length === 0) throw new Error(assetManagementImportBatchEmpty());
  const files = request.files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error(assetManagementImportParamsMissing());
    }
    if (typeof file.sourceFile !== 'string' || !file.sourceFile.trim()) {
      throw new Error(assetManagementSourceRequired());
    }
    if (file.targetName !== undefined && typeof file.targetName !== 'string') {
      throw new Error(assetManagementInvalidName());
    }
    if (file.overwrite !== undefined && typeof file.overwrite !== 'boolean') {
      throw new Error(assetManagementOverwriteMustBeBoolean());
    }
    return {
      sourceFile: file.sourceFile,
      targetName: file.targetName,
      overwrite: file.overwrite,
    };
  });
  return {
    category: request.category,
    files,
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
