import fs from "fs";
import path from "path";
import zlib from "zlib";

import { readJson, writeJson } from "../../rmmv/json.ts";
import { resolveDataDir } from "../../rmmv/project-scanner.ts";
import { resolveCliOutRoot, resolveWorkflowRoot } from "../../workspace-paths.ts";

const TILE_SIZE = 48;

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

interface DecodedPng {
  width: number;
  height: number;
  rgba: Buffer;
}

interface MapData {
  width: number;
  height: number;
  tilesetId: number;
  data: number[];
  [key: string]: unknown;
}

interface Tileset {
  name?: string;
  tilesetNames?: string[];
  [key: string]: unknown;
}

interface MapRenderOptions {
  mapId?: number;
  scale?: number;
  outDir?: string;
}

interface MapRenderReport {
  generatedAt: string;
  status: string;
  project: string;
  dataDir: string;
  mapId: number;
  mapFile: string;
  tilesetId: number;
  tilesetName: string;
  imageDir: string;
  size: { width: number; height: number; tileSize: number };
  output: { png: string; width: number; height: number; scale: number };
  renderedTiles: number;
  warnings: string[];
  limitations: string[];
  outDir?: string;
}

const FLOOR_TABLE: number[][][] = [
  [[2, 4], [1, 4], [2, 3], [1, 3]], [[2, 0], [1, 4], [2, 3], [1, 3]], [[2, 4], [3, 0], [2, 3], [1, 3]], [[2, 0], [3, 0], [2, 3], [1, 3]],
  [[2, 4], [1, 4], [2, 3], [3, 1]], [[2, 0], [1, 4], [2, 3], [3, 1]], [[2, 4], [3, 0], [2, 3], [3, 1]], [[2, 0], [3, 0], [2, 3], [3, 1]],
  [[2, 4], [1, 4], [2, 1], [1, 3]], [[2, 0], [1, 4], [2, 1], [1, 3]], [[2, 4], [3, 0], [2, 1], [1, 3]], [[2, 0], [3, 0], [2, 1], [1, 3]],
  [[2, 4], [1, 4], [2, 1], [3, 1]], [[2, 0], [1, 4], [2, 1], [3, 1]], [[2, 4], [3, 0], [2, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]],
  [[0, 4], [1, 4], [0, 3], [1, 3]], [[0, 4], [3, 0], [0, 3], [1, 3]], [[0, 4], [1, 4], [0, 3], [3, 1]], [[0, 4], [3, 0], [0, 3], [3, 1]],
  [[2, 2], [1, 2], [2, 3], [1, 3]], [[2, 2], [1, 2], [2, 3], [3, 1]], [[2, 2], [1, 2], [2, 1], [1, 3]], [[2, 2], [1, 2], [2, 1], [3, 1]],
  [[2, 4], [3, 4], [2, 3], [3, 3]], [[2, 4], [3, 4], [2, 1], [3, 3]], [[2, 0], [3, 4], [2, 3], [3, 3]], [[2, 0], [3, 4], [2, 1], [3, 3]],
  [[2, 4], [1, 4], [2, 5], [1, 5]], [[2, 0], [1, 4], [2, 5], [1, 5]], [[2, 4], [3, 0], [2, 5], [1, 5]], [[2, 0], [3, 0], [2, 5], [1, 5]],
  [[0, 4], [3, 4], [0, 3], [3, 3]], [[2, 2], [1, 2], [2, 5], [1, 5]], [[0, 2], [1, 2], [0, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [3, 1]],
  [[2, 2], [3, 2], [2, 3], [3, 3]], [[2, 2], [3, 2], [2, 1], [3, 3]], [[2, 4], [3, 4], [2, 5], [3, 5]], [[2, 0], [3, 4], [2, 5], [3, 5]],
  [[0, 4], [1, 4], [0, 5], [1, 5]], [[0, 4], [3, 0], [0, 5], [1, 5]], [[0, 2], [3, 2], [0, 3], [3, 3]], [[0, 2], [1, 2], [0, 5], [1, 5]],
  [[0, 4], [3, 4], [0, 5], [3, 5]], [[2, 2], [3, 2], [2, 5], [3, 5]], [[0, 2], [3, 2], [0, 5], [3, 5]], [[0, 0], [1, 0], [0, 1], [1, 1]]
];

const WALL_TABLE: number[][][] = [
  [[2, 2], [1, 2], [2, 1], [1, 1]], [[0, 2], [1, 2], [0, 1], [1, 1]], [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[2, 2], [3, 2], [2, 1], [3, 1]], [[0, 2], [3, 2], [0, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]],
  [[2, 2], [1, 2], [2, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [1, 3]], [[2, 0], [1, 0], [2, 3], [1, 3]], [[0, 0], [1, 0], [0, 3], [1, 3]],
  [[2, 2], [3, 2], [2, 3], [3, 3]], [[0, 2], [3, 2], [0, 3], [3, 3]], [[2, 0], [3, 0], [2, 3], [3, 3]], [[0, 0], [3, 0], [0, 3], [3, 3]]
];

const WATERFALL_TABLE: number[][][] = [
  [[2, 0], [1, 0], [2, 1], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]], [[0, 0], [3, 0], [0, 1], [3, 1]]
];

function runMapRender(projectRoot: string, options: MapRenderOptions = {}): MapRenderReport {
  const project = path.resolve(projectRoot);
  const mapId = options.mapId;
  if (!Number.isInteger(mapId)) throw new Error("mapId must be an integer.");

  const scale = Number.isInteger(options.scale) ? options.scale! : 1;
  if (scale < 1 || scale > 8) throw new Error("--scale must be an integer from 1 to 8.");

  const dataDir = resolveDataDir(project);
  const mapFile = path.join(dataDir, `Map${String(mapId).padStart(3, "0")}.json`);
  if (!fs.existsSync(mapFile)) throw new Error(`Map file not found: ${mapFile}`);

  const tilesetsFile = path.join(dataDir, "Tilesets.json");
  const map: MapData = readJson(mapFile) as MapData;
  const tilesets: Tileset[] = readJson(tilesetsFile) as Tileset[];
  const tileset = tilesets[map.tilesetId];
  if (!tileset) throw new Error(`Tileset ${map.tilesetId} not found in ${tilesetsFile}`);

  const warnings: string[] = [];
  const imageDir = resolveTilesetImageDir(project, dataDir);
  const bitmaps = loadTilesetBitmaps(tileset, imageDir, warnings);
  const rendered = renderMapToPng(map, bitmaps, scale as number);

  const outDir = path.resolve(
    options.outDir
      || path.join(resolveCliOutRoot(resolveWorkflowRoot(process.cwd())), `map-${String(mapId).padStart(3, "0")}-render`),
  );
  fs.mkdirSync(outDir, { recursive: true });
  const renderPng = path.join(outDir, "map-render.png");
  fs.writeFileSync(renderPng, rendered.png);

  const report: MapRenderReport = {
    generatedAt: new Date().toISOString(),
    status: warnings.length ? "review" : "pass",
    project,
    dataDir,
    mapId: mapId as number,
    mapFile,
    tilesetId: map.tilesetId,
    tilesetName: tileset.name || "",
    imageDir,
    size: {
      width: map.width,
      height: map.height,
      tileSize: TILE_SIZE
    },
    output: {
      png: renderPng,
      width: rendered.width,
      height: rendered.height,
      scale
    },
    renderedTiles: rendered.drawnTiles,
    warnings,
    limitations: [
      "This is an offline tile-layer render, not a live RPG Maker MV runtime screenshot.",
      "It renders map tile layers 0..3 and does not render events, player, plugins, weather, screen tint, animations, or runtime effects.",
      "Use map-screenshot when runtime proof is required."
    ]
  };

  writeJson(path.join(outDir, "map-render.json"), report);
  fs.writeFileSync(path.join(outDir, "map-render.md"), renderMarkdown(report), "utf8");
  return report;
}

function resolveTilesetImageDir(project: string, dataDir: string): string {
  const sibling = path.join(path.dirname(dataDir), "img", "tilesets");
  if (fs.existsSync(sibling)) return sibling;
  return path.join(project, "www", "img", "tilesets");
}

function loadTilesetBitmaps(tileset: Tileset, imageDir: string, warnings: string[]): (DecodedPng | null)[] {
  return (tileset.tilesetNames || []).map((name, slotIndex) => {
    if (!name) return null;
    const filePath = path.join(imageDir, `${name}.png`);
    if (!fs.existsSync(filePath)) {
      warnings.push(`Missing tileset image for slot ${slotIndex}: ${filePath}`);
      return null;
    }
    return decodePng(fs.readFileSync(filePath));
  });
}

function renderMapToPng(map: MapData, bitmaps: (DecodedPng | null)[], scale: number): { png: Buffer; width: number; height: number; drawnTiles: number } {
  const width = map.width;
  const height = map.height;
  const layerSize = width * height;
  const outputWidth = width * TILE_SIZE;
  const outputHeight = height * TILE_SIZE;
  const canvas = Buffer.alloc(outputWidth * outputHeight * 4);
  for (let index = 0; index < outputWidth * outputHeight; index += 1) {
    canvas[index * 4 + 3] = 255;
  }

  let drawnTiles = 0;
  const blit = (src: DecodedPng | null, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => blitImage(src, sx, sy, sw, sh, canvas, outputWidth, outputHeight, dx, dy);

  for (let z = 0; z < 4; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tileId = map.data[z * layerSize + y * width + x];
        if (!tileId || tileId <= 0) continue;
        if (tileId >= 2048) drawAutotile(tileId, x * TILE_SIZE, y * TILE_SIZE, bitmaps, blit);
        else drawNormalTile(tileId, x * TILE_SIZE, y * TILE_SIZE, bitmaps, blit);
        drawnTiles += 1;
      }
    }
  }

  const scaled = scaleImage(canvas, outputWidth, outputHeight, scale);
  return {
    png: encodePng(scaled.width, scaled.height, scaled.rgba),
    width: scaled.width,
    height: scaled.height,
    drawnTiles
  };
}

