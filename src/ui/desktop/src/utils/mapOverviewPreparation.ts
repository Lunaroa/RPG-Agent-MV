export interface MapOverviewPreparedPosition {
  id: string
  x: number
  y: number
}

export interface MapOverviewPreparedNodeRect {
  id: string
  width: number
  height: number
}

export interface MapOverviewThumbnailFailure {
  mapId: number
  error: unknown
}

export interface MapOverviewLayoutOverlapInspection {
  count: number
  first: { leftId: string; rightId: string } | null
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

export function validateMapOverviewLayoutNoOverlap(
  nodes: readonly MapOverviewPreparedNodeRect[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
): void {
  const inspection = inspectMapOverviewLayoutOverlaps(nodes, positions)
  if (inspection.first) {
    throw new Error(`Map overview layout overlaps nodes ${inspection.first.leftId} and ${inspection.first.rightId}.`)
  }
}

export function inspectMapOverviewLayoutOverlaps(
  nodes: readonly MapOverviewPreparedNodeRect[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
): MapOverviewLayoutOverlapInspection {
  let count = 0
  let first: MapOverviewLayoutOverlapInspection['first'] = null
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]
    const leftPosition = positions[left.id]
    if (!leftPosition) throw new Error(`Map overview layout is missing node ${left.id}.`)
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]
      const rightPosition = positions[right.id]
      if (!rightPosition) throw new Error(`Map overview layout is missing node ${right.id}.`)
      const separatedX = Math.abs(leftPosition.x - rightPosition.x) >= (left.width + right.width) / 2
      const separatedY = Math.abs(leftPosition.y - rightPosition.y) >= (left.height + right.height) / 2
      if (!separatedX && !separatedY) {
        count += 1
        first ||= { leftId: left.id, rightId: right.id }
      }
    }
  }
  return { count, first }
}
