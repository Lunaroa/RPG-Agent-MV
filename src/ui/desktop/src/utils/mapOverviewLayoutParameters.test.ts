import { describe, expect, it } from 'vitest'

import {
  defaultMapOverviewLayoutParameters,
  MapOverviewLayoutParameterError,
  normalizeMapOverviewLayoutParametersState,
  parseMapOverviewLayoutParameters,
} from './mapOverviewLayoutParameters'

describe('map overview layout parameters', () => {
  it('provides the approved defaults for all six layouts', () => {
    expect(defaultMapOverviewLayoutParameters('layered-grid')).toEqual({
      horizontalSpacing: 24,
      layerSpacing: 48,
      groupSpacing: 96,
    })
    expect(defaultMapOverviewLayoutParameters('force-atlas2')).toEqual({
      nodeSpacing: 24,
      repulsion: 5,
      centerGravity: 1,
    })
    expect(defaultMapOverviewLayoutParameters('d3-force')).toEqual({
      nodeSpacing: 24,
      linkDistance: 50,
      nodeRepulsion: 30,
    })
    expect(defaultMapOverviewLayoutParameters('antv-dagre')).toEqual({
      direction: 'LR',
      nodeSpacing: null,
      layerSpacing: null,
    })
    expect(defaultMapOverviewLayoutParameters('grid')).toEqual({
      columns: null,
      nodeSpacing: 24,
    })
    expect(defaultMapOverviewLayoutParameters('circular')).toEqual({
      radius: null,
      clockwise: true,
      startAngle: 0,
    })
  })

  it('accepts optional auto values and parses numeric drafts', () => {
    expect(parseMapOverviewLayoutParameters('grid', {
      columns: '',
      nodeSpacing: '32',
    })).toEqual({ columns: null, nodeSpacing: 32 })
    expect(parseMapOverviewLayoutParameters('circular', {
      radius: '',
      clockwise: false,
      startAngle: '270',
    })).toEqual({ radius: null, clockwise: false, startAngle: 270 })
  })

  it('rejects invalid fields without clamping or guessing', () => {
    expect(() => parseMapOverviewLayoutParameters('layered-grid', {
      horizontalSpacing: 7,
      layerSpacing: 48,
      groupSpacing: 96,
    })).toThrow(MapOverviewLayoutParameterError)
    expect(() => parseMapOverviewLayoutParameters('grid', {
      columns: 2.5,
      nodeSpacing: 24,
    })).toThrow(/integer/)
    expect(() => parseMapOverviewLayoutParameters('antv-dagre', {
      direction: 'diagonal',
      nodeSpacing: null,
      layerSpacing: null,
    })).toThrow(/choice/)
  })

  it('keeps valid saved values per layout and drops invalid saved entries', () => {
    expect(normalizeMapOverviewLayoutParametersState({
      grid: { columns: 8, nodeSpacing: 30 },
      circular: { radius: 50, clockwise: true, startAngle: 0 },
      unknown: { value: 1 },
    })).toEqual({
      grid: { columns: 8, nodeSpacing: 30 },
    })
  })
})
