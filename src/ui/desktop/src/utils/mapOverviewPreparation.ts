export interface MapOverviewPreparedPosition {
  id: string
  x: number
  y: number
}

export interface MapOverviewThumbnailFailure {
  mapId: number
  error: unknown
}

export function mapOverviewPreparationPercent(completed: number, total: number): number {
  if (!Number.isInteger(completed) || !Number.isInteger(total) || completed < 0 || total < 0 || completed > total) {
    throw new Error('Invalid map overview preparation progress.')
  }
  return total === 0 ? 0 : Math.round((completed / total) * 100)
}

export function firstMapOverviewThumbnailFailure(
  failures: readonly MapOverviewThumbnailFailure[],
): MapOverviewThumbnailFailure | null {
  return failures.length ? [...failures].sort((left, right) => left.mapId - right.mapId)[0] : null
}

export function isMapOverviewThumbnailVersionChanged(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return /map overview thumbnail version changed/i.test(message)
}

export function validateMapOverviewLayoutPositions(
  expectedIds: readonly string[],
  positions: readonly MapOverviewPreparedPosition[],
): void {
  const expected = new Set(expectedIds)
  if (positions.length !== expected.size || positions.some((position) => !expected.has(position.id))) {
    throw new Error('Map overview layout did not return a position for every map.')
  }
  if (positions.some((position) => !Number.isFinite(position.x) || !Number.isFinite(position.y))) {
    throw new Error('Map overview layout returned a non-finite map position.')
  }
  if (positions.length > 1) {
    const unique = new Set(positions.map((position) => `${position.x.toFixed(4)}:${position.y.toFixed(4)}`))
    if (unique.size === 1) throw new Error('Map overview layout placed every map at the same position.')
  }
}
