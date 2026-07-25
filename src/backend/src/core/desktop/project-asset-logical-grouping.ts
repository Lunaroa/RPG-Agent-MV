/**
 * Pure logical grouping for RMMV project asset browser entries.
 * One logical resource may ship as several containers (.ogg/.m4a) or encrypted
 * variants (.rpgmvp/.rpgmvo/.rpgmvm); the browser presents one entry per name.
 */

export interface ProjectAssetScannedFile {
  fileName: string;
  relativePath: string;
  bytes: number;
  mtimeMs: number;
}

export interface ProjectAssetLogicalVariant {
  relativePath: string;
  fileName: string;
  extension: string;
  bytes: number;
  mtimeMs: number;
  encrypted: boolean;
}

export interface ProjectAssetLogicalEntry {
  name: string;
  variants: ProjectAssetLogicalVariant[];
  primary: ProjectAssetLogicalVariant;
  bytes: number;
  mtimeMs: number;
  encrypted: boolean;
}

export const PROJECT_ASSET_ENCRYPTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.rpgmvp',
  '.rpgmvo',
  '.rpgmvm',
]);

/**
 * Preference order when choosing an entry's primary (previewable) file among its variants.
 * Encrypted variants rank last because they cannot be decoded for preview.
 */
export const PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ogg',
  '.m4a',
  '.webm',
  '.mp4',
  '.css',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.efkefc',
  '.js',
  '.rpgmvp',
  '.rpgmvo',
  '.rpgmvm',
];

const PREFERENCE_RANK = new Map(
  PROJECT_ASSET_PRIMARY_EXTENSION_PREFERENCE.map((extension, index) => [extension, index]),
);

export function isProjectAssetEncryptedExtension(extension: string): boolean {
  return PROJECT_ASSET_ENCRYPTED_EXTENSIONS.has(extension.toLowerCase());
}

export function groupProjectAssetLogicalEntries(
  files: readonly ProjectAssetScannedFile[],
  acceptedExtensions: readonly string[],
): ProjectAssetLogicalEntry[] {
  const accepted = new Set(acceptedExtensions.map((extension) => extension.toLowerCase()));
  const groups = new Map<string, { name: string; variants: ProjectAssetLogicalVariant[] }>();

  for (const file of files) {
    const extension = extensionOf(file.fileName);
    if (!accepted.has(extension)) continue;
    const logicalKey = basenameWithoutExtension(file.fileName).toLowerCase();
    const variant: ProjectAssetLogicalVariant = {
      relativePath: file.relativePath,
      fileName: file.fileName,
      extension,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
      encrypted: isProjectAssetEncryptedExtension(extension),
    };
    const existing = groups.get(logicalKey);
    if (existing) {
      existing.variants.push(variant);
      continue;
    }
    groups.set(logicalKey, {
      name: basenameWithoutExtension(file.fileName),
      variants: [variant],
    });
  }

  const entries: ProjectAssetLogicalEntry[] = [];
  for (const group of groups.values()) {
    const variants = [...group.variants].sort((left, right) => (
      preferenceRank(left.extension) - preferenceRank(right.extension)
      || left.fileName.localeCompare(right.fileName)
    ));
    const primary = variants[0]!;
    entries.push({
      name: group.name,
      variants,
      primary,
      bytes: variants.reduce((sum, variant) => sum + variant.bytes, 0),
      mtimeMs: Math.max(...variants.map((variant) => variant.mtimeMs)),
      encrypted: variants.every((variant) => variant.encrypted),
    });
  }

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function basenameWithoutExtension(fileName: string): string {
  const extension = extensionOf(fileName);
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return '';
  return fileName.slice(index).toLowerCase();
}

function preferenceRank(extension: string): number {
  return PREFERENCE_RANK.get(extension.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
}
