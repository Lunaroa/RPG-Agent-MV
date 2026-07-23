export interface MapOverviewTooltipPlacementInput {
  viewportWidth: number
  viewportHeight: number
  tooltipWidth: number
  tooltipHeight: number
  pointerX: number
  pointerY: number
  gap?: number
  margin?: number
}

export interface MapOverviewTooltipPlacement {
  x: number
  y: number
}

export function placeMapOverviewTooltip(
  input: MapOverviewTooltipPlacementInput,
): MapOverviewTooltipPlacement {
  const gap = input.gap ?? 12
  const margin = input.margin ?? 8
  let x = input.pointerX + gap
  let y = input.pointerY + gap
  if (x + input.tooltipWidth + margin > input.viewportWidth) {
    x = input.pointerX - input.tooltipWidth - gap
  }
  if (y + input.tooltipHeight + margin > input.viewportHeight) {
    y = input.pointerY - input.tooltipHeight - gap
  }
  return {
    x: Math.max(margin, Math.min(x, Math.max(margin, input.viewportWidth - input.tooltipWidth - margin))),
    y: Math.max(margin, Math.min(y, Math.max(margin, input.viewportHeight - input.tooltipHeight - margin))),
  }
}
