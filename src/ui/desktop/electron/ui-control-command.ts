/** Pure UI-control command normalization (no Electron imports). */

export type UiControlCommandType =
  | 'capture-current'
  | 'navigate'
  | 'open-event-editor'
  | 'state'
  | 'click'
  | 'pointer'
  | 'input'
  | 'key'
  | 'read'
  | 'wait';

export type UiControlWaitCondition = 'present' | 'visible' | 'hidden' | 'enabled' | 'disabled' | 'text' | 'value';

export interface UiControlCommand {
  type: UiControlCommandType;
  target?: string;
  mapId?: number;
  eventId?: number;
  label?: string;
  capture?: boolean;
  waitMs?: number;
  timeoutMs?: number;
  selector?: string;
  testId?: string;
  text?: string;
  key?: string;
  condition?: UiControlWaitCondition;
  expect?: string;
  modifiers?: string[];
  phase?: 'down' | 'move' | 'up';
  offsetX?: number;
  offsetY?: number;
  button?: number;
}

const ALLOWED_TARGETS = new Set([
  'workbench',
  'database',
  'project-assets',
  'map-overview',
  'console-home',
  'console-assets',
  'console-plugins',
  'console-logs',
  'console-settings',
]);

const ALLOWED_COMMAND_TYPES = new Set<UiControlCommandType>([
  'capture-current',
  'navigate',
  'open-event-editor',
  'state',
  'click',
  'pointer',
  'input',
  'key',
  'read',
  'wait',
]);

const ALLOWED_WAIT_CONDITIONS = new Set<UiControlWaitCondition>([
  'present',
  'visible',
  'hidden',
  'enabled',
  'disabled',
  'text',
  'value',
]);

const ALLOWED_MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'meta', 'control', 'cmd', 'command', 'win', 'windows']);

export function normalizeUiControlCommand(raw: unknown): UiControlCommand {
  if (!raw || typeof raw !== 'object') throw new Error('UI control command must be an object.');
  const value = raw as Record<string, unknown>;
  const type = String(value.type || '') as UiControlCommandType;
  if (!ALLOWED_COMMAND_TYPES.has(type)) {
    throw new Error(`Unsupported UI control command type: ${String(value.type || '')}`);
  }
  const command: UiControlCommand = { type };
  if (typeof value.label === 'string' && value.label.trim()) command.label = value.label.trim();
  if (typeof value.capture === 'boolean') command.capture = value.capture;
  command.waitMs = clampNumber(value.waitMs, 150, 0, 5000);
  command.timeoutMs = clampNumber(value.timeoutMs, 15000, 1000, 60000);

  if (type === 'navigate') {
    const target = String(value.target || '');
    if (!ALLOWED_TARGETS.has(target)) throw new Error(`Unsupported UI control target: ${target}`);
    command.target = target;
  }

  if (type === 'open-event-editor') {
    command.mapId = normalizePositiveInteger(value.mapId, 'mapId');
    command.eventId = normalizePositiveInteger(value.eventId, 'eventId');
  }

  if (['click', 'pointer', 'input', 'read', 'wait'].includes(type)) {
    normalizeElementTarget(value, command);
  }

  if (type === 'pointer') {
    const phase = String(value.phase || '') as 'down' | 'move' | 'up';
    if (!['down', 'move', 'up'].includes(phase)) throw new Error('pointer command requires phase down, move, or up.');
    const offsetX = Number(value.offsetX);
    const offsetY = Number(value.offsetY);
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) throw new Error('pointer command requires finite offsetX and offsetY.');
    command.phase = phase;
    command.offsetX = offsetX;
    command.offsetY = offsetY;
    const button = value.button == null ? 0 : Number(value.button);
    if (!Number.isInteger(button) || button < 0 || button > 2) throw new Error('pointer command button must be 0, 1, or 2.');
    command.button = button;
  }

  if (type === 'input') {
    if (typeof value.text !== 'string') throw new Error('input command requires text.');
    command.text = value.text;
  }

  if (type === 'key') {
    if (value.selector !== undefined || value.testId !== undefined) normalizeElementTarget(value, command);
    if (typeof value.key !== 'string' || !value.key.trim()) throw new Error('key command requires key.');
    command.key = value.key.trim();
    command.modifiers = normalizeModifiers(value.modifiers);
  }

  if (type === 'click' && value.modifiers !== undefined) {
    command.modifiers = normalizeModifiers(value.modifiers);
  }

  if (type === 'wait') {
    const condition = String(value.condition || 'visible') as UiControlWaitCondition;
    if (!ALLOWED_WAIT_CONDITIONS.has(condition)) throw new Error(`Unsupported wait condition: ${condition}`);
    command.condition = condition;
    if (value.expect !== undefined) {
      if (typeof value.expect !== 'string') throw new Error('wait expect must be a string.');
      command.expect = value.expect;
    }
  }

  return command;
}

function normalizeElementTarget(value: Record<string, unknown>, command: UiControlCommand): void {
  const selector = typeof value.selector === 'string' ? value.selector.trim() : '';
  const testId = typeof value.testId === 'string' ? value.testId.trim() : '';
  if (selector && testId) throw new Error('Use either selector or testId, not both.');
  if (!selector && !testId) throw new Error(`${command.type} command requires selector or testId.`);
  if (selector) command.selector = selector;
  if (testId) command.testId = testId;
}

function normalizeModifiers(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const modifiers = raw
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  for (const modifier of modifiers) {
    if (!ALLOWED_MODIFIERS.has(modifier)) throw new Error(`Unsupported key modifier: ${modifier}`);
  }
  return modifiers;
}

function normalizePositiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be an integer >= 1.`);
  return parsed;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
