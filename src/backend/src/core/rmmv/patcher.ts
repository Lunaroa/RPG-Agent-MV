import fs from "fs";
import path from "path";
import { isEmptyCommonEventSlot } from "./common-event-slot.ts";
import {
  EVENT_COMMAND_BLOCK_HEAD_CODES,
  EVENT_COMMAND_BLOCK_PAIRINGS,
  EVENT_COMMAND_CONTINUATION_CODES,
  validateEventCommandBasic
} from "./event-command-registry.ts";
import { readJson, writeJson, writeMapJson } from "./json.ts";
import { resolveDataDir } from "./project-scanner.ts";
import { compileCommands, compileImage, compilePage, validateImageName } from "./event-page-compiler.ts";

const COMMON_EVENT_TRIGGERS: Record<string, number> = {
  none: 0,
  autorun: 1,
  parallel: 2
};

const MAX_GENERATED_MAP_SIZE: number = 256;

interface PatchSpec {
  engine: string;
  operations: PatchOperation[];
}

interface PatchOperation {
  op: string;
  [key: string]: unknown;
}

interface PatchReport {
  mode: string;
  writesProject: boolean;
  projectRoot: string;
  dataDir: string;
  operations: unknown[];
}

interface PatchContext {
  root: string;
  dataDir: string;
  commonEventFile: string;
  commonEvents: unknown[];
  systemFile: string;
  system: Record<string, unknown>;
  mapInfos: unknown[];
  mapInfosFile: string;
  tilesets: unknown[];
  plannedMaps: Map<number, { id: number; width: number; height: number; name: string }>;
  reservedCommonEventIds: Set<number>;
  reservedMapIds: Set<number>;
}

interface BackupEntry {
  filePath: string;
  existed: boolean;
  content: Buffer | null;
}

export function applyPatchToProjectCopy(_projectRoot: string, _spec: PatchSpec, _outProjectRoot: string): never {
  throw new Error("Full project copy patching is disabled; apply patches directly to the Git worktree with applyPatchToProject.");
}

export function applyPatchToProject(projectRoot: string, spec: PatchSpec): PatchReport {
  const root: string = path.resolve(projectRoot);
  const context: PatchContext = createPatchContext(root, spec);
  const report: PatchReport = {
    mode: "apply",
    writesProject: true,
    projectRoot: root,
    dataDir: context.dataDir,
    operations: []
  };

  for (const operation of spec.operations) {
    if (operation.op === "add-map") {
      report.operations.push(addMap(context, operation));
    } else if (operation.op === "add-map-event") {
      report.operations.push(addMapEvent(context, operation));
    } else if (operation.op === "add-event-page") {
      report.operations.push(addEventPage(context, operation));
    } else if (operation.op === "add-common-event") {
      report.operations.push(addCommonEvent(context, operation));
    } else if (operation.op === "name-switch") {
      report.operations.push(nameSystemEntry(context, operation, "switches", "switch"));
    } else if (operation.op === "name-variable") {
      report.operations.push(nameSystemEntry(context, operation, "variables", "variable"));
    } else if (operation.op === "set-system-option") {
      report.operations.push(setSystemOption(context, operation));
    } else if (operation.op === "set-event-page-image") {
      report.operations.push(setEventPageImage(context, operation));
    } else if (operation.op === "set-map-tiles") {
      report.operations.push(setMapTiles(context, operation));
    } else if (operation.op === "replace-event-command") {
      report.operations.push(replaceEventCommand(context, operation));
    } else if (operation.op === "insert-event-command") {
      report.operations.push(insertEventCommand(context, operation));
    } else if (operation.op === "delete-event-command") {
      report.operations.push(deleteEventCommand(context, operation));
    } else if (operation.op === "patch-event-page") {
      report.operations.push(patchEventPage(context, operation));
    } else {
      throw new Error(`Unsupported patch operation: ${operation.op}`);
    }
  }

  return report;
}

export async function withPatchedProjectFiles(projectRoot: string, spec: PatchSpec, callback: (root: string, report: PatchReport) => Promise<unknown>): Promise<unknown> {
  const root: string = path.resolve(projectRoot);
  const backups: BackupEntry[] = backupPatchFiles(root, spec);
  let report: PatchReport | null = null;
  try {
    report = applyPatchToProject(root, spec);
    return await callback(root, report);
  } finally {
    restorePatchFiles(backups);
  }
}

export function previewPatch(projectRoot: string, spec: PatchSpec): PatchReport {
  const root: string = path.resolve(projectRoot);
  const context: PatchContext = createPatchContext(root, spec);
  const report: PatchReport = {
    mode: "dry-run",
    writesProject: false,
    projectRoot: root,
    dataDir: context.dataDir,
    operations: []
  };

  for (const operation of spec.operations) {
    if (operation.op === "add-map") {
      report.operations.push(prepareMap(context, operation).report);
    } else if (operation.op === "add-map-event") {
      report.operations.push(prepareMapEvent(context, operation).report);
    } else if (operation.op === "add-event-page") {
      report.operations.push(prepareEventPage(context, operation).report);
    } else if (operation.op === "add-common-event") {
      report.operations.push(prepareCommonEvent(context, operation).report);
    } else if (operation.op === "name-switch") {
      report.operations.push(prepareSystemName(context, operation, "switches", "switch").report);
    } else if (operation.op === "name-variable") {
      report.operations.push(prepareSystemName(context, operation, "variables", "variable").report);
    } else if (operation.op === "set-system-option") {
      report.operations.push(prepareSystemOption(context, operation).report);
    } else if (operation.op === "set-event-page-image") {
      report.operations.push(prepareEventPageImage(context, operation).report);
    } else if (operation.op === "set-map-tiles") {
      report.operations.push(prepareMapTiles(context, operation).report);
    } else if (operation.op === "replace-event-command") {
      report.operations.push(prepareReplaceEventCommand(context, operation).report);
    } else if (operation.op === "insert-event-command") {
      report.operations.push(prepareInsertEventCommand(context, operation).report);
    } else if (operation.op === "delete-event-command") {
      report.operations.push(prepareDeleteEventCommand(context, operation).report);
    } else if (operation.op === "patch-event-page") {
      report.operations.push(preparePatchEventPage(context, operation).report);
    } else {
      throw new Error(`Unsupported patch operation: ${operation.op}`);
    }
  }

  return report;
}

