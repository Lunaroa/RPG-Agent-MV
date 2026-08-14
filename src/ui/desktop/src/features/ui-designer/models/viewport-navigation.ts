import type { UiPoint } from '@contract/ui-designer'

export interface UiCanvasScrollLayout {
  viewportWidth: number
  viewportHeight: number
  contentWidth: number
  contentHeight: number
  stageOffsetX: number
  stageOffsetY: number
  centerScrollX: number
  centerScrollY: number
}

const finitePositive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))

export function createCanvasScrollLayout(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  margin: number,
  panRoomX = 0,
  panRoomY = 0,
): UiCanvasScrollLayout {
  const safeViewportWidth = finitePositive(viewportWidth, 1)
  const safeViewportHeight = finitePositive(viewportHeight, 1)
  const safeCanvasWidth = finitePositive(canvasWidth, 1)
  const safeCanvasHeight = finitePositive(canvasHeight, 1)
  const safeZoom = finitePositive(zoom, 1)
  const safeMargin = Number.isFinite(margin) && margin >= 0 ? margin : 0
  const safePanRoomX = Number.isFinite(panRoomX) && panRoomX > 0 ? panRoomX : 0
  const safePanRoomY = Number.isFinite(panRoomY) && panRoomY > 0 ? panRoomY : 0
  const scaledWidth = safeCanvasWidth * safeZoom
  const scaledHeight = safeCanvasHeight * safeZoom
  const baseWidth = Math.max(safeViewportWidth, scaledWidth + safeMargin * 2)
  const baseHeight = Math.max(safeViewportHeight, scaledHeight + safeMargin * 2)
  const contentWidth = baseWidth + safePanRoomX * 2
  const contentHeight = baseHeight + safePanRoomY * 2
  const stageOffsetX = safePanRoomX + Math.max(safeMargin, (baseWidth - scaledWidth) / 2)
  const stageOffsetY = safePanRoomY + Math.max(safeMargin, (baseHeight - scaledHeight) / 2)
  const base = {
    viewportWidth: safeViewportWidth,
    viewportHeight: safeViewportHeight,
    contentWidth,
    contentHeight,
    stageOffsetX,
    stageOffsetY,
  }
  return {
    ...base,
    centerScrollX: clampCanvasScroll(base, { x: stageOffsetX + scaledWidth / 2 - safeViewportWidth / 2, y: 0 }).x,
    centerScrollY: clampCanvasScroll(base, { x: 0, y: stageOffsetY + scaledHeight / 2 - safeViewportHeight / 2 }).y,
  }
}

type UiCanvasScrollBounds = Pick<UiCanvasScrollLayout, 'viewportWidth' | 'viewportHeight' | 'contentWidth' | 'contentHeight'>

export function clampCanvasScroll(layout: UiCanvasScrollBounds, scroll: UiPoint): UiPoint {
  return {
    x: clamp(scroll.x, 0, Math.max(0, layout.contentWidth - layout.viewportWidth)),
    y: clamp(scroll.y, 0, Math.max(0, layout.contentHeight - layout.viewportHeight)),
  }
}

export function panCanvasScroll(layout: UiCanvasScrollLayout, startScroll: UiPoint, pointerDelta: UiPoint): UiPoint {
  return clampCanvasScroll(layout, {
    x: startScroll.x - pointerDelta.x,
    y: startScroll.y - pointerDelta.y,
  })
}

export function canvasScrollForWorldPoint(
  layout: UiCanvasScrollLayout,
  worldPoint: UiPoint,
  clientOffset: UiPoint,
  zoom: number,
): UiPoint {
  const safeZoom = finitePositive(zoom, 1)
  return clampCanvasScroll(layout, {
    x: layout.stageOffsetX + worldPoint.x * safeZoom - clientOffset.x,
    y: layout.stageOffsetY + worldPoint.y * safeZoom - clientOffset.y,
  })
}

export function fitCanvasZoom(viewportWidth: number, viewportHeight: number, canvasWidth: number, canvasHeight: number, margin: number): number {
  const safeViewportWidth = finitePositive(viewportWidth, 1)
  const safeViewportHeight = finitePositive(viewportHeight, 1)
  const safeCanvasWidth = finitePositive(canvasWidth, 1)
  const safeCanvasHeight = finitePositive(canvasHeight, 1)
  const safeMargin = Number.isFinite(margin) && margin >= 0 ? margin : 0
  return clamp(Math.min(
    (safeViewportWidth - safeMargin * 2) / safeCanvasWidth,
    (safeViewportHeight - safeMargin * 2) / safeCanvasHeight,
  ), 0.1, 3)
}
