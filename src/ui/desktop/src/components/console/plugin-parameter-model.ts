import type {
  EditorProjectCatalog,
  ManagedPluginEntry,
  PluginParameterSchemaField,
} from '../../api/client';

export interface PluginParameterSummaryLabels {
  enabled: string;
  disabled: string;
  empty: string;
  itemCount(count: number): string;
  structuredValue: string;
  location(map: string, x: number, y: number): string;
}

export interface PluginParameterRow {
  key: string;
  label: string;
  description: string;
  field: PluginParameterSchemaField | null;
  editable: boolean;
  readonlyReason: string;
  summary: string;
  fullValue: string;
}

export type PluginParameterChildTarget =
  | { kind: 'struct'; key: string }
  | { kind: 'array'; index: number };

export type PluginParameterValidationIssue =
  | { kind: 'number-required'; path: string }
  | { kind: 'number-invalid'; path: string }
  | { kind: 'number-min'; path: string; min: number }
  | { kind: 'number-max'; path: string; max: number }
  | { kind: 'number-decimals'; path: string; decimals: number }
  | { kind: 'location-invalid'; path: string };

export function clonePluginParameterValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePluginParameterValue(entry)) as T;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        clonePluginParameterValue(entry),
      ]),
    ) as T;
  }
  return value;
}

export function replacePluginParameterChildValue(
  container: unknown,
  target: PluginParameterChildTarget,
  value: unknown,
): unknown {
  if (target.kind === 'struct') {
    return {
      ...(isPlainObject(container) ? container : {}),
      [target.key]: clonePluginParameterValue(value),
    };
  }
  const entries = Array.isArray(container) ? [...container] : [];
  entries[target.index] = clonePluginParameterValue(value);
  return entries;
}

export function removePluginParameterArrayItem(
  container: unknown,
  index: number,
): unknown[] {
  return (Array.isArray(container) ? container : [])
    .filter((_, itemIndex) => itemIndex !== index)
    .map((entry) => clonePluginParameterValue(entry));
}

export function createPluginParameterForm(plugin: ManagedPluginEntry): Record<string, unknown> {
  const form = cloneRecord(plugin.parameters);
  for (const field of plugin.parameterSchema?.fields || []) {
    if (!isPluginParameterFieldEditable(plugin, field)) continue;
    form[field.key] = normalizePluginParameterValue(
      field,
      plugin.parameters[field.key] ?? field.defaultValue,
    );
  }
  return form;
}

export function buildPluginParameterPayload(
  plugin: ManagedPluginEntry,
  form: Record<string, unknown>,
): Record<string, unknown> {
  const payload = cloneRecord(plugin.parameters);
  for (const field of plugin.parameterSchema?.fields || []) {
    if (!isPluginParameterFieldEditable(plugin, field)) continue;
    const baselineValue = normalizePluginParameterValue(
      field,
      plugin.parameters[field.key] ?? field.defaultValue,
    );
    if (stableSerialize(form[field.key]) === stableSerialize(baselineValue)) {
      continue;
    }
    payload[field.key] = serializePluginParameterValue(field, form[field.key]);
  }
  return payload;
}

export function pluginParameterPayloadsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

export function buildPluginParameterRows(
  plugin: ManagedPluginEntry,
  form: Record<string, unknown>,
  catalog: EditorProjectCatalog | null,
  labels: PluginParameterSummaryLabels,
  readonlyReason: string,
): PluginParameterRow[] {
  const fields = plugin.parameterSchema?.fields || [];
  const known = new Set(fields.map((field) => field.key));
  const rows = fields.map((field) => {
    const editable = isPluginParameterFieldEditable(plugin, field);
    const value = editable
      ? form[field.key]
      : plugin.parameters[field.key] ?? field.defaultValue;
    return {
      key: field.key,
      label: field.label || field.key,
      description: field.description || '',
      field,
      editable,
      readonlyReason: editable ? '' : field.unsupportedReason || readonlyReason,
      summary: summarizePluginParameterValue(field, value, catalog, labels),
      fullValue: displayPluginParameterValue(value),
    };
  });

  for (const [key, value] of Object.entries(plugin.parameters || {})) {
    if (known.has(key)) continue;
    rows.push({
      key,
      label: key,
      description: '',
      field: null,
      editable: false,
      readonlyReason,
      summary: summarizeUnknownPluginParameterValue(value, labels),
      fullValue: displayPluginParameterValue(value),
    });
  }
  return rows;
}

