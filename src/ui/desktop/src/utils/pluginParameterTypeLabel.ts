import type { MessageKey } from '../i18n';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Canonical RM-style type id → i18n key. Aliases resolve here before lookup. */
const CANONICAL_TYPE_KEYS: Record<string, MessageKey> = {
  string: 'plugins.parameterTypeString',
  number: 'plugins.parameterTypeNumber',
  boolean: 'plugins.parameterTypeBoolean',
  select: 'plugins.parameterTypeSelect',
  combo: 'plugins.parameterTypeCombo',
  note: 'plugins.parameterTypeNote',
  file: 'plugins.parameterTypeFile',
  actor: 'plugins.parameterTypeActor',
  class: 'plugins.parameterTypeClass',
  skill: 'plugins.parameterTypeSkill',
  item: 'plugins.parameterTypeItem',
  weapon: 'plugins.parameterTypeWeapon',
  armor: 'plugins.parameterTypeArmor',
  enemy: 'plugins.parameterTypeEnemy',
  troop: 'plugins.parameterTypeTroop',
  state: 'plugins.parameterTypeState',
  animation: 'plugins.parameterTypeAnimation',
  tileset: 'plugins.parameterTypeTileset',
  common_event: 'plugins.parameterTypeCommonEvent',
  switch: 'plugins.parameterTypeSwitch',
  variable: 'plugins.parameterTypeVariable',
  map: 'plugins.parameterTypeMap',
  location: 'plugins.parameterTypeLocation',
};

/** Accepted aliases → canonical type id (same friendly label as the standard name). */
const TYPE_ALIASES: Record<string, string> = {
  string: 'string',
  text: 'string',
  number: 'number',
  numeric: 'number',
  integer: 'number',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  onoff: 'boolean',
  'on/off': 'boolean',
  select: 'select',
  dropdown: 'select',
  combo: 'combo',
  note: 'note',
  multiline_string: 'note',
  'multiline string': 'note',
  multiline: 'note',
  file: 'file',
  actor: 'actor',
  class: 'class',
  skill: 'skill',
  item: 'item',
  weapon: 'weapon',
  armor: 'armor',
  enemy: 'enemy',
  troop: 'troop',
  state: 'state',
  animation: 'animation',
  tileset: 'tileset',
  common_event: 'common_event',
  'common event': 'common_event',
  switch: 'switch',
  variable: 'variable',
  map: 'map',
  location: 'location',
};

const STRUCT_PATTERN = /^struct\s*<\s*([^>]+?)\s*>$/i;

/**
 * User-facing label for a plugin parameter `@type` string.
 * Standard RM types (and known aliases) are translated; anything else stays as written.
 */
export function formatPluginParameterTypeLabel(
  rawType: string | null | undefined,
  kindFallback: string | null | undefined,
  translate: Translate,
): string {
  const raw = String(rawType || '').trim();
  if (raw) {
    const labeled = labelRawType(raw, translate);
    return labeled ?? raw;
  }
  const kind = String(kindFallback || '').trim();
  if (!kind) return '';
  const labeled = labelRawType(kind, translate);
  return labeled ?? kind;
}

/** True when the displayed type string denotes an array (`[]` / `[][]`…). */
export function pluginParameterTypeLabelIsList(label: string): boolean {
  return /\[\s*\]/.test(String(label || ''));
}

function labelRawType(raw: string, translate: Translate): string | null {
  const arraySuffix = raw.match(/((?:\s*\[\s*\])+)$/);
  if (arraySuffix) {
    const base = raw.slice(0, -arraySuffix[1].length).trim();
    const brackets = arraySuffix[1].replace(/\s+/g, '');
    const baseLabel = labelScalarOrStruct(base, translate);
    if (baseLabel == null) return null;
    return `${baseLabel}${brackets}`;
  }
  return labelScalarOrStruct(raw, translate);
}

function labelScalarOrStruct(raw: string, translate: Translate): string | null {
  const structMatch = raw.match(STRUCT_PATTERN);
  if (structMatch) {
    return translate('plugins.parameterTypeStruct', { name: structMatch[1].trim() });
  }
  const normalized = raw.toLowerCase().trim();
  if (normalized.startsWith('file ') || normalized === 'file') {
    return translate(CANONICAL_TYPE_KEYS.file);
  }
  const canonical = TYPE_ALIASES[normalized];
  if (!canonical) return null;
  const key = CANONICAL_TYPE_KEYS[canonical];
  return key ? translate(key) : null;
}
