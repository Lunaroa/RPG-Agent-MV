/** Canonical six-field transfer edge key shared by overview snapshot + UI. */
export function mapOverviewEdgeAggregateKey(input: {
  sourceMapId: number
  sourceX: number
  sourceY: number
  targetMapId: number
  targetX: number
  targetY: number
}): string {
  return `${input.sourceMapId}:${input.sourceX},${input.sourceY}->${input.targetMapId}:${input.targetX},${input.targetY}`
}
