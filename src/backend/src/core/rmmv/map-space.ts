import path from "path";
import { exists, readJson } from "./json.ts";
import { resolveDataDir } from "./project-scanner.ts";

interface Direction {
  name: string;
  bit: number;
  dx: number;
  dy: number;
}

const DIRECTIONS: Direction[] = [
  { name: "down", bit: 1, dx: 0, dy: 1 },
  { name: "left", bit: 2, dx: -1, dy: 0 },
  { name: "right", bit: 4, dx: 1, dy: 0 },
  { name: "up", bit: 8, dx: 0, dy: -1 }
];

interface PassageResult {
  [direction: string]: boolean;
}

interface Cell {
  x: number;
  y: number;
  passage: PassageResult;
  class: string;
}

interface SpatialEvent {
  id: number;
  name: string;
  x: number;
  y: number;
  inBounds: boolean;
  pageCount: number;
  possibleBlocking: boolean;
  autorunPages: (number | null)[];
  parallelPages: (number | null)[];
}

interface Anchor {
  id: string;
  x: number;
  y: number;
  description: string;
  tileClass: string;
  occupiedBy: string[];
}

interface Finding {
  severity: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface MapSpaceOptions {
  maxPreviewWidth?: number;
  maxPreviewHeight?: number;
}

interface RMMVMap {
  width: number;
  height: number;
  tilesetId: number;
  data: number[];
  events: unknown[];
}

interface RMMVTileset {
  name?: string;
  flags?: number[];
}

interface RMMVMapInfo {
  id: number;
  name?: string;
}

interface RMMVEvent {
  id: number;
  name?: string;
  x: number;
  y: number;
  pages?: RMMVPage[];
}

interface RMMVPage {
  priorityType?: number;
  through?: boolean;
  trigger?: number;
}

export function analyzeMapSpace(projectRoot: string, mapId: number, options?: MapSpaceOptions): unknown {
  assertInteger(mapId, "mapId", 1);
  const { root, dataDir, mapInfo, mapFile, map, tileset } = loadMapSpaceInputs(projectRoot, mapId);

  const cells: Cell[][] = buildCells(map, tileset);
  const events: SpatialEvent[] = summarizeSpatialEvents(map.events || [], map.width, map.height);
  const occupancy = buildOccupancy(events);
  const anchors: Anchor[] = buildAnchors(map, cells, events, occupancy);
  const preview = renderAsciiPreview(map, cells, occupancy, options || {});
  const findings: Finding[] = auditMapSpace(map, mapInfo, cells, events, occupancy);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    map: {
      id: mapId,
      name: mapInfo.name || "",
      fileName: path.basename(mapFile),
      width: map.width,
      height: map.height,
      tilesetId: map.tilesetId,
      tilesetName: tileset.name || ""
    },
    summary: summarizeCells(cells, events),
    legend: {
      ".": "fully passable tile",
      ",": "partially passable tile",
      "#": "blocked tile",
      "E": "one event on tile",
      "*": "multiple events on tile"
    },
    preview,
    anchors,
    events,
    findings
  };
}

export function inspectMapCoordinate(projectRoot: string, mapId: number, x: number, y: number): unknown {
  assertInteger(mapId, "mapId", 1);
  assertInteger(x, "x", 0);
  assertInteger(y, "y", 0);
  const { root, dataDir, mapInfo, map, tileset } = loadMapSpaceInputs(projectRoot, mapId);
  const events: SpatialEvent[] = summarizeSpatialEvents(map.events || [], map.width, map.height);
  const occupancy = buildOccupancy(events);
  const inMapBounds: boolean = x < map.width && y < map.height;
  const passage: PassageResult | null = inMapBounds ? checkPassage(map, tileset, x, y) : null;
  const tileClass: string = passage ? classifyPassage(passage) : "out-of-bounds";
  const occupiedBy = (occupancy.get(positionKey(x, y)) || []).map((event) => ({
    id: event.id,
    name: event.name,
    possibleBlocking: event.possibleBlocking
  }));
  return {
    projectRoot: root,
    dataDir,
    map: {
      id: mapId,
      name: mapInfo.name || "",
      width: map.width,
      height: map.height,
      tilesetId: map.tilesetId,
      tilesetName: tileset.name || ""
    },
    x,
    y,
    inBounds: inMapBounds,
    tileClass,
    passage,
    occupiedBy
  };
}

