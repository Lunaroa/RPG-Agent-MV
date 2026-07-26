// Tileset image slot list. Stock MV hardcodes nine sheets (A1-A5, B, C, D, E);
// the unlimited-map plugin planned for a later release may extend sheets up to Z.
// UNLIMITED_TILESET_SLOTS_ENABLED only gates *adding* slots beyond the stock nine;
// existing project data beyond nine slots is always rendered so nothing is hidden.

export const MV_TILESET_SLOT_COUNT = 9;

export const EXTENDED_TILESET_SLOT_LIMIT = MV_TILESET_SLOT_COUNT + 21; // F..Z

export const UNLIMITED_TILESET_SLOTS_ENABLED = false;

const STOCK_SLOT_LABELS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'] as const;

export function tilesetSlotLabel(index: number): string {
  if (index < 0) return '';
  if (index < STOCK_SLOT_LABELS.length) return STOCK_SLOT_LABELS[index];
  const extended = index - STOCK_SLOT_LABELS.length;
  if (index >= EXTENDED_TILESET_SLOT_LIMIT) return '';
  // Extended sheets continue after E: F, G, ... Z.
  return String.fromCharCode('F'.charCodeAt(0) + extended);
}

export function tilesetSlotCount(dataLength: number): number {
  const clampedData = Math.min(Math.max(dataLength, 0), EXTENDED_TILESET_SLOT_LIMIT);
  return Math.max(MV_TILESET_SLOT_COUNT, clampedData);
}

export function canAppendTilesetSlot(dataLength: number, extensionEnabled = UNLIMITED_TILESET_SLOTS_ENABLED): boolean {
  return extensionEnabled && dataLength < EXTENDED_TILESET_SLOT_LIMIT;
}
