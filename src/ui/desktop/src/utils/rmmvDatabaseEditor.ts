import {
  MV_ANIMATION_CELL_FIELDS,
  MV_CLASS_PARAM_COUNT,
  MV_CLASS_PARAM_ROW_LENGTH,
  MV_TERMS_MESSAGE_LABELS,
  databaseSummaryText,
} from './rmmvDatabaseLocalization.ts';
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { cloneDraft } from './clone-draft.ts';
import { classParameterValueRange } from './rmmvDatabaseSemantics.ts';

export {
  MV_ANIMATION_BLEND_MODES,
  MV_ANIMATION_CELL_FIELDS,
  MV_ANIMATION_FLASH_SCOPES,
  MV_CLASS_PARAM_LEVELS,
  MV_CLASS_PARAM_COUNT,
  MV_CLASS_PARAM_ROW_LENGTH,
  MV_TERMS_MESSAGE_LABELS,
  MV_TROOP_PAGE_SPANS,
} from './rmmvDatabaseLocalization.ts';

export const MV_ZERO_RESERVED_LIST_PATHS = new Set([
  'switches',
  'variables',
  'elements',
  'skillTypes',
  'weaponTypes',
  'armorTypes',
  'equipTypes',
]);

export const MV_TERMS_LIST_PATHS = new Set([
  'basic',
  'params',
  'commands',
]);

export const MV_TERMS_SLOT_COUNTS = {
  basic: 10,
  params: 10,
  commands: 24,
} as const;

export function cloneDatabaseEditorRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneDraft(value);
}

export type MvTermsArrayPath = keyof typeof MV_TERMS_SLOT_COUNTS;

export function termsArraySlotCount(path: string, value?: unknown): number {
  const base = MV_TERMS_SLOT_COUNTS[path as MvTermsArrayPath] ?? 0;
  const actual = Array.isArray(value) ? value.length : 0;
  return Math.max(base, actual);
}

export function normalizeTermsArray(value: unknown, path: string): string[] {
  const list = Array.isArray(value) ? value.map((entry) => String(entry ?? '')) : [];
  const target = termsArraySlotCount(path, list);
  while (list.length < target) list.push('');
  return list;
}

export interface MvTroopPageConditions {
  turnEnding: boolean;
  turnValid: boolean;
  enemyValid: boolean;
  actorValid: boolean;
  switchValid: boolean;
  turnA: number;
  turnB: number;
  enemyIndex: number;
  enemyHp: number;
  actorId: number;
  actorHp: number;
  switchId: number;
}

export interface MvAnimationSe extends Record<string, unknown> {
  name: string;
  volume: number;
  pitch: number;
  pan: number;
}

export interface MvAnimationTiming extends Record<string, unknown> {
  frame: number;
  se: MvAnimationSe;
  flashScope: number;
  flashColor: number[];
  flashDuration: number;
}

export interface MzAnimationRotation extends Record<string, unknown> {
  x: number;
  y: number;
  z: number;
}

export interface MzAnimationFlashTiming extends Record<string, unknown> {
  frame: number;
  duration: number;
  color: number[];
}

export interface MzAnimationSoundTiming extends Record<string, unknown> {
  frame: number;
  se: MvAnimationSe;
}

export interface MvTroopMember extends Record<string, unknown> {
  enemyId: number;
  x: number;
  y: number;
  hidden: boolean;
}

export interface MvEnemyAction extends Record<string, unknown> {
  skillId: number;
  conditionType: number;
  conditionParam1: number;
  conditionParam2: number;
  rating: number;
}

export const MV_ENEMY_ACTION_CONDITION_TYPES = [0, 1, 2, 3, 4, 5, 6] as const;

export function isStandardEnemyActionConditionType(value: unknown): value is typeof MV_ENEMY_ACTION_CONDITION_TYPES[number] {
  return Number.isInteger(value) && MV_ENEMY_ACTION_CONDITION_TYPES.includes(value as typeof MV_ENEMY_ACTION_CONDITION_TYPES[number]);
}

export function setEnemyActionConditionType(
  action: unknown,
  conditionType: number,
  references: { stateId?: number; switchId?: number } = {},
): MvEnemyAction {
  const source = normalizeEnemyAction(action);
  if (!isStandardEnemyActionConditionType(conditionType)) return source;
  let conditionParam1 = 0;
  let conditionParam2 = 0;
  if (conditionType === 2 || conditionType === 3) conditionParam2 = 1;
  if (conditionType === 4) conditionParam1 = requirePositiveReference(references.stateId, 'state');
  if (conditionType === 5) conditionParam1 = 1;
  if (conditionType === 6) conditionParam1 = requirePositiveReference(references.switchId, 'switch');
  return { ...source, conditionType, conditionParam1, conditionParam2 };
}

