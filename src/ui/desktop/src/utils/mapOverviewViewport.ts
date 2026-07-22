/** Absolute zoom floor for Map Overview (0.1%). Fit view may use this dynamically. */
export const MAP_OVERVIEW_MIN_ZOOM = 0.001
/** Absolute zoom ceiling for Map Overview (600%). */
export const MAP_OVERVIEW_MAX_ZOOM = 6
/** Cytoscape / G6 wheel zoom sensitivity. */
export const MAP_OVERVIEW_WHEEL_SENSITIVITY = 1.65
export const MAP_OVERVIEW_ZOOM_STEP = 0.25

export function clampMapOverviewZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.max(MAP_OVERVIEW_MIN_ZOOM, Math.min(MAP_OVERVIEW_MAX_ZOOM, zoom))
}

/** Parse a percent draft (supports decimals). Empty / non-finite → null. */
export function parseMapOverviewZoomPercent(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  return value
}

export function clampMapOverviewZoomPercent(percent: number): number {
  return clampMapOverviewZoom(percent / 100) * 100
}

export function formatMapOverviewZoomPercent(zoom: number, digits = 0): string {
  const percent = clampMapOverviewZoom(zoom) * 100
  if (digits <= 0) return String(Math.round(percent))
  const fixed = percent.toFixed(digits)
  return fixed.replace(/\.?0+$/, '')
}

export function mapOverviewZoomFromPercent(percent: number): number {
  return clampMapOverviewZoom(percent / 100)
}

export function mapOverviewPercentFromZoom(zoom: number): number {
  return clampMapOverviewZoom(zoom) * 100
}
