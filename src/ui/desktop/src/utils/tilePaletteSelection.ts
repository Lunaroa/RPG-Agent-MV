import type { PaletteCell } from './mvTilePalette.ts';

export type PaletteSelectionButton = 0 | 2;

export interface PaletteRectSelection<T extends object> {
  cells: Array<T & { dx: number; dy: number }>;
  width: number;
  height: number;
  hotspotX: 0;
  hotspotY: 0;
}

export function paletteSelectionButton(button: number, regionTab: boolean): PaletteSelectionButton | null {
  if (button === 0) return 0;
  if (button === 2 && !regionTab) return 2;
  return null;
}

export function paletteSelectionReleaseMatches(
  activeButton: PaletteSelectionButton | null,
  releasedButton: number,
): boolean {
  return activeButton != null && activeButton === releasedButton;
}

export function buildPaletteRectSelection<T extends object>(
  start: PaletteCell,
  end: PaletteCell,
  pickCell: (col: number, row: number) => T | null,
): PaletteRectSelection<T> | null {
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const cells: Array<T & { dx: number; dy: number }> = [];

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const pick = pickCell(col, row);
      if (pick) cells.push({ dx: col - minCol, dy: row - minRow, ...pick });
    }
  }

  if (!cells.length) return null;
  return {
    cells,
    width: maxCol - minCol + 1,
    height: maxRow - minRow + 1,
    hotspotX: 0,
    hotspotY: 0,
  };
}
