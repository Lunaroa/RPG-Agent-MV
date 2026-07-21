import type {
  MapPreviewSelfSwitchLetter,
  MapPreviewVariableValue,
} from './types.ts';

const SELF_SWITCH_KEY_PATTERN = /^([1-9]\d*),([1-9]\d*),([ABCD])$/;

export function isMapPreviewVariableValue(value: unknown): value is MapPreviewVariableValue {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

export function parseMapPreviewVariableInput(value: string): MapPreviewVariableValue {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : value;
}

export function mapPreviewSelfSwitchKey(
  mapId: number,
  eventId: number,
  letter: MapPreviewSelfSwitchLetter,
): string {
  if (!Number.isSafeInteger(mapId) || mapId <= 0) throw new Error('Self switch map id must be a positive integer.');
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new Error('Self switch event id must be a positive integer.');
  if (!['A', 'B', 'C', 'D'].includes(letter)) throw new Error('Self switch letter must be A, B, C, or D.');
  return `${mapId},${eventId},${letter}`;
}

export function parseMapPreviewSelfSwitchKey(value: string): {
  mapId: number;
  eventId: number;
  letter: MapPreviewSelfSwitchLetter;
} | null {
  const match = SELF_SWITCH_KEY_PATTERN.exec(String(value || ''));
  if (!match) return null;
  const mapId = Number(match[1]);
  const eventId = Number(match[2]);
  if (!Number.isSafeInteger(mapId) || !Number.isSafeInteger(eventId)) return null;
  return { mapId, eventId, letter: match[3] as MapPreviewSelfSwitchLetter };
}
