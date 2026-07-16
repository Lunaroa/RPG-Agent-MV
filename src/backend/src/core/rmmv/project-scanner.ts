import path from "path";
import { exists, readJson } from "./json.ts";
import { summarizePage } from "./event-summary.ts";
import { listRmmvDatabaseSchemas } from "./database-schema.ts";
import { projectScannerPreviewLabels } from "./projectScannerLocalization.ts";
import { inspectRmmvProject, resolveRmmvDataDir } from "./rmmv-layout.ts";
import type { RpgMakerEngine } from "./rpg-maker-engine.ts";

const PROJECT_SCANNER_PREVIEW_LABELS = projectScannerPreviewLabels();

interface NameIndex {
  switches: string[];
  variables: string[];
  commonEvents: string[];
}

interface RMMVCommand {
  code: number;
  parameters?: unknown[];
}

interface MapEntry {
  id: number;
  name: string;
  parentId: number;
  order: number;
  fileName: string;
}

interface MapSummary extends MapEntry {
  exists: boolean;
  width: number;
  height: number;
  tilesetId: number;
  scrollType?: number;
  eventCount: number;
  events: MapEventSummary[];
}

interface MapEventSummary {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
  pageCount: number;
  pages: unknown[];
  searchText: string;
}

interface CommonEventSummary {
  id: number;
  name: string;
  trigger: string;
  switchId: number;
  switchName: string;
  commands: unknown;
  searchText: string;
}

interface Finding {
  severity: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

interface FindingSummary {
  error: number;
  warning: number;
  manualReview: number;
  info: number;
  total: number;
}

type DatabasePreviewAsset =
  | "characters"
  | "faces"
  | "svActors"
  | "enemies"
  | "svEnemies"
  | "animations"
  | "tilesets"
  | "battlebacks1"
  | "battlebacks2"
  | "system"
  | "titles1"
  | "titles2";

interface DatabaseEntryPreview {
  kind: "face" | "character" | "svActor" | "image" | "icon";
  asset: DatabasePreviewAsset;
  name?: string;
  index?: number;
  iconIndex?: number;
  label?: string;
}

interface DatabaseEntry {
  exists: boolean;
  count: number;
  capacity?: number;
  maxEntries?: number;
  named: { id: number; name: string; preview?: DatabaseEntryPreview }[];
}

interface ScanResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  engine: RpgMakerEngine;
  engineVersion: string | null;
  tileSize: number;
  screenWidth: number;
  screenHeight: number;
  faceSize: number;
  iconSize: number;
  database: Record<string, DatabaseEntry>;
  switches: { id: number; name: string }[];
  variables: { id: number; name: string }[];
  commonEvents: CommonEventSummary[];
  maps: MapSummary[];
  audit: { summary: FindingSummary; findings: Finding[] };
}

export type ProjectJsonReader = (fileName: string) => unknown | undefined;

export interface ScanProjectOptions {
  includeUnnamedEntries?: boolean;
  engineContext?: {
    engine: RpgMakerEngine;
    engineVersion: string | null;
    tileSize: number;
    screenWidth: number;
    screenHeight: number;
    faceSize: number;
    iconSize: number;
  };
}

export function scanProject(projectRoot: string, options?: ScanProjectOptions): ScanResult {
  const root = path.resolve(projectRoot);
  const manifest = inspectRmmvProject(root);
  const dataDir = manifest.dataDir;
  return scanProjectWithReader(root, (fileName) => {
    const filePath = path.join(dataDir, fileName);
    if (!exists(filePath)) return undefined;
    return readJson(filePath);
  }, {
    ...options,
    engineContext: {
      engine: manifest.engine,
      engineVersion: manifest.engineVersion,
      tileSize: manifest.tileSize,
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      faceSize: manifest.faceSize,
      iconSize: manifest.iconSize,
    },
  });
}

