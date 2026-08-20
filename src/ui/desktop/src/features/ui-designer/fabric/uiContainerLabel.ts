export interface UiContainerLabelPoint {
  x: number
  y: number
}

export interface UiContainerLabelLayout {
  left: number
  top: number
  width: number
  fontSize: number
}

/**
 * Keep the authoring label attached to the container's own top-left corner.
 * An axis-aligned bounding box changes corners while the object rotates, which
 * makes a separate upright label appear to jump between unrelated positions.
 */
export function resolveUiContainerLabelLayout(
  transformedCorners: readonly UiContainerLabelPoint[],
  zoom: number,
  name: string,
): UiContainerLabelLayout {
  const topLeft = transformedCorners[0]
  if (!topLeft || !Number.isFinite(topLeft.x) || !Number.isFinite(topLeft.y)) {
    throw new Error('Container label requires a finite transformed top-left corner.')
  }
  const normalizedZoom = Math.max(0.01, zoom)
  const fontSize = 12 / normalizedZoom
  const labelWidth = Math.max(80, Array.from(name).length * 12 + 8) / normalizedZoom
  return {
    left: topLeft.x,
    top: topLeft.y - 4 / normalizedZoom,
    width: labelWidth,
    fontSize,
  }
}
