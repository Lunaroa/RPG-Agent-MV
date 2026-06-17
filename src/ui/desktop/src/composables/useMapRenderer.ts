// RPG Maker MV 地图渲染。忠实移植自 RPG-Agent-MV/frontend/src/app/map-renderer.js：
// 真实 tileset 绘制 + autotile 拼接 + 阴影层 + 事件框。
//
// 红线（重构设计文档）：这里全部是纯函数，渲染对象（Canvas context、map.data、
// 预加载的 HTMLImageElement[]）一律由调用方用普通变量/ref 持有，禁止丢进 Vue
// reactive —— 响应式代理会拦截每次像素读写，把绘制拖死。

import { flagSummaryTokens, summarizeTileStackFlags, type MvTileFlagStackSummary } from '../utils/mvTileFlags.ts';

export const TILE_SIZE = 48;
export const TILE_ID_A5 = 1536;
export const TILE_ID_A1 = 2048;
export const TILE_ID_A2 = 2816;
export const TILE_ID_A3 = 4352;
export const TILE_ID_A4 = 5888;
export const PAINT_LAYERS = 4;
export const SHADOW_LAYER = 4;
export const REGION_LAYER = 5;

type Quad = [number, number];
type ShapeTable = Quad[][];

export interface MvEventImage {
  tileId?: number;
  characterName?: string;
  characterIndex?: number;
  direction?: number;
  pattern?: number;
}

export interface MvEventPage {
  image?: MvEventImage;
}

export interface MvEvent {
  id: number;
  name?: string;
  note?: string;
  x: number;
  y: number;
  pages?: MvEventPage[];
}

export interface MvMap {
  width: number;
  height: number;
  tilesetId?: number;
  data: number[];
  events?: (MvEvent | null)[];
}

export interface DrawOptions {
  tilesetImages: (HTMLImageElement | null)[];
  tilesetFlags?: number[];
  showGrid?: boolean;
  showRegions?: boolean;
  showTileFlags?: boolean;
  selectedEventId?: number | null;
  activePageIndex?: (event: MvEvent) => number;
  defaultPage?: () => MvEventPage;
  getCharacterImage?: (name: string) => HTMLImageElement | null;
}