export function setEnemyActionConditionParameter(
  action: unknown,
  parameter: 1 | 2,
  value: unknown,
): MvEnemyAction {
  const source = normalizeEnemyAction(action);
  const key = parameter === 1 ? 'conditionParam1' : 'conditionParam2';
  let normalized: number;
  if (source.conditionType === 2 || source.conditionType === 3) {
    normalized = clampInteger(value, 0, 100) / 100;
  } else if (source.conditionType === 5) {
    normalized = clampInteger(value, 1, 99, 1);
  } else {
    normalized = Math.max(0, toInteger(value, 0));
  }
  return { ...source, [key]: normalized };
}

export function enemyActionConditionPercentage(action: unknown, parameter: 1 | 2): number {
  const source = normalizeEnemyAction(action);
  const ratio = parameter === 1 ? source.conditionParam1 : source.conditionParam2;
  return Math.round(ratio * 100);
}

export function normalizeEnemyAction(action: unknown): MvEnemyAction {
  const source = action && typeof action === 'object' && !Array.isArray(action)
    ? action as Record<string, unknown>
    : {};
  return {
    ...source,
    skillId: finiteNumber(source.skillId, 1),
    conditionType: finiteNumber(source.conditionType, 0),
    conditionParam1: finiteNumber(source.conditionParam1, 0),
    conditionParam2: finiteNumber(source.conditionParam2, 0),
    rating: finiteNumber(source.rating, 5),
  };
}

export function alignTroopMembers(value: unknown): MvTroopMember[] {
  const members = normalizeTroopMembers(value);
  const count = members.length;
  if (count === 0) return members;
  const spacing = count === 1 ? 0 : Math.min(144, 640 / (count - 1));
  return members.map((member, index) => ({
    ...member,
    x: Math.round(408 + (index - (count - 1) / 2) * spacing),
    y: 436,
  }));
}

export function autoNameTroop(
  value: unknown,
  enemies: readonly { id: number; name: string }[],
): string {
  const members = normalizeTroopMembers(value);
  const names = new Map(enemies.map((enemy) => [enemy.id, enemy.name]));
  const order: number[] = [];
  const counts = new Map<number, number>();
  for (const member of members) {
    if (!names.has(member.enemyId)) throw new Error(`Missing enemy reference #${member.enemyId}.`);
    if (!counts.has(member.enemyId)) order.push(member.enemyId);
    counts.set(member.enemyId, (counts.get(member.enemyId) || 0) + 1);
  }
  return order.map((enemyId) => {
    const name = names.get(enemyId)!;
    const count = counts.get(enemyId)!;
    return count > 1 ? `${name}*${count}` : name;
  }).join(', ');
}

export function normalizeTroopMembers(value: unknown): MvTroopMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const member = entry as Record<string, unknown>;
    return [{
      ...member,
      enemyId: finiteNumber(member.enemyId, 0),
      x: finiteNumber(member.x, 408),
      y: finiteNumber(member.y, 436),
      hidden: Boolean(member.hidden),
    }];
  });
}

export function standardBlankTroopPage(): Record<string, unknown> {
  return {
    conditions: normalizeTroopPageConditions({}),
    list: [{ code: 0, indent: 0, parameters: [] }],
    span: 0,
  };
}

export function isMvStringListField(group: string | undefined, path: string): boolean {
  if (group === 'System') return MV_ZERO_RESERVED_LIST_PATHS.has(path);
  if (group === 'Types') return MV_ZERO_RESERVED_LIST_PATHS.has(path);
  if (group === 'Terms') return MV_TERMS_LIST_PATHS.has(path);
  return false;
}

export function stringListHasReservedZero(group: string | undefined, path: string): boolean {
  return (group === 'System' || group === 'Types') && MV_ZERO_RESERVED_LIST_PATHS.has(path);
}

export function normalizeStringList(value: unknown, reserveZero: boolean): string[] {
  const list = Array.isArray(value) ? value.map((entry) => String(entry ?? '')) : [];
  if (reserveZero && list.length === 0) return [''];
  if (reserveZero && list[0] !== '') return ['', ...list];
  return list;
}

