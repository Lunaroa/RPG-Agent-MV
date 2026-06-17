/**
 * 放置地图策略：Agent 登记的 targetMapId 仅为建议；实际落点以编辑器当前地图为准。
 */

export function canActivatePlacementOnMap(currentMapId: number | null | undefined): boolean {
  return Number.isInteger(currentMapId) && Number(currentMapId) > 0;
}

export function isSuggestedMapMismatch(
  suggestedMapId: number | null | undefined,
  currentMapId: number | null | undefined,
): boolean {
  if (!Number.isInteger(suggestedMapId) || Number(suggestedMapId) <= 0) return false;
  if (!Number.isInteger(currentMapId) || Number(currentMapId) <= 0) return false;
  return Number(suggestedMapId) !== Number(currentMapId);
}

export function formatSuggestedMapHint(suggestedMapId: number): string {
  return `建议 MAP${String(suggestedMapId).padStart(3, '0')}`;
}
