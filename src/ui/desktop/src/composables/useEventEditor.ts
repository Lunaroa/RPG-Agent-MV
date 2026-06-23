// Pure event editor functions, types, and constants.
// Ported from legacy frontend/src/app/event-editor event-formatters.js,
// command-templates.js, and event-state.js. Keep this module non-reactive.
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage, pickByLocale } from '../i18n/messages.ts'
import { commandLabel as catalogCommandLabel } from './eventCommandCatalog.ts';
import { translate } from '../i18n/messages.ts'
import { localizeCommandCodeLabel } from '../utils/eventCommandLocalization.ts';
import {
  QUICK_EVENT_NAMES,
  QUICK_EVENT_TEXT,
  eventEditorText,
} from '../utils/eventEditorLocalization.ts';
export { COMMAND_DEFINITIONS, COMMAND_PAGES, STANDARD_COMMAND_CODES, applyCommandIndent, commandDefinition, commandLabel, commandTemplate, defaultCommandParams } from './eventCommandCatalog.ts';

// ---- Types ----

export interface MvCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

export interface MvMoveRoute {
  list: { code: number; parameters: unknown[] }[];
  repeat: boolean;
  skippable: boolean;
  wait: boolean;
}

export interface MvEventConditions {
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

export interface MvEventImage {
  tileId: number;
  characterName: string;
  direction: number;
  pattern: number;
  characterIndex: number;
}

export interface MvEventPage {
  conditions: MvEventConditions;
  directionFix: boolean;
  image: MvEventImage;
  list: MvCommand[];
  moveFrequency: number;
  moveRoute: MvMoveRoute;
  moveSpeed: number;
  moveType: number;
  priorityType: number;
  stepAnime: boolean;
  through: boolean;
  trigger: number;
  walkAnime: boolean;
}

export interface MvEditorEvent {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
  pages: MvEventPage[];
}

export function findEditorMapEvent(events: unknown[] | undefined, eventId: number): MvEditorEvent | null {
  if (!Array.isArray(events) || !Number.isInteger(eventId) || eventId <= 0) return null;
  const atIndex = events[eventId];
  if (atIndex && typeof atIndex === 'object' && !Array.isArray(atIndex)) {
    const event = atIndex as MvEditorEvent;
    return { ...event, id: Number(event.id) > 0 ? Number(event.id) : eventId };
  }
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const event = item as MvEditorEvent;
    if (Number(event.id) === eventId) return { ...event, id: eventId };
  }
  return null;
}

// ---- Constants ----

const DEFAULT_EVENT_EDITOR_TEXT = eventEditorText(DEFAULT_PRODUCT_LANGUAGE);

export const TRIGGERS = DEFAULT_EVENT_EDITOR_TEXT.triggers;

export const TRIGGER_LABELS = DEFAULT_EVENT_EDITOR_TEXT.triggerLabels;

export const PRIORITIES = DEFAULT_EVENT_EDITOR_TEXT.priorities;

export const PRIORITY_LABELS = DEFAULT_EVENT_EDITOR_TEXT.priorityLabels;

export const MOVE_TYPES = DEFAULT_EVENT_EDITOR_TEXT.moveTypes;

export const MOVE_SPEEDS = DEFAULT_EVENT_EDITOR_TEXT.moveSpeeds;

export const MOVE_FREQS = DEFAULT_EVENT_EDITOR_TEXT.moveFrequencies;

export const SELF_SWITCH_CHANNELS = ['A', 'B', 'C', 'D'] as const;

export const MOVE_ROUTE_OPERATIONS = DEFAULT_EVENT_EDITOR_TEXT.moveRouteOperations;

// ---- Clone ----

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// ---- Default factories ----

export function defaultConditions(): MvEventConditions {
  return {
    actorId: 1, actorValid: false, itemId: 1, itemValid: false,
    selfSwitchCh: 'A', selfSwitchValid: false,
    switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
    variableId: 1, variableValid: false, variableValue: 0,
  };
}

export function defaultImage(): MvEventImage {
  return { tileId: 0, characterName: '', direction: 2, pattern: 1, characterIndex: 0 };
}

