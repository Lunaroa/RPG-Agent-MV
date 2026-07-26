/**
 * Preview-only plugins.js filtering: flips `status` to false for plugins the
 * user disabled for map preview. The project's real plugins.js is never touched —
 * this rewrites only the bytes served to the preview iframe.
 */

interface PluginsJsEntry {
  name?: unknown;
  status?: unknown;
  [key: string]: unknown;
}

/** Match `js/plugins.js` with or without the MV `www/` prefix. */
export function isMapPreviewPluginsJsPath(relativePath: string): boolean {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return normalized === 'js/plugins.js' || normalized === 'www/js/plugins.js';
}

/**
 * Returns the rewritten plugins.js source, or null when nothing needs to change
 * (no disabled names hit an enabled entry, or the file cannot be parsed safely).
 */
export function filterMapPreviewPluginsJs(source: string, disabledPlugins: readonly string[]): string | null {
  const disabled = new Set(disabledPlugins.filter((name) => typeof name === 'string' && name.trim() !== ''));
  if (disabled.size === 0) return null;
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let list: unknown;
  try {
    list = JSON.parse(source.slice(start, end + 1));
  } catch {
    return null; // unexpected plugins.js shape: serve the original untouched
  }
  if (!Array.isArray(list)) return null;
  let changed = false;
  for (const entry of list as PluginsJsEntry[]) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.name !== 'string' || !disabled.has(entry.name)) continue;
    if (entry.status === false) continue;
    entry.status = false;
    changed = true;
  }
  if (!changed) return null;
  const body = (list as PluginsJsEntry[]).map((entry) => JSON.stringify(entry)).join(',\n');
  return `${source.slice(0, start)}[\n${body}\n]${source.slice(end + 1)}`;
}
