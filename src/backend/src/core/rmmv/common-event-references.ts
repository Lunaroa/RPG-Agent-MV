import fs from "node:fs";
import path from "node:path";

import { getProjectFileForRead } from "../desktop/staging-service.ts";
import { readJson } from "./json.ts";
import { dataRelativePath, resolveRmmvLayout, type RmmvProjectLayout } from "./rmmv-layout.ts";

export interface CommonEventReference {
  kind: "mapEvent" | "commonEvent" | "troopEvent" | "databaseEffect" | "system";
  mapId?: number;
  eventId?: number;
  pageIndex?: number;
  commandIndex?: number;
  commonEventId?: number;
  troopId?: number;
  databaseFile?: "Skills.json" | "Items.json";
  databaseId?: number;
  effectIndex?: number;
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

const COMMON_EVENT_CALL_CODE = 117;
const COMMON_EVENT_EFFECT_CODE = 44;
const SYSTEM_COMMON_EVENT_KEYS = ["startCommonEvent"] as const;
const EFFECT_DATABASE_FILES = ["Skills.json", "Items.json"] as const;

export function findCommonEventReferences(
  projectRoot: string,
  commonEventId: number,
): CommonEventReferenceList {
  return scanCommonEventReferences(null, projectRoot, commonEventId);
}

export function findEffectiveCommonEventReferences(
  workflowRoot: string,
  projectRoot: string,
  commonEventId: number,
): CommonEventReferenceList {
  return scanCommonEventReferences(path.resolve(workflowRoot), projectRoot, commonEventId);
}

function scanCommonEventReferences(
  workflowRoot: string | null,
  projectRoot: string,
  commonEventId: number,
): CommonEventReferenceList {
  if (!Number.isInteger(commonEventId) || commonEventId <= 0) {
    throw new Error(`commonEventId must be a positive integer (got ${commonEventId})`);
  }

  const root = path.resolve(projectRoot);
  const layout = resolveRmmvLayout(root);
  const reader = new EffectiveProjectReader(workflowRoot, root, layout);
  const referencedBy: CommonEventReference[] = [];
  const commonEvents = reader.readArray("CommonEvents.json");
  const slot = commonEvents[commonEventId];
  const exists = isRecord(slot) && (slot.id === commonEventId || slot.id === undefined);
  const name = exists && typeof slot.name === "string" && slot.name ? slot.name : null;

  scanCommonEventCommands(commonEvents, commonEventId, referencedBy);
  scanMapCommands(reader, commonEventId, referencedBy);
  scanTroopCommands(reader, commonEventId, referencedBy);
  scanDatabaseEffects(reader, commonEventId, referencedBy);
  scanSystem(reader, commonEventId, referencedBy);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir: layout.dataDir,
    commonEventId,
    exists,
    name,
    referencedBy,
  };
}

function scanCommonEventCommands(
  commonEvents: unknown[],
  commonEventId: number,
  references: CommonEventReference[],
): void {
  commonEvents.forEach((event, ownerSlot) => {
    if (!isRecord(event)) return;
    const ownerId = Number.isInteger(event.id) ? Number(event.id) : ownerSlot;
    if (ownerId <= 0 || ownerId === commonEventId) return;
    scanCommandList(event.list, commonEventId, (commandIndex) => {
      references.push({ kind: "commonEvent", commonEventId: ownerId, commandIndex });
    });
  });
}

function scanMapCommands(
  reader: EffectiveProjectReader,
  commonEventId: number,
  references: CommonEventReference[],
): void {
  const mapInfos = reader.readArray("MapInfos.json");
  for (const info of mapInfos) {
    if (!isRecord(info)) continue;
    const mapId = Number(info.id);
    if (!Number.isInteger(mapId) || mapId <= 0) continue;
    const map = reader.readOptional(`Map${String(mapId).padStart(3, "0")}.json`);
    if (map === null) continue;
    if (!isRecord(map)) throw new Error(`RMMV map ${mapId} must be a JSON object.`);
    const events = Array.isArray(map.events) ? map.events : [];
    events.forEach((event, eventSlot) => {
      if (!isRecord(event)) return;
      const eventId = Number.isInteger(event.id) ? Number(event.id) : eventSlot;
      if (eventId <= 0) return;
      const pages = Array.isArray(event.pages) ? event.pages : [];
      pages.forEach((page, pageIndex) => {
        if (!isRecord(page)) return;
        scanCommandList(page.list, commonEventId, (commandIndex) => {
          references.push({ kind: "mapEvent", mapId, eventId, pageIndex, commandIndex });
        });
      });
    });
  }
}