function createPatchContext(root: string, spec: PatchSpec): PatchContext {
  validateSpecShape(spec);
  const dataDir: string = resolveDataDir(root);
  return {
    root,
    dataDir,
    commonEventFile: path.join(dataDir, "CommonEvents.json"),
    commonEvents: readJson(path.join(dataDir, "CommonEvents.json")) as unknown[],
    systemFile: path.join(dataDir, "System.json"),
    system: readJson(path.join(dataDir, "System.json")) as Record<string, unknown>,
    mapInfos: readJson(path.join(dataDir, "MapInfos.json")) as unknown[],
    mapInfosFile: path.join(dataDir, "MapInfos.json"),
    tilesets: readJson(path.join(dataDir, "Tilesets.json")) as unknown[],
    plannedMaps: plannedMapsById(spec),
    reservedCommonEventIds: new Set(),
    reservedMapIds: new Set()
  };
}

function backupPatchFiles(projectRoot: string, spec: PatchSpec): BackupEntry[] {
  const context: PatchContext = createPatchContext(projectRoot, spec);
  const files: string[] = affectedPatchFiles(context, spec);
  return files.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  }));
}

function restorePatchFiles(backups: BackupEntry[]): void {
  for (const backup of backups.slice().reverse()) {
    if (backup.existed) {
      fs.mkdirSync(path.dirname(backup.filePath), { recursive: true });
      fs.writeFileSync(backup.filePath, backup.content!);
    } else {
      fs.rmSync(backup.filePath, { force: true });
    }
  }
}

function affectedPatchFiles(context: PatchContext, spec: PatchSpec): string[] {
  const files = new Set<string>();
  for (const operation of spec.operations || []) {
    if (operation.op === "add-map") {
      files.add(context.mapInfosFile);
      if (Number.isInteger(operation.id)) files.add(path.join(context.dataDir, `Map${String(operation.id).padStart(3, "0")}.json`));
    } else if (operation.op === "add-common-event") {
      files.add(context.commonEventFile);
    } else if (operation.op === "name-switch" || operation.op === "name-variable" || operation.op === "set-system-option") {
      files.add(context.systemFile);
    } else if (Number.isInteger(operation.mapId)) {
      files.add(path.join(context.dataDir, `Map${String(operation.mapId).padStart(3, "0")}.json`));
    }
  }
  return Array.from(files);
}

function plannedMapsById(spec: PatchSpec): Map<number, { id: number; width: number; height: number; name: string }> {
  const result = new Map<number, { id: number; width: number; height: number; name: string }>();
  for (const operation of spec.operations || []) {
    if (operation && operation.op === "add-map" && Number.isInteger(operation.id)) {
      result.set(operation.id as number, {
        id: operation.id as number,
        width: operation.width as number,
        height: operation.height as number,
        name: (operation.name as string) || ""
      });
    }
  }
  return result;
}

interface RMMVMapInfo {
  id: number;
  name?: string;
  expanded?: boolean;
  order?: number;
  parentId?: number;
  scrollX?: number;
  scrollY?: number;
}

interface PreparedMap {
  mapFile: string;
  mapInfosFile: string;
  mapInfo: RMMVMapInfo;
  map: Record<string, unknown>;
  report: Record<string, unknown>;
}

