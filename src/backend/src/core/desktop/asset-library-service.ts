import fs from 'node:fs';
import path from 'node:path';

import type {
  AssetLibraryCatalog,
  AssetLibraryCategory,
  AssetLibraryCategoryId,
  AssetLibraryEntry,
  AssetLibraryFileEntry,
  AssetLibraryImportResult,
  AssetLibraryImportValidation,
  AssetLibrarySkillEntry,
} from '../../../../contract/types.ts';
import { readJson } from '../rmmv/json.ts';
import { dataRelativePath, resolveRmmvLayout, resourceRelativePath } from '../rmmv/rmmv-layout.ts';
import { librarySourceAssetUrl } from './asset-service.ts';
import {
  assetLibraryCategoryLabels,
  assetLibraryDataUnreadable,
  assetLibraryDeclaredDependencyMissing,
  assetLibraryDependencyIncompatible,
  assetLibraryDependencyLabels,
  assetLibraryEntryMissing,
  assetLibraryFileMissing,
  assetLibraryIconSetDependencyMissing,
  assetLibraryImportValidationFailed,
  assetLibraryPathInvalid,
  assetLibraryPathOutOfBounds,
  assetLibraryPluginMissing,
  assetLibraryPluginsJsMissing,
  assetLibraryResourceMissing,
  assetLibrarySkillEntryInvalid,
  assetLibrarySkillIndexInvalid,
  assetLibrarySkillsJsonMissing,
  assetLibrarySourceFileMissing,
  assetLibrarySourceInvalid,
  assetLibraryTargetSkillsMissing,
} from './assetLibraryLocalization.ts';
import { listMapLibrary, validateMapLibraryPackage } from './library-service.ts';
import { importMapDraftFromLibrary } from './map-service.ts';
import { getProjectFileForRead, writeStagedProjectBuffer, writeStagedProjectJson } from './staging-service.ts';

const FILE_BUCKETS: Record<string, {
  category: AssetLibraryFileEntry['category'];
  directory: string;
  extensions: Set<string>;
}> = {
  characters: { category: 'characters', directory: 'img/characters', extensions: new Set(['.png']) },
  faces: { category: 'characters', directory: 'img/faces', extensions: new Set(['.png']) },
  svActors: { category: 'characters', directory: 'img/sv_actors', extensions: new Set(['.png']) },
  tilesets: { category: 'tilesets', directory: 'img/tilesets', extensions: new Set(['.png']) },
  parallaxes: { category: 'images', directory: 'img/parallaxes', extensions: new Set(['.png']) },
  pictures: { category: 'images', directory: 'img/pictures', extensions: new Set(['.png']) },
  battlebacks1: { category: 'images', directory: 'img/battlebacks1', extensions: new Set(['.png']) },
  battlebacks2: { category: 'images', directory: 'img/battlebacks2', extensions: new Set(['.png']) },
  bgm: { category: 'audio', directory: 'audio/bgm', extensions: new Set(['.ogg', '.m4a']) },
  bgs: { category: 'audio', directory: 'audio/bgs', extensions: new Set(['.ogg', '.m4a']) },
  me: { category: 'audio', directory: 'audio/me', extensions: new Set(['.ogg', '.m4a']) },
  se: { category: 'audio', directory: 'audio/se', extensions: new Set(['.ogg', '.m4a']) },
  movies: { category: 'videos', directory: 'movies', extensions: new Set(['.webm', '.mp4']) },
};

export function buildAssetLibraryCatalog(workflowRoot: string): AssetLibraryCatalog {
  const mapEntries = listMapLibrary(workflowRoot).entries.map((entry) => ({
    kind: 'map' as const,
    assetId: entry.assetId,
    category: 'maps' as const,
    name: entry.title,
    map: entry,
  }));
  const skillEntries = readSkillLibrary(workflowRoot);
  const fileEntries = scanFileLibrary(workflowRoot);
  const entries: AssetLibraryEntry[] = [...mapEntries, ...skillEntries, ...fileEntries];
  const categories = (Object.entries(assetLibraryCategoryLabels()) as Array<[AssetLibraryCategoryId, string]>)
    .map(([id, label]): AssetLibraryCategory => ({
      id,
      label,
      count: entries.filter((entry) => entry.category === id).length,
    }));
  return { totalEntries: entries.length, categories, entries };
}

