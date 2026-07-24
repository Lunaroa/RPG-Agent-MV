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

export function withAssetCanvasCors(
  response: Response,
  options: { filePath?: string } = {},
): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
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
