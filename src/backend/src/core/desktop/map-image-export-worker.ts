import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';

type SharpModule = typeof import('sharp');
type SharpBlend = import('sharp').Blend;

const sharpModuleRelativePath = import.meta.url.endsWith('.ts')
  ? '../../../node_modules/sharp/dist/index.mjs'
  : '../../../backend/node_modules/sharp/dist/index.mjs';
const sharp = (await import(new URL(sharpModuleRelativePath, import.meta.url).href) as SharpModule).default;

import type {
  MapImageExportOptions,
  MapImageExportPreviewResult,
  MapImageExportScene,
  MapImageExportSessionInfo,
} from '../../../../contract/types.ts';
import { buildExtendedTilesetDescriptors } from '../../../../contract/extended-tileset.ts';
import {
  ULDS_DEFAULT_PATH,
  ULDS_DEFAULT_Z,
  ULDS_TILE_Z_THRESHOLD,
  staticUldsBlendMode,
  staticUldsBoolean,
  staticUldsCoordinate,
  staticUldsNumber,
  type UldsLayerRecord,
} from '../../../../contract/ulds.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import { closeDatabase, configureDatabase } from '../db/pool.ts';
import { getMapFileForRead, getProjectFileForRead } from './staging-service.ts';
import { decodePng, renderMapToPng } from '../workflow/map/map-render.ts';

export const MAP_IMAGE_EXPORT_MAX_DIMENSION = 32_767;
export const MAP_IMAGE_EXPORT_MAX_PIXELS = 500_000_000;
const STRIP_PIXEL_BUDGET = 16_777_216;
const FINAL_RESULT_CACHE_LIMIT = 8;

interface ValidationRequest {
  type: 'validation';
  workflowRoot: string;
  project: string;
  databasePath: string;
  scene: MapImageExportScene;
  validationOnly: true;
}

interface SessionOpenRequest {
  type: 'session-open';
  workflowRoot: string;
  project: string;
  databasePath: string;
  scene: MapImageExportScene;
}

interface SessionRenderRequest {
  type: 'session-render';
  requestId: string;
  options: MapImageExportOptions;
}

interface SessionCloseRequest {
  type: 'session-close';
}

type WorkerRequest = ValidationRequest | SessionOpenRequest | SessionRenderRequest | SessionCloseRequest;

interface CompositeLayer {
  input: Buffer | string;
  left: number;
  top: number;
  blend?: SharpBlend;
  tile?: boolean;
}

type LayerGroup = CompositeLayer[] | Error;

interface SessionState {
  request: SessionOpenRequest;
  nativeWidth: number;
  nativeHeight: number;
  maxScalePercent: number;
  groups: {
    parallax: CompositeLayer[];
    uldsBelow: LayerGroup;
    tiles: CompositeLayer[];
    uldsAbove: LayerGroup;
    events: LayerGroup;
  };
  nativeByOptions: Map<string, Buffer>;
  finalByKey: Map<string, { width: number; height: number; png: Buffer }>;
}

if (!parentPort) throw new Error('Map image export worker requires a parent port.');

let session: SessionState | null = null;
let renderChain: Promise<void> = Promise.resolve();
const renderQueue: SessionRenderRequest[] = [];
let closing = false;

parentPort.on('message', (request: WorkerRequest) => {
  if (request.type === 'validation') {
    void runValidation(request);
    return;
  }
  if (request.type === 'session-open') {
    void openSession(request);
    return;
  }
  if (request.type === 'session-render') {
    if (closing) {
      parentPort!.postMessage({
        type: 'session-render-result',
        requestId: request.requestId,
        ok: false,
        error: '[MAP_IMAGE_PREVIEW_CANCELLED] The export session is closed.',
      });
      return;
    }
    enqueueRender(request);
    return;
  }
  if (request.type === 'session-close') renderChain = renderChain.then(shutdown);
});

process.once('exit', () => closeDatabase());

