export const DATABASE_DOCUMENT_PAGES = ['System1', 'System2', 'Types', 'Terms'] as const;

export type DatabaseDocumentPage = typeof DATABASE_DOCUMENT_PAGES[number];

const DOCUMENT_PAGE_SET = new Set<string>(DATABASE_DOCUMENT_PAGES);

export function isDatabaseDocumentPage(value: string): value is DatabaseDocumentPage {
  return DOCUMENT_PAGE_SET.has(value);
}

export function databaseDocumentStorageGroup(page: DatabaseDocumentPage): 'System' | 'Types' | 'Terms' {
  if (page === 'System1' || page === 'System2') return 'System';
  return page;
}

export function databaseDocumentPageKey(value: string): DatabaseDocumentPage | null {
  return isDatabaseDocumentPage(value) ? value : null;
}

export function isSharedSystemDocumentPage(value: string): value is 'System1' | 'System2' {
  return value === 'System1' || value === 'System2';
}

export function normalizeTypeListCapacity(value: unknown, maximum: number): string[] {
  const capacity = Math.max(1, Math.min(5000, Math.trunc(maximum)));
  const source = Array.isArray(value) ? value.map((entry) => String(entry ?? '')) : [''];
  const next = source.slice(0, capacity + 1);
  if (!next.length) next.push('');
  next[0] = '';
  while (next.length <= capacity) next.push('');
  return next;
}

export function typeListRemovedEntries(
  value: unknown,
  maximum: number,
): Array<{ id: number; name: string }> {
  const source = Array.isArray(value) ? value.map((entry) => String(entry ?? '')) : [''];
  const firstRemovedId = Math.max(1, Math.trunc(maximum) + 1);
  const removed: Array<{ id: number; name: string }> = [];
  for (let id = firstRemovedId; id < source.length; id += 1) {
    removed.push({ id, name: source[id] });
  }
  return removed;
}

export function clampTypeListSelection(value: unknown, selectedId: number): number {
  const source = Array.isArray(value) ? value : [''];
  const maximum = Math.max(1, source.length - 1);
  return Math.max(1, Math.min(maximum, Math.trunc(selectedId) || 1));
}

const SYSTEM_2_ROOT_PATHS = new Set([
  'tileSize',
  'faceSize',
  'iconSize',
  'menuCommands',
  'itemCategories',
  'magicSkills',
  'attackMotions',
  'advanced',
]);

export function systemDocumentPageForField(path: string): 'System1' | 'System2' {
  const root = path.split('.')[0];
  return SYSTEM_2_ROOT_PATHS.has(root) ? 'System2' : 'System1';
}
