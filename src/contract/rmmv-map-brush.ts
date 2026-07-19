import type { RpgMakerEngine, TileEdit } from './types.ts';
import {
  autotileIdForKindAndNeighbours,
  classifyAutotileKind,
  isSupportedAutotileKind,
  resolveAutotileLayer,
} from './rmmv-tile-autotile.ts';

export const RMMV_TILE_ID_A1 = 2048;
export const RMMV_TILE_ID_MAX = 8192;
export const RMMV_TILE_ID_UPPER_MAX = 1024;
export const RMMV_PAINT_LAYERS = 4;
export const RMMV_SHADOW_LAYER = 4;
export const RMMV_REGION_LAYER = 5;
export const RMMV_MAP_LAYERS = 6;
export const RMMV_INTERACTIVE_AUTOTILE_RESOLUTION = 'affected' as const;

export interface RmmvBrushMap {
  width: number;
  height: number;
  data: number[];
}

export interface RmmvBrushContext {
  engine: RpgMakerEngine;
  tilesetMode: number | null;
  autotileResolution?: 'full' | 'affected';
  mutate?: boolean;
  collectChanges?: boolean;
}

export interface NormalizedRmmvTileEdit {
  kind: 'tile' | 'autotile' | 'shadow' | 'region';
  x: number;
  y: number;
  layer: number;
  tileId?: number;
  autotileKind?: number;
  preserveAutotileShape?: boolean;
  shadowBits?: number;
  regionId?: number;
}

export interface RmmvBrushChange extends TileEdit {
  kind: 'tile' | 'shadow' | 'region';
  layer: number;
  before: number;
  after: number;
}

export interface RmmvBrushResult {
  data: number[];
  normalizedEdits: NormalizedRmmvTileEdit[];
  changes: RmmvBrushChange[];
  resolvedLayers: number[];
  touchedIndices: number[];
}

export function applyRmmvMapBrushEdits(
  source: RmmvBrushMap,
  edits: readonly TileEdit[],
  context: RmmvBrushContext,
): RmmvBrushResult {
  validateMap(source);
  const collectChanges = context.collectChanges !== false;
  const before = collectChanges ? source.data.slice() : null;
  const map = { width: source.width, height: source.height, data: context.mutate ? source.data : source.data.slice() };
  const placementMap = context.mutate
    ? map
    : { width: source.width, height: source.height, data: source.data.slice() };
  const normalizedEdits: NormalizedRmmvTileEdit[] = [];
  const touchedIndices = new Set<number>();

  edits.forEach((edit, index) => {
    const next = normalizeRmmvTileEdit(edit, index, placementMap, context.tilesetMode);
    normalizedEdits.push(...next);
    for (const normalized of next) applyPlacementValue(placementMap, normalized, context.mutate ? touchedIndices : undefined);
  });

  if (!context.mutate) for (const edit of normalizedEdits) applyPlacementValue(map, edit, touchedIndices);

  const touchedLayers = new Set(normalizedEdits
    .filter((edit) => edit.layer < RMMV_PAINT_LAYERS)
    .map((edit) => edit.layer));
  const autotileByLayer = new Map<number, NormalizedRmmvTileEdit[]>();
  for (const edit of normalizedEdits) {
    if (edit.kind !== 'autotile') continue;
    const entries = autotileByLayer.get(edit.layer) || [];
    entries.push(edit);
    autotileByLayer.set(edit.layer, entries);
  }

  const resolvedLayers: number[] = [];
  for (const layer of [...touchedLayers].sort((left, right) => left - right)) {
    const hasAutotile = context.autotileResolution === 'affected'
      ? affectedAreaHasSupportedAutotile(map, layer, normalizedEdits)
      : layerHasSupportedAutotile(map, layer);
    if (!autotileByLayer.has(layer) && !hasAutotile) continue;
    const preserved = new Set(normalizedEdits
      .filter((edit) => edit.layer === layer && edit.kind === 'tile' && edit.preserveAutotileShape)
      .map((edit) => edit.y * map.width + edit.x));
    if (context.autotileResolution === 'affected') {
      resolveAffectedAutotiles(map, layer, normalizedEdits, preserved, touchedIndices);
    } else {
      resolveWholeAutotileLayer(map, layer, preserved, touchedIndices);
    }
    resolvedLayers.push(layer);
  }

  if (context.engine === 'rpg-maker-mz' && normalizedEdits.some((edit) => edit.layer < RMMV_PAINT_LAYERS)) {
    updateMZAutoshadows(map, normalizedEdits, touchedIndices);
  }

  const changes: RmmvBrushChange[] = [];
  if (before) {
    const layerSize = map.width * map.height;
    for (let index = 0; index < map.data.length; index += 1) {
      if (before[index] === map.data[index]) continue;
      const layer = Math.floor(index / layerSize);
      const offset = index % layerSize;
      changes.push({
        kind: changeKindForLayer(layer),
        x: offset % map.width,
        y: Math.floor(offset / map.width),
        layer,
        before: before[index],
        after: map.data[index],
      });
    }
  }

  return { data: map.data, normalizedEdits, changes, resolvedLayers, touchedIndices: [...touchedIndices] };
}

