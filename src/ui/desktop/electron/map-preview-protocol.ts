import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MAP_PREVIEW_SCHEME,
  normalizeMapPreviewProtocolKey,
  resolveConfinedMapPreviewResource,
} from './map-preview-protocol-policy.js';

export { MAP_PREVIEW_SCHEME } from './map-preview-protocol-policy.js';

interface PreviewProtocolEntry {
  resourceRoot: string;
}

const entries = new Map<string, PreviewProtocolEntry>();
let registered = false;

export function registerMapPreviewProtocol(): void {
  if (registered) return;
  protocol.handle(MAP_PREVIEW_SCHEME.scheme, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
      const url = new URL(request.url);
      const entry = entries.get(url.hostname.toLowerCase());
      if (!entry) return new Response('not found', { status: 404 });
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const target = resolveConfinedMapPreviewResource(entry.resourceRoot, relative);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response('not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  registered = true;
}

export function registerMapPreviewRoot(keyInput: string, resourceRootInput: string): string {
  const key = normalizeMapPreviewProtocolKey(keyInput);
  const resourceRoot = fs.realpathSync.native(path.resolve(resourceRootInput));
  entries.set(key, { resourceRoot });
  return `${MAP_PREVIEW_SCHEME.scheme}://${key}/index.html`;
}

export function unregisterMapPreviewRoot(keyInput: string): void {
  entries.delete(normalizeMapPreviewProtocolKey(keyInput));
}

export function clearMapPreviewProtocol(): void {
  entries.clear();
  if (!registered) return;
  protocol.unhandle(MAP_PREVIEW_SCHEME.scheme);
  registered = false;
}

export function mapPreviewProtocolEntryCount(): number {
  return entries.size;
}
