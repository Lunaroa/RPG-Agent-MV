import path from "path";

import { validateEventCommandBasic } from "../../rmmv/event-command-registry.ts";
import { readJson, writeJson } from "../../rmmv/json.ts";
import { validateMoveRouteCommandBasic } from "../../rmmv/move-route-registry.ts";

interface MapEventOptions {
  project?: string;
  mapId?: number | string;
  eventId?: number | string;
  event?: Partial<MVEvent>;
}

interface MVEvent {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
  pages: MVPage[];
}

interface MVPage {
  conditions: MVConditions;
  directionFix: boolean;
  image: MVImage;
  list: MVCommand[];
  moveFrequency: number;
  moveRoute: MVMoveRoute;
  moveSpeed: number;
  moveType: number;
  priorityType: number;
  stepAnime: boolean;
  through: boolean;
  trigger: number;
  walkAnime: boolean;
}

interface MVConditions {
  actorId: number;
  actorValid: boolean;
  itemId: number;
  itemValid: boolean;
  selfSwitchCh: string;
  selfSwitchValid: boolean;
  switch1Id: number;
  switch1Valid: boolean;
  switch2Id: number;
  switch2Valid: boolean;
  variableId: number;
  variableValid: boolean;
  variableValue: number;
}

interface MVImage {
  tileId: number;
  characterName: string;
  direction: number;
  pattern: number;
  characterIndex: number;
}

interface MVCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

interface MVMoveRoute {
  list: { code: number; parameters: unknown[] }[];
  repeat: boolean;
  skippable: boolean;
  wait: boolean;
}

interface MapContext {
  project: string;
  mapId: number;
  mapFile: string;
  map: { events: (MVEvent | null)[]; width: number; height: number; [key: string]: unknown };
}

interface EventReport {
  op: string;
  mapId: number;
  eventId: number;
  mapFile: string;
  before: { id: number; name: string; x: number; y: number; pages: number } | null;
  after: { id: number; name: string; x: number; y: number; pages: number } | null;
  event: MVEvent | null;
}

function createMapEvent(options: MapEventOptions): EventReport {
  const context = loadMapContext(options);
  const source = options.event || {};
  const eventId = nextEventId(context.map.events || []);
  const event = normalizeEvent({
    id: eventId,
    name: source.name || `EV${String(eventId).padStart(3, "0")}`,
    note: source.note || "",
    x: source.x,
    y: source.y,
    pages: source.pages
  }, context.map, "event");
  context.map.events[eventId] = event;
  writeJson(context.mapFile, context.map);
  return report("create", context, eventId, null, event);
}

function updateMapEvent(options: MapEventOptions): EventReport {
  const context = loadMapContext(options);
  const eventId = assertEventId(options.eventId);
  const before = context.map.events && context.map.events[eventId];
  if (!before) throw new Error(`Event ${eventId} is not present on map ${context.mapId}.`);

  const source = options.event || {};
  const event = normalizeEvent({
    ...before,
    ...source,
    id: eventId,
    pages: source.pages !== undefined ? source.pages : before.pages
  }, context.map, "event");
  context.map.events[eventId] = event;
  writeJson(context.mapFile, context.map);
  return report("update", context, eventId, before, event);
}

function deleteMapEvent(options: MapEventOptions): EventReport {
  const context = loadMapContext(options);
  const eventId = assertEventId(options.eventId);
  const before = context.map.events && context.map.events[eventId];
  if (!before) throw new Error(`Event ${eventId} is not present on map ${context.mapId}.`);
  context.map.events[eventId] = null;
  writeJson(context.mapFile, context.map);
  return report("delete", context, eventId, before, null);
}

function duplicateMapEvent(options: MapEventOptions): EventReport {
  const context = loadMapContext(options);
  const sourceId = assertEventId(options.eventId);
  const before = context.map.events && context.map.events[sourceId];
  if (!before) throw new Error(`Event ${sourceId} is not present on map ${context.mapId}.`);
  const eventId = nextEventId(context.map.events || []);
  const event = normalizeEvent({
    ...clone(before),
    id: eventId,
    name: `${before.name || `EV${sourceId}`} Copy`,
    x: clamp(Number(before.x || 0) + 1, 0, context.map.width - 1),
    y: clamp(Number(before.y || 0) + 1, 0, context.map.height - 1)
  }, context.map, "event");
  context.map.events[eventId] = event;
  writeJson(context.mapFile, context.map);
  return report("duplicate", context, eventId, before, event);
}

