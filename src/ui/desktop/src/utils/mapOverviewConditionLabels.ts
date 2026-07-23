import type { MapOverviewEdge, NamedCatalogEntry } from '@contract/types'
import {
  summarizeMapOverviewTransferConditions,
  type MapOverviewTransferConditionSummary,
  type MapOverviewTransferConditionType,
} from '@contract/map-overview-transfer-condition'
import type { MessageKey } from '../i18n'

export type MapOverviewConditionTranslate = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string

export interface MapOverviewConditionNameMaps {
  switches: ReadonlyMap<number, string>
  variables: ReadonlyMap<number, string>
}

export function buildMapOverviewConditionNameMaps(
  switches: readonly NamedCatalogEntry[] = [],
  variables: readonly NamedCatalogEntry[] = [],
): MapOverviewConditionNameMaps {
  return {
    switches: catalogNameMap(switches),
    variables: catalogNameMap(variables),
  }
}

export function formatMapOverviewConditionDetails(
  summary: MapOverviewTransferConditionSummary,
  t: MapOverviewConditionTranslate,
  names: MapOverviewConditionNameMaps,
): string[] {
  const details: string[] = []
  for (const id of summary.switchIds) {
    const name = names.switches.get(id)
    details.push(name
      ? t('mapOverview.condition.switchDetailNamed', { name })
      : t('mapOverview.condition.switchDetail', { id }))
  }
  if (summary.variable) {
    const name = names.variables.get(summary.variable.id)
    details.push(name
      ? t('mapOverview.condition.variableDetailNamed', {
        name,
        operator: summary.variable.operator,
        value: summary.variable.value,
      })
      : t('mapOverview.condition.variableDetail', {
        id: summary.variable.id,
        operator: summary.variable.operator,
        value: summary.variable.value,
      }))
  }
  if (summary.selfSwitch) {
    details.push(t('mapOverview.condition.selfSwitchDetail', { channel: summary.selfSwitch }))
  }
  if (!summary.types.length) {
    details.push(summary.hasOtherPageConditions
      ? t('mapOverview.condition.noneRelevantWithOther')
      : t('mapOverview.condition.noneRelevant'))
  }
  return details
}

export function formatMapOverviewEdgeConditionLabel(
  edge: Pick<MapOverviewEdge, 'sources'>,
  t: MapOverviewConditionTranslate,
  names: MapOverviewConditionNameMaps,
): string {
  const types = new Set<MapOverviewTransferConditionType>()
  const detailSet = new Set<string>()
  let hasOtherPageConditions = false
  for (const source of edge.sources) {
    const summary = summarizeMapOverviewTransferConditions(source.pageConditions)
    for (const type of summary.types) types.add(type)
    hasOtherPageConditions ||= summary.hasOtherPageConditions
    if (!summary.types.length) continue
    for (const detail of formatMapOverviewConditionDetails(summary, t, names)) {
      detailSet.add(detail)
    }
  }
  let label = detailSet.size
    ? [...detailSet].join('；')
    : types.size > 1
      ? t('mapOverview.tooltip.combinedCondition')
      : t('mapOverview.tooltip.noTrackedCondition')
  if (hasOtherPageConditions) {
    label += t('mapOverview.tooltip.otherConditionSuffix')
  }
  return label
}

function catalogNameMap(entries: readonly NamedCatalogEntry[]): Map<number, string> {
  const names = new Map<number, string>()
  for (const entry of entries) {
    const trimmed = entry.name.trim()
    if (!trimmed) continue
    names.set(entry.id, trimmed)
  }
  return names
}
