import type { PluginParameterMainColumnWidths } from '@contract/types'

export const DEFAULT_PLUGIN_PARAMETER_MAIN_COLUMNS: PluginParameterMainColumnWidths = {
  name: 300,
  type: 150,
}

const NAME_MIN = 160
const NAME_MAX = 720
const TYPE_MIN = 96
const TYPE_MAX = 360
const VALUE_MIN = 80
const VALUE_MAX = 720

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function clampPluginParameterNameColumn(width: number): number {
  return Math.max(NAME_MIN, Math.min(NAME_MAX, Math.round(width)))
}

export function clampPluginParameterTypeColumn(width: number): number {
  return Math.max(TYPE_MIN, Math.min(TYPE_MAX, Math.round(width)))
}

export function clampPluginParameterValueColumn(width: number): number {
  return Math.max(VALUE_MIN, Math.min(VALUE_MAX, Math.round(width)))
}

export function clampPluginParameterCollectionColumn(width: number): number {
  return clampPluginParameterValueColumn(width)
}

export function normalizePluginParameterMainColumns(
  input: unknown,
): PluginParameterMainColumnWidths {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const name = finiteNumber(source.name)
  const type = finiteNumber(source.type)
  const value = finiteNumber(source.value)
  const result: PluginParameterMainColumnWidths = {
    name: name == null
      ? DEFAULT_PLUGIN_PARAMETER_MAIN_COLUMNS.name
      : clampPluginParameterNameColumn(name),
    type: type == null
      ? DEFAULT_PLUGIN_PARAMETER_MAIN_COLUMNS.type
      : clampPluginParameterTypeColumn(type),
  }
  if (value != null) {
    result.value = clampPluginParameterValueColumn(value)
  }
  return result
}

export function normalizePluginParameterCollectionColumns(
  input: unknown,
): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: Record<string, number> = {}
  for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (!key.trim()) continue
    const width = finiteNumber(rawValue)
    if (width == null) continue
    result[key] = clampPluginParameterCollectionColumn(width)
  }
  return result
}