function addMap(context: PatchContext, operation: PatchOperation): unknown {
  const prepared: PreparedMap = prepareMap(context, operation);
  context.mapInfos[operation.id as number] = prepared.mapInfo;
  writeJson(prepared.mapInfosFile, context.mapInfos);
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

interface PreparedMapEvent {
  mapFile: string;
  map: Record<string, unknown>;
  event: { id: number; [key: string]: unknown };
  unplaced: boolean;
  report: Record<string, unknown>;
}

function addMapEvent(context: PatchContext, operation: PatchOperation): unknown {
  const prepared: PreparedMapEvent = prepareMapEvent(context, operation);
  (prepared.map.events as Record<number, unknown>)[prepared.event.id] = prepared.event;
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

interface PreparedEventPage {
  mapFile: string;
  map: Record<string, unknown>;
  event: { pages: unknown[]; [key: string]: unknown };
  page: unknown;
  report: Record<string, unknown>;
}

function addEventPage(context: PatchContext, operation: PatchOperation): unknown {
  const prepared: PreparedEventPage = prepareEventPage(context, operation);
  (prepared.event.pages as unknown[]).push(prepared.page);
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

interface PreparedCommonEvent {
  commonEvent: unknown;
  report: Record<string, unknown>;
}

function addCommonEvent(context: PatchContext, operation: PatchOperation): unknown {
  const prepared: PreparedCommonEvent = prepareCommonEvent(context, operation);
  context.commonEvents[operation.id as number] = prepared.commonEvent;
  writeJson(context.commonEventFile, context.commonEvents);
  return prepared.report;
}

function nameSystemEntry(context: PatchContext, operation: PatchOperation, listName: string, label: string): unknown {
  const prepared = prepareSystemName(context, operation, listName, label);
  const list = context.system[listName] as string[];
  while (list.length <= (operation.id as number)) list.push("");
  list[operation.id as number] = operation.name as string;
  writeJson(context.systemFile, context.system);
  return prepared.report;
}

function setSystemOption(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = prepareSystemOption(context, operation);
  context.system[operation.key as string] = operation.value;
  writeJson(context.systemFile, context.system);
  return prepared.report;
}

function setEventPageImage(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = prepareEventPageImage(context, operation);
  const event = prepared.event as { pages: { image: unknown }[] };
  event.pages[(operation.pageIndex as number)].image = prepared.afterImage;
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

function setMapTiles(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = prepareMapTiles(context, operation);
  for (const edit of prepared.edits) {
    (prepared.map.data as number[])[edit.index] = edit.afterTileId;
  }
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

function prepareSystemName(context: PatchContext, operation: PatchOperation, listName: string, label: string): { report: Record<string, unknown> } {
  assertInteger(operation.id as number, `${label}.id`, 1);
  if (!operation.name || typeof operation.name !== "string") throw new Error(`${operation.op} requires a non-empty string name`);
  const list: string[] = context.system[listName] as string[];
  if (!Array.isArray(list)) throw new Error(`System.json ${listName} must be an array`);
  const beforeLength: number = list.length;
  if ((operation.id as number) >= list.length) {
    if (operation.allowExtend !== true) {
      throw new Error(`${label} ${operation.id} is outside the configured System.json ${listName} range. Set allowExtend=true only for explicit append-slot patches.`);
    }
  }
  const beforeName: string = list[operation.id as number] || "";
  if (beforeName && operation.allowRename !== true) {
    throw new Error(`${label} ${operation.id}:${beforeName} is already named. Set allowRename=true only for explicit rename patches.`);
  }
  return {
    report: {
      op: operation.op,
      id: operation.id,
      beforeName,
      afterName: operation.name,
      renamed: Boolean(beforeName),
      extended: (operation.id as number) >= beforeLength,
      beforeLength,
      afterLength: Math.max(beforeLength, (operation.id as number) + 1),
      systemFile: context.systemFile
    }
  };
}

function prepareSystemOption(context: PatchContext, operation: PatchOperation): { report: Record<string, unknown> } {
  if (operation.key !== "optTransparent") {
    throw new Error(`Unsupported system option: ${operation.key}`);
  }
  if (typeof operation.value !== "boolean") {
    throw new Error("set-system-option value for optTransparent must be a boolean");
  }
  const beforeValue = context.system[operation.key as string];
  if (beforeValue !== undefined && typeof beforeValue !== "boolean") {
    throw new Error(`System.json ${operation.key} must be a boolean when present`);
  }
  return {
    report: {
      op: operation.op,
      key: operation.key,
      beforeValue,
      afterValue: operation.value,
      changed: beforeValue !== operation.value,
      systemFile: context.systemFile
    }
  };
}

function prepareCommonEvent(context: PatchContext, operation: PatchOperation): PreparedCommonEvent {
  assertInteger(operation.id as number, "common-event.id", 1);
  if (!operation.name || typeof operation.name !== "string") {
    throw new Error("add-common-event requires a non-empty string name");
  }
  if (!Array.isArray(operation.commands)) {
    throw new Error("add-common-event requires a commands array");
  }
  if (!Array.isArray(context.commonEvents)) {
    throw new Error("CommonEvents.json must be an array");
  }
  if ((operation.id as number) >= context.commonEvents.length) {
    throw new Error(`common event ${operation.id} is outside the configured CommonEvents.json range`);
  }
  if (context.reservedCommonEventIds.has(operation.id as number)) {
    throw new Error(`common event ${operation.id} is already reserved by an earlier operation in this patch`);
  }

  const before = context.commonEvents[operation.id as number] as { name?: string; switchId?: number } | null;
  if (!isEmptyCommonEventSlot(before, operation.id as number)) {
    const name: string = before && before.name ? `:${before.name}` : "";
    throw new Error(`common event ${operation.id}${name} is already occupied; add-common-event only fills empty slots`);
  }

  const triggerName: string = (operation.trigger as string) || "none";
  if (COMMON_EVENT_TRIGGERS[triggerName] === undefined) {
    throw new Error(`Unsupported common event trigger: ${triggerName}`);
  }
  const trigger: number = COMMON_EVENT_TRIGGERS[triggerName];
  const switchId: number = (operation.switchId as number) || 0;
  if (trigger === COMMON_EVENT_TRIGGERS.none) {
    if (switchId !== 0) throw new Error("add-common-event with trigger none must not set switchId");
  } else {
    assertInteger(switchId, "common-event.switchId", 1);
    const switches: unknown[] = (context.system.switches as unknown[]) || [];
    if (!Array.isArray(switches) || switchId >= switches.length) {
      throw new Error(`common event trigger switch ${switchId} is outside the configured System.json switches range`);
    }
  }

  const commonEvent = {
    id: operation.id,
    name: operation.name,
    trigger,
    switchId,
    list: compileCommands(operation.commands as never[], context.system, context.dataDir, context as unknown as { plannedMaps?: Map<number, unknown> })
  };
  context.reservedCommonEventIds.add(operation.id as number);

  return {
    commonEvent,
    report: {
      op: operation.op,
      commonEventId: operation.id,
      commonEventName: operation.name,
      trigger: triggerName,
      switchId,
      commands: (operation.commands as unknown[]).length,
      commonEventFile: context.commonEventFile
    }
  };
}

function prepareMap(context: PatchContext, operation: PatchOperation): PreparedMap {
  assertInteger(operation.id as number, "add-map.id", 1);
  if (!operation.name || typeof operation.name !== "string") {
    throw new Error("add-map requires a non-empty string name");
  }
  assertInteger(operation.width as number, "add-map.width", 1);
  assertInteger(operation.height as number, "add-map.height", 1);
  if ((operation.width as number) > MAX_GENERATED_MAP_SIZE || (operation.height as number) > MAX_GENERATED_MAP_SIZE) {
    throw new Error(`add-map width and height must be <= ${MAX_GENERATED_MAP_SIZE}`);
  }
  assertInteger(operation.tilesetId as number, "add-map.tilesetId", 1);
  if (!context.tilesets || !(context.tilesets as Record<number, unknown>)[operation.tilesetId as number]) {
    throw new Error(`Tileset ${operation.tilesetId} is not present in Tilesets.json`);
  }
  if ((context.mapInfos || []).some((entry) => entry && (entry as { id: number }).id === operation.id)) {
    throw new Error(`Map ${operation.id} is already present in MapInfos.json`);
  }
  if (context.reservedMapIds.has(operation.id as number)) {
    throw new Error(`Map ${operation.id} is already reserved by an earlier operation in this patch`);
  }
  const mapFile: string = path.join(context.dataDir, `Map${String(operation.id).padStart(3, "0")}.json`);
  if (fs.existsSync(mapFile)) {
    throw new Error(`Map file already exists: ${mapFile}`);
  }

  const fillTileId: number = operation.fillTileId === undefined ? 1 : (operation.fillTileId as number);
  assertInteger(fillTileId, "add-map.fillTileId", 0);
  const data: number[] = Array((operation.width as number) * (operation.height as number) * 6).fill(0);
  for (let index = 0; index < (operation.width as number) * (operation.height as number); index += 1) data[index] = fillTileId;
  const draftMap = {
    width: operation.width as number,
    height: operation.height as number,
    data
  };
  const tileEdits = ((operation.tileEdits || []) as PatchOperation[]).map((edit, index) => prepareTileEdit(draftMap, edit, index, "add-map.tileEdits"));
  for (const edit of tileEdits) data[edit.index] = edit.afterTileId;

  const events: unknown[] = [null];
  const eventIds = new Set<number>();
  for (const [index, eventSpec] of ((operation.events || []) as PatchOperation[]).entries()) {
    const eventId: number = eventSpec && eventSpec.id !== undefined ? (eventSpec.id as number) : nextEventId(events);
    if (eventIds.has(eventId)) throw new Error(`add-map.events[${index}].id duplicates event ${eventId}`);
    eventIds.add(eventId);
    events[eventId] = compileNewMapEvent(eventSpec, eventId, operation, context, index);
  }

  const map = createMapData(operation, data, events);
  const mapInfo: RMMVMapInfo = createMapInfo(context, operation);
  context.reservedMapIds.add(operation.id as number);
  return {
    mapFile,
    mapInfosFile: context.mapInfosFile,
    mapInfo,
    map,
    report: {
      op: operation.op,
      mapId: operation.id,
      mapName: operation.name,
      width: operation.width,
      height: operation.height,
      tilesetId: operation.tilesetId,
      parentId: mapInfo.parentId,
      order: mapInfo.order,
      fillTileId,
      tileEdits: tileEdits.length,
      events: ((operation.events || []) as unknown[]).length,
      mapFile,
      mapInfosFile: context.mapInfosFile
    }
  };
}

function createMapInfo(context: PatchContext, operation: PatchOperation): RMMVMapInfo {
  const maxOrder: number = (context.mapInfos || []).reduce((max: number, entry) => entry && Number.isFinite((entry as RMMVMapInfo).order) && (entry as RMMVMapInfo).order! > max ? (entry as RMMVMapInfo).order! : max, 0);
  const parentId: number = operation.parentId === undefined ? 0 : (operation.parentId as number);
  assertInteger(parentId, "add-map.parentId", 0);
  return {
    id: operation.id as number,
    expanded: Boolean(operation.expanded),
    name: operation.name as string,
    order: operation.order === undefined ? maxOrder + 1 : (operation.order as number),
    parentId,
    scrollX: operation.scrollX === undefined ? 0 : (operation.scrollX as number),
    scrollY: operation.scrollY === undefined ? 0 : (operation.scrollY as number)
  };
}

interface AudioSpec {
  name?: string;
  pan?: number;
  pitch?: number;
  volume?: number;
}

function createMapData(operation: PatchOperation, data: number[], events: unknown[]): Record<string, unknown> {
  return {
    autoplayBgm: Boolean(operation.autoplayBgm),
    autoplayBgs: Boolean(operation.autoplayBgs),
    battleback1Name: "",
    battleback2Name: "",
    bgm: normalizeAudio(operation.bgm),
    bgs: normalizeAudio(operation.bgs),
    disableDashing: Boolean(operation.disableDashing),
    displayName: (operation.displayName as string) || "",
    encounterList: [],
    encounterStep: operation.encounterStep === undefined ? 30 : (operation.encounterStep as number),
    height: operation.height,
    note: stripInternalAiNote(operation.note),
    parallaxLoopX: false,
    parallaxLoopY: false,
    parallaxName: "",
    parallaxShow: true,
    parallaxSx: 0,
    parallaxSy: 0,
    scrollType: (operation.scrollType as number) || 0,
    specifyBattleback: false,
    tilesetId: operation.tilesetId,
    width: operation.width,
    data,
    events
  };
}

function normalizeAudio(value: unknown): AudioSpec {
  const audio: AudioSpec = value && typeof value === "object" ? value as AudioSpec : {};
  return {
    name: audio.name || "",
    pan: audio.pan || 0,
    pitch: audio.pitch || 100,
    volume: audio.volume || 90
  };
}

function stripInternalAiNote(value: unknown): string {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("AIWF:"))
    .join("\n");
}

function compileNewMapEvent(eventSpec: PatchOperation, eventId: number, operation: PatchOperation, context: PatchContext, eventIndex: number): unknown {
  if (!eventSpec || typeof eventSpec !== "object") throw new Error(`add-map.events[${eventIndex}] must be an object`);
  assertInteger(eventId, `add-map.events[${eventIndex}].id`, 1);
  if (!eventSpec.name || typeof eventSpec.name !== "string") {
    throw new Error(`add-map.events[${eventIndex}] requires a non-empty string name`);
  }
  assertInteger(eventSpec.x as number, `add-map.events[${eventIndex}].x`, 0);
  assertInteger(eventSpec.y as number, `add-map.events[${eventIndex}].y`, 0);
  if ((eventSpec.x as number) >= (operation.width as number) || (eventSpec.y as number) >= (operation.height as number)) {
    throw new Error(`add-map event coordinate (${eventSpec.x},${eventSpec.y}) is outside new map bounds ${operation.width}x${operation.height}`);
  }
  if (!Array.isArray(eventSpec.pages) || eventSpec.pages.length === 0) {
    throw new Error(`add-map.events[${eventIndex}] requires at least one page`);
  }
  return {
    id: eventId,
    name: eventSpec.name,
    note: stripInternalAiNote(eventSpec.note),
    x: eventSpec.x,
    y: eventSpec.y,
    pages: (eventSpec.pages as never[]).map((page) => compilePage(page, context.system, context.dataDir, context as unknown as { plannedMaps?: Map<number, unknown> }))
  };
}

function prepareMapEvent(context: PatchContext, operation: PatchOperation): PreparedMapEvent {
  assertInteger(operation.mapId as number, "operation.mapId", 1);
  const mapInfo: RMMVMapInfo | undefined = (context.mapInfos || []).find((entry) => entry && (entry as RMMVMapInfo).id === operation.mapId) as RMMVMapInfo | undefined;
  if (!mapInfo) throw new Error(`Map ${operation.mapId} is not present in MapInfos.json`);

  const mapFile: string = path.join(context.dataDir, `Map${String(operation.mapId).padStart(3, "0")}.json`);
  const map = readJson(mapFile) as Record<string, unknown>;
  const hasX: boolean = operation.x !== undefined && operation.x !== null;
  const hasY: boolean = operation.y !== undefined && operation.y !== null;
  const unplaced: boolean = !hasX || !hasY;
  const x: number = unplaced ? 0 : (operation.x as number);
  const y: number = unplaced ? 0 : (operation.y as number);
  if (!unplaced) {
    assertInteger(x, "operation.x", 0);
    assertInteger(y, "operation.y", 0);
    if (x >= (map.width as number) || y >= (map.height as number)) {
      throw new Error(`Event coordinate (${x},${y}) is outside map ${operation.mapId} bounds ${map.width}x${map.height}`);
    }
  }
  if (!operation.name || typeof operation.name !== "string") {
    throw new Error("add-map-event requires a non-empty string name");
  }
  if (!Array.isArray(operation.pages) || (operation.pages as unknown[]).length === 0) {
    throw new Error("add-map-event requires at least one page");
  }

  const nextId: number = Number.isInteger(operation.eventId) ? (operation.eventId as number) : nextEventId((map.events || []) as unknown[]);
  const baseNote: string = stripInternalAiNote(operation.note);
  const note: string = baseNote;
  const event = {
    id: nextId,
    name: operation.name,
    note,
    x,
    y,
    pages: (operation.pages as never[]).map((page) => compilePage(page, context.system, context.dataDir, context as unknown as { plannedMaps?: Map<number, unknown> }))
  };

  return {
    mapFile,
    map,
    event,
    unplaced,
    report: {
      op: operation.op,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: nextId,
      eventName: operation.name,
      x,
      y,
      unplaced,
      pages: event.pages.length
    }
  };
}

function prepareEventPageImage(context: PatchContext, operation: PatchOperation): { mapFile: string; map: Record<string, unknown>; event: unknown; pageIndex: number; afterImage: unknown; report: Record<string, unknown> } {
  assertInteger(operation.mapId as number, "operation.mapId", 1);
  assertInteger(operation.eventId as number, "operation.eventId", 1);
  assertInteger(operation.pageIndex as number, "operation.pageIndex", 0);
  const mapInfo: RMMVMapInfo | undefined = (context.mapInfos || []).find((entry) => entry && (entry as RMMVMapInfo).id === operation.mapId) as RMMVMapInfo | undefined;
  if (!mapInfo) throw new Error(`Map ${operation.mapId} is not present in MapInfos.json`);
  const mapFile: string = path.join(context.dataDir, `Map${String(operation.mapId).padStart(3, "0")}.json`);
  const map = readJson(mapFile) as Record<string, unknown>;
  const events = map.events as Record<number, unknown>;
  const event = events[operation.eventId as number] as { id: number; name?: string; pages: { image?: unknown }[] } | undefined;
  if (!event) throw new Error(`Event ${operation.eventId} is not present on map ${operation.mapId}`);
  if (!Array.isArray(event.pages)) throw new Error(`Event ${operation.eventId} on map ${operation.mapId} has no pages array`);
  if ((operation.pageIndex as number) >= event.pages.length) {
    throw new Error(`Event ${operation.eventId} on map ${operation.mapId} has ${event.pages.length} page(s); pageIndex ${operation.pageIndex} is out of range`);
  }
  if (!operation.image || typeof operation.image !== "object" || Array.isArray(operation.image)) {
    throw new Error("set-event-page-image requires an image object");
  }

  const beforeImage = compileImage((event.pages[operation.pageIndex as number].image || {}) as never);
  const afterImage = compileImage(operation.image as never);
  validateImageName((afterImage as { characterName: string }).characterName, "set-event-page-image.image.characterName");
  return {
    mapFile,
    map,
    event,
    pageIndex: operation.pageIndex as number,
    afterImage,
    report: {
      op: operation.op,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: event.id,
      eventName: event.name || "",
      pageIndex: operation.pageIndex,
      pageNumber: (operation.pageIndex as number) + 1,
      beforeImage,
      afterImage,
      mapFile
    }
  };
}

function prepareMapTiles(context: PatchContext, operation: PatchOperation): { mapFile: string; map: Record<string, unknown>; edits: TileEdit[]; report: Record<string, unknown> } {
  assertInteger(operation.mapId as number, "operation.mapId", 1);
  const mapInfo: RMMVMapInfo | undefined = (context.mapInfos || []).find((entry) => entry && (entry as RMMVMapInfo).id === operation.mapId) as RMMVMapInfo | undefined;
  if (!mapInfo) throw new Error(`Map ${operation.mapId} is not present in MapInfos.json`);
  if (!Array.isArray(operation.edits) || (operation.edits as PatchOperation[]).length === 0) {
    throw new Error("set-map-tiles requires a non-empty edits array");
  }
  const mapFile: string = path.join(context.dataDir, `Map${String(operation.mapId).padStart(3, "0")}.json`);
  const map = readJson(mapFile) as Record<string, unknown>;
  if (!Array.isArray(map.data)) throw new Error(`Map ${operation.mapId} data must be an array`);
  const edits: TileEdit[] = (operation.edits as PatchOperation[]).map((edit, index) => prepareTileEdit(map as unknown as { width: number; height: number; data: number[] }, edit, index));
  return {
    mapFile,
    map,
    edits,
    report: {
      op: operation.op,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      edits: edits.length,
      changed: edits.filter((edit) => edit.beforeTileId !== edit.afterTileId).length,
      sample: edits.slice(0, 20).map((edit) => ({
        x: edit.x,
        y: edit.y,
        z: edit.z,
        beforeTileId: edit.beforeTileId,
        afterTileId: edit.afterTileId
      })),
      mapFile
    }
  };
}

interface TileEdit {
  x: number;
  y: number;
  z: number;
  index: number;
  beforeTileId: number;
  afterTileId: number;
}

function prepareTileEdit(map: { width: number; height: number; data: number[] }, edit: PatchOperation, editIndex: number, labelPrefix?: string): TileEdit {
  const label: string = labelPrefix || "set-map-tiles.edits";
  if (!edit || typeof edit !== "object") throw new Error(`${label}[${editIndex}] must be an object`);
  assertInteger(edit.x as number, `${label}[${editIndex}].x`, 0);
  assertInteger(edit.y as number, `${label}[${editIndex}].y`, 0);
  assertInteger(edit.z as number, `${label}[${editIndex}].z`, 0);
  assertInteger(edit.tileId as number, `${label}[${editIndex}].tileId`, 0);
  if ((edit.z as number) > 5) throw new Error(`${label}[${editIndex}].z must be between 0 and 5`);
  if ((edit.x as number) >= map.width || (edit.y as number) >= map.height) {
    throw new Error(`Tile coordinate (${edit.x},${edit.y}) is outside map bounds ${map.width}x${map.height}`);
  }
  const index: number = ((edit.z as number) * map.height + (edit.y as number)) * map.width + (edit.x as number);
  if (index >= map.data.length) throw new Error(`Tile edit index ${index} is outside map data length ${map.data.length}`);
  return {
    x: edit.x as number,
    y: edit.y as number,
    z: edit.z as number,
    index,
    beforeTileId: map.data[index] || 0,
    afterTileId: edit.tileId as number
  };
}

function prepareEventPage(context: PatchContext, operation: PatchOperation): PreparedEventPage {
  assertInteger(operation.mapId as number, "operation.mapId", 1);
  assertInteger(operation.eventId as number, "operation.eventId", 1);
  const mapInfo: RMMVMapInfo | undefined = (context.mapInfos || []).find((entry) => entry && (entry as RMMVMapInfo).id === operation.mapId) as RMMVMapInfo | undefined;
  if (!mapInfo) throw new Error(`Map ${operation.mapId} is not present in MapInfos.json`);
  const mapFile: string = path.join(context.dataDir, `Map${String(operation.mapId).padStart(3, "0")}.json`);
  const map = readJson(mapFile) as Record<string, unknown>;
  const events = map.events as Record<number, unknown>;
  const event = events[operation.eventId as number] as { id: number; name?: string; x: number; y: number; pages: unknown[] } | undefined;
  if (!event) throw new Error(`Event ${operation.eventId} is not present on map ${operation.mapId}`);
  if (!Array.isArray(event.pages)) throw new Error(`Event ${operation.eventId} on map ${operation.mapId} has no pages array`);
  if (!operation.page || typeof operation.page !== "object") throw new Error("add-event-page requires a page object");

  const page = compilePage(operation.page as never, context.system, context.dataDir, context as unknown as { plannedMaps?: Map<number, unknown> });
  const pageNumber: number = event.pages.length + 1;
  return {
    mapFile,
    map,
    event,
    page,
    report: {
      op: operation.op,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: event.id,
      eventName: event.name || "",
      x: event.x,
      y: event.y,
      pageNumber
    }
  };
}

const BLOCK_HEAD_CODES: ReadonlySet<number> = EVENT_COMMAND_BLOCK_HEAD_CODES;
const CONTINUATION_CODES: ReadonlySet<number> = EVENT_COMMAND_CONTINUATION_CODES;
const BLOCK_PAIRINGS: Readonly<Record<number, { continuations?: readonly number[]; terminator?: number }>> = EVENT_COMMAND_BLOCK_PAIRINGS;

interface RawCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

function assertRawCommandShape(command: unknown, label: string): asserts command is RawCommand {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error(`${label} must be an object with code/indent/parameters`);
  }
  const cmd = command as RawCommand;
  if (!Number.isInteger(cmd.code) || cmd.code < 0) {
    throw new Error(`${label}.code must be a non-negative integer`);
  }
  if (!Number.isInteger(cmd.indent) || cmd.indent < 0) {
    throw new Error(`${label}.indent must be a non-negative integer`);
  }
  if (!Array.isArray(cmd.parameters)) {
    throw new Error(`${label}.parameters must be an array`);
  }
  validateEventCommandBasic(cmd, label);
}

function findBlockRange(list: RawCommand[], headIndex: number): { start: number; end: number } {
  const head: RawCommand = list[headIndex];
  const pairing = BLOCK_PAIRINGS[head.code];
  if (!pairing) return { start: headIndex, end: headIndex };
  const headIndent: number = head.indent;
  let end: number = headIndex;
  for (let i = headIndex + 1; i < list.length; i += 1) {
    const cmd: RawCommand = list[i];
    if (pairing.continuations && pairing.continuations.includes(cmd.code) && cmd.indent === headIndent) {
      end = i;
      continue;
    }
    if (pairing.terminator && cmd.code === pairing.terminator && cmd.indent === headIndent) {
      end = i;
      return { start: headIndex, end };
    }
    if (cmd.indent > headIndent) {
      end = i;
      continue;
    }
    break;
  }
  return { start: headIndex, end };
}

function validateCommandStream(list: unknown[], label: string): void {
  if (!Array.isArray(list)) throw new Error(`${label} must be an array of commands`);
  if (list.length === 0) throw new Error(`${label} must have at least one command (a code:0 terminator)`);
  let prevIndent: number = 0;
  const openHeads: { code: number; indent: number; atIndex: number }[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const cmd = list[i];
    assertRawCommandShape(cmd, `${label}[${i}]`);
    if ((cmd as RawCommand).indent > prevIndent + 1) {
      throw new Error(`${label}[${i}] indent ${(cmd as RawCommand).indent} jumps more than one level from previous indent ${prevIndent}`);
    }
    if (CONTINUATION_CODES.has((cmd as RawCommand).code)) {
      const matchedHead: boolean = openHeads.some((h) => h.indent === (cmd as RawCommand).indent);
      if (!matchedHead && (cmd as RawCommand).indent !== 0 && openHeads.length === 0) {
        throw new Error(`${label}[${i}] continuation/terminator code ${(cmd as RawCommand).code} has no open block head`);
      }
    }
    if (BLOCK_HEAD_CODES.has((cmd as RawCommand).code)) {
      openHeads.push({ code: (cmd as RawCommand).code, indent: (cmd as RawCommand).indent, atIndex: i });
    }
    while (openHeads.length && openHeads[openHeads.length - 1].indent >= (cmd as RawCommand).indent && i > openHeads[openHeads.length - 1].atIndex) {
      if (openHeads[openHeads.length - 1].indent > (cmd as RawCommand).indent) {
        openHeads.pop();
      } else {
        break;
      }
    }
    prevIndent = (cmd as RawCommand).indent;
  }
  const last: RawCommand = list[list.length - 1] as RawCommand;
  if (last.code !== 0) {
    throw new Error(`${label} must end with a code:0 terminator; got code ${last.code}`);
  }
  if (last.indent !== 0) {
    throw new Error(`${label} terminator code:0 must be at indent 0; got indent ${last.indent}`);
  }
}

function resolveEventPage(context: PatchContext, operation: PatchOperation, opLabel: string): { mapFile: string; map: Record<string, unknown>; mapInfo: RMMVMapInfo; event: { id: number; name?: string; pages: { list: RawCommand[] }[] }; page: { list: RawCommand[] } } {
  assertInteger(operation.mapId as number, `${opLabel}.mapId`, 1);
  assertInteger(operation.eventId as number, `${opLabel}.eventId`, 1);
  assertInteger(operation.pageIndex as number, `${opLabel}.pageIndex`, 0);
  const mapInfo: RMMVMapInfo | undefined = (context.mapInfos || []).find((entry) => entry && (entry as RMMVMapInfo).id === operation.mapId) as RMMVMapInfo | undefined;
  if (!mapInfo) throw new Error(`Map ${operation.mapId} is not present in MapInfos.json`);
  const mapFile: string = path.join(context.dataDir, `Map${String(operation.mapId).padStart(3, "0")}.json`);
  const map = readJson(mapFile) as Record<string, unknown>;
  const events = map.events as Record<number, unknown>;
  const event = events[operation.eventId as number] as { id: number; name?: string; pages: { list: RawCommand[] }[] } | undefined;
  if (!event) throw new Error(`Event ${operation.eventId} is not present on map ${operation.mapId}`);
  if (!Array.isArray(event.pages)) throw new Error(`Event ${operation.eventId} on map ${operation.mapId} has no pages array`);
  if ((operation.pageIndex as number) >= event.pages.length) {
    throw new Error(`Event ${operation.eventId} on map ${operation.mapId} has ${event.pages.length} page(s); pageIndex ${operation.pageIndex} is out of range`);
  }
  const page: { list: RawCommand[] } = event.pages[operation.pageIndex as number];
  if (!Array.isArray(page.list)) throw new Error(`Event ${operation.eventId} page ${operation.pageIndex} has no command list`);
  return { mapFile, map, mapInfo, event, page };
}

function previewSummary(before: RawCommand | null, after: RawCommand | null, opLabel: string): Record<string, unknown> {
  return {
    beforeCommand: before ? { code: before.code, indent: before.indent, parameters: before.parameters } : null,
    afterCommand: after ? { code: after.code, indent: after.indent, parameters: after.parameters } : null,
    beforeListLength: undefined,
    afterListLength: undefined,
    opLabel
  };
}

function prepareReplaceEventCommand(context: PatchContext, operation: PatchOperation): { mapFile: string; map: Record<string, unknown>; event: unknown; pageIndex: number; newList: RawCommand[]; report: Record<string, unknown> } {
  const opLabel: string = "replace-event-command";
  const { mapFile, map, mapInfo, event, page } = resolveEventPage(context, operation, opLabel);
  assertInteger(operation.commandIndex as number, `${opLabel}.commandIndex`, 0);
  if ((operation.commandIndex as number) >= page.list.length) {
    throw new Error(`${opLabel}.commandIndex ${operation.commandIndex} is out of range (page has ${page.list.length} commands)`);
  }
  assertRawCommandShape(operation.command, `${opLabel}.command`);
  const before: RawCommand = page.list[operation.commandIndex as number];
  if (before.code !== (operation.command as RawCommand).code) {
    throw new Error(`${opLabel} requires the new command.code (${(operation.command as RawCommand).code}) to equal the existing command.code (${before.code}); to change command type use patch-event-page`);
  }
  if (before.indent !== (operation.command as RawCommand).indent) {
    throw new Error(`${opLabel} requires command.indent (${(operation.command as RawCommand).indent}) to equal the existing indent (${before.indent})`);
  }
  if (BLOCK_HEAD_CODES.has(before.code)) {
    throw new Error(`${opLabel} refuses to replace block-head code ${before.code} (use patch-event-page to restructure the block)`);
  }
  if (before.code === 0) {
    throw new Error(`${opLabel} refuses to replace the page terminator (code:0)`);
  }
  const after: RawCommand = { code: (operation.command as RawCommand).code, indent: (operation.command as RawCommand).indent, parameters: (operation.command as RawCommand).parameters };
  const newList: RawCommand[] = page.list.slice();
  newList[operation.commandIndex as number] = after;
  validateCommandStream(newList, `${opLabel} resulting page.list`);
  return {
    mapFile,
    map,
    event,
    pageIndex: operation.pageIndex as number,
    newList,
    report: {
      op: opLabel,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: event.id,
      eventName: event.name || "",
      pageIndex: operation.pageIndex,
      commandIndex: operation.commandIndex,
      ...previewSummary(before, after, opLabel),
      beforeListLength: page.list.length,
      afterListLength: newList.length,
      mapFile
    }
  };
}

function replaceEventCommand(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = prepareReplaceEventCommand(context, operation);
  (prepared.event as { pages: { list: RawCommand[] }[] }).pages[prepared.pageIndex].list = prepared.newList;
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

function prepareInsertEventCommand(context: PatchContext, operation: PatchOperation): { mapFile: string; map: Record<string, unknown>; event: unknown; pageIndex: number; newList: RawCommand[]; report: Record<string, unknown> } {
  const opLabel: string = "insert-event-command";
  const { mapFile, map, mapInfo, event, page } = resolveEventPage(context, operation, opLabel);
  assertInteger(operation.commandIndex as number, `${opLabel}.commandIndex`, 0);
  if ((operation.commandIndex as number) >= page.list.length) {
    throw new Error(`${opLabel}.commandIndex ${operation.commandIndex} is out of range (page has ${page.list.length} commands)`);
  }
  const where: string = (operation.where as string) || "after";
  if (where !== "before" && where !== "after") {
    throw new Error(`${opLabel}.where must be 'before' or 'after'`);
  }
  assertRawCommandShape(operation.command, `${opLabel}.command`);
  if (BLOCK_HEAD_CODES.has((operation.command as RawCommand).code)) {
    throw new Error(`${opLabel} refuses to insert a block-head code ${(operation.command as RawCommand).code} (use patch-event-page to add nested structures)`);
  }
  if (CONTINUATION_CODES.has((operation.command as RawCommand).code)) {
    throw new Error(`${opLabel} refuses to insert continuation/terminator code ${(operation.command as RawCommand).code} (these only belong inside an existing block; use patch-event-page)`);
  }
  if ((operation.command as RawCommand).code === 0) {
    throw new Error(`${opLabel} refuses to insert a page terminator (code:0)`);
  }
  const anchor: RawCommand = page.list[operation.commandIndex as number];
  if ((operation.command as RawCommand).indent !== anchor.indent) {
    throw new Error(`${opLabel} requires command.indent (${(operation.command as RawCommand).indent}) to equal the anchor command's indent (${anchor.indent}); cross-block insertion requires patch-event-page`);
  }
  const newList: RawCommand[] = page.list.slice();
  const insertAt: number = where === "before" ? (operation.commandIndex as number) : (operation.commandIndex as number) + 1;
  const newCmd: RawCommand = { code: (operation.command as RawCommand).code, indent: (operation.command as RawCommand).indent, parameters: (operation.command as RawCommand).parameters };
  newList.splice(insertAt, 0, newCmd);
  validateCommandStream(newList, `${opLabel} resulting page.list`);
  return {
    mapFile,
    map,
    event,
    pageIndex: operation.pageIndex as number,
    newList,
    report: {
      op: opLabel,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: event.id,
      eventName: event.name || "",
      pageIndex: operation.pageIndex,
      anchorCommandIndex: operation.commandIndex,
      where,
      insertedAt: insertAt,
      ...previewSummary(null, newCmd, opLabel),
      beforeListLength: page.list.length,
      afterListLength: newList.length,
      mapFile
    }
  };
}

function insertEventCommand(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = prepareInsertEventCommand(context, operation);
  (prepared.event as { pages: { list: RawCommand[] }[] }).pages[prepared.pageIndex].list = prepared.newList;
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

function prepareDeleteEventCommand(context: PatchContext, operation: PatchOperation): { mapFile: string; map: Record<string, unknown>; event: unknown; pageIndex: number; newList: RawCommand[]; report: Record<string, unknown> } {
  const opLabel: string = "delete-event-command";
  const { mapFile, map, mapInfo, event, page } = resolveEventPage(context, operation, opLabel);
  assertInteger(operation.commandIndex as number, `${opLabel}.commandIndex`, 0);
  if ((operation.commandIndex as number) >= page.list.length) {
    throw new Error(`${opLabel}.commandIndex ${operation.commandIndex} is out of range (page has ${page.list.length} commands)`);
  }
  const target: RawCommand = page.list[operation.commandIndex as number];
  if (target.code === 0) {
    throw new Error(`${opLabel} refuses to delete the page terminator (code:0)`);
  }
  const includeChildren: boolean = operation.includeChildren === true;
  let deleteStart: number = operation.commandIndex as number;
  let deleteEnd: number = operation.commandIndex as number;
  if (BLOCK_HEAD_CODES.has(target.code)) {
    if (!includeChildren) {
      throw new Error(`${opLabel} refuses to delete block-head code ${target.code} without includeChildren:true (otherwise its continuations/terminator would dangle)`);
    }
    const range = findBlockRange(page.list, operation.commandIndex as number);
    deleteStart = range.start;
    deleteEnd = range.end;
  } else if (CONTINUATION_CODES.has(target.code)) {
    throw new Error(`${opLabel} refuses to delete continuation/terminator code ${target.code} directly; delete the block head with includeChildren:true instead`);
  }
  const newList: RawCommand[] = page.list.slice();
  const removed: RawCommand[] = newList.splice(deleteStart, deleteEnd - deleteStart + 1);
  validateCommandStream(newList, `${opLabel} resulting page.list`);
  return {
    mapFile,
    map,
    event,
    pageIndex: operation.pageIndex as number,
    newList,
    report: {
      op: opLabel,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: event.id,
      eventName: event.name || "",
      pageIndex: operation.pageIndex,
      commandIndex: operation.commandIndex,
      deletedRange: { start: deleteStart, end: deleteEnd },
      deletedCount: removed.length,
      deletedSample: removed.slice(0, 8).map((c) => ({ code: c.code, indent: c.indent })),
      includeChildren,
      beforeListLength: page.list.length,
      afterListLength: newList.length,
      mapFile
    }
  };
}

function deleteEventCommand(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = prepareDeleteEventCommand(context, operation);
  (prepared.event as { pages: { list: RawCommand[] }[] }).pages[prepared.pageIndex].list = prepared.newList;
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

function preparePatchEventPage(context: PatchContext, operation: PatchOperation): { mapFile: string; map: Record<string, unknown>; event: unknown; pageIndex: number; newList: RawCommand[]; report: Record<string, unknown> } {
  const opLabel: string = "patch-event-page";
  const { mapFile, map, mapInfo, event, page } = resolveEventPage(context, operation, opLabel);
  if (!Array.isArray(operation.commands)) {
    throw new Error(`${opLabel}.commands must be an array of high-level command descriptors (kind/...)`);
  }
  const compiled: RawCommand[] = compileCommands(operation.commands as never[], context.system, context.dataDir, context as unknown as { plannedMaps?: Map<number, unknown> });
  validateCommandStream(compiled, `${opLabel} compiled commands`);
  return {
    mapFile,
    map,
    event,
    pageIndex: operation.pageIndex as number,
    newList: compiled,
    report: {
      op: opLabel,
      mapId: operation.mapId,
      mapName: mapInfo.name || "",
      eventId: event.id,
      eventName: event.name || "",
      pageIndex: operation.pageIndex,
      beforeListLength: page.list.length,
      afterListLength: compiled.length,
      mapFile
    }
  };
}

function patchEventPage(context: PatchContext, operation: PatchOperation): unknown {
  const prepared = preparePatchEventPage(context, operation);
  (prepared.event as { pages: { list: RawCommand[] }[] }).pages[prepared.pageIndex].list = prepared.newList;
  writeMapJson(prepared.mapFile, prepared.map);
  return prepared.report;
}

export const COMMAND_LEVEL_OPS: Set<string> = new Set([
  "replace-event-command",
  "insert-event-command",
  "delete-event-command",
  "patch-event-page"
]);

/** Ops that create or structurally alter maps/events; agents must not apply these via CLI. */
export function isStructuralPatchOp(op: string | undefined): boolean {
  return !COMMAND_LEVEL_OPS.has(String(op || ""));
}

export function validateAgentPatchSpec(spec: PatchSpec): void {
  validateSpecShape(spec);
  const offenders = spec.operations
    .map((operation, index) => ({ index, op: operation && operation.op }))
    .filter((entry) => isStructuralPatchOp(entry.op));
  if (!offenders.length) return;
  const detail = offenders
    .map((entry) => `operations[${entry.index}].op=${entry.op || "<missing>"}`)
    .join(", ");
  throw new Error(
    `Agent-safe patch mode refused structural operations (${detail}). `
    + "Register EventContract with full implementation.commands[] or pages[] via mcp__rmmv__RmmvEvent action=registry.register, "
    + "then place it through the current map editor flow. "
    + "Agents must not use add-map-event in patch mode. "
    + "Human/placement tooling may use the explicit structural placement path."
  );
}

function nextEventId(events: unknown[]): number {
  let max: number = 0;
  for (const event of events || []) {
    if (event && Number.isInteger((event as { id?: number }).id) && (event as { id: number }).id > max) max = (event as { id: number }).id;
  }
  return max + 1;
}

function validateSpecShape(spec: PatchSpec): void {
  if (!spec || typeof spec !== "object") throw new Error("Patch spec must be an object");
  if (spec.engine !== "rpg-maker-mv") throw new Error("Patch spec engine must be rpg-maker-mv");
  if (!Array.isArray(spec.operations) || spec.operations.length === 0) {
    throw new Error("Patch spec requires at least one operation");
  }
}

function assertInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
}