export function scanProjectWithReader(
  projectRoot: string,
  readFile: ProjectJsonReader,
  options: ScanProjectOptions = {},
): ScanResult {
  const root = path.resolve(projectRoot);
  const dataDir = resolveDataDir(root);
  const engineContext = options.engineContext ?? (() => {
    const manifest = inspectRmmvProject(root);
    return {
      engine: manifest.engine,
      engineVersion: manifest.engineVersion,
      tileSize: manifest.tileSize,
      screenWidth: manifest.screenWidth,
      screenHeight: manifest.screenHeight,
      faceSize: manifest.faceSize,
      iconSize: manifest.iconSize,
    };
  })();
  const includeUnnamed = Boolean(options.includeUnnamedEntries);
  const readOptionalFromReader = <T>(fileName: string, fallback: T): T => {
    const value = readFile(fileName);
    return value === undefined ? fallback : (value as T);
  };
  const system: Record<string, unknown> = readOptionalFromReader("System.json", {});
  const mapInfos: unknown[] = readOptionalFromReader("MapInfos.json", []);
  const commonEventsRaw: unknown[] = readOptionalFromReader("CommonEvents.json", []);
  const names: NameIndex = buildNameIndex(system, commonEventsRaw);
  const maps: MapSummary[] = scanMaps(readFile, mapInfos, names);
  const commonEvents: CommonEventSummary[] = summarizeCommonEvents(commonEventsRaw, names);
  const database: Record<string, DatabaseEntry> = summarizeDatabase(readFile, includeUnnamed);
  const audit = auditProject({ root, dataDir, system, mapInfos, maps, commonEvents, names });

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    ...engineContext,
    database,
    switches: summarizeNamedList((system as { switches?: string[] }).switches || [], includeUnnamed),
    variables: summarizeNamedList((system as { variables?: string[] }).variables || [], includeUnnamed),
    commonEvents,
    maps,
    audit
  };
}

export function resolveDataDir(root: string): string {
  return resolveRmmvDataDir(root);
}

function buildNameIndex(system: Record<string, unknown>, commonEventsRaw: unknown[]): NameIndex {
  const commonEvents: string[] = [];
  for (const event of (commonEventsRaw || []) as { id?: number; name?: string }[]) {
    if (event && event.id !== undefined) commonEvents[event.id] = event.name || "";
  }
  return {
    switches: (system as { switches?: string[] }).switches || [],
    variables: (system as { variables?: string[] }).variables || [],
    commonEvents
  };
}

function summarizeNamedList(list: string[], includeUnnamed = false): { id: number; name: string }[] {
  return (list || [])
    .map((name, id) => ({ id, name: name || "" }))
    .filter((entry) => entry.id > 0 && (includeUnnamed || entry.name));
}

interface MapInfoEntry {
  id: number;
  name?: string;
  parentId?: number;
  order?: number;
}

function scanMaps(readFile: ProjectJsonReader, mapInfos: unknown[], names: NameIndex): MapSummary[] {
  const mapEntries: MapEntry[] = ((mapInfos || []) as MapInfoEntry[])
    .filter(Boolean)
    .map((info) => ({
      id: info.id,
      name: info.name || "",
      parentId: info.parentId || 0,
      order: info.order || 0,
      fileName: `Map${String(info.id).padStart(3, "0")}.json`
    }));

  return mapEntries.map((entry) => {
    const mapData = readFile(entry.fileName);
    if (mapData === undefined) {
      return {
        ...entry,
        exists: false,
        width: 0,
        height: 0,
        tilesetId: 0,
        events: [],
        eventCount: 0
      };
    }

    const map = mapData as { width: number; height: number; tilesetId: number; scrollType?: number; events: unknown[] };
    const events: MapEventSummary[] = (map.events || [])
      .filter(Boolean)
      .map((event) => summarizeMapEvent(event, names));

    return {
      ...entry,
      exists: true,
      width: map.width,
      height: map.height,
      tilesetId: map.tilesetId,
      scrollType: map.scrollType,
      eventCount: events.length,
      events
    };
  });
}

interface RMMVMapEvent {
  id: number;
  name?: string;
  note?: string;
  x: number;
  y: number;
  pages?: unknown[];
}

