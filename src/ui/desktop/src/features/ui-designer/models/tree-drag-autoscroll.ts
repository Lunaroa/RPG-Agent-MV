export const UI_TREE_DRAG_AUTOSCROLL_EDGE_SIZE = 48
export const UI_TREE_DRAG_AUTOSCROLL_MAX_STEP = 18

export function resolveTreeDragAutoScrollDelta(
  clientY: number,
  top: number,
  bottom: number,
  edgeSize = UI_TREE_DRAG_AUTOSCROLL_EDGE_SIZE,
  maxStep = UI_TREE_DRAG_AUTOSCROLL_MAX_STEP,
): number {
  if (![clientY, top, bottom, edgeSize, maxStep].every(Number.isFinite) || bottom <= top || edgeSize <= 0 || maxStep <= 0) return 0
  if (clientY < top || clientY > bottom) return 0
  const edge = Math.min(edgeSize, (bottom - top) / 2)
  if (clientY < top + edge) {
    const intensity = (top + edge - clientY) / edge
    return -Math.max(1, Math.ceil(maxStep * intensity))
  }
  if (clientY > bottom - edge) {
    const intensity = (clientY - (bottom - edge)) / edge
    return Math.max(1, Math.ceil(maxStep * intensity))
  }
  return 0
}
