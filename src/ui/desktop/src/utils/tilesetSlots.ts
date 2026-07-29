// Tileset image slot list. Stock MV hardcodes nine sheets (A1-A5, B, C, D, E).
// Project-level extended mode unlocks an unbounded editor-side list. Existing
// extended data always renders even while the project switch is off.

export const MV_TILESET_SLOT_COUNT = 9;

// Product decision: the extended-tileset entry points stay hidden for release.
// Existing extended slot data still renders; flip this flag to bring the UI back.
export const EXTENDED_TILESET_UI_VISIBLE = false;

const STOCK_SLOT_LABELS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'] as const;
const FIRST_EXTENDED_SLOT_INDEX = STOCK_SLOT_LABELS.length;
const LETTERED_EXTENDED_SLOT_COUNT = 21; // F..Z

export function tilesetSlotLabel(index: number): string {
  if (index < 0) return '';
  if (index < STOCK_SLOT_LABELS.length) return STOCK_SLOT_LABELS[index];
  const extended = index - FIRST_EXTENDED_SLOT_INDEX;
  if (extended < LETTERED_EXTENDED_SLOT_COUNT) {
    return String.fromCharCode('F'.charCodeAt(0) + extended);
  }
  return `F${extended - LETTERED_EXTENDED_SLOT_COUNT + 1}`;
}

export function tilesetSlotCount(dataLength: number): number {
  return Math.max(MV_TILESET_SLOT_COUNT, Number.isSafeInteger(dataLength) ? dataLength : 0);
}

export function canAppendTilesetSlot(_dataLength: number, extensionEnabled: boolean): boolean {
  return extensionEnabled;
}