function summarizeMapEvent(event: unknown, names: NameIndex): MapEventSummary {
  const e = event as RMMVMapEvent;
  const sourcePages = e.pages || [];
  const pages = sourcePages.map((page, index) => summarizePage(page as never, index + 1, names));
  return {
    id: e.id,
    name: e.name || "",
    note: e.note || "",
    x: e.x,
    y: e.y,
    pageCount: pages.length,
    pages,
    searchText: joinSearchParts([
      e.note || "",
      collectPagesSearchParts(sourcePages, names)
    ])
  };
}

interface RMMVCommonEvent {
  id: number;
  name?: string;
  trigger?: number;
  switchId?: number;
  list?: unknown[];
}

function summarizeCommonEvents(commonEventsRaw: unknown[], names: NameIndex): CommonEventSummary[] {
  return ((commonEventsRaw || []) as RMMVCommonEvent[])
    .filter(Boolean)
    .map((event) => {
      const commandList = event.list || [];
      return {
        id: event.id,
        name: event.name || "",
        trigger: commonEventTrigger(event.trigger || 0),
        switchId: event.switchId || 0,
        switchName: event.switchId ? names.switches[event.switchId] || "" : "",
        commands: summarizePage({ list: commandList, trigger: event.trigger, priorityType: 0 } as never, 1, names).commands,
        searchText: collectCommandListSearchText(commandList, names)
      };
    });
}

function collectPagesSearchParts(pages: unknown[], names: NameIndex): string[] {
  const parts: string[] = [];
  for (const page of pages || []) {
    const list = page && typeof page === "object" && Array.isArray((page as { list?: unknown[] }).list)
      ? (page as { list: unknown[] }).list
      : [];
    parts.push(...collectCommandListSearchParts(list, names));
  }
  return parts;
}

function collectCommandListSearchText(commands: unknown[], names: NameIndex): string {
  return joinSearchParts(collectCommandListSearchParts(commands, names));
}

function collectCommandListSearchParts(commands: unknown[], names: NameIndex): string[] {
  const parts: string[] = [];
  for (const command of commands || []) {
    if (!command || typeof command !== "object") continue;
    const record = command as RMMVCommand;
    const params = Array.isArray(record.parameters) ? record.parameters : [];
    collectCommandSearchParts(record.code, params, names, parts);
  }
  return parts;
}

function collectCommandSearchParts(code: number, params: unknown[], names: NameIndex, parts: string[]): void {
  switch (code) {
    case 101:
      pushSearchPart(parts, params[0]);
      return;
    case 401:
    case 405:
    case 408:
    case 655:
      pushSearchPart(parts, params[0]);
      return;
    case 102:
      collectReadableValues(params[0], parts, { includeNumbers: false });
      return;
    case 108:
      pushSearchPart(parts, params[0]);
      return;
    case 117:
      pushIdWithName(parts, params[0], names.commonEvents);
      return;
    case 121:
      pushRangeWithNames(parts, params[0], params[1], names.switches);
      pushSearchPart(parts, params[2] === 0 ? "ON" : "OFF");
      return;
    case 122:
      pushRangeWithNames(parts, params[0], params[1], names.variables);
      collectReadableValues(params.slice(2), parts, { includeNumbers: true });
      return;
    case 123:
      pushSearchPart(parts, params[0]);
      pushSearchPart(parts, params[1] === 0 ? "ON" : "OFF");
      return;
    case 201:
      pushSearchPart(parts, `Map${params[1] ?? ""}`);
      collectReadableValues(params.slice(1), parts, { includeNumbers: true });
      return;
    case 205:
      collectReadableValues(params, parts, { includeNumbers: false });
      return;
    case 231:
    case 232:
    case 241:
    case 245:
    case 249:
    case 250:
      collectReadableValues(params[0], parts, { includeNumbers: false });
      return;
    case 355:
    case 356:
    case 357:
      collectReadableValues(params, parts, { includeNumbers: false });
      return;
    default:
      collectReadableValues(params, parts, { includeNumbers: false });
      return;
  }
}

function pushIdWithName(parts: string[], value: unknown, names: string[]): void {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return;
  pushSearchPart(parts, id);
  pushSearchPart(parts, names[id]);
}

