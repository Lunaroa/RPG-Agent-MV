import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type {
  MapImageExportOptions,
  MapImageExportPreviewResult,
  MapImageExportScene,
  MapImageExportSessionInfo,
} from '../../../../contract/types.ts';
import { getConfiguredDatabasePath } from '../db/pool.ts';

const WORKER_FILE = import.meta.url.endsWith('.ts')
  ? './map-image-export-worker.ts'
  : './map-image-export-worker.js';
const WORKER_URL = new URL(WORKER_FILE, import.meta.url);
const WORKER_EXEC_ARGV = ['--experimental-strip-types', '--experimental-transform-types'];

interface PendingRender {
  scene: MapImageExportScene;
  workflowRoot: string;
  project: string;
  resolve: (result: MapImageExportPreviewResult) => void;
  reject: (error: Error) => void;
}

interface ExportSession {
  project: string;
  mapId: number;
  worker: Worker;
  ready: Promise<MapImageExportSessionInfo>;
  pending: Map<string, PendingRender>;
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

const sessionByProject = new Map<string, ExportSession>();
const validatedByRequest = new Map<string, ValidatedPreview>();
const VALIDATED_PREVIEW_TTL_MS = 15 * 60 * 1000;
const VALIDATED_PREVIEW_LIMIT = 32;

export async function openMapImageExportSession(
  workflowRoot: string,
  project: string,
  scene: MapImageExportScene,
): Promise<MapImageExportSessionInfo> {
  await terminateProjectSession(project);
  const worker = new Worker(WORKER_URL, { execArgv: WORKER_EXEC_ARGV });
  worker.unref();
  const session: ExportSession = {
    project,
    mapId: scene.mapId,
    worker,
    ready: Promise.resolve({ nativeWidth: 0, nativeHeight: 0, maxScalePercent: 0 }),
    pending: new Map(),
  };
  session.ready = new Promise<MapImageExportSessionInfo>((resolve, reject) => {
    let settled = false;
    let openFailure: Error | null = null;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'session-ready') {
        if (message.ok && message.result) {
          settle(() => {
            sessionByProject.set(project, session);
            resolve(message.result as MapImageExportSessionInfo);
          });
        } else {
          openFailure = new Error(message.error || 'Map image export session failed to open.');
          void worker.terminate();
        }
        return;
      }      if (message.type === 'session-render-result') handleRenderResult(session, message);
    });
    worker.once('error', (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      settle(() => reject(err));
      dropSession(session, err);
    });
    worker.once('exit', (code) => {
      const error = openFailure ?? new Error(`Map image export worker exited with code ${code}.`);
      settle(() => reject(error));
      dropSession(session, error);
    });
    const databasePath = getConfiguredDatabasePath();
    if (!databasePath) {
      settle(() => reject(new Error('[MAP_IMAGE_DATABASE_UNAVAILABLE] The project database is not configured.')));
      void worker.terminate();
      return;
    }
    worker.postMessage({
      type: 'session-open',
      workflowRoot,
      project,
      databasePath,
      scene: { ...scene, project },
    } satisfies SessionOpenMessage);
  });
  return session.ready;
}

export async function closeMapImageExportSession(project: string): Promise<{ closed: boolean }> {
  const session = sessionByProject.get(project);
  if (!session) return { closed: false };
  sessionByProject.delete(project);
  rejectSessionPending(session, new Error('[MAP_IMAGE_PREVIEW_CANCELLED] The export dialog was closed.'));
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      void session.worker.terminate();
      resolve();
    }, 5000);
    session.worker.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      session.worker.postMessage({ type: 'session-close' } satisfies SessionCloseMessage);
    } catch {
      void session.worker.terminate();
    }
  });
  return { closed: true };
}

export async function generateMapImageExportPreview(
  workflowRoot: string,
  project: string,
  scene: MapImageExportScene,
): Promise<MapImageExportPreviewResult> {
  const session = sessionByProject.get(project);
  if (!session || session.mapId !== scene.mapId) {
    throw new Error('[MAP_IMAGE_SESSION_REQUIRED] Open the map image export session before requesting previews.');
  }
  await session.ready;
  purgeValidatedProjectPreviews(project);
  return new Promise<MapImageExportPreviewResult>((resolve, reject) => {
    session.pending.set(scene.requestId, { scene, workflowRoot, project, resolve, reject });
    session.worker.postMessage({
      type: 'session-render',
      requestId: scene.requestId,
      options: scene.options,
    } satisfies SessionRenderMessage);
  });
}

export async function cancelMapImageExportPreview(requestId: string): Promise<{ canceled: boolean }> {
  const cached = validatedByRequest.delete(requestId);
  for (const session of sessionByProject.values()) {
    const pending = session.pending.get(requestId);
    if (!pending) continue;
    session.pending.delete(requestId);
    pending.reject(new Error('[MAP_IMAGE_PREVIEW_CANCELLED] Preview was superseded or closed.'));
    return { canceled: true };
  }
  return { canceled: cached };
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

interface SessionOpenMessage {
  type: 'session-open';
  workflowRoot: string;
  project: string;
  databasePath: string;
  scene: MapImageExportScene;
}

interface SessionRenderMessage {
  type: 'session-render';
  requestId: string;
  options: MapImageExportOptions;
}

interface SessionCloseMessage {
  type: 'session-close';
}

interface WorkerMessage {
  type?: 'session-ready' | 'session-render-result';
  ok?: boolean;
  requestId?: string;
  result?: MapImageExportPreviewResult | MapImageExportSessionInfo;
  error?: string;
}

function handleRenderResult(session: ExportSession, message: WorkerMessage): void {
  const requestId = String(message.requestId || '');
  const pending = session.pending.get(requestId);
  if (!pending) return;
  session.pending.delete(requestId);
  if (message.ok && message.result) {
    rememberValidatedPreview(pending.workflowRoot, pending.project, pending.scene, message.result as MapImageExportPreviewResult);
    pending.resolve(message.result as MapImageExportPreviewResult);
  } else {
    pending.reject(new Error(message.error || 'Map image export failed.'));
  }
}

function dropSession(session: ExportSession, error: Error): void {
  if (sessionByProject.get(session.project) === session) sessionByProject.delete(session.project);
  rejectSessionPending(session, error);
}

function rejectSessionPending(session: ExportSession, error: Error): void {
  for (const pending of session.pending.values()) pending.reject(error);
  session.pending.clear();
}

async function terminateProjectSession(project: string): Promise<void> {
  const session = sessionByProject.get(project);
  if (!session) return;
  sessionByProject.delete(project);
  rejectSessionPending(session, new Error('[MAP_IMAGE_PREVIEW_CANCELLED] A newer export session replaced this one.'));
  session.worker.removeAllListeners();
  await session.worker.terminate();
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
      type: 'validation',
      workflowRoot: entry.workflowRoot,
      project: entry.project,
      databasePath: getConfiguredDatabasePath(),
      scene: entry.scene,
      validationOnly: true,
    });
  });
}
