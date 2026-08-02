export interface ScreenPicturePreview {
  assetName: string;
  assetUrl: string;
  origin: 0 | 1;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blendMode: number;
}

export interface ScreenPictureDrawState {
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  operation: GlobalCompositeOperation;
}

export interface CanvasClientGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasLogicalPoint {
  x: number;
  y: number;
}

/** Convert a CSS-space canvas pointer location to backing-canvas coordinates. */
export function canvasClientToLogicalPoint(
  clientX: number,
  clientY: number,
  geometry: CanvasClientGeometry,
  canvasWidth: number,
  canvasHeight: number,
): CanvasLogicalPoint {
  return {
    x: (clientX - geometry.left) * canvasWidth / Math.max(1, geometry.width),
    y: (clientY - geometry.top) * canvasHeight / Math.max(1, geometry.height),
  };
}

/** Convert a CSS-space pointer delta to backing-canvas coordinates. */
export function canvasClientDeltaToLogical(
  deltaX: number,
  deltaY: number,
  geometry: Pick<CanvasClientGeometry, 'width' | 'height'>,
  canvasWidth: number,
  canvasHeight: number,
): CanvasLogicalPoint {
  return {
    x: deltaX * canvasWidth / Math.max(1, geometry.width),
    y: deltaY * canvasHeight / Math.max(1, geometry.height),
  };
}

export const SCREEN_COORDINATE_MIN = -9999;
export const SCREEN_COORDINATE_MAX = 9999;

export function clampScreenCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(SCREEN_COORDINATE_MIN, Math.min(SCREEN_COORDINATE_MAX, Math.trunc(value)));
}

export function screenPictureDrawState(
  preview: ScreenPicturePreview,
  imageWidth: number,
  imageHeight: number,
): ScreenPictureDrawState {
  return {
    originX: preview.origin === 1 ? -imageWidth / 2 : 0,
    originY: preview.origin === 1 ? -imageHeight / 2 : 0,
    scaleX: preview.scaleX / 100,
    scaleY: preview.scaleY / 100,
    alpha: Math.max(0, Math.min(1, preview.opacity / 255)),
    operation: pictureBlendOperation(preview.blendMode),
  };
}

export function pictureBlendOperation(blendMode: number): GlobalCompositeOperation {
  if (blendMode === 1) return 'lighter';
  if (blendMode === 2) return 'multiply';
  if (blendMode === 3) return 'screen';
  return 'source-over';
}
