export const DIALOG_RESIZE_EDGES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const

export type DialogResizeEdge = (typeof DIALOG_RESIZE_EDGES)[number]

export interface DialogRect {
  left: number
  top: number
  width: number
  height: number
}

export interface DialogResizeConstraints {
  viewportWidth: number
  viewportHeight: number
  minWidth: number
  minHeight: number
  margin?: number
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export function resizeDialogFromEdge(
  origin: DialogRect,
  edge: DialogResizeEdge,
  deltaX: number,
  deltaY: number,
  constraints: DialogResizeConstraints,
): DialogRect {
  const margin = Math.max(0, constraints.margin ?? 8)
  const viewportRight = Math.max(margin, constraints.viewportWidth - margin)
  const viewportBottom = Math.max(margin, constraints.viewportHeight - margin)
  const originRight = origin.left + origin.width
  const originBottom = origin.top + origin.height
  const minWidth = Math.min(Math.max(1, constraints.minWidth), viewportRight - margin)
  const minHeight = Math.min(Math.max(1, constraints.minHeight), viewportBottom - margin)

  let left = origin.left
  let right = originRight
  let top = origin.top
  let bottom = originBottom

  if (edge.includes('w')) left = clamp(origin.left + deltaX, margin, originRight - minWidth)
  if (edge.includes('e')) right = clamp(originRight + deltaX, origin.left + minWidth, viewportRight)
  if (edge.includes('n')) top = clamp(origin.top + deltaY, margin, originBottom - minHeight)
  if (edge.includes('s')) bottom = clamp(originBottom + deltaY, origin.top + minHeight, viewportBottom)

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  }
}

export function centeredDialogTranslation(
  rect: DialogRect,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  return {
    x: Math.round(rect.left - (viewportWidth - rect.width) / 2),
    y: Math.round(rect.top - (viewportHeight - rect.height) / 2),
  }
}
