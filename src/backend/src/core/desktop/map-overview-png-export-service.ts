import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  MapOverviewPngExportErrorCode,
  MapOverviewPngExportScene,
  MapOverviewPngExportStatus,
} from '../../../../contract/types.ts';

interface StartMapOverviewPngExportOptions {
  workflowRoot: string;
  project: string;
  outputPath: string;
  scene: MapOverviewPngExportScene;
  onStatus?: (status: MapOverviewPngExportStatus) => void;
}

interface ActiveExport {
  worker: Worker;
  options: StartMapOverviewPngExportOptions;
  status: MapOverviewPngExportStatus;
}

type WorkerMessage =
  | { type: 'progress' | 'complete' | 'failed'; status: MapOverviewPngExportStatus };

const WORKER_FILE = import.meta.url.endsWith('.ts')
  ? './map-overview-png-export-worker.ts'
  : './map-overview-png-export-worker.js';
const WORKER_URL = new URL(WORKER_FILE, import.meta.url);
const WORKER_EXEC_ARGV = ['--experimental-strip-types', '--experimental-transform-types'];

let activeExport: ActiveExport | null = null;
let latestStatus: MapOverviewPngExportStatus | null = null;

export function initializeMapOverviewPngExportService(workflowRoot: string): void {
  cleanupOrphanedMapOverviewExports(workflowRoot);
}

export function startMapOverviewPngExport(options: StartMapOverviewPngExportOptions): MapOverviewPngExportStatus {
  if (activeExport) throw new Error('A map overview PNG export is already running. Stop it before starting another export.');
  if (options.scene.project !== options.project) throw new Error('Map overview export project mismatch.');
  const startedAt = new Date().toISOString();
  const status: MapOverviewPngExportStatus = {
    requestId: options.scene.requestId,
    project: options.project,
    phase: 'preflight',
    width: null,
    height: null,
    completed: 0,
    total: 0,
    startedAt,
    finishedAt: null,
    outputPath: null,
    error: null,
    errorCode: null,
    canceled: false,
  };
  const worker = new Worker(WORKER_URL, { execArgv: WORKER_EXEC_ARGV });
  worker.unref();
  const job: ActiveExport = { worker, options, status };
  activeExport = job;
  latestStatus = status;
  worker.on('message', (message: WorkerMessage) => handleWorkerMessage(job, message));
  worker.on('error', error => failActiveExport(job, error));
  worker.on('exit', code => {
    if (activeExport !== job) return;
    failActiveExport(job, new Error(`Map overview PNG export worker exited before completion (code ${code}).`));
  });
  worker.postMessage({
    workflowRoot: options.workflowRoot,
    project: options.project,
    outputPath: options.outputPath,
    scene: options.scene,
  });
  options.onStatus?.(status);
  return status;
}

export function getMapOverviewPngExportStatus(): MapOverviewPngExportStatus | null {
  return latestStatus ? { ...latestStatus } : null;
}

export async function cancelMapOverviewPngExport(requestId: string): Promise<MapOverviewPngExportStatus> {
  const job = activeExport;
  if (!job || job.status.requestId !== requestId) {
    throw new Error('The requested map overview PNG export is not running.');
  }
  activeExport = null;
  job.worker.removeAllListeners();
  await job.worker.terminate();
  cleanupKnownArtifacts(job.options.workflowRoot, job.options.outputPath, requestId);
  const status: MapOverviewPngExportStatus = {
    ...job.status,
    phase: 'cancelled',
    canceled: true,
    error: null,
    errorCode: null,
    finishedAt: new Date().toISOString(),
  };
  latestStatus = status;
  job.options.onStatus?.(status);
  return status;
}

function handleWorkerMessage(job: ActiveExport, message: WorkerMessage): void {
  if (activeExport !== job || message.status.requestId !== job.status.requestId) return;
  const status = { ...message.status, startedAt: job.status.startedAt };
  job.status = status;
  latestStatus = status;
  job.options.onStatus?.(status);
  if (message.type === 'complete' || message.type === 'failed') {
    activeExport = null;
    job.worker.removeAllListeners();
  }
}

function failActiveExport(job: ActiveExport, error: unknown): void {
  if (activeExport !== job) return;
  activeExport = null;
  job.worker.removeAllListeners();
  void job.worker.terminate();
  cleanupKnownArtifacts(job.options.workflowRoot, job.options.outputPath, job.status.requestId);
  const status: MapOverviewPngExportStatus = {
    ...job.status,
    phase: 'failed',
    error: error instanceof Error ? error.message : String(error),
    errorCode: classifyWorkerFailure(error),
    finishedAt: new Date().toISOString(),
  };
  latestStatus = status;
  job.options.onStatus?.(status);
}

function classifyWorkerFailure(error: unknown): MapOverviewPngExportErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  return /sharp|libvips|native module|could not load|ERR_DLOPEN_FAILED/i.test(message)
    ? 'native-runtime'
    : 'export-failed';
}

function cleanupOrphanedMapOverviewExports(workflowRoot: string): void {
  const runtimeRoot = exportRuntimeRoot(workflowRoot);
  if (!fs.existsSync(runtimeRoot)) return;
  for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-zA-Z0-9_-]{1,128}\.json$/.test(entry.name)) continue;
    const journalPath = path.join(runtimeRoot, entry.name);
    try {
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Record<string, unknown>;
      const requestId = entry.name.slice(0, -5);
      const outputPath = typeof journal.outputPath === 'string' ? journal.outputPath : '';
      const partialPath = typeof journal.partialPath === 'string' ? journal.partialPath : '';
      const backupPath = typeof journal.backupPath === 'string' ? journal.backupPath : '';
      const tempDirectory = typeof journal.tempDirectory === 'string' ? journal.tempDirectory : '';
      if (!validJournalPaths(runtimeRoot, requestId, outputPath, partialPath, backupPath, tempDirectory)) continue;
      if (!fs.existsSync(outputPath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, outputPath);
      else fs.rmSync(backupPath, { force: true });
      fs.rmSync(partialPath, { force: true });
      fs.rmSync(tempDirectory, { recursive: true, force: true });
      fs.rmSync(journalPath, { force: true });
    } catch {
      // An invalid journal is left untouched because its external targets cannot be proven safe.
    }
  }
}

function cleanupKnownArtifacts(workflowRoot: string, outputPath: string, requestId: string): void {
  const runtimeRoot = exportRuntimeRoot(workflowRoot);
  const tempDirectory = path.join(runtimeRoot, requestId);
  const journalPath = path.join(runtimeRoot, `${requestId}.json`);
  const partialPath = `${outputPath}.rpg-agent-${requestId}.partial`;
  const backupPath = `${outputPath}.rpg-agent-${requestId}.backup`;
  if (!fs.existsSync(outputPath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, outputPath);
  else fs.rmSync(backupPath, { force: true });
  fs.rmSync(partialPath, { force: true });
  fs.rmSync(tempDirectory, { recursive: true, force: true });
  fs.rmSync(journalPath, { force: true });
}

function validJournalPaths(
  runtimeRoot: string,
  requestId: string,
  outputPath: string,
  partialPath: string,
  backupPath: string,
  tempDirectory: string,
): boolean {
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.png') return false;
  if (partialPath !== `${outputPath}.rpg-agent-${requestId}.partial`) return false;
  if (backupPath !== `${outputPath}.rpg-agent-${requestId}.backup`) return false;
  return path.resolve(tempDirectory) === path.join(path.resolve(runtimeRoot), requestId);
}

function exportRuntimeRoot(workflowRoot: string): string {
  return path.join(path.resolve(workflowRoot), 'runtime', 'map-overview-exports');
}
