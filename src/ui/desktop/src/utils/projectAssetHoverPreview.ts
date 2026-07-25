/**
 * Hover preview helpers for the asset grid: derive a larger-bucket thumbnail URL
 * from the listing-provided one, and place the floating preview inside the
 * viewport without stretching the image.
 */

/** URL shape produced by the backend: rmmv-asset://project-thumbnail/<token>/<bucket>/<relative>. */
const PROJECT_THUMBNAIL_URL_PATTERN = /^(rmmv-asset:\/\/project-thumbnail\/[^/]+\/)(\d+)(\/.*)$/;

export const PROJECT_ASSET_HOVER_PREVIEW_MAX_SIZE = 200;
export const PROJECT_ASSET_HOVER_PREVIEW_DELAY_MS = 350;

/**
 * Swap the size-bucket path segment of a backend-provided thumbnail URL.
 * Returns null for URLs that do not match the expected shape so callers can
 * fall back to the original URL.
 */
export function projectAssetThumbnailUrlForBucket(
  thumbnailUrl: string,
  sizeBucket: number,
): string | null {
  const match = PROJECT_THUMBNAIL_URL_PATTERN.exec(thumbnailUrl);
  if (!match) return null;
  return `${match[1]}${sizeBucket}${match[3]}`;
}

export interface HoverPreviewPositionInput {
  mouseX: number;
  mouseY: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Longest edge of the preview box in px. */
  maxSize?: number;
  /** Gap between the cursor and the preview box in px. */
  offset?: number;
}

export interface HoverPreviewPosition {
  left: number;
  top: number;
}

/**
 * Default placement is right-below the cursor; flip left/above when the box
 * would leave the viewport, and clamp as a last resort.
 */
export function computeHoverPreviewPosition(
  input: HoverPreviewPositionInput,
): HoverPreviewPosition {
  const maxSize = input.maxSize ?? PROJECT_ASSET_HOVER_PREVIEW_MAX_SIZE;
  const offset = input.offset ?? 16;
  const viewportWidth = Math.max(0, input.viewportWidth);
  const viewportHeight = Math.max(0, input.viewportHeight);

  let left = input.mouseX + offset;
  if (left + maxSize > viewportWidth) {
    left = input.mouseX - offset - maxSize;
  }
  let top = input.mouseY + offset;
  if (top + maxSize > viewportHeight) {
    top = input.mouseY - offset - maxSize;
  }
  return {
    left: Math.max(0, Math.min(left, Math.max(0, viewportWidth - maxSize))),
    top: Math.max(0, Math.min(top, Math.max(0, viewportHeight - maxSize))),
  };
}
