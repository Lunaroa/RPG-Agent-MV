import { describe, expect, it } from 'vitest'

import {
  buildMapOverviewLayoutOptions,
  compareMapOverviewLayoutByMapId,
  computeMapOverviewCircularRadius,
  DEFAULT_MAP_OVERVIEW_LAYOUT_ID,
  isMapOverviewLayoutId,
  isMapOverviewLibraryLayoutId,
  MAP_OVERVIEW_GRID_SORT_BY_EXPR,
  MAP_OVERVIEW_LAYOUT_CONFIRM_I18N,
  MAP_OVERVIEW_LAYOUT_IDS,
  MAP_OVERVIEW_LAYOUT_NODE_SIZE_EXPR,
  MAP_OVERVIEW_LAYOUTS,
  mapOverviewLayoutSizePayload,
  parseMapOverviewLayoutId,
  sortMapOverviewLayoutNodesByMapId,
} from './mapOverviewLayouts'

const sampleCtx = {
  nodes: [
    { mapId: 3, width: 480, collisionHeight: 516 },
    { mapId: 1, width: 960, collisionHeight: 756 },
    { mapId: 2, width: 240, collisionHeight: 276 },
  ],
  width: 1600,
  height: 900,
  nodeSpacing: 24,
}

describe('mapOverviewLayouts', () => {
  it('registers layered grid and the five library layout ids with i18n stubs', () => {
    expect(MAP_OVERVIEW_LAYOUT_IDS).toEqual([
      'layered-grid',
      'force-atlas2',
      'd3-force',
      'antv-dagre',
      'grid',
      'circular',
    ])
    expect(DEFAULT_MAP_OVERVIEW_LAYOUT_ID).toBe('layered-grid')
    expect(MAP_OVERVIEW_LAYOUTS.map((item) => item.id)).toEqual([...MAP_OVERVIEW_LAYOUT_IDS])
    expect(MAP_OVERVIEW_LAYOUTS.map((item) => item.labelKey)).toEqual([
      'mapOverview.layout.layeredGrid',
      'mapOverview.layout.forceAtlas2',
      'mapOverview.layout.d3Force',
      'mapOverview.layout.antvDagre',
      'mapOverview.layout.grid',
      'mapOverview.layout.circular',
    ])
    expect(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.title).toBe('mapOverview.layout.confirmTitle')
    expect(MAP_OVERVIEW_LAYOUT_CONFIRM_I18N.apply).toBe('mapOverview.layout.confirmApply')
  })

  it('validates layout ids strictly', () => {
    expect(isMapOverviewLayoutId('force-atlas2')).toBe(true)
    expect(isMapOverviewLayoutId('layered-grid')).toBe(true)
    expect(isMapOverviewLibraryLayoutId('layered-grid')).toBe(false)
    expect(isMapOverviewLibraryLayoutId('force-atlas2')).toBe(true)
    expect(isMapOverviewLayoutId('dagre')).toBe(false)
    expect(isMapOverviewLayoutId('elk')).toBe(false)
    expect(isMapOverviewLayoutId(null)).toBe(false)
    expect(parseMapOverviewLayoutId('circular')).toBe('circular')
    expect(parseMapOverviewLayoutId('nope')).toBe('layered-grid')
  })

  it('builds nested-worker-disabled options for the five library layouts', () => {
    for (const id of MAP_OVERVIEW_LAYOUT_IDS.filter(isMapOverviewLibraryLayoutId)) {
      const options = buildMapOverviewLayoutOptions(id, sampleCtx)
      expect(options.type).toBe(id)
      expect(options.enableWorker).toBe(false)
      expect(options.nodeSize).toBe(MAP_OVERVIEW_LAYOUT_NODE_SIZE_EXPR)
      expect(options.width).toBe(1600)
      expect(options.height).toBe(900)
      if (id !== 'antv-dagre') expect(options.nodeSpacing).toBe(24)
      else expect(options.nodeSpacing).toBeUndefined()
    }
  })

  it('configures size-aware collision and layout-specific fields', () => {
    const atlas = buildMapOverviewLayoutOptions('force-atlas2', sampleCtx)
    expect(atlas.preventOverlap).toBe(true)
    expect(atlas.barnesHut).toBe(true)

    const d3 = buildMapOverviewLayoutOptions('d3-force', sampleCtx)
    expect(d3.preventOverlap).toBe(true)
    expect(d3.collideStrength).toBe(1)

    const dagre = buildMapOverviewLayoutOptions('antv-dagre', sampleCtx)
    expect(dagre.rankdir).toBe('LR')
    expect(typeof dagre.nodesep).toBe('number')
    expect(typeof dagre.ranksep).toBe('number')
    expect(dagre.nodesep).toBeGreaterThan(0)
    expect(dagre.ranksep).toBeGreaterThan(dagre.nodesep as number)

    const grid = buildMapOverviewLayoutOptions('grid', sampleCtx)
    expect(grid.preventOverlap).toBe(true)
    expect(grid.condense).toBe(true)
    expect(grid.sortBy).toBe(MAP_OVERVIEW_GRID_SORT_BY_EXPR)
    expect(grid.sortBy).not.toBe('mapId')

    const circular = buildMapOverviewLayoutOptions('circular', sampleCtx)
    expect(circular.ordering).toBeNull()
    expect(circular.radius).toBe(computeMapOverviewCircularRadius(sampleCtx.nodes, 24))
    expect(typeof circular.radius).toBe('number')
    expect(circular.radius).toBeGreaterThan(100)
  })

  it('payload and mapId helpers support graph wiring', () => {
    expect(mapOverviewLayoutSizePayload({ width: 960, collisionHeight: 756 })).toEqual([960, 756])
    expect(compareMapOverviewLayoutByMapId({ mapId: 1 }, { mapId: 2 })).toBeLessThan(0)
    expect(sortMapOverviewLayoutNodesByMapId(sampleCtx.nodes).map((n) => n.mapId)).toEqual([1, 2, 3])
  })
})
