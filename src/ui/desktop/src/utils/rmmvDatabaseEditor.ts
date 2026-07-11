import {
  MV_ANIMATION_CELL_FIELDS,
  MV_CLASS_PARAM_COUNT,
  MV_CLASS_PARAM_ROW_LENGTH,
  MV_TERMS_MESSAGE_LABELS,
  databaseSummaryText,
} from './rmmvDatabaseLocalization';
import type { ProductLanguage } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts';
import { cloneDraft } from './clone-draft';

export {
  MV_ANIMATION_BLEND_MODES,
  MV_ANIMATION_CELL_FIELDS,
  MV_ANIMATION_FLASH_SCOPES,
  MV_CLASS_PARAM_LEVELS,
  MV_CLASS_PARAM_COUNT,
  MV_CLASS_PARAM_ROW_LENGTH,
  MV_TERMS_MESSAGE_LABELS,
  MV_TROOP_PAGE_SPANS,
} from './rmmvDatabaseLocalization';

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

export interface MvAnimationTiming {
  frame: number;
  se: {
    name: string;
    volume: number;
    pitch: number;
    pan: number;
  };
  flashScope: number;
  flashColor: number[];
  flashDuration: number;
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
  const rows = normalizeClassParamCurves(value);
  if (!isValidParamIndex(paramIndex) || !isValidClassLevel(level)) return rows;
  rows[paramIndex][level] = toInteger(amount, 0);
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
  const rows = normalizeClassParamCurves(value);
  if (!isValidParamIndex(paramIndex)) return rows;
  const first = clampInteger(startLevel, 1, 99);
  const last = clampInteger(endLevel, 1, 99);
  const from = Math.min(first, last);
  const to = Math.max(first, last);
  const fromValue = toInteger(first <= last ? startValue : endValue, 0);
  const toValue = toInteger(first <= last ? endValue : startValue, fromValue);
  const span = Math.max(1, to - from);
  for (let level = from; level <= to; level += 1) {
    const ratio = to === from ? 0 : (level - from) / span;
    rows[paramIndex][level] = Math.round(fromValue + (toValue - fromValue) * ratio);
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
  return [
    toInteger(source[0], 0),
    toInteger(source[1], 0),
    toInteger(source[2], 0),
    toInteger(source[3], 100),
    toInteger(source[4], 0),
    clampInteger(source[5], 0, 1, 0),
    clampInteger(source[6], 0, 255, 255),
    clampInteger(source[7], 0, 3, 0),
  ];
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
  const frames = normalizeAnimationFrames(value);
  if (frameIndex < 0 || cellIndex < 0 || fieldIndex < 0 || fieldIndex >= MV_ANIMATION_CELL_FIELDS.length) return frames;
  while (frames.length <= frameIndex) frames.push([]);
  while (frames[frameIndex].length <= cellIndex) frames[frameIndex].push(defaultAnimationCell());
  frames[frameIndex][cellIndex][fieldIndex] = normalizeAnimationCellField(fieldIndex, amount);
  return frames;
}

export function appendAnimationFrame(value: unknown): number[][][] {
  return [...normalizeAnimationFrames(value), [defaultAnimationCell()]];
}

export function appendAnimationFrameCell(value: unknown, frameIndex: number): number[][][] {
  const frames = normalizeAnimationFrames(value);
  if (frameIndex < 0) return frames;
  while (frames.length <= frameIndex) frames.push([]);
  frames[frameIndex] = [...frames[frameIndex], defaultAnimationCell()];
  return frames;
}

export function removeAnimationFrameCell(value: unknown, frameIndex: number, cellIndex: number): number[][][] {
  const frames = normalizeAnimationFrames(value);
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
  return {
    frame: toInteger(source.frame, 0),
    se: {
      name: String(se.name ?? ''),
      volume: clampInteger(se.volume, 0, 100, 90),
      pitch: clampInteger(se.pitch, 50, 150, 100),
      pan: clampInteger(se.pan, -100, 100, 0),
    },
    flashScope: clampInteger(source.flashScope, 0, 3, 0),
    flashColor: [
      clampInteger(color[0], 0, 255, 255),
      clampInteger(color[1], 0, 255, 255),
      clampInteger(color[2], 0, 255, 255),
      clampInteger(color[3], 0, 255, 255),
    ],
    flashDuration: Math.max(0, toInteger(source.flashDuration, 5)),
  };
}

export function normalizeAnimationTimings(value: unknown): MvAnimationTiming[] {
  return Array.isArray(value) ? value.map(normalizeAnimationTiming) : [];
}

export function appendAnimationTiming(value: unknown): MvAnimationTiming[] {
  return [...normalizeAnimationTimings(value), normalizeAnimationTiming({})];
}

export function setAnimationTimingValue(value: unknown, index: number, key: keyof Omit<MvAnimationTiming, 'se' | 'flashColor'>, nextValue: unknown): MvAnimationTiming[] {
  const timings = normalizeAnimationTimings(value);
  if (index < 0 || index >= timings.length) return timings;
  const current = timings[index];
  timings[index] = {
    ...current,
    [key]: key === 'flashScope'
      ? clampInteger(nextValue, 0, 3, current.flashScope)
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

function isValidParamIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MV_CLASS_PARAM_COUNT;
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
  if (fieldIndex === 3) return Math.max(0, toInteger(amount, 100));
  if (fieldIndex === 5) return clampInteger(amount, 0, 1, 0);
  if (fieldIndex === 6) return clampInteger(amount, 0, 255, 255);
  if (fieldIndex === 7) return clampInteger(amount, 0, 3, 0);
  return toInteger(amount, 0);
}

function toInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, toInteger(value, fallback)));
}