function loadMapSpaceInputs(projectRoot: string, mapId: number): { root: string; dataDir: string; mapInfo: RMMVMapInfo; mapFile: string; map: RMMVMap; tileset: RMMVTileset } {
  const root: string = path.resolve(projectRoot);
  const dataDir: string = resolveDataDir(root);
  const mapInfos = readJson(path.join(dataDir, "MapInfos.json")) as RMMVMapInfo[];
  const tilesets = readJson(path.join(dataDir, "Tilesets.json")) as RMMVTileset[];
  const mapInfo: RMMVMapInfo | undefined = (mapInfos || []).find((entry) => entry && entry.id === mapId);
  if (!mapInfo) throw new Error(`Map ${mapId} is not present in MapInfos.json`);

  const mapFile: string = path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`);
  if (!exists(mapFile)) throw new Error(`Map file not found: ${mapFile}`);
  const map = readJson(mapFile) as RMMVMap;
  const tileset: RMMVTileset | undefined = tilesets && tilesets[map.tilesetId];
  if (!tileset) throw new Error(`Tileset ${map.tilesetId} for map ${mapId} is not present in Tilesets.json`);
  return { root, dataDir, mapInfo, mapFile, map, tileset };
}

function buildCells(map: RMMVMap, tileset: RMMVTileset): Cell[][] {
  const cells: Cell[][] = [];
  for (let y = 0; y < map.height; y += 1) {
    const row: Cell[] = [];
    for (let x = 0; x < map.width; x += 1) {
      const passage: PassageResult = checkPassage(map, tileset, x, y);
      row.push({
        x,
        y,
        passage,
        class: classifyPassage(passage)
      });
    }
    cells.push(row);
  }
  return cells;
}

export function checkPassage(map: RMMVMap, tileset: RMMVTileset, x: number, y: number): PassageResult {
  const result: PassageResult = {};
  for (const direction of DIRECTIONS) {
    result[direction.name] = isPassable(map, tileset, x, y, direction.bit);
  }
  return result;
}

function isPassable(map: RMMVMap, tileset: RMMVTileset, x: number, y: number, bit: number): boolean {
  const flags: number[] = tileset.flags || [];
  const tileIds: number[] = tileStack(map, x, y);
  for (const tileId of tileIds) {
    const flag: number = flags[tileId] || 0;
    if ((flag & 0x10) !== 0) continue;
    if ((flag & bit) === 0) return true;
    if ((flag & bit) === bit) return false;
  }
  return false;
}

function tileStack(map: RMMVMap, x: number, y: number): number[] {
  const tiles: number[] = [];
  for (let z = 3; z >= 0; z -= 1) {
    const index: number = (z * map.height + y) * map.width + x;
    tiles.push(map.data[index] || 0);
  }
  return tiles;
}

export function classifyPassage(passage: PassageResult): string {
  const values: boolean[] = Object.values(passage);
  const open: number = values.filter(Boolean).length;
  if (open === values.length) return "fully-passable";
  if (open > 0) return "partially-passable";
  return "blocked";
}

function summarizeSpatialEvents(rawEvents: unknown[], width: number, height: number): SpatialEvent[] {
  return (rawEvents as RMMVEvent[])
    .filter(Boolean)
    .map((event) => {
      const pages: RMMVPage[] = event.pages || [];
      return {
        id: event.id,
        name: event.name || "",
        x: event.x,
        y: event.y,
        inBounds: Number.isInteger(event.x) && Number.isInteger(event.y) && event.x >= 0 && event.y >= 0 && event.x < width && event.y < height,
        pageCount: pages.length,
        possibleBlocking: pages.some((page) => page.priorityType === 1 && !page.through),
        autorunPages: pages.map((page, index) => page.trigger === 3 ? index + 1 : null).filter(Boolean) as unknown as (number | null)[],
        parallelPages: pages.map((page, index) => page.trigger === 4 ? index + 1 : null).filter(Boolean) as unknown as (number | null)[]
      };
    });
}

function buildOccupancy(events: SpatialEvent[]): Map<string, SpatialEvent[]> {
  const byPosition = new Map<string, SpatialEvent[]>();
  for (const event of events) {
    const key: string = positionKey(event.x, event.y);
    const items: SpatialEvent[] = byPosition.get(key) || [];
    items.push(event);
    byPosition.set(key, items);
  }
  return byPosition;
}

function buildAnchors(map: RMMVMap, cells: Cell[][], events: SpatialEvent[], occupancy: Map<string, SpatialEvent[]>): Anchor[] {
  const anchors: Anchor[] = [];
  addAnchor(anchors, "map_center", Math.floor(map.width / 2), Math.floor(map.height / 2), "map midpoint", cells, occupancy);
  addAnchor(anchors, "north_center", Math.floor(map.width / 2), 0, "top edge midpoint", cells, occupancy);
  addAnchor(anchors, "south_center", Math.floor(map.width / 2), map.height - 1, "bottom edge midpoint", cells, occupancy);
  addAnchor(anchors, "west_center", 0, Math.floor(map.height / 2), "left edge midpoint", cells, occupancy);
  addAnchor(anchors, "east_center", map.width - 1, Math.floor(map.height / 2), "right edge midpoint", cells, occupancy);

  for (const event of events.slice(0, 200)) {
    if (!event.inBounds) continue;
    const eventLabel: string = safeLabel(event.name || `event_${event.id}`);
    addAnchor(anchors, `event_${event.id}_${eventLabel}`, event.x, event.y, `event ${event.id}:${event.name || "(unnamed)"}`, cells, occupancy);
    for (const direction of DIRECTIONS) {
      const x: number = event.x + direction.dx;
      const y: number = event.y + direction.dy;
      if (inBounds(cells, x, y) && cells[y][x].class !== "blocked") {
        addAnchor(anchors, `event_${event.id}_${direction.name}`, x, y, `adjacent ${direction.name} of event ${event.id}:${event.name || "(unnamed)"}`, cells, occupancy);
      }
    }
  }
  return anchors;
}

function addAnchor(anchors: Anchor[], id: string, x: number, y: number, description: string, cells: Cell[][], occupancy: Map<string, SpatialEvent[]>): void {
  if (!inBounds(cells, x, y)) return;
  const events: SpatialEvent[] = occupancy.get(positionKey(x, y)) || [];
  anchors.push({
    id,
    x,
    y,
    description,
    tileClass: cells[y][x].class,
    occupiedBy: events.map((event) => `${event.id}:${event.name || "(unnamed)"}`)
  });
}

interface AsciiPreview {
  omitted: boolean;
  reason?: string;
  lines: string[];
}

function renderAsciiPreview(map: RMMVMap, cells: Cell[][], occupancy: Map<string, SpatialEvent[]>, options: MapSpaceOptions): AsciiPreview {
  const maxWidth: number = options.maxPreviewWidth || 120;
  const maxHeight: number = options.maxPreviewHeight || 80;
  if (map.width > maxWidth || map.height > maxHeight) {
    return {
      omitted: true,
      reason: `Map ${map.width}x${map.height} exceeds preview limit ${maxWidth}x${maxHeight}.`,
      lines: []
    };
  }

  const lines: string[] = [];
  for (let y = 0; y < map.height; y += 1) {
    let line = "";
    for (let x = 0; x < map.width; x += 1) {
      const events: SpatialEvent[] = occupancy.get(positionKey(x, y)) || [];
      if (events.length > 1) {
        line += "*";
      } else if (events.length === 1) {
        line += "E";
      } else if (cells[y][x].class === "fully-passable") {
        line += ".";
      } else if (cells[y][x].class === "partially-passable") {
        line += ",";
      } else {
        line += "#";
      }
    }
    lines.push(line);
  }
  return {
    omitted: false,
    lines
  };
}

function auditMapSpace(_map: RMMVMap, mapInfo: RMMVMapInfo, cells: Cell[][], events: SpatialEvent[], occupancy: Map<string, SpatialEvent[]>): Finding[] {
  const findings: Finding[] = [];
  for (const event of events) {
    if (!event.inBounds) {
      findings.push(finding("error", "event-out-of-bounds", `Event ${event.id}:${event.name || "(unnamed)"} is outside map bounds`, { eventId: event.id, x: event.x, y: event.y }));
      continue;
    }
    const cell: Cell = cells[event.y][event.x];
    if (cell.class === "blocked") {
      findings.push(finding("review", "event-on-blocked-tile", `Event ${event.id}:${event.name || "(unnamed)"} is on a blocked tile`, { eventId: event.id, x: event.x, y: event.y }));
    }
    if (event.possibleBlocking) {
      findings.push(finding("info", "event-may-block", `Event ${event.id}:${event.name || "(unnamed)"} may block movement on (${event.x},${event.y})`, { eventId: event.id, x: event.x, y: event.y }));
    }
    if (event.autorunPages.length) {
      findings.push(finding("review", "event-autorun-pages", `Event ${event.id}:${event.name || "(unnamed)"} has autorun pages ${event.autorunPages.join(", ")}`, { eventId: event.id, pages: event.autorunPages }));
    }
  }

  for (const [position, items] of occupancy.entries()) {
    if (items.length > 1) {
      findings.push(finding("review", "shared-event-tile", `Map ${mapInfo.id}:${mapInfo.name || "(unnamed)"} has ${items.length} events at ${position}`, {
        position,
        eventIds: items.map((event) => event.id)
      }));
    }
  }
  return findings;
}

interface CellSummary {
  fullyPassable: number;
  partiallyPassable: number;
  blocked: number;
  events: number;
  possibleBlockingEvents: number;
  autorunEvents: number;
  parallelEvents: number;
}

function summarizeCells(cells: Cell[][], events: SpatialEvent[]): CellSummary {
  const summary: CellSummary = {
    fullyPassable: 0,
    partiallyPassable: 0,
    blocked: 0,
    events: events.length,
    possibleBlockingEvents: events.filter((event) => event.possibleBlocking).length,
    autorunEvents: events.filter((event) => event.autorunPages.length).length,
    parallelEvents: events.filter((event) => event.parallelPages.length).length
  };
  for (const row of cells) {
    for (const cell of row) {
      if (cell.class === "fully-passable") summary.fullyPassable += 1;
      else if (cell.class === "partially-passable") summary.partiallyPassable += 1;
      else summary.blocked += 1;
    }
  }
  return summary;
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

function inBounds(cells: Cell[][], x: number, y: number): boolean {
  return y >= 0 && y < cells.length && x >= 0 && x < cells[y].length;
}

function finding(severity: string, code: string, message: string, details: Record<string, unknown>): Finding {
  return { severity, code, message, details: details || {} };
}

function safeLabel(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "unnamed";
}

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
}
