import fs from "fs";
import path from "path";

import { readJson, writeJson } from "../../rmmv/json.ts";
import { resolveDataDir } from "../../rmmv/project-scanner.ts";
import { inspectRmmvProject } from "../../rmmv/rmmv-layout.ts";
import { LAYERS } from "../../rmmv/map-blocks.ts";
import { applyRmmvMapBrushEdits } from "../../../../../contract/rmmv-map-brush.ts";

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

interface CellChange {
  x: number;
  y: number;
  layer: number;
  kind: "tile" | "autotile" | "shadow" | "region";
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

  const engine = inspectRmmvProject(project).engine;
  const tilesetMode = readTilesetMode(dataDir, map);
  const result = applyRmmvMapBrushEdits(map, edits, { engine, tilesetMode, autotileResolution: 'full' });
  map.data = result.data;
  const changes = result.changes;
  const resolvedLayers = result.resolvedLayers;

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

function readTilesetMode(dataDir: string, map: Record<string, unknown>): number | null {
  const tilesetId = Number(map.tilesetId);
  const file = path.join(dataDir, "Tilesets.json");
  if (!Number.isInteger(tilesetId) || tilesetId <= 0 || !fs.existsSync(file)) return null;
  const tilesets = readJson(file);
  if (!Array.isArray(tilesets) || !tilesets[tilesetId] || typeof tilesets[tilesetId] !== "object") return null;
  const mode = Number((tilesets[tilesetId] as Record<string, unknown>).mode);
  return Number.isInteger(mode) ? mode : null;
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