function pushRangeWithNames(parts: string[], fromValue: unknown, toValue: unknown, names: string[]): void {
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to < from) return;
  for (let id = from; id <= to; id += 1) {
    pushSearchPart(parts, id);
    pushSearchPart(parts, names[id]);
  }
}

function collectReadableValues(value: unknown, parts: string[], options: { includeNumbers: boolean }): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    pushSearchPart(parts, value);
    return;
  }
  if (typeof value === "number") {
    if (options.includeNumbers) pushSearchPart(parts, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReadableValues(item, parts, options);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectReadableValues(item, parts, options);
    }
  }
}

function pushSearchPart(parts: string[], value: unknown): void {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (text) parts.push(text);
}

function joinSearchParts(parts: unknown[]): string {
  const flat: string[] = [];
  for (const part of parts) {
    if (Array.isArray(part)) flat.push(...part.map((item) => String(item || "").trim()).filter(Boolean));
    else {
      const text = String(part || "").trim();
      if (text) flat.push(text);
    }
  }
  const seen = new Set<string>();
  return flat
    .filter((part) => {
      const key = part.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function commonEventTrigger(code: number): string {
  if (code === 0) return "none";
  if (code === 1) return "autorun";
  if (code === 2) return "parallel";
  return `trigger-${code}`;
}

function summarizeDatabase(
  readFile: ProjectJsonReader,
  includeUnnamed = false,
): Record<string, DatabaseEntry> {
  const result: Record<string, DatabaseEntry> = {};
  const tables = new Map<string, unknown>();
  for (const schema of listRmmvDatabaseSchemas()) {
    tables.set(schema.group, readFile(schema.fileName) ?? null);
  }
  for (const schema of listRmmvDatabaseSchemas()) {
    const data = tables.get(schema.group);
    if (data === null) {
      result[schema.group] = {
        exists: false,
        count: 0,
        ...(schema.maxEntries !== null ? { capacity: 0, maxEntries: schema.maxEntries } : {}),
        named: [],
      };
      continue;
    }
    if (!schema.isArrayTable) {
      result[schema.group] = {
        exists: true,
        count: 1,
        named: [databaseNamedEntry(0, documentDatabaseName(schema.group, data), summarizeDatabasePreview(schema.group, data, tables))]
      };
      continue;
    }
    const entries = (Array.isArray(data) ? data.filter(Boolean) : []) as Record<string, unknown>[];
    result[schema.group] = {
      exists: true,
      count: entries.length,
      capacity: Math.max(0, (Array.isArray(data) ? data.length : 1) - 1),
      ...(schema.maxEntries !== null ? { maxEntries: schema.maxEntries } : {}),
      named: entries
        .filter((entry) => Number(entry.id) > 0 && (includeUnnamed || entry.name))
        .map((entry) => databaseNamedEntry(Number(entry.id), String(entry.name || ""), summarizeDatabasePreview(schema.group, entry, tables)))
    };
  }
  return result;
}

function databaseNamedEntry(id: number, name: string, preview?: DatabaseEntryPreview): { id: number; name: string; preview?: DatabaseEntryPreview } {
  return preview ? { id, name, preview } : { id, name };
}

function summarizeDatabasePreview(group: string, entry: unknown, tables: Map<string, unknown>): DatabaseEntryPreview | undefined {
  const record = asRecord(entry);
  if (!record) return undefined;
  switch (group) {
    case "Actors":
      return namedAssetPreview("face", "faces", stringValue(record.faceName), numberValue(record.faceIndex), PROJECT_SCANNER_PREVIEW_LABELS.face)
        || namedAssetPreview("character", "characters", stringValue(record.characterName), numberValue(record.characterIndex), PROJECT_SCANNER_PREVIEW_LABELS.character)
        || namedAssetPreview("svActor", "svActors", stringValue(record.battlerName), undefined, PROJECT_SCANNER_PREVIEW_LABELS.svActor);
    case "Enemies":
      return namedAssetPreview("image", enemyBattlerPreviewAsset(tables), stringValue(record.battlerName), undefined, PROJECT_SCANNER_PREVIEW_LABELS.enemyBattler);
    case "Troops":
      return troopPreview(record, tables);
    case "Animations":
      return namedAssetPreview("image", "animations", stringValue(record.animation1Name), undefined, PROJECT_SCANNER_PREVIEW_LABELS.animationImage)
        || namedAssetPreview("image", "animations", stringValue(record.animation2Name), undefined, PROJECT_SCANNER_PREVIEW_LABELS.animationImage);
    case "Tilesets":
      return firstTilesetPreview(record);
    case "System":
      return namedAssetPreview("image", "titles1", stringValue(record.title1Name), undefined, PROJECT_SCANNER_PREVIEW_LABELS.title1)
        || namedAssetPreview("image", "titles2", stringValue(record.title2Name), undefined, PROJECT_SCANNER_PREVIEW_LABELS.title2)
        || namedAssetPreview("image", "battlebacks1", stringValue(record.battleback1Name), undefined, PROJECT_SCANNER_PREVIEW_LABELS.battleback1)
        || namedAssetPreview("image", "battlebacks2", stringValue(record.battleback2Name), undefined, PROJECT_SCANNER_PREVIEW_LABELS.battleback2);
    default:
      return iconPreview(record);
  }
}

function namedAssetPreview(
  kind: DatabaseEntryPreview["kind"],
  asset: DatabasePreviewAsset,
  name: string,
  index?: number,
  label?: string,
): DatabaseEntryPreview | undefined {
  if (!name) return undefined;
  return { kind, asset, name, index, label };
}

function iconPreview(record: Record<string, unknown>): DatabaseEntryPreview | undefined {
  const iconIndex = numberValue(record.iconIndex);
  if (iconIndex === undefined || iconIndex <= 0) return undefined;
  return { kind: "icon", asset: "system", name: "IconSet", iconIndex, label: `Icon #${iconIndex}` };
}

function troopPreview(record: Record<string, unknown>, tables: Map<string, unknown>): DatabaseEntryPreview | undefined {
  const members = Array.isArray(record.members) ? record.members : [];
  const enemies = Array.isArray(tables.get("Enemies")) ? tables.get("Enemies") as unknown[] : [];
  for (const member of members) {
    const enemyId = numberValue(asRecord(member)?.enemyId);
    if (enemyId === undefined || enemyId <= 0) continue;
    const enemy = enemies.find((item) => numberValue(asRecord(item)?.id) === enemyId);
    const battlerName = stringValue(asRecord(enemy)?.battlerName);
    if (battlerName) return namedAssetPreview("image", enemyBattlerPreviewAsset(tables), battlerName, undefined, PROJECT_SCANNER_PREVIEW_LABELS.troopMember);
  }
  return undefined;
}

function enemyBattlerPreviewAsset(tables: Map<string, unknown>): "enemies" | "svEnemies" {
  return asRecord(tables.get("System"))?.optSideView === true ? "svEnemies" : "enemies";
}

function firstTilesetPreview(record: Record<string, unknown>): DatabaseEntryPreview | undefined {
  const names = Array.isArray(record.tilesetNames) ? record.tilesetNames : [];
  const firstName = names.find((name) => typeof name === "string" && name.trim());
  return namedAssetPreview("image", "tilesets", String(firstName || ""), undefined, PROJECT_SCANNER_PREVIEW_LABELS.tilesetImage);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : undefined;
}

function documentDatabaseName(group: string, data: unknown): string {
  if (group === "System" && data && typeof data === "object" && !Array.isArray(data)) {
    return String((data as Record<string, unknown>).gameTitle || "System");
  }
  return group;
}

interface AuditContext {
  root: string;
  dataDir: string;
  system: Record<string, unknown>;
  mapInfos: unknown[];
  maps: MapSummary[];
  commonEvents: CommonEventSummary[];
  names: NameIndex;
}

function auditProject(context: AuditContext): { summary: FindingSummary; findings: Finding[] } {
  const findings: Finding[] = [];
  const mapIds = new Set(context.maps.filter((map) => map.exists).map((map) => map.id));

  for (const map of context.maps) {
    if (!map.exists) {
      findings.push(finding("error", "missing-map-file", `Map info references missing ${map.fileName}`, { mapId: map.id }));
      continue;
    }
    auditMapCoordinates(map, findings);
    auditEventPages(map, context.names, mapIds, findings);
  }

  for (const event of context.commonEvents) {
    if ((event.trigger === "autorun" || event.trigger === "parallel") && !event.switchId) {
      findings.push(finding("warning", "common-event-no-switch", `Common event ${event.id}:${event.name} is ${event.trigger} without a switch condition`, { commonEventId: event.id }));
    }
    const commands = (event.commands || {}) as { scriptCalls?: number; pluginCommands?: string[] };
    if (commands.scriptCalls && commands.scriptCalls > 0) {
      findings.push(finding("manual-review", "common-event-script", `Common event ${event.id}:${event.name} contains script calls`, { commonEventId: event.id, count: commands.scriptCalls }));
    }
    for (const command of commands.pluginCommands || []) {
      findings.push(finding("manual-review", "common-event-plugin-command", `Common event ${event.id}:${event.name} uses plugin command: ${command}`, { commonEventId: event.id }));
    }
  }

  return {
    summary: summarizeFindings(findings),
    findings
  };
}

interface SpatialEvent {
  id: number;
  name: string;
  x: number;
  y: number;
  pageCount: number;
  possibleBlocking: boolean;
  autorunPages: number[];
  parallelPages: number[];
}

function auditMapCoordinates(map: MapSummary, findings: Finding[]): void {
  const byPosition = new Map<string, SpatialEvent[]>();
  for (const event of map.events) {
    if (!Number.isInteger(event.x) || !Number.isInteger(event.y) || event.x < 0 || event.y < 0 || event.x >= map.width || event.y >= map.height) {
      findings.push(finding("error", "event-out-of-bounds", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} is outside map bounds`, {
        mapId: map.id,
        eventId: event.id,
        x: event.x,
        y: event.y,
        width: map.width,
        height: map.height
      }));
    }
    const key: string = `${event.x},${event.y}`;
    const sameTile: SpatialEvent[] = byPosition.get(key) || [];
    sameTile.push(event as unknown as SpatialEvent);
    byPosition.set(key, sameTile);
  }

  for (const [position, events] of byPosition.entries()) {
    if (events.length > 1) {
      findings.push(finding("info", "shared-event-tile", `Map ${map.id}:${map.name} has ${events.length} events at ${position}`, {
        mapId: map.id,
        position,
        eventIds: events.map((event) => event.id)
      }));
    }
  }
}

interface PageWithSignature {
  pageNumber: number;
  trigger?: string;
  conditions?: string[];
  conditionSignature?: { requirementCount?: number; switches?: number[]; selfSwitch?: string; itemId?: number; actorId?: number; variable?: { id: number; min: number } };
  commands?: { scriptCalls?: number; pluginCommands?: string[]; transfers?: { mode: string; mapId?: number }[] };
}

function auditEventPages(map: MapSummary, _names: NameIndex, mapIds: Set<number>, findings: Finding[]): void {
  for (const event of map.events) {
    if (event.pageCount === 0) {
      findings.push(finding("warning", "event-without-pages", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} has no pages`, {
        mapId: map.id,
        eventId: event.id
      }));
    }

    auditPageShadowing(map, event as unknown as { id: number; name: string; pages: PageWithSignature[] }, findings);

    for (const page of event.pages as unknown as PageWithSignature[]) {
      if (page.trigger === "autorun" || page.trigger === "parallel") {
        findings.push(finding(page.trigger === "autorun" ? "warning" : "info", `map-event-${page.trigger}`, `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} page ${page.pageNumber} is ${page.trigger}`, {
          mapId: map.id,
          eventId: event.id,
          pageNumber: page.pageNumber
        }));
      }

      const commands = page.commands || {} as { scriptCalls?: number; pluginCommands?: string[]; transfers?: { mode: string; mapId?: number }[] };
      for (const condition of page.conditions || []) {
        if (condition.includes("unnamed-switch") || condition.includes("unnamed-variable")) {
          findings.push(finding("manual-review", "unnamed-condition-state", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} page ${page.pageNumber} uses unnamed state: ${condition}`, {
            mapId: map.id,
            eventId: event.id,
            pageNumber: page.pageNumber
          }));
        }
      }

      for (const transfer of commands.transfers || []) {
        if (transfer.mode === "direct" && !mapIds.has(transfer.mapId!)) {
          findings.push(finding("error", "invalid-transfer-map", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} page ${page.pageNumber} transfers to missing map ${transfer.mapId}`, {
            mapId: map.id,
            eventId: event.id,
            pageNumber: page.pageNumber,
            targetMapId: transfer.mapId
          }));
        }
      }

      if (commands.scriptCalls && commands.scriptCalls > 0) {
        findings.push(finding("manual-review", "map-event-script", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} page ${page.pageNumber} contains script calls`, {
          mapId: map.id,
          eventId: event.id,
          pageNumber: page.pageNumber,
          count: commands.scriptCalls
        }));
      }

      for (const command of commands.pluginCommands || []) {
        findings.push(finding("manual-review", "map-event-plugin-command", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} page ${page.pageNumber} uses plugin command: ${command}`, {
          mapId: map.id,
          eventId: event.id,
          pageNumber: page.pageNumber
        }));
      }
    }
  }
}

