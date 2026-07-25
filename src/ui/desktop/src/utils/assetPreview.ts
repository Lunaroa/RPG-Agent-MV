/** Media kinds the shared asset preview surface can render. */
export type AssetPreviewMediaKind = 'image' | 'audio' | 'movie' | 'other';

/** One previewable entry for {@link AssetPreviewDialog}. */
export interface AssetPreviewItem {
  id: string;
  displayName: string;
  /** Already-resolved URL suitable for <img>/<audio>/<video> src. */
  url: string;
  media: AssetPreviewMediaKind;
  /** Optional caller-supplied metadata line shown with the item name. */
  metadata?: string;
}

/** Caller-built labels for {@link AssetPreviewSurface} (no t() inside the surface). */
export interface AssetPreviewSurfaceLabels {
  previewFailed: string;
  none: string;
  previewZoom: string;
  resetZoom: string;
  zoomOut: string;
  zoomIn: string;
}

/** Caller-built labels for {@link AssetPreviewDialog}. */
export interface AssetPreviewDialogLabels {
  closeTitle: string;
  close: string;
}
