export const SYSTEM_NAMED_ENTRY_PAGE_SIZE = 20;
export const SYSTEM_NAMED_ENTRY_LIMIT = 5000;

export interface SystemNamedEntryRange {
  start: number;
  end: number;
}

export function buildSystemNamedEntryRanges(
  maximum: number,
  pageSize = SYSTEM_NAMED_ENTRY_PAGE_SIZE,
): SystemNamedEntryRange[] {
  const max = Math.max(0, Math.floor(maximum));
  if (max < 1 || pageSize < 1) return [];
  const ranges: SystemNamedEntryRange[] = [];
  for (let start = 1; start <= max; start += pageSize) {
    ranges.push({
      start,
      end: Math.min(start + pageSize - 1, max),
    });
  }
  return ranges;
}

export function formatSystemNamedEntryId(id: number): string {
  return String(Math.max(0, Math.floor(id))).padStart(4, '0');
}

export function displaySystemNamedEntryName(id: number, name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === `#${id}`) return '';
  return trimmed;
}
