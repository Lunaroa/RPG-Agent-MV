import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';

import sharp from 'sharp';

import type {
  MapOverviewPngExportProgressEvent,
  MapOverviewPngExportErrorCode,
  MapOverviewPngExportScene,
  MapOverviewPngExportStatus,
} from '../../../../contract/types.ts';
import {
  buildMapOverviewSvgEdgeRoutes,
  mapOverviewSvgBoundsIntersect,
  mapOverviewSvgEdgeGeometry,
  mapOverviewSvgExportBounds,
  mapOverviewSvgNodeBounds,
  mapOverviewSvgNodeGeometry,
  type MapOverviewSvgBounds,
  type MapOverviewSvgEdgeGeometry,
  type MapOverviewSvgNodeGeometry,
} from '../../../../contract/map-overview-svg-geometry.ts';
import { readCachedMapOverviewThumbnail } from './map-overview-service.ts';

export const MAP_OVERVIEW_EXPORT_MAX_DIMENSION = 32_767;
export const MAP_OVERVIEW_EXPORT_MAX_PIXELS = 500_000_000;
export const MAP_OVERVIEW_EXPORT_STRIP_PIXELS = 16_777_216;
const STRIP_BLEED = 20;

export interface MapOverviewPngExportWorkerRequest {
  workflowRoot: string;
  project: string;
  outputPath: string;
  scene: MapOverviewPngExportScene;
}

type WorkerMessage =
  | { type: 'progress'; status: MapOverviewPngExportProgressEvent }
  | { type: 'complete'; status: MapOverviewPngExportStatus }
  | { type: 'failed'; status: MapOverviewPngExportStatus };

interface PreparedScene {
  nodes: MapOverviewSvgNodeGeometry[];
  edges: Array<{ edge: MapOverviewPngExportScene['edges'][number]; geometry: MapOverviewSvgEdgeGeometry }>;
  images: Map<number, string>;
  bounds: ReturnType<typeof mapOverviewSvgExportBounds>;
}

if (!parentPort) throw new Error('Map overview PNG export worker requires a parent port.');

parentPort.once('message', (request: MapOverviewPngExportWorkerRequest) => {
  void runExport(request).catch(error => {
    const status = createStatus(request.scene, 'failed', {
      error: error instanceof Error ? error.message : String(error),
      errorCode: classifyExportError(error),
      ...extractErrorDimensions(error),
      finishedAt: new Date().toISOString(),
    });
    parentPort!.postMessage({ type: 'failed', status } satisfies WorkerMessage);
    parentPort!.close();
  });
});

