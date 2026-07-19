import type { MapPaintMode, PaletteTabId, TileTab } from '../components/editor/editorTypes.ts';

export const MV_REGION_PALETTE_COLS = 8;
export const MV_REGION_PALETTE_ROWS = 32;
export const MV_REGION_ALPHA = .5;

export const MV_REGION_SOURCE_COLORS = [
  '#830000', '#833700', '#838300', '#378300', '#008300', '#008337',
  '#008383', '#003783', '#000083', '#370083', '#830083', '#830037',
] as const;

export interface RegionPaletteCell {
  col: number;
  row: number;
}

export interface RegionPaletteLayout {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  cellSize: number;
  scaleX: number;
  scaleY: number;
}

export interface RegionViewport {
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
  displayTileSize: number;
}

export function regionIdForPaletteCell(col: number, row: number): number | null {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  if (col < 0 || col >= MV_REGION_PALETTE_COLS || row < 0 || row >= MV_REGION_PALETTE_ROWS) return null;
  return row * MV_REGION_PALETTE_COLS + col;
}

export function regionPaletteCellForId(regionId: number): RegionPaletteCell | null {
  if (!Number.isInteger(regionId) || regionId < 0 || regionId > 255) return null;
  return {
    col: regionId % MV_REGION_PALETTE_COLS,
    row: Math.floor(regionId / MV_REGION_PALETTE_COLS),
  };
}

export function regionSourceColor(regionId: number): string | null {
  if (!Number.isInteger(regionId) || regionId <= 0 || regionId > 255) return null;
  return MV_REGION_SOURCE_COLORS[(regionId - 1) % MV_REGION_SOURCE_COLORS.length];
}

export function regionPaletteLayout(containerWidth: number, devicePixelRatio = 1): RegionPaletteLayout {
  const cssWidth = Math.max(MV_REGION_PALETTE_COLS, Math.floor(Number(containerWidth) || 0));
  const cellSize = cssWidth / MV_REGION_PALETTE_COLS;
  const cssHeight = cellSize * MV_REGION_PALETTE_ROWS;
  const ratio = Math.max(1, Number(devicePixelRatio) || 1);
  const pixelWidth = Math.max(1, Math.round(cssWidth * ratio));
  const pixelHeight = Math.max(1, Math.round(cssHeight * ratio));
  return {
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
    cellSize,
    scaleX: pixelWidth / cssWidth,
    scaleY: pixelHeight / cssHeight,
  };
}

export function visibleRegionViewport(options: {
  mapWidth: number;
  mapHeight: number;
  tileSize: number;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  overscan?: number;
}): RegionViewport {
  const mapWidth = Math.max(0, Math.floor(options.mapWidth));
  const mapHeight = Math.max(0, Math.floor(options.mapHeight));
  const displayTileSize = Math.max(1, options.tileSize * options.zoom);
  const overscan = Math.max(0, Math.floor(options.overscan ?? 1));
  const startCol = Math.max(0, Math.floor(options.scrollLeft / displayTileSize) - overscan);
  const startRow = Math.max(0, Math.floor(options.scrollTop / displayTileSize) - overscan);
  const endCol = Math.min(mapWidth, Math.ceil((options.scrollLeft + options.viewportWidth) / displayTileSize) + overscan);
  const endRow = Math.min(mapHeight, Math.ceil((options.scrollTop + options.viewportHeight) / displayTileSize) + overscan);
  return { startCol, endCol, startRow, endRow, displayTileSize };
}

export function regionLabelFontSize(size: number): number {
  return Math.max(1, size * 3 / 8);
}

export function paintModeForPaletteTab(tab: PaletteTabId): Extract<MapPaintMode, 'tile' | 'region'> {
  return tab === 'R' ? 'region' : 'tile';
}

export function tileTabForShadow(tab: PaletteTabId, lastTileTab: TileTab): TileTab {
  return tab === 'R' ? lastTileTab : tab;
}

export function drawMvRegionFill(
  context: CanvasRenderingContext2D,
  regionId: number,
  x: number,
  y: number,
  size: number,
): void {
  const sourceColor = regionSourceColor(regionId);
  if (!sourceColor) return;
  context.save();
  context.globalAlpha = MV_REGION_ALPHA;
  context.fillStyle = sourceColor;
  context.fillRect(x, y, size, size);
  context.restore();
}

export function drawMvRegionLabel(
  context: CanvasRenderingContext2D,
  regionId: number,
  x: number,
  y: number,
  size: number,
): void {
  if (!regionSourceColor(regionId)) return;
  context.save();
  context.fillStyle = '#fff';
  context.font = `${regionLabelFontSize(size)}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0, 0, 0, .82)';
  context.shadowBlur = 0;
  context.shadowOffsetX = 1;
  context.shadowOffsetY = 1;
  context.fillText(String(regionId), x + size / 2, y + size / 2);
  context.restore();
}

export function drawMvRegionMarker(
  context: CanvasRenderingContext2D,
  regionId: number,
  x: number,
  y: number,
  size: number,
): void {
  drawMvRegionFill(context, regionId, x, y, size);
  drawMvRegionLabel(context, regionId, x, y, size);
}
