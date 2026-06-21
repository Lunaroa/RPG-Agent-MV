import path from 'node:path';
import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { packageLabelTranslations, packageLabelUngrouped } from './packageLabelLocalization.ts';

/** Resource package that owns a map library entry, used for UI sidebar grouping. */
export interface MapLibraryPackage {
  packageId: string;
  packageLabel: string;
}

export function resolveMapLibraryPackage(entry: Record<string, unknown>): MapLibraryPackage {
  const batch = entry.importBatch as Record<string, unknown> | undefined;
  const source = entry.source as Record<string, unknown> | undefined;
  const packageLabel = resolvePackageLabel(entry);
  const sourceSlug = typeof batch?.sourceSlug === 'string' ? batch.sourceSlug : '';
  const packageId =
    sourceSlug ||
    extractPackageIdFromLocalPath(String(source?.localPath || '')) ||
    slugify(packageLabel) ||
    'ungrouped';
  return { packageId, packageLabel };
}

export function resolvePackageLabel(entry: Record<string, unknown>, language?: ProductLanguage | null): string {
  const raw = resolvePackageLabelRaw(entry, language);
  const translated = packageLabelTranslations(language).get(raw);
  return typeof translated === 'string' ? translated : raw;
}

function resolvePackageLabelRaw(entry: Record<string, unknown>, language?: ProductLanguage | null): string {
  const batch = entry.importBatch as Record<string, unknown> | undefined;
  const source = entry.source as Record<string, unknown> | undefined;
  const projectPath =
    String(batch?.sourceProject || '') ||
    String(source?.originalProjectPath || '') ||
    String(source?.exportProjectPath || '') ||
    String(source?.projectPath || '');
  if (projectPath) {
    const base = path.basename(projectPath);
    const parent = path.basename(path.dirname(projectPath));
    const skipParent = new Set(['dlc', 'data', 'www', '.', '']);
    if (parent && !skipParent.has(parent.toLowerCase()) && parent !== base) {
      return `${parent} / ${base}`;
    }
    return base;
  }
  const name = String(source?.name || '');
  const colon = name.indexOf(': ');
  if (colon >= 0) {
    const rest = name.slice(colon + 2).replace(/\\/g, '/');
    const parts = rest.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]} / ${parts[parts.length - 1]}`;
    if (parts.length === 1) return parts[0];
  }
  const slug = batch?.sourceSlug;
  if (slug) return String(slug);
  return String(entry.assetId || packageLabelUngrouped(language));
}

function extractPackageIdFromLocalPath(localPath: string): string | null {
  const normalized = localPath.replace(/\\/g, '/');
  const marker = '/map-visual-library/';
  const idx = normalized.indexOf(marker);
  if (idx < 0) return null;
  const parts = normalized.slice(idx + marker.length).split('/').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