export function defaultMoveRoute(): MvMoveRoute {
  return { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false };
}

export function defaultPage(): MvEventPage {
  return {
    conditions: defaultConditions(),
    directionFix: false,
    image: defaultImage(),
    list: [{ code: 0, indent: 0, parameters: [] }],
    moveFrequency: 3,
    moveRoute: defaultMoveRoute(),
    moveSpeed: 3,
    moveType: 0,
    priorityType: 1,
    stepAnime: false,
    through: false,
    trigger: 0,
    walkAnime: true,
  };
}

export function defaultEvent(id: number, x: number, y: number): MvEditorEvent {
  return {
    id,
    name: `EV${String(id).padStart(3, '0')}`,
    note: '',
    x, y,
    pages: [defaultPage()],
  };
}

// ---- Command list utilities ----

export function editableCommands(page: MvEventPage): MvCommand[] {
  const list = page && Array.isArray(page.list) ? page.list : [];
  return list.filter((command, index) => !(index === list.length - 1 && command.code === 0));
}

export interface MvCommandSpan {
  index: number;
  commands: MvCommand[];
}

export function editableCommandSpans(page: MvEventPage): MvCommandSpan[] {
  const list = page && Array.isArray(page.list) ? page.list : [];
  const spans: MvCommandSpan[] = [];
  for (let index = 0; index < list.length;) {
    if (index === list.length - 1 && list[index].code === 0) break;
    const length = commandSpanLength(list, index);
    spans.push({ index, commands: list.slice(index, index + length) });
    index += length;
  }
  return spans;
}

export function commandSpanLength(list: MvCommand[], index: number): number {
  const head = list[index]?.code;
  const follower = head === 101 ? 401
    : head === 105 ? 405
      : head === 108 ? 408
        : head === 205 ? 505
          : head === 302 ? 605
            : head === 355 ? 655
              : null;
  if (follower == null) return 1;
  let length = 1;
  while (list[index + length]?.code === follower) length += 1;
  return length;
}

export function ensureTerminator(list: MvCommand[]): void {
  while (list.length && list[list.length - 1].code === 0) list.pop();
  list.push({ code: 0, indent: 0, parameters: [] });
}

const STRUCTURE_END: Record<number, number> = { 102: 404, 111: 412, 112: 413, 301: 604 };
const STRUCTURE_OPEN = new Set(Object.keys(STRUCTURE_END).map(Number));
const STRUCTURE_CLOSE = new Set(Object.values(STRUCTURE_END));
const STRUCTURE_BRANCH = new Set([402, 403, 411, 601, 602, 603]);
const STRUCTURE_MARKER_START: Record<number, number> = {
  402: 102,
  403: 102,
  404: 102,
  411: 111,
  412: 111,
  413: 112,
  601: 301,
  602: 301,
  603: 301,
  604: 301,
};

function structureStartForMarker(spans: MvCommandSpan[], selectedIndex: number, startCode: number): number {
  const marker = spans[selectedIndex]?.commands[0];
  if (!marker) return -1;

  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    const head = spans[index]?.commands[0];
    if (!head || head.indent !== marker.indent) continue;
    if (head.code === startCode) return index;
    if (head.code === STRUCTURE_END[startCode]) break;
  }

  return -1;
}

export function commandBlockSpanIndices(spans: MvCommandSpan[], selected: number[]): number[] {
  const expanded = new Set(selected);
  for (const selectedIndex of [...expanded]) {
    const code = spans[selectedIndex]?.commands[0]?.code;
    const markerStartCode = STRUCTURE_MARKER_START[code];
    if (markerStartCode === undefined) continue;
    const markerStartIndex = structureStartForMarker(spans, selectedIndex, markerStartCode);
    if (markerStartIndex >= 0) expanded.add(markerStartIndex);
  }

  for (const selectedIndex of [...expanded]) {
    const endCode = STRUCTURE_END[spans[selectedIndex]?.commands[0]?.code];
    if (!endCode) continue;
    let depth = 0;
    for (let index = selectedIndex + 1; index < spans.length; index += 1) {
      const code = spans[index].commands[0]?.code;
      expanded.add(index);
      if (code === spans[selectedIndex].commands[0].code) depth += 1;
      else if (code === endCode) {
        if (!depth) break;
        depth -= 1;
      }
    }
  }
  return [...expanded].sort((a, b) => a - b);
}

