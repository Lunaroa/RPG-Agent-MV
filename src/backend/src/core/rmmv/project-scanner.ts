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
  readState: ProjectReadState;
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
  readState: ProjectReadState;
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
  readIssues: ProjectReadIssue[];
  audit: { summary: FindingSummary; findings: Finding[] };
}

export type ProjectReadState = "ready" | "missing" | "invalid";

export interface ProjectReadIssue {
  scope: "project" | "map" | "database" | "assets";
  relativePath: string;
  code: "read-failed" | "invalid-structure" | "missing-file";
  message: string;
  mapId?: number;
  databaseGroup?: string;
}

export type ProjectJsonReader = (fileName: string) => unknown | undefined;

export interface ScanProjectOptions {
  includeUnnamedEntries?: boolean;
  readIssueMode?: "strict" | "collect";
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
  const readContext = createProjectReadContext(root, dataDir, readFile, options.readIssueMode ?? "strict");
  const systemRead = readContext.read("System.json", { scope: "project", required: true });
  const mapInfosRead = readContext.read("MapInfos.json", { scope: "project", required: true });
  const commonEventsRead = readContext.read("CommonEvents.json", { scope: "database", databaseGroup: "CommonEvents" });
  const system: Record<string, unknown> = readContext.expectRecord(systemRead, "System.json", {});
  const mapInfos: unknown[] = readContext.expectArray(mapInfosRead, "MapInfos.json", []);
  const commonEventsRaw: unknown[] = readContext.expectArray(
    commonEventsRead,
    "CommonEvents.json",
    [],
    { scope: "database", databaseGroup: "CommonEvents" },
  );
  const normalizedSystem = systemRead.state === "ready"
    ? normalizeSystemNamedLists(readContext, system)
    : system;
  const names: NameIndex = buildNameIndex(normalizedSystem, commonEventsRaw);
  const maps: MapSummary[] = scanMaps(readContext, mapInfos, names);
  const commonEvents: CommonEventSummary[] = readContext.guard(
    "CommonEvents.json",
    { scope: "database", databaseGroup: "CommonEvents" },
    () => summarizeCommonEvents(commonEventsRaw, names),
    [],
  );
  const database: Record<string, DatabaseEntry> = summarizeDatabase(readContext, includeUnnamed);
  const audit = auditProject({ root, dataDir, system: normalizedSystem, mapInfos, maps, commonEvents, names });

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    dataDir,
    ...engineContext,
    database,
    switches: summarizeNamedList((normalizedSystem as { switches?: string[] }).switches || [], includeUnnamed),
    variables: summarizeNamedList((normalizedSystem as { variables?: string[] }).variables || [], includeUnnamed),
    commonEvents,
    maps,
    readIssues: readContext.issues,
    audit
  };
}

interface ProjectReadMetadata {
  scope: ProjectReadIssue["scope"];
  required?: boolean;
  mapId?: number;
  databaseGroup?: string;
}

interface ProjectFileReadResult {
  state: ProjectReadState;
  value?: unknown;
  errorMessage?: string;
}

interface ProjectReadContext {
  readonly issues: ProjectReadIssue[];
  read(fileName: string, metadata: ProjectReadMetadata): ProjectFileReadResult;
  expectArray<T>(result: ProjectFileReadResult, fileName: string, fallback: T[], metadata?: ProjectReadMetadata): T[];
  expectRecord<T extends Record<string, unknown>>(result: ProjectFileReadResult, fileName: string, fallback: T, metadata?: ProjectReadMetadata): T;
  missing(fileName: string, metadata: ProjectReadMetadata, message: string): void;
  invalid(fileName: string, metadata: ProjectReadMetadata, message: string): void;
  guard<T>(fileName: string, metadata: ProjectReadMetadata, run: () => T, fallback: T): T;
}

