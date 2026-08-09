import type { UiDesignerDocument, UiRuntimeSceneExport } from './ui-designer'

export type UiDesignerPane = 'left' | 'center' | 'right'

export const UI_DESIGNER_PANE_LIMITS: Record<UiDesignerPane, { min: number; max: number; fallback: number }> = {
  left: { min: 200, max: 500, fallback: 260 },
  center: { min: 320, max: 1400, fallback: 640 },
  right: { min: 240, max: 550, fallback: 320 },
}

/** Canonical integer policy shared by editor, persistence, import, and backend validation. */
export function normalizeUiDesignerInteger(value: unknown, fallback: number, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  const safeFallback = typeof fallback === 'number' && Number.isFinite(fallback) ? Math.round(fallback) : 0
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.min(maximum, Math.max(minimum, safeFallback))
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function normalizeUiDesignerPaneSize(side: UiDesignerPane, value: unknown, fallback = UI_DESIGNER_PANE_LIMITS[side].fallback): number {
  const limits = UI_DESIGNER_PANE_LIMITS[side]
  return normalizeUiDesignerInteger(value, fallback, limits.min, limits.max)
}

/** Deterministically migrates legacy decimal geometry without changing hierarchy or other properties. */
export function normalizeUiDesignerDocumentGeometry(document: UiDesignerDocument): UiDesignerDocument {
  const next = JSON.parse(JSON.stringify(document)) as UiDesignerDocument
  const canvasWidth = normalizeUiDesignerInteger(next.canvas.width, next.meta.canvasWidth, 1)
  const canvasHeight = normalizeUiDesignerInteger(next.canvas.height, next.meta.canvasHeight, 1)
  next.canvas.width = canvasWidth
  next.canvas.height = canvasHeight
  next.meta.canvasWidth = canvasWidth
  next.meta.canvasHeight = canvasHeight
  for (const node of next.nodes) {
    node.props.x = normalizeUiDesignerInteger(node.props.x, 0)
    node.props.y = normalizeUiDesignerInteger(node.props.y, 0)
    node.props.width = normalizeUiDesignerInteger(node.props.width, 1, 1)
    node.props.height = normalizeUiDesignerInteger(node.props.height, 1, 1)
  }
  return next
}

/** Runtime JSON uses the same integer geometry contract as the editor document. */
export function normalizeUiRuntimeSceneGeometry(scene: UiRuntimeSceneExport): UiRuntimeSceneExport {
  const next = JSON.parse(JSON.stringify(scene)) as UiRuntimeSceneExport
  next.meta.canvasWidth = normalizeUiDesignerInteger(next.meta.canvasWidth, 1, 1)
  next.meta.canvasHeight = normalizeUiDesignerInteger(next.meta.canvasHeight, 1, 1)
  for (const node of next.nodes) {
    node.props.x = normalizeUiDesignerInteger(node.props.x, 0)
    node.props.y = normalizeUiDesignerInteger(node.props.y, 0)
    node.props.width = normalizeUiDesignerInteger(node.props.width, 1, 1)
    node.props.height = normalizeUiDesignerInteger(node.props.height, 1, 1)
  }
  return next
}
