import path from "node:path";

import { readJson } from "./json.ts";
import { resolveDataDir } from "./project-scanner.ts";

export interface RmmvMapSummary {
  id: number;
  name: string;
  parentId: number;
  order: number;
  width: number;
  height: number;
  tilesetId: number;
  tilesetName: string | null;
  eventCount: number;
}

export interface RmmvMapTreeNode {
  id: number;
  children: number[];
}

export interface RmmvMapIndexResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  maps: RmmvMapSummary[];
  tree: RmmvMapTreeNode[];
}

interface MapInfoEntry {
  id?: number;
  name?: string;
  parentId?: number;
  order?: number;
}

interface TilesetEntry {
  id?: number;
  name?: string;
}

interface MapFile {
  width?: number;
  height?: number;
  tilesetId?: number;
  events?: unknown[];
}

export function buildRmmvMapIndex(projectRoot: string): RmmvMapIndexResult {
  const root = path.resolve(projectRoot);
  const dataDir = resolveDataDir(root);
  const mapInfos = readArrayJson(path.join(dataDir, "MapInfos.json"));
  const tilesets = readArrayJson(path.join(dataDir, "Tilesets.json"));
  const tilesetNameById = indexTilesets(tilesets);
  const maps: RmmvMapSummary[] = [];

  for (const info of mapInfos as MapInfoEntry[]) {
    if (!info || typeof info !== "object") continue;
    const id = Number(info.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const file = path.join(dataDir, `Map${String(id).padStart(3, "0")}.json`);
    const map = readMapFileSafe(file);
    const tilesetId = Number(map?.tilesetId ?? 0);
    maps.push({
      id,
      name: typeof info.name === "string" && info.name ? info.name : `Map${String(id).padStart(3, "0")}`,
      parentId: Number(info.parentId ?? 0) || 0,
      order: Number(info.order ?? 0) || 0,
      width: Number(map?.width ?? 0) || 0,
      height: Number(map?.height ?? 0) || 0,
      tilesetId,
      tilesetName: tilesetNameById.get(tilesetId) ?? null,
      eventCount: Array.isArray(map?.events) ? map!.events!.filter(Boolean).length : 0,
    });
  }

  maps.sort((a, b) => (a.order - b.order) || (a.id - b.id));

  const childrenByParent = new Map<number, number[]>();
  for (const map of maps) {
    const list = childrenByParent.get(map.parentId) ?? [];
    list.push(map.id);
    childrenByParent.set(map.parentId, list);
  }
  const tree: RmmvMapTreeNode[] = [];
  for (const map of maps) {
    tree.push({ id: map.id, children: childrenByParent.get(map.id) ?? [] });
  }
  if (childrenByParent.has(0)) tree.unshift({ id: 0, children: childrenByParent.get(0) ?? [] });

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    maps,
    tree,
  };
}

function readArrayJson(file: string): unknown[] {
  try {
    const raw = readJson(file);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readMapFileSafe(file: string): MapFile | null {
  try {
    const raw = readJson(file);
    return raw && typeof raw === "object" ? (raw as MapFile) : null;
  } catch {
    return null;
  }
}

function indexTilesets(tilesets: unknown[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const tileset of tilesets as TilesetEntry[]) {
    if (!tileset || typeof tileset !== "object") continue;
    const id = Number(tileset.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (typeof tileset.name === "string" && tileset.name) out.set(id, tileset.name);
  }
  return out;
}