export function isPluginParameterFieldEditable(
  plugin: ManagedPluginEntry,
  field: PluginParameterSchemaField,
): boolean {
  return plugin.fileExists && isPluginParameterSchemaFieldEditable(field);
}

export function isPluginParameterSchemaFieldEditable(
  field: PluginParameterSchemaField,
): boolean {
  return field.editable !== false && field.kind !== 'json';
}

export function createDefaultPluginParameterValue(
  field?: PluginParameterSchemaField,
): unknown {
  if (!field) return '';
  if (field.kind === 'struct') {
    return Object.fromEntries((field.fields || []).map((child) => [
      child.key,
      createDefaultPluginParameterValue(child),
    ]));
  }
  if (field.kind === 'array') return [];
  if (field.kind === 'location') return { mapId: '0', x: '0', y: '0' };
  if (field.kind === 'boolean') return field.defaultValue ?? 'false';
  if (isNotePluginParameterField(field)) {
    return unwrapNotePluginParameterValue(field.defaultValue ?? '');
  }
  return field.defaultValue ?? '';
}

export function normalizePluginParameterValue(
  field: PluginParameterSchemaField,
  rawValue: unknown,
): unknown {
  const value = rawValue ?? field.defaultValue;
  if (field.kind === 'struct') {
    const parsed = parseStructuredValue(value);
    const source = isPlainObject(parsed) ? parsed : {};
    const normalized = clonePluginParameterValue(source);
    for (const child of field.fields || []) {
      normalized[child.key] = normalizePluginParameterValue(
        child,
        source[child.key] ?? child.defaultValue,
      );
    }
    return normalized;
  }
  if (field.kind === 'array') {
    const parsed = parseStructuredValue(value);
    if (!Array.isArray(parsed) || !field.item) return [];
    return parsed.map((entry) => normalizePluginParameterValue(field.item!, entry));
  }
  if (field.kind === 'location') {
    const parsed = parseStructuredValue(value);
    return isPlainObject(parsed)
      ? {
          mapId: scalarValue(parsed.mapId, '0'),
          x: scalarValue(parsed.x, '0'),
          y: scalarValue(parsed.y, '0'),
        }
      : { mapId: '0', x: '0', y: '0' };
  }
  if (value === undefined || value === null) {
    if (field.kind === 'boolean') return field.defaultValue ?? 'false';
    if (isNotePluginParameterField(field)) {
      return unwrapNotePluginParameterValue(field.defaultValue ?? '');
    }
    return field.defaultValue ?? '';
  }
  if (isNotePluginParameterField(field)) {
    return unwrapNotePluginParameterValue(value);
  }
  return value;
}

export function serializePluginParameterValue(
  field: PluginParameterSchemaField,
  value: unknown,
): unknown {
  if (field.kind === 'struct') {
    const source = isPlainObject(value) ? value : {};
    const serialized = clonePluginParameterValue(source);
    for (const child of field.fields || []) {
      serialized[child.key] = serializePluginParameterValue(child, source[child.key]);
    }
    return JSON.stringify(serialized);
  }
  if (field.kind === 'array') {
    const entries = Array.isArray(value) ? value : [];
    if (!field.item) return '[]';
    return JSON.stringify(entries.map((entry) =>
      field.item!.kind === 'struct' || field.item!.kind === 'array'
        ? serializePluginParameterValue(field.item!, entry)
        : serializeScalarPluginParameterValue(field.item!, entry),
    ));
  }
  if (field.kind === 'location') {
    const location = isPlainObject(value)
      ? {
          mapId: String(value.mapId ?? '0'),
          x: String(value.x ?? '0'),
          y: String(value.y ?? '0'),
        }
      : { mapId: '0', x: '0', y: '0' };
    return JSON.stringify(location);
  }
  return serializeScalarPluginParameterValue(field, value);
}

