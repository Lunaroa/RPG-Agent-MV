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
  /** Display/selection metadata derived from the raw command list. */
  structureId?: number;
  parentStructureId?: number;
  branchId?: number;
  role?: MvCommandSpanRole;
}

/**
 * A UI-only insertion boundary in an MV command list.
 *
 * `spanIndex` is the display-list boundary consumed by EventCommandDialog
 * (`0` means before the first span and `spans.length` means before the page
 * terminator). `rawIndex` and `indent` are derived from the current list for
 * opening the picker; no command is materialized for this row.
 */
export interface MvCommandInsertionSlot {
  key: string;
  spanIndex: number;
  rawIndex: number;
  indent: number;
  /**
   * True when this slot sits at the bottom of a structure body — i.e. the next
   * span is a branch marker (else / when / battle branch) or a block terminator
   * (End), or the slot is the trailing one at the end of the list. RM-native
   * lists keep these slots visible as insertion affordances while collapsing
   * same-level sequential-command gaps, so commands sit flush but every body
   * still has exactly one insert entry at its foot.
   */
  blockBottom: boolean;
}

export type MvCommandSpanRole = 'command' | 'head' | 'branch' | 'terminator';

export type MvCommandStructureKind = 'choices' | 'conditional' | 'loop' | 'battle' | 'skip';

export interface MvCommandStructureBlock {
  id: number;
  kind: MvCommandStructureKind;
  headCode: number;
  headSpanIndex: number;
  endSpanIndex: number;
  indent: number;
  parentId?: number;
  branchSpanIndices: number[];
}

interface StructureDefinition {
  kind: MvCommandStructureKind;
  endCode: number;
  branchCodes: readonly number[];
}

const STRUCTURE_DEFINITIONS: Readonly<Record<number, StructureDefinition>> = Object.freeze({
  102: { kind: 'choices', endCode: 404, branchCodes: [402, 403] },
  109: { kind: 'skip', endCode: 0, branchCodes: [] },
  111: { kind: 'conditional', endCode: 412, branchCodes: [411] },
  112: { kind: 'loop', endCode: 413, branchCodes: [] },
  301: { kind: 'battle', endCode: 604, branchCodes: [601, 602, 603] },
});

function structureDefinition(code: number): StructureDefinition | undefined {
  return STRUCTURE_DEFINITIONS[code];
}

function matchingStructureEnd(spans: MvCommandSpan[], headSpanIndex: number, definition: StructureDefinition): number {
  const head = spans[headSpanIndex]?.commands[0];
  if (!head) return Math.max(headSpanIndex, spans.length - 1);
  let nested = 0;
  for (let index = headSpanIndex + 1; index < spans.length; index += 1) {
    const command = spans[index]?.commands[0];
    if (!command) continue;
    if (command.code === head.code && command.indent === head.indent) {
      nested += 1;
      continue;
    }
    if (command.code === definition.endCode && command.indent === head.indent) {
      if (nested === 0) return index;
      nested -= 1;
    }
  }
  // Malformed/open structures remain selectable through the last editable row;
  // no raw command is discarded merely because its closing marker is missing.
  return Math.max(headSpanIndex, spans.length - 1);
}

function buildStructureAnalysis(spans: MvCommandSpan[]): MvCommandStructureBlock[] {
  const blocks: MvCommandStructureBlock[] = [];
  for (let index = 0; index < spans.length; index += 1) {
    const command = spans[index]?.commands[0];
    const definition = command ? structureDefinition(command.code) : undefined;
    if (!command || !definition) continue;
    const endSpanIndex = matchingStructureEnd(spans, index, definition);
    const parent = blocks
      .filter((block) => block.headSpanIndex < index && block.endSpanIndex >= endSpanIndex && block.indent < command.indent)
      .sort((a, b) => b.headSpanIndex - a.headSpanIndex)[0];
    const branchSpanIndices: number[] = [];
    for (let branchIndex = index + 1; branchIndex <= endSpanIndex; branchIndex += 1) {
      const branchCommand = spans[branchIndex]?.commands[0];
      if (branchCommand && branchCommand.indent === command.indent && definition.branchCodes.includes(branchCommand.code)) {
        branchSpanIndices.push(branchIndex);
      }
    }
    blocks.push({
      id: blocks.length,
      kind: definition.kind,
      headCode: command.code,
      headSpanIndex: index,
      endSpanIndex,
      indent: command.indent,
      ...(parent ? { parentId: parent.id } : {}),
      branchSpanIndices,
    });
  }
  return blocks;
}

function annotateStructureSpans(spans: MvCommandSpan[]): MvCommandStructureBlock[] {
  const blocks = buildStructureAnalysis(spans);
  const byHead = new Map(blocks.map((block) => [block.headSpanIndex, block]));
  const byMarker = new Map<number, MvCommandStructureBlock>();
  const byTerminator = new Map<number, MvCommandStructureBlock>();
  for (const block of blocks) {
    for (const marker of block.branchSpanIndices) byMarker.set(marker, block);
    const end = spans[block.endSpanIndex]?.commands[0];
    if (end?.indent === block.indent && end.code === STRUCTURE_DEFINITIONS[block.headCode].endCode) byTerminator.set(block.endSpanIndex, block);
  }
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    const head = span.commands[0];
    const headBlock = byHead.get(index);
    const markerBlock = byMarker.get(index);
    const terminatorBlock = byTerminator.get(index);
    const role: MvCommandSpanRole = headBlock ? 'head' : terminatorBlock ? 'terminator' : markerBlock ? 'branch' : 'command';
    const owner = headBlock || markerBlock || terminatorBlock || blocks
      .filter((block) => block.headSpanIndex < index && block.endSpanIndex >= index && block.indent < head.indent)
      .sort((a, b) => b.headSpanIndex - a.headSpanIndex)[0];
    const branchPath = blocks
      .filter((block) => block.headSpanIndex <= index && block.endSpanIndex >= index)
      .sort((a, b) => a.indent - b.indent)
      .map((block) => {
        const marker = block.branchSpanIndices.filter((candidate) => candidate <= index).at(-1);
        return marker === undefined ? block.headSpanIndex : marker;
      });
    const branchId = branchPath.at(-1);
    spans[index] = {
      ...span,
      ...(owner ? { structureId: owner.id } : {}),
      ...(owner?.parentId !== undefined ? { parentStructureId: owner.parentId } : {}),
      ...(branchId !== undefined ? { branchId } : {}),
      role,
    };
  }
  return blocks;
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
  annotateStructureSpans(spans);
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
              : head === 357 ? 657
                : null;
  if (follower == null) return 1;
  let length = 1;
  while (list[index + length]?.code === follower) length += 1;
  return length;
}

