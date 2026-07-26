import path from 'node:path';

export const RMMV_ASSET_SCHEME = {
  scheme: 'rmmv-asset',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: true,
    // Required so <audio>/<video> can read duration and play short clips via this scheme.
    stream: true,
  },
} as const;

const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export function contentTypeForAssetPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  return EXTENSION_CONTENT_TYPES[extension] || null;
}

export interface ParsedAssetRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `bytes=` header against a known file size.
 * Chromium's media stack always sends `Range: bytes=0-` (and later seeks);
 * answering with a real 206 is required for <audio> to resolve OGG durations.
 */
export function parseAssetRangeHeader(rangeHeader: string | null, fileSize: number): ParsedAssetRange | null {
  if (!rangeHeader || !Number.isFinite(fileSize) || fileSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, fileSize - suffix), end: fileSize - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isInteger(start) || start >= fileSize) return null;
  const end = rawEnd ? Math.min(Number(rawEnd), fileSize - 1) : fileSize - 1;
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end };
}

export function withAssetCanvasCors(
  response: Response,
  options: { filePath?: string } = {},
): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  // Full responses need Accept-Ranges so Chromium can resolve finite media duration.
  if (response.status === 200 && !headers.has('Accept-Ranges')) {
    headers.set('Accept-Ranges', 'bytes');
  }
  const typed = options.filePath ? contentTypeForAssetPath(options.filePath) : null;
  const current = headers.get('Content-Type') || '';
  if (typed && (!current || current === 'application/octet-stream' || current.startsWith('text/'))) {
    headers.set('Content-Type', typed);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
