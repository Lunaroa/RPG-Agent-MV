export interface MapCellPoint {
  x: number;
  y: number;
}

export interface InclusiveCellRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface RectBrushFootprint {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
}

export interface PatternPlacement extends MapCellPoint {
  sourceDx: number;
  sourceDy: number;
}

export interface MapCellBounds {
  width: number;
  height: number;
}

export function normalizeInclusiveCellRect(from: MapCellPoint, to: MapCellPoint): InclusiveCellRect {
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxX = Math.max(from.x, to.x);
  const maxY = Math.max(from.y, to.y);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function brushOriginAt(pointer: MapCellPoint, footprint: RectBrushFootprint): MapCellPoint {
  return {
    x: pointer.x - footprint.hotspotX,
    y: pointer.y - footprint.hotspotY,
  };
}

export function brushRectAt(pointer: MapCellPoint, footprint: RectBrushFootprint): InclusiveCellRect {
  const origin = brushOriginAt(pointer, footprint);
  return {
    minX: origin.x,
    minY: origin.y,
    maxX: origin.x + footprint.width - 1,
    maxY: origin.y + footprint.height - 1,
    width: footprint.width,
    height: footprint.height,
  };
}

export function brushDragRect(
  from: MapCellPoint,
  to: MapCellPoint,
  footprint: RectBrushFootprint,
): InclusiveCellRect {
  const start = brushRectAt(from, footprint);
  const end = brushRectAt(to, footprint);
  const minX = Math.min(start.minX, end.minX);
  const minY = Math.min(start.minY, end.minY);
  const maxX = Math.max(start.maxX, end.maxX);
  const maxY = Math.max(start.maxY, end.maxY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function patternPlacements(
  from: MapCellPoint,
  to: MapCellPoint,
  footprint: RectBrushFootprint,
  shape: 'rect' | 'ellipse',
): PatternPlacement[] {
  const bounds = brushDragRect(from, to, footprint);
  // Anchor the repeated source pattern to the normalized target bounds. This
  // makes the final map data independent of the user's drag direction while
  // preserving the hotspot for ordinary stamp placement.
  const phase = { x: bounds.minX, y: bounds.minY };
  const singleStamp = from.x === to.x && from.y === to.y;
  const placements: PatternPlacement[] = [];
  const rx = Math.max(.5, bounds.width / 2);
  const ry = Math.max(.5, bounds.height / 2);
  const cx = bounds.minX + rx - .5;
  const cy = bounds.minY + ry - .5;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!singleStamp && shape === 'ellipse' && (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1)) continue;
      placements.push({
        x,
        y,
        sourceDx: positiveModulo(x - phase.x, footprint.width),
        sourceDy: positiveModulo(y - phase.y, footprint.height),
      });
    }
  }
  return placements;
}

export function brushPathPatternPlacements(
  pointers: readonly MapCellPoint[],
  anchor: MapCellPoint,
  footprint: RectBrushFootprint,
  mapBounds?: MapCellBounds,
): PatternPlacement[] {
  const phase = brushOriginAt(anchor, footprint);
  const placements = new Map<string, PatternPlacement>();

  for (const pointer of pointers) {
    const bounds = brushRectAt(pointer, footprint);
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (mapBounds && (x < 0 || y < 0 || x >= mapBounds.width || y >= mapBounds.height)) continue;
        placements.set(`${x},${y}`, {
          x,
          y,
          sourceDx: positiveModulo(x - phase.x, footprint.width),
          sourceDy: positiveModulo(y - phase.y, footprint.height),
        });
      }
    }
  }

  return [...placements.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}

export function rasterMapCellLine(from: MapCellPoint, to: MapCellPoint): MapCellPoint[] {
  const cells: MapCellPoint[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    cells.push({ x, y });
    if (x === to.x && y === to.y) return cells;
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

function positiveModulo(value: number, divisor: number): number {
  if (!Number.isInteger(divisor) || divisor <= 0) throw new Error('Brush dimensions must be positive integers.');
  return ((value % divisor) + divisor) % divisor;
}
