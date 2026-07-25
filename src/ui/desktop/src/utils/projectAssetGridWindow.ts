/** Pure windowing arithmetic for the project-asset virtualized grid. */

export interface ProjectAssetGridWindowInput {
  containerWidth: number;
  containerHeight: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  itemCount: number;
  scrollTop: number;
  overscanRows?: number;
}

export interface ProjectAssetGridWindow {
  columnCount: number;
  rowCount: number;
  totalHeight: number;
  startRow: number;
  endRow: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Compute which cells to render for a fixed-size grid with vertical scrolling.
 * A container narrower than one cell still yields one column so layout stays defined.
 */
export function computeProjectAssetGridWindow(
  input: ProjectAssetGridWindowInput,
): ProjectAssetGridWindow {
  const cellWidth = Math.max(0, input.cellWidth);
  const cellHeight = Math.max(0, input.cellHeight);
  const gap = Math.max(0, input.gap);
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const containerWidth = Math.max(0, input.containerWidth);
  const containerHeight = Math.max(0, input.containerHeight);
  const overscanRows = Math.max(0, Math.floor(input.overscanRows ?? 2));
  const strideX = cellWidth + gap;
  const strideY = cellHeight + gap;

  const columnCount = cellWidth <= 0
    ? 1
    : Math.max(1, Math.floor((containerWidth + gap) / strideX));

  const rowCount = itemCount === 0 ? 0 : Math.ceil(itemCount / columnCount);
  const totalHeight = rowCount === 0
    ? 0
    : rowCount * cellHeight + Math.max(0, rowCount - 1) * gap;

  if (rowCount === 0 || strideY <= 0) {
    return {
      columnCount,
      rowCount,
      totalHeight,
      startRow: 0,
      endRow: 0,
      startIndex: 0,
      endIndex: 0,
    };
  }

  const maxScrollTop = Math.max(0, totalHeight - containerHeight);
  const scrollTop = Math.min(Math.max(0, input.scrollTop), maxScrollTop);
  const visibleRows = Math.max(1, Math.ceil(containerHeight / strideY) + 1);
  const rawStart = Math.floor(scrollTop / strideY);
  const startRow = Math.max(0, rawStart - overscanRows);
  const endRow = Math.min(rowCount, rawStart + visibleRows + overscanRows);
  const startIndex = startRow * columnCount;
  const endIndex = Math.min(itemCount, endRow * columnCount);

  return {
    columnCount,
    rowCount,
    totalHeight,
    startRow,
    endRow,
    startIndex,
    endIndex,
  };
}
