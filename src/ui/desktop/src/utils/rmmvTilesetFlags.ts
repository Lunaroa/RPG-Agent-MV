export const MV_TILESET_FLAG_BITS = {
  down: 0x01,
  left: 0x02,
  right: 0x04,
  up: 0x08,
  passageMask: 0x0f,
  star: 0x10,
  ladder: 0x20,
  bush: 0x40,
  counter: 0x80,
  damage: 0x100,
} as const;

export type MvTilesetSheetKey = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B' | 'C' | 'D' | 'E';
export type MvTilesetPassage = 'passable' | 'blocked' | 'star';
export type MvTilesetAggregate<T> = T | 'mixed';
export type MvTilesetDirectionBit =
  | typeof MV_TILESET_FLAG_BITS.down
  | typeof MV_TILESET_FLAG_BITS.left
  | typeof MV_TILESET_FLAG_BITS.right
  | typeof MV_TILESET_FLAG_BITS.up;
export type MvTilesetMarkerBit =
  | typeof MV_TILESET_FLAG_BITS.ladder
  | typeof MV_TILESET_FLAG_BITS.bush
  | typeof MV_TILESET_FLAG_BITS.counter
  | typeof MV_TILESET_FLAG_BITS.damage;

export interface MvTilesetSheet {
  key: MvTilesetSheetKey;
  imageIndex: number;
  columns: number;
  rows: number;
  baseTileId: number;
  autotile: boolean;
  allowsStar: boolean;
  directionalEditable: boolean;
}

export interface MvTilesetFlagCell {
  sheet: MvTilesetSheet;
  row: number;
  column: number;
  representativeTileId: number;
  tileIds: number[];
  fixedPassage: 'star' | null;
}

export interface MvTilesetFlagCellState {
  passage: MvTilesetAggregate<MvTilesetPassage>;
  downBlocked: MvTilesetAggregate<boolean>;
  leftBlocked: MvTilesetAggregate<boolean>;
  rightBlocked: MvTilesetAggregate<boolean>;
  upBlocked: MvTilesetAggregate<boolean>;
  ladder: MvTilesetAggregate<boolean>;
  bush: MvTilesetAggregate<boolean>;
  counter: MvTilesetAggregate<boolean>;
  damage: MvTilesetAggregate<boolean>;
  terrainTag: MvTilesetAggregate<number>;
}

export type MvTilesetFlagEdit =
  | { kind: 'passage'; value: MvTilesetPassage }
  | { kind: 'direction'; bit: MvTilesetDirectionBit; blocked: boolean }
  | { kind: 'marker'; bit: MvTilesetMarkerBit; enabled: boolean }
  | { kind: 'terrain'; value: number };

export const MV_TILESET_SHEETS: readonly MvTilesetSheet[] = [
  { key: 'A1', imageIndex: 0, columns: 8, rows: 2, baseTileId: 2048, autotile: true, allowsStar: false, directionalEditable: false },
  { key: 'A2', imageIndex: 1, columns: 8, rows: 4, baseTileId: 2816, autotile: true, allowsStar: false, directionalEditable: false },
  { key: 'A3', imageIndex: 2, columns: 8, rows: 4, baseTileId: 4352, autotile: true, allowsStar: false, directionalEditable: false },
  { key: 'A4', imageIndex: 3, columns: 8, rows: 6, baseTileId: 5888, autotile: true, allowsStar: false, directionalEditable: false },
  { key: 'A5', imageIndex: 4, columns: 8, rows: 16, baseTileId: 1536, autotile: false, allowsStar: false, directionalEditable: true },
  { key: 'B', imageIndex: 5, columns: 16, rows: 16, baseTileId: 0, autotile: false, allowsStar: true, directionalEditable: true },
  { key: 'C', imageIndex: 6, columns: 16, rows: 16, baseTileId: 256, autotile: false, allowsStar: true, directionalEditable: true },
  { key: 'D', imageIndex: 7, columns: 16, rows: 16, baseTileId: 512, autotile: false, allowsStar: true, directionalEditable: true },
  { key: 'E', imageIndex: 8, columns: 16, rows: 16, baseTileId: 768, autotile: false, allowsStar: true, directionalEditable: true },
] as const;

const SHEET_BY_KEY = new Map(MV_TILESET_SHEETS.map((sheet) => [sheet.key, sheet]));
const DIRECTION_BITS = new Set<number>([
  MV_TILESET_FLAG_BITS.down,
  MV_TILESET_FLAG_BITS.left,
  MV_TILESET_FLAG_BITS.right,
  MV_TILESET_FLAG_BITS.up,
]);
const MARKER_BITS = new Set<number>([
  MV_TILESET_FLAG_BITS.ladder,
  MV_TILESET_FLAG_BITS.bush,
  MV_TILESET_FLAG_BITS.counter,
  MV_TILESET_FLAG_BITS.damage,
]);

export function mvTilesetSheet(key: MvTilesetSheetKey): MvTilesetSheet {
  const sheet = SHEET_BY_KEY.get(key);
  if (!sheet) throw new Error(`Unknown RPG Maker MV tileset sheet: ${key}`);
  return sheet;
}

