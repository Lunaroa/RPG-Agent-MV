export const STOCK_TILESET_SHEET_COUNT = 9;
export const EXTENDED_TILESET_FIRST_TILE_ID = 8192;
export const EXTENDED_TILESET_SHAPE_COUNT = 48;

export const EXTENDED_TILESET_SHEET_TYPES = ['A1', 'A2', 'A3', 'A4', 'A5', 'normal'] as const;

export type ExtendedTilesetSheetType = typeof EXTENDED_TILESET_SHEET_TYPES[number];

export interface ExtendedTilesetSheetDescriptor {
  slotIndex: number;
  label: string;
  type: ExtendedTilesetSheetType;
  imageName: string;
  firstTileId: number;
  capacity: number;
}

export interface ExtendedTilesetImageSize {
  columns: number;
  rows: number;
}

const CAPACITY_BY_TYPE: Readonly<Record<ExtendedTilesetSheetType, number>> = {
  A1: 768,
  A2: 1536,
  A3: 1536,
  A4: 2304,
  A5: 128,
  normal: 256,
};

const IMAGE_SIZE_BY_TYPE: Readonly<Record<ExtendedTilesetSheetType, ExtendedTilesetImageSize>> = {
  A1: { columns: 16, rows: 12 },
  A2: { columns: 16, rows: 12 },
  A3: { columns: 16, rows: 8 },
  A4: { columns: 16, rows: 15 },
  A5: { columns: 8, rows: 16 },
  normal: { columns: 16, rows: 16 },
};

export function isExtendedTilesetSheetType(value: unknown): value is ExtendedTilesetSheetType {
  return typeof value === 'string' && (EXTENDED_TILESET_SHEET_TYPES as readonly string[]).includes(value);
}

export function extendedTilesetCapacity(type: ExtendedTilesetSheetType): number {
  return CAPACITY_BY_TYPE[type];
}

export function extendedTilesetImageSize(type: ExtendedTilesetSheetType): ExtendedTilesetImageSize {
  return IMAGE_SIZE_BY_TYPE[type];
}

export function extendedTilesetSlotLabel(slotIndex: number): string {
  if (!Number.isSafeInteger(slotIndex) || slotIndex < STOCK_TILESET_SHEET_COUNT) return '';
  const extendedIndex = slotIndex - STOCK_TILESET_SHEET_COUNT;
  if (extendedIndex < 21) return String.fromCharCode('F'.charCodeAt(0) + extendedIndex);
  return `F${extendedIndex - 20}`;
}

export function normalizeExtendedTilesetTypes(
  tilesetNames: readonly unknown[],
  rawTypes: unknown,
): ExtendedTilesetSheetType[] {
  const extraCount = Math.max(0, tilesetNames.length - STOCK_TILESET_SHEET_COUNT);
  const source = Array.isArray(rawTypes) ? rawTypes : [];
  return Array.from({ length: extraCount }, (_, index) => (
    isExtendedTilesetSheetType(source[index]) ? source[index] : 'normal'
  ));
}

export function buildExtendedTilesetDescriptors(
  tilesetNames: readonly unknown[],
  rawTypes: unknown,
): ExtendedTilesetSheetDescriptor[] {
  const types = normalizeExtendedTilesetTypes(tilesetNames, rawTypes);
  let firstTileId = EXTENDED_TILESET_FIRST_TILE_ID;
  return types.map((type, index) => {
    const slotIndex = STOCK_TILESET_SHEET_COUNT + index;
    const capacity = extendedTilesetCapacity(type);
    if (!Number.isSafeInteger(firstTileId + capacity)) {
      throw new Error(`Extended tileset id range exceeds Number.MAX_SAFE_INTEGER at slot ${slotIndex}.`);
    }
    const descriptor: ExtendedTilesetSheetDescriptor = {
      slotIndex,
      label: extendedTilesetSlotLabel(slotIndex),
      type,
      imageName: typeof tilesetNames[slotIndex] === 'string' ? tilesetNames[slotIndex] as string : '',
      firstTileId,
      capacity,
    };
    firstTileId += capacity;
    return descriptor;
  });
}

export function findExtendedTilesetDescriptor(
  descriptors: readonly ExtendedTilesetSheetDescriptor[],
  tileId: number,
): ExtendedTilesetSheetDescriptor | null {
  if (!Number.isSafeInteger(tileId) || tileId < EXTENDED_TILESET_FIRST_TILE_ID) return null;
  let low = 0;
  let high = descriptors.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const descriptor = descriptors[middle];
    if (tileId < descriptor.firstTileId) high = middle - 1;
    else if (tileId >= descriptor.firstTileId + descriptor.capacity) low = middle + 1;
    else return descriptor;
  }
  return null;
}

export function isExtendedAutotileDescriptor(
  descriptor: ExtendedTilesetSheetDescriptor,
): descriptor is ExtendedTilesetSheetDescriptor & { type: Extract<ExtendedTilesetSheetType, 'A1' | 'A2' | 'A3' | 'A4'> } {
  return descriptor.type === 'A1' || descriptor.type === 'A2'
    || descriptor.type === 'A3' || descriptor.type === 'A4';
}

export function extendedAutotileKindCount(type: ExtendedTilesetSheetType): number {
  if (type === 'A5' || type === 'normal') return 0;
  return extendedTilesetCapacity(type) / EXTENDED_TILESET_SHAPE_COUNT;
}

export function encodeExtendedAutotileId(
  descriptor: ExtendedTilesetSheetDescriptor,
  localKind: number,
  shape = 0,
): number {
  if (!isExtendedAutotileDescriptor(descriptor)) {
    throw new Error(`Extended tileset sheet ${descriptor.label} is not an autotile sheet.`);
  }
  const kindCount = extendedAutotileKindCount(descriptor.type);
  if (!Number.isInteger(localKind) || localKind < 0 || localKind >= kindCount) {
    throw new Error(`Extended autotile kind ${localKind} is outside ${descriptor.label}.`);
  }
  if (!Number.isInteger(shape) || shape < 0 || shape >= EXTENDED_TILESET_SHAPE_COUNT) {
    throw new Error(`Extended autotile shape ${shape} must be between 0 and 47.`);
  }
  return descriptor.firstTileId + localKind * EXTENDED_TILESET_SHAPE_COUNT + shape;
}

export function decodeExtendedAutotileId(
  descriptors: readonly ExtendedTilesetSheetDescriptor[],
  tileId: number,
): {
  descriptor: ExtendedTilesetSheetDescriptor & { type: Extract<ExtendedTilesetSheetType, 'A1' | 'A2' | 'A3' | 'A4'> };
  localKind: number;
  shape: number;
} | null {
  const descriptor = findExtendedTilesetDescriptor(descriptors, tileId);
  if (!descriptor || !isExtendedAutotileDescriptor(descriptor)) return null;
  const localId = tileId - descriptor.firstTileId;
  return {
    descriptor,
    localKind: Math.floor(localId / EXTENDED_TILESET_SHAPE_COUNT),
    shape: localId % EXTENDED_TILESET_SHAPE_COUNT,
  };
}

export function validateExtendedTilesetImageDimensions(
  type: ExtendedTilesetSheetType,
  width: number,
  height: number,
  tileSize: number,
): void {
  const size = extendedTilesetImageSize(type);
  const expectedWidth = size.columns * tileSize;
  const expectedHeight = size.rows * tileSize;
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `Tileset type ${type} requires ${expectedWidth}x${expectedHeight}px at tile size ${tileSize}; received ${width}x${height}px.`,
    );
  }
}