export function setStringListItem(value: unknown, index: number, text: string, reserveZero: boolean): string[] {
  const list = normalizeStringList(value, reserveZero);
  if (reserveZero && index === 0) {
    list[0] = '';
    return list;
  }
  while (list.length <= index) list.push('');
  list[index] = text;
  return list;
}

export function appendStringListItem(value: unknown, reserveZero: boolean): string[] {
  return [...normalizeStringList(value, reserveZero), ''];
}

export function canRemoveStringListItem(value: unknown, index: number, reserveZero: boolean): boolean {
  const list = normalizeStringList(value, reserveZero);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return false;
  if (!reserveZero) return true;
  return index > 0 && index === list.length - 1;
}

export function removeStringListItem(value: unknown, index: number, reserveZero: boolean): string[] {
  const list = normalizeStringList(value, reserveZero);
  if (reserveZero && index === 0) return list;
  const next = list.filter((_entry, entryIndex) => entryIndex !== index);
  if (reserveZero && next.length === 0) return [''];
  return next;
}

export function sortedTermsMessageKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort((a, b) => {
    const knownA = Object.prototype.hasOwnProperty.call(MV_TERMS_MESSAGE_LABELS, a);
    const knownB = Object.prototype.hasOwnProperty.call(MV_TERMS_MESSAGE_LABELS, b);
    if (knownA !== knownB) return knownA ? -1 : 1;
    return a.localeCompare(b);
  });
}

export function normalizeClassParamCurves(value: unknown): number[][] {
  const rows = Array.isArray(value) ? value : [];
  return Array.from({ length: MV_CLASS_PARAM_COUNT }, (_row, paramIndex) => {
    const source = Array.isArray(rows[paramIndex]) ? rows[paramIndex] as unknown[] : [];
    return Array.from({ length: MV_CLASS_PARAM_ROW_LENGTH }, (_level, level) => (
      level === 0 ? 0 : toInteger(source[level], 0)
    ));
  });
}

export function setClassParamCurveLevel(
  value: unknown,
  paramIndex: number,
  level: number,
  amount: number,
): number[][] {
  const rows = mutableClassParamCurves(value);
  if (!isValidParamIndex(paramIndex) || !isValidClassLevel(level)) return rows;
  const range = classParameterValueRange(paramIndex);
  rows[paramIndex][level] = clampInteger(amount, range.minimum, range.maximum, range.minimum);
  return rows;
}

export function applyClassParamLinearCurve(
  value: unknown,
  paramIndex: number,
  startLevel: number,
  endLevel: number,
  startValue: number,
  endValue: number,
): number[][] {
  const rows = mutableClassParamCurves(value);
  if (!isValidParamIndex(paramIndex)) return rows;
  const range = classParameterValueRange(paramIndex);
  const first = clampInteger(startLevel, 1, 99);
  const last = clampInteger(endLevel, 1, 99);
  const from = Math.min(first, last);
  const to = Math.max(first, last);
  const fromValue = clampInteger(first <= last ? startValue : endValue, range.minimum, range.maximum, range.minimum);
  const toValue = clampInteger(first <= last ? endValue : startValue, range.minimum, range.maximum, fromValue);
  const span = Math.max(1, to - from);
  for (let level = from; level <= to; level += 1) {
    const ratio = to === from ? 0 : (level - from) / span;
    rows[paramIndex][level] = clampInteger(
      Math.round(fromValue + (toValue - fromValue) * ratio),
      range.minimum,
      range.maximum,
      range.minimum,
    );
  }
  return rows;
}

export function normalizeTroopPageConditions(value: unknown): MvTroopPageConditions {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    turnEnding: Boolean(source.turnEnding),
    turnValid: Boolean(source.turnValid),
    enemyValid: Boolean(source.enemyValid),
    actorValid: Boolean(source.actorValid),
    switchValid: Boolean(source.switchValid),
    turnA: toInteger(source.turnA, 0),
    turnB: toInteger(source.turnB, 0),
    enemyIndex: toInteger(source.enemyIndex, 0),
    enemyHp: clampInteger(source.enemyHp, 0, 100, 50),
    actorId: toInteger(source.actorId, 1),
    actorHp: clampInteger(source.actorHp, 0, 100, 50),
    switchId: toInteger(source.switchId, 1),
  };
}