/** Return the complete structural blocks represented by a display span list. */
export function commandStructureBlocks(spans: MvCommandSpan[]): MvCommandStructureBlock[] {
  // Callers may construct spans themselves in tests; annotate a copy so this
  // helper never mutates a caller-owned array.
  return buildStructureAnalysis(spans.map((span) => ({ ...span, commands: span.commands.map((command) => ({ ...command, parameters: [...command.parameters] })) })));
}

/** Stable branch scope used by Shift-selection. Empty means the top-level list. */
export function commandBranchScope(spans: MvCommandSpan[], index: number): string {
  const span = spans[index];
  if (!span) return '';
  const blocks = commandStructureBlocks(spans);
  const path = blocks
    .filter((block) => block.headSpanIndex <= index && block.endSpanIndex >= index)
    .sort((a, b) => a.indent - b.indent)
    .map((block) => {
      const marker = block.branchSpanIndices.filter((candidate) => candidate <= index).at(-1);
      return `${block.id}:${marker === undefined ? 'body' : marker}`;
    });
  return path.join('/');
}

export function ensureTerminator(list: MvCommand[]): void {
  // Trailing code-0 rows that close open skip (109) blocks are structure, not page
  // terminators; naively popping every trailing 0 used to eat skip-block terminators.
  const skipIndents: number[] = [];
  let lastStructural = -1;
  for (let index = 0; index < list.length; index += 1) {
    const command = list[index];
    if (command.code === 109) {
      skipIndents.push(command.indent);
      lastStructural = index;
      continue;
    }
    if (command.code === 0) {
      if (skipIndents.length && skipIndents[skipIndents.length - 1] === command.indent) {
        skipIndents.pop();
        lastStructural = index;
      }
      continue;
    }
    lastStructural = index;
  }
  list.splice(lastStructural + 1);
  // Repair skip blocks whose terminator was lost by earlier mutations.
  while (skipIndents.length) list.push({ code: 0, indent: skipIndents.pop()!, parameters: [] });
  list.push({ code: 0, indent: 0, parameters: [] });
}

export function commandBlockSpanIndices(spans: MvCommandSpan[], selected: number[]): number[] {
  const blocks = commandStructureBlocks(spans);
  const expanded = new Set<number>();
  for (const selectedIndex of selected) {
    if (selectedIndex < 0 || selectedIndex >= spans.length) continue;
    const command = spans[selectedIndex]?.commands[0];
    if (!command) continue;
    const ownBlock = blocks.find((block) => block.headSpanIndex === selectedIndex);
    const markerBlock = blocks.find((block) => block.branchSpanIndices.includes(selectedIndex) || block.endSpanIndex === selectedIndex);
    // Clicking a structure head or one of its branch markers selects the full
    // RM structure. Ordinary commands inside a branch remain independently
    // movable/editable, matching the stock editor's ◆ rows.
    const block = ownBlock || markerBlock;
    if (block) {
      for (let index = block.headSpanIndex; index <= block.endSpanIndex; index += 1) expanded.add(index);
    } else expanded.add(selectedIndex);
  }
  return [...expanded].sort((a, b) => a - b);
}

/** Raw list indices of code-0 rows that terminate a skip (109) block. */
export function skipTerminatorIndices(list: MvCommand[]): Set<number> {
  const result = new Set<number>();
  const skips: number[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const command = list[index];
    if (command.code === 109) { skips.push(command.indent); continue; }
    if (command.code === 0 && skips.length && skips[skips.length - 1] === command.indent) {
      skips.pop();
      result.add(index);
    }
  }
  return result;
}

export function commandInsertIndent(list: MvCommand[], rawIndex: number): number {
  const limit = Math.max(0, Math.min(list.length, Math.floor(rawIndex)));
  const open: Array<{ code: number; indent: number; definition: StructureDefinition }> = [];
  let indent = 0;
  for (let index = 0; index < limit; index += 1) {
    const command = list[index];
    if (!command) continue;
    const code = command.code;
    const top = open.at(-1);
    if (top && code === top.definition.endCode && command.indent === top.indent) {
      open.pop();
      indent = open.at(-1)?.indent !== undefined ? open.at(-1)!.indent + 1 : command.indent;
      continue;
    }
    if (top && top.definition.branchCodes.includes(code) && command.indent === top.indent) {
      // Branch markers close the previous body and immediately open the next
      // body at the same nesting depth.
      indent = command.indent + 1;
      continue;
    }
    const definition = structureDefinition(code);
    if (definition) {
      open.push({ code, indent: command.indent, definition });
      indent = command.indent + 1;
      continue;
    }
    if (code === 0 && top?.code === 109 && command.indent === top.indent) {
      open.pop();
      indent = open.at(-1)?.indent !== undefined ? open.at(-1)!.indent + 1 : command.indent;
      continue;
    }
    // Preserve the explicit indentation of malformed/unknown rows rather than
    // attempting to repair their shape while calculating the insertion slot.
    if (command.indent > indent) indent = command.indent;
  }
  return Math.max(0, indent);
}

/**
 * Return every legal RM-style insertion boundary in display order.
 *
 * Boundaries are emitted before every editable span and once before the page
 * terminator, except for the synthetic gap between a choices/battle head and
 * its first explicit branch marker (or direct end marker). Empty choice/battle
 * branches start after their marker, while ordinary Then/Else/loop bodies,
 * same-level gaps, and the final terminator gap remain available. Continuation
 * commands stay inside their owning span, so no illegal mid-span row is offered.
 */
