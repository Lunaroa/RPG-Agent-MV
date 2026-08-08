/**
 * Per-plugin stable color, used as a visual stripe next to plugin commands in
 * the event editor and in the plugin-command picker. The color is derived from
 * the plugin name via a stable hash so the same plugin always renders the same
 * hue across sessions; users can override it per-project via
 * `LunaRpgProjectConfig.pluginColors`.
 */

/**
 * FNV-1a 32-bit hash. Chosen for stability and because it spreads names evenly
 * across the color wheel without cryptographic overhead. Returns a non-negative
 * integer for any string, including empty.
 */
export function hashPluginName(name: string): number {
  const input = String(name ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // FNV multiply, kept in 32-bit range with Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Force non-negative (unsigned 32-bit).
  return hash >>> 0;
}

/** HSL → "#rrggbb" conversion. S/L are fixed for a consistent readable palette. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = l - c / 2;
  const toHex = (channel: number): string => Math.round((channel + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

/**
 * Deterministic color for a plugin name: hue from hash, fixed S=65% L=55% so
 * colors are vivid but readable on light and dark chrome. Same name → same
 * color, every time, in every project (unless overridden).
 */
export function pluginColorHex(name: string): string {
  const hue = hashPluginName(name) % 360;
  return hslToHex(hue, 65, 55);
}

/** Strip a leading "#" and uppercase so overrides normalize for comparison. */
function normalizeHex(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed.slice(1).toUpperCase() : trimmed.toUpperCase();
}

/**
 * Resolve the effective color for a plugin: a project override wins when set
 * (and is normalized to `#RRGGBB`); otherwise fall back to the deterministic
 * hash color. An override that is empty/invalid is ignored, treating it as
 * "no override". An empty plugin name still yields a stable color so the UI
 * never renders an uncolored stripe.
 */
export function resolvePluginColor(name: string, overrides?: Record<string, string>): string {
  const override = overrides ? normalizeHex(overrides[name] ?? '') : '';
  if (override && /^[0-9A-F]{6}$/.test(override)) return `#${override}`;
  return pluginColorHex(name);
}
