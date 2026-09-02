import {
  TILE_ID_A1,
  TILE_ID_A5,
} from '../composables/useMapRenderer.ts';
import type { TileTab } from '../components/editor/editorTypes.ts';
import type { ExtendedTilesetSheetDescriptor, ExtendedTilesetSheetType } from '../api/client.ts';
import { encodeExtendedAutotileId, extendedAutotileKindCount } from '@contract/extended-tileset';

export interface PaletteCell {
  col: number;
  row: number;
}

export interface PalettePick {
  tileId?: number;
  autotileKind?: number;
  tilesetSlot?: number;
  extendedTilesetType?: Extract<ExtendedTilesetSheetType, 'A1' | 'A2' | 'A3' | 'A4'>;
}

export const MV_PALETTE_COLS = 8;
export const MV_PALETTE_ROWS = 32;

const NORMAL_TAB_BASE: Record<string, number> = { B: 0, C: 256, D: 512, E: 768 };
const NORMAL_TAB_SLOT: Record<string, number> = { B: 5, C: 6, D: 7, E: 8 };

export function paletteRowsForTab(tab: TileTab, descriptors: readonly ExtendedTilesetSheetDescriptor[] = []): number {
  const descriptor = descriptors.find((sheet) => sheet.label === tab);
  if (descriptor?.type === 'A1') return 2;
  if (descriptor?.type === 'A2' || descriptor?.type === 'A3') return 4;
  if (descriptor?.type === 'A4') return 6;
  if (descriptor?.type === 'A5') return 16;
  return MV_PALETTE_ROWS;
}

export function tileTabAvailable(tab: TileTab, slotLoaded: (slot: number) => boolean, descriptors: readonly ExtendedTilesetSheetDescriptor[] = []): boolean {
  if (tab === 'A') return [0, 1, 2, 3, 4].some(slotLoaded);
  if (NORMAL_TAB_SLOT[tab] != null) return slotLoaded(NORMAL_TAB_SLOT[tab]);
  const descriptor = descriptors.find((sheet) => sheet.label === tab);
  return Boolean(descriptor && slotLoaded(descriptor.slotIndex));
}

export function palettePickForCell(
  tab: TileTab,
  col: number,
  row: number,
  slotLoaded: (slot: number) => boolean = () => true,
  descriptors: readonly ExtendedTilesetSheetDescriptor[] = [],
): PalettePick | null {
  if (col < 0 || col >= MV_PALETTE_COLS || row < 0 || row >= MV_PALETTE_ROWS) return null;
  if (tab !== 'A' && NORMAL_TAB_SLOT[tab] != null) {
    if (!slotLoaded(NORMAL_TAB_SLOT[tab])) return null;
    return { tileId: normalTabTileId(tab, col, row) };
  }
  if (tab !== 'A') {
    const descriptor = descriptors.find((sheet) => sheet.label === tab);
    if (!descriptor || !slotLoaded(descriptor.slotIndex)) return null;
    if (row >= paletteRowsForTab(tab, descriptors)) return null;
    if (descriptor.type === 'normal') return { tileId: descriptor.firstTileId + normalLocalTileId(col, row) };
    if (descriptor.type === 'A5') return { tileId: descriptor.firstTileId + row * MV_PALETTE_COLS + col };
    const localKind = row * MV_PALETTE_COLS + col;
    if (localKind >= extendedAutotileKindCount(descriptor.type)) return null;
    return {
      tileId: encodeExtendedAutotileId(descriptor, localKind),
      autotileKind: localKind,
      tilesetSlot: descriptor.slotIndex,
      extendedTilesetType: descriptor.type,
    };
  }

  const index = row * MV_PALETTE_COLS + col;
  const slot = aTabSlotForIndex(index);
  if (slot == null || !slotLoaded(slot)) return null;

  if (index < 16) return autotilePick(index);
  if (index < 48) return autotilePick(16 + index - 16);
  if (index < 80) return autotilePick(index);
  if (index < 128) return autotilePick(index);
  return { tileId: TILE_ID_A5 + (index - 128) };
}

export function tileIdForPalettePreview(pick: PalettePick): number {
  return pick.tileId ?? (pick.autotileKind == null ? 0 : TILE_ID_A1 + pick.autotileKind * 48);
}

export function tileIdToPaletteCell(tileId: number, tab: TileTab, descriptors: readonly ExtendedTilesetSheetDescriptor[] = []): PaletteCell | null {
  if (!Number.isInteger(tileId) || tileId <= 0) return null;
  if (tab !== 'A' && NORMAL_TAB_BASE[tab] != null) {
    const base = NORMAL_TAB_BASE[tab];
    if (tileId < base || tileId >= base + 256) return null;
    const local = tileId - base;
    return {
      col: local % 8,
      row: Math.floor((local % 128) / 8) + Math.floor(local / 128) * 16,
    };
  }
  if (tab !== 'A') {
    const descriptor = descriptors.find((sheet) => sheet.label === tab);
    if (!descriptor || tileId < descriptor.firstTileId || tileId >= descriptor.firstTileId + descriptor.capacity) return null;
    const local = tileId - descriptor.firstTileId;
    if (descriptor.type === 'normal') return normalLocalPaletteCell(local);
    if (descriptor.type === 'A5') return { col: local % 8, row: Math.floor(local / 8) };
    const kind = Math.floor(local / 48);
    return { col: kind % 8, row: Math.floor(kind / 8) };
  }

  if (tileId >= TILE_ID_A5 && tileId < TILE_ID_A1) {
    const index = 128 + tileId - TILE_ID_A5;
    return { col: index % MV_PALETTE_COLS, row: Math.floor(index / MV_PALETTE_COLS) };
  }
  if (tileId < TILE_ID_A1) return null;

  const kind = Math.floor((tileId - TILE_ID_A1) / 48);
  let index: number | null = null;
  if (kind < 16) index = kind;
  else if (kind < 48) index = 16 + (kind - 16);
  else if (kind < 80) index = 48 + (kind - 48);
  else if (kind < 128) index = 80 + (kind - 80);
  if (index == null) return null;
  return { col: index % MV_PALETTE_COLS, row: Math.floor(index / MV_PALETTE_COLS) };
}

function normalTabTileId(tab: TileTab, col: number, row: number): number {
  const base = NORMAL_TAB_BASE[tab];
  return base + normalLocalTileId(col, row);
}

function normalLocalTileId(col: number, row: number): number {
  return (row >= 16 ? 128 : 0) + (row % 16) * 8 + col;
}

function normalLocalPaletteCell(local: number): PaletteCell {
  return { col: local % 8, row: Math.floor((local % 128) / 8) + Math.floor(local / 128) * 16 };
}

function autotilePick(kind: number): PalettePick {
  return { autotileKind: kind };
}

function aTabSlotForIndex(index: number): number | null {
  if (index < 0 || index >= 256) return null;
  if (index < 16) return 0;
  if (index < 48) return 1;
  if (index < 80) return 2;
  if (index < 128) return 3;
  return 4;
}
