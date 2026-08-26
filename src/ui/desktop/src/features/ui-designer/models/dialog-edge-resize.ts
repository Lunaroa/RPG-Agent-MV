export type UiDialogResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export interface UiDialogRect {
  left: number
  top: number
  width: number
  height: number
}

export interface UiDialogResizeConstraints {
  viewportWidth: number
  viewportHeight: number
  minWidth: number
  minHeight: number
  margin?: number
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export function resizeDialogFromEdge(
  origin: UiDialogRect,
  edge: UiDialogResizeEdge,
  deltaX: number,
  deltaY: number,
  constraints: UiDialogResizeConstraints,
): UiDialogRect {
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