export function setTroopPageCondition(page: unknown, key: keyof MvTroopPageConditions, value: unknown): Record<string, unknown> {
  const source = page && typeof page === 'object' && !Array.isArray(page) ? page as Record<string, unknown> : {};
  const conditions = normalizeTroopPageConditions(source.conditions);
  const next = normalizeTroopConditionValue(key, value);
  return { ...source, conditions: { ...conditions, [key]: next } };
}

export function setTroopPageSpan(page: unknown, span: unknown): Record<string, unknown> {
  const source = page && typeof page === 'object' && !Array.isArray(page) ? page as Record<string, unknown> : {};
  return { ...source, span: clampInteger(span, 0, 2, 0) };
}

export function troopPageConditionSummary(value: unknown, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string[] {
  language = normalizeProductLanguage(language);
  const conditions = normalizeTroopPageConditions(value);
  const summary = databaseSummaryText(language);
  const result: string[] = [];
  if (conditions.turnEnding) result.push(summary.turnEnding);
  if (conditions.turnValid) result.push(`${summary.turn} ${conditions.turnA}+${conditions.turnB}X`);
  if (conditions.enemyValid) result.push(`${summary.enemy} #${conditions.enemyIndex + 1} HP <= ${conditions.enemyHp}%`);
  if (conditions.actorValid) result.push(`${summary.actor} #${conditions.actorId} HP <= ${conditions.actorHp}%`);
  if (conditions.switchValid) result.push(`${summary.switch} #${conditions.switchId} ON`);
  return result;
}

export function summarizeMvCommand(command: unknown, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language);
  const summary = databaseSummaryText(language);
  if (!command || typeof command !== 'object' || Array.isArray(command)) return summary.malformedCommand;
  const record = command as Record<string, unknown>;
  const code = toInteger(record.code, 0);
  const indent = toInteger(record.indent, 0);
  const params = Array.isArray(record.parameters) ? record.parameters : [];
  return `${'  '.repeat(Math.max(0, indent))}code ${code} · ${params.length} ${summary.parameterCount}`;
}

export function summarizeMvCommandList(value: unknown, limit = 8, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string[] {
  language = normalizeProductLanguage(language);
  const summary = databaseSummaryText(language);
  if (!Array.isArray(value)) return [summary.malformedCommandList];
  if (!value.length) return [summary.emptyCommandList];
  return value.slice(0, limit).map((command) => summarizeMvCommand(command, language))
    .concat(value.length > limit ? [`${summary.remainingPrefix} ${value.length - limit} ${summary.remainingSuffix}`] : []);
}

export function normalizeAnimationFrameCell(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  const result = [...source] as number[];
  result[0] = clampInteger(source[0], -1, 199, 0);
  result[1] = clampInteger(source[1], -408, 408, 0);
  result[2] = clampInteger(source[2], -312, 312, 0);
  result[3] = clampInteger(source[3], 20, 800, 100);
  result[4] = clampInteger(source[4], -360, 360, 0);
  result[5] = clampInteger(source[5], 0, 1, 0);
  result[6] = clampInteger(source[6], 0, 255, 255);
  result[7] = clampInteger(source[7], 0, 3, 0);
  return result;
}

export function normalizeAnimationFrames(value: unknown): number[][][] {
  if (!Array.isArray(value)) return [];
  return value.map((frame) => (
    Array.isArray(frame) ? frame.map(normalizeAnimationFrameCell) : []
  ));
}

export function setAnimationFrameCellValue(
  value: unknown,
  frameIndex: number,
  cellIndex: number,
  fieldIndex: number,
  amount: number,
): number[][][] {
  const frames = mutableAnimationFrames(value);
  if (frameIndex < 0 || cellIndex < 0 || fieldIndex < 0 || fieldIndex >= MV_ANIMATION_CELL_FIELDS.length) return frames;
  while (frames.length <= frameIndex) frames.push([]);
  while (frames[frameIndex].length <= cellIndex) frames[frameIndex].push(defaultAnimationCell());
  frames[frameIndex][cellIndex][fieldIndex] = normalizeAnimationCellField(fieldIndex, amount);
  return frames;
}

export function appendAnimationFrame(value: unknown): number[][][] {
  const frames = mutableAnimationFrames(value);
  if (frames.length >= 200) return frames;
  return [...frames, [defaultAnimationCell()]];
}

export function duplicateAnimationFrame(value: unknown, frameIndex: number): number[][][] {
  const frames = mutableAnimationFrames(value);
  if (frames.length >= 200 || frameIndex < 0 || frameIndex >= frames.length) return frames;
  frames.splice(frameIndex + 1, 0, cloneDraft(frames[frameIndex]));
  return frames;
}

export function removeAnimationFrame(value: unknown, frameIndex: number): number[][][] {
  const frames = mutableAnimationFrames(value);
  if (frameIndex < 0 || frameIndex >= frames.length) return frames;
  frames.splice(frameIndex, 1);
  return frames;
}

export function appendAnimationFrameCell(value: unknown, frameIndex: number): number[][][] {
  const frames = mutableAnimationFrames(value);
  if (frameIndex < 0) return frames;
  while (frames.length <= frameIndex) frames.push([]);
  if (frames[frameIndex].length >= 16) return frames;
  frames[frameIndex] = [...frames[frameIndex], defaultAnimationCell()];
  return frames;
}

export function removeAnimationFrameCell(value: unknown, frameIndex: number, cellIndex: number): number[][][] {
  const frames = mutableAnimationFrames(value);
  if (frameIndex < 0 || frameIndex >= frames.length) return frames;
  frames[frameIndex] = frames[frameIndex].filter((_cell, index) => index !== cellIndex);
  return frames;
}

export function animationFramesSummary(value: unknown, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language);
  const frames = normalizeAnimationFrames(value);
  const summary = databaseSummaryText(language);
  const maxCells = frames.reduce((max, frame) => Math.max(max, frame.length), 0);
  return `${frames.length} ${summary.frameCount} · ${summary.maxCellsPerFrame} ${maxCells} ${summary.cellCount}`;
}

