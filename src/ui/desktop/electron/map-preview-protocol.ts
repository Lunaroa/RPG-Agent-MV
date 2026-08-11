import { net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MAP_PREVIEW_SCHEME,
  normalizeMapPreviewProtocolKey,
  resolveMapPreviewResource,
  type MapPreviewResolutionEntry,
} from './map-preview-protocol-policy.js';
import {
  filterMapPreviewPluginsJs,
  isMapPreviewPluginsJsPath,
} from './map-preview-plugins-filter.js';

export { MAP_PREVIEW_SCHEME } from './map-preview-protocol-policy.js';

interface PreviewProtocolEntry extends MapPreviewResolutionEntry {
  disabledPlugins: readonly string[];
}

export type MapPreviewProtocolStage = 'method' | 'session' | 'path' | 'resolve' | 'read' | 'filter' | 'fetch';
export type MapPreviewProtocolStatus = 'invalid' | 'missing' | 'denied' | 'unavailable' | 'error';

export interface MapPreviewProtocolErrorPayload {
  schemaVersion: '1.0.0';
  stage: MapPreviewProtocolStage;
  status: MapPreviewProtocolStatus;
  code: string;
  message: string;
}

const entries = new Map<string, PreviewProtocolEntry>();
let registered = false;

export function registerMapPreviewProtocol(): void {
  if (registered) return;
  protocol.handle(MAP_PREVIEW_SCHEME.scheme, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return mapPreviewProtocolErrorResponse(request.method, 405, {
        stage: 'method', status: 'invalid', code: 'MAP_PREVIEW_METHOD_NOT_ALLOWED',
        message: 'Map preview resource requests must use GET or HEAD.',
      });
    }

    let url: URL;
    try { url = new URL(request.url); }
    catch { return mapPreviewProtocolErrorResponse(request.method, 404, {
      stage: 'path', status: 'invalid', code: 'MAP_PREVIEW_URL_INVALID', message: 'The map preview resource URL is invalid.',
    }); }

    const entry = entries.get(url.hostname.toLowerCase());
    if (!entry) return mapPreviewProtocolErrorResponse(request.method, 404, {
      stage: 'session', status: 'missing', code: 'MAP_PREVIEW_SESSION_NOT_FOUND', message: 'The map preview session is no longer available.',
    });

    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return mapPreviewProtocolErrorResponse(request.method, 404, {
        stage: 'path', status: 'invalid', code: 'MAP_PREVIEW_PATH_INVALID', message: 'The map preview resource path is invalid.',
      });
    }

    let target: string | null;
    try { target = resolveMapPreviewResource(entry, relative); }
    catch {
      return mapPreviewProtocolErrorResponse(request.method, 404, {
        stage: 'resolve', status: 'denied', code: 'MAP_PREVIEW_RESOURCE_DENIED', message: 'The map preview resource is outside the isolated preview boundary.',
      });
    }
    try {
      if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return mapPreviewProtocolErrorResponse(request.method, 404, {
          stage: 'resolve', status: 'missing', code: 'MAP_PREVIEW_RESOURCE_NOT_FOUND', message: 'The map preview resource is not available.',
        });
      }
    } catch {
      return mapPreviewProtocolErrorResponse(request.method, 404, {
        stage: 'resolve', status: 'missing', code: 'MAP_PREVIEW_RESOURCE_NOT_FOUND', message: 'The map preview resource is not available.',
      });
    }

    // Preview-only plugin toggle: rewrite the served plugins.js, never the file on disk.
    if (entry.disabledPlugins.length && isMapPreviewPluginsJsPath(relative)) {
      try {
        const filtered = filterMapPreviewPluginsJs(fs.readFileSync(target, 'utf8'), entry.disabledPlugins);
        if (filtered !== null) {
          return mapPreviewTextResponse(request.method, filtered, 'text/javascript; charset=utf-8');
        }
      } catch {
        return mapPreviewProtocolErrorResponse(request.method, 404, {
          stage: 'filter', status: 'error', code: 'MAP_PREVIEW_PLUGIN_FILTER_FAILED', message: 'The map preview plugin policy could not be applied.',
        });
      }
    }

    try {
      const response = await net.fetch(pathToFileURL(target).toString());
      if (!response.ok) return mapPreviewProtocolErrorResponse(request.method, 404, {
        stage: 'fetch', status: 'unavailable', code: 'MAP_PREVIEW_RESOURCE_UNAVAILABLE', message: 'The map preview resource could not be loaded.',
      });
      const headers = safePreviewHeaders(response.headers);
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return mapPreviewProtocolErrorResponse(request.method, 404, {
        stage: 'fetch', status: 'error', code: 'MAP_PREVIEW_RESOURCE_READ_FAILED', message: 'The map preview resource could not be read.',
      });
    }
  });
  registered = true;
}

export function mapPreviewProtocolErrorResponse(
  method: string,
  statusCode: number,
  detail: Omit<MapPreviewProtocolErrorPayload, 'schemaVersion'>,
): Response {
  const payload: MapPreviewProtocolErrorPayload = { schemaVersion: '1.0.0', ...detail };
  const body = JSON.stringify(payload);
  return new Response(method === 'HEAD' ? null : body, {
    status: statusCode,
    headers: safePreviewHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

function mapPreviewTextResponse(method: string, body: string, contentType: string): Response {
  return new Response(method === 'HEAD' ? null : body, {
    status: 200,
    headers: safePreviewHeaders({ 'Content-Type': contentType }),
  });
}

function safePreviewHeaders(source: Headers | Record<string, string>): Headers {
  const headers = new Headers(source);
  headers.set('Cache-Control', 'no-store');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

export function registerMapPreviewRoot(
  keyInput: string,
  resourceRootInput: string,
  disabledPlugins: readonly string[] = [],
  fallback?: { root: string; prefixes: readonly string[] },
  deniedPaths: readonly string[] = [],
): string {
  const key = normalizeMapPreviewProtocolKey(keyInput);
  const resourceRoot = fs.realpathSync.native(path.resolve(resourceRootInput));
  const normalizedDenied = deniedPaths.map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()).filter(Boolean);
  entries.set(key, {
    resourceRoot,
    disabledPlugins: [...disabledPlugins],
    fallback: fallback
      ? { root: fs.realpathSync.native(path.resolve(fallback.root)), prefixes: [...fallback.prefixes] }
      : undefined,
    denied: normalizedDenied.length
      ? {
        exact: new Set(normalizedDenied.filter((entry) => !entry.endsWith('/'))),
        prefixes: normalizedDenied.filter((entry) => entry.endsWith('/')),
      }
      : undefined,
  });
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
