import type { MvMap } from '../composables/useMapRenderer';

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
): PlacementCellValidity {
  if (!map) return { valid: false, reason: '未加载地图' };
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return { valid: false, reason: '超出地图范围' };
  }
  if (map.events?.some((event) => event && event.x === x && event.y === y)) {
    return { valid: false, reason: '该格已有事件' };
  }
  return { valid: true };
}

export function placementValidityHint(validity: PlacementCellValidity, cell: { x: number; y: number } | null): string {
  if (!cell) return '将鼠标移到目标格子上';
  if (validity.valid) return `左键在 (${cell.x}, ${cell.y}) 放置 · Ctrl+滚轮旋转朝向 · 滚轮平移画布 · 右键菜单`;
  return validity.reason || '无法在此格放置';
}