function scanTroopCommands(
  reader: EffectiveProjectReader,
  commonEventId: number,
  references: CommonEventReference[],
): void {
  const troops = reader.readArray("Troops.json");
  troops.forEach((troop, troopSlot) => {
    if (!isRecord(troop)) return;
    const troopId = Number.isInteger(troop.id) ? Number(troop.id) : troopSlot;
    if (troopId <= 0) return;
    const pages = Array.isArray(troop.pages) ? troop.pages : [];
    pages.forEach((page, pageIndex) => {
      if (!isRecord(page)) return;
      scanCommandList(page.list, commonEventId, (commandIndex) => {
        references.push({ kind: "troopEvent", troopId, pageIndex, commandIndex });
      });
    });
  });
}

function scanDatabaseEffects(
  reader: EffectiveProjectReader,
  commonEventId: number,
  references: CommonEventReference[],
): void {
  for (const databaseFile of EFFECT_DATABASE_FILES) {
    const table = reader.readArray(databaseFile);
    table.forEach((record, databaseSlot) => {
      if (!isRecord(record)) return;
      const databaseId = Number.isInteger(record.id) ? Number(record.id) : databaseSlot;
      if (databaseId <= 0) return;
      const effects = Array.isArray(record.effects) ? record.effects : [];
      effects.forEach((effect, effectIndex) => {
        if (!isRecord(effect)) return;
        if (effect.code !== COMMON_EVENT_EFFECT_CODE || effect.dataId !== commonEventId) return;
        references.push({ kind: "databaseEffect", databaseFile, databaseId, effectIndex });
      });
    });
  }
}

function scanSystem(
  reader: EffectiveProjectReader,
  commonEventId: number,
  references: CommonEventReference[],
): void {
  const system = reader.readOptional("System.json");
  if (system === null) return;
  if (!isRecord(system)) throw new Error("System.json must contain a JSON object.");
  for (const systemKey of SYSTEM_COMMON_EVENT_KEYS) {
    if (system[systemKey] === commonEventId) references.push({ kind: "system", systemKey });
  }
}

function scanCommandList(
  value: unknown,
  commonEventId: number,
  onMatch: (commandIndex: number) => void,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((command, commandIndex) => {
    if (!isRecord(command) || command.code !== COMMON_EVENT_CALL_CODE || !Array.isArray(command.parameters)) return;
    if (command.parameters[0] === commonEventId) onMatch(commandIndex);
  });
}

class EffectiveProjectReader {
  readonly workflowRoot: string | null;
  readonly projectRoot: string;
  readonly layout: RmmvProjectLayout;

  constructor(
    workflowRoot: string | null,
    projectRoot: string,
    layout: RmmvProjectLayout,
  ) {
    this.workflowRoot = workflowRoot;
    this.projectRoot = projectRoot;
    this.layout = layout;
  }

  readArray(fileName: string): unknown[] {
    const value = this.readOptional(fileName);
    if (value === null) return [];
    if (!Array.isArray(value)) throw new Error(`${fileName} must contain a JSON array.`);
    return value;
  }

  readOptional(fileName: string): unknown | null {
    const relativePath = dataRelativePath(this.layout, fileName);
    const file = this.workflowRoot
      ? getProjectFileForRead(this.workflowRoot, this.projectRoot, relativePath)
      : sourceFile(this.projectRoot, relativePath);
    if (!file) return null;
    try {
      return readJson(file);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid RMMV JSON at ${relativePath}: ${detail}`, { cause: error });
    }
  }
}

function sourceFile(projectRoot: string, relativePath: string): string | null {
  const file = path.resolve(projectRoot, ...relativePath.split("/"));
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
