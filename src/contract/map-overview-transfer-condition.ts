export type MapOverviewTransferConditionType = 'switch' | 'variable' | 'self-switch';

export type MapOverviewTransferConditionCategory =
  | 'none'
  | 'switch'
  | 'variable'
  | 'self-switch'
  | 'combined';

export interface MapOverviewTransferVariableCondition {
  id: number;
  operator: '>=';
  value: number;
}

export interface MapOverviewTransferConditionSummary {
  types: MapOverviewTransferConditionType[];
  switchIds: number[];
  variable: MapOverviewTransferVariableCondition | null;
  selfSwitch: 'A' | 'B' | 'C' | 'D' | null;
  hasOtherPageConditions: boolean;
}

export interface MapOverviewTransferConditionVisual {
  stroke: string;
  dashArray: string | null;
}

export const MAP_OVERVIEW_TRANSFER_CONDITION_CATEGORIES: readonly MapOverviewTransferConditionCategory[] = [
  'none',
  'switch',
  'variable',
  'self-switch',
  'combined',
] as const;

const VISUALS: Record<MapOverviewTransferConditionCategory, MapOverviewTransferConditionVisual> = {
  none: { stroke: '#c65f3d', dashArray: null },
  switch: { stroke: '#3f6fb5', dashArray: null },
  variable: { stroke: '#3f6fb5', dashArray: null },
  'self-switch': { stroke: '#3f6fb5', dashArray: null },
  combined: { stroke: '#7b4bb3', dashArray: '7 5' },
};

export function summarizeMapOverviewTransferConditions(
  pageConditions: Record<string, unknown>,
): MapOverviewTransferConditionSummary {
  const switchIds = [
    readEnabledPositiveId(pageConditions, 'switch1Valid', 'switch1Id'),
    readEnabledPositiveId(pageConditions, 'switch2Valid', 'switch2Id'),
  ].filter((id): id is number => id != null);
  const variableId = readEnabledPositiveId(pageConditions, 'variableValid', 'variableId');
  const variableValue = finiteNumber(pageConditions.variableValue);
  const variable = variableId != null && variableValue != null
    ? { id: variableId, operator: '>=' as const, value: variableValue }
    : null;
  const selfSwitchValue = pageConditions.selfSwitchCh;
  const selfSwitch = pageConditions.selfSwitchValid === true
    && (selfSwitchValue === 'A' || selfSwitchValue === 'B' || selfSwitchValue === 'C' || selfSwitchValue === 'D')
    ? selfSwitchValue
    : null;
  const types: MapOverviewTransferConditionType[] = [];
  if (switchIds.length) types.push('switch');
  if (variable) types.push('variable');
  if (selfSwitch) types.push('self-switch');
  return {
    types,
    switchIds: [...new Set(switchIds)].sort((left, right) => left - right),
    variable,
    selfSwitch,
    hasOtherPageConditions: hasEnabledOtherPageCondition(pageConditions),
  };
}

export function classifyMapOverviewTransferConditions(
  pageConditions: Record<string, unknown>,
): MapOverviewTransferConditionCategory {
  return categoryFromTypes(summarizeMapOverviewTransferConditions(pageConditions).types);
}

export function classifyMapOverviewEdgeConditions(
  sources: readonly Pick<{ pageConditions: Record<string, unknown> }, 'pageConditions'>[],
): MapOverviewTransferConditionCategory {
  const types = new Set<MapOverviewTransferConditionType>();
  for (const source of sources) {
    for (const type of summarizeMapOverviewTransferConditions(source.pageConditions).types) types.add(type);
  }
  return categoryFromTypes([...types]);
}

export function mapOverviewTransferConditionVisual(
  category: MapOverviewTransferConditionCategory,
): MapOverviewTransferConditionVisual {
  return VISUALS[category];
}

export function isMapOverviewTransferConditionCategory(
  value: unknown,
): value is MapOverviewTransferConditionCategory {
  return typeof value === 'string'
    && MAP_OVERVIEW_TRANSFER_CONDITION_CATEGORIES.includes(value as MapOverviewTransferConditionCategory);
}

function categoryFromTypes(
  types: readonly MapOverviewTransferConditionType[],
): MapOverviewTransferConditionCategory {
  if (types.length === 0) return 'none';
  if (types.length > 1) return 'combined';
  return types[0];
}

function readEnabledPositiveId(
  conditions: Record<string, unknown>,
  enabledKey: string,
  idKey: string,
): number | null {
  if (conditions[enabledKey] !== true) return null;
  const value = finiteNumber(conditions[idKey]);
  return value != null && Number.isInteger(value) && value > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasEnabledOtherPageCondition(conditions: Record<string, unknown>): boolean {
  return conditions.itemValid === true || conditions.actorValid === true;
}
