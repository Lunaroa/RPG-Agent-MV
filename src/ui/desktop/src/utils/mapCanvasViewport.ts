export interface MapCellViewportInput {
  cellX: number;
  cellY: number;
  tileSize: number;
  zoom: number;
  safeMargin: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}

export interface MapCellViewportTarget {
  scrollLeft: number;
  scrollTop: number;
  moved: boolean;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function axisTarget(
  cellStart: number,
  cellSize: number,
  scroll: number,
  viewportSize: number,
  contentSize: number,
  requestedMargin: number,
): number {
  const maximumScroll = Math.max(0, contentSize - viewportSize);
  const current = Math.min(maximumScroll, finiteNonNegative(scroll));
  const margin = Math.min(
    finiteNonNegative(requestedMargin),
    Math.max(0, (viewportSize - cellSize) / 2),
  );
  const cellEnd = cellStart + cellSize;
  const visibleStart = current + margin;
  const visibleEnd = current + viewportSize - margin;
  if (cellStart >= visibleStart && cellEnd <= visibleEnd) return current;
  const centered = cellStart + cellSize / 2 - viewportSize / 2;
  return Math.max(0, Math.min(maximumScroll, centered));
}

/**
 * Calculates the scroll position needed to reveal one map cell. The calculation
 * is independent from DOM state so every caller uses the same zoom and edge
 * clamping rules.
 */
export function mapCellViewportTarget(input: MapCellViewportInput): MapCellViewportTarget {
  const displayTileSize = finiteNonNegative(input.tileSize) * finiteNonNegative(input.zoom);
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const contentWidth = Math.max(viewportWidth, finiteNonNegative(input.contentWidth));
  const contentHeight = Math.max(viewportHeight, finiteNonNegative(input.contentHeight));
  const currentLeft = Math.min(Math.max(0, contentWidth - viewportWidth), finiteNonNegative(input.scrollLeft));
  const currentTop = Math.min(Math.max(0, contentHeight - viewportHeight), finiteNonNegative(input.scrollTop));
  const scrollLeft = axisTarget(
    finiteNonNegative(input.cellX) * displayTileSize,
    displayTileSize,
    currentLeft,
    viewportWidth,
    contentWidth,
    input.safeMargin,
  );
  const scrollTop = axisTarget(
    finiteNonNegative(input.cellY) * displayTileSize,
    displayTileSize,
    currentTop,
    viewportHeight,
    contentHeight,
    input.safeMargin,
  );
  return {
    scrollLeft,
    scrollTop,
    moved: Math.abs(scrollLeft - currentLeft) > .5 || Math.abs(scrollTop - currentTop) > .5,
  };
}