export function mvTilesetFlagCell(key: MvTilesetSheetKey, row: number, column: number): MvTilesetFlagCell {
  const sheet = mvTilesetSheet(key);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= sheet.rows || column >= sheet.columns) {
    throw new Error(`Tileset cell ${key}[${row},${column}] is outside the fixed RPG Maker MV sheet layout.`);
  }

  let representativeTileId: number;
  let tileIds: number[];
  if (sheet.autotile) {
    representativeTileId = sheet.baseTileId + (row * sheet.columns + column) * 48;
    tileIds = Array.from({ length: 48 }, (_, index) => representativeTileId + index);
  } else if (key === 'A5') {
    representativeTileId = sheet.baseTileId + row * sheet.columns + column;
    tileIds = [representativeTileId];
  } else {
    representativeTileId = sheet.baseTileId + (column < 8 ? 0 : 128) + row * 8 + (column % 8);
    tileIds = [representativeTileId];
  }

  return {
    sheet,
    row,
    column,
    representativeTileId,
    tileIds,
    fixedPassage: key === 'B' && row === 0 && column === 0 ? 'star' : null,
  };
}

export function nextMvTilesetPassage(
  value: MvTilesetAggregate<MvTilesetPassage>,
  allowsStar: boolean,
  reverse: boolean,
): MvTilesetPassage {
  const order: MvTilesetPassage[] = allowsStar
    ? ['passable', 'blocked', 'star']
    : ['passable', 'blocked'];
  if (value === 'mixed') return reverse ? order[order.length - 1] : order[0];
  const index = order.indexOf(value);
  const current = index >= 0 ? index : 0;
  return order[(current + (reverse ? order.length - 1 : 1)) % order.length];
}

export function nextMvTilesetTerrainTag(value: MvTilesetAggregate<number>, reverse: boolean): number {
  if (value === 'mixed') return reverse ? 7 : 0;
  const current = Number.isInteger(value) ? Math.max(0, Math.min(7, value)) : 0;
  return (current + (reverse ? 7 : 1)) % 8;
}

export function applyMvTilesetFlagEdit(
  flags: readonly unknown[],
  cell: MvTilesetFlagCell,
  edit: MvTilesetFlagEdit,
): unknown[] {
  validateEdit(cell, edit);
  const next = [...flags];
  const requiredLength = Math.max(...cell.tileIds) + 1;
  while (next.length < requiredLength) next.push(0);

  for (const tileId of cell.tileIds) {
    const current = integerFlag(next[tileId]);
    if (edit.kind === 'passage') {
      const cleared = current & ~(MV_TILESET_FLAG_BITS.passageMask | MV_TILESET_FLAG_BITS.star);
      next[tileId] = edit.value === 'blocked'
        ? cleared | MV_TILESET_FLAG_BITS.passageMask
        : edit.value === 'star'
          ? cleared | MV_TILESET_FLAG_BITS.star
          : cleared;
    } else if (edit.kind === 'direction') {
      next[tileId] = edit.blocked ? current | edit.bit : current & ~edit.bit;
    } else if (edit.kind === 'marker') {
      next[tileId] = edit.enabled ? current | edit.bit : current & ~edit.bit;
    } else {
      next[tileId] = (current & ~0xf000) | (edit.value << 12);
    }
  }

  return next;
}

export function inspectMvTilesetFlagCell(
  flags: readonly unknown[],
  cell: MvTilesetFlagCell,
): MvTilesetFlagCellState {
  return {
    passage: aggregate(cell.tileIds, (tileId) => passageForFlag(integerFlag(flags[tileId]))),
    downBlocked: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.down)),
    leftBlocked: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.left)),
    rightBlocked: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.right)),
    upBlocked: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.up)),
    ladder: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.ladder)),
    bush: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.bush)),
    counter: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.counter)),
    damage: aggregate(cell.tileIds, (tileId) => Boolean(integerFlag(flags[tileId]) & MV_TILESET_FLAG_BITS.damage)),
    terrainTag: aggregate(cell.tileIds, (tileId) => (integerFlag(flags[tileId]) >> 12) & 0x0f),
  };
}

function validateEdit(cell: MvTilesetFlagCell, edit: MvTilesetFlagEdit): void {
  if (edit.kind === 'passage') {
    if (edit.value === 'star' && !cell.sheet.allowsStar) {
      throw new Error('Star passage is only supported on RPG Maker MV B-E sheets.');
    }
    if (cell.fixedPassage && edit.value !== cell.fixedPassage) {
      throw new Error('The upper-left B tile passage is fixed to star.');
    }
    return;
  }
  if (edit.kind === 'direction') {
    if (!cell.sheet.directionalEditable) {
      throw new Error('RPG Maker MV autotile four-direction passage is calculated automatically.');
    }
    if (!DIRECTION_BITS.has(edit.bit)) throw new Error(`Unsupported passage direction bit: ${edit.bit}`);
    return;
  }
  if (edit.kind === 'marker') {
    if (!MARKER_BITS.has(edit.bit)) throw new Error(`Unsupported tileset marker bit: ${edit.bit}`);
    return;
  }
  if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 7) {
    throw new Error(`RPG Maker MV terrain tag must be an integer from 0 through 7: ${edit.value}`);
  }
}

function passageForFlag(flag: number): MvTilesetPassage {
  if (flag & MV_TILESET_FLAG_BITS.star) return 'star';
  return (flag & MV_TILESET_FLAG_BITS.passageMask) === MV_TILESET_FLAG_BITS.passageMask
    ? 'blocked'
    : 'passable';
}

function integerFlag(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function aggregate<T>(tileIds: number[], read: (tileId: number) => T): MvTilesetAggregate<T> {
  const first = read(tileIds[0]);
  for (const tileId of tileIds.slice(1)) {
    if (!Object.is(read(tileId), first)) return 'mixed';
  }
  return first;
}
