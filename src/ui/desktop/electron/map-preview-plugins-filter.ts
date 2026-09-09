/**
 * Preview-only plugins.js filtering: flips `status` to false for plugins the
 * user disabled for map preview. The project's real plugins.js is never touched —
 * this rewrites only the bytes served to the preview iframe.
 */

import vm from 'node:vm';

interface PluginsJsEntry {
  name?: unknown;
  status?: unknown;
  parameters?: unknown;
  [key: string]: unknown;
}

export function findSyntacticallyInvalidMapPreviewPlugins(
  source: string,
  readPluginSource: (pluginName: string) => string | null,
): string[] {
  const list = parsePluginsJs(source);
  if (!list) return [];
  const invalid = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || entry.status === false || typeof entry.name !== 'string') continue;
    const name = entry.name.trim();
    if (!name || invalid.has(name)) continue;
    const pluginSource = readPluginSource(name);
    if (pluginSource === null) continue;
    try {
      new vm.Script(pluginSource.replace(/^\uFEFF/, ''), { filename: `${name}.js` });
    } catch (error) {
      if (error instanceof SyntaxError) invalid.add(name);
      else throw error;
    }
  }
  return [...invalid];
}

/** Match `js/plugins.js` with or without the MV `www/` prefix. */
export function isMapPreviewPluginsJsPath(relativePath: string): boolean {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return normalized === 'js/plugins.js' || normalized === 'www/js/plugins.js';
}

/**
 * Returns the rewritten plugins.js source, or null when nothing needs to change
 * (no disabled names hit an enabled entry, no preview-only parameter needs to
 * change, or the file cannot be parsed safely).
 */
export function filterMapPreviewPluginsJs(source: string, disabledPlugins: readonly string[]): string | null {
  const disabled = new Set(disabledPlugins.filter((name) => typeof name === 'string' && name.trim() !== ''));
  const list = parsePluginsJs(source);
  if (!list) return null;
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  let changed = false;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.name !== 'string') continue;
    if (disabled.has(entry.name) && entry.status !== false) {
      entry.status = false;
      changed = true;
    }
    // The isolated iframe intentionally has no Node integration, so the UI
    // runtime cannot enumerate data/ui-scenes itself. The preview harness
    // registers the effective scene payload after plugins load instead.
    if (entry.name === 'MZUIRuntime' && entry.status !== false) {
      const parameters = entry.parameters && typeof entry.parameters === 'object' && !Array.isArray(entry.parameters)
        ? entry.parameters as Record<string, unknown>
        : {};
      if (String(parameters.AutoRegister ?? 'true').toLowerCase() !== 'false') {
        entry.parameters = { ...parameters, AutoRegister: 'false' };
        changed = true;
      }
    }
  }
  if (!changed) return null;
  const body = list.map((entry) => JSON.stringify(entry)).join(',\n');
  return `${source.slice(0, start)}[\n${body}\n]${source.slice(end + 1)}`;
}

function parsePluginsJs(source: string): PluginsJsEntry[] | null {
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const list = JSON.parse(source.slice(start, end + 1));
    return Array.isArray(list) ? list as PluginsJsEntry[] : null;
  } catch {
    return null;
  }
}
