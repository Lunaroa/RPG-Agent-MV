import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { MapImageExportPreviewResult, MapImageExportScene } from '../../../../contract/types.ts';
import { getConfiguredDatabasePath } from '../db/pool.ts';

const WORKER_FILE = import.meta.url.endsWith('.ts')
  ? './map-image-export-worker.ts'
  : './map-image-export-worker.js';
const WORKER_URL = new URL(WORKER_FILE, import.meta.url);
const WORKER_EXEC_ARGV = ['--experimental-strip-types', '--experimental-transform-types'];

interface ActivePreview {
  requestId: string;
  worker: Worker;
  reject: (error: Error) => void;
}

interface ValidatedPreview {
  workflowRoot: string;
  project: string;
  scene: MapImageExportScene;
  digest: string;
  createdAt: number;
}

interface FinalizedPreviewContext {
  project: string;
  mapId: number;
  mapName: string;
}

const activeByProject = new Map<string, ActivePreview>();
const validatedByRequest = new Map<string, ValidatedPreview>();
const VALIDATED_PREVIEW_TTL_MS = 15 * 60 * 1000;
const VALIDATED_PREVIEW_LIMIT = 32;

export async function generateMapImageExportPreview(
  workflowRoot: string,
  project: string,
  scene: MapImageExportScene,
): Promise<MapImageExportPreviewResult> {
  cancelActiveProjectPreview(project);
  purgeValidatedProjectPreviews(project);
  return new Promise<MapImageExportPreviewResult>((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { execArgv: WORKER_EXEC_ARGV });
    const active: ActivePreview = { requestId: scene.requestId, worker, reject };
    activeByProject.set(project, active);
    worker.unref();
    worker.once('message', (message: { ok: boolean; result?: MapImageExportPreviewResult; error?: string }) => {
      if (activeByProject.get(project) !== active) return;
      activeByProject.delete(project);
      worker.removeAllListeners();
      if (message.ok && message.result) {
        rememberValidatedPreview(workflowRoot, project, scene, message.result);
        resolve(message.result);
      } else reject(new Error(message.error || 'Map image export failed.'));
    });
    worker.once('error', (error) => {
      if (activeByProject.get(project) !== active) return;
      activeByProject.delete(project);
      reject(error);
    });
    worker.once('exit', (code) => {
      if (activeByProject.get(project) !== active || code === 0) return;
      activeByProject.delete(project);
      reject(new Error(`Map image export worker exited with code ${code}.`));
    });
    worker.postMessage({
      workflowRoot,
      project,
      databasePath: getConfiguredDatabasePath(),
      scene: { ...scene, project },
    });
  });
}

export async function cancelMapImageExportPreview(requestId: string): Promise<{ canceled: boolean }> {
  const cached = validatedByRequest.delete(requestId);
  const active = [...activeByProject.values()].find((item) => item.requestId === requestId);
  if (!active) return { canceled: cached };
  for (const [project, item] of activeByProject) {
    if (item === active) activeByProject.delete(project);
  }
  active.reject(new Error('[MAP_IMAGE_PREVIEW_CANCELLED] Preview was superseded or closed.'));
  active.worker.removeAllListeners();
  await active.worker.terminate();
  return { canceled: true };
}

export async function validateMapImageExportPreviewForFinalization(
  preview: MapImageExportPreviewResult,
  currentUnlimitedLayersEnabled: boolean,
): Promise<FinalizedPreviewContext> {
  pruneValidatedPreviews();
  const entry = validatedByRequest.get(String(preview?.requestId || ''));
  if (!entry || entry.digest !== previewDigest(preview)) {
    throw new Error('[MAP_IMAGE_PREVIEW_INVALID] The map image preview is not a validated current result.');
  }
  if (entry.scene.options.includeUnlimitedLayers && !currentUnlimitedLayersEnabled) {
    throw new Error('[MAP_IMAGE_ULDS_DISABLED] Unlimited layers are no longer enabled. Reopen the export dialog.');
  }
  await runValidationWorker(entry);
  return { project: entry.project, mapId: entry.scene.mapId, mapName: entry.scene.mapName };
}

function cancelActiveProjectPreview(project: string): void {
  const active = activeByProject.get(project);
  if (!active) return;
  activeByProject.delete(project);
  active.reject(new Error('[MAP_IMAGE_PREVIEW_CANCELLED] A newer preview request replaced this one.'));
  active.worker.removeAllListeners();
  void active.worker.terminate();
}

function rememberValidatedPreview(
  workflowRoot: string,
  project: string,
  scene: MapImageExportScene,
  preview: MapImageExportPreviewResult,
): void {
  pruneValidatedPreviews();
  validatedByRequest.set(preview.requestId, {
    workflowRoot,
    project,
    scene: structuredClone(scene),
    digest: previewDigest(preview),
    createdAt: Date.now(),
  });
  while (validatedByRequest.size > VALIDATED_PREVIEW_LIMIT) {
    const oldest = validatedByRequest.keys().next().value;
    if (typeof oldest !== 'string') break;
    validatedByRequest.delete(oldest);
  }
}

function previewDigest(preview: MapImageExportPreviewResult): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    requestId: preview?.requestId,
    mapId: preview?.mapId,
    width: preview?.width,
    height: preview?.height,
    maxScalePercent: preview?.maxScalePercent,
    mime: preview?.mime,
    pngBase64: preview?.pngBase64,
  })).digest('hex');
}

function purgeValidatedProjectPreviews(project: string): void {
  for (const [requestId, entry] of validatedByRequest) {
    if (entry.project === project) validatedByRequest.delete(requestId);
  }
}

function pruneValidatedPreviews(): void {
  const minimumCreatedAt = Date.now() - VALIDATED_PREVIEW_TTL_MS;
  for (const [requestId, entry] of validatedByRequest) {
    if (entry.createdAt < minimumCreatedAt) validatedByRequest.delete(requestId);
  }
}

function runValidationWorker(entry: ValidatedPreview): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { execArgv: WORKER_EXEC_ARGV });
    worker.unref();
    worker.once('message', (message: { ok: boolean; result?: { validated?: boolean }; error?: string }) => {
      worker.removeAllListeners();
      if (message.ok && message.result?.validated) resolve();
      else reject(new Error(message.error || 'Map image export validation failed.'));
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Map image export validation worker exited with code ${code}.`));
    });
    worker.postMessage({
      workflowRoot: entry.workflowRoot,
      project: entry.project,
      databasePath: getConfiguredDatabasePath(),
      scene: entry.scene,
      validationOnly: true,
    });
  });
}