export function commandInsertionSlots(
  list: MvCommand[],
  spans: MvCommandSpan[],
): MvCommandInsertionSlot[] {
  const terminatorIndex = list.length > 0 && list[list.length - 1]?.code === 0
    ? list.length - 1
    : list.length;
  const blockedBoundaries = new Set<number>();
  for (const block of commandStructureBlocks(spans)) {
    // Choices and battle processing start each branch with an explicit marker;
    // there is no branch body before that first marker. Do not project the
    // boundary immediately after the head as an insertion/drop target. An
    // empty branch remains editable through the slot after its marker and
    // before the next marker/end. With no marker at all (for example an empty
    // choices list ending directly at 404), the direct head-to-end boundary is
    // likewise not a legal body slot.
    if (block.kind !== 'choices' && block.kind !== 'battle') continue;
    const firstBranchOrEnd = block.branchSpanIndices[0] ?? block.endSpanIndex;
    if (firstBranchOrEnd === block.headSpanIndex + 1) blockedBoundaries.add(firstBranchOrEnd);
  }
  const slots: MvCommandInsertionSlot[] = [];
  const boundaries = [...spans.map((_span, index) => index), spans.length];
  let previousRawIndex = -1;
  for (const spanIndex of boundaries) {
    if (blockedBoundaries.has(spanIndex)) continue;
    const rawIndex = spanIndex < spans.length
      ? spans[spanIndex]?.index ?? terminatorIndex
      : terminatorIndex;
    // A malformed list may expose duplicate span indexes. Keep the visual
    // boundary unique so an empty list has exactly one blank row.
    if (rawIndex === previousRawIndex) continue;
    previousRawIndex = rawIndex;
    // A slot is a "block bottom" insertion affordance when the span that
    // follows it is a branch marker (else/when/battle branch) or a block
    // terminator (End), or when it is the trailing slot at the end of the
    // list. RM-native lists show these as the one visible insert entry per
    // body while keeping same-level sequential commands flush.
    const nextSpan = spanIndex < spans.length ? spans[spanIndex] : undefined;
    const blockBottom = !nextSpan || nextSpan.role === 'branch' || nextSpan.role === 'terminator';
    const indent = commandInsertIndent(list, rawIndex);
    slots.push({
      key: `insert:${rawIndex}`,
      spanIndex,
      rawIndex,
      indent,
      blockBottom,
    });
  }
  return slots;
}

export interface CommandBlockMove {
  list: MvCommand[];
  headIndex: number;
}

/** Move the full structure block containing `selectedIndex` one span up or down. */
export function moveCommandSpanBlock(list: MvCommand[], spans: MvCommandSpan[], selectedIndex: number, offset: -1 | 1): CommandBlockMove | null {
  const expanded = commandBlockSpanIndices(spans, [selectedIndex]);
  const first = expanded[0];
  const last = expanded[expanded.length - 1];
  if (first == null || last == null) return null;
  if (offset < 0 && first <= 0) return null;
  if (offset > 0 && last >= spans.length - 1) return null;
  const target = offset < 0 ? first - 1 : last + 2;
  return dropCommandSpanBlocks(list, spans, expanded, target);
}

/** Drop the block containing `sourceIndex` before span `targetIndex` (`spans.length` drops at the end). */
export function dropCommandSpanBlock(list: MvCommand[], spans: MvCommandSpan[], sourceIndex: number, targetIndex: number): CommandBlockMove | null {
  return dropCommandSpanBlocks(list, spans, commandBlockSpanIndices(spans, [sourceIndex]), targetIndex);
}

/**
 * Move multiple selected rows as one ordered group. Selection is expanded to
 * complete structure blocks before raw commands are removed, so a choice,
 * branch, loop, battle branch, skip, or nested continuation cannot be split.
 */
export function dropCommandSpanBlocks(
  list: MvCommand[],
  spans: MvCommandSpan[],
  selectedIndices: number[],
  targetIndex: number,
): CommandBlockMove | null {
  const expanded = commandBlockSpanIndices(spans, selectedIndices);
  if (!expanded.length || targetIndex < 0 || targetIndex > spans.length) return null;
  const first = expanded[0];
  const last = expanded[expanded.length - 1];
  if (targetIndex >= first && targetIndex <= last + 1) return null;

  const ranges: Array<{ start: number; end: number }> = [];
  for (const spanIndex of expanded) {
    const span = spans[spanIndex];
    if (!span) continue;
    const range = { start: span.index, end: span.index + span.commands.length };
    const previous = ranges.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else ranges.push(range);
  }
  if (!ranges.length) return null;
  const targetRaw = targetIndex >= spans.length
    ? (list.length && list[list.length - 1].code === 0 ? list.length - 1 : list.length)
    : spans[targetIndex]?.index;
  if (targetRaw === undefined) return null;
  if (ranges.some((range) => targetRaw >= range.start && targetRaw <= range.end)) return null;
  const moved = ranges.flatMap((range) => list.slice(range.start, range.end).map((command) => clone(command)));
  const removedBeforeTarget = ranges.filter((range) => range.end <= targetRaw).reduce((sum, range) => sum + range.end - range.start, 0);
  const next = clone(list) as MvCommand[];
  for (const range of [...ranges].reverse()) next.splice(range.start, range.end - range.start);
  let headIndex = targetRaw - removedBeforeTarget;
  headIndex = Math.max(0, Math.min(headIndex, next.length));
  const delta = commandInsertIndent(next, headIndex) - (moved[0]?.indent || 0);
  if (delta) for (const command of moved) command.indent = Math.max(0, command.indent + delta);
  next.splice(headIndex, 0, ...moved);
  return { list: next, headIndex };
}

// ---- Command display ----

export interface CommandDisplayResult {
  label: string;
  tone: string;
  indent: number;
}

export interface SystemData {
  switches?: string[];
  variables?: string[];
}