export function getAssetLibraryEntry(workflowRoot: string, assetId: string): AssetLibraryEntry {
  const entry = assetId.startsWith('file:')
    ? getFileLibraryEntry(workflowRoot, assetId)
    : assetId.startsWith('skill:')
      ? readSkillLibrary(workflowRoot).find((item) => item.assetId === assetId)
      : listMapLibrary(workflowRoot).entries
        .filter((item) => item.assetId === assetId)
        .map((item) => ({ kind: 'map' as const, assetId: item.assetId, category: 'maps' as const, name: item.title, map: item }))[0];
  if (!entry) throw new Error(assetLibraryEntryMissing(assetId));
  return entry;
}

export function validateAssetLibraryImport(
  workflowRoot: string,
  project: string,
  assetId: string,
): AssetLibraryImportValidation {
  const entry = getAssetLibraryEntry(workflowRoot, assetId);
  if (entry.kind === 'map') {
    const result = validateMapLibraryPackage(workflowRoot, [entry.assetId]);
    return { ok: result.ok, issues: result.issues.map((issue) => issue.message) };
  }
  if (entry.kind === 'file') {
    const file = resolveLibrarySourceFile(workflowRoot, entry.sourceSlug, entry.relativePath);
    return fs.existsSync(file)
      ? { ok: true, issues: [] }
      : { ok: false, issues: [assetLibrarySourceFileMissing()] };
  }
  return validateSkillImport(workflowRoot, project, entry);
}

export function importAssetLibraryEntry(
  workflowRoot: string,
  project: string,
  assetId: string,
): AssetLibraryImportResult {
  const entry = getAssetLibraryEntry(workflowRoot, assetId);
  const validation = validateAssetLibraryImport(workflowRoot, project, assetId);
  if (!validation.ok) throw new Error(assetLibraryImportValidationFailed(validation.issues));

  if (entry.kind === 'map') {
    const result = importMapDraftFromLibrary(workflowRoot, project, entry.assetId, {});
    return { kind: 'map', assetId, importedId: Number(result?.mapId || 0) || undefined };
  }
  if (entry.kind === 'file') {
    const source = resolveLibrarySourceFile(workflowRoot, entry.sourceSlug, entry.relativePath);
    const relativePath = resourceRelativePath(resolveRmmvLayout(project), entry.relativePath);
    writeStagedProjectBuffer(workflowRoot, project, relativePath, fs.readFileSync(source));
    return { kind: 'file', assetId, relativePath };
  }

  const layout = resolveRmmvLayout(project);
  const skillsRelative = dataRelativePath(layout, 'Skills.json');
  const skillsPath = getProjectFileForRead(workflowRoot, project, skillsRelative);
  if (!skillsPath) throw new Error(assetLibraryTargetSkillsMissing());
  const skills = readJson(skillsPath) as Array<Record<string, unknown> | null>;
  const importedId = firstAvailableId(skills);
  skills[importedId] = { ...structuredClone(entry.skill), id: importedId };
  writeStagedProjectJson(workflowRoot, project, skillsRelative, skills);
  return { kind: 'skill', assetId, importedId };
}

function scanFileLibrary(workflowRoot: string): AssetLibraryFileEntry[] {
  const sourcesRoot = path.resolve(workflowRoot, 'data', 'assets', 'sources');
  if (!fs.existsSync(sourcesRoot)) return [];
  const entries: AssetLibraryFileEntry[] = [];
  for (const sourceSlug of fs.readdirSync(sourcesRoot).sort()) {
    const sourceRoot = path.join(sourcesRoot, sourceSlug);
    if (!fs.statSync(sourceRoot).isDirectory()) continue;
    for (const [subtype, bucket] of Object.entries(FILE_BUCKETS)) {
      const directory = path.join(sourceRoot, bucket.directory);
      if (!fs.existsSync(directory)) continue;
      for (const fileName of fs.readdirSync(directory).sort()) {
        const absolute = path.join(directory, fileName);
        const extension = path.extname(fileName).toLowerCase();
        if (!bucket.extensions.has(extension) || !fs.statSync(absolute).isFile()) continue;
        const relativePath = `${bucket.directory}/${fileName}`;
        entries.push(buildFileEntry(sourceSlug, subtype, bucket.category, relativePath, absolute));
      }
    }
  }
  return entries;
}

