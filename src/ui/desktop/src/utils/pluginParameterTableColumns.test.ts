import { describe, expect, it } from 'vitest'
import {
  clampPluginParameterCollectionColumn,
  clampPluginParameterNameColumn,
  clampPluginParameterTypeColumn,
  clampPluginParameterValueColumn,
  DEFAULT_PLUGIN_PARAMETER_MAIN_COLUMNS,
  normalizePluginParameterCollectionColumns,
  normalizePluginParameterMainColumns,
} from './pluginParameterTableColumns'

describe('pluginParameterTableColumns', () => {
  it('exposes default main column widths', () => {
    expect(DEFAULT_PLUGIN_PARAMETER_MAIN_COLUMNS).toEqual({ name: 300, type: 150 })
  })

  it('clamps main and collection column widths', () => {
    expect(clampPluginParameterNameColumn(100)).toBe(160)
    expect(clampPluginParameterNameColumn(800)).toBe(720)
    expect(clampPluginParameterTypeColumn(50)).toBe(96)
    expect(clampPluginParameterTypeColumn(500)).toBe(360)
    expect(clampPluginParameterValueColumn(40)).toBe(80)
    expect(clampPluginParameterValueColumn(900)).toBe(720)
    expect(clampPluginParameterCollectionColumn(900)).toBe(720)
  })

  it('normalizes main columns with defaults and optional value', () => {
    expect(normalizePluginParameterMainColumns({})).toEqual({ name: 300, type: 150 })
    expect(normalizePluginParameterMainColumns({ name: 400.4, type: 120.4 })).toEqual({
      name: 400,
      type: 120,
    })
    expect(normalizePluginParameterMainColumns({ name: 400, type: 120, value: 240.8 })).toEqual({
      name: 400,
      type: 120,
      value: 241,
    })
    expect(normalizePluginParameterMainColumns({ value: 240 })).toEqual({
      name: 300,
      type: 150,
      value: 240,
    })
  })

  it('normalizes collection column maps and drops invalid entries', () => {
    expect(normalizePluginParameterCollectionColumns(null)).toEqual({})
    expect(normalizePluginParameterCollectionColumns({
      colA: 200.2,
      '': 100,
      bad: Number.NaN,
    })).toEqual({ colA: 200 })
  })
})