function loadMapContext(options: MapEventOptions): MapContext {
  if (!options || !options.project) throw new Error("project is required.");
  const mapId = assertMapId(options.mapId);
  const project = path.resolve(options.project);
  const mapFile = path.join(project, "www", "data", `Map${String(mapId).padStart(3, "0")}.json`);
  const map = readJson(mapFile) as MapContext["map"];
  if (!Array.isArray(map.events)) map.events = [null];
  return { project, mapId, mapFile, map };
}

function normalizeEvent(event: Partial<MVEvent>, map: { width: number; height: number }, label: string): MVEvent {
  const result = clone(event || {}) as MVEvent;
  result.id = assertInt(result.id, `${label}.id`, 1);
  if (typeof result.name !== "string" || !result.name.trim()) throw new Error(`${label}.name must be a non-empty string.`);
  result.name = result.name.trim();
  result.note = stripInternalAiNote(result.note);
  result.x = assertInt(result.x, `${label}.x`, 0);
  result.y = assertInt(result.y, `${label}.y`, 0);
  if (result.x >= map.width || result.y >= map.height) {
    throw new Error(`${label} coordinate (${result.x},${result.y}) is outside map ${map.width}x${map.height}.`);
  }
  result.pages = Array.isArray(result.pages) && result.pages.length
    ? result.pages.map((page, index) => normalizePage(page, `${label}.pages[${index}]`))
    : [defaultPage()];
  return result;
}

function normalizePage(page: Partial<MVPage>, label: string): MVPage {
  const result = { ...defaultPage(), ...clone(page || {}) } as MVPage;
  result.conditions = normalizeConditions(result.conditions || {});
  result.image = normalizeImage(result.image || {});
  result.list = Array.isArray(result.list)
    ? result.list
      .map((command, index) => normalizeCommand(command, `${label}.list[${index}]`))
      .filter((command) => !isInternalAiComment(command))
    : [{ code: 0, indent: 0, parameters: [] }];
  if (!result.list.length || result.list[result.list.length - 1].code !== 0) {
    result.list.push({ code: 0, indent: 0, parameters: [] });
  }
  result.moveFrequency = assertInt(result.moveFrequency, `${label}.moveFrequency`, 1);
  result.moveSpeed = assertInt(result.moveSpeed, `${label}.moveSpeed`, 1);
  result.moveType = assertInt(result.moveType, `${label}.moveType`, 0);
  result.priorityType = assertInt(result.priorityType, `${label}.priorityType`, 0);
  result.trigger = assertInt(result.trigger, `${label}.trigger`, 0);
  result.directionFix = Boolean(result.directionFix);
  result.stepAnime = Boolean(result.stepAnime);
  result.through = Boolean(result.through);
  result.walkAnime = result.walkAnime === undefined ? true : Boolean(result.walkAnime);
  result.moveRoute = normalizeMoveRoute(result.moveRoute);
  return result;
}

function normalizeConditions(conditions: Partial<MVConditions>): MVConditions {
  return {
    actorId: assertInt(defaultValue(conditions.actorId, 1), "conditions.actorId", 1),
    actorValid: Boolean(conditions.actorValid),
    itemId: assertInt(defaultValue(conditions.itemId, 1), "conditions.itemId", 1),
    itemValid: Boolean(conditions.itemValid),
    selfSwitchCh: ["A", "B", "C", "D"].includes(conditions.selfSwitchCh as string) ? conditions.selfSwitchCh as string : "A",
    selfSwitchValid: Boolean(conditions.selfSwitchValid),
    switch1Id: assertInt(defaultValue(conditions.switch1Id, 1), "conditions.switch1Id", 1),
    switch1Valid: Boolean(conditions.switch1Valid),
    switch2Id: assertInt(defaultValue(conditions.switch2Id, 1), "conditions.switch2Id", 1),
    switch2Valid: Boolean(conditions.switch2Valid),
    variableId: assertInt(defaultValue(conditions.variableId, 1), "conditions.variableId", 1),
    variableValid: Boolean(conditions.variableValid),
    variableValue: assertInt(defaultValue(conditions.variableValue, 0), "conditions.variableValue", 0)
  };
}