const FLOOR_AUTOTILE_TABLE: ShapeTable = [
  [[2,4],[1,4],[2,3],[1,3]],[[2,0],[1,4],[2,3],[1,3]],[[2,4],[3,0],[2,3],[1,3]],[[2,0],[3,0],[2,3],[1,3]],
  [[2,4],[1,4],[2,3],[3,1]],[[2,0],[1,4],[2,3],[3,1]],[[2,4],[3,0],[2,3],[3,1]],[[2,0],[3,0],[2,3],[3,1]],
  [[2,4],[1,4],[2,1],[1,3]],[[2,0],[1,4],[2,1],[1,3]],[[2,4],[3,0],[2,1],[1,3]],[[2,0],[3,0],[2,1],[1,3]],
  [[2,4],[1,4],[2,1],[3,1]],[[2,0],[1,4],[2,1],[3,1]],[[2,4],[3,0],[2,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],
  [[0,4],[1,4],[0,3],[1,3]],[[0,4],[3,0],[0,3],[1,3]],[[0,4],[1,4],[0,3],[3,1]],[[0,4],[3,0],[0,3],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[2,2],[1,2],[2,3],[3,1]],[[2,2],[1,2],[2,1],[1,3]],[[2,2],[1,2],[2,1],[3,1]],
  [[2,4],[3,4],[2,3],[3,3]],[[2,4],[3,4],[2,1],[3,3]],[[2,0],[3,4],[2,3],[3,3]],[[2,0],[3,4],[2,1],[3,3]],
  [[2,4],[1,4],[2,5],[1,5]],[[2,0],[1,4],[2,5],[1,5]],[[2,4],[3,0],[2,5],[1,5]],[[2,0],[3,0],[2,5],[1,5]],
  [[0,4],[3,4],[0,3],[3,3]],[[2,2],[1,2],[2,5],[1,5]],[[0,2],[1,2],[0,3],[1,3]],[[0,2],[1,2],[0,3],[3,1]],
  [[2,2],[3,2],[2,3],[3,3]],[[2,2],[3,2],[2,1],[3,3]],[[2,4],[3,4],[2,5],[3,5]],[[2,0],[3,4],[2,5],[3,5]],
  [[0,4],[1,4],[0,5],[1,5]],[[0,4],[3,0],[0,5],[1,5]],[[0,2],[3,2],[0,3],[3,3]],[[0,2],[1,2],[0,5],[1,5]],
  [[0,4],[3,4],[0,5],[3,5]],[[2,2],[3,2],[2,5],[3,5]],[[0,2],[3,2],[0,5],[3,5]],[[0,0],[1,0],[0,1],[1,1]],
];
const WALL_AUTOTILE_TABLE: ShapeTable = [
  [[2,2],[1,2],[2,1],[1,1]],[[0,2],[1,2],[0,1],[1,1]],[[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],
  [[2,2],[3,2],[2,1],[3,1]],[[0,2],[3,2],[0,1],[3,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
  [[2,2],[1,2],[2,3],[1,3]],[[0,2],[1,2],[0,3],[1,3]],[[2,0],[1,0],[2,3],[1,3]],[[0,0],[1,0],[0,3],[1,3]],
  [[2,2],[3,2],[2,3],[3,3]],[[0,2],[3,2],[0,3],[3,3]],[[2,0],[3,0],[2,3],[3,3]],[[0,0],[3,0],[0,3],[3,3]],
];
const WATERFALL_AUTOTILE_TABLE: ShapeTable = [
  [[2,0],[1,0],[2,1],[1,1]],[[0,0],[1,0],[0,1],[1,1]],[[2,0],[3,0],[2,1],[3,1]],[[0,0],[3,0],[0,1],[3,1]],
];

export const AUTOTILE_KINDS: number[] = (() => {
  const kinds: number[] = [];
  for (let k = 0; k < 128; k += 1) kinds.push(k);
  return kinds;
})();

export function drawMapContent(context: CanvasRenderingContext2D, map: MvMap, options: DrawOptions): void {
  context.clearRect(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);
  context.fillStyle = '#203b20';
  context.fillRect(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);
  for (let z = 0; z < PAINT_LAYERS; z += 1) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tileId = map.data[(z * map.height + y) * map.width + x] || 0;
        drawTile(context, options.tilesetImages, tileId, x * TILE_SIZE, y * TILE_SIZE);
      }
    }
  }
  drawShadowLayer(context, map);
  if (options.showRegions) drawRegionLayer(context, map);
  if (options.showTileFlags) drawTileFlagLayer(context, map, options.tilesetFlags || []);
  if (options.showGrid) drawGrid(context, map.width, map.height);
  drawEvents(context, map.events || [], options);
}

export function drawTile(
  context: CanvasRenderingContext2D,
  images: (HTMLImageElement | null)[],
  tileId: number,
  dx: number,
  dy: number,
): void {
  if (!tileId) return;
  if (tileId >= TILE_ID_A1) {
    drawAutotileApprox(context, images, tileId, dx, dy);
    return;
  }
  if (tileId >= TILE_ID_A5) {
    if (images[4]) drawSheetTile(context, images[4]!, tileId - TILE_ID_A5, dx, dy);
    return;
  }
  const sheetNumber = Math.floor(tileId / 256);
  drawNormalTile(context, images[5 + sheetNumber] || null, tileId, dx, dy);
}

function drawNormalTile(context: CanvasRenderingContext2D, image: HTMLImageElement | null, tileId: number, dx: number, dy: number): void {
  if (!image) {
    drawFallback(context, tileId, dx, dy);
    return;
  }
  const sx = ((Math.floor(tileId / 128) % 2) * 8 + (tileId % 8)) * TILE_SIZE;
  const sy = (Math.floor((tileId % 256) / 8) % 16) * TILE_SIZE;
  if (sx + TILE_SIZE > image.naturalWidth || sy + TILE_SIZE > image.naturalHeight) drawFallback(context, tileId, dx, dy);
  else context.drawImage(image, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
}

function drawSheetTile(context: CanvasRenderingContext2D, image: HTMLImageElement, localId: number, dx: number, dy: number): void {
  const sx = (localId % 8) * TILE_SIZE;
  const sy = Math.floor(localId / 8) * TILE_SIZE;
  if (sx + TILE_SIZE <= image.naturalWidth && sy + TILE_SIZE <= image.naturalHeight) {
    context.drawImage(image, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
  }
}

function drawAutotileApprox(context: CanvasRenderingContext2D, images: (HTMLImageElement | null)[], tileId: number, dx: number, dy: number): void {
  const sheetInfo = autotileSheet(tileId);
  const image = images[sheetInfo.index];
  if (!image) {
    drawFallback(context, tileId, dx, dy);
    return;
  }
  const kind = Math.floor((tileId - TILE_ID_A1) / 48);
  const shape = (tileId - TILE_ID_A1) % 48;
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  const placement = autotilePlacement(sheetInfo.index, kind, tx, ty);
  const table = placement.table[shape % placement.table.length];
  const half = TILE_SIZE / 2;
  for (let index = 0; index < 4; index += 1) {
    const [qsx, qsy] = table[index];
    const sx = (placement.bx * 2 + qsx) * half;
    const sy = (placement.by * 2 + qsy) * half;
    context.drawImage(image, sx, sy, half, half, dx + (index % 2) * half, dy + Math.floor(index / 2) * half, half, half);
  }
}

function autotileSheet(tileId: number): { index: number; base: number } {
  if (tileId >= TILE_ID_A4) return { index: 3, base: TILE_ID_A4 };
  if (tileId >= TILE_ID_A3) return { index: 2, base: TILE_ID_A3 };
  if (tileId >= TILE_ID_A2) return { index: 1, base: TILE_ID_A2 };
  return { index: 0, base: TILE_ID_A1 };
}

function autotilePlacement(sheetIndex: number, kind: number, tx: number, ty: number): { bx: number; by: number; table: ShapeTable } {
  if (sheetIndex === 0) {
    if (kind === 0) return { bx: 0, by: 0, table: FLOOR_AUTOTILE_TABLE };
    if (kind === 1) return { bx: 0, by: 3, table: FLOOR_AUTOTILE_TABLE };
    if (kind === 2) return { bx: 6, by: 0, table: FLOOR_AUTOTILE_TABLE };
    if (kind === 3) return { bx: 6, by: 3, table: FLOOR_AUTOTILE_TABLE };
    const evenWater = kind % 2 === 0;
    return { bx: Math.floor(tx / 4) * 8 + (evenWater ? 0 : 6), by: ty * 6 + (Math.floor(tx / 2) % 2) * 3, table: evenWater ? FLOOR_AUTOTILE_TABLE : WATERFALL_AUTOTILE_TABLE };
  }
  if (sheetIndex === 1) return { bx: tx * 2, by: (ty - 2) * 3, table: FLOOR_AUTOTILE_TABLE };
  if (sheetIndex === 2) return { bx: tx * 2, by: (ty - 6) * 2, table: WALL_AUTOTILE_TABLE };
  return { bx: tx * 2, by: Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0)), table: ty % 2 === 1 ? WALL_AUTOTILE_TABLE : FLOOR_AUTOTILE_TABLE };
}

function drawFallback(context: CanvasRenderingContext2D, seed: number, dx: number, dy: number): void {
  context.fillStyle = `hsl(${(Number(seed) * 37) % 360}, 38%, 42%)`;
  context.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
}

export function drawGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.strokeStyle = 'rgba(0,0,0,.22)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= width; x += 1) {
    context.moveTo(x * TILE_SIZE + 0.5, 0);
    context.lineTo(x * TILE_SIZE + 0.5, height * TILE_SIZE);
  }
  for (let y = 0; y <= height; y += 1) {
    context.moveTo(0, y * TILE_SIZE + 0.5);
    context.lineTo(width * TILE_SIZE, y * TILE_SIZE + 0.5);
  }
  context.stroke();
}

