/** Pure selection / layout helpers for the project-asset explorer grid. */

export interface ProjectAssetSelectionState {
  selectedIds: readonly string[];
  anchorId: string | null;
}

export interface ProjectAssetGridCellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectAssetGridLayoutInput {
  columnCount: number;
  cellWidth: number;
  cellHeight: number;
  gap: number;
  /** Content-coordinate offset of the first grid cell (e.g. grid inset padding). */
  originX?: number;
  originY?: number;
  /** Leading non-file cells (folder tiles) occupying grid slots before orderedIds[0]. */
  leadingItemCount?: number;
}

export interface ProjectAssetContentRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function emptyProjectAssetSelection(): ProjectAssetSelectionState {
  return { selectedIds: [], anchorId: null };
}

/** Click without modifiers: select only this id and set it as the anchor. */
export function selectProjectAssetExclusive(id: string): ProjectAssetSelectionState {
  return { selectedIds: [id], anchorId: id };
}

/** Ctrl/Cmd click: toggle membership; always move the anchor to the clicked id. */
export function toggleProjectAssetSelection(
  state: ProjectAssetSelectionState,
  id: string,
): ProjectAssetSelectionState {
  const selected = new Set(state.selectedIds);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  return {
    selectedIds: Object.freeze([...selected]),
    anchorId: id,
  };
}

/**
 * Shift click: select the contiguous range from anchor to target in orderedIds.
 * Missing anchor falls back to exclusive select of the target (Explorer-like).
 * Range replaces the previous selection.
 */
export function selectProjectAssetRange(
  orderedIds: readonly string[],
  state: ProjectAssetSelectionState,
  targetId: string,
): ProjectAssetSelectionState {
  const targetIndex = orderedIds.indexOf(targetId);
  if (targetIndex < 0) {
    throw new Error(`Shift-select target is not in the ordered list: ${targetId}`);
  }
  const anchorId = state.anchorId;
  if (!anchorId) {
    return selectProjectAssetExclusive(targetId);
  }
  const anchorIndex = orderedIds.indexOf(anchorId);
  if (anchorIndex < 0) {
    return selectProjectAssetExclusive(targetId);
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return {
    selectedIds: Object.freeze(orderedIds.slice(start, end + 1)),
    anchorId,
  };
}

/** Ctrl+A: select every id in the current ordered (file) list; anchor stays or becomes first. */
export function selectAllProjectAssets(
  orderedIds: readonly string[],
  state: ProjectAssetSelectionState = emptyProjectAssetSelection(),
): ProjectAssetSelectionState {
  if (orderedIds.length === 0) return emptyProjectAssetSelection();
  const anchorId = state.anchorId && orderedIds.includes(state.anchorId)
    ? state.anchorId
    : orderedIds[0]!;
  return {
    selectedIds: Object.freeze([...orderedIds]),
    anchorId,
  };
}

export function clearProjectAssetSelection(): ProjectAssetSelectionState {
  return emptyProjectAssetSelection();
}

/** Drop ids that no longer exist (e.g. after delete) while preserving order and anchor when possible. */
export function pruneProjectAssetSelection(
  state: ProjectAssetSelectionState,
  survivingIds: ReadonlySet<string> | readonly string[],
): ProjectAssetSelectionState {
  const alive = survivingIds instanceof Set ? survivingIds : new Set(survivingIds);
  const selectedIds = state.selectedIds.filter((id) => alive.has(id));
  const anchorId = state.anchorId && alive.has(state.anchorId)
    ? state.anchorId
    : selectedIds[selectedIds.length - 1] || null;
  return { selectedIds: Object.freeze(selectedIds), anchorId };
}

export function projectAssetCellRectAtIndex(
  index: number,
  layout: ProjectAssetGridLayoutInput,
): ProjectAssetGridCellRect {
  const columnCount = Math.max(1, Math.floor(layout.columnCount));
  const cellWidth = Math.max(0, layout.cellWidth);
  const cellHeight = Math.max(0, layout.cellHeight);
  const gap = Math.max(0, layout.gap);
  const originX = layout.originX ?? 0;
  const originY = layout.originY ?? 0;
  const strideX = cellWidth + gap;
  const strideY = cellHeight + gap;
  const row = Math.floor(index / columnCount);
  const column = index % columnCount;
  return {
    x: originX + column * strideX,
    y: originY + row * strideY,
    width: cellWidth,
    height: cellHeight,
  };
}

export function projectAssetRectsIntersect(
  a: ProjectAssetContentRect,
  b: ProjectAssetContentRect,
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Marquee hit-test against the full ordered id list using layout math (not DOM / not visible window).
 * Rectangles are in content coordinates (origin at top-left of the scrollable grid content).
 * `leadingItemCount` shifts file indices past leading folder tiles that share the same grid.
 */
export function hitTestProjectAssetMarquee(
  orderedIds: readonly string[],
  layout: ProjectAssetGridLayoutInput,
  marquee: ProjectAssetContentRect,
): string[] {
  const normalized = normalizeContentRect(marquee);
  const leading = Math.max(0, Math.floor(layout.leadingItemCount ?? 0));
  const hits: string[] = [];
  for (let index = 0; index < orderedIds.length; index += 1) {
    const cell = projectAssetCellRectAtIndex(index + leading, layout);
    const cellRect: ProjectAssetContentRect = {
      left: cell.x,
      top: cell.y,
      right: cell.x + cell.width,
      bottom: cell.y + cell.height,
    };
    if (projectAssetRectsIntersect(normalized, cellRect)) {
      hits.push(orderedIds[index]!);
    }
  }
  return hits;
}

/** Replace selection with marquee hits; anchor becomes the last hit (or null if empty). */
export function selectProjectAssetsByMarquee(
  orderedIds: readonly string[],
  layout: ProjectAssetGridLayoutInput,
  marquee: ProjectAssetContentRect,
): ProjectAssetSelectionState {
  const hits = hitTestProjectAssetMarquee(orderedIds, layout, marquee);
  if (hits.length === 0) return emptyProjectAssetSelection();
  return {
    selectedIds: Object.freeze(hits),
    anchorId: hits[hits.length - 1]!,
  };
}

/** Convert a viewport-local point into content coordinates using the host scroll offset. */
export function viewportPointToContentPoint(
  viewportX: number,
  viewportY: number,
  scrollLeft: number,
  scrollTop: number,
): { x: number; y: number } {
  return {
    x: viewportX + scrollLeft,
    y: viewportY + scrollTop,
  };
}

export function normalizeContentRect(rect: ProjectAssetContentRect): ProjectAssetContentRect {
  return {
    left: Math.min(rect.left, rect.right),
    right: Math.max(rect.left, rect.right),
    top: Math.min(rect.top, rect.bottom),
    bottom: Math.max(rect.top, rect.bottom),
  };
}
