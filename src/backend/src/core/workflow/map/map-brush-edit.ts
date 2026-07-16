import fs from "fs";
import path from "path";

import { readJson, writeJson } from "../../rmmv/json.ts";
import { resolveDataDir } from "../../rmmv/project-scanner.ts";
import { inspectRmmvProject } from "../../rmmv/rmmv-layout.ts";
import { LAYERS } from "../../rmmv/map-blocks.ts";
import { resolveAutotileLayer, isSupportedAutotileKind, classifyAutotileKind } from "./tile-autotile.ts";

interface BrushEditOptions {
  project?: string;
  mapId?: number;
  edits?: BrushEditInput[];
}

interface BrushEditInput {
  kind?: "tile" | "autotile" | "shadow" | "region";
  x: number;
  y: number;
  layer?: number | "auto";
  tileId?: number;
  autotileKind?: number;
  preserveAutotileShape?: boolean;
  shadowBits?: number;
  regionId?: number;
}

interface NormalizedEdit {
  kind: "tile" | "autotile" | "shadow" | "region";
  x: number;
  y: number;
  layer: number;
  tileId?: number;
  autotileKind?: number;
  preserveAutotileShape?: boolean;
  shadowBits?: number;
  regionId?: number;
}

interface CellChange {
  x: number;
  y: number;
  layer: number;
  kind: NormalizedEdit["kind"];
  before: number;
  after: number;
}

interface BrushEditReport {
  generatedAt: string;
  project: string;
  mapId: number;
  mapFile: string;
  size: { width: number; height: number };
  requestedEdits: number;
  changedCells: number;
  resolvedLayers: number[];
  changes: CellChange[];
}

const TILE_ID_A1 = 2048;
const TILE_ID_MAX = 8192;
const TILE_ID_UPPER_MAX = 1024;
const PAINT_LAYERS = 4;
const SHADOW_LAYER = 4;
const REGION_LAYER = 5;

/**
 * map-brush-edit: incremental, single-cell edits to an EXISTING MV map.
 *
 * The interactive Agent Console changes a handful of cells
 * in a map that already exists — a human brush stroke, or an agent touch-up.
 * This tool does exactly that and nothing else: load Map<NNN>.json, apply a
 * batch of cell edits, re-resolve floor-autotile shapes on the layers that
 * were touched, write the file back.
 *
 * Each edit is one of:
 *   { kind:"tile", x, y, layer, tileId }       literal placement on layer 0-3
 *   { kind:"autotile", x, y, layer, autotileKind } paint a supported floor
 *                                 autotile kind on layer 0-3; the sub-tile
 *                                 shape is picked from the 8 neighbours
 *   { kind:"shadow", x, y, shadowBits }        writes MV shadow bits on layer 4
 *   { kind:"region", x, y, regionId }          writes MV region ID on layer 5
 *
 * Legacy tile/autotile inputs without kind are accepted for paint layers only.
 * Layer 4/5 writes must use explicit shadow/region kinds so callers cannot
 * accidentally treat MV metadata layers as ordinary tiles.
 *
 * After the batch, every touched layer that holds floor autotiles is
 * re-resolved, so erasing or painting next to a grass/water field keeps the
 * field's borders correct. Untouched layers are never rewritten, so editing
 * an object layer does not churn the ground layer's diff.
 *
 * Internal implementation for map-service brush writes. It is intentionally
 * not exposed as a public CLI command.
 */
