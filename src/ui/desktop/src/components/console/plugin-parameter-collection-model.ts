import type {
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import {
  clonePluginParameterValue,
  normalizePluginParameterValue,
  serializePluginParameterValue,
  summarizePluginParameterValue,
  type PluginParameterSummaryLabels,
} from './plugin-parameter-model';

export interface PluginParameterCollectionColumn {
  key: string;
  label: string;
  field: PluginParameterSchemaField;
}

export interface PluginParameterRawParseError {
  message: string;
  path: string;
  line: number;
  column: number;
  reason: 'syntax' | 'root-type' | 'nested-type';
}

export type PluginParameterRawParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: PluginParameterRawParseError };

export interface PluginParameterCollectionRow {
  index: number;
  value: unknown;
  searchText: string;
}

export const PLUGIN_PARAMETER_CLIPBOARD_LIMIT = 32 * 1024;

export function serializePluginParameterRaw(
  field: PluginParameterSchemaField,
  value: unknown,
): string {
  const serialized = serializePluginParameterValue(field, value);
  return typeof serialized === 'string' ? serialized : JSON.stringify(serialized);
}

export function parsePluginParameterRawStrict(
  field: PluginParameterSchemaField,
  raw: string,
): PluginParameterRawParseResult {
  if (field.kind === 'struct' || field.kind === 'array' || field.kind === 'location') {
    const root = parseJson(raw, field.key);
    if (!root.ok) return root;
    return decodeStoredValue(field, root.value, field.key, true);
  }

  return {
    ok: true,
    value: normalizePluginParameterValue(field, raw),
  };
}

export function buildPluginParameterCollectionColumns(
  field: PluginParameterSchemaField,
): PluginParameterCollectionColumn[] {
  if (field.kind !== 'array' || field.item?.kind !== 'struct') return [];
  return (field.item.fields || []).map((child) => ({
    key: child.key,
    label: child.label || child.key,
    field: child,
  }));
}

export function buildPluginParameterCollectionRows(
  field: PluginParameterSchemaField,
  value: unknown,
  catalog: EditorProjectCatalog | null,
  labels: PluginParameterSummaryLabels,
): PluginParameterCollectionRow[] {
  if (field.kind !== 'array') return [];
  return (Array.isArray(value) ? value : []).map((entry, index) => ({
    index,
    value: entry,
    searchText: buildPluginParameterCollectionSearchText(
      field.item,
      entry,
      catalog,
      labels,
    ),
  }));
}

export function buildPluginParameterCollectionSearchText(
  field: PluginParameterSchemaField | undefined,
  value: unknown,
  catalog: EditorProjectCatalog | null,
  labels: PluginParameterSummaryLabels,
): string {
  if (!field) return rawSearchValue(value);
  const parts = [
    field.label,
    field.key,
    summarizePluginParameterValue(field, value, catalog, labels),
    rawSearchValue(value),
  ];
  if (field.kind === 'struct' && isPlainObject(value)) {
    for (const child of field.fields || []) {
      parts.push(
        child.label,
        child.key,
        summarizePluginParameterValue(child, value[child.key], catalog, labels),
        rawSearchValue(value[child.key]),
      );
    }
  }
  return parts.filter(Boolean).join('\n').toLocaleLowerCase();
}

export function filterPluginParameterCollectionRows<T extends PluginParameterCollectionRow>(
  rows: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? rows.filter((row) => row.searchText.includes(normalized))
    : rows;
}

export function replacePluginParameterArrayItem(
  entries: unknown[],
  index: number,
  value: unknown,
): unknown[] {
  return entries.map((entry, currentIndex) =>
    currentIndex === index ? clonePluginParameterValue(value) : clonePluginParameterValue(entry),
  );
}

export function removePluginParameterArrayItems(
  entries: unknown[],
  indexes: Iterable<number>,
): unknown[] {
  const removed = new Set(indexes);
  return entries
    .filter((_, index) => !removed.has(index))
    .map((entry) => clonePluginParameterValue(entry));
}