function createProjectReadContext(
  projectRoot: string,
  dataDir: string,
  readFile: ProjectJsonReader,
  mode: "strict" | "collect",
): ProjectReadContext {
  const issues: ProjectReadIssue[] = [];
  const issueKeys = new Set<string>();
  const reads = new Map<string, ProjectFileReadResult>();
  const relativePath = (fileName: string) => path.relative(projectRoot, path.join(dataDir, fileName)).replace(/\\/g, "/");
  const report = (fileName: string, metadata: ProjectReadMetadata, code: ProjectReadIssue["code"], message: string) => {
    if (mode === "strict") throw new Error(message);
    const issue: ProjectReadIssue = {
      scope: metadata.scope,
      relativePath: relativePath(fileName),
      code,
      message,
      ...(metadata.mapId !== undefined ? { mapId: metadata.mapId } : {}),
      ...(metadata.databaseGroup ? { databaseGroup: metadata.databaseGroup } : {}),
    };
    const key = `${issue.relativePath}:${issue.code}:${issue.mapId ?? ""}:${issue.databaseGroup ?? ""}`;
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(issue);
    }
  };
  const invalid = (fileName: string, metadata: ProjectReadMetadata, message: string) => {
    report(fileName, metadata, "invalid-structure", message);
  };
  const context: ProjectReadContext = {
    issues,
    read(fileName, metadata) {
      const cached = reads.get(fileName);
      if (cached) {
        if (cached.state === "missing" && metadata.required) {
          report(fileName, metadata, "missing-file", `Required project data is missing: ${relativePath(fileName)}`);
        }
        if (cached.state === "invalid") {
          report(fileName, metadata, "read-failed", cached.errorMessage || "Unable to read project data.");
        }
        return cached;
      }
      try {
        const value = readFile(fileName);
        const result: ProjectFileReadResult = value === undefined
          ? { state: "missing" }
          : { state: "ready", value };
        reads.set(fileName, result);
        if (result.state === "missing" && metadata.required) {
          report(fileName, metadata, "missing-file", `Required project data is missing: ${relativePath(fileName)}`);
        }
        return result;
      } catch (error) {
        const errorMessage = safeProjectReadError(error);
        const result: ProjectFileReadResult = { state: "invalid", errorMessage };
        reads.set(fileName, result);
        report(fileName, metadata, "read-failed", errorMessage);
        return result;
      }
    },
    expectArray<T>(result: ProjectFileReadResult, fileName: string, fallback: T[], metadata = { scope: "project" }): T[] {
      if (result.state !== "ready") return fallback;
      if (Array.isArray(result.value)) return result.value as T[];
      invalid(fileName, metadata, `Invalid project data structure: ${relativePath(fileName)} must contain an array.`);
      return fallback;
    },
    expectRecord<T extends Record<string, unknown>>(result: ProjectFileReadResult, fileName: string, fallback: T, metadata = { scope: "project" }): T {
      if (result.state !== "ready") return fallback;
      if (isRecord(result.value)) return result.value as T;
      invalid(fileName, metadata, `Invalid project data structure: ${relativePath(fileName)} must contain an object.`);
      return fallback;
    },
    missing(fileName, metadata, message) {
      if (mode === "collect") report(fileName, metadata, "missing-file", message);
    },
    invalid,
    guard<T>(fileName: string, metadata: ProjectReadMetadata, run: () => T, fallback: T): T {
      try {
        return run();
      } catch (error) {
        report(fileName, metadata, "invalid-structure", safeProjectReadError(error));
        return fallback;
      }
    },
  };
  return context;
}

function safeProjectReadError(error: unknown): string {
  if (error instanceof SyntaxError) return error.message;
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; syscall?: unknown };
    if (typeof record.code === "string") {
      return `${record.code}${typeof record.syscall === "string" ? ` (${record.syscall})` : ""}`;
    }
  }
  return error instanceof Error && !/[A-Za-z]:[\\/]/.test(error.message)
    ? error.message
    : "Unable to read project data.";
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

function scanMaps(readContext: ProjectReadContext, mapInfos: unknown[], names: NameIndex): MapSummary[] {
  const mapEntries: MapEntry[] = [];
  for (const rawInfo of mapInfos || []) {
    if (rawInfo == null) continue;
    if (!isRecord(rawInfo) || !Number.isInteger(rawInfo.id) || Number(rawInfo.id) <= 0) {
      readContext.invalid("MapInfos.json", { scope: "project" }, "Invalid map index structure: MapInfos.json contains an invalid map entry.");
      continue;
    }
    const info = rawInfo as unknown as MapInfoEntry;
    mapEntries.push({
      id: info.id,
      name: info.name || "",
      parentId: info.parentId || 0,
      order: info.order || 0,
      fileName: `Map${String(info.id).padStart(3, "0")}.json`,
    });
  }

  return mapEntries.map((entry) => {
    const metadata = { scope: "map" as const, mapId: entry.id };
    const mapRead = readContext.read(entry.fileName, metadata);
    if (mapRead.state === "missing") {
      readContext.missing(entry.fileName, metadata, `Map data is missing: ${entry.fileName}`);
      return {
        ...entry,
        exists: false,
        readState: "missing" as const,
        width: 0,
        height: 0,
        tilesetId: 0,
        events: [],
        eventCount: 0
      };
    }

    if (mapRead.state === "invalid") return invalidMapSummary(entry);
    const map = mapRead.value;
    if (!isRecord(map) || !Array.isArray(map.events)) {
      readContext.invalid(entry.fileName, metadata, `Invalid map structure: ${entry.fileName} must contain an events array.`);
      return invalidMapSummary(entry);
    }
    const events = readContext.guard(entry.fileName, metadata, () => map.events
      .filter(Boolean)
      .map((event) => {
        if (!isRecord(event) || !Array.isArray(event.pages)) {
          throw new Error(`Invalid map event structure in ${entry.fileName}.`);
        }
        return summarizeMapEvent(event, names);
      }), null);
    if (!events) return invalidMapSummary(entry);

    return {
      ...entry,
      exists: true,
      readState: "ready",
      width: Number(map.width || 0),
      height: Number(map.height || 0),
      tilesetId: Number(map.tilesetId || 0),
      scrollType: map.scrollType === undefined ? undefined : Number(map.scrollType),
      eventCount: events.length,
      events
    };
  });
}

