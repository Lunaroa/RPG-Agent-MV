import crypto from 'node:crypto';

export const STORY_PAGE_MARKER_PREFIX = 'AIWF:page:';

interface RawCommand {
  code?: unknown;
  parameters?: unknown;
  [key: string]: unknown;
}

export function createStoryPageUid(): string {
  return `page-${crypto.randomUUID()}`;
}

export function readStoryPageUid(page: unknown): string | null {
  const list = pageCommands(page);
  for (const command of list) {
    if (command.code !== 108 && command.code !== 408) continue;
    const text = Array.isArray(command.parameters) ? String(command.parameters[0] || '') : '';
    if (text.startsWith(STORY_PAGE_MARKER_PREFIX)) {
      const uid = text.slice(STORY_PAGE_MARKER_PREFIX.length).trim();
      if (uid) return uid;
    }
  }
  return null;
}

export function ensureStoryPageUid(page: Record<string, unknown>, uid = createStoryPageUid()): string {
  const existing = readStoryPageUid(page);
  if (existing) return existing;
  return uid;
}

export function removeStoryPageMarkerInPlace(page: unknown): { removed: boolean; uid: string | null } {
  const uid = readStoryPageUid(page);
  if (!page || typeof page !== 'object' || Array.isArray(page)) return { removed: false, uid };
  const record = page as Record<string, unknown>;
  const list = pageCommands(record);
  const next = list.filter((command) => !isStoryPageMarkerCommand(command));
  const removed = next.length !== list.length;
  if (removed) record.list = next;
  return { removed, uid };
}

export function removeStoryPageMarker(page: unknown): unknown {
  const cloned = clone(page);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return cloned;
  const record = cloned as Record<string, unknown>;
  record.list = pageCommands(record).filter((command) => !isStoryPageMarkerCommand(command));
  return record;
}

export function storyPageFingerprint(page: unknown): string {
  return hashCanonical(removeStoryPageMarker(page));
}

export function storyEventShell(event: unknown): Record<string, unknown> {
  const input = event && typeof event === 'object' && !Array.isArray(event)
    ? event as Record<string, unknown>
    : {};
  return {
    name: typeof input.name === 'string' ? input.name : '',
    note: typeof input.note === 'string' ? input.note : '',
    x: Number.isInteger(input.x) ? input.x : 0,
    y: Number.isInteger(input.y) ? input.y : 0,
  };
}

export function storyEventShellFingerprint(eventOrShell: unknown): string {
  const value = eventOrShell && typeof eventOrShell === 'object' && !Array.isArray(eventOrShell)
    && 'pages' in (eventOrShell as Record<string, unknown>)
    ? storyEventShell(eventOrShell)
    : eventOrShell;
  return hashCanonical(value);
}

export function clonePage(page: unknown): Record<string, unknown> {
  const cloned = clone(page);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new Error('event page must be an object');
  }
  return cloned as Record<string, unknown>;
}

function pageCommands(page: unknown): RawCommand[] {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return [];
  const list = (page as Record<string, unknown>).list;
  return Array.isArray(list) ? list as RawCommand[] : [];
}

function isStoryPageMarkerCommand(command: RawCommand): boolean {
  if (command.code !== 108 && command.code !== 408) return false;
  const text = Array.isArray(command.parameters) ? String(command.parameters[0] || '') : '';
  return text.startsWith(STORY_PAGE_MARKER_PREFIX);
}

function hashCanonical(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