function applyBrushEdit(options: BrushEditOptions): BrushEditReport {
  if (!options || typeof options !== "object") throw new Error("map-brush-edit options must be an object.");
  const project = path.resolve(options.project!);
  const mapId = options.mapId!;
  assertInt(mapId, "mapId", 1);
  const edits = Array.isArray(options.edits) ? options.edits : null;
  if (!edits || !edits.length) throw new Error("edits must be a non-empty array.");

  const dataDir = resolveDataDir(project);
  const mapFile = path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`);
  if (!fs.existsSync(mapFile)) {
    throw new Error(`Map${mapId} does not exist (${mapFile}). map-brush-edit only edits existing maps.`);
  }
  const map = readJson(mapFile) as { width: number; height: number; data: number[]; [key: string]: unknown };
  validateMap(map, mapId);

  const before = map.data.slice();
  const engine = inspectRmmvProject(project).engine;
  const tilesetMode = readTilesetMode(dataDir, map);
  const placementMap = { width: map.width, height: map.height, data: map.data.slice() };
  const normalized: NormalizedEdit[] = [];
  edits.forEach((edit, index) => {
    const next = normalizeEdit(edit, index, placementMap, tilesetMode);
    normalized.push(...next);
    for (const normalizedEdit of next) applyPlacementPreview(placementMap, normalizedEdit);
  });

  // 1. literal/metadata placements first, so erases land before autotile re-resolution.
  for (const edit of normalized) {
    if (edit.kind === "tile") {
      map.data[cellIndex(map, edit.layer, edit.x, edit.y)] = edit.tileId!;
    } else if (edit.kind === "shadow") {
      map.data[cellIndex(map, SHADOW_LAYER, edit.x, edit.y)] = edit.shadowBits!;
    } else if (edit.kind === "region") {
      map.data[cellIndex(map, REGION_LAYER, edit.x, edit.y)] = edit.regionId!;
    }
  }

  // 2. group autotile-kind placements by layer.
  const autotileByLayer = new Map();
  for (const edit of normalized) {
    if (edit.kind !== "autotile") continue;
    if (!autotileByLayer.has(edit.layer)) autotileByLayer.set(edit.layer, []);
    autotileByLayer.get(edit.layer).push(edit);
  }

  // 3. re-resolve floor autotiles on every layer this batch touched.
  const touchedLayers = new Set(normalized.filter((edit) => edit.layer < PAINT_LAYERS).map((edit) => edit.layer));
  const resolvedLayers = [];
  for (const layer of [...touchedLayers].sort((a, b) => a - b)) {
    if (autotileByLayer.has(layer) || layerHasSupportedAutotile(map, layer)) {
      const preserved = new Set(normalized
        .filter((edit) => edit.layer === layer && edit.kind === "tile" && edit.preserveAutotileShape)
        .map((edit) => edit.y * map.width + edit.x));
      resolveLayer(map, layer, autotileByLayer.get(layer) || [], preserved);
      resolvedLayers.push(layer);
    }
  }
  if (engine === "rpg-maker-mz" && normalized.some((edit) => edit.layer < PAINT_LAYERS)) {
    updateMZAutoshadows(map, normalized);
  }

  // 4. diff before/after.
  const layerSize = map.width * map.height;
  const changes = [];
  for (let i = 0; i < map.data.length; i += 1) {
    if (before[i] === map.data[i]) continue;
    const layer = Math.floor(i / layerSize);
    const rem = i % layerSize;
    changes.push({
      x: rem % map.width,
      y: Math.floor(rem / map.width),
      layer,
      kind: changeKindForLayer(layer),
      before: before[i],
      after: map.data[i]
    });
  }

  if (changes.length) writeJson(mapFile, map);

  return {
    generatedAt: new Date().toISOString(),
    project,
    mapId,
    mapFile,
    size: { width: map.width, height: map.height },
    requestedEdits: edits.length,
    changedCells: changes.length,
    resolvedLayers,
    changes
  };
}

function normalizeEdit(
  edit: BrushEditInput,
  index: number,
  map: { width: number; height: number; data: number[] },
  tilesetMode: number | null,
): NormalizedEdit[] {
  if (!edit || typeof edit !== "object") throw new Error(`edits[${index}] must be an object.`);
  assertInt(edit.x, `edits[${index}].x`, 0);
  assertInt(edit.y, `edits[${index}].y`, 0);
  if (edit.x >= map.width || edit.y >= map.height) {
    throw new Error(`edits[${index}] (${edit.x},${edit.y}) is outside map ${map.width}x${map.height}.`);
  }
  const explicitKind = edit.kind;
  if (explicitKind && !["tile", "autotile", "shadow", "region"].includes(explicitKind)) {
    throw new Error(`edits[${index}].kind is not supported: ${String(explicitKind)}`);
  }
  const inferredKind = explicitKind || (Number.isInteger(edit.autotileKind) ? "autotile" : "tile");

  if (inferredKind === "shadow") {
    assertMetadataLayer(edit.layer, SHADOW_LAYER, index, "shadow");
    assertInt(edit.shadowBits, `edits[${index}].shadowBits`, 0);
    if (edit.shadowBits! > 15) throw new Error(`edits[${index}].shadowBits must be <= 15.`);
    return [{ kind: "shadow", x: edit.x, y: edit.y, layer: SHADOW_LAYER, shadowBits: edit.shadowBits }];
  }
  if (inferredKind === "region") {
    assertMetadataLayer(edit.layer, REGION_LAYER, index, "region");
    assertInt(edit.regionId, `edits[${index}].regionId`, 0);
    if (edit.regionId! > 255) throw new Error(`edits[${index}].regionId must be <= 255.`);
    return [{ kind: "region", x: edit.x, y: edit.y, layer: REGION_LAYER, regionId: edit.regionId }];
  }

  const autoLayer = edit.layer === "auto";
  if (inferredKind === "autotile") {
    assertInt(edit.autotileKind, `edits[${index}].autotileKind`, 0);
    const classification = classifyAutotileKind(edit.autotileKind);
    if (!classification.supported) {
      throw new Error(
        `edits[${index}].autotileKind ${edit.autotileKind} (${classification.tab}) is not safely supported: ` +
        (classification.reason || classification.strategy)
      );
    }
    const layer = autoLayer ? automaticLayerForAutotile(edit.autotileKind!) : normalizePaintLayer(edit.layer, index);
    const result: NormalizedEdit[] = [{ kind: "autotile", x: edit.x, y: edit.y, layer, autotileKind: edit.autotileKind }];
    if (autoLayer && layer === 1 && tilesetMode === 0) {
      const baseKind = supportedAutotileKindOf(valueAt(map, 0, edit.x, edit.y));
      const classification = classifyAutotileKind(baseKind);
      if (classification.tab === "A2" && classification.localKind !== null && classification.localKind % 8 < 4
        && (classification.localKind % 4 === 1 || classification.localKind % 4 === 3)) {
        result.unshift({ kind: "autotile", x: edit.x, y: edit.y, layer: 0, autotileKind: baseKind - 1 });
      }
    }
    return result;
  }

  assertInt(edit.tileId, `edits[${index}].tileId`, 0);
  if (edit.tileId >= TILE_ID_MAX) {
    throw new Error(`edits[${index}].tileId ${edit.tileId} exceeds max ${TILE_ID_MAX}.`);
  }
  if (!autoLayer) {
    const layer = normalizePaintLayer(edit.layer, index);
    return [{ kind: "tile", x: edit.x, y: edit.y, layer, tileId: edit.tileId, preserveAutotileShape: edit.preserveAutotileShape === true }];
  }
  return automaticLiteralEdits(map, edit.x, edit.y, edit.tileId!, edit.preserveAutotileShape === true);
}

function automaticLayerForAutotile(kind: number): number {
  const classification = classifyAutotileKind(kind);
  return classification.tab === "A2" && classification.localKind !== null && classification.localKind % 8 >= 4 ? 1 : 0;
}

function automaticLiteralEdits(
  map: { width: number; height: number; data: number[] },
  x: number,
  y: number,
  tileId: number,
  preserveAutotileShape: boolean,
): NormalizedEdit[] {
  if (tileId === 0) {
    return [
      { kind: "tile", x, y, layer: 2, tileId: 0 },
      { kind: "tile", x, y, layer: 3, tileId: 0 },
    ];
  }
  if (tileId < TILE_ID_UPPER_MAX) {
    const first = valueAt(map, 2, x, y);
    const second = valueAt(map, 3, x, y);
    if (first === 0) return [{ kind: "tile", x, y, layer: 2, tileId }];
    if (second === 0 || second === tileId) return [{ kind: "tile", x, y, layer: 3, tileId }];
    return [
      { kind: "tile", x, y, layer: 2, tileId: second },
      { kind: "tile", x, y, layer: 3, tileId },
    ];
  }
  if (tileId >= TILE_ID_A1) {
    const kind = Math.floor((tileId - TILE_ID_A1) / 48);
    return [{ kind: "tile", x, y, layer: automaticLayerForAutotile(kind), tileId, preserveAutotileShape }];
  }
  return [{ kind: "tile", x, y, layer: 0, tileId }];
}

function normalizePaintLayer(layer: unknown, index: number): number {
  assertInt(layer, `edits[${index}].layer`, 0);
  if (layer >= PAINT_LAYERS) {
    if (layer === SHADOW_LAYER) throw new Error(`edits[${index}] targets shadow layer; use kind:"shadow" with shadowBits.`);
    if (layer === REGION_LAYER) throw new Error(`edits[${index}] targets region layer; use kind:"region" with regionId.`);
    throw new Error(`edits[${index}].layer must be < ${PAINT_LAYERS} for tile/autotile edits.`);
  }
  return layer;
}

function valueAt(map: { width: number; height: number; data: number[] }, layer: number, x: number, y: number): number {
  return Number(map.data[cellIndex(map, layer, x, y)] || 0);
}

function applyPlacementPreview(
  map: { width: number; height: number; data: number[] },
  edit: NormalizedEdit,
): void {
  const index = cellIndex(map, edit.layer, edit.x, edit.y);
  if (edit.kind === "autotile") map.data[index] = TILE_ID_A1 + edit.autotileKind! * 48;
  else if (edit.kind === "shadow") map.data[index] = edit.shadowBits!;
  else if (edit.kind === "region") map.data[index] = edit.regionId!;
  else map.data[index] = edit.tileId!;
}

function readTilesetMode(dataDir: string, map: Record<string, unknown>): number | null {
  const tilesetId = Number(map.tilesetId);
  const file = path.join(dataDir, "Tilesets.json");
  if (!Number.isInteger(tilesetId) || tilesetId <= 0 || !fs.existsSync(file)) return null;
  const tilesets = readJson(file);
  if (!Array.isArray(tilesets) || !tilesets[tilesetId] || typeof tilesets[tilesetId] !== "object") return null;
  const mode = Number((tilesets[tilesetId] as Record<string, unknown>).mode);
  return Number.isInteger(mode) ? mode : null;
}

function updateMZAutoshadows(
  map: { width: number; height: number; data: number[] },
  edits: NormalizedEdit[],
): void {
  const candidates = new Set<string>();
  for (const edit of edits) {
    if (edit.layer >= PAINT_LAYERS) continue;
    for (let y = Math.max(0, edit.y - 1); y <= Math.min(map.height - 1, edit.y + 1); y += 1) {
      for (let x = Math.max(0, edit.x); x <= Math.min(map.width - 1, edit.x + 1); x += 1) candidates.add(`${x},${y}`);
    }
  }
  for (const key of candidates) {
    const [x, y] = key.split(",").map(Number);
    if (x <= 0 || y <= 0) continue;
    const leftKind = supportedAutotileKindOf(valueAt(map, 0, x - 1, y));
    const upperLeftKind = supportedAutotileKindOf(valueAt(map, 0, x - 1, y - 1));
    const leftClass = classifyAutotileKind(leftKind);
    const shouldShadow = leftKind >= 0 && leftKind === upperLeftKind
      && (leftClass.tab === "A3" || leftClass.tab === "A4")
      && valueAt(map, 0, x, y) !== valueAt(map, 0, x - 1, y);
    const shadowIndex = cellIndex(map, SHADOW_LAYER, x, y);
    const current = Number(map.data[shadowIndex] || 0);
    if (shouldShadow && current === 0) map.data[shadowIndex] = 5;
    else if (!shouldShadow && current === 5) map.data[shadowIndex] = 0;
  }
}

function assertMetadataLayer(layer: unknown, expected: number, index: number, kind: "shadow" | "region"): void {
  if (layer === undefined || layer === null) return;
  assertInt(layer, `edits[${index}].layer`, 0);
  if (layer !== expected) {
    throw new Error(`edits[${index}].kind "${kind}" must target layer ${expected}.`);
  }
}

function changeKindForLayer(layer: number): NormalizedEdit["kind"] {
  if (layer === SHADOW_LAYER) return "shadow";
  if (layer === REGION_LAYER) return "region";
  return "tile";
}

function resolveLayer(
  map: { width: number; height: number; data: number[] },
  layer: number,
  autotileEdits: NormalizedEdit[],
  preservedCells: ReadonlySet<number> = new Set(),
): void {
  const layerSize = map.width * map.height;
  const base = layer * layerSize;

  // Rebuild the autotile-kind grid from current data (after literal edits).
  // Only supported MV autotiles participate; normal B-E/A5 tiles stay -1 so
  // shape resolution never rewrites literal tile cells.
  const kindGrid = new Array(layerSize).fill(-1);
  for (let cell = 0; cell < layerSize; cell += 1) {
    const kind = supportedAutotileKindOf(map.data[base + cell]);
    if (kind >= 0) kindGrid[cell] = kind;
  }
  for (const edit of autotileEdits) {
    kindGrid[edit.y * map.width + edit.x] = edit.autotileKind;
  }

  const resolved = resolveAutotileLayer(kindGrid, map.width, map.height);
  for (let cell = 0; cell < layerSize; cell += 1) {
    if (kindGrid[cell] >= 0 && !preservedCells.has(cell)) map.data[base + cell] = resolved[cell];
  }
}

function supportedAutotileKindOf(tileId: number): number {
  if (!tileId || tileId < TILE_ID_A1) return -1;
  const kind = Math.floor((tileId - TILE_ID_A1) / 48);
  return isSupportedAutotileKind(kind) ? kind : -1;
}

function layerHasSupportedAutotile(map: { width: number; height: number; data: number[] }, layer: number): boolean {
  const layerSize = map.width * map.height;
  const base = layer * layerSize;
  for (let cell = 0; cell < layerSize; cell += 1) {
    if (supportedAutotileKindOf(map.data[base + cell]) >= 0) return true;
  }
  return false;
}

function cellIndex(map: { width: number; height: number }, layer: number, x: number, y: number): number {
  return layer * map.width * map.height + y * map.width + x;
}

function validateMap(map: unknown, mapId: number): asserts map is { width: number; height: number; data: number[] } {
  if (!map || typeof map !== "object") throw new Error(`Map${mapId}.json is not an object.`);
  const m = map as Record<string, unknown>;
  assertInt(m.width, "map.width", 1);
  assertInt(m.height, "map.height", 1);
  if (!Array.isArray(m.data)) throw new Error(`Map${mapId}.json has no data array.`);
  const expected = (m.width as number) * (m.height as number) * LAYERS;
  if ((m.data as number[]).length !== expected) {
    throw new Error(`Map${mapId}.json data length ${(m.data as number[]).length} != width*height*${LAYERS} (${expected}).`);
  }
}

function assertInt(value: unknown, label: string, minimum: number): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
}

export {
  applyBrushEdit
};