async function runValidation(request: ValidationRequest): Promise<void> {
  try {
    configureDatabase({ path: request.databasePath });
    validateSceneSnapshot(request);
    parentPort!.postMessage({ ok: true, result: { validated: true } });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    shutdown();
  }
}

async function openSession(request: SessionOpenRequest): Promise<void> {
  try {
    configureDatabase({ path: request.databasePath });
    const { nativeWidth, nativeHeight, maxScalePercent } = validateSceneSnapshot(request);
    const { scene } = request;
    const resourceRoot = path.dirname(resolveDataDir(request.project));
    const bitmaps = scene.tileset.tilesetNames.map((name) => {
      if (!name) return null;
      const file = effectiveResource(request, resourceRoot, 'tilesets', name);
      if (!file) throw new Error(`[MAP_IMAGE_RESOURCE_MISSING] Tileset image: ${name}`);
      return decodePng(fs.readFileSync(file));
    });
    const groups: SessionState['groups'] = {
      parallax: await clipCompositeLayers(
        await parallaxLayers(request, resourceRoot, nativeWidth, nativeHeight), nativeWidth, nativeHeight,
      ),
      uldsBelow: [],
      tiles: await clipCompositeLayers([
        ...await renderTileStrips(scene, bitmaps),
        ...shadowLayers(scene),
      ], nativeWidth, nativeHeight),
      uldsAbove: [],
      events: [],
    };
    if (scene.unlimitedLayersEnabled) {
      groups.uldsBelow = await prepareOptionalGroup(() =>
        unlimitedLayers(request, resourceRoot, nativeWidth, nativeHeight, (z) => z < ULDS_TILE_Z_THRESHOLD)
          .then((layers) => clipCompositeLayers(layers, nativeWidth, nativeHeight)));
      groups.uldsAbove = await prepareOptionalGroup(() =>
        unlimitedLayers(request, resourceRoot, nativeWidth, nativeHeight, (z) => z >= ULDS_TILE_Z_THRESHOLD)
          .then((layers) => clipCompositeLayers(layers, nativeWidth, nativeHeight)));
    }
    groups.events = await prepareOptionalGroup(() =>
      eventCharacterLayers(request, resourceRoot)
        .then((layers) => clipCompositeLayers(layers, nativeWidth, nativeHeight)));
    session = {
      request,
      nativeWidth,
      nativeHeight,
      maxScalePercent,
      groups,
      nativeByOptions: new Map(),
      finalByKey: new Map(),
    };
    const info: MapImageExportSessionInfo = { nativeWidth, nativeHeight, maxScalePercent };
    parentPort!.postMessage({ type: 'session-ready', ok: true, result: info });
  } catch (error) {
    parentPort!.postMessage({
      type: 'session-ready',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function prepareOptionalGroup(build: () => Promise<CompositeLayer[]>): Promise<LayerGroup> {
  try {
    return await build();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function enqueueRender(request: SessionRenderRequest): void {
  while (renderQueue.length > 0) {
    const superseded = renderQueue.shift()!;
    parentPort!.postMessage({
      type: 'session-render-result',
      requestId: superseded.requestId,
      ok: false,
      error: '[MAP_IMAGE_PREVIEW_CANCELLED] A newer preview request replaced this one.',
    });
  }
  renderQueue.push(request);
  renderChain = renderChain.then(processRenderQueue);
}

async function processRenderQueue(): Promise<void> {
  while (renderQueue.length > 0) {
    const request = renderQueue.shift()!;
    if (renderQueue.length > 0) {
      parentPort!.postMessage({
        type: 'session-render-result',
        requestId: request.requestId,
        ok: false,
        error: '[MAP_IMAGE_PREVIEW_CANCELLED] A newer preview request replaced this one.',
      });
      continue;
    }
    await renderInSession(request);
  }
}

async function renderInSession(render: SessionRenderRequest): Promise<void> {
  const active = session;
  if (!active) {
    parentPort!.postMessage({
      type: 'session-render-result',
      requestId: render.requestId,
      ok: false,
      error: '[MAP_IMAGE_SESSION_REQUIRED] The export session is not open.',
    });
    return;
  }
  try {
    const result = await renderWithCache(active, render);
    parentPort!.postMessage({ type: 'session-render-result', requestId: render.requestId, ok: true, result });
  } catch (error) {
    parentPort!.postMessage({
      type: 'session-render-result',
      requestId: render.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function renderWithCache(
  active: SessionState,
  render: SessionRenderRequest,
): Promise<MapImageExportPreviewResult> {
  assertCurrentRevision(active.request);
  assertCurrentTilesetProtocol(active.request);
  const options = render.options;
  const scene = active.request.scene;
  if (!options || !Number.isInteger(options.scalePercent) || options.scalePercent < 1 || options.scalePercent > 100) {
    throw new Error('[MAP_IMAGE_INVALID_SCALE] Scale must be an integer from 1 to 100.');
  }
  if (options.includeUnlimitedLayers && !scene.unlimitedLayersEnabled) {
    throw new Error('[MAP_IMAGE_ULDS_DISABLED] Unlimited layers must be enabled before they can be exported.');
  }
  if (options.scalePercent > active.maxScalePercent) {
    throw new Error(`[MAP_IMAGE_SIZE_LIMIT] Current map supports at most ${active.maxScalePercent}% export scale.`);
  }
  const outputWidth = Math.max(1, Math.round(active.nativeWidth * options.scalePercent / 100));
  const outputHeight = Math.max(1, Math.round(active.nativeHeight * options.scalePercent / 100));
  validateDimensions(outputWidth, outputHeight, active.maxScalePercent);

  const finalKey = `${options.scalePercent}|${options.includeDefaultEventCharacters ? 1 : 0}|${options.includeUnlimitedLayers ? 1 : 0}`;
  const cachedFinal = active.finalByKey.get(finalKey);
  if (cachedFinal) {
    active.finalByKey.delete(finalKey);
    active.finalByKey.set(finalKey, cachedFinal);
    return {
      requestId: render.requestId,
      mapId: scene.mapId,
      width: cachedFinal.width,
      height: cachedFinal.height,
      maxScalePercent: active.maxScalePercent,
      mime: 'image/png',
      pngBase64: cachedFinal.png.toString('base64'),
    };
  }

  const nativeKey = `${options.includeDefaultEventCharacters ? 1 : 0}|${options.includeUnlimitedLayers ? 1 : 0}`;
  let nativePng = active.nativeByOptions.get(nativeKey);
  if (!nativePng) {
    nativePng = await compositeNative(active, options);
    active.nativeByOptions.set(nativeKey, nativePng);
  }
  const png = outputWidth === active.nativeWidth && outputHeight === active.nativeHeight
    ? nativePng
    : await sharp(nativePng, { limitInputPixels: false })
      .resize(outputWidth, outputHeight, { kernel: sharp.kernel.nearest, fit: 'fill' })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  active.finalByKey.set(finalKey, { width: outputWidth, height: outputHeight, png });
  while (active.finalByKey.size > FINAL_RESULT_CACHE_LIMIT) {
    const oldest = active.finalByKey.keys().next().value;
    if (typeof oldest !== 'string') break;
    active.finalByKey.delete(oldest);
  }
  return {
    requestId: render.requestId,
    mapId: scene.mapId,
    width: outputWidth,
    height: outputHeight,
    maxScalePercent: active.maxScalePercent,
    mime: 'image/png',
    pngBase64: png.toString('base64'),
  };
}

async function compositeNative(active: SessionState, options: MapImageExportOptions): Promise<Buffer> {
  const composites: CompositeLayer[] = [];
  composites.push(...active.groups.parallax);
  if (options.includeUnlimitedLayers) composites.push(...unwrapGroup(active.groups.uldsBelow));
  composites.push(...active.groups.tiles);
  if (options.includeUnlimitedLayers) composites.push(...unwrapGroup(active.groups.uldsAbove));
  if (options.includeDefaultEventCharacters) composites.push(...unwrapGroup(active.groups.events));
  return sharp({
    create: {
      width: active.nativeWidth,
      height: active.nativeHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
    limitInputPixels: false,
  }).composite(composites).png({ compressionLevel: 6, adaptiveFiltering: false }).toBuffer();
}

function unwrapGroup(group: LayerGroup): CompositeLayer[] {
  if (group instanceof Error) throw group;
  return group;
}

function shutdown(): void {
  if (closing) return;
  closing = true;
  closeDatabase();
  parentPort!.close();
}

function validateSceneSnapshot(request: { scene: MapImageExportScene; project: string; workflowRoot: string }): {
  nativeWidth: number;
  nativeHeight: number;
  maxScalePercent: number;
} {
  validateScene(request);
  assertCurrentRevision(request);
  assertCurrentTilesetProtocol(request);
  const { scene } = request;
  const nativeWidth = scene.map.width * scene.tileSize;
  const nativeHeight = scene.map.height * scene.tileSize;
  const maxScalePercent = maximumScalePercent(nativeWidth, nativeHeight);
  if (scene.options.includeUnlimitedLayers && !scene.unlimitedLayersEnabled) {
    throw new Error('[MAP_IMAGE_ULDS_DISABLED] Unlimited layers must be enabled before they can be exported.');
  }
  return {
    nativeWidth,
    nativeHeight,
    maxScalePercent,
  };
}

function validateScene(request: { scene: MapImageExportScene; project: string }): void {
  const scene = request?.scene;
  if (!scene || scene.project !== request.project) throw new Error('[MAP_IMAGE_INVALID_SCENE] Project mismatch.');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(scene.requestId)) throw new Error('[MAP_IMAGE_INVALID_SCENE] Invalid request id.');
  if (!Number.isInteger(scene.mapId) || scene.mapId <= 0) throw new Error('[MAP_IMAGE_INVALID_SCENE] Invalid map id.');
  if (!Number.isInteger(scene.tileSize) || scene.tileSize <= 0) throw new Error('[MAP_IMAGE_INVALID_SCENE] Invalid tile size.');
  if (!Number.isInteger(scene.map.width) || !Number.isInteger(scene.map.height) || scene.map.width <= 0 || scene.map.height <= 0) {
    throw new Error('[MAP_IMAGE_INVALID_SCENE] Invalid map dimensions.');
  }
  if (!Array.isArray(scene.map.data) || !Array.isArray(scene.map.events)) throw new Error('[MAP_IMAGE_INVALID_SCENE] Invalid map snapshot.');
  if (!Number.isInteger(scene.options.scalePercent) || scene.options.scalePercent < 1 || scene.options.scalePercent > 100) {
    throw new Error('[MAP_IMAGE_INVALID_SCALE] Scale must be an integer from 1 to 100.');
  }
}

function assertCurrentRevision(request: { workflowRoot: string; project: string; scene: MapImageExportScene }): void {
  const file = getMapFileForRead(request.workflowRoot, request.project, request.scene.mapId);
  if (!file || !fs.existsSync(file)) throw new Error('[MAP_IMAGE_MAP_MISSING] The selected map no longer exists.');
  const revision = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (revision !== request.scene.mapRevision) {
    throw new Error('[MAP_IMAGE_REVISION_STALE] The map changed after this export dialog was opened. Reopen it to refresh the snapshot.');
  }
}

function assertCurrentTilesetProtocol(request: { workflowRoot: string; project: string; scene: MapImageExportScene }): void {
  const dataDir = resolveDataDir(request.project);
  const relative = path.relative(request.project, path.join(dataDir, 'Tilesets.json')).replace(/\\/g, '/');
  const file = getProjectFileForRead(request.workflowRoot, request.project, relative)
    || path.join(dataDir, 'Tilesets.json');
  if (!fs.existsSync(file)) throw new Error('[MAP_IMAGE_TILESET_MISSING] Tilesets.json is unavailable.');
  let database: unknown;
  try {
    database = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('[MAP_IMAGE_TILESET_INVALID] Tilesets.json is not valid JSON.');
  }
  const record = Array.isArray(database) ? database[request.scene.map.tilesetId] : null;
  if (!record || typeof record !== 'object') {
    throw new Error(`[MAP_IMAGE_TILESET_MISSING] Tileset ${request.scene.map.tilesetId} is unavailable.`);
  }
  const tileset = record as Record<string, unknown>;
  const names = Array.isArray(tileset.tilesetNames) ? tileset.tilesetNames.map((name) => String(name || '')) : [];
  const expected = buildExtendedTilesetDescriptors(names, tileset.rpgAgentExtendedTilesetTypes);
  const flags = Array.isArray(tileset.flags) ? tileset.flags.map((flag) => Number(flag) || 0) : [];
  if (JSON.stringify(names) !== JSON.stringify(request.scene.tileset.tilesetNames)
    || JSON.stringify(expected) !== JSON.stringify(request.scene.tileset.extendedTilesetSheets)
    || JSON.stringify(flags) !== JSON.stringify(request.scene.tileset.flags)) {
    throw new Error('[MAP_IMAGE_TILESET_STALE] The tileset changed after this export dialog was opened. Reopen it to refresh the snapshot.');
  }
}

function maximumScalePercent(nativeWidth: number, nativeHeight: number): number {
  const byWidth = MAP_IMAGE_EXPORT_MAX_DIMENSION / nativeWidth * 100;
  const byHeight = MAP_IMAGE_EXPORT_MAX_DIMENSION / nativeHeight * 100;
  const byPixels = Math.sqrt(MAP_IMAGE_EXPORT_MAX_PIXELS / (nativeWidth * nativeHeight)) * 100;
  return Math.max(0, Math.min(100, Math.floor(Math.min(byWidth, byHeight, byPixels))));
}

function validateDimensions(width: number, height: number, maxScalePercent: number): void {
  const pixels = width * height;
  if (width > MAP_IMAGE_EXPORT_MAX_DIMENSION || height > MAP_IMAGE_EXPORT_MAX_DIMENSION || pixels > MAP_IMAGE_EXPORT_MAX_PIXELS) {
    throw new Error(`[MAP_IMAGE_SIZE_LIMIT] Export is ${width} x ${height}. Maximum scale for this map is ${maxScalePercent}%.`);
  }
}

async function renderTileStrips(
  scene: MapImageExportScene,
  bitmaps: Array<ReturnType<typeof decodePng> | null>,
): Promise<CompositeLayer[]> {
  const rowPixels = scene.map.width * scene.tileSize * scene.tileSize;
  const rowsPerStrip = Math.max(1, Math.floor(STRIP_PIXEL_BUDGET / Math.max(1, rowPixels)));
  const layerSize = scene.map.width * scene.map.height;
  const layers: CompositeLayer[] = [];
  for (let startRow = 0; startRow < scene.map.height; startRow += rowsPerStrip) {
    const height = Math.min(rowsPerStrip, scene.map.height - startRow);
    const renderStartRow = Math.max(0, startRow - 1);
    const overlapRows = startRow - renderStartRow;
    const renderHeight = height + overlapRows;
    const stripData: number[] = [];
    for (let layer = 0; layer < 6; layer += 1) {
      const start = layer * layerSize + renderStartRow * scene.map.width;
      stripData.push(...scene.map.data.slice(start, start + renderHeight * scene.map.width));
    }
    const rendered = renderMapToPng({
      width: scene.map.width,
      height: renderHeight,
      tilesetId: scene.map.tilesetId,
      data: stripData,
      extendedTilesetSheets: scene.tileset.extendedTilesetSheets,
      tilesetFlags: scene.tileset.flags,
    }, bitmaps, 1, scene.tileSize, { transparent: true });
    const input = overlapRows
      ? await sharp(rendered.png, { limitInputPixels: false }).extract({
        left: 0,
        top: overlapRows * scene.tileSize,
        width: scene.map.width * scene.tileSize,
        height: height * scene.tileSize,
      }).png().toBuffer()
      : rendered.png;
    layers.push({ input, left: 0, top: startRow * scene.tileSize });
  }
  return layers;
}

async function parallaxLayers(
  request: { workflowRoot: string; project: string; scene: MapImageExportScene },
  resourceRoot: string,
  width: number,
  height: number,
): Promise<CompositeLayer[]> {
  const name = String(request.scene.map.parallaxName || '').trim();
  if (!request.scene.map.parallaxShow || !name) return [];
  const file = effectiveResource(request, resourceRoot, 'parallaxes', name);
  if (!file) throw new Error(`[MAP_IMAGE_RESOURCE_MISSING] Parallax image: ${name}`);
  const metadata = await sharp(file).metadata();
  const imageWidth = Number(metadata.width || 0);
  const imageHeight = Number(metadata.height || 0);
  if (!imageWidth || !imageHeight) throw new Error(`[MAP_IMAGE_RESOURCE_INVALID] Parallax image: ${name}`);
  return [{ input: file, left: 0, top: 0, tile: true }];
}

function shadowLayers(scene: MapImageExportScene): CompositeLayer[] {
  const base = 4 * scene.map.width * scene.map.height;
  if (scene.map.data.length <= base) return [];
  const half = scene.tileSize / 2;
  const rectangles: string[] = [];
  for (let y = 0; y < scene.map.height; y += 1) {
    for (let x = 0; x < scene.map.width; x += 1) {
      const bits = Number(scene.map.data[base + y * scene.map.width + x] || 0);
      const left = x * scene.tileSize;
      const top = y * scene.tileSize;
      if (bits & 1) rectangles.push(`<rect x="${left}" y="${top}" width="${half}" height="${half}"/>`);
      if (bits & 2) rectangles.push(`<rect x="${left + half}" y="${top}" width="${half}" height="${half}"/>`);
      if (bits & 4) rectangles.push(`<rect x="${left}" y="${top + half}" width="${half}" height="${half}"/>`);
      if (bits & 8) rectangles.push(`<rect x="${left + half}" y="${top + half}" width="${half}" height="${half}"/>`);
    }
  }
  if (!rectangles.length) return [];
  const width = scene.map.width * scene.tileSize;
  const height = scene.map.height * scene.tileSize;
  return [{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="rgba(0,0,0,.34)">${rectangles.join('')}</g></svg>`),
    left: 0,
    top: 0,
  }];
}

async function unlimitedLayers(
  request: { workflowRoot: string; project: string; scene: MapImageExportScene },
  resourceRoot: string,
  canvasWidth: number,
  canvasHeight: number,
  zGroup: (z: number) => boolean,
): Promise<CompositeLayer[]> {
  const result: CompositeLayer[] = [];
  const records = request.scene.unlimitedLayerDraft
    .map((record, index) => ({ record, index, z: staticUldsNumber(record.z, ULDS_DEFAULT_Z) }))
    .filter(({ record, z }) => staticUldsBoolean(record.visible, true) && zGroup(z))
    .sort((left, right) => left.z - right.z || left.index - right.index);
  for (const { record } of records) result.push(...await buildUnlimitedLayer(request, resourceRoot, record, canvasWidth, canvasHeight));
  return result;
}

async function buildUnlimitedLayer(
  request: { workflowRoot: string; project: string; scene: MapImageExportScene },
  resourceRoot: string,
  record: UldsLayerRecord,
  canvasWidth: number,
  canvasHeight: number,
): Promise<CompositeLayer[]> {
  const name = String(record.name || '').trim();
  if (!name) return [];
  const directory = String(record.path || ULDS_DEFAULT_PATH).trim() || ULDS_DEFAULT_PATH;
  const file = effectiveResource(request, resourceRoot, directory, name);
  if (!file) throw new Error(`[MAP_IMAGE_RESOURCE_MISSING] Unlimited layer image: ${directory}/${name}`);
  const metadata = await sharp(file).metadata();
  const sourceWidth = Number(metadata.width || 0);
  const sourceHeight = Number(metadata.height || 0);
  const scaleX = staticUldsNumber(record['scale.x'], 1);
  const scaleY = staticUldsNumber(record['scale.y'], 1);
  const drawWidth = Math.max(1, Math.round(sourceWidth * Math.abs(scaleX)));
  const drawHeight = Math.max(1, Math.round(sourceHeight * Math.abs(scaleY)));
  let image = sharp(file).resize(drawWidth, drawHeight, { kernel: sharp.kernel.nearest });
  if (scaleX < 0) image = image.flop();
  if (scaleY < 0) image = image.flip();
  const rotation = staticUldsNumber(record.rotation, 0);
  if (rotation) image = image.rotate(rotation * 180 / Math.PI, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const opacity = Math.max(0, Math.min(255, staticUldsNumber(record.opacity, 255)));
  const input = await image
    .ensureAlpha()
    .linear([1, 1, 1, opacity / 255], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const finalMeta = await sharp(input).metadata();
  const width = Number(finalMeta.width || drawWidth);
  const height = Number(finalMeta.height || drawHeight);
  const coordinateX = staticUldsCoordinate(record.x)?.value ?? 0;
  const coordinateY = staticUldsCoordinate(record.y)?.value ?? 0;
  const anchorX = staticUldsNumber(record['anchor.x'], 0);
  const anchorY = staticUldsNumber(record['anchor.y'], 0);
  const originX = Math.round(coordinateX - anchorX * drawWidth - (width - drawWidth) / 2);
  const originY = Math.round(coordinateY - anchorY * drawHeight - (height - drawHeight) / 2);
  const blend = uldsBlend(staticUldsBlendMode(record.blendMode));
  if (!staticUldsBoolean(record.loop, false)) return [{ input, left: originX, top: originY, blend }];
  const result: CompositeLayer[] = [];
  const offsetX = ((originX % width) + width) % width;
  const offsetY = ((originY % height) + height) % height;
  for (let top = offsetY - height; top < canvasHeight; top += height) {
    for (let left = offsetX - width; left < canvasWidth; left += width) result.push({ input, left, top, blend });
  }
  return result;
}

function uldsBlend(mode: number): SharpBlend {
  if (mode === 1) return 'add';
  if (mode === 2) return 'multiply';
  if (mode === 3) return 'screen';
  return 'over';
}

async function eventCharacterLayers(
  request: { workflowRoot: string; project: string; scene: MapImageExportScene },
  resourceRoot: string,
): Promise<CompositeLayer[]> {
  const result: CompositeLayer[] = [];
  for (const rawEvent of request.scene.map.events) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const event = rawEvent as Record<string, unknown>;
    const pages = Array.isArray(event.pages) ? event.pages : [];
    const page = pages[0] as Record<string, unknown> | undefined;
    const image = page?.image && typeof page.image === 'object' ? page.image as Record<string, unknown> : {};
    if (Number(image.tileId || 0) > 0) continue;
    const name = String(image.characterName || '').trim();
    if (!name) continue;
    const file = effectiveResource(request, resourceRoot, 'characters', name);
    if (!file) throw new Error(`[MAP_IMAGE_RESOURCE_MISSING] Character image: ${name}`);
    const metadata = await sharp(file).metadata();
    const big = /^[!$]*\$/.test(name);
    const frameWidth = Math.floor(Number(metadata.width || 0) / (big ? 3 : 12));
    const frameHeight = Math.floor(Number(metadata.height || 0) / (big ? 4 : 8));
    if (!frameWidth || !frameHeight) throw new Error(`[MAP_IMAGE_RESOURCE_INVALID] Character image: ${name}`);
    const index = Math.max(0, Math.min(7, Math.trunc(Number(image.characterIndex || 0))));
    const blockX = big ? 0 : index % 4 * 3;
    const blockY = big ? 0 : Math.floor(index / 4) * 4;
    const frame = await sharp(file).extract({
      left: (blockX + 1) * frameWidth,
      top: blockY * frameHeight,
      width: frameWidth,
      height: frameHeight,
    }).png().toBuffer();
    const x = Math.trunc(Number(event.x || 0)) * request.scene.tileSize;
    const y = Math.trunc(Number(event.y || 0)) * request.scene.tileSize;
    const shiftY = name.startsWith('!') || name.startsWith('$!') ? 0 : 6;
    result.push({
      input: frame,
      left: Math.round(x + request.scene.tileSize / 2 - frameWidth / 2),
      top: Math.round(y + request.scene.tileSize - frameHeight - shiftY),
    });
  }
  return result;
}

async function clipCompositeLayers(
  layers: readonly CompositeLayer[],
  canvasWidth: number,
  canvasHeight: number,
): Promise<CompositeLayer[]> {
  const result: CompositeLayer[] = [];
  for (const layer of layers) {
    if (layer.tile) {
      result.push(layer);
      continue;
    }
    const metadata = await sharp(layer.input, { limitInputPixels: false }).metadata();
    const sourceWidth = Number(metadata.width || 0);
    const sourceHeight = Number(metadata.height || 0);
    if (!sourceWidth || !sourceHeight) throw new Error('[MAP_IMAGE_RESOURCE_INVALID] Composite layer has no dimensions.');
    const left = Math.trunc(layer.left);
    const top = Math.trunc(layer.top);
    const outputLeft = Math.max(0, left);
    const outputTop = Math.max(0, top);
    const width = Math.min(canvasWidth, left + sourceWidth) - outputLeft;
    const height = Math.min(canvasHeight, top + sourceHeight) - outputTop;
    if (width <= 0 || height <= 0) continue;
    const extractLeft = outputLeft - left;
    const extractTop = outputTop - top;
    if (extractLeft === 0 && extractTop === 0 && width === sourceWidth && height === sourceHeight) {
      result.push({ ...layer, left: outputLeft, top: outputTop });
      continue;
    }
    const input = await sharp(layer.input, { limitInputPixels: false })
      .extract({ left: extractLeft, top: extractTop, width, height })
      .png()
      .toBuffer();
    result.push({ input, left: outputLeft, top: outputTop, blend: layer.blend });
  }
  return result;
}

function effectiveResource(
  request: { workflowRoot: string; project: string },
  resourceRoot: string,
  category: string,
  name: string,
): string | null {
  const categoryParts = safeResourcePathParts(category);
  const nameParts = safeResourcePathParts(name);
  const leafName = nameParts.pop()!;
  const imageRoot = path.resolve(resourceRoot, 'img');
  const absolute = path.join(imageRoot, ...categoryParts, ...nameParts, `${leafName}.png`);
  const imageRelative = path.relative(imageRoot, absolute).replace(/\\/g, '/');
  if (imageRelative.startsWith('../') || path.isAbsolute(imageRelative)) {
    throw new Error('[MAP_IMAGE_RESOURCE_INVALID] Resource is outside the image directory.');
  }
  const relative = path.relative(request.project, absolute).replace(/\\/g, '/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('[MAP_IMAGE_RESOURCE_INVALID] Resource is outside the project.');
  return getProjectFileForRead(request.workflowRoot, request.project, relative)
    || (fs.existsSync(absolute) ? absolute : null);
}

function safeResourcePathParts(value: string): string[] {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new Error('[MAP_IMAGE_RESOURCE_INVALID] Unsafe resource name.');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part))) {
    throw new Error('[MAP_IMAGE_RESOURCE_INVALID] Unsafe resource name.');
  }
  return parts;
}