export function normalizeRmmvTileEdit(
  edit: TileEdit,
  index: number,
  map: RmmvBrushMap,
  tilesetMode: number | null,
): NormalizedRmmvTileEdit[] {
  if (!edit || typeof edit !== 'object') throw new Error(`edits[${index}] must be an object.`);
  assertInt(edit.x, `edits[${index}].x`, 0);
  assertInt(edit.y, `edits[${index}].y`, 0);
  if (edit.x >= map.width || edit.y >= map.height) {
    throw new Error(`edits[${index}] (${edit.x},${edit.y}) is outside map ${map.width}x${map.height}.`);
  }
  const explicitKind = edit.kind;
  if (explicitKind && !['tile', 'autotile', 'shadow', 'region'].includes(explicitKind)) {
    throw new Error(`edits[${index}].kind is not supported: ${String(explicitKind)}`);
  }
  const kind = explicitKind || (Number.isInteger(edit.autotileKind) ? 'autotile' : 'tile');

  if (kind === 'shadow') {
    assertMetadataLayer(edit.layer, RMMV_SHADOW_LAYER, index, 'shadow');
    assertInt(edit.shadowBits, `edits[${index}].shadowBits`, 0);
    if (edit.shadowBits > 15) throw new Error(`edits[${index}].shadowBits must be <= 15.`);
    return [{ kind: 'shadow', x: edit.x, y: edit.y, layer: RMMV_SHADOW_LAYER, shadowBits: edit.shadowBits }];
  }
  if (kind === 'region') {
    assertMetadataLayer(edit.layer, RMMV_REGION_LAYER, index, 'region');
    assertInt(edit.regionId, `edits[${index}].regionId`, 0);
    if (edit.regionId > 255) throw new Error(`edits[${index}].regionId must be <= 255.`);
    return [{ kind: 'region', x: edit.x, y: edit.y, layer: RMMV_REGION_LAYER, regionId: edit.regionId }];
  }

  const autoLayer = edit.layer === 'auto';
  if (kind === 'autotile') {
    assertInt(edit.autotileKind, `edits[${index}].autotileKind`, 0);
    const classification = classifyAutotileKind(edit.autotileKind);
    if (!classification.supported) {
      throw new Error(
        `edits[${index}].autotileKind ${edit.autotileKind} (${classification.tab}) is not safely supported: `
        + (classification.reason || classification.strategy),
      );
    }
    const layer = autoLayer ? automaticLayerForAutotile(edit.autotileKind) : normalizePaintLayer(edit.layer, index);
    const result: NormalizedRmmvTileEdit[] = [{ kind: 'autotile', x: edit.x, y: edit.y, layer, autotileKind: edit.autotileKind }];
    if (autoLayer && layer === 1 && tilesetMode === 0) {
      const baseKind = supportedAutotileKindAt(map, 0, edit.x, edit.y);
      const baseClass = classifyAutotileKind(baseKind);
      if (baseClass.tab === 'A2' && baseClass.localKind !== null && baseClass.localKind % 8 < 4
        && (baseClass.localKind % 4 === 1 || baseClass.localKind % 4 === 3)) {
        result.unshift({ kind: 'autotile', x: edit.x, y: edit.y, layer: 0, autotileKind: baseKind - 1 });
      }
    }
    return result;
  }

  assertInt(edit.tileId, `edits[${index}].tileId`, 0);
  if (edit.tileId >= RMMV_TILE_ID_MAX) throw new Error(`edits[${index}].tileId ${edit.tileId} exceeds max ${RMMV_TILE_ID_MAX}.`);
  if (!autoLayer) {
    const layer = normalizePaintLayer(edit.layer, index);
    return [{
      kind: 'tile', x: edit.x, y: edit.y, layer, tileId: edit.tileId,
      preserveAutotileShape: edit.preserveAutotileShape === true,
    }];
  }
  return automaticLiteralEdits(map, edit.x, edit.y, edit.tileId, edit.preserveAutotileShape === true);
}

function automaticLayerForAutotile(kind: number): number {
  const classification = classifyAutotileKind(kind);
  return classification.tab === 'A2' && classification.localKind !== null && classification.localKind % 8 >= 4 ? 1 : 0;
}

