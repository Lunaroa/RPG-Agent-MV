import path from "node:path";

import { exists, readJson } from "./json.ts";
import { resolveDataDir } from "./project-scanner.ts";

export interface CommonEventReference {
  kind: "mapEvent" | "commonEvent" | "system";
  mapId?: number;
  eventId?: number;
  pageIndex?: number;
  commandIndex?: number;
  commonEventId?: number;
  systemKey?: string;
}

export interface CommonEventReferenceList {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  commonEventId: number;
  exists: boolean;
  name: string | null;
  referencedBy: CommonEventReference[];
}

interface RMMVCommand {
  code: number;
  parameters?: unknown[];
}

interface RMMVPage {
  list?: RMMVCommand[];
}

interface RMMVMapEvent {
  id?: number;
  pages?: RMMVPage[];
}

interface RMMVMap {
  events?: unknown[];
}

interface RMMVCommonEvent {
  id?: number;
  name?: string;
  list?: RMMVCommand[];
}

interface RMMVMapInfo {
  id?: number;
}

const COMMON_EVENT_CALL_CODE = 117;
const SYSTEM_COMMON_EVENT_KEYS = ["startCommonEvent"];

export function findCommonEventReferences(
  projectRoot: string,
  commonEventId: number,
): CommonEventReferenceList {
  if (!Number.isInteger(commonEventId) || commonEventId <= 0) {
    throw new Error(`commonEventId must be a positive integer (got ${commonEventId})`);
  }

  const root = path.resolve(projectRoot);
  const dataDir = resolveDataDir(root);
  const referencedBy: CommonEventReference[] = [];

  const commonEvents = readArrayJson(path.join(dataDir, "CommonEvents.json")) as RMMVCommonEvent[];
  const slot = commonEvents[commonEventId];
  const exists = !!(slot && (slot.id === commonEventId || slot.id === undefined));
  const name = exists && typeof slot?.name === "string" && slot.name ? slot.name : null;

  for (const event of commonEvents) {
    if (!event || typeof event !== "object") continue;
    const ownerId = Number(event.id);
    if (!Number.isInteger(ownerId) || ownerId <= 0) continue;
    if (ownerId === commonEventId) continue;
    const list = Array.isArray(event.list) ? event.list : [];
    list.forEach((command, commandIndex) => {
      if (matchesCommonEventCall(command, commonEventId)) {
        referencedBy.push({
          kind: "commonEvent",
          commonEventId: ownerId,
          commandIndex,
        });
      }
    });
  }

  const mapInfos = readArrayJson(path.join(dataDir, "MapInfos.json")) as RMMVMapInfo[];
  for (const info of mapInfos) {
    if (!info || typeof info !== "object") continue;
    const mapId = Number(info.id);
    if (!Number.isInteger(mapId) || mapId <= 0) continue;
    const mapFile = path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`);
    if (!existsFile(mapFile)) continue;
    const map = readJsonSafe(mapFile) as RMMVMap | null;
    const events = Array.isArray(map?.events) ? map!.events! : [];
    for (const rawEvent of events) {
      if (!rawEvent || typeof rawEvent !== "object") continue;
      const mapEvent = rawEvent as RMMVMapEvent;
      const eventId = Number(mapEvent.id);
      if (!Number.isInteger(eventId) || eventId <= 0) continue;
      const pages = Array.isArray(mapEvent.pages) ? mapEvent.pages : [];
      pages.forEach((page, pageIndex) => {
        const list = Array.isArray(page?.list) ? page!.list! : [];
        list.forEach((command, commandIndex) => {
          if (matchesCommonEventCall(command, commonEventId)) {
            referencedBy.push({
              kind: "mapEvent",
              mapId,
              eventId,
              pageIndex,
              commandIndex,
            });
          }
        });
      });
    }
  }

  const systemFile = path.join(dataDir, "System.json");
  if (existsFile(systemFile)) {
    const system = readJsonSafe(systemFile) as Record<string, unknown> | null;
    if (system) {
      for (const key of SYSTEM_COMMON_EVENT_KEYS) {
        const value = Number(system[key]);
        if (Number.isInteger(value) && value === commonEventId) {
          referencedBy.push({ kind: "system", systemKey: key });
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    commonEventId,
    exists,
    name,
    referencedBy,
  };
}

function matchesCommonEventCall(command: RMMVCommand | undefined, commonEventId: number): boolean {
  if (!command || command.code !== COMMON_EVENT_CALL_CODE) return false;
  const params = command.parameters;
  if (!Array.isArray(params) || params.length === 0) return false;
  return Number(params[0]) === commonEventId;
}

function readArrayJson(file: string): unknown[] {
  if (!existsFile(file)) return [];
  const raw = readJsonSafe(file);
  return Array.isArray(raw) ? raw : [];
}

function readJsonSafe(file: string): unknown {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function existsFile(file: string): boolean {
  try {
    return exists(file);
  } catch {
    return false;
  }
}