export interface MvCommandSpanView {
  key: number;
  tone: string;
  indent: number;
  head: string;
  lines: string[];
  role: MvCommandSpanRole;
  structureId?: number;
  branchId?: number;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function hasInvalidNamedSystemId(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  const num = Number(value);
  return !Number.isFinite(num) || !Number.isInteger(num) || num < 0;
}

function namedSystemEntry(system: SystemData | null, kind: 'switches' | 'variables', id: unknown, language: ProductLanguage): string {
  if (hasInvalidNamedSystemId(id)) return translate('eventcmd.invalidEntryId', language);
  const num = Number(id ?? 0);
  if (!num) return '0000';
  const list = system && Array.isArray(system[kind]) ? system[kind] : [];
  const name = list[num] || '';
  return `${String(num).padStart(4, '0')}${name ? ` ${name}` : ''}`;
}

function namedSystemRange(system: SystemData | null, kind: 'switches' | 'variables', start: unknown, end: unknown, language: ProductLanguage): string {
  if (hasInvalidNamedSystemId(start) || hasInvalidNamedSystemId(end)) return translate('eventcmd.invalidEntryId', language);
  const first = Number(start ?? 0);
  const last = Number(end ?? start ?? 0);
  if (!first) return '0000';
  if (first === last) return namedSystemEntry(system, kind, first, language);
  return `${namedSystemEntry(system, kind, first, language)}..${namedSystemEntry(system, kind, last, language)}`;
}

function conditionBranchDisplay(system: SystemData | null, params: unknown[], language: ProductLanguage): string {
  const type = Number(params[0] || 0);
  if (type === 0) return `${namedSystemEntry(system, 'switches', params[1], language)} ${translate('eventEditor.helper.is', language)} ${params[2] === 1 ? 'OFF' : 'ON'}`;
  if (type === 1) {
    const ops = ['=', '≥', '≤', '>', '<', '!='];
    const op = ops[Number(params[4] || 0)] || String(params[4]);
    return `${namedSystemEntry(system, 'variables', params[1], language)} ${op} ${params[2] === 1 ? namedSystemEntry(system, 'variables', params[3], language) : params[3]}`;
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

function choicePositionLabel(value: unknown, language: ProductLanguage): string {
  const pos = Number.isFinite(Number(value)) ? Number(value) : 2;
  const labels = eventEditorText(language).choicePositionLabels;
  return labels[pos] || translate('eventEditor.helper.position', language, { value: String(value) });
}

function standardCommandLabel(code: number, language: ProductLanguage): string {
  return localizeCommandCodeLabel(code, language, catalogCommandLabel(code));
}

/** Index-of-label lookup that tolerates out-of-range values by falling back to the raw number. */
function labelAt(labels: readonly string[], value: unknown, fallback: string): string {
  const idx = Number(value);
  if (!Number.isInteger(idx) || idx < 0 || idx >= labels.length) return fallback;
  return labels[idx] || fallback;
}

/** "#N" entry id where we do not yet have the database name; mirrors RM's display when names are absent. */
function entryId(id: unknown, language: ProductLanguage): string {
  const n = Number(id);
  if (!Number.isFinite(n)) return translate('eventEditor.command.unknownEntry', language, { id: String(id ?? 0) });
  return translate('eventEditor.command.idName', language, { id: String(Math.trunc(n)) });
}

/** Audio object summary for Play BGM/BGS/ME etc.: "Theme (V90 P100)". */
function audioSummary(value: unknown, language: ProductLanguage): string {
  if (!value || typeof value !== 'object') return translate('eventEditor.command.audioSummary', language, { name: '', vol: 0, pitch: 0 });
  const audio = value as { name?: unknown; volume?: unknown; pitch?: unknown; pan?: unknown };
  return translate('eventEditor.command.audioSummary', language, {
    name: String(audio.name ?? ''),
    vol: String(Number(audio.volume ?? 0) || 0),
    pitch: String(Number(audio.pitch ?? 0) || 0),
  });
}

/** Actor target label for "Change X" actor commands: 0=fixed actor, 1=party member. Actor id 0 means all members. */
function actorTargetDisplay(params: unknown[], language: ProductLanguage): string {
  const text = eventEditorText(language);
  const type = Number(params[0] ?? 0);
  if (type === 0) {
    if (Number(params[1] ?? 0) === 0) return text.actorTargetLabels[2] || 'Entire Party';
    return `${text.actorTargetLabels[0] || 'Actor'} ${entryId(params[1], language)}`;
  }
  if (type === 1) return `${text.actorTargetLabels[1] || 'Party Member'} ${entryId(params[1], language)}`;
  return String(params[1] ?? '');
}

/**
 * Operand summary shared by Change Items / Gold / HP / EXP etc.
 * `operandTypeIdx` points at the operandType field in params; the operand value sits
 * one slot after it. operandType: 0=Constant, 1=Variable, 2+=game data reference.
 * Returns the value side only (the +/- operation is rendered by the caller).
 */
function operandDisplay(params: unknown[], operandTypeIdx: number, system: SystemData | null, language: ProductLanguage): string {
  const text = eventEditorText(language);
  const operandType = Number(params[operandTypeIdx] ?? 0);
  const operandValueIdx = operandTypeIdx + 1;
  if (operandType === 1) return `{${namedSystemEntry(system, 'variables', params[operandValueIdx], language)}}`;
  if (operandType >= 2 && operandType <= 4) {
    const kindLabel = labelAt(text.operandTypeLabels, operandType, text.operandTypeLabels[0] || '');
    return `${kindLabel} ${entryId(params[operandValueIdx], language)}`;
  }
  return String(Number(params[operandValueIdx] ?? 0) || 0);
}

/** Enemy index label: -1=Entire troop, 0+="#N+1" (RM shows enemy #1..n by position). */
function enemyIndexDisplay(value: unknown, language: ProductLanguage): string {
  const idx = Number(value);
  if (idx === -1) return translate('eventEditor.command.enemyAll', language);
  if (!Number.isFinite(idx)) return String(value ?? 0);
  return translate('eventEditor.command.idName', language, { id: String(Math.trunc(idx) + 1) });
}

function pictureInt(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/** "(x,y)" segment; variable designation renders named variable references. */
function pictureCoordinatePair(system: SystemData | null, p: unknown[], language: ProductLanguage): string {
  if (Number(p[3]) === 1) {
    const x = namedSystemEntry(system, 'variables', p[4], language);
    const y = namedSystemEntry(system, 'variables', p[5], language);
    return `{${x}},{${y}}`;
  }
  return `${pictureInt(p[4], 0)},${pictureInt(p[5], 0)}`;
}

function pictureCommandSummary(command: MvCommand, system: SystemData | null, language: ProductLanguage): string {
  const p = command.parameters || [];
  const text = eventEditorText(language);
  const origin = text.pictureOrigins[Number(p[2]) === 1 ? 1 : 0];
  const blendValue = pictureInt(p[9], 0);
  const blend = text.blendModes.find(([value]) => value === blendValue)?.[1] ?? String(blendValue);
  const coords = pictureCoordinatePair(system, p, language);
  const scaleX = String(pictureInt(p[6], 100));
  const scaleY = String(pictureInt(p[7], 100));
  const opacity = String(pictureInt(p[8], 255));
  if (command.code === 232) {
    const easing = text.pictureEasings[Math.max(0, Math.min(3, pictureInt(p[12], 0)))];
    const wait = p[11] ? translate('eventEditor.command.pictureWait', language) : '';
    return translate('eventEditor.command.movePicture', language, {
      id: String(pictureInt(p[0], 0)),
      easing,
      origin,
      coords,
      scaleX,
      scaleY,
      opacity,
      blend,
      duration: String(pictureInt(p[10], 0)),
      wait,
    });
  }
  return translate('eventEditor.command.showPicture', language, {
    id: String(pictureInt(p[0], 0)),
    name: String(p[1] || ''),
    origin,
    coords,
    scaleX,
    scaleY,
    opacity,
    blend,
  });
}

export function commandDisplay(command: MvCommand, system?: SystemData | null, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): CommandDisplayResult {
  language = normalizeProductLanguage(language)
  const p = command.parameters || [];
  const indent = clampInt(command.indent, 0, 12);
  const line = (label: string, tone = 'normal'): CommandDisplayResult => ({ label: `◆${label}`, tone, indent });

  if (command.code === 101) return line(translate('eventEditor.command.text', language, { face: messageFaceLabel(p, language), bg: messageBackgroundLabel(p[2], language), pos: messagePositionLabel(p[3], language) }), 'text');
  if (command.code === 401) return { label: `${translate('eventEditor.colon', language)}${p[0] || ''}`, tone: 'text', indent: Math.min(indent + 1, 12) };
  if (command.code === 102) {
    // RM-native summary: Show Choices: A, B, C (Window, Right, #1, Branch).
    // Parameter layout follows MV ([choices, cancelType, defaultType, positionType,
    // background]); MZ drops the trailing background, which then renders as the
    // default "Window" label — display-only until commandDisplay gains engine info.
    const choices = (p[0] as string[] || []).map((choice) => String(choice ?? '')).join(', ');
    const cancelType = Number.isFinite(Number(p[1])) ? Number(p[1]) : -1;
    const defaultType = Number.isFinite(Number(p[2])) ? Number(p[2]) : -1;
    const details = translate('eventEditor.command.showChoicesDetails', language, {
      background: messageBackgroundLabel(p[4], language),
      position: choicePositionLabel(p[3], language),
      default: defaultType >= 0 ? `#${defaultType + 1}` : translate('eventEditor.helper.none', language),
      cancel: cancelType === -2
        ? translate('eventEditor.command.choiceBranch', language)
        : cancelType >= 0
          ? `#${cancelType + 1}`
          : translate('eventEditor.helper.none', language),
    });
    return line(translate('eventEditor.command.showChoices', language, { choices, details }), 'control');
  }
  if (command.code === 402) return { label: `:${translate('eventEditor.command.whenChoice', language, { val: String(p[1] || p[0] || '') })}`, tone: 'text', indent };
  if (command.code === 403) return { label: `:${translate('eventEditor.command.whenCancel', language)}`, tone: 'text', indent };
  if (command.code === 404) return { label: `:${translate('eventEditor.command.endChoices', language)}`, tone: 'control', indent };
  if (command.code === 108) return line(translate('eventEditor.command.comment', language, { text: String(p[0] || '') }), 'normal');
  if (command.code === 109) return line(translate('eventEditor.command.skip', language), 'control');
  // RM branch bodies end with a placeholder code-0 row; skip-block terminators are
  // re-labelled as "End" by the list views via skipTerminatorIndices.
  if (command.code === 0) return { label: '◆', tone: 'normal', indent };
  if (command.code === 111) return line(translate('eventEditor.command.if', language, { cond: conditionBranchDisplay(system || null, p, language) }), 'text');
  if (command.code === 112) return line(translate('eventEditor.command.loop', language), 'control');
  if (command.code === 113) return line(translate('eventEditor.command.breakLoop', language), 'control');
  if (command.code === 118) return line(translate('eventEditor.command.label', language, { name: String(p[0] || '') }), 'control');
  if (command.code === 119) return line(translate('eventEditor.command.jumpLabel', language, { name: String(p[0] || '') }), 'control');
  if (command.code === 121) return line(translate('eventEditor.command.controlSwitches', language, { range: namedSystemRange(system || null, 'switches', p[0], p[1], language), val: p[2] === 1 ? 'OFF' : 'ON' }), 'control');
  if (command.code === 122) return line(translate('eventEditor.command.controlVariables', language, { range: namedSystemRange(system || null, 'variables', p[0], p[1], language) }), 'control');
  if (command.code === 123) return line(translate('eventEditor.command.controlSelfSwitch', language, { ch: String(p[0]), val: p[1] === 1 ? 'OFF' : 'ON' }), 'control');
  if (command.code === 201) return line(translate('eventEditor.command.transferPlayer', language, { mapId: String(p[1]), x: String(p[2]), y: String(p[3]) }), 'control');
  if (command.code === 205) return line(translate('eventEditor.command.setMovementRoute', language, { target: eventTargetLabel(p[0], language), suffix: (p[1] as MvMoveRoute | undefined)?.wait ? translate('eventEditor.command.waitSuffix', language) : '' }), 'control');
  if (command.code === 212) return line(translate('eventEditor.command.showAnimation', language, { target: eventTargetLabel(p[0], language), id: String(p[1] || 0) }), 'control');
  if (command.code === 213) return line(translate('eventEditor.command.showBalloonIcon', language, { target: eventTargetLabel(p[0], language), icon: balloonIconLabel(p[1], language) }), 'control');
  if (command.code === 221) return line(translate('eventEditor.command.fadeoutScreen', language), 'control');
  if (command.code === 222) return line(translate('eventEditor.command.fadeinScreen', language), 'control');
  if (command.code === 223) return line(translate('eventEditor.command.tintScreen', language, { json: JSON.stringify(p[0] || []) }), 'control');
  if (command.code === 224) return line(translate('eventEditor.command.flashScreen', language, { json: JSON.stringify(p[0] || []) }), 'control');
  if (command.code === 225) return line(translate('eventEditor.command.shakeScreen', language, { power: String(p[0] || 0) }), 'control');
  if (command.code === 230) return line(translate('eventEditor.command.wait', language, { frames: String(p[0] || 0) }), 'control');
  if (command.code === 231 || command.code === 232) return line(pictureCommandSummary(command, system || null, language), 'control');
  if (command.code === 250) return line(translate('eventEditor.command.playSE', language, { name: (p[0] as { name?: string })?.name || '' }), 'control');
  if (command.code === 125) return line(translate('eventEditor.command.changeGold', language, { sign: p[0] === 1 ? '-' : '+', amount: String(p[2] || 0) }), 'control');
  if (command.code === 314) return line(translate('eventEditor.command.recoverAll', language), 'control');
  if (command.code === 117) return line(translate('eventEditor.command.commonEvent', language, { id: String(p[0] || 0) }), 'control');
  if (command.code === 356) return line(translate('eventEditor.command.pluginCommand', language, { cmd: String(p[0] || '') }), 'control');
  if (command.code === 357) return line(translate('eventEditor.command.pluginCommand', language, { cmd: `${String(p[0] || '')}:${String(p[2] || p[1] || '')}` }), 'control');
  if (command.code === 411) return { label: `:${translate('eventEditor.command.else', language)}`, tone: 'control', indent };
  if (command.code === 412) return { label: `:${translate('eventEditor.command.branchEnd', language)}`, tone: 'control', indent };
  if (command.code === 413) return { label: `:${translate('eventEditor.command.repeatAbove', language)}`, tone: 'control', indent };
  if (command.code === 601 || command.code === 602 || command.code === 603 || command.code === 604) {
    return { label: `:${standardCommandLabel(command.code, language)}`, tone: 'control', indent };
  }
  if (command.code === 505) return { label: `${translate('eventEditor.colon', language)}◇${moveRouteCommandLabel(p[0], language)}`, tone: 'control', indent: Math.min(indent + 1, 12) };
  if (command.code === 405 || command.code === 408 || command.code === 605 || command.code === 655 || command.code === 657) return { label: `${translate('eventEditor.colon', language)}${p[0] || ''}`, tone: 'text', indent: Math.min(indent + 1, 12) };
  if (command.code === 355) return line(translate('eventEditor.command.script', language, { text: String(p[0] || '') }), 'raw');
  // ── Message ──
  if (command.code === 103) return line(translate('eventEditor.command.inputNumber', language, { var: String(Number(p[0] ?? 0) || 0), digits: String(Number(p[1] ?? 0) || 0) }), 'text');
  if (command.code === 104) return line(translate('eventEditor.command.selectItem', language, { var: String(Number(p[0] ?? 0) || 0), kind: labelAt(eventEditorText(language).selectItemTypeLabels, p[1], String(p[1] ?? 0)) }), 'text');
  if (command.code === 105) return line(translate('eventEditor.command.scrollingText', language, { speed: String(Number(p[0] ?? 0) || 0) }), 'text');
  // ── Game Progression ──
  if (command.code === 124) {
    const text = eventEditorText(language);
    const op = labelAt(text.timerOperationLabels, p[0], String(p[0] ?? 0));
    const seconds = Number(p[1] ?? 0);
    return line(translate('eventEditor.command.controlTimer', language, { op, seconds: Number.isFinite(seconds) && seconds > 0 ? translate('eventEditor.command.timerSec', language, { sec: String(seconds) }) : '' }), 'control');
  }
  // ── Party (operand commands) ──
  if (command.code === 126 || command.code === 127 || command.code === 128) {
    const text = eventEditorText(language);
    const op = labelAt(text.operationLabels, p[1], String(p[1] ?? 0));
    const amount = operandDisplay(p, 2, system || null, language);
    const idKey = command.code === 126 ? 'changeItems' : command.code === 127 ? 'changeWeapons' : 'changeArmors';
    return line(translate(`eventEditor.command.${idKey}`, language, { name: entryId(p[0], language), op, amount }), 'data');
  }
  if (command.code === 129) {
    const op = labelAt(eventEditorText(language).partyMemberOperationLabels, p[1], String(p[1] ?? 0));
    return line(translate('eventEditor.command.changePartyMember', language, { name: entryId(p[0], language), op }), 'data');
  }
  // ── Actor stat commands ──
  if (command.code === 311 || command.code === 312 || command.code === 326 || command.code === 315 || command.code === 316) {
    const text = eventEditorText(language);
    const target = actorTargetDisplay(p, language);
    const op = labelAt(text.operationLabels, p[2], String(p[2] ?? 0));
    const amount = operandDisplay(p, 3, system || null, language);
    const key = command.code === 311 ? 'changeHP' : command.code === 312 ? 'changeMP' : command.code === 326 ? 'changeTP' : command.code === 315 ? 'changeEXP' : 'changeLevel';
    return line(translate(`eventEditor.command.${key}`, language, { target, op, amount }), 'data');
  }
  if (command.code === 313 || command.code === 318) {
    const text = eventEditorText(language);
    const target = actorTargetDisplay(p, language);
    const op = labelAt(command.code === 313 ? text.stateOperationLabels : text.skillOperationLabels, p[2], String(p[2] ?? 0));
    const key = command.code === 313 ? 'changeState' : 'changeSkill';
    return line(translate(`eventEditor.command.${key}`, language, { target, op, name: entryId(p[3], language) }), 'data');
  }
  if (command.code === 317) {
    const text = eventEditorText(language);
    const target = actorTargetDisplay(p, language);
    const param = labelAt(text.actorParameterLabels, p[2], String(p[2] ?? 0));
    const op = labelAt(text.operationLabels, p[3], String(p[3] ?? 0));
    const amount = operandDisplay(p, 4, system || null, language);
    return line(translate('eventEditor.command.changeParameter', language, { target, param, op, amount }), 'data');
  }
  if (command.code === 319) return line(translate('eventEditor.command.changeEquipment', language, { actor: entryId(p[0], language), slot: labelAt(eventEditorText(language).equipSlotLabels, p[1], String(p[1] ?? 0)), item: String(Number(p[2] ?? 0) || 0) }), 'data');
  if (command.code === 320) return line(translate('eventEditor.command.changeName', language, { actor: entryId(p[0], language), name: String(p[1] ?? '') }), 'data');
  if (command.code === 321) return line(translate('eventEditor.command.changeClass', language, { actor: entryId(p[0], language), cls: String(Number(p[1] ?? 0) || 0) }), 'data');
  if (command.code === 322) return line(translate('eventEditor.command.changeActorImages', language, { actor: entryId(p[0], language), char: `${String(p[1] ?? '')}(${Number(p[2] ?? 0)})`, face: `${String(p[3] ?? '')}(${Number(p[4] ?? 0)})` }), 'data');
  if (command.code === 324) return line(translate('eventEditor.command.changeNickname', language, { actor: entryId(p[0], language), name: String(p[1] ?? '') }), 'data');
  if (command.code === 325) return line(translate('eventEditor.command.changeProfile', language, { actor: entryId(p[0], language), text: String(p[1] ?? '') }), 'data');
  // ── Movement ──
  if (command.code === 202) {
    const text = eventEditorText(language);
    const vehicle = labelAt(text.vehicleTypes, p[0], String(p[0] ?? 0));
    const variableLocation = Number(p[1] ?? 0) === 1;
    const x = variableLocation ? `{${namedSystemEntry(system || null, 'variables', p[3], language)}}` : String(Number(p[3] ?? 0) || 0);
    const y = variableLocation ? `{${namedSystemEntry(system || null, 'variables', p[4], language)}}` : String(Number(p[4] ?? 0) || 0);
    return line(translate('eventEditor.command.setVehicleLocation', language, { vehicle, x, y }), 'move');
  }
  if (command.code === 203) {
    const target = eventTargetLabel(p[0], language);
    const locType = Number(p[1] ?? 0);
    const x = locType === 0 ? String(Number(p[2] ?? 0) || 0) : `{${namedSystemEntry(system || null, 'variables', p[2], language)}}`;
    const y = locType === 0 ? String(Number(p[3] ?? 0) || 0) : `{${namedSystemEntry(system || null, 'variables', p[3], language)}}`;
    return line(translate('eventEditor.command.setEventLocation', language, { target, x, y }), 'move');
  }
  if (command.code === 204) {
    const text = eventEditorText(language);
    // Direction codes 2/4/6/8 → indices 0/1/2/3 in scrollDirections.
    const dirMap: Record<number, number> = { 2: 0, 4: 1, 6: 2, 8: 3 };
    const dir = labelAt(text.scrollDirections, dirMap[Number(p[0])] ?? -1, String(p[0] ?? 0));
    return line(translate('eventEditor.command.scrollMap', language, { dir, distance: String(Number(p[1] ?? 0) || 0), speed: String(Number(p[2] ?? 0) || 0) }), 'move');
  }
  // ── Character ──
  if (command.code === 211) return line(translate('eventEditor.command.changeTransparency', language, { val: labelAt(eventEditorText(language).onOffLabels, p[0], String(p[0] ?? 0)) }), 'stage');
  if (command.code === 216) return line(translate('eventEditor.command.changePlayerFollowers', language, { val: labelAt(eventEditorText(language).onOffLabels, p[0], String(p[0] ?? 0)) }), 'stage');
  // ── Picture ──
  if (command.code === 233) return line(translate('eventEditor.command.rotatePicture', language, { id: String(Number(p[0] ?? 0) || 0), speed: String(p[1] ?? 0) }), 'stage');
  if (command.code === 234) return line(translate('eventEditor.command.tintPicture', language, { id: String(Number(p[0] ?? 0) || 0) }), 'stage');
  if (command.code === 235) return line(translate('eventEditor.command.erasePicture', language, { id: String(Number(p[0] ?? 0) || 0) }), 'stage');
  // ── Screen ──
  if (command.code === 236) {
    const text = eventEditorText(language);
    const typeIdx = ['none', 'rain', 'storm', 'snow'].indexOf(String(p[0] ?? 'none'));
    const type = typeIdx >= 0 ? text.weatherTypes[typeIdx] : String(p[0] ?? '');
    return line(translate('eventEditor.command.setWeatherEffect', language, { type, power: String(Number(p[1] ?? 0) || 0) }), 'stage');
  }
  // ── Audio/Video ──
  if (command.code === 241) return line(translate('eventEditor.command.playBgm', language, { audio: audioSummary(p[0], language) }), 'stage');
  if (command.code === 242) return line(translate('eventEditor.command.fadeoutBgm', language, { sec: String(Number(p[0] ?? 0) || 0) }), 'stage');
  if (command.code === 245) return line(translate('eventEditor.command.playBgs', language, { audio: audioSummary(p[0], language) }), 'stage');
  if (command.code === 246) return line(translate('eventEditor.command.fadeoutBgs', language, { sec: String(Number(p[0] ?? 0) || 0) }), 'stage');
  if (command.code === 249) return line(translate('eventEditor.command.playMe', language, { audio: audioSummary(p[0], language) }), 'stage');
  if (command.code === 261) return line(translate('eventEditor.command.playMovie', language, { name: String(p[0] ?? '') }), 'stage');
  // ── Scene Control ──
  if (command.code === 301) {
    const text = eventEditorText(language);
    const src = labelAt(text.troopSourceLabels, p[0], String(p[0] ?? 0));
    const troop = p[0] === 1 ? `{${namedSystemEntry(system || null, 'variables', p[1], language)}}` : entryId(p[1], language);
    return line(translate('eventEditor.command.battleProcessing', language, { troop: `${src} ${troop}` }), 'flow');
  }
  if (command.code === 302) return line(translate('eventEditor.command.shopProcessing', language, {}), 'flow');
  if (command.code === 303) return line(translate('eventEditor.command.nameInputProcessing', language, { actor: entryId(p[0], language), max: String(Number(p[1] ?? 0) || 0) }), 'flow');
  // ── System Settings ──
  if (command.code === 132) return line(translate('eventEditor.command.changeBattleBgm', language, { audio: audioSummary(p[0], language) }), 'stage');
  if (command.code === 133) return line(translate('eventEditor.command.changeVictoryMe', language, { audio: audioSummary(p[0], language) }), 'stage');
  if (command.code === 139) return line(translate('eventEditor.command.changeDefeatMe', language, { audio: audioSummary(p[0], language) }), 'stage');
  if (command.code === 140) {
    const vehicle = labelAt(eventEditorText(language).vehicleTypes, p[0], String(p[0] ?? 0));
    return line(translate('eventEditor.command.changeVehicleBgm', language, { vehicle, audio: audioSummary(p[1], language) }), 'stage');
  }
  if (command.code === 134) return line(translate('eventEditor.command.changeSaveAccess', language, { val: labelAt(eventEditorText(language).enableDisableLabels, p[0], String(p[0] ?? 0)) }), 'control');
  if (command.code === 135) return line(translate('eventEditor.command.changeMenuAccess', language, { val: labelAt(eventEditorText(language).enableDisableLabels, p[0], String(p[0] ?? 0)) }), 'control');
  if (command.code === 136) return line(translate('eventEditor.command.changeEncounter', language, { val: labelAt(eventEditorText(language).enableDisableLabels, p[0], String(p[0] ?? 0)) }), 'control');
  if (command.code === 137) return line(translate('eventEditor.command.changeFormationAccess', language, { val: labelAt(eventEditorText(language).enableDisableLabels, p[0], String(p[0] ?? 0)) }), 'control');
  if (command.code === 138) return line(translate('eventEditor.command.changeWindowColor', language, {}), 'control');
  if (command.code === 323) return line(translate('eventEditor.command.changeVehicleImage', language, { vehicle: labelAt(eventEditorText(language).vehicleTypes, p[0], String(p[0] ?? 0)), char: `${String(p[1] ?? '')}(${Number(p[2] ?? 0)})` }), 'stage');
  // ── Map ──
  if (command.code === 281) return line(translate('eventEditor.command.changeMapNameDisplay', language, { val: labelAt(eventEditorText(language).onOffLabels, p[0], String(p[0] ?? 0)) }), 'stage');
  if (command.code === 282) return line(translate('eventEditor.command.changeTileset', language, { id: String(Number(p[0] ?? 0) || 0) }), 'stage');
  if (command.code === 283) return line(translate('eventEditor.command.changeBattleBack', language, { back: `${String(p[0] ?? '')}/${String(p[1] ?? '')}` }), 'stage');
  if (command.code === 284) return line(translate('eventEditor.command.changeParallax', language, { name: String(p[0] ?? '') }), 'stage');
  if (command.code === 285) {
    const text = eventEditorText(language);
    const locType = Number(p[2] ?? 0);
    const x = locType === 0 ? String(Number(p[3] ?? 0) || 0) : `{${namedSystemEntry(system || null, 'variables', p[3], language)}}`;
    const y = locType === 0 ? String(Number(p[4] ?? 0) || 0) : `{${namedSystemEntry(system || null, 'variables', p[4], language)}}`;
    return line(translate('eventEditor.command.getLocationInfo', language, { var: String(Number(p[0] ?? 0) || 0), kind: labelAt(text.locationInfoTypeLabels, p[1], String(p[1] ?? 0)), x, y }), 'data');
  }
  // ── Battle ──
  if (command.code === 331 || command.code === 332 || command.code === 342) {
    const text = eventEditorText(language);
    const enemy = enemyIndexDisplay(p[0], language);
    const op = labelAt(text.operationLabels, p[1], String(p[1] ?? 0));
    const amount = operandDisplay(p, 2, system || null, language);
    const key = command.code === 331 ? 'changeEnemyHP' : command.code === 332 ? 'changeEnemyMP' : 'changeEnemyTP';
    return line(translate(`eventEditor.command.${key}`, language, { enemy, op, amount }), 'data');
  }
  if (command.code === 333) {
    const text = eventEditorText(language);
    return line(translate('eventEditor.command.changeEnemyState', language, { enemy: enemyIndexDisplay(p[0], language), op: labelAt(text.stateOperationLabels, p[1], String(p[1] ?? 0)), name: entryId(p[2], language) }), 'data');
  }
  if (command.code === 334) return line(translate('eventEditor.command.enemyRecoverAll', language, { enemy: enemyIndexDisplay(p[0], language) }), 'data');
  if (command.code === 335) return line(translate('eventEditor.command.enemyAppear', language, { enemy: enemyIndexDisplay(p[0], language) }), 'data');
  if (command.code === 336) return line(translate('eventEditor.command.enemyTransform', language, { enemy: enemyIndexDisplay(p[0], language), name: entryId(p[1], language) }), 'data');
  if (command.code === 337) return line(translate('eventEditor.command.showBattleAnimation', language, { enemy: enemyIndexDisplay(p[0], language), id: String(Number(p[1] ?? 0) || 0) }), 'data');
  if (command.code === 339) {
    const text = eventEditorText(language);
    const battlerType = Number(p[0] ?? 0);
    const rawIndex = Number(p[1] ?? 0);
    const displayIndex = Number.isFinite(rawIndex) ? rawIndex + (battlerType === 0 ? 1 : 0) : 0;
    return line(translate('eventEditor.command.forceAction', language, { battler: labelAt(text.forceActionBattlerLabels, battlerType, String(p[0] ?? 0)), index: String(displayIndex), skill: String(Number(p[2] ?? 0) || 0) }), 'data');
  }
  const standardLabel = standardCommandLabel(command.code, language);
  if (!standardLabel.startsWith('Raw command ')) return line(`${standardLabel}${p.length ? `${translate('eventEditor.colon', language)} ${JSON.stringify(p)}` : ''}`, 'control');
  return line(`Raw command ${command.code}: ${JSON.stringify(p)}`, 'raw');
}

// Semantic command color categories for event-editor command headers. Keep this
// separate from commandDisplay tone because preview components depend on that
// lower-granularity tone.
const TONE_TEXT = new Set([101, 401, 102, 402, 403, 404, 405]);
const TONE_FLOW = new Set([109, 111, 112, 113, 115, 117, 119, 411, 412, 413]);
const TONE_DATA = new Set([121, 122, 123, 124, 125, 126, 127, 128, 129, 133, 311, 312, 313, 314, 315, 316, 317]);
const TONE_MOVE = new Set([201, 202, 203, 204, 205, 206, 505]);
const TONE_RAW = new Set([355, 356, 357, 655, 657]);
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

/** Shared RM-style row projection used by map, common-event, and battle lists. */
export function commandSpanDisplay(
  span: MvCommandSpan,
  system?: SystemData | null,
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
  skipTerminator = false,
  skipLabel = 'End',
): MvCommandSpanView {
  const first = span.commands[0];
  if (skipTerminator) {
    return {
      key: span.index,
      tone: commandTone(109),
      indent: Math.min(first?.indent || 0, 12),
      head: `:${skipLabel}`,
      lines: [],
      role: 'terminator',
      ...(span.structureId !== undefined ? { structureId: span.structureId } : {}),
      ...(span.branchId !== undefined ? { branchId: span.branchId } : {}),
    };
  }
  const head = commandDisplay(first, system, language);
  return {
    key: span.index,
    tone: commandTone(first.code),
    indent: head.indent,
    head: head.label,
    lines: span.commands.slice(1).map((command) => commandDisplay(command, system, language).label),
    role: span.role || 'command',
    ...(span.structureId !== undefined ? { structureId: span.structureId } : {}),
    ...(span.branchId !== undefined ? { branchId: span.branchId } : {}),
  };
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
export type QuickObtainKind = 'item' | 'weapon' | 'armor';

export function quickObtainEventTemplate(
  kind: QuickObtainKind,
  databaseId: number,
  quantity: number,
  x: number,
  y: number,
  name = '',
): MvEditorEvent {
  if (!Number.isInteger(databaseId) || databaseId <= 0) throw new Error('The obtain event database ID must be a positive integer');
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('The obtain event quantity must be a positive integer');
  const commandCode = kind === 'item' ? 126 : kind === 'weapon' ? 127 : 128;
  const event = defaultEvent(0, x, y);
  event.name = name;
  const page = event.pages[0];
  page.trigger = 0;
  page.priorityType = 1;
  page.image = defaultImage();
  page.list = [
    { code: commandCode, indent: 0, parameters: [databaseId, 0, 0, quantity, ...(commandCode === 126 ? [] : [false])] },
    { code: 0, indent: 0, parameters: [] },
  ];
  return event;
}

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
