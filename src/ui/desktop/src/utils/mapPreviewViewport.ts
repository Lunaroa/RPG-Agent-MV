export const PREVIEW_MIN_VISIBLE_EDGE = 48;

export interface PreviewPanOffset {
  x: number;
  y: number;
}

export function previewPointerMovedBeyondClick(
  start: PreviewPanOffset,
  current: PreviewPanOffset,
  threshold = 4,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > Math.max(0, threshold);
}

export interface PreviewPanBoundsInput extends PreviewPanOffset {
  viewportWidth: number;
  viewportHeight: number;
  renderedWidth: number;
  renderedHeight: number;
}

export interface PreviewVisibleRegionInput extends PreviewPanOffset {
  viewportWidth: number;
  viewportHeight: number;
  mapWidth: number;
  mapHeight: number;
  scale: number;
}

export interface PreviewVisibleRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export function clampPreviewPanOffset(
  offset: number,
  viewportSize: number,
  renderedSize: number,
  minimumVisibleEdge = PREVIEW_MIN_VISIBLE_EDGE,
): number {
  if (viewportSize <= 0 || renderedSize <= 0) return 0;
  const visibleEdge = Math.min(minimumVisibleEdge, viewportSize, renderedSize);
  const maximumOffset = Math.max(0, (viewportSize + renderedSize) / 2 - visibleEdge);
  return Math.max(-maximumOffset, Math.min(maximumOffset, offset));
}

export function clampPreviewPan(input: PreviewPanBoundsInput): PreviewPanOffset {
  return {
    x: clampPreviewPanOffset(input.x, input.viewportWidth, input.renderedWidth),
    y: clampPreviewPanOffset(input.y, input.viewportHeight, input.renderedHeight),
  };
}

export function previewVisibleRegion(input: PreviewVisibleRegionInput): PreviewVisibleRegion | null {
  if (
    input.viewportWidth <= 0
    || input.viewportHeight <= 0
    || input.mapWidth <= 0
    || input.mapHeight <= 0
    || input.scale <= 0
  ) return null;
  const renderedWidth = input.mapWidth * input.scale;
  const renderedHeight = input.mapHeight * input.scale;
  const mapLeft = (input.viewportWidth - renderedWidth) / 2 + input.x;
  const mapTop = (input.viewportHeight - renderedHeight) / 2 + input.y;
  const x = Math.max(0, Math.min(input.mapWidth - 1, -mapLeft / input.scale));
  const y = Math.max(0, Math.min(input.mapHeight - 1, -mapTop / input.scale));
  const right = Math.max(x + 1, Math.min(input.mapWidth, (input.viewportWidth - mapLeft) / input.scale));
  const bottom = Math.max(y + 1, Math.min(input.mapHeight, (input.viewportHeight - mapTop) / input.scale));
  return { x, y, width: right - x, height: bottom - y, scale: input.scale };
}