function drawShadowLayer(context: CanvasRenderingContext2D, map: MvMap): void {
  const base = SHADOW_LAYER * map.width * map.height;
  if (!Array.isArray(map.data) || map.data.length <= base) return;
  context.save();
  context.fillStyle = 'rgba(0, 0, 0, .34)';
  const half = TILE_SIZE / 2;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const bits = map.data[base + y * map.width + x] || 0;
      if (!bits) continue;
      if (bits & 1) context.fillRect(x * TILE_SIZE, y * TILE_SIZE, half, half);
      if (bits & 2) context.fillRect(x * TILE_SIZE + half, y * TILE_SIZE, half, half);
      if (bits & 4) context.fillRect(x * TILE_SIZE, y * TILE_SIZE + half, half, half);
      if (bits & 8) context.fillRect(x * TILE_SIZE + half, y * TILE_SIZE + half, half, half);
    }
  }
  context.restore();
}

function drawRegionLayer(context: CanvasRenderingContext2D, map: MvMap): void {
  const base = REGION_LAYER * map.width * map.height;
  if (!Array.isArray(map.data) || map.data.length <= base) return;
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 13px sans-serif';
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const id = map.data[base + y * map.width + x] || 0;
      if (!id) continue;
      const hue = (id * 47) % 360;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      context.fillStyle = `hsla(${hue}, 82%, 52%, .28)`;
      context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      context.fillStyle = 'rgba(0, 0, 0, .58)';
      context.fillRect(px + 10, py + 14, TILE_SIZE - 20, 20);
      context.fillStyle = '#fff';
      context.fillText(String(id), px + TILE_SIZE / 2, py + TILE_SIZE / 2 + 1);
    }
  }
  context.restore();
}

