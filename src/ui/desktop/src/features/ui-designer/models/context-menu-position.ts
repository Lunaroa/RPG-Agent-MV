export interface UiContextMenuPosition {
  x: number
  y: number
}

export const fitContextMenuPosition = (
  anchor: UiContextMenuPosition,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): UiContextMenuPosition => ({
  x: Math.max(margin, Math.min(anchor.x, Math.max(margin, viewport.width - menu.width - margin))),
  y: Math.max(margin, Math.min(anchor.y, Math.max(margin, viewport.height - menu.height - margin))),
})