export function validatePluginParameterValue(
  field: PluginParameterSchemaField,
  value: unknown,
  path = field.key,
  baselineValue?: unknown,
): PluginParameterValidationIssue | null {
  if (!isPluginParameterSchemaFieldEditable(field)) return null;
  if (field.kind === 'number') {
    const text = String(value ?? '').trim();
    if (!text) {
      return String(baselineValue ?? '').trim()
        ? { kind: 'number-required', path }
        : null;
    }
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
      return { kind: 'number-invalid', path };
    }
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return { kind: 'number-invalid', path };
    if (typeof field.min === 'number' && numeric < field.min) {
      return { kind: 'number-min', path, min: field.min };
    }
    if (typeof field.max === 'number' && numeric > field.max) {
      return { kind: 'number-max', path, max: field.max };
    }
    if (typeof field.decimals === 'number') {
      const fraction = text.match(/\.(\d*)$/)?.[1] || '';
      if (fraction.length > field.decimals) {
        return {
          kind: 'number-decimals',
          path,
          decimals: field.decimals,
        };
      }
    }
    return null;
  }
  if (field.kind === 'location') {
    if (!isPlainObject(value)) return { kind: 'location-invalid', path };
    const values = [value.mapId, value.x, value.y].map(Number);
    if (values.some((entry) => !Number.isInteger(entry) || entry < 0)) {
      return { kind: 'location-invalid', path };
    }
    return null;
  }
  if (field.kind === 'struct') {
    const source = isPlainObject(value) ? value : {};
    for (const child of field.fields || []) {
      const issue = validatePluginParameterValue(
        child,
        source[child.key],
        `${path}.${child.key}`,
        isPlainObject(baselineValue) ? baselineValue[child.key] : undefined,
      );
      if (issue) return issue;
    }
    return null;
  }
  if (field.kind === 'array' && field.item) {
    const entries = Array.isArray(value) ? value : [];
    for (let index = 0; index < entries.length; index += 1) {
      const issue = validatePluginParameterValue(
        field.item,
        entries[index],
        `${path}[${index}]`,
        Array.isArray(baselineValue) ? baselineValue[index] : undefined,
      );
      if (issue) return issue;
    }
  }
  return null;
}

export function displayPluginParameterValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function summarizePluginParameterValue(
  field: PluginParameterSchemaField,
  value: unknown,
  catalog: EditorProjectCatalog | null,
  labels: PluginParameterSummaryLabels,
): string {
  if (field.kind === 'boolean') {
    const enabled = isBooleanParameterEnabled(value);
    const option = field.options?.find((entry) =>
      isBooleanParameterEnabled(entry.value) === enabled,
    );
    return option?.label || (enabled ? labels.enabled : labels.disabled);
  }
  if (field.kind === 'select') {
    const presentation = resolvePluginParameterSelectPresentation(field, value);
    return presentation?.label || summarizeScalar(value, labels);
  }
  if (field.kind === 'combo') {
    return field.options?.find((entry) => String(entry.value) === String(value))?.label
      || summarizeScalar(value, labels);
  }
  if (field.kind === 'database') {
    return summarizeDatabaseReference(field.databaseTable, value, catalog, labels);
  }
  if (field.kind === 'map') {
    const id = finiteNumber(value);
    const map = catalog?.maps?.find((entry) => entry.id === id);
    return map ? `${map.id} · ${map.name}` : summarizeScalar(value, labels);
  }
  if (field.kind === 'location') {
    const location = normalizePluginParameterValue(field, value) as {
      mapId: string;
      x: string;
      y: string;
    };
    const mapId = finiteNumber(location.mapId);
    const map = catalog?.maps?.find((entry) => entry.id === mapId);
    return labels.location(
      map ? `${map.id} · ${map.name}` : location.mapId,
      finiteNumber(location.x),
      finiteNumber(location.y),
    );
  }
  if (field.kind === 'array') {
    const parsed = parseStructuredValue(value);
    return labels.itemCount(Array.isArray(parsed) ? parsed.length : 0);
  }
  if (field.kind === 'struct') {
    return summarizeStructJson(value);
  }
  if (field.kind === 'multiline' || field.kind === 'json') {
    return summarizeMultiline(value, labels);
  }
  return summarizeScalar(value, labels);
}

/** Select options resolve to a friendly label for summaries. */
export function resolvePluginParameterSelectPresentation(
  field: Pick<PluginParameterSchemaField, 'kind' | 'options'> | null | undefined,
  value: unknown,
): { label: string; value: string } | null {
  if (!field || field.kind !== 'select') return null;
  const raw = value == null ? '' : String(value);
  if (!raw && !field.options?.length) return null;
  const option = field.options?.find((entry) => String(entry.value) === raw);
  if (option) {
    return {
      label: String(option.label || option.value),
      value: String(option.value),
    };
  }
  if (!raw) return null;
  return { label: raw, value: raw };
}

