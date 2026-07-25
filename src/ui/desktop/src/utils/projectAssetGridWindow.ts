/** Pure windowing arithmetic for the project-asset virtualized grid. */

export interface ProjectAssetGridWindowInput {
  containerWidth: number;
  containerHeight: number;
  cellSize: number;
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
  const cellSize = Math.max(0, input.cellSize);
  const gap = Math.max(0, input.gap);
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  const containerWidth = Math.max(0, input.containerWidth);
  const containerHeight = Math.max(0, input.containerHeight);
  const overscanRows = Math.max(0, Math.floor(input.overscanRows ?? 2));
  const stride = cellSize + gap;

  const columnCount = cellSize <= 0
    ? 1
    : Math.max(1, Math.floor((containerWidth + gap) / stride));

  const rowCount = itemCount === 0 ? 0 : Math.ceil(itemCount / columnCount);
  const totalHeight = rowCount === 0
    ? 0
    : rowCount * cellSize + Math.max(0, rowCount - 1) * gap;

  if (rowCount === 0 || stride <= 0) {
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
  const visibleRows = Math.max(1, Math.ceil(containerHeight / stride) + 1);
  const rawStart = Math.floor(scrollTop / stride);
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