export function commandInsertIndent(list: MvCommand[], rawIndex: number): number {
  let indent = 0;
  for (let index = 0; index < rawIndex; index += 1) {
    const code = list[index]?.code;
    if (STRUCTURE_CLOSE.has(code)) indent = Math.max(0, indent - 1);
    if (STRUCTURE_BRANCH.has(code)) indent = Math.max(0, indent - 1);
    if (STRUCTURE_OPEN.has(code)) indent += 1;
    if (STRUCTURE_BRANCH.has(code)) indent += 1;
  }
  return indent;
}

// ---- Command display ----

export interface CommandDisplayResult {
  label: string;
  tone: string;
  indent: number;
}

interface SystemData {
  switches?: string[];
  variables?: string[];
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function namedSystemEntry(system: SystemData | null, kind: 'switches' | 'variables', id: unknown): string {
  const num = Number(id || 0);
  if (!num) return '0000';
  const list = system && Array.isArray(system[kind]) ? system[kind] : [];
  const name = list[num] || '';
  return `${String(num).padStart(4, '0')}${name ? ` ${name}` : ''}`;
}

function namedSystemRange(system: SystemData | null, kind: 'switches' | 'variables', start: unknown, end: unknown): string {
  const first = Number(start || 0);
  const last = Number(end || start || 0);
  if (!first) return '0000';
  if (first === last) return namedSystemEntry(system, kind, first);
  return `${namedSystemEntry(system, kind, first)}..${namedSystemEntry(system, kind, last)}`;
}

function conditionBranchDisplay(system: SystemData | null, params: unknown[], language: ProductLanguage): string {
  const type = Number(params[0] || 0);
  if (type === 0) return `${namedSystemEntry(system, 'switches', params[1])} ${translate('eventEditor.helper.is', language)} ${params[2] === 1 ? 'OFF' : 'ON'}`;
  if (type === 1) {
    const ops = ['=', '≥', '≤', '>', '<', '!='];
    const op = ops[Number(params[4] || 0)] || String(params[4]);
    return `${namedSystemEntry(system, 'variables', params[1])} ${op} ${params[2] === 1 ? namedSystemEntry(system, 'variables', params[3]) : params[3]}`;
  }
  if (type === 2) return `${translate('eventEditor.helper.selfSwitch', language)} ${params[1]} ${translate('eventEditor.helper.is', language)} ${params[2] === 1 ? 'OFF' : 'ON'}`;
  return translate('eventEditor.helper.conditionType', language, { type, detail: JSON.stringify(params) });
}

function eventTargetLabel(value: unknown, language: ProductLanguage): string {
  const target = Number(value);
  if (target === -1) return translate('eventEditor.helper.player', language);
  if (target === 0) return translate('eventEditor.helper.thisEvent', language);
  if (Number.isFinite(target) && target > 0) return `EV${String(target).padStart(3, '0')}`;
  return String(value || 0);
}

function balloonIconLabel(value: unknown, language: ProductLanguage): string {
  const labels = eventEditorText(language).balloonIconLabels;
  return labels[Number(value)] || translate('eventEditor.helper.icon', language, { value: String(value || 0) });
}

function messageFaceLabel(params: unknown[], language: ProductLanguage): string {
  const face = String(params[0] || '');
  return face ? `${face}(${params[1] || 0})` : translate('eventEditor.helper.none', language);
}

function messageBackgroundLabel(value: unknown, language: ProductLanguage): string {
  const labels = eventEditorText(language).messageBackgroundLabels;
  return labels[Number(value) || 0] || translate('eventEditor.helper.background', language, { value: String(value) });
}

function messagePositionLabel(value: unknown, language: ProductLanguage): string {
  const pos = Number.isFinite(Number(value)) ? Number(value) : 2;
  const labels = eventEditorText(language).messagePositionLabels;
  return labels[pos] || translate('eventEditor.helper.position', language, { value: String(value) });
}

function standardCommandLabel(code: number, language: ProductLanguage): string {
  return localizeCommandCodeLabel(code, language, catalogCommandLabel(code));
}

export function commandDisplay(command: MvCommand, system?: SystemData | null, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): CommandDisplayResult {
  language = normalizeProductLanguage(language)
  const p = command.parameters || [];
  const indent = clampInt(command.indent, 0, 12);
  const line = (label: string, tone = 'normal'): CommandDisplayResult => ({ label: `◆${label}`, tone, indent });

  if (command.code === 101) return line(translate('eventEditor.command.text', language, { face: messageFaceLabel(p, language), bg: messageBackgroundLabel(p[2], language), pos: messagePositionLabel(p[3], language) }), 'text');
  if (command.code === 401) return { label: `${translate('eventEditor.colon', language)}${p[0] || ''}`, tone: 'text', indent: Math.min(indent + 1, 12) };
  if (command.code === 102) return line(translate('eventEditor.command.showChoices', language, { choices: (p[0] as string[] || []).join(' / ') }), 'control');
  if (command.code === 402) return line(translate('eventEditor.command.whenChoice', language, { val: String(p[1] || p[0] || '') }), 'text');
  if (command.code === 403) return line(translate('eventEditor.command.whenCancel', language), 'text');
  if (command.code === 404) return line(translate('eventEditor.command.endChoices', language), 'control');
  if (command.code === 108 || command.code === 408) return line(translate('eventEditor.command.comment', language, { text: String(p[0] || '') }), 'normal');
  if (command.code === 111) return line(translate('eventEditor.command.if', language, { cond: conditionBranchDisplay(system || null, p, language) }), 'text');
  if (command.code === 112) return line(translate('eventEditor.command.loop', language), 'control');
  if (command.code === 113) return line(translate('eventEditor.command.breakLoop', language), 'control');
  if (command.code === 121) return line(translate('eventEditor.command.controlSwitches', language, { range: namedSystemRange(system || null, 'switches', p[0], p[1]), val: p[2] === 1 ? 'OFF' : 'ON' }), 'control');
  if (command.code === 122) return line(translate('eventEditor.command.controlVariables', language, { range: namedSystemRange(system || null, 'variables', p[0], p[1]) }), 'control');
  if (command.code === 123) return line(translate('eventEditor.command.controlSelfSwitch', language, { ch: String(p[0]), val: p[1] === 1 ? 'OFF' : 'ON' }), 'control');
  if (command.code === 201) return line(translate('eventEditor.command.transferPlayer', language, { mapId: String(p[1]), x: String(p[2]), y: String(p[3]) }), 'control');
  if (command.code === 205) return line(translate('eventEditor.command.setMovementRoute', language), 'control');
  if (command.code === 212) return line(translate('eventEditor.command.showAnimation', language, { target: eventTargetLabel(p[0], language), id: String(p[1] || 0) }), 'control');
  if (command.code === 213) return line(translate('eventEditor.command.showBalloonIcon', language, { target: eventTargetLabel(p[0], language), icon: balloonIconLabel(p[1], language) }), 'control');
  if (command.code === 221) return line(translate('eventEditor.command.fadeoutScreen', language), 'control');
  if (command.code === 222) return line(translate('eventEditor.command.fadeinScreen', language), 'control');
  if (command.code === 223) return line(translate('eventEditor.command.tintScreen', language, { json: JSON.stringify(p[0] || []) }), 'control');
  if (command.code === 224) return line(translate('eventEditor.command.flashScreen', language, { json: JSON.stringify(p[0] || []) }), 'control');
  if (command.code === 225) return line(translate('eventEditor.command.shakeScreen', language, { power: String(p[0] || 0) }), 'control');
  if (command.code === 230) return line(translate('eventEditor.command.wait', language, { frames: String(p[0] || 0) }), 'control');
  if (command.code === 250) return line(translate('eventEditor.command.playSE', language, { name: (p[0] as { name?: string })?.name || '' }), 'control');
  if (command.code === 125) return line(translate('eventEditor.command.changeGold', language, { sign: p[0] === 1 ? '-' : '+', amount: String(p[2] || 0) }), 'control');
  if (command.code === 314) return line(translate('eventEditor.command.recoverAll', language), 'control');
  if (command.code === 117) return line(translate('eventEditor.command.commonEvent', language, { id: String(p[0] || 0) }), 'control');
  if (command.code === 356) return line(translate('eventEditor.command.pluginCommand', language, { cmd: String(p[0] || '') }), 'control');
  if (command.code === 411) return line(translate('eventEditor.command.else', language), 'control');
  if (command.code === 412) return line(translate('eventEditor.command.branchEnd', language), 'control');
  if (command.code === 413) return line(translate('eventEditor.command.repeatAbove', language), 'control');
  if (command.code === 505) return { label: `${translate('eventEditor.colon', language)}${moveRouteCommandLabel(p[0], language)}`, tone: 'control', indent: Math.min(indent + 1, 12) };
  if (command.code === 405 || command.code === 408 || command.code === 605 || command.code === 655) return { label: `${translate('eventEditor.colon', language)}${p[0] || ''}`, tone: 'text', indent: Math.min(indent + 1, 12) };
  const standardLabel = standardCommandLabel(command.code, language);
  if (!standardLabel.startsWith('Raw command ')) return line(`${standardLabel}${p.length ? `${translate('eventEditor.colon', language)} ${JSON.stringify(p)}` : ''}`, 'control');
  return line(`Raw command ${command.code}: ${JSON.stringify(p)}`, 'raw');
}

// Semantic command color categories for event-editor command headers. Keep this
// separate from commandDisplay tone because preview components depend on that
// lower-granularity tone.
const TONE_TEXT = new Set([101, 401, 102, 402, 403, 404, 405]);
const TONE_FLOW = new Set([111, 112, 113, 115, 117, 119, 411, 412, 413]);
const TONE_DATA = new Set([121, 122, 123, 124, 125, 126, 127, 128, 129, 133, 311, 312, 313, 314, 315, 316, 317]);
const TONE_MOVE = new Set([201, 202, 203, 204, 205, 206, 505]);
const TONE_RAW = new Set([355, 356, 357, 655]);
const TONE_STAGE = new Set([
  211, 212, 213, 214, 216, 217, 221, 222, 223, 224, 225,
  230, 231, 232, 233, 234, 235, 236, 241, 242, 243, 244, 245, 246, 249, 250, 251, 261, 285,
]);

export function commandTone(code: number): string {
  if (TONE_TEXT.has(code)) return 'text';
  if (TONE_FLOW.has(code)) return 'flow';
  if (TONE_DATA.has(code)) return 'data';
  if (TONE_MOVE.has(code)) return 'move';
  if (TONE_STAGE.has(code)) return 'stage';
  if (TONE_RAW.has(code)) return 'raw';
  return 'normal';
}

export function moveRouteCommandLabel(command: unknown, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  if (!command || typeof command !== 'object') return translate('eventEditor.moveRoute.invalidStep', language);
  const item = command as { code?: number; parameters?: unknown[] };
  const labels = eventEditorText(language).moveRouteLabels;
  return `${labels[Number(item.code)] || `Raw ${item.code || 0}`}${item.parameters?.length ? `${translate('eventEditor.colon', language)} ${JSON.stringify(item.parameters)}` : ''}`;
}

// ---- Quick event templates ----

export type QuickEventType = 'transfer' | 'door' | 'treasure' | 'inn';

export function quickEventTemplate(type: QuickEventType, x: number, y: number): MvEditorEvent {
  const ev = defaultEvent(0, x, y);
  ev.name = '';

  if (type === 'transfer') {
    // Transfer event: Player Touch trigger plus Transfer Player command.
    const page = ev.pages[0];
    page.trigger = 1; // Player Touch
    page.priorityType = 1;
    page.list = [
      { code: 201, indent: 0, parameters: [0, 1, 0, 0, 2, 0] }, // Transfer Player
      { code: 0, indent: 0, parameters: [] },
    ];
    ev.name = QUICK_EVENT_NAMES.transfer;
  } else if (type === 'door') {
    // Door event: Player Touch trigger, door character sprite, and Transfer Player.
    const page = ev.pages[0];
    page.trigger = 1; // Player Touch
    page.priorityType = 1;
    page.image = { tileId: 0, characterName: '!Door1', direction: 2, pattern: 0, characterIndex: 0 };
    page.list = [
      { code: 250, indent: 0, parameters: [{ name: 'Open1', volume: 90, pitch: 100, pan: 0 }] }, // Play SE
      { code: 205, indent: 0, parameters: [-1, { list: [{ code: 44, parameters: [{ name: 'Open1', volume: 90, pitch: 100, pan: 0 }] }, { code: 0, parameters: [] }], repeat: false, skippable: false, wait: true }] }, // Set Move Route (open door anim)
      { code: 230, indent: 0, parameters: [10] }, // Wait
      { code: 201, indent: 0, parameters: [0, 1, 0, 0, 2, 0] }, // Transfer Player
      { code: 0, indent: 0, parameters: [] },
    ];
    ev.name = QUICK_EVENT_NAMES.door;
  } else if (type === 'treasure') {
    // Treasure event: first page grants an item, second page shows opened chest.
    const page1 = ev.pages[0];
    page1.trigger = 0; // Action Button
    page1.priorityType = 1;
    page1.image = { tileId: 0, characterName: '!Chest', direction: 2, pattern: 1, characterIndex: 0 };
    page1.list = [
      { code: 250, indent: 0, parameters: [{ name: 'Chest1', volume: 90, pitch: 100, pan: 0 }] }, // SE
      { code: 205, indent: 0, parameters: [-1, { list: [{ code: 44, parameters: [{ name: 'Chest1', volume: 90, pitch: 100, pan: 0 }] }, { code: 0, parameters: [] }], repeat: false, skippable: false, wait: true }] }, // Open anim
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] }, // Text header
      { code: 401, indent: 0, parameters: [QUICK_EVENT_TEXT.treasureItem] }, // Text body
      { code: 123, indent: 0, parameters: ['A', 0] }, // Self Switch A = ON
      { code: 0, indent: 0, parameters: [] },
    ];