function drawTileFlagLayer(context: CanvasRenderingContext2D, map: MvMap, flags: number[]): void {
  if (!flags.length) return;
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 9px sans-serif';
  const layerSize = map.width * map.height;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const cell = y * map.width + x;
      const tileIds = [];
      for (let layer = 0; layer < PAINT_LAYERS; layer += 1) {
        tileIds.push(map.data[layer * layerSize + cell] || 0);
      }
      const summary = summarizeTileStackFlags(tileIds, flags);
      if (!summary.hasOverlay) continue;
      drawFlagSummary(context, x, y, summary);
    }
  }
  context.restore();
}

function drawFlagSummary(context: CanvasRenderingContext2D, x: number, y: number, summary: MvTileFlagStackSummary): void {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;
  const color = flagSummaryColor(summary);
  context.fillStyle = color.fill;
  context.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = color.stroke;
  context.lineWidth = 1;
  context.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

  const tokens = flagSummaryTokens(summary).slice(0, 4);
  if (!tokens.length) return;
  context.fillStyle = 'rgba(0, 0, 0, .66)';
  context.fillRect(px + 4, py + TILE_SIZE - 16, TILE_SIZE - 8, 12);
  context.fillStyle = '#fff';
  context.fillText(tokens.join(' '), px + TILE_SIZE / 2, py + TILE_SIZE - 9);
}

function flagSummaryColor(summary: MvTileFlagStackSummary): { fill: string; stroke: string } {
  if (summary.damage) return { fill: 'rgba(220, 38, 38, .24)', stroke: 'rgba(220, 38, 38, .72)' };
  if (summary.passage === 'blocked') return { fill: 'rgba(239, 68, 68, .18)', stroke: 'rgba(239, 68, 68, .62)' };
  if (summary.passage === 'directional') return { fill: 'rgba(245, 158, 11, .18)', stroke: 'rgba(245, 158, 11, .62)' };
  if (summary.flagsMissing) return { fill: 'rgba(107, 114, 128, .20)', stroke: 'rgba(107, 114, 128, .64)' };
  return { fill: 'rgba(14, 165, 233, .16)', stroke: 'rgba(14, 165, 233, .58)' };
}

