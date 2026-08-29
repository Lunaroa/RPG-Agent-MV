/**
 * taroxd ULDS (Unlimited Layer Display System) map-note parsing.
 *
 * The plugin reads every `<ulds>{...}</ulds>` block from a map's note; each block
 * holds one JSON layer object (fields may be numbers, booleans, or runtime JS
 * expression strings like `this.rx(t)`). Shared by the desktop map canvas and
 * services so parsing never diverges from serialization.
 *
 * Unknown fields are preserved verbatim: editing a layer through the panel must
 * never drop keys written by hand or by a newer plugin version.
 */

export const ULDS_TAG = 'ulds';
/** Plugin default: layers sit above tiles unless z says otherwise. */
export const ULDS_DEFAULT_Z = 0.5;
/** Layers below the tile deck (z < threshold) draw after the parallax, before tiles. */
export const ULDS_TILE_Z_THRESHOLD = 0.5;
export const ULDS_DEFAULT_PATH = 'parallaxes';

export type UldsValue = number | boolean | string;

/** A single `<ulds>` layer record; known fields typed, everything else kept as-is. */
export interface UldsLayerRecord {
  name: string;
  path?: string;
  x?: UldsValue;
  y?: UldsValue;
  z?: UldsValue;
  'scale.x'?: UldsValue;
  'scale.y'?: UldsValue;
  blendMode?: UldsValue;
  opacity?: UldsValue;
  loop?: UldsValue;
  rotation?: UldsValue;
  'anchor.x'?: UldsValue;
  'anchor.y'?: UldsValue;
  visible?: UldsValue;
  [key: string]: unknown;
}

export interface UldsNoteParseResult {
  layers: UldsLayerRecord[];
  /** Bodies of blocks whose JSON could not be parsed; kept verbatim on write-back. */
  invalidBlocks: string[];
}

const ULDS_BLOCK_PATTERN = new RegExp(`<${ULDS_TAG}>([\\s\\S]*?)</${ULDS_TAG}>`, 'gi');

/** Serialization key order: canonical fields first, unknown keys after, stable. */
const ULDS_KEY_ORDER = [
  'name', 'path', 'x', 'y', 'z',
  'scale.x', 'scale.y',
  'blendMode', 'opacity', 'loop',
  'rotation', 'anchor.x', 'anchor.y', 'visible',
] as const;

export function isUldsLayerRecord(value: unknown): value is UldsLayerRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Extract and parse all `<ulds>` blocks; malformed blocks never abort the parse. */
export function parseUldsNote(note: string): UldsNoteParseResult {
  const layers: UldsLayerRecord[] = [];
  const invalidBlocks: string[] = [];
  const source = String(note || '');
  for (const match of source.matchAll(ULDS_BLOCK_PATTERN)) {
    const body = (match[1] || '').trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      invalidBlocks.push(match[1]);
      continue;
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isUldsLayerRecord(item)) layers.push(normalizeLayerRecord(item));
      }
    } else if (isUldsLayerRecord(parsed)) {
      layers.push(normalizeLayerRecord(parsed));
    } else {
      invalidBlocks.push(match[1]);
    }
  }
  return { layers, invalidBlocks };
}

/** name is required by the plugin but absent on brand-new panel rows; keep it a string. */
function normalizeLayerRecord(value: Record<string, unknown>): UldsLayerRecord {
  return { ...value, name: String(value.name ?? '') };
}

/**
 * Replace all `<ulds>` blocks in the note with one block per layer (the plugin's
 * canonical one-object-per-block form), re-appending malformed blocks verbatim.
 * Everything outside the blocks is preserved untouched.
 */
export function writeUldsNote(note: string, layers: UldsLayerRecord[], invalidBlocks: readonly string[] = []): string {
  const source = String(note || '').replace(new RegExp(`<${ULDS_TAG}>[\\s\\S]*?</${ULDS_TAG}>\\s*?`, 'gi'), '').trimEnd();
  const blocks = [
    ...layers.map((layer) => `<${ULDS_TAG}> ${JSON.stringify(orderUldsLayerKeys(layer), null, 2)} </${ULDS_TAG}>`),
    ...invalidBlocks.map((body) => `<${ULDS_TAG}>${body}</${ULDS_TAG}>`),
  ];
  if (!blocks.length) return source;
  return source ? `${source}\n${blocks.join('\n')}` : blocks.join('\n');
}

/** Canonical key order for stable serialization and structural comparison. */
export function orderUldsLayerKeys(layer: UldsLayerRecord): UldsLayerRecord {
  const ordered: Record<string, unknown> = {};
  for (const key of ULDS_KEY_ORDER) {
    if (layer[key] !== undefined) ordered[key] = layer[key];
  }
  for (const [key, value] of Object.entries(layer)) {
    if (value !== undefined && ordered[key] === undefined) ordered[key] = value;
  }
  return ordered as UldsLayerRecord;
}

export type UldsCoordinateSpace = 'screen' | 'map';

export interface UldsStaticCoordinate {
  space: UldsCoordinateSpace;
  value: number;
}

const RX_RY_NUMBER = /^this\.r[xy]\(\s*(-?\d+(?:\.\d+)?)\s*\)$/;
const RX_RY_T = /^this\.r[xy\(]/;

/**
 * Statically resolve a layer x/y for editor previews (t = 0):
 * numbers are screen-fixed; `this.rx(n)`/`this.ry(n)` are map coordinates;
 * `this.rx(t)` scrolls and starts at 0. Anything else (game switches,
 * variables, arithmetic) cannot be resolved and returns null.
 */
export function staticUldsCoordinate(value: unknown): UldsStaticCoordinate | null {
  if (typeof value === 'number' && Number.isFinite(value)) return { space: 'screen', value };
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const numeric = text.match(/^-?\d+(?:\.\d+)?$/);
  if (numeric) return { space: 'screen', value: Number(text) };
  const mapNumber = text.match(RX_RY_NUMBER);
  if (mapNumber) return { space: 'map', value: Number(mapNumber[1]) };
  if (RX_RY_T.test(text)) return { space: 'map', value: 0 };
  return null;
}

/** Number or numeric string → number; dynamic expressions fall back to `fallback`. */
export function staticUldsNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return fallback;
}

export function staticUldsBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/** Blend modes mirror PIXI / RMMV: 0 normal, 1 add, 2 multiply, 3 screen. */
export function staticUldsBlendMode(value: unknown): 0 | 1 | 2 | 3 {
  const mode = staticUldsNumber(value, 0);
  if (mode === 1 || mode === 2 || mode === 3) return mode;
  return 0;
}
