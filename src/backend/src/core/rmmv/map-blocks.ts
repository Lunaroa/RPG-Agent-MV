export const LAYERS: number = 6;

interface TileRange {
  name: string;
  base: number;
  end: number;
  autotile: boolean;
}

export const RANGES: TileRange[] = [
  { name: "B",  base: 0,    end: 255,  autotile: false },
  { name: "C",  base: 256,  end: 511,  autotile: false },
  { name: "D",  base: 512,  end: 767,  autotile: false },
  { name: "E",  base: 768,  end: 1023, autotile: false },
  { name: "A5", base: 1536, end: 2047, autotile: false },
  { name: "A1", base: 2048, end: 2815, autotile: true },
  { name: "A2", base: 2816, end: 4351, autotile: true },
  { name: "A3", base: 4352, end: 5887, autotile: true },
  { name: "A4", base: 5888, end: 8191, autotile: true }
];

interface TileClassification {
  kind: string;
  group: number | null;
  label?: string;
}

export function classifyTileId(tileId: number): TileClassification {
  if (!tileId || tileId === 0) return { kind: "_", group: null };
  for (const range of RANGES) {
    if (tileId >= range.base && tileId <= range.end) {
      if (range.autotile) {
        const group: number = Math.floor((tileId - range.base) / 48);
        return { kind: range.name, group, label: `${range.name}g${group}` };
      }
      return { kind: range.name, group: null, label: `${range.name}(${tileId})` };
    }
  }
  return { kind: "?", group: null, label: `?(${tileId})` };
}

interface RMMVMapData {
  width: number;
  height: number;
  data: number[];
}

interface LayerSummary {
  empty: number;
  entries: { label: string; count: number }[];
}

interface BlockResult {
  layers: number[][];
  summary: LayerSummary[];
  signature: string;
}

export function extractBlockAt(map: RMMVMapData, x: number, y: number, size: number): BlockResult {
  const layerSize: number = map.width * map.height;
  const layers: number[][] = [];
  for (let z = 0; z < LAYERS; z += 1) {
    const arr = new Array<number>(size * size);
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const srcIdx: number = z * layerSize + (y + dy) * map.width + (x + dx);
        arr[dy * size + dx] = map.data[srcIdx] | 0;
      }
    }
    layers.push(arr);
  }
  const summary: LayerSummary[] = summarizeLayers(layers);
  return {
    layers,
    summary,
    signature: buildSignature(summary)
  };
}

export function summarizeLayers(layers: number[][]): LayerSummary[] {
  return layers.map((arr) => {
    let empty = 0;
    const buckets = new Map<string, number>();
    for (const tid of arr) {
      if (!tid) { empty += 1; continue; }
      const cls: TileClassification = classifyTileId(tid);
      const key: string = cls.label!;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    const entries = Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));
    return { empty, entries };
  });
}

export function buildSignature(summary: LayerSummary[]): string {
  return summary.map((layer, i) => {
    if (!layer.entries.length) return `L${i}[_]`;
    const parts: string[] = layer.entries.map((e) => e.count > 1 ? `${e.label}x${e.count}` : e.label);
    return `L${i}[${parts.join(",")}]`;
  }).join("|");
}

interface ExtractAllBlocksOptions {
  size: number;
  stride?: number;
  mapId: number;
}

interface BlockSource {
  mapId: number;
  x: number;
  y: number;
  size: number;
}

interface ExtractedBlock {
  id: string;
  source: BlockSource;
  layers: number[][];
  summary: LayerSummary[];
  signature: string;
}

export function extractAllBlocks(map: RMMVMapData, options: ExtractAllBlocksOptions): ExtractedBlock[] {
  const size: number = options.size;
  const stride: number = options.stride || size;
  if (!Number.isInteger(size) || size < 1) throw new Error("block size must be a positive integer");
  if (!Number.isInteger(stride) || stride < 1) throw new Error("stride must be a positive integer");
  if (!map || !Number.isInteger(map.width) || !Number.isInteger(map.height) || !Array.isArray(map.data)) {
    throw new Error("map must have integer width/height and data array");
  }
  const expected: number = map.width * map.height * LAYERS;
  if (map.data.length !== expected) {
    throw new Error(`map.data length ${map.data.length} does not match width*height*6 ${expected}`);
  }
  const blocks: ExtractedBlock[] = [];
  const mapTag: string = `Map${String(options.mapId).padStart(3, "0")}`;
  for (let y = 0; y + size <= map.height; y += stride) {
    for (let x = 0; x + size <= map.width; x += stride) {
      const block: BlockResult = extractBlockAt(map, x, y, size);
      blocks.push({
        id: `${mapTag}-${size}x${size}@${x},${y}`,
        source: { mapId: options.mapId, x, y, size },
        layers: block.layers,
        summary: block.summary,
        signature: block.signature
      });
    }
  }
  return blocks;
}

interface StampTargetMap {
  width: number;
  height: number;
  data: number[];
}

interface StampBlock {
  source: BlockSource;
  layers: number[][];
}

interface StampOptions {
  overwriteZero?: boolean;
}

interface StampResult {
  cellsWritten: number;
  atX: number;
  atY: number;
  size: number;
}

export function stampBlock(targetMap: StampTargetMap, block: StampBlock, atX: number, atY: number, options?: StampOptions): StampResult {
  if (!targetMap || !Number.isInteger(targetMap.width) || !Number.isInteger(targetMap.height)) {
    throw new Error("targetMap must have integer width/height");
  }
  const size: number = block.source.size;
  if (atX < 0 || atY < 0 || atX + size > targetMap.width || atY + size > targetMap.height) {
    throw new Error(
      `Stamp at (${atX},${atY}) size ${size} falls outside target map ${targetMap.width}x${targetMap.height}.`
    );
  }
  const overwriteZero: boolean = Boolean(options && options.overwriteZero);
  const layerSize: number = targetMap.width * targetMap.height;
  let cellsWritten = 0;
  for (let z = 0; z < LAYERS; z += 1) {
    const layer: number[] | undefined = block.layers[z];
    if (!layer) continue;
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const tid: number = layer[dy * size + dx] | 0;
        if (!overwriteZero && tid === 0) continue;
        const tgtIdx: number = z * layerSize + (atY + dy) * targetMap.width + (atX + dx);
        targetMap.data[tgtIdx] = tid;
        cellsWritten += 1;
      }
    }
  }
  return { cellsWritten, atX, atY, size };
}