function automaticLiteralEdits(
  map: RmmvBrushMap,
  x: number,
  y: number,
  tileId: number,
  preserveAutotileShape: boolean,
): NormalizedRmmvTileEdit[] {
  if (tileId === 0) {
    return [
      { kind: 'tile', x, y, layer: 2, tileId: 0 },
      { kind: 'tile', x, y, layer: 3, tileId: 0 },
    ];
  }
  if (tileId < RMMV_TILE_ID_UPPER_MAX) {
    const first = valueAt(map, 2, x, y);
    const second = valueAt(map, 3, x, y);
    if (first === 0) return [{ kind: 'tile', x, y, layer: 2, tileId }];
    if (second === 0 || second === tileId) return [{ kind: 'tile', x, y, layer: 3, tileId }];
    return [
      { kind: 'tile', x, y, layer: 2, tileId: second },
      { kind: 'tile', x, y, layer: 3, tileId },
    ];
  }
  if (tileId >= RMMV_TILE_ID_A1) {
    const kind = Math.floor((tileId - RMMV_TILE_ID_A1) / 48);
    return [{ kind: 'tile', x, y, layer: automaticLayerForAutotile(kind), tileId, preserveAutotileShape }];
  }
  return [{ kind: 'tile', x, y, layer: 0, tileId }];
}

function applyPlacementValue(map: RmmvBrushMap, edit: NormalizedRmmvTileEdit, touched?: Set<number>): void {
  const index = cellIndex(map, edit.layer, edit.x, edit.y);
  if (edit.kind === 'autotile') writeValue(map, index, RMMV_TILE_ID_A1 + edit.autotileKind! * 48, touched);
  else if (edit.kind === 'shadow') writeValue(map, index, edit.shadowBits!, touched);
  else if (edit.kind === 'region') writeValue(map, index, edit.regionId!, touched);
  else writeValue(map, index, edit.tileId!, touched);
}

function resolveWholeAutotileLayer(map: RmmvBrushMap, layer: number, preserved: ReadonlySet<number>, touched: Set<number>): void {
  const layerSize = map.width * map.height;
  const base = layer * layerSize;
  const kindGrid = new Array<number>(layerSize).fill(-1);
  for (let cell = 0; cell < layerSize; cell += 1) kindGrid[cell] = supportedAutotileKindOf(map.data[base + cell]);
  const resolved = resolveAutotileLayer(kindGrid, map.width, map.height);
  for (let cell = 0; cell < layerSize; cell += 1) {
    if (kindGrid[cell] >= 0 && !preserved.has(cell)) writeValue(map, base + cell, resolved[cell], touched);
  }
}

function resolveAffectedAutotiles(
  map: RmmvBrushMap,
  layer: number,
  edits: readonly NormalizedRmmvTileEdit[],
  preserved: ReadonlySet<number>,
  touched: Set<number>,
): void {
  const affected = new Set<number>();
  for (const edit of edits) {
    if (edit.layer !== layer) continue;
    for (let y = Math.max(0, edit.y - 1); y <= Math.min(map.height - 1, edit.y + 1); y += 1) {
      for (let x = Math.max(0, edit.x - 1); x <= Math.min(map.width - 1, edit.x + 1); x += 1) {
        affected.add(y * map.width + x);
      }
    }
  }
  for (const offset of affected) {
    if (preserved.has(offset)) continue;
    const x = offset % map.width;
    const y = Math.floor(offset / map.width);
    const kind = supportedAutotileKindAt(map, layer, x, y);
    if (kind < 0) continue;
    const same = (nx: number, ny: number): boolean => (
      nx < 0 || ny < 0 || nx >= map.width || ny >= map.height
        ? true
        : supportedAutotileKindAt(map, layer, nx, ny) === kind
    );
    writeValue(map, cellIndex(map, layer, x, y), autotileIdForKindAndNeighbours(kind, {
      n: same(x, y - 1), e: same(x + 1, y), s: same(x, y + 1), w: same(x - 1, y),
      ne: same(x + 1, y - 1), se: same(x + 1, y + 1), sw: same(x - 1, y + 1), nw: same(x - 1, y - 1),
    }), touched);
  }
}