async function runExport(request: MapOverviewPngExportWorkerRequest): Promise<void> {
  validateRequest(request);
  const prepared = prepareScene(request);
  validateOutputBounds(prepared.bounds.width, prepared.bounds.height);
  validateDiskSpace(request.outputPath, prepared.bounds.width, prepared.bounds.height);
  const artifacts = exportArtifactPaths(request.workflowRoot, request.outputPath, request.scene.requestId);
  fs.mkdirSync(artifacts.tempDirectory, { recursive: true });
  writeExportJournal(artifacts.journalPath, request.outputPath, artifacts);
  let completed = false;
  let completedStatus: MapOverviewPngExportStatus | null = null;
  try {
    const contentHeight = Math.max(1, Math.floor(MAP_OVERVIEW_EXPORT_STRIP_PIXELS / prepared.bounds.width) - STRIP_BLEED * 2);
    const total = Math.max(1, Math.ceil(prepared.bounds.height / contentHeight));
    sendProgress(request.scene, 'preflight', prepared.bounds.width, prepared.bounds.height, 0, total);
    const strips: Array<{ input: string; top: number; left: number }> = [];
    for (let index = 0; index < total; index += 1) {
      const top = index * contentHeight;
      const height = Math.min(contentHeight, prepared.bounds.height - top);
      const bleedTop = index === 0 ? 0 : STRIP_BLEED;
      const bleedBottom = index === total - 1 ? 0 : STRIP_BLEED;
      const renderTop = top - bleedTop;
      const renderHeight = height + bleedTop + bleedBottom;
      const svg = buildStripSvg(prepared, renderTop, renderHeight);
      const rawStrip = path.join(artifacts.tempDirectory, `strip-${String(index).padStart(5, '0')}-raw.png`);
      const finalStrip = path.join(artifacts.tempDirectory, `strip-${String(index).padStart(5, '0')}.png`);
      await sharp(Buffer.from(svg), { limitInputPixels: false, sequentialRead: true })
        .png({ compressionLevel: 3, adaptiveFiltering: false })
        .toFile(rawStrip);
      if (bleedTop || bleedBottom) {
        await sharp(rawStrip, { limitInputPixels: false, sequentialRead: true })
          .extract({ left: 0, top: bleedTop, width: prepared.bounds.width, height })
          .png({ compressionLevel: 3, adaptiveFiltering: false })
          .toFile(finalStrip);
        fs.rmSync(rawStrip, { force: true });
      } else {
        fs.renameSync(rawStrip, finalStrip);
      }
      strips.push({ input: finalStrip, left: 0, top });
      sendProgress(request.scene, 'rendering', prepared.bounds.width, prepared.bounds.height, index + 1, total);
    }

    sendProgress(request.scene, 'encoding', prepared.bounds.width, prepared.bounds.height, total, total);
    await sharp({
      create: {
        width: prepared.bounds.width,
        height: prepared.bounds.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
      limitInputPixels: false,
    })
      .composite(strips)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(artifacts.partialPath);
    replaceOutputAtomically(request.outputPath, artifacts.partialPath, artifacts.backupPath);
    completed = true;
    completedStatus = createStatus(request.scene, 'completed', {
      width: prepared.bounds.width,
      height: prepared.bounds.height,
      completed: total,
      total,
      outputPath: request.outputPath,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    fs.rmSync(artifacts.tempDirectory, { recursive: true, force: true });
    if (!completed) fs.rmSync(artifacts.partialPath, { force: true });
    fs.rmSync(artifacts.journalPath, { force: true });
  }
  if (!completedStatus) throw new Error('Map overview PNG export completed without a final status.');
  parentPort!.postMessage({ type: 'complete', status: completedStatus } satisfies WorkerMessage);
  parentPort!.close();
}

function validateRequest(request: MapOverviewPngExportWorkerRequest): void {
  if (!request || typeof request !== 'object') throw new Error('Map overview export request is missing.');
  if (!path.isAbsolute(request.outputPath) || path.extname(request.outputPath).toLowerCase() !== '.png') {
    throw new Error('Map overview export target must be an absolute PNG path selected by the desktop dialog.');
  }
  if (request.scene.project !== request.project) throw new Error('Map overview export project does not match the active project.');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.scene.requestId)) throw new Error('Invalid map overview export request id.');
  if (!request.scene.nodes.length) throw new Error('There are no maps to export.');
}

function prepareScene(request: MapOverviewPngExportWorkerRequest): PreparedScene {
  const nodes = request.scene.nodes.map(node => {
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
      throw new Error(`MAP${String(node.id).padStart(3, '0')} has an invalid export position.`);
    }
    return mapOverviewSvgNodeGeometry({
      id: node.id,
      name: node.name,
      readState: node.readState,
      width: node.mapWidth,
      height: node.mapHeight,
    }, node.position);
  });
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const routes = buildMapOverviewSvgEdgeRoutes(request.scene.edges);
  const edges = request.scene.edges.map(edge => ({
    edge,
    geometry: mapOverviewSvgEdgeGeometry(edge, nodeMap, routes.get(edge.id)),
  }));
  const images = new Map<number, string>();
  for (const node of request.scene.nodes) {
    if (node.readState !== 'ready') continue;
    if (!node.thumbnailVersion) throw new Error(`MAP${String(node.id).padStart(3, '0')} has no thumbnail version.`);
    const thumbnail = readCachedMapOverviewThumbnail(
      request.workflowRoot,
      request.project,
      node.id,
      node.thumbnailVersion,
    );
    if (!thumbnail) {
      throw new Error(`MAP${String(node.id).padStart(3, '0')} thumbnail cache changed. Reload Map Overview and retry.`);
    }
    if (thumbnail.width !== node.mapWidth * 12 || thumbnail.height !== node.mapHeight * 12) {
      throw new Error(`MAP${String(node.id).padStart(3, '0')} thumbnail cache has an unexpected size.`);
    }
    images.set(node.id, thumbnail.dataUrl);
  }
  return { nodes, edges, images, bounds: mapOverviewSvgExportBounds(nodes, edges.map(item => item.geometry)) };
}

