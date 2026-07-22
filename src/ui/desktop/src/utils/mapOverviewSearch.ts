import type { MapOverviewNode } from '@contract/types'

export function findMapOverviewMatches(
  nodes: MapOverviewNode[],
  rawQuery: string,
  limit = 12,
): MapOverviewNode[] {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return []
  const numeric = /^(?:map)?0*(\d+)$/i.exec(query)
  const mapId = numeric ? Number(numeric[1]) : null
  return nodes
    .filter((node) => node.name.toLocaleLowerCase().includes(query) || node.id === mapId)
    .slice(0, Math.max(0, limit))
}