function updateMZAutoshadows(map: RmmvBrushMap, edits: readonly NormalizedRmmvTileEdit[], touched: Set<number>): void {
  const candidates = new Set<string>();
  for (const edit of edits) {
    if (edit.layer >= RMMV_PAINT_LAYERS) continue;
    for (let y = Math.max(0, edit.y - 1); y <= Math.min(map.height - 1, edit.y + 1); y += 1) {
      for (let x = Math.max(0, edit.x); x <= Math.min(map.width - 1, edit.x + 1); x += 1) candidates.add(`${x},${y}`);
    }
  }
  for (const key of candidates) {
    const [x, y] = key.split(',').map(Number);
    if (x <= 0 || y <= 0) continue;
    const leftKind = supportedAutotileKindAt(map, 0, x - 1, y);
    const upperLeftKind = supportedAutotileKindAt(map, 0, x - 1, y - 1);
    const leftClass = classifyAutotileKind(leftKind);
    const shouldShadow = leftKind >= 0 && leftKind === upperLeftKind
      && (leftClass.tab === 'A3' || leftClass.tab === 'A4')
      && valueAt(map, 0, x, y) !== valueAt(map, 0, x - 1, y);
    const index = cellIndex(map, RMMV_SHADOW_LAYER, x, y);
    const current = Number(map.data[index] || 0);
    if (shouldShadow && current === 0) writeValue(map, index, 5, touched);
    else if (!shouldShadow && current === 5) writeValue(map, index, 0, touched);
  }
}

function layerHasSupportedAutotile(map: RmmvBrushMap, layer: number): boolean {
  const layerSize = map.width * map.height;
  const base = layer * layerSize;
  for (let cell = 0; cell < layerSize; cell += 1) if (supportedAutotileKindOf(map.data[base + cell]) >= 0) return true;
  return false;
}

function affectedAreaHasSupportedAutotile(
  map: RmmvBrushMap,
  layer: number,
  edits: readonly NormalizedRmmvTileEdit[],
): boolean {
  for (const edit of edits) {
    if (edit.layer !== layer) continue;
    for (let y = Math.max(0, edit.y - 1); y <= Math.min(map.height - 1, edit.y + 1); y += 1) {
      for (let x = Math.max(0, edit.x - 1); x <= Math.min(map.width - 1, edit.x + 1); x += 1) {
        if (supportedAutotileKindAt(map, layer, x, y) >= 0) return true;
      }
    }
  }
  return false;
}

function supportedAutotileKindAt(map: RmmvBrushMap, layer: number, x: number, y: number): number {
  return supportedAutotileKindOf(valueAt(map, layer, x, y));
}

function supportedAutotileKindOf(tileId: number): number {
  if (!tileId || tileId < RMMV_TILE_ID_A1) return -1;
  const kind = Math.floor((tileId - RMMV_TILE_ID_A1) / 48);
  return isSupportedAutotileKind(kind) ? kind : -1;
}

function normalizePaintLayer(layer: unknown, index: number): number {
  assertInt(layer, `edits[${index}].layer`, 0);
  if (layer >= RMMV_PAINT_LAYERS) {
    if (layer === RMMV_SHADOW_LAYER) throw new Error(`edits[${index}] targets shadow layer; use kind:"shadow" with shadowBits.`);
    if (layer === RMMV_REGION_LAYER) throw new Error(`edits[${index}] targets region layer; use kind:"region" with regionId.`);
    throw new Error(`edits[${index}].layer must be < ${RMMV_PAINT_LAYERS} for tile/autotile edits.`);
  }
  return layer;
}

function assertMetadataLayer(layer: unknown, expected: number, index: number, kind: 'shadow' | 'region'): void {
  if (layer === undefined || layer === null) return;
  assertInt(layer, `edits[${index}].layer`, 0);
  if (layer !== expected) throw new Error(`edits[${index}].kind "${kind}" must target layer ${expected}.`);
}

function changeKindForLayer(layer: number): 'tile' | 'shadow' | 'region' {
  if (layer === RMMV_SHADOW_LAYER) return 'shadow';
  if (layer === RMMV_REGION_LAYER) return 'region';
  return 'tile';
}

function valueAt(map: RmmvBrushMap, layer: number, x: number, y: number): number {
  return Number(map.data[cellIndex(map, layer, x, y)] || 0);
}

function cellIndex(map: Pick<RmmvBrushMap, 'width' | 'height'>, layer: number, x: number, y: number): number {
  return layer * map.width * map.height + y * map.width + x;
}

function writeValue(map: RmmvBrushMap, index: number, value: number, touched?: Set<number>): void {
  map.data[index] = value;
  touched?.add(index);
}

function validateMap(map: RmmvBrushMap): void {
  assertInt(map.width, 'map.width', 1);
  assertInt(map.height, 'map.height', 1);
  if (!Array.isArray(map.data)) throw new Error('map.data must be an array.');
  const expected = map.width * map.height * RMMV_MAP_LAYERS;
  if (map.data.length !== expected) throw new Error(`map.data length ${map.data.length} != width*height*${RMMV_MAP_LAYERS} (${expected}).`);
}

function assertInt(value: unknown, label: string, minimum: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer >= ${minimum}.`);
}
