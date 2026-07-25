/** Media kinds the shared asset preview surface can render. */
export type AssetPreviewMediaKind = 'image' | 'audio' | 'movie' | 'font' | 'effect' | 'other';

/** One previewable entry for {@link AssetPreviewDialog}. */
export interface AssetPreviewItem {
  id: string;
  displayName: string;
  /** Already-resolved URL suitable for <img>/<audio>/<video>/<font> src. */
  url: string;
  media: AssetPreviewMediaKind;
  /** Optional caller-supplied metadata line shown with the item name. */
  metadata?: string;
  /** Structured info page (effects / non-playable notices). */
  info?: {
    notice: string;
    rows: Array<{ label: string; value: string }>;
  };
}

/** Caller-built labels for {@link AssetPreviewSurface} (no t() inside the surface). */
export interface AssetPreviewSurfaceLabels {
  previewFailed: string;
  none: string;
  previewZoom: string;
  resetZoom: string;
  zoomOut: string;
  zoomIn: string;
  /** Sample string for font ladder preview (zh + en + digits). */
  fontSample?: string;
  fontLoadFailed?: string;
}

/** Caller-built labels for {@link AssetPreviewDialog}. */
export interface AssetPreviewDialogLabels {
  closeTitle: string;
  close: string;
}

/** Font ladder sizes matching the asset-library design (Windows font viewer style). */
export const ASSET_FONT_PREVIEW_SIZES_PX = [12, 18, 24, 36, 48, 60] as const;

export const ASSET_FONT_PREVIEW_SAMPLE_DEFAULT = 'Aa 字体 123';
