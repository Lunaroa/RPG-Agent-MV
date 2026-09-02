/**
 * Unlimited extra tile layers stored in a map note. Each `<tileLayers>` block
 * holds one JSON layer object: { name, tiles } where tiles is a width*height
 * array of RMMV tile ids (0 = empty). Blocks are parsed and serialized like
 * the ULDS blocks so foreign or hand-written note content is never dropped.
 *
 * Unknown fields are preserved verbatim: editing layers through the editor
 * must never drop keys written by hand or by a newer plugin version.
 */

export const MAP_TILE_LAYERS_TAG = 'tileLayers';

/** A single `<tileLayers>` block; known fields typed, everything else kept as-is. */
export interface MapTileLayerRecord {
  name: string;
  tiles: number[];
  [key: string]: unknown;
}

export interface MapTileLayersParseResult {
  layers: MapTileLayerRecord[];
  /** Bodies of blocks whose JSON could not be parsed; kept verbatim on write-back. */
  invalidBlocks: string[];
}

const TILE_LAYERS_BLOCK_PATTERN = new RegExp(`<${MAP_TILE_LAYERS_TAG}>([\\s\\S]*?)</${MAP_TILE_LAYERS_TAG}>`, 'gi');

export function isMapTileLayerRecord(value: unknown): value is MapTileLayerRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as MapTileLayerRecord).tiles);
}

/** Extract and parse all `<tileLayers>` blocks; malformed blocks never abort the parse. */
export function parseMapTileLayersNote(note: string): MapTileLayersParseResult {
  const layers: MapTileLayerRecord[] = [];
  const invalidBlocks: string[] = [];
  const source = String(note || '');
  for (const match of source.matchAll(TILE_LAYERS_BLOCK_PATTERN)) {
    const body = (match[1] || '').trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      invalidBlocks.push(match[1]);
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let accepted = false;
    for (const item of items) {
      if (isMapTileLayerRecord(item)) {
        layers.push(normalizeTileLayerRecord(item));
        accepted = true;
      }
    }
    if (!accepted) invalidBlocks.push(match[1]);
  }
  return { layers, invalidBlocks };
}

function normalizeTileLayerRecord(value: MapTileLayerRecord): MapTileLayerRecord {
  return {
    ...value,
    name: String(value.name ?? ''),
    tiles: value.tiles.map((tile) => {
      const id = Number(tile);
      return Number.isInteger(id) && id > 0 ? id : 0;
    }),
  };
}

/** A blank layer covering a width*height map with empty cells. */
export function createEmptyTileLayer(name: string, width: number, height: number): MapTileLayerRecord {
  const size = Math.max(0, Math.floor(width) * Math.floor(height));
  return { name, tiles: new Array(size).fill(0) };
}

/**
 * Replace all `<tileLayers>` blocks in the note with one compact block per
 * layer, re-appending malformed blocks verbatim. Everything outside the
 * blocks is preserved untouched. Layers serialize compactly: tiles arrays are
 * large and pretty-printing would explode the note.
 */
export function writeMapTileLayersNote(
  note: string,
  layers: readonly MapTileLayerRecord[],
  invalidBlocks: readonly string[] = [],
): string {
  const source = String(note || '')
    .replace(new RegExp(`<${MAP_TILE_LAYERS_TAG}>[\\s\\S]*?</${MAP_TILE_LAYERS_TAG}>\\s*?`, 'gi'), '')
    .trimEnd();
  const blocks = [
    ...layers.map((layer) => `<${MAP_TILE_LAYERS_TAG}>${JSON.stringify(normalizeTileLayerRecord(layer))}</${MAP_TILE_LAYERS_TAG}>`),
    ...invalidBlocks.map((body) => `<${MAP_TILE_LAYERS_TAG}>${body}</${MAP_TILE_LAYERS_TAG}>`),
  ];
  if (!blocks.length) return source;
  return source ? `${source}\n${blocks.join('\n')}` : blocks.join('\n');
}