function auditPageShadowing(map: MapSummary, event: { id: number; name: string; pages: PageWithSignature[] }, findings: Finding[]): void {
  const pages: PageWithSignature[] = event.pages || [];
  for (let lowIndex = 0; lowIndex < pages.length; lowIndex += 1) {
    const lowerPage = pages[lowIndex];
    for (let highIndex = lowIndex + 1; highIndex < pages.length; highIndex += 1) {
      const higherPage = pages[highIndex];
      if (lowerPageImpliesHigherPage(lowerPage, higherPage)) {
        findings.push(finding("warning", "event-page-shadowed", `Map ${map.id}:${map.name} event ${event.id}:${event.name || "(unnamed)"} page ${lowerPage.pageNumber} is shadowed by higher page ${higherPage.pageNumber}`, {
          mapId: map.id,
          eventId: event.id,
          pageNumber: lowerPage.pageNumber,
          shadowingPageNumber: higherPage.pageNumber,
          lowerConditions: lowerPage.conditions || [],
          higherConditions: higherPage.conditions || []
        }));
        break;
      }
    }
  }
}

function lowerPageImpliesHigherPage(lowerPage: PageWithSignature, higherPage: PageWithSignature): boolean {
  const lower = lowerPage.conditionSignature || { requirementCount: 0 };
  const higher = higherPage.conditionSignature || { requirementCount: 0 };
  if (!higher.requirementCount) return true;
  if ((lower.requirementCount || 0) < (higher.requirementCount || 0)) return false;

  const lowerSwitches = new Set(lower.switches || []);
  for (const switchId of higher.switches || []) {
    if (!lowerSwitches.has(switchId)) return false;
  }

  if (higher.selfSwitch !== undefined && lower.selfSwitch !== higher.selfSwitch) return false;
  if (higher.itemId !== undefined && lower.itemId !== higher.itemId) return false;
  if (higher.actorId !== undefined && lower.actorId !== higher.actorId) return false;
  if (higher.variable) {
    if (!lower.variable) return false;
    if (lower.variable.id !== higher.variable.id) return false;
    if (lower.variable.min < higher.variable.min) return false;
  }

  return true;
}

function finding(severity: string, code: string, message: string, details: Record<string, unknown>): Finding {
  return { severity, code, message, details: details || {} };
}

function summarizeFindings(findings: Finding[]): FindingSummary {
  const summary: Record<string, number> = {};
  for (const item of findings) {
    summary[item.severity] = (summary[item.severity] || 0) + 1;
  }
  return {
    error: summary.error || 0,
    warning: summary.warning || 0,
    manualReview: summary["manual-review"] || 0,
    info: summary.info || 0,
    total: findings.length
  };
}