function buildStripSvg(prepared: PreparedScene, outputTop: number, outputHeight: number): string {
  const worldTop = prepared.bounds.minY + outputTop;
  const stripBounds: MapOverviewSvgBounds = {
    minX: prepared.bounds.minX,
    minY: worldTop,
    maxX: prepared.bounds.maxX,
    maxY: worldTop + outputHeight,
  };
  const edges = prepared.edges.filter(item => mapOverviewSvgBoundsIntersect(item.geometry.bounds, stripBounds));
  const nodes = prepared.nodes.filter(node => mapOverviewSvgBoundsIntersect(mapOverviewSvgNodeBounds(node), stripBounds));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${prepared.bounds.width}" height="${outputHeight}" viewBox="${prepared.bounds.minX} ${worldTop} ${prepared.bounds.width} ${outputHeight}">`,
    '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L0,4 L6,2 z" fill="#8c8d86"/></marker></defs>',
    '<g fill="none" stroke="#8c8d86" stroke-width="1" stroke-opacity=".48" stroke-linecap="round" stroke-linejoin="round">',
    ...edges.map(item => `<path d="${item.geometry.path}" marker-end="url(#arrow)"/>`),
    '</g>',
    ...edges.filter(item => item.edge.count > 1).map(item => (
      `<text x="${item.geometry.label.x}" y="${item.geometry.label.y}" fill="#5f605a" fill-opacity=".7" stroke="#f7f7f4" stroke-width="2.5" paint-order="stroke" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="10" font-weight="600">×${item.edge.count}</text>`
    )),
    ...nodes.map(node => nodeSvg(node, prepared.images.get(node.id))),
    '</svg>',
  ].join('');
}

function nodeSvg(node: MapOverviewSvgNodeGeometry, image?: string): string {
  const left = node.position.x - node.width / 2;
  const top = node.position.y - node.imageHeight / 2;
  const label = `${node.name} MAP${String(node.id).padStart(3, '0')}`;
  const labelWidth = node.labelWidth;
  const invalidStyle = node.readState === 'ready'
    ? ''
    : ' stroke="#c2412d" stroke-width="2" stroke-dasharray="6 4"';
  return [
    `<g>`,
    `<rect x="${left}" y="${top}" width="${node.width}" height="${node.imageHeight}" rx="2" fill="#f7f7f4"/>`,
    image ? `<image x="${left}" y="${top}" width="${node.width}" height="${node.imageHeight}" preserveAspectRatio="none" href="${image}"/>` : '',
    invalidStyle ? `<rect x="${left}" y="${top}" width="${node.width}" height="${node.imageHeight}" rx="2" fill="none"${invalidStyle}/>` : '',
    `<rect x="${node.position.x - labelWidth / 2}" y="${node.position.y + node.imageHeight / 2 + 8}" width="${labelWidth}" height="24" rx="4" fill="#f7f7f4" fill-opacity=".9"/>`,
    `<text x="${node.position.x}" y="${node.position.y + node.imageHeight / 2 + 24}" text-anchor="middle" fill="#282923" font-family="sans-serif" font-size="13" font-weight="600" textLength="${Math.max(1, labelWidth - 12)}" lengthAdjust="spacingAndGlyphs">${escapeXml(label)}</text>`,
    '</g>',
  ].join('');
}