export function movePluginParameterArrayItem(
  entries: unknown[],
  fromIndex: number,
  toIndex: number,
): unknown[] {
  if (
    fromIndex < 0
    || fromIndex >= entries.length
    || toIndex < 0
    || toIndex >= entries.length
    || fromIndex === toIndex
  ) {
    return entries.map((entry) => clonePluginParameterValue(entry));
  }
  const next = entries.map((entry) => clonePluginParameterValue(entry));
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function buildSelectedPluginParameterRawArray(
  arrayField: PluginParameterSchemaField,
  entries: unknown[],
  selectedIndexes: Iterable<number>,
): { text: string; overLimit: boolean } {
  if (arrayField.kind !== 'array') {
    throw new Error('Selection copying is only available for array parameters.');
  }
  const selected = new Set(selectedIndexes);
  const text = serializePluginParameterRaw(
    arrayField,
    entries.filter((_, index) => selected.has(index)),
  );
  return {
    text,
    overLimit: text.length > PLUGIN_PARAMETER_CLIPBOARD_LIMIT,
  };
}

function decodeStoredValue(
  field: PluginParameterSchemaField,
  stored: unknown,
  path: string,
  root: boolean,
): PluginParameterRawParseResult {
  if (field.kind === 'struct') {
    const decodedStorage = root
      ? { ok: true as const, value: stored }
      : parseNestedJson(stored, path);
    if (!decodedStorage.ok) return decodedStorage;
    const parsed = decodedStorage.value;
    if (!isPlainObject(parsed)) {
      return shapeError(path, 'object', root ? 'root-type' : 'nested-type');
    }
    const decoded = clonePluginParameterValue(parsed);
    for (const child of field.fields || []) {
      if (!(child.key in parsed)) continue;
      const childPath = `${path}.${child.key}`;
      if (child.kind === 'struct' || child.kind === 'array') {
        const childResult = decodeStoredValue(child, parsed[child.key], childPath, false);
        if (!childResult.ok) return childResult;
        decoded[child.key] = childResult.value;
      } else {
        decoded[child.key] = normalizePluginParameterValue(child, parsed[child.key]);
      }
    }
    return { ok: true, value: decoded };
  }

  if (field.kind === 'array') {
    const decodedStorage = root
      ? { ok: true as const, value: stored }
      : parseNestedJson(stored, path);
    if (!decodedStorage.ok) return decodedStorage;
    const parsed = decodedStorage.value;
    if (!Array.isArray(parsed)) {
      return shapeError(path, 'array', root ? 'root-type' : 'nested-type');
    }
    if (!field.item) return { ok: true, value: clonePluginParameterValue(parsed) };
    const decoded: unknown[] = [];
    for (let index = 0; index < parsed.length; index += 1) {
      const entry = parsed[index];
      const itemPath = `${path}[${index}]`;
      if (field.item.kind === 'struct' || field.item.kind === 'array') {
        const itemResult = decodeStoredValue(field.item, entry, itemPath, false);
        if (!itemResult.ok) return itemResult;
        decoded.push(itemResult.value);
      } else {
        decoded.push(normalizePluginParameterValue(field.item, entry));
      }
    }
    return { ok: true, value: decoded };
  }

  return { ok: true, value: normalizePluginParameterValue(field, stored) };
}

function parseNestedJson(
  stored: unknown,
  path: string,
): PluginParameterRawParseResult {
  if (typeof stored !== 'string') {
    return shapeError(path, 'an encoded JSON string', 'nested-type');
  }
  return parseJson(stored, path);
}

function parseJson(
  raw: string,
  path: string,
): PluginParameterRawParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = extractJsonPosition(message);
    const location = indexToLineColumn(raw, position);
    return {
      ok: false,
      error: {
        message,
        path,
        line: location.line,
        column: location.column,
        reason: 'syntax',
      },
    };
  }
}

function shapeError(
  path: string,
  expected: string,
  reason: 'root-type' | 'nested-type',
): PluginParameterRawParseResult {
  return {
    ok: false,
    error: {
      message: `Expected ${expected} at ${path}.`,
      path,
      line: 1,
      column: 1,
      reason,
    },
  };
}

function extractJsonPosition(message: string): number {
  const position = message.match(/\bposition\s+(\d+)/i);
  if (position) return Number(position[1]);
  return 0;
}

function indexToLineColumn(text: string, index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, Math.min(index, text.length));
  const prefix = text.slice(0, safeIndex);
  const lines = prefix.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length || 0) + 1,
  };
}

function rawSearchValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
