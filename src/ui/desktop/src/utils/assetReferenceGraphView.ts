import type {
  ProjectAssetReference,
  ProjectAssetReferenceGraph,
  ProjectAssetReferenceGraphAsset,
} from '../api/client';
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { translate, type MessageKey } from '../i18n/messages.ts';

export type ReplacementMap = Record<string, string>;

export interface MissingReferenceGroup {
  key: string;
  category: string;
  name: string;
  references: ProjectAssetReference[];
  expectedRelativePaths: string[];
  replacementCandidates: ProjectAssetReferenceGraphAsset[];
}

export interface AssetReferenceRow {
  asset: ProjectAssetReferenceGraphAsset;
  refs: ProjectAssetReference[];
  key: string;
}

export type AssetReferenceSourceKind =
  | 'database'
  | 'map'
  | 'commonEvent'
  | 'plugin'
  | 'config'
  | 'audio'
  | 'image'
  | 'other';

export function assetReferenceKey(category: string, name: string): string {
  return `${category}::${name}`;
}

export function projectAssetKey(asset: ProjectAssetReferenceGraphAsset): string {
  return `${asset.category}::${asset.relativePath}`;
}

export function buildReferenceMap(graph: ProjectAssetReferenceGraph | null): Map<string, ProjectAssetReference[]> {
  const map = new Map<string, ProjectAssetReference[]>();
  if (!graph) return map;
  for (const reference of graph.references) {
    const key = assetReferenceKey(reference.category, reference.name);
    const current = map.get(key);
    if (current) current.push(reference);
    else map.set(key, [reference]);
  }
  return map;
}

export function buildAssetReferenceRows(
  graph: ProjectAssetReferenceGraph | null,
  queryValue = '',
): AssetReferenceRow[] {
  if (!graph) return [];
  const referenceMap = buildReferenceMap(graph);
  const query = queryValue.trim().toLocaleLowerCase();
  return graph.assets
    .map((asset) => ({
      asset,
      refs: referenceMap.get(assetReferenceKey(asset.category, asset.name)) || [],
      key: projectAssetKey(asset),
    }))
    .sort((a, b) => a.asset.category.localeCompare(b.asset.category) || a.asset.name.localeCompare(b.asset.name))
    .filter((row) => assetRowMatches(row, query));
}

export function buildUnusedAssetRows(
  graph: ProjectAssetReferenceGraph | null,
  queryValue = '',
): AssetReferenceRow[] {
  if (!graph) return [];
  const query = queryValue.trim().toLocaleLowerCase();
  return graph.unusedAssets
    .map((asset) => ({
      asset,
      refs: [],
      key: projectAssetKey(asset),
    }))
    .sort((a, b) => a.asset.category.localeCompare(b.asset.category) || a.asset.name.localeCompare(b.asset.name))
    .filter((row) => assetRowMatches(row, query));
}

function assetRowMatches(row: AssetReferenceRow, query: string): boolean {
  if (!query) return true;
  const haystack = `${row.asset.category} ${row.asset.name} ${row.asset.relativePath}`.toLocaleLowerCase();
  return haystack.includes(query);
}

export function buildMissingReferenceGroups(graph: ProjectAssetReferenceGraph): MissingReferenceGroup[] {
  const groups = new Map<string, MissingReferenceGroup>();
  for (const missing of graph.missingReferences) {
    const key = assetReferenceKey(missing.category, missing.name);
    const reference: ProjectAssetReference = {
      file: missing.file,
      path: missing.path,
      source: missing.source,
      category: missing.category,
      name: missing.name,
    };
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        category: missing.category,
        name: missing.name,
        references: [reference],
        expectedRelativePaths: [...missing.expectedRelativePaths],
        replacementCandidates: [],
      });
      continue;
    }
    group.references.push(reference);
    group.expectedRelativePaths.push(...missing.expectedRelativePaths);
  }

  const result = Array.from(groups.values()).map((group) => ({
    ...group,
    expectedRelativePaths: [...new Set(group.expectedRelativePaths)].sort(),
    replacementCandidates: graph.assets
      .filter((asset) => asset.category === group.category && asset.name !== group.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return result.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

export function buildReplacementMap(
  groups: MissingReferenceGroup[],
  previous: ReplacementMap = {},
): ReplacementMap {
  const next: ReplacementMap = {};
  for (const group of groups) {
    const current = previous[group.key];
    const hasCurrent = current && group.replacementCandidates.some((asset) => asset.name === current);
    next[group.key] = hasCurrent ? current : (group.replacementCandidates[0]?.name || '');
  }
  return next;
}

export function classifyReferenceSource(reference: ProjectAssetReference): AssetReferenceSourceKind {
  const file = reference.file.replace(/\\/g, '/').toLocaleLowerCase();
  const source = reference.source.toLocaleLowerCase();
  const category = reference.category.toLocaleLowerCase();
  if (/map\d+\.json$/.test(file)) return 'map';
  if (file.endsWith('commonevents.json')) return 'commonEvent';
  if (file.endsWith('plugins.js') || source.includes('plugin')) return 'plugin';
  if (file.endsWith('system.json') || source.includes('system')) return 'config';
  if (file.includes('/data/') || file.startsWith('data/')) return 'database';
  if (['bgm', 'bgs', 'me', 'se'].includes(category)) return 'audio';
  if (['animations', 'battlebacks1', 'battlebacks2', 'characters', 'enemies', 'faces', 'parallaxes', 'pictures', 'sv_actors', 'sv_enemies', 'system', 'tilesets', 'titles1', 'titles2'].includes(category)) return 'image';
  return 'other';
}

const SOURCE_LABEL_KEYS: Record<AssetReferenceSourceKind, MessageKey> = {
  database: 'assetref.source.database',
  map: 'assetref.source.map',
  commonEvent: 'assetref.source.commonEvent',
  plugin: 'assetref.source.plugin',
  config: 'assetref.source.config',
  audio: 'assetref.source.audio',
  image: 'assetref.source.image',
  other: 'assetref.source.other',
}

export function referenceSourceLabel(reference: ProjectAssetReference, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  return translate(SOURCE_LABEL_KEYS[classifyReferenceSource(reference)], language)
}