function drawNormalTile(tileId: number, dx: number, dy: number, bitmaps: (DecodedPng | null)[], blit: (src: DecodedPng | null, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => void): void {
  const setNumber = tileId >= 1536 && tileId < 2048 ? 4 : 5 + Math.floor(tileId / 256);
  const src = bitmaps[setNumber];
  const sx = (Math.floor(tileId / 128) % 2 * 8 + tileId % 8) * TILE_SIZE;
  const sy = (Math.floor((tileId % 256) / 8) % 16) * TILE_SIZE;
  blit(src, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy);
}

function drawAutotile(tileId: number, dx: number, dy: number, bitmaps: (DecodedPng | null)[], blit: (src: DecodedPng | null, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => void): void {
  let table = FLOOR_TABLE;
  const kind = Math.floor((tileId - 2048) / 48);
  const shape = (tileId - 2048) % 48;
  const tx = kind % 8;
  const ty = Math.floor(kind / 8);
  let bx = 0;
  let by = 0;
  let setNumber = 0;
  const animationFrame = 0;

  if (tileId >= 2048 && tileId < 2816) {
    setNumber = 0;
    if (kind === 0) {
      bx = animationFrame * 2;
      by = 0;
    } else if (kind === 1) {
      bx = animationFrame * 2;
      by = 3;
    } else if (kind === 2) {
      bx = 6;
      by = 0;
    } else if (kind === 3) {
      bx = 6;
      by = 3;
    } else {
      bx = Math.floor(tx / 4) * 8;
      by = ty * 6 + (Math.floor(tx / 2) % 2) * 3;
      if (kind % 2 === 0) bx += animationFrame * 2;
      else {
        bx += 6;
        table = WATERFALL_TABLE;
      }
    }
  } else if (tileId >= 2816 && tileId < 4352) {
    setNumber = 1;
    bx = tx * 2;
    by = (ty - 2) * 3;
  } else if (tileId >= 4352 && tileId < 5888) {
    setNumber = 2;
    bx = tx * 2;
    by = (ty - 6) * 2;
    table = WALL_TABLE;
  } else if (tileId >= 5888 && tileId < 8192) {
    setNumber = 3;
    bx = tx * 2;
    by = Math.floor((ty - 10) * 2.5 + (ty % 2 === 1 ? 0.5 : 0));
    if (ty % 2 === 1) table = WALL_TABLE;
  }

  const quarters = table[shape];
  const src = bitmaps[setNumber];
  if (!quarters || !src) return;
  for (let index = 0; index < 4; index += 1) {
    const sx = (bx * 2 + quarters[index][0]) * 24;
    const sy = (by * 2 + quarters[index][1]) * 24;
    blit(src, sx, sy, 24, 24, dx + (index % 2) * 24, dy + Math.floor(index / 2) * 24);
  }
}

function blitImage(src: DecodedPng | null, sx: number, sy: number, sw: number, sh: number, dest: Buffer, destWidth: number, destHeight: number, dx: number, dy: number): void {
  if (!src) return;
  for (let y = 0; y < sh; y += 1) {
    const srcY = sy + y;
    if (srcY < 0 || srcY >= src.height) continue;
    for (let x = 0; x < sw; x += 1) {
      const srcX = sx + x;
      if (srcX < 0 || srcX >= src.width) continue;
      const srcIndex = (srcY * src.width + srcX) * 4;
      const alpha = src.rgba[srcIndex + 3] / 255;
      if (alpha <= 0) continue;

      const destX = dx + x;
      const destY = dy + y;
      if (destX < 0 || destY < 0 || destX >= destWidth || destY >= destHeight) continue;
      const destIndex = (destY * destWidth + destX) * 4;
      dest[destIndex] = Math.round(src.rgba[srcIndex] * alpha + dest[destIndex] * (1 - alpha));
      dest[destIndex + 1] = Math.round(src.rgba[srcIndex + 1] * alpha + dest[destIndex + 1] * (1 - alpha));
      dest[destIndex + 2] = Math.round(src.rgba[srcIndex + 2] * alpha + dest[destIndex + 2] * (1 - alpha));
      dest[destIndex + 3] = 255;
    }
  }
}

function scaleImage(rgba: Buffer, width: number, height: number, scale: number): { width: number; height: number; rgba: Buffer } {
  if (scale === 1) return { width, height, rgba };
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const scaled = Buffer.alloc(scaledWidth * scaledHeight * 4);
  for (let y = 0; y < scaledHeight; y += 1) {
    for (let x = 0; x < scaledWidth; x += 1) {
      const srcIndex = (((y / scale) | 0) * width + ((x / scale) | 0)) * 4;
      const destIndex = (y * scaledWidth + x) * 4;
      scaled[destIndex] = rgba[srcIndex];
      scaled[destIndex + 1] = rgba[srcIndex + 1];
      scaled[destIndex + 2] = rgba[srcIndex + 2];
      scaled[destIndex + 3] = rgba[srcIndex + 3];
    }
  }
  return { width: scaledWidth, height: scaledHeight, rgba: scaled };
}

function decodePng(buffer: Buffer): DecodedPng {
  let offset = 8;
  let header: PngHeader | null = null;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error("Invalid PNG: missing IHDR.");
  if (header.bitDepth !== 8 || header.interlace !== 0) throw new Error("Only 8-bit non-interlaced PNG files are supported.");

  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = channels[header.colorType];
  if (!ch) throw new Error(`Unsupported PNG color type: ${header.colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = header.width * ch;
  const pixels = Buffer.alloc(header.height * stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rowStart + x];
      const left = x >= ch ? pixels[y * stride + x - ch] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= ch && y > 0 ? pixels[(y - 1) * stride + x - ch] : 0;
      let value: number;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + left;
      else if (filter === 2) value = rawByte + up;
      else if (filter === 3) value = rawByte + ((left + up) >> 1);
      else if (filter === 4) value = rawByte + paeth(left, up, upLeft);
      else throw new Error(`Unsupported PNG filter: ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }

  return unpackRgba(header, pixels, palette, transparency);
}

function unpackRgba(header: PngHeader, pixels: Buffer, palette: Buffer | null, transparency: Buffer | null): DecodedPng {
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let index = 0; index < header.width * header.height; index += 1) {
    let r: number;
    let g: number;
    let b: number;
    let a: number;
    if (header.colorType === 6) {
      r = pixels[index * 4];
      g = pixels[index * 4 + 1];
      b = pixels[index * 4 + 2];
      a = pixels[index * 4 + 3];
    } else if (header.colorType === 2) {
      r = pixels[index * 3];
      g = pixels[index * 3 + 1];
      b = pixels[index * 3 + 2];
      a = 255;
    } else if (header.colorType === 0) {
      r = pixels[index];
      g = pixels[index];
      b = pixels[index];
      a = 255;
    } else if (header.colorType === 4) {
      r = pixels[index * 2];
      g = pixels[index * 2];
      b = pixels[index * 2];
      a = pixels[index * 2 + 1];
    } else {
      const paletteIndex = pixels[index];
      r = palette![paletteIndex * 3];
      g = palette![paletteIndex * 3 + 1];
      b = palette![paletteIndex * 3 + 2];
      a = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
    }
    rgba[index * 4] = r;
    rgba[index * 4 + 1] = g;
    rgba[index * 4 + 2] = b;
    rgba[index * 4 + 3] = a;
  }
  return { width: header.width, height: header.height, rgba };
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let number = 0; number < 256; number += 1) {
    let crc = number;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[number] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

function renderMarkdown(report: MapRenderReport): string {
  const lines = [
    "# Map Render",
    "",
    `- status: ${report.status}`,
    `- project: ${report.project}`,
    `- map: Map${String(report.mapId).padStart(3, "0")}`,
    `- tileset: ${report.tilesetId} ${report.tilesetName}`,
    `- size: ${report.size.width}x${report.size.height} tiles`,
    `- output: ${report.output.png}`,
    `- outputPixels: ${report.output.width}x${report.output.height}`,
    `- scale: ${report.output.scale}`,
    `- renderedTiles: ${report.renderedTiles}`,
    "",
    "## Limits",
    "",
    ...report.limitations.map((item) => `- ${item}`)
  ];
  if (report.warnings.length) {
    lines.push("", "## Warnings", "", ...report.warnings.map((item) => `- ${item}`));
  }
  lines.push("");
  return lines.join("\n");
}

export {
  runMapRender,
  decodePng,
  encodePng
};