function drawEvents(context: CanvasRenderingContext2D, events: (MvEvent | null)[], options: DrawOptions): void {
  const activePageIndex = options.activePageIndex || (() => 0);
  const defaultPage = options.defaultPage || (() => ({ image: {} }));
  const getCharacterImage = options.getCharacterImage || (() => null);
  for (const event of events.filter(Boolean) as MvEvent[]) {
    const x = event.x * TILE_SIZE;
    const y = event.y * TILE_SIZE;
    const selected = event.id === options.selectedEventId;
    const page = (event.pages && event.pages[activePageIndex(event)]) || defaultPage();
    const image: MvEventImage = page.image || {};
    let drawn = false;
    if (Number(image.tileId) > 0) {
      drawTile(context, options.tilesetImages, Number(image.tileId), x, y);
      drawn = true;
    } else if (image.characterName) {
      drawn = drawEventCharacter(context, image, x, y, getCharacterImage);
    }
    drawEventFrame(context, x, y, selected, drawn);
  }
}

function drawEventFrame(context: CanvasRenderingContext2D, x: number, y: number, selected: boolean, hasGraphic: boolean): void {
  context.save();
  context.lineWidth = selected ? 3 : 2;
  context.strokeStyle = selected ? 'rgba(255, 255, 255, .96)' : 'rgba(0, 0, 0, .72)';
  context.strokeRect(x + 5.5, y + 5.5, TILE_SIZE - 11, TILE_SIZE - 11);
  if (selected) {
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 222, 78, .98)';
    context.strokeRect(x + 2.5, y + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);
  } else if (hasGraphic) {
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 255, 255, .48)';
    context.strokeRect(x + 6.5, y + 6.5, TILE_SIZE - 13, TILE_SIZE - 13);
  }
  context.restore();
}

function drawEventCharacter(context: CanvasRenderingContext2D, image: MvEventImage, x: number, y: number, getCharacterImage: (name: string) => HTMLImageElement | null): boolean {
  const bitmap = getCharacterImage(image.characterName || '');
  if (!bitmap) return false;
  const frame = eventCharacterFrame(bitmap, image);
  if (!frame) return false;
  const dx = Math.round(x + TILE_SIZE / 2 - frame.sw / 2);
  const dy = Math.round(y + TILE_SIZE - frame.sh);
  context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, dx, dy, frame.sw, frame.sh);
  return true;
}

export function eventCharacterFrame(bitmap: HTMLImageElement, image: MvEventImage): { sx: number; sy: number; sw: number; sh: number } | null {
  const name = image.characterName || '';
  const big = isBigCharacterName(name);
  const pw = bitmap.naturalWidth / (big ? 3 : 12);
  const ph = bitmap.naturalHeight / (big ? 4 : 8);
  if (!Number.isFinite(pw) || !Number.isFinite(ph) || pw <= 0 || ph <= 0) return null;
  const index = clampInt(image.characterIndex, 0, 7);
  const pattern = clampInt(image.pattern == null ? 1 : image.pattern, 0, 2);
  const direction = [2, 4, 6, 8].includes(Number(image.direction)) ? Number(image.direction) : 2;
  const blockX = big ? 0 : (index % 4) * 3;
  const blockY = big ? 0 : Math.floor(index / 4) * 4;
  return {
    sx: Math.floor((blockX + pattern) * pw),
    sy: Math.floor((blockY + (direction - 2) / 2) * ph),
    sw: Math.floor(pw),
    sh: Math.floor(ph),
  };
}

export function isBigCharacterName(name: string): boolean {
  const sign = String(name || '').match(/^[!$]+/);
  return Boolean(sign && sign[0].includes('$'));
}

function clampInt(value: number | undefined, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