function validateOutputBounds(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Map overview export dimensions are invalid.');
  }
  const pixels = width * height;
  if (width > MAP_OVERVIEW_EXPORT_MAX_DIMENSION || height > MAP_OVERVIEW_EXPORT_MAX_DIMENSION || pixels > MAP_OVERVIEW_EXPORT_MAX_PIXELS) {
    throw new Error(`Map overview export is ${width} × ${height} (${pixels} pixels). The supported limit is ${MAP_OVERVIEW_EXPORT_MAX_DIMENSION} per side and ${MAP_OVERVIEW_EXPORT_MAX_PIXELS} total pixels.`);
  }
}

function validateDiskSpace(outputPath: string, width: number, height: number): void {
  const directory = path.dirname(outputPath);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('The export directory no longer exists.');
  const stats = fs.statfsSync(directory);
  const available = BigInt(stats.bavail) * BigInt(stats.bsize);
  const required = BigInt(Math.ceil(width * height * 4 * 1.1 + 64 * 1024 * 1024));
  if (available < required) {
    throw new Error(`Not enough disk space for the PNG export. At least ${formatBytes(required)} free space is required.`);
  }
}

function sendProgress(
  scene: MapOverviewPngExportScene,
  phase: MapOverviewPngExportStatus['phase'],
  width: number,
  height: number,
  completed: number,
  total: number,
): void {
  const status = createStatus(scene, phase, { width, height, completed, total });
  parentPort!.postMessage({ type: 'progress', status } satisfies WorkerMessage);
}

function createStatus(
  scene: MapOverviewPngExportScene,
  phase: MapOverviewPngExportStatus['phase'],
  patch: Partial<MapOverviewPngExportStatus> = {},
): MapOverviewPngExportStatus {
  return {
    requestId: scene.requestId,
    project: scene.project,
    phase,
    width: null,
    height: null,
    completed: 0,
    total: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outputPath: null,
    error: null,
    errorCode: null,
    canceled: false,
    ...patch,
  };
}

function classifyExportError(error: unknown): MapOverviewPngExportErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/supported limit|32767|500000000/i.test(message)) return 'size-limit';
  if (/disk space|export directory/i.test(message)) return 'disk-space';
  if (/thumbnail cache|thumbnail version/i.test(message)) return 'cache-changed';
  if (/sharp|libvips|native module|could not load/i.test(message)) return 'native-runtime';
  if (/invalid|missing|no maps|outside MAP|project does not match/i.test(message)) return 'invalid-scene';
  return 'export-failed';
}

function extractErrorDimensions(error: unknown): Pick<MapOverviewPngExportStatus, 'width' | 'height'> | Record<string, never> {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/is (\d+) × (\d+)/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
}

export function exportArtifactPaths(workflowRoot: string, outputPath: string, requestId: string) {
  const runtimeRoot = path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-exports');
  return {
    runtimeRoot,
    tempDirectory: path.join(runtimeRoot, requestId),
    journalPath: path.join(runtimeRoot, `${requestId}.json`),
    partialPath: `${outputPath}.rpg-agent-${requestId}.partial`,
    backupPath: `${outputPath}.rpg-agent-${requestId}.backup`,
  };
}

function writeExportJournal(journalPath: string, outputPath: string, artifacts: ReturnType<typeof exportArtifactPaths>): void {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(journalPath, `${JSON.stringify({
    outputPath,
    partialPath: artifacts.partialPath,
    backupPath: artifacts.backupPath,
    tempDirectory: artifacts.tempDirectory,
  })}\n`, 'utf8');
}

function replaceOutputAtomically(outputPath: string, partialPath: string, backupPath: string): void {
  let movedExisting = false;
  try {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(backupPath, { force: true });
      fs.renameSync(outputPath, backupPath);
      movedExisting = true;
    }
    fs.renameSync(partialPath, outputPath);
    if (movedExisting) fs.rmSync(backupPath, { force: true });
  } catch (error) {
    if (!fs.existsSync(outputPath) && movedExisting && fs.existsSync(backupPath)) fs.renameSync(backupPath, outputPath);
    throw error;
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

function formatBytes(value: bigint): string {
  const mib = Number(value / BigInt(1024 * 1024));
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib} MiB`;
}