function summarizeUnknownPluginParameterValue(
  value: unknown,
  labels: PluginParameterSummaryLabels,
): string {
  if (Array.isArray(value)) return labels.itemCount(value.length);
  if (isPlainObject(value)) return summarizeStructJson(value);
  return summarizeMultiline(value, labels);
}

/** Compact JSON for the value column (RM-style object display). */
function summarizeStructJson(value: unknown): string {
  const parsed = parseStructuredValue(value);
  if (parsed === undefined || parsed === null) return '';
  if (typeof parsed === 'string' && !parsed.trim()) return '';
  try {
    return JSON.stringify(parsed);
  } catch {
    return String(parsed);
  }
}

function summarizeDatabaseReference(
  table: string | undefined,
  value: unknown,
  catalog: EditorProjectCatalog | null,
  labels: PluginParameterSummaryLabels,
): string {
  const keyByTable: Record<string, keyof EditorProjectCatalog> = {
    Actors: 'actors',
    Classes: 'classes',
    Skills: 'skills',
    Items: 'items',
    Weapons: 'weapons',
    Armors: 'armors',
    Enemies: 'enemies',
    Troops: 'troops',
    States: 'states',
    Animations: 'animations',
    Tilesets: 'tilesets',
    CommonEvents: 'commonEvents',
    'System.switches': 'switches',
    'System.variables': 'variables',
  };
  const key = keyByTable[table || ''];
  const entries = key ? catalog?.[key] : null;
  const id = finiteNumber(value);
  if (Array.isArray(entries)) {
    const match = entries.find((entry) =>
      Boolean(entry && typeof entry === 'object' && 'id' in entry && Number(entry.id) === id),
    ) as { id?: number; name?: string } | undefined;
    if (match?.name) return `${id} · ${match.name}`;
  }
  return summarizeScalar(value, labels);
}

function summarizeMultiline(value: unknown, labels: PluginParameterSummaryLabels): string {
  const text = displayPluginParameterValue(value).trim();
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const first = lines.find((line) => line.trim())?.trim() || '';
  return lines.length > 1 ? `${first}…` : first;
}

function summarizeScalar(value: unknown, _labels: PluginParameterSummaryLabels): string {
  return displayPluginParameterValue(value).trim();
}

function serializeScalarPluginParameterValue(
  field: PluginParameterSchemaField,
  value: unknown,
): unknown {
  if (field.kind === 'boolean') return isBooleanParameterEnabled(value) ? 'true' : 'false';
  if (isNotePluginParameterField(field)) {
    return wrapNotePluginParameterValue(value);
  }
  if (value === undefined || value === null) return '';
  return String(value);
}

export function isBooleanParameterEnabled(value: unknown): boolean {
  return value === true || ['true', 'on', '1'].includes(String(value).toLowerCase());
}

/** Reference / collection / struct summaries render as tags; plain text and numbers stay as text. */
export function isTaggedPluginParameterValue(
  field: Pick<PluginParameterSchemaField, 'kind'> | null | undefined,
): boolean {
  if (!field) return false;
  return field.kind === 'database'
    || field.kind === 'map'
    || field.kind === 'file'
    || field.kind === 'array'
    || field.kind === 'location'
    || field.kind === 'struct';
}

export function isNotePluginParameterField(
  field: Pick<PluginParameterSchemaField, 'rawType'> | null | undefined,
): boolean {
  return String(field?.rawType || '').trim().toLowerCase() === 'note';
}

/** MV note params store an extra JSON-string wrapper; strip it for editing. */
export function unwrapNotePluginParameterValue(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'string') return parsed;
  } catch {
    // MV may keep a literal outer quote pair around text that includes raw newlines.
  }
  return text.slice(1, -1);
}

/** Restore the MV note wrapper when writing back to plugins.js. */
export function wrapNotePluginParameterValue(value: unknown): string {
  return JSON.stringify(value == null ? '' : String(value));
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return clonePluginParameterValue(value || {});
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scalarValue(value: unknown, fallback: string): string {
  return value === undefined || value === null || value === ''
    ? fallback
    : String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