function normalizeImage(image: Partial<MVImage>): MVImage {
  const characterName = image.characterName === undefined ? "" : String(image.characterName);
  if (/[\\/:]/.test(characterName) || characterName.includes("..")) {
    throw new Error("image.characterName must be an asset basename under img/characters.");
  }
  return {
    tileId: assertInt(defaultValue(image.tileId, 0), "image.tileId", 0),
    characterName,
    direction: assertInt(defaultValue(image.direction, 2), "image.direction", 0),
    pattern: assertInt(defaultValue(image.pattern, 1), "image.pattern", 0),
    characterIndex: assertInt(defaultValue(image.characterIndex, 0), "image.characterIndex", 0)
  };
}

function normalizeMoveRoute(route: Partial<MVMoveRoute> | undefined): MVMoveRoute {
  const value = route && typeof route === "object" ? route : {};
  const list = Array.isArray(value.list)
    ? value.list.map((command, index) => normalizeMoveCommand(command, `moveRoute.list[${index}]`))
    : [{ code: 0, parameters: [] }];
  if (!list.length || list[list.length - 1].code !== 0) list.push({ code: 0, parameters: [] });
  return {
    list,
    repeat: value.repeat === undefined ? true : Boolean(value.repeat),
    skippable: Boolean(value.skippable),
    wait: Boolean(value.wait)
  };
}

function normalizeCommand(command: Partial<MVCommand>, label: string): MVCommand {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error(`${label} must be an object.`);
  const normalized = {
    code: assertInt(command.code, `${label}.code`, 0),
    indent: assertInt(defaultValue(command.indent, 0), `${label}.indent`, 0),
    parameters: Array.isArray(command.parameters) ? clone(command.parameters) : []
  };
  validateEventCommandBasic(normalized, label);
  return normalized;
}

function isInternalAiComment(command: MVCommand): boolean {
  if (command.code !== 108 && command.code !== 408) return false;
  const text = String(command.parameters?.[0] || '');
  return text.trim().startsWith('AIWF:');
}

function stripInternalAiNote(value: unknown): string {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('AIWF:'))
    .join('\n');
}

function normalizeMoveCommand(command: { code?: number; parameters?: unknown[] }, label: string): { code: number; parameters: unknown[] } {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error(`${label} must be an object.`);
  const normalized = {
    code: assertInt(command.code, `${label}.code`, 0),
    parameters: Array.isArray(command.parameters) ? clone(command.parameters) : []
  };
  validateMoveRouteCommandBasic(normalized, label);
  return normalized;
}

function defaultPage(): MVPage {
  return {
    conditions: normalizeConditions({}),
    directionFix: false,
    image: normalizeImage({}),
    list: [{ code: 0, indent: 0, parameters: [] }],
    moveFrequency: 3,
    moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
    moveSpeed: 3,
    moveType: 0,
    priorityType: 1,
    stepAnime: false,
    through: false,
    trigger: 0,
    walkAnime: true
  };
}

function nextEventId(events: (MVEvent | null)[]): number {
  let max = 0;
  for (const event of events || []) {
    if (event && Number.isInteger(event.id) && event.id > max) max = event.id;
  }
  return max + 1;
}

function report(op: string, context: MapContext, eventId: number, before: MVEvent | null, after: MVEvent | null): EventReport {
  return {
    op,
    mapId: context.mapId,
    eventId,
    mapFile: context.mapFile,
    before: summarizeEvent(before),
    after: summarizeEvent(after),
    event: after ? clone(after) : null
  };
}

function summarizeEvent(event: MVEvent | null): { id: number; name: string; x: number; y: number; pages: number } | null {
  if (!event) return null;
  return {
    id: event.id,
    name: event.name || "",
    x: event.x,
    y: event.y,
    pages: Array.isArray(event.pages) ? event.pages.length : 0
  };
}

function assertMapId(value: unknown): number {
  return assertInt(value, "mapId", 1);
}

function assertEventId(value: unknown): number {
  return assertInt(value, "eventId", 1);
}

function assertInt(value: unknown, label: string, min: number): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer.`);
  if ((value as number) < min) throw new Error(`${label} must be >= ${min}.`);
  return value as number;
}

function defaultValue<T>(value: T | undefined | null, fallback: T): T {
  return value === undefined || value === null ? fallback : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export {
  createMapEvent,
  updateMapEvent,
  deleteMapEvent,
  duplicateMapEvent
};