    const page2 = defaultPage();
    page2.conditions.selfSwitchValid = true;
    page2.conditions.selfSwitchCh = 'A';
    page2.image = { tileId: 0, characterName: '!Chest', direction: 2, pattern: 0, characterIndex: 0 };
    page2.priorityType = 1;
    page2.trigger = 0;
    ev.pages.push(page2);
    ev.name = QUICK_EVENT_NAMES.treasure;
  } else if (type === 'inn') {
    // Inn event: Action Button trigger, choices, and full recovery.
    const page = ev.pages[0];
    page.trigger = 0; // Action Button
    page.priorityType = 1;
    page.list = [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 0, parameters: [QUICK_EVENT_TEXT.innPrompt] },
      { code: 102, indent: 0, parameters: [[QUICK_EVENT_TEXT.innYes, QUICK_EVENT_TEXT.innNo], 1] }, // Show Choices
      { code: 402, indent: 0, parameters: [0, QUICK_EVENT_TEXT.innYes] },
      { code: 125, indent: 1, parameters: [1, 0, 50] }, // Change Gold -50
      { code: 314, indent: 1, parameters: [0] }, // Recover All
      { code: 250, indent: 1, parameters: [{ name: 'Recovery', volume: 90, pitch: 100, pan: 0 }] },
      { code: 101, indent: 1, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 1, parameters: [QUICK_EVENT_TEXT.innThanks] },
      { code: 0, indent: 1, parameters: [] },
      { code: 402, indent: 0, parameters: [1, QUICK_EVENT_TEXT.innNo] },
      { code: 0, indent: 1, parameters: [] },
      { code: 404, indent: 0, parameters: [] }, // End Choices
      { code: 0, indent: 0, parameters: [] },
    ];
    ev.name = QUICK_EVENT_NAMES.inn;
  }

  return ev;
}

// ---- Image summary ----

export function imageSummary(image: MvEventImage, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  const emptyLabel = pickByLocale(language, { 'zh-CN': '无图像', 'en-US': 'No image' });
  if (image.tileId) return `Tile #${image.tileId}`;
  if (image.characterName) return `${image.characterName} idx${image.characterIndex || 0}`;
  return emptyLabel;
}