function invalidMapSummary(entry: MapEntry): MapSummary {
  return {
    ...entry,
    exists: true,
    readState: "invalid",
    width: 0,
    height: 0,
    tilesetId: 0,
    events: [],
    eventCount: 0,
  };
}

function normalizeSystemNamedLists(
  readContext: ProjectReadContext,
  system: Record<string, unknown>,
): Record<string, unknown> {
  const normalize = (key: "switches" | "variables"): string[] => {
    const value = system[key];
    if (value == null) return [];
    if (Array.isArray(value) && value.every((entry) => entry == null || typeof entry === "string")) {
      return value.map((entry) => typeof entry === "string" ? entry : "");
    }
    readContext.invalid("System.json", { scope: "project" }, `Invalid project data structure: System.json ${key} must contain an array of names.`);
    return [];
  };
  return {
    ...system,
    switches: normalize("switches"),
    variables: normalize("variables"),
  };
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
  readContext: ProjectReadContext,
  includeUnnamed = false,
): Record<string, DatabaseEntry> {
  const result: Record<string, DatabaseEntry> = {};
  const tables = new Map<string, ProjectFileReadResult>();
  for (const schema of listRmmvDatabaseSchemas()) {
    tables.set(schema.group, readContext.read(schema.fileName, {
      scope: "database",
      databaseGroup: schema.group,
    }));
  }
  const previewTables = new Map<string, unknown>(
    [...tables.entries()].map(([group, read]) => [group, read.state === "ready" ? read.value : null]),
  );
  for (const schema of listRmmvDatabaseSchemas()) {
    const read = tables.get(schema.group)!;
    const data = read.value;
    if (read.state === "missing") {
      readContext.missing(schema.fileName, {
        scope: "database",
        databaseGroup: schema.group,
      }, `Database data is missing: ${schema.fileName}`);
      result[schema.group] = {
        exists: false,
        readState: "missing",
        count: 0,
        ...(schema.maxEntries !== null ? { capacity: 0, maxEntries: schema.maxEntries } : {}),
        named: [],
      };
      continue;
    }
    if (read.state === "invalid") {
      result[schema.group] = invalidDatabaseEntry(schema.maxEntries !== null, schema.maxEntries);
      continue;
    }
    if (!schema.isArrayTable) {
      if (!isRecord(data)) {
        readContext.invalid(schema.fileName, { scope: "database", databaseGroup: schema.group }, `Invalid database structure: ${schema.fileName} must contain an object.`);
        result[schema.group] = invalidDatabaseEntry(false, schema.maxEntries);
        continue;
      }
      result[schema.group] = {
        exists: true,
        readState: "ready",
        count: 1,
        named: [databaseNamedEntry(0, documentDatabaseName(schema.group, data), summarizeDatabasePreview(schema.group, data, previewTables))]
      };
      continue;
    }
    if (!Array.isArray(data) || data.some((entry) => entry != null && !isRecord(entry))) {
      readContext.invalid(schema.fileName, { scope: "database", databaseGroup: schema.group }, `Invalid database structure: ${schema.fileName} must contain an array of objects.`);
      result[schema.group] = invalidDatabaseEntry(true, schema.maxEntries);
      continue;
    }
    const entries = data.filter(Boolean) as Record<string, unknown>[];
    result[schema.group] = {
      exists: true,
      readState: "ready",
      count: entries.length,
      capacity: Math.max(0, data.length - 1),
      ...(schema.maxEntries !== null ? { maxEntries: schema.maxEntries } : {}),
      named: entries
        .filter((entry) => Number(entry.id) > 0 && (includeUnnamed || entry.name))
        .map((entry) => databaseNamedEntry(Number(entry.id), String(entry.name || ""), summarizeDatabasePreview(schema.group, entry, previewTables)))
    };
  }
  return result;
}

function invalidDatabaseEntry(hasCapacity: boolean, maxEntries: number | null): DatabaseEntry {
  return {
    exists: true,
    readState: "invalid",
    count: 0,
    ...(hasCapacity ? { capacity: 0 } : {}),
    ...(maxEntries !== null ? { maxEntries } : {}),
    named: [],
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
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
  const mapIds = new Set(context.maps.filter((map) => map.readState === "ready").map((map) => map.id));

  for (const map of context.maps) {
    if (!map.exists) {
      findings.push(finding("error", "missing-map-file", `Map info references missing ${map.fileName}`, { mapId: map.id }));
      continue;
    }
    if (map.readState !== "ready") continue;
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