export function normalizeAnimationTiming(value: unknown): MvAnimationTiming {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const se = source.se && typeof source.se === 'object' && !Array.isArray(source.se)
    ? source.se as Record<string, unknown>
    : {};
  const color = Array.isArray(source.flashColor) ? source.flashColor : [];
  const flashColor = [...color] as number[];
  flashColor[0] = clampInteger(color[0], 0, 255, 255);
  flashColor[1] = clampInteger(color[1], 0, 255, 255);
  flashColor[2] = clampInteger(color[2], 0, 255, 255);
  flashColor[3] = clampInteger(color[3], 0, 255, 255);
  return {
    ...source,
    frame: Math.max(0, toInteger(source.frame, 0)),
    se: {
      ...se,
      name: String(se.name ?? ''),
      volume: clampInteger(se.volume, 0, 100, 90),
      pitch: clampInteger(se.pitch, 50, 150, 100),
      pan: clampInteger(se.pan, -100, 100, 0),
    },
    flashScope: clampInteger(source.flashScope, 0, 3, 0),
    flashColor,
    flashDuration: clampInteger(source.flashDuration, 1, 200, 5),
  };
}

export function normalizeAnimationTimings(value: unknown): MvAnimationTiming[] {
  return Array.isArray(value) ? value.map(normalizeAnimationTiming) : [];
}

export function appendAnimationTiming(value: unknown): MvAnimationTiming[] {
  return [...normalizeAnimationTimings(value), normalizeAnimationTiming({})];
}

export function removeAnimationTiming(value: unknown, index: number): MvAnimationTiming[] {
  const timings = normalizeAnimationTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  timings.splice(index, 1);
  return timings;
}

export function setAnimationTimingValue(value: unknown, index: number, key: keyof Omit<MvAnimationTiming, 'se' | 'flashColor'>, nextValue: unknown): MvAnimationTiming[] {
  const timings = normalizeAnimationTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  const current = timings[index];
  timings[index] = {
    ...current,
    [key]: key === 'flashScope'
      ? clampInteger(nextValue, 0, 3, current.flashScope)
      : key === 'flashDuration'
        ? clampInteger(nextValue, 1, 200, current.flashDuration)
        : Math.max(0, toInteger(nextValue, Number(current[key]) || 0)),
  };
  return timings;
}

export function setAnimationTimingSeValue(value: unknown, index: number, key: keyof MvAnimationTiming['se'], nextValue: unknown): MvAnimationTiming[] {
  const timings = normalizeAnimationTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  const current = timings[index];
  const numeric = key === 'volume'
    ? clampInteger(nextValue, 0, 100, current.se.volume)
    : key === 'pitch'
      ? clampInteger(nextValue, 50, 150, current.se.pitch)
      : key === 'pan'
        ? clampInteger(nextValue, -100, 100, current.se.pan)
        : undefined;
  timings[index] = {
    ...current,
    se: {
      ...current.se,
      [key]: key === 'name' ? String(nextValue ?? '') : numeric,
    },
  };
  return timings;
}

