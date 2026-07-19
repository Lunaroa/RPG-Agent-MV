export type ShadowQuarterBit = 1 | 2 | 4 | 8;
export type ShadowStrokeAction = 'add' | 'remove';

export interface ShadowQuarterPoint {
  quarterX: number;
  quarterY: number;
  x: number;
  y: number;
  bit: ShadowQuarterBit;
}

export interface ShadowCellEdit {
  x: number;
  y: number;
  shadowBits: number;
}

export function shadowQuarterFromGrid(
  quarterX: number,
  quarterY: number,
  mapWidth: number,
  mapHeight: number,
): ShadowQuarterPoint | null {
  if (!Number.isInteger(quarterX) || !Number.isInteger(quarterY) || quarterX < 0 || quarterY < 0) return null;
  const x = Math.floor(quarterX / 2);
  const y = Math.floor(quarterY / 2);
  if (x >= mapWidth || y >= mapHeight) return null;
  const right = quarterX % 2 === 1;
  const bottom = quarterY % 2 === 1;
  const bit: ShadowQuarterBit = bottom ? (right ? 8 : 4) : (right ? 2 : 1);
  return { quarterX, quarterY, x, y, bit };
}

export function shadowQuarterAtCanvasPoint(
  px: number,
  py: number,
  tileSize: number,
  mapWidth: number,
  mapHeight: number,
): ShadowQuarterPoint | null {
  if (![px, py, tileSize, mapWidth, mapHeight].every(Number.isFinite) || tileSize <= 0) return null;
  const quarterSize = tileSize / 2;
  return shadowQuarterFromGrid(Math.floor(px / quarterSize), Math.floor(py / quarterSize), mapWidth, mapHeight);
}

export function rasterShadowQuarterLine(
  from: Pick<ShadowQuarterPoint, 'quarterX' | 'quarterY'>,
  to: Pick<ShadowQuarterPoint, 'quarterX' | 'quarterY'>,
  mapWidth: number,
  mapHeight: number,
): ShadowQuarterPoint[] {
  const points: ShadowQuarterPoint[] = [];
  let x = from.quarterX;
  let y = from.quarterY;
  const dx = Math.abs(to.quarterX - from.quarterX);
  const sx = from.quarterX < to.quarterX ? 1 : -1;
  const dy = -Math.abs(to.quarterY - from.quarterY);
  const sy = from.quarterY < to.quarterY ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    const point = shadowQuarterFromGrid(x, y, mapWidth, mapHeight);
    if (point) points.push(point);
    if (x === to.quarterX && y === to.quarterY) return points;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

export function shadowStrokeAction(currentBits: number, bit: ShadowQuarterBit): ShadowStrokeAction {
  return (currentBits & bit) !== 0 ? 'remove' : 'add';
}

export function applyShadowStrokeAction(
  currentBits: number,
  bit: ShadowQuarterBit,
  action: ShadowStrokeAction,
): number {
  const normalized = Math.max(0, Math.min(15, Math.floor(currentBits)));
  return action === 'add' ? normalized | bit : normalized & ~bit;
}

export function shadowQuarterStrokeEdits(
  quarters: readonly ShadowQuarterPoint[],
  action: ShadowStrokeAction,
  readShadowBits: (x: number, y: number) => number,
  visited: Set<string>,
): ShadowCellEdit[] {
  const values = new Map<string, ShadowCellEdit>();
  for (const quarter of quarters) {
    const quarterKey = `${quarter.x},${quarter.y},${quarter.bit}`;
    if (visited.has(quarterKey)) continue;
    visited.add(quarterKey);
    const cellKey = `${quarter.x},${quarter.y}`;
    const current = values.get(cellKey)?.shadowBits ?? readShadowBits(quarter.x, quarter.y);
    const shadowBits = applyShadowStrokeAction(current, quarter.bit, action);
    if (shadowBits !== current) values.set(cellKey, { x: quarter.x, y: quarter.y, shadowBits });
  }
  return [...values.values()];
}
