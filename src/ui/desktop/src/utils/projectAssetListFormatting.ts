/** Display formatting for the list / details views of the project-asset explorer. */

/** Explorer-style byte formatting: 983 B, 12.3 KB, 4.2 MB. */
export function formatProjectAssetBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimOneDecimal(kb)} KB`;
  return `${trimOneDecimal(kb / 1024)} MB`;
}

function trimOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Explorer-style timestamp: 2026/7/5 16:04 (no seconds, 24h clock). */
export function formatProjectAssetModified(mtimeMs: number): string {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return '';
  const date = new Date(mtimeMs);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

/** Explorer "Type" column text for an extension: '.png' -> 'PNG'. Empty when unknown. */
export function formatProjectAssetTypeName(extension: string): string {
  const trimmed = extension.trim();
  if (!trimmed) return '';
  return trimmed.replace(/^\./, '').toUpperCase();
}
