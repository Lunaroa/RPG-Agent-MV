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
  return plugin.fileExists && field.editable !== false && field.kind !== 'json';
}

export function normalizePluginParameterValue(
  field: PluginParameterSchemaField,
  rawValue: unknown,
): unknown {
  const value = rawValue ?? field.defaultValue;
  if (field.kind === 'struct') {
    const parsed = parseStructuredValue(value);
    const source = isPlainObject(parsed) ? parsed : {};
    return Object.fromEntries((field.fields || []).map((child) => [
      child.key,
      normalizePluginParameterValue(child, source[child.key] ?? child.defaultValue),
    ]));
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
          mapId: finiteNumber(parsed.mapId),
          x: finiteNumber(parsed.x),
          y: finiteNumber(parsed.y),
        }
      : { mapId: 0, x: 0, y: 0 };
  }
  if (value === undefined || value === null) {
    if (field.kind === 'boolean') return field.defaultValue ?? 'false';
    return field.defaultValue ?? '';
  }
  return value;
}

export function serializePluginParameterValue(
  field: PluginParameterSchemaField,
  value: unknown,
): unknown {
  if (field.kind === 'struct') {
    const source = isPlainObject(value) ? value : {};
    return JSON.stringify(Object.fromEntries((field.fields || []).map((child) => [
      child.key,
      serializePluginParameterValue(child, source[child.key]),
    ])));
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
          mapId: finiteNumber(value.mapId),
          x: finiteNumber(value.x),
          y: finiteNumber(value.y),
        }
      : { mapId: 0, x: 0, y: 0 };
    return JSON.stringify(location);
  }
  return serializeScalarPluginParameterValue(field, value);
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

function summarizePluginParameterValue(
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
  if (field.kind === 'select' || field.kind === 'combo') {
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
      mapId: number;
      x: number;
      y: number;
    };
    const map = catalog?.maps?.find((entry) => entry.id === location.mapId);
    return labels.location(
      map ? `${map.id} · ${map.name}` : String(location.mapId),
      location.x,
      location.y,
    );
  }
  if (field.kind === 'array') {
    const parsed = parseStructuredValue(value);
    return labels.itemCount(Array.isArray(parsed) ? parsed.length : 0);
  }
  if (field.kind === 'struct') {
    return labels.structuredValue;
  }
  if (field.kind === 'multiline' || field.kind === 'json') {
    return summarizeMultiline(value, labels);
  }
  return summarizeScalar(value, labels);
}

function summarizeUnknownPluginParameterValue(
  value: unknown,
  labels: PluginParameterSummaryLabels,
): string {
  if (Array.isArray(value)) return labels.itemCount(value.length);
  if (isPlainObject(value)) return labels.structuredValue;
  return summarizeMultiline(value, labels);
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
  if (!text) return labels.empty;
  const lines = text.split(/\r?\n/);
  const first = lines.find((line) => line.trim())?.trim() || '';
  return lines.length > 1 ? `${first}…` : first;
}

function summarizeScalar(value: unknown, labels: PluginParameterSummaryLabels): string {
  const text = displayPluginParameterValue(value).trim();
  return text || labels.empty;
}

function serializeScalarPluginParameterValue(
  field: PluginParameterSchemaField,
  value: unknown,
): unknown {
  if (field.kind === 'boolean') return isBooleanParameterEnabled(value) ? 'true' : 'false';
  if (value === undefined || value === null) return '';
  return value;
}

function isBooleanParameterEnabled(value: unknown): boolean {
  return value === true || ['true', 'on', '1'].includes(String(value).toLowerCase());
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
