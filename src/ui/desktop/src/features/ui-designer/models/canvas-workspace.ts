import type { UiDesignerDocument, UiNode, UiPoint, UiRect } from '@contract/ui-designer'
import { nodeVisualRect } from './geometry'

export interface UiCanvasWorkspace {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type UiCanvasWorkspaceDraftPositions = Readonly<Record<string, UiPoint>>

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

/**
 * Builds an editing surface around the scene and every visible node. The
 * surface grows with node coordinates, so the gutter is navigation room and
 * never a positional boundary.
 */
export function resolveCanvasWorkspace(
  document: UiDesignerDocument,
  gutter = 240,
  draftPositions: UiCanvasWorkspaceDraftPositions = {},
): UiCanvasWorkspace {
  const safeGutter = Math.max(0, finite(gutter, 0))
  let minX = 0
  let minY = 0
  let maxX = Math.max(1, finite(document.canvas.width, 1))
  let maxY = Math.max(1, finite(document.canvas.height, 1))
  const includeRect = (rect: UiRect) => {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  for (const node of document.nodes) {
    if (node.id === 'node_root' || node.props.visible === false) continue
    includeRect(nodeVisualRect(node))
    const draft = draftPositions[node.id]
    if (draft && Number.isFinite(draft.x) && Number.isFinite(draft.y)) {
      includeRect(nodeVisualRect({ ...node, props: { ...node.props, x: draft.x, y: draft.y } } as UiNode))
    }
  }
  const left = safeGutter + Math.max(0, -minX)
  const top = safeGutter + Math.max(0, -minY)
  const right = safeGutter + Math.max(0, maxX - document.canvas.width)
  const bottom = safeGutter + Math.max(0, maxY - document.canvas.height)
  return {
    left,
    top,
    right,
    bottom,
    width: left + document.canvas.width + right,
    height: top + document.canvas.height + bottom,
  }
}
