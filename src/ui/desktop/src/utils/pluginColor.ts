/** Default shown until the user assigns a project-specific plugin color. */
export const DEFAULT_PLUGIN_COLOR = '#FFFFFF';

/** Strip a leading "#" and uppercase so overrides normalize for comparison. */
function normalizeHex(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.slice(1).toUpperCase() : trimmed.toUpperCase();
}

/**
 * Resolve the effective color for a plugin: a valid project override wins;
 * missing or malformed values use the explicit white default.
 */
export function resolvePluginColor(name: string, overrides?: Record<string, string>): string {
  const override = overrides ? normalizeHex(overrides[name] ?? '') : '';
  if (override && /^[0-9A-F]{6}$/.test(override)) return `#${override}`;
  return DEFAULT_PLUGIN_COLOR;
}
