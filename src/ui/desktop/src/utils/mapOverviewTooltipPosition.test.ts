import { describe, expect, it } from 'vitest'

import { placeMapOverviewTooltip } from './mapOverviewTooltipPosition'

describe('map overview edge tooltip placement', () => {
  it('places the tooltip after the pointer when there is room', () => {
    expect(placeMapOverviewTooltip({
      viewportWidth: 800,
      viewportHeight: 600,
      tooltipWidth: 200,
      tooltipHeight: 80,
      pointerX: 100,
      pointerY: 120,
    })).toEqual({ x: 112, y: 132 })
  })

  it('flips and clamps the tooltip inside the visible map surface near an edge', () => {
    expect(placeMapOverviewTooltip({
      viewportWidth: 320,
      viewportHeight: 220,
      tooltipWidth: 180,
      tooltipHeight: 90,
      pointerX: 310,
      pointerY: 214,
    })).toEqual({ x: 118, y: 112 })
  })
})