export function setAnimationTimingFlashColor(value: unknown, index: number, colorIndex: number, nextValue: unknown): MvAnimationTiming[] {
  const timings = normalizeAnimationTimings(value);
  if (index < 0 || index >= timings.length || colorIndex < 0 || colorIndex > 3) return timings;
  const color = [...timings[index].flashColor];
  color[colorIndex] = clampInteger(nextValue, 0, 255, color[colorIndex]);
  timings[index] = { ...timings[index], flashColor: color };
  return timings;
}

export function normalizeMzAnimationRotation(value: unknown): MzAnimationRotation {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    ...source,
    x: clampInteger(source.x, -360, 360, 0),
    y: clampInteger(source.y, -360, 360, 0),
    z: clampInteger(source.z, -360, 360, 0),
  };
}

export function setMzAnimationRotationAxis(
  value: unknown,
  axis: 'x' | 'y' | 'z',
  nextValue: unknown,
): MzAnimationRotation {
  const rotation = normalizeMzAnimationRotation(value);
  return { ...rotation, [axis]: clampInteger(nextValue, -360, 360, rotation[axis]) };
}

export function normalizeMzAnimationFlashTiming(value: unknown): MzAnimationFlashTiming {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sourceColor = Array.isArray(source.color) ? source.color : [];
  return {
    ...source,
    frame: clampInteger(source.frame, 0, 99999, 0),
    duration: clampInteger(source.duration, 1, 99999, 30),
    color: Array.from({ length: 4 }, (_entry, index) => clampInteger(sourceColor[index], 0, 255, 255)),
  };
}

export function normalizeMzAnimationFlashTimings(value: unknown): MzAnimationFlashTiming[] {
  return Array.isArray(value) ? value.map(normalizeMzAnimationFlashTiming) : [];
}

export function appendMzAnimationFlashTiming(value: unknown): MzAnimationFlashTiming[] {
  return [...normalizeMzAnimationFlashTimings(value), normalizeMzAnimationFlashTiming({})];
}

export function removeMzAnimationFlashTiming(value: unknown, index: number): MzAnimationFlashTiming[] {
  const timings = normalizeMzAnimationFlashTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  timings.splice(index, 1);
  return timings;
}

export function setMzAnimationFlashTimingValue(
  value: unknown,
  index: number,
  key: 'frame' | 'duration',
  nextValue: unknown,
): MzAnimationFlashTiming[] {
  const timings = normalizeMzAnimationFlashTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  const current = timings[index];
  timings[index] = {
    ...current,
    [key]: key === 'duration'
      ? clampInteger(nextValue, 1, 99999, current.duration)
      : clampInteger(nextValue, 0, 99999, current.frame),
  };
  return timings;
}

export function setMzAnimationFlashTimingColor(
  value: unknown,
  index: number,
  colorIndex: number,
  nextValue: unknown,
): MzAnimationFlashTiming[] {
  const timings = normalizeMzAnimationFlashTimings(value);
  if (index < 0 || index >= timings.length || colorIndex < 0 || colorIndex > 3) return timings;
  const color = [...timings[index].color];
  color[colorIndex] = clampInteger(nextValue, 0, 255, color[colorIndex]);
  timings[index] = { ...timings[index], color };
  return timings;
}

export function normalizeMzAnimationSoundTiming(value: unknown): MzAnimationSoundTiming {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sourceSe = source.se && typeof source.se === 'object' && !Array.isArray(source.se)
    ? source.se as Record<string, unknown>
    : {};
  return {
    ...source,
    frame: clampInteger(source.frame, 0, 99999, 0),
    se: {
      ...sourceSe,
      name: String(sourceSe.name ?? ''),
      volume: clampInteger(sourceSe.volume, 0, 100, 90),
      pitch: clampInteger(sourceSe.pitch, 50, 150, 100),
      pan: clampInteger(sourceSe.pan, -100, 100, 0),
    },
  };
}

export function normalizeMzAnimationSoundTimings(value: unknown): MzAnimationSoundTiming[] {
  return Array.isArray(value) ? value.map(normalizeMzAnimationSoundTiming) : [];
}