function readSkillLibrary(workflowRoot: string): AssetLibrarySkillEntry[] {
  const indexPath = path.resolve(workflowRoot, 'data', 'assets', 'skill-library', 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  const index = readJson(indexPath) as { schemaVersion?: number; entries?: AssetLibrarySkillEntry[] };
  if (index.schemaVersion !== 1 || !Array.isArray(index.entries)) throw new Error(assetLibrarySkillIndexInvalid());
  return index.entries.map((entry) => {
    if (entry.kind !== 'skill' || entry.category !== 'skills' || !entry.assetId || !entry.name || !entry.skill || !entry.dependencies) {
      throw new Error(assetLibrarySkillEntryInvalid());
    }
    validateSkillPackageDeclaration(entry);
    return entry;
  });
}

function getFileLibraryEntry(workflowRoot: string, assetId: string): AssetLibraryFileEntry | undefined {
  const match = assetId.match(/^file:([^:]+):(.+)$/);
  if (!match) return undefined;
  const [, sourceSlug, relativePath] = match;
  const bucketEntry = Object.entries(FILE_BUCKETS).find(([, bucket]) => relativePath.startsWith(`${bucket.directory}/`));
  if (!bucketEntry) return undefined;
  const [subtype, bucket] = bucketEntry;
  const absolute = resolveLibrarySourceFile(workflowRoot, sourceSlug, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile() || !bucket.extensions.has(path.extname(absolute).toLowerCase())) return undefined;
  return buildFileEntry(sourceSlug, subtype, bucket.category, relativePath, absolute);
}

function buildFileEntry(
  sourceSlug: string,
  subtype: string,
  category: AssetLibraryFileEntry['category'],
  relativePath: string,
  absolute: string,
): AssetLibraryFileEntry {
  const fileName = path.basename(absolute);
  const extension = path.extname(fileName).toLowerCase();
  return {
    kind: 'file',
    assetId: `file:${sourceSlug}:${relativePath}`,
    category,
    subtype,
    name: path.basename(fileName, extension),
    fileName,
    sourceSlug,
    relativePath,
    url: librarySourceAssetUrl(sourceSlug, relativePath),
    size: fs.statSync(absolute).size,
    format: extension.slice(1),
  };
}

function validateSkillPackageDeclaration(entry: AssetLibrarySkillEntry): void {
  const skill = entry.skill;
  const dependencies = entry.dependencies;
  const dependencyLabels = assetLibraryDependencyLabels();
  requireDeclaredDependency(entry, dependencies.skillTypes, Number(skill.stypeId || 0), dependencyLabels.skillType);
  requireDeclaredDependency(entry, dependencies.weaponTypes, Number(skill.requiredWtypeId1 || 0), dependencyLabels.weaponType);
  requireDeclaredDependency(entry, dependencies.weaponTypes, Number(skill.requiredWtypeId2 || 0), dependencyLabels.weaponType);
  requireDeclaredDependency(entry, dependencies.animations, Number(skill.animationId || 0), dependencyLabels.animation);
  const damage = skill.damage && typeof skill.damage === 'object' ? skill.damage as Record<string, unknown> : {};
  requireDeclaredDependency(entry, dependencies.elements, Number(damage.elementId || 0), dependencyLabels.element);
  const effects = Array.isArray(skill.effects) ? skill.effects as Array<Record<string, unknown>> : [];
  for (const effect of effects) {
    const code = Number(effect.code || 0);
    const id = Number(effect.dataId || 0);
    if (code === 21 || code === 22) requireDeclaredDependency(entry, dependencies.states, id, dependencyLabels.state);
    if (code === 44) requireDeclaredDependency(entry, dependencies.commonEvents, id, dependencyLabels.commonEvent);
  }
  if (Number(skill.iconIndex || 0) > 0 && !dependencies.resources.includes('img/system/IconSet.png')) {
    throw new Error(assetLibraryIconSetDependencyMissing(entry.name));
  }
}

function requireDeclaredDependency(
  entry: AssetLibrarySkillEntry,
  dependencies: Array<{ id: number; name: string }>,
  id: number,
  label: string,
): void {
  if (id <= 0) return;
  if (!dependencies.some((dependency) => dependency.id === id && dependency.name.trim())) {
    throw new Error(assetLibraryDeclaredDependencyMissing(entry.name, label, id));
  }
}

function validateSkillImport(workflowRoot: string, project: string, entry: AssetLibrarySkillEntry): AssetLibraryImportValidation {
  const issues: string[] = [];
  const layout = resolveRmmvLayout(project);
  const dependencyLabels = assetLibraryDependencyLabels();
  const system = readProjectJson(workflowRoot, project, dataRelativePath(layout, 'System.json'), issues) as Record<string, unknown> | null;
  validateNamedArray(system?.skillTypes, entry.dependencies.skillTypes, dependencyLabels.skillType, issues);
  validateNamedArray(system?.weaponTypes, entry.dependencies.weaponTypes, dependencyLabels.weaponType, issues);
  validateNamedArray(system?.elements, entry.dependencies.elements, dependencyLabels.element, issues);
  validateDatabaseDependencies(workflowRoot, project, layout, 'Animations.json', entry.dependencies.animations, dependencyLabels.animation, issues);
  validateDatabaseDependencies(workflowRoot, project, layout, 'States.json', entry.dependencies.states, dependencyLabels.state, issues);
  validateDatabaseDependencies(workflowRoot, project, layout, 'CommonEvents.json', entry.dependencies.commonEvents, dependencyLabels.commonEvent, issues);
  validatePlugins(workflowRoot, project, layout, entry.dependencies.plugins, issues);
  for (const resource of entry.dependencies.resources) {
    if (!getProjectFileForRead(workflowRoot, project, resourceRelativePath(layout, safeRelativePath(resource)))) issues.push(assetLibraryResourceMissing(resource));
  }
  if (!getProjectFileForRead(workflowRoot, project, dataRelativePath(layout, 'Skills.json'))) issues.push(assetLibrarySkillsJsonMissing());
  return { ok: issues.length === 0, issues };
}

function validateDatabaseDependencies(
  workflowRoot: string,
  project: string,
  layout: ReturnType<typeof resolveRmmvLayout>,
  fileName: string,
  dependencies: Array<{ id: number; name: string }>,
  label: string,
  issues: string[],
): void {
  if (!dependencies.length) return;
  const data = readProjectJson(workflowRoot, project, dataRelativePath(layout, fileName), issues) as Array<Record<string, unknown> | null> | null;
  if (!Array.isArray(data)) return;
  validateNamedArray(data.map((item) => item?.name || ''), dependencies, label, issues);
}

function validateNamedArray(
  value: unknown,
  dependencies: Array<{ id: number; name: string }>,
  label: string,
  issues: string[],
): void {
  if (!dependencies.length) return;
  if (!Array.isArray(value)) {
    issues.push(assetLibraryDataUnreadable(label));
    return;
  }
  for (const dependency of dependencies) {
    if (String(value[dependency.id] || '') !== dependency.name) {
      issues.push(assetLibraryDependencyIncompatible(label, dependency.id, dependency.name));
    }
  }
}

function validatePlugins(workflowRoot: string, project: string, layout: ReturnType<typeof resolveRmmvLayout>, plugins: string[], issues: string[]): void {
  if (!plugins.length) return;
  const pluginsPath = getProjectFileForRead(workflowRoot, project, resourceRelativePath(layout, 'js/plugins.js'));
  if (!pluginsPath) {
    issues.push(assetLibraryPluginsJsMissing());
    return;
  }
  const source = fs.readFileSync(pluginsPath, 'utf8');
  for (const plugin of plugins) {
    if (!source.includes(plugin)) issues.push(assetLibraryPluginMissing(plugin));
  }
}

function readProjectJson(workflowRoot: string, project: string, relativePath: string, issues: string[]): unknown {
  const file = getProjectFileForRead(workflowRoot, project, relativePath);
  if (!file) {
    issues.push(assetLibraryFileMissing(path.basename(relativePath)));
    return null;
  }
  return readJson(file);
}

function resolveLibrarySourceFile(workflowRoot: string, sourceSlug: string, relativePath: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sourceSlug)) throw new Error(assetLibrarySourceInvalid());
  const root = path.resolve(workflowRoot, 'data', 'assets', 'sources', sourceSlug);
  const candidate = path.resolve(root, ...safeRelativePath(relativePath).split('/'));
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(assetLibraryPathOutOfBounds());
  return candidate;
}

function safeRelativePath(value: string): string {
  const relative = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(assetLibraryPathInvalid());
  return relative;
}

function firstAvailableId(entries: Array<unknown>): number {
  for (let id = 1; id < entries.length; id++) {
    if (!entries[id]) return id;
  }
  return entries.length;
}
