import type { MvMap } from '../composables/useMapRenderer';
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { translate } from '../i18n/messages.ts';

export interface PlacementCellValidity {
  valid: boolean;
  reason?: string;
}

const DIRECTION_BITS = [1, 2, 4, 8] as const;

/** 与 backend map-space.isPassable / classifyPassage 对齐的简化通行判定 */
export function isTileStackPassable(map: MvMap, flags: number[], x: number, y: number): boolean {
  const tileIds: number[] = [];
  for (let z = 3; z >= 0; z -= 1) {
    const index = z * map.height * map.width + y * map.width + x;
    tileIds.push(map.data[index] || 0);
  }
  for (const bit of DIRECTION_BITS) {
    let passable = false;
    for (const tileId of tileIds) {
      const flag = flags[tileId] || 0;
      if ((flag & 0x10) !== 0) continue;
      if ((flag & bit) === 0) {
        passable = true;
        break;
      }
      if ((flag & bit) === bit) {
        passable = false;
        break;
      }
    }
    if (passable) return true;
  }
  return false;
}

export function validatePlacementCell(
  map: MvMap | null,
  _flags: number[] | null | undefined,
  x: number,
  y: number,
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): PlacementCellValidity {
  language = normalizeProductLanguage(language);
  if (!map) return { valid: false, reason: translate('placement.cell.mapNotLoaded', language) };
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { valid: false, reason: translate('placement.cell.outsideBounds', language) };
  }
  if (map.events?.some((event) => event && event.x === x && event.y === y)) {
    return { valid: false, reason: translate('placement.cell.hasEvent', language) };
  }
  return { valid: true };
}

export function placementValidityHint(
  validity: PlacementCellValidity,
  cell: { x: number; y: number } | null,
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): string {
  language = normalizeProductLanguage(language);
  if (!cell) return translate('placement.cell.moveCursorHint', language);
  if (validity.valid) {
    return translate('placement.cell.placeHint', language, { x: cell.x, y: cell.y });
  }
  return validity.reason || translate('placement.cell.cannotPlace', language);
}