export function appendMzAnimationSoundTiming(value: unknown): MzAnimationSoundTiming[] {
  return [...normalizeMzAnimationSoundTimings(value), normalizeMzAnimationSoundTiming({})];
}

export function removeMzAnimationSoundTiming(value: unknown, index: number): MzAnimationSoundTiming[] {
  const timings = normalizeMzAnimationSoundTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  timings.splice(index, 1);
  return timings;
}

export function setMzAnimationSoundTimingFrame(value: unknown, index: number, nextValue: unknown): MzAnimationSoundTiming[] {
  const timings = normalizeMzAnimationSoundTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  timings[index] = {
    ...timings[index],
    frame: clampInteger(nextValue, 0, 99999, timings[index].frame),
  };
  return timings;
}

export function setMzAnimationSoundTimingSeValue(
  value: unknown,
  index: number,
  key: 'name' | 'volume' | 'pitch' | 'pan',
  nextValue: unknown,
): MzAnimationSoundTiming[] {
  const timings = normalizeMzAnimationSoundTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  const current = timings[index];
  const next = key === 'name'
    ? String(nextValue ?? '')
    : key === 'volume'
      ? clampInteger(nextValue, 0, 100, current.se.volume)
      : key === 'pitch'
        ? clampInteger(nextValue, 50, 150, current.se.pitch)
        : clampInteger(nextValue, -100, 100, current.se.pan);
  timings[index] = { ...current, se: { ...current.se, [key]: next } };
  return timings;
}

function isValidParamIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MV_CLASS_PARAM_COUNT;
}

function mutableClassParamCurves(value: unknown): number[][] {
  const rows = cloneDraft(Array.isArray(value) ? value : []) as unknown[];
  while (rows.length < MV_CLASS_PARAM_COUNT) rows.push([]);
  for (let paramIndex = 0; paramIndex < MV_CLASS_PARAM_COUNT; paramIndex += 1) {
    const row = Array.isArray(rows[paramIndex]) ? [...rows[paramIndex] as unknown[]] : [];
    while (row.length < MV_CLASS_PARAM_ROW_LENGTH) row.push(0);
    if (row[0] === undefined) row[0] = 0;
    rows[paramIndex] = row;
  }
  return rows as number[][];
}

function mutableAnimationFrames(value: unknown): number[][][] {
  const frames = cloneDraft(Array.isArray(value) ? value : []) as unknown[];
  return frames.map((frame) => {
    if (!Array.isArray(frame)) return [];
    return frame.map((cell) => Array.isArray(cell) ? [...cell] : defaultAnimationCell());
  }) as number[][][];
}

function isValidClassLevel(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 99;
}

function normalizeTroopConditionValue(key: keyof MvTroopPageConditions, value: unknown): boolean | number {
  if (key === 'turnEnding' || key === 'turnValid' || key === 'enemyValid' || key === 'actorValid' || key === 'switchValid') {
    return Boolean(value);
  }
  if (key === 'actorHp' || key === 'enemyHp') return clampInteger(value, 0, 100, 50);
  if (key === 'enemyIndex') return Math.max(0, toInteger(value, 0));
  if (key === 'actorId' || key === 'switchId') return Math.max(1, toInteger(value, 1));
  return Math.max(0, toInteger(value, 0));
}

function defaultAnimationCell(): number[] {
  return [0, 0, 0, 100, 0, 0, 255, 0];
}

function normalizeAnimationCellField(fieldIndex: number, amount: unknown): number {
  if (fieldIndex === 0) return clampInteger(amount, -1, 199, 0);
  if (fieldIndex === 1) return clampInteger(amount, -408, 408, 0);
  if (fieldIndex === 2) return clampInteger(amount, -312, 312, 0);
  if (fieldIndex === 3) return clampInteger(amount, 20, 800, 100);
  if (fieldIndex === 4) return clampInteger(amount, -360, 360, 0);
  if (fieldIndex === 5) return clampInteger(amount, 0, 1, 0);
  if (fieldIndex === 6) return clampInteger(amount, 0, 255, 255);
  if (fieldIndex === 7) return clampInteger(amount, 0, 3, 0);
  return toInteger(amount, 0);
}

function requirePositiveReference(value: unknown, label: string): number {
  const reference = toInteger(value, 0);
  if (reference <= 0) throw new Error(`A ${label} reference is required for this condition.`);
  return reference;
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, toInteger(value, fallback)));
}
