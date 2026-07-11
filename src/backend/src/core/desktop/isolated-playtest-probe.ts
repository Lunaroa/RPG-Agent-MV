import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  RmmvVerifyProbeEvidence,
  RmmvVerifyResult,
  RmmvVerifyStatus,
} from '../../../../contract/types.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import type { NwjsPlayableProbeResult } from '../workflow/probe/nwjs-playable-probe.ts';
import {
  getProjectFileForRead,
  getProjectStagingStatus,
  preflightStagedProjectFiles,
} from './staging-service.ts';

export interface IsolatedPlaytestProbeOptions {
  mapId?: number;
  x?: number;
  y?: number;
  timeoutMs?: number;
}

export interface IsolatedProbeWorkerRequest {
  temporaryProject: string;
  artifactDir: string;
  generatedAt: string;
  timeoutMs: number;
  mapId: number;
  x: number;
  y: number;
}

export interface IsolatedProbeWorkerResponse {
  ok: boolean;
  run?: NwjsPlayableProbeResult;
  error?: string;
}

export interface IsolatedPlaytestProbeDependencies {
  executeWorker: (request: IsolatedProbeWorkerRequest) => Promise<IsolatedProbeWorkerResponse>;
  createTemporaryProject: () => string;
  removeTemporaryProject: (project: string) => void;
  now: () => Date;
  randomUUID: () => string;
}

export interface IsolatedProbeWorkerProcessDependencies {
  spawnProcess: (
    executable: string,
    args: string[],
    options: childProcess.SpawnOptions,
  ) => childProcess.ChildProcess;
}

interface StagedFileSnapshot {
  relativePath: string;
  delete: boolean;
  draftHash: string | null;
}

interface StagingSnapshot {
  files: StagedFileSnapshot[];
  digest: string;
}

interface RequestedStart {
  mapId: number;
  x: number;
  y: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;
const WORKER_EXIT_OVERHEAD_MS = 15_000;
const REQUIRED_ENGINE_FILES = [
  'rpg_core.js',
  'rpg_managers.js',
  'rpg_objects.js',
  'rpg_scenes.js',
  'rpg_sprites.js',
  'rpg_windows.js',
  'main.js',
] as const;

export async function runIsolatedRmmvPlaytestProbe(
  workflowRootInput: string,
  projectInput: string,
  options: IsolatedPlaytestProbeOptions = {},
  dependencies: Partial<IsolatedPlaytestProbeDependencies> = {},
): Promise<RmmvVerifyResult> {
  const workflowRoot = fs.realpathSync.native(path.resolve(workflowRootInput));
  const project = path.resolve(projectInput);
  const now = dependencies.now || (() => new Date());
  const randomUUID = dependencies.randomUUID || crypto.randomUUID;
  const generated = now();
  const runId = buildRunId(generated, randomUUID());
  const artifactDir = path.join(workflowRoot, 'runtime', 'out', 'playtest', 'agent-probe', runId);
  const artifactPath = path.join(artifactDir, 'verify-result.json');
  fs.mkdirSync(artifactDir, { recursive: true });

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let sourceFingerprintBefore = '';
  let saveFingerprintBefore = '';
  let stagingBefore: StagingSnapshot = emptyStagingSnapshot();
  let requestedStart: RequestedStart = { mapId: 0, x: 0, y: 0 };
  let temporaryProject = '';
  let workerResponse: IsolatedProbeWorkerResponse | undefined;
  let workerStarted = false;
  let cleanupError = '';
  let savesExcluded = false;
  const blockers: string[] = [];
  const review: string[] = [];

  try {
    timeoutMs = normalizeTimeout(options.timeoutMs);
    if (!isDirectory(project)) throw new ProbePreflightError(`RMMV project directory does not exist: ${project}`);
    sourceFingerprintBefore = fingerprintProjectSource(project);
    saveFingerprintBefore = fingerprintSaveState(project);
    stagingBefore = snapshotStaging(workflowRoot, project);
    temporaryProject = (dependencies.createTemporaryProject || defaultCreateTemporaryProject)();
    copyProjectExcludingSaves(project, temporaryProject);
    savesExcluded = candidateSavePaths(temporaryProject).every((candidate) => !fs.existsSync(candidate));
    overlayStagedFiles(workflowRoot, project, temporaryProject, stagingBefore.files);
    requestedStart = configureTemporaryStart(temporaryProject, options);
    assertProbeRuntime(temporaryProject);

    const request: IsolatedProbeWorkerRequest = {
      temporaryProject,
      artifactDir,
      generatedAt: `${generated.toISOString()}-${runId}`,
      timeoutMs,
      mapId: requestedStart.mapId,
      x: requestedStart.x,
      y: requestedStart.y,
    };
    workerStarted = true;
    workerResponse = await (dependencies.executeWorker || executeIsolatedProbeWorker)(request);
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof ProbePreflightError || !workerStarted) blockers.push(message);
    else workerResponse = { ok: false, error: message };
  } finally {
    if (temporaryProject) {
      try {
        (dependencies.removeTemporaryProject || defaultRemoveTemporaryProject)(temporaryProject);
      } catch (error) {
        cleanupError = errorMessage(error);
      }
    }
  }

  const temporaryProjectCleaned = !temporaryProject || !fs.existsSync(temporaryProject);
  if (!temporaryProjectCleaned && !cleanupError) cleanupError = 'Temporary project still exists after cleanup.';
  const sourceUnchanged = sourceFingerprintBefore
    ? safeFingerprint(() => fingerprintProjectSource(project)) === sourceFingerprintBefore
    : true;
  const savesUnchanged = saveFingerprintBefore
    ? safeFingerprint(() => fingerprintSaveState(project)) === saveFingerprintBefore
    : true;
  let stagingUnchanged = true;
  try {
    stagingUnchanged = snapshotStaging(workflowRoot, project).digest === stagingBefore.digest;
  } catch (error) {
    stagingUnchanged = false;
    blockers.push(`Staging preflight changed or conflicted during probe: ${errorMessage(error)}`);
  }
  if (!sourceUnchanged) blockers.push('Source project content changed during the isolated probe.');
  if (!savesUnchanged) blockers.push('Source project save content changed during the isolated probe.');
  if (!stagingUnchanged && !blockers.some((item) => item.startsWith('Staging preflight'))) {
    blockers.push('Staged project content changed during the isolated probe.');
  }

  const evidence = deriveStrictEvidence(
    workerResponse?.run,
    requestedStart,
    temporaryProject,
    savesExcluded,
    sourceUnchanged,
    savesUnchanged,
    stagingUnchanged,
    temporaryProjectCleaned,
  );

  let status: RmmvVerifyStatus;
  let error: string | undefined;
  if (blockers.length > 0) {
    status = 'blocked';
  } else if (cleanupError) {
    status = 'failed';
    error = cleanupError;
  } else if (!workerResponse?.ok || !workerResponse.run) {
    status = 'failed';
    error = workerResponse?.error || 'Isolated playtest worker did not return a run result.';
  } else if (workerResponse.run.status === 'not-available') {
    status = 'blocked';
    blockers.push(workerResponse.run.detail);
  } else if (isStrictlyVerified(workerResponse.run, evidence)) {
    status = 'verified';
  } else if (isReviewable(workerResponse.run, evidence)) {
    status = 'review';
    review.push(workerResponse.run.detail || 'Runtime did not reach event idle before timeout.');
  } else {
    status = 'failed';
    error = strictFailureMessage(workerResponse.run, evidence);
  }

  const artifacts = dedupeExisting([
    artifactPath,
    workerResponse?.run?.artifacts?.resultJson,
    workerResponse?.run?.artifacts?.screenPng || undefined,
    workerResponse?.run?.artifacts?.stdout || undefined,
    workerResponse?.run?.artifacts?.stderr || undefined,
  ]);
  const result: RmmvVerifyResult = {
    status,
    verified: status === 'verified',
    project,
    runId,
    generatedAt: generated.toISOString(),
    timeoutMs,
    ...(options.mapId !== undefined ? { requestedMapId: options.mapId } : {}),
    ...(options.x !== undefined ? { requestedX: options.x } : {}),
    ...(options.y !== undefined ? { requestedY: options.y } : {}),
    stagedFileCount: stagingBefore.files.length,
    stagedFiles: stagingBefore.files.map((entry) => entry.relativePath),
    stagingDigest: stagingBefore.digest,
    evidence,
    blockers: dedupeStrings(blockers),
    review: dedupeStrings(review),
    artifacts,
    artifactPath,
    ...(workerResponse?.run ? { workerResult: workerResponse.run } : {}),
    ...(error ? { error } : {}),
  };
  writeJsonAtomic(artifactPath, result);
  if (!result.artifacts.includes(artifactPath)) result.artifacts.unshift(artifactPath);
  writeJsonAtomic(artifactPath, result);
  return result;
}

function snapshotStaging(workflowRoot: string, project: string): StagingSnapshot {
  const status = getProjectStagingStatus(workflowRoot, project) as {
    files?: Array<Record<string, unknown>>;
    operations?: unknown[];
    maps?: number[];
  };
  const relativePaths = (status.files || []).map((entry) => String(entry.relativePath || '')).filter(Boolean);
  const preflight = relativePaths.length
    ? preflightStagedProjectFiles(workflowRoot, project, relativePaths) as Array<Record<string, unknown>>
    : [];
  const files = preflight.map((entry) => ({
    relativePath: String(entry.relativePath || ''),
    delete: Boolean(entry.delete),
    draftHash: typeof entry.draftHash === 'string' ? entry.draftHash : null,
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const digestPayload = {
    files: preflight.map((entry) => ({
      relativePath: entry.relativePath,
      delete: Boolean(entry.delete),
      baseHash: entry.baseHash ?? null,
      sourceHash: entry.sourceHash ?? null,
      draftHash: entry.draftHash ?? null,
      recordedDraftHash: entry.recordedDraftHash ?? null,
      operationId: entry.operationId ?? null,
      conflictReasons: entry.conflictReasons ?? [],
    })).sort((left, right) => String(left.relativePath).localeCompare(String(right.relativePath))),
    operations: Array.isArray(status.operations) ? status.operations : [],
    maps: Array.isArray(status.maps) ? [...status.maps].sort((a, b) => a - b) : [],
  };
  return {
    files,
    digest: sha256(Buffer.from(JSON.stringify(digestPayload), 'utf8')),
  };
}

function emptyStagingSnapshot(): StagingSnapshot {
  return { files: [], digest: sha256(Buffer.from(JSON.stringify({ files: [], operations: [], maps: [] }), 'utf8')) };
}

function overlayStagedFiles(
  workflowRoot: string,
  sourceProject: string,
  temporaryProject: string,
  files: StagedFileSnapshot[],
): void {
  for (const entry of files) {
    const target = confinedProjectPath(temporaryProject, entry.relativePath);
    if (entry.delete) {
      fs.rmSync(target, { force: true });
      continue;
    }
    const draft = getProjectFileForRead(workflowRoot, sourceProject, entry.relativePath);
    if (!draft || !isFile(draft)) throw new ProbePreflightError(`Staged draft is missing: ${entry.relativePath}`);
    if (!entry.draftHash || sha256(fs.readFileSync(draft)) !== entry.draftHash) {
      throw new ProbePreflightError(`Staged draft hash changed while preparing probe: ${entry.relativePath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(draft, target);
    if (sha256(fs.readFileSync(target)) !== entry.draftHash) {
      throw new ProbePreflightError(`Staged draft changed while copying probe input: ${entry.relativePath}`);
    }
  }
}

function configureTemporaryStart(project: string, options: IsolatedPlaytestProbeOptions): RequestedStart {
  const hasMap = options.mapId !== undefined;
  const hasX = options.x !== undefined;
  const hasY = options.y !== undefined;
  if (hasMap && (!hasX || !hasY)) throw new ProbePreflightError('X and Y must both be provided when mapId is specified.');
  if (!hasMap && (hasX || hasY)) throw new ProbePreflightError('mapId must be provided when X or Y is specified.');

  const dataDir = resolveDataDir(project);
  const systemPath = path.join(dataDir, 'System.json');
  const system = readJsonRecord(systemPath, 'System.json');
  const mapId = hasMap ? positiveInteger(options.mapId, 'mapId') : positiveInteger(system.startMapId, 'System.startMapId');
  const x = hasMap ? nonnegativeInteger(options.x, 'X') : nonnegativeInteger(system.startX, 'System.startX');
  const y = hasMap ? nonnegativeInteger(options.y, 'Y') : nonnegativeInteger(system.startY, 'System.startY');
  const mapPath = path.join(dataDir, `Map${String(mapId).padStart(3, '0')}.json`);
  const map = readJsonRecord(mapPath, `Map${String(mapId).padStart(3, '0')}.json`);
  const width = positiveInteger(map.width, 'map width');
  const height = positiveInteger(map.height, 'map height');
  if (x >= width || y >= height) {
    throw new ProbePreflightError(`Requested coordinate (${x}, ${y}) is outside map ${mapId} bounds ${width}x${height}.`);
  }
  if (hasMap) {
    system.startMapId = mapId;
    system.startX = x;
    system.startY = y;
    writeJsonAtomic(systemPath, system);
  }
  return { mapId, x, y };
}

function deriveStrictEvidence(
  run: NwjsPlayableProbeResult | undefined,
  expected: RequestedStart,
  temporaryProject: string,
  savesExcluded: boolean,
  sourceUnchanged: boolean,
  savesUnchanged: boolean,
  stagingUnchanged: boolean,
  temporaryProjectCleaned: boolean,
): RmmvVerifyProbeEvidence {
  const raw = readRawProbe(run);
  const map = recordValue(raw.map);
  const player = recordValue(map.player);
  const events = recordValue(raw.events);
  const screen = recordValue(raw.screen);
  const screenshotPath = run?.artifacts?.screenPng || undefined;
  const screenshotExists = Boolean(screenshotPath && isFile(screenshotPath));
  const screenshotNonEmpty = Boolean(screenshotExists && fs.statSync(screenshotPath!).size > 0);
  const actualMapId = finiteInteger(map.currentMapId);
  const actualX = finiteInteger(player.x);
  const actualY = finiteInteger(player.y);
  const eventIdle = events.complete === true
    && events.eventRunning === false
    && events.interpreterRunning === false
    && events.messageBusy === false
    && events.playerCanMove === true;
  const errors = Array.isArray(raw.errors) ? raw.errors : null;
  return {
    ...(screenshotPath ? { screenshotPath } : {}),
    screenshotExists,
    screenshotNonEmpty,
    screenshotNonBlank: screen.nonBlank === true,
    expectedMapId: expected.mapId,
    ...(actualMapId !== undefined ? { actualMapId } : {}),
    mapVerified: map.onStartMap === true && actualMapId === expected.mapId,
    expectedX: expected.x,
    expectedY: expected.y,
    ...(actualX !== undefined ? { actualX } : {}),
    ...(actualY !== undefined ? { actualY } : {}),
    coordinatesVerified: actualX === expected.x && actualY === expected.y,
    runtimeReady: raw.ready === true,
    eventIdle,
    noJavascriptErrors: errors !== null && errors.length === 0 && !raw.failureClassification,
    processExited: run?.processExited === true,
    savesExcluded: Boolean(temporaryProject) && savesExcluded,
    sourceUnchanged,
    savesUnchanged,
    stagingUnchanged,
    temporaryProjectCleaned,
  };
}

function isStrictlyVerified(run: NwjsPlayableProbeResult, evidence: RmmvVerifyProbeEvidence): boolean {
  return run.status === 'pass'
    && Object.entries(evidence).every(([key, value]) => (
      !STRICT_BOOLEAN_EVIDENCE.has(key) || value === true
    ));
}

const STRICT_BOOLEAN_EVIDENCE = new Set([
  'screenshotExists',
  'screenshotNonEmpty',
  'screenshotNonBlank',
  'mapVerified',
  'coordinatesVerified',
  'runtimeReady',
  'eventIdle',
  'noJavascriptErrors',
  'processExited',
  'savesExcluded',
  'sourceUnchanged',
  'savesUnchanged',
  'stagingUnchanged',
  'temporaryProjectCleaned',
]);

function isReviewable(run: NwjsPlayableProbeResult, evidence: RmmvVerifyProbeEvidence): boolean {
  return run.status === 'review'
    && evidence.screenshotExists
    && evidence.screenshotNonEmpty
    && evidence.screenshotNonBlank
    && evidence.mapVerified
    && evidence.coordinatesVerified
    && evidence.runtimeReady
    && evidence.noJavascriptErrors
    && evidence.processExited
    && evidence.savesExcluded
    && evidence.sourceUnchanged
    && evidence.savesUnchanged
    && evidence.stagingUnchanged
    && evidence.temporaryProjectCleaned;
}

function strictFailureMessage(run: NwjsPlayableProbeResult, evidence: RmmvVerifyProbeEvidence): string {
  const raw = readRawProbe(run);
  const failure = recordValue(raw.failureClassification);
  if (typeof failure.detail === 'string' && failure.detail) return failure.detail;
  if (run.timedOut) return 'Isolated playtest probe timed out.';
  const failed = [...STRICT_BOOLEAN_EVIDENCE].filter((key) => evidence[key as keyof RmmvVerifyProbeEvidence] !== true);
  return run.detail || `Strict playtest evidence failed: ${failed.join(', ') || run.status}.`;
}

function readRawProbe(run: NwjsPlayableProbeResult | undefined): Record<string, unknown> {
  const direct = recordValue(run?.probe);
  if (Object.keys(direct).length > 0) return direct;
  const resultPath = run?.artifacts?.resultJson;
  if (!resultPath || !isFile(resultPath)) return {};
  try {
    return recordValue(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
  } catch {
    return {};
  }
}

function copyProjectExcludingSaves(sourceProject: string, temporaryProject: string): void {
  const source = fs.realpathSync.native(path.resolve(sourceProject));
  fs.rmSync(temporaryProject, { recursive: true, force: true });
  fs.mkdirSync(temporaryProject, { recursive: true });
  fs.cpSync(source, temporaryProject, {
    recursive: true,
    preserveTimestamps: true,
    filter: (sourcePath) => {
      const relative = normalizeRelative(path.relative(source, sourcePath));
      if (!relative) return true;
      const lower = relative.toLowerCase();
      return lower !== '.git'
        && !lower.startsWith('.git/')
        && lower !== 'save'
        && !lower.startsWith('save/')
        && lower !== 'www/save'
        && !lower.startsWith('www/save/');
    },
  });
  if (candidateSavePaths(temporaryProject).some((candidate) => fs.existsSync(candidate))) {
    throw new ProbePreflightError('Temporary project copy still contains a save directory.');
  }
}

function assertProbeRuntime(project: string): void {
  const gameExe = path.join(project, 'Game.exe');
  if (!isFile(gameExe)) throw new ProbePreflightError(`RMMV probe runner was not found: ${gameExe}`);

  const webRoot = [path.join(project, 'www'), project]
    .find((candidate) => isFile(path.join(candidate, 'index.html')));
  if (!webRoot) throw new ProbePreflightError('RMMV index.html was not found in www or the project root.');

  const packageCandidates = [path.join(project, 'package.json'), path.join(webRoot, 'package.json')];
  if (!packageCandidates.some(isFile)) {
    throw new ProbePreflightError('RMMV package.json was not found for the copied runtime.');
  }

  const missingEngineFiles = [...REQUIRED_ENGINE_FILES, 'plugins.js']
    .filter((fileName) => !isFile(path.join(webRoot, 'js', fileName)));
  if (missingEngineFiles.length > 0) {
    throw new ProbePreflightError(`RMMV runtime is incomplete; missing js/${missingEngineFiles.join(', js/')}.`);
  }
}

function fingerprintProjectSource(project: string): string {
  return fingerprintTree(project, (relative) => {
    const lower = relative.toLowerCase();
    return lower === '.git'
      || lower.startsWith('.git/')
      || lower === 'save'
      || lower.startsWith('save/')
      || lower === 'www/save'
      || lower.startsWith('www/save/');
  });
}

function fingerprintSaveState(project: string): string {
  const hash = crypto.createHash('sha256');
  for (const candidate of candidateSavePaths(project)) {
    const relative = normalizeRelative(path.relative(project, candidate));
    hash.update(`${relative}:${fs.existsSync(candidate) ? 'exists' : 'missing'}\n`);
    if (isDirectory(candidate)) hash.update(fingerprintTree(candidate, () => false));
  }
  return hash.digest('hex');
}

function fingerprintTree(root: string, exclude: (relative: string) => boolean): string {
  const hash = crypto.createHash('sha256');
  if (!fs.existsSync(root)) return hash.update('missing').digest('hex');
  for (const entry of listTreeEntries(root)) {
    const relative = normalizeRelative(path.relative(root, entry));
    if (!relative || exclude(relative)) continue;
    const stat = fs.lstatSync(entry);
    if (stat.isDirectory()) continue;
    if (stat.isSymbolicLink()) {
      hash.update(`link:${relative}:${fs.readlinkSync(entry)}\n`);
      continue;
    }
    if (!stat.isFile()) continue;
    hash.update(`file:${relative}:${stat.size}:`);
    hash.update(fs.readFileSync(entry));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function listTreeEntries(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    out.push(absolute);
    if (entry.isDirectory()) out.push(...listTreeEntries(absolute));
  }
  return out.sort((left, right) => left.localeCompare(right));
}

export async function executeIsolatedProbeWorker(
  request: IsolatedProbeWorkerRequest,
  dependencies: Partial<IsolatedProbeWorkerProcessDependencies> = {},
): Promise<IsolatedProbeWorkerResponse> {
  const requestPath = path.join(request.artifactDir, 'worker-request.json');
  const responsePath = path.join(request.artifactDir, 'worker-response.json');
  const stdoutPath = path.join(request.artifactDir, 'worker.stdout.log');
  const stderrPath = path.join(request.artifactDir, 'worker.stderr.log');
  fs.mkdirSync(request.artifactDir, { recursive: true });
  writeJsonAtomic(requestPath, request);
  fs.writeFileSync(stdoutPath, '', 'utf8');
  fs.writeFileSync(stderrPath, '', 'utf8');
  const workerScript = fileURLToPath(new URL('./isolated-playtest-probe-worker.ts', import.meta.url));
  const spawnProcess = dependencies.spawnProcess
    || ((executable: string, args: string[], options: childProcess.SpawnOptions) => childProcess.spawn(executable, args, options));
  const child = spawnProcess(process.execPath, [
    '--experimental-strip-types',
    workerScript,
    requestPath,
    responsePath,
  ], {
    cwd: request.temporaryProject,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.stdout?.on('data', (chunk) => fs.appendFileSync(stdoutPath, chunk));
  child.stderr?.on('data', (chunk) => fs.appendFileSync(stderrPath, chunk));
  return awaitWorkerResponse(child, responsePath, request.timeoutMs + WORKER_EXIT_OVERHEAD_MS);
}

function awaitWorkerResponse(
  child: childProcess.ChildProcess,
  responsePath: string,
  hardTimeoutMs: number,
): Promise<IsolatedProbeWorkerResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: IsolatedProbeWorkerResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    child.once('error', (error) => finish({ ok: false, error: error.message }));
    child.once('exit', (code, signal) => {
      if (fs.existsSync(responsePath)) {
        try {
          finish(JSON.parse(fs.readFileSync(responsePath, 'utf8')) as IsolatedProbeWorkerResponse);
          return;
        } catch (error) {
          finish({ ok: false, error: `Cannot parse isolated probe worker response: ${errorMessage(error)}` });
          return;
        }
      }
      finish({ ok: false, error: `Isolated probe worker exited without a response (code=${code ?? 'null'}, signal=${signal || 'null'}).` });
    });
    const timer = setTimeout(() => {
      stopProcessTree(child);
      finish({ ok: false, error: `Isolated probe worker exceeded its hard limit of ${hardTimeoutMs}ms.` });
    }, hardTimeoutMs);
  });
}

function stopProcessTree(child: childProcess.ChildProcess): void {
  try { child.kill(); } catch { /* Continue to tree cleanup. */ }
  if (process.platform === 'win32' && child.pid) {
    childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
}

function defaultCreateTemporaryProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-agent-verify-'));
}

function defaultRemoveTemporaryProject(project: string): void {
  fs.rmSync(project, { recursive: true, force: true });
  if (fs.existsSync(project)) throw new Error(`Temporary project could not be removed: ${project}`);
}

function resolveDataDir(project: string): string {
  const candidates = [path.join(project, 'www', 'data'), path.join(project, 'data')];
  const dataDir = candidates.find((candidate) => isFile(path.join(candidate, 'System.json')));
  if (!dataDir) throw new ProbePreflightError('RMMV System.json was not found in www/data or data.');
  return dataDir;
}

function readJsonRecord(filePath: string, label: string): Record<string, unknown> {
  if (!isFile(filePath)) throw new ProbePreflightError(`${label} was not found: ${filePath}`);
  try {
    return recordValue(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new ProbePreflightError(`${label} is invalid JSON: ${errorMessage(error)}`);
  }
}

function confinedProjectPath(project: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new ProbePreflightError(`Unsafe staged project path: ${relativePath}`);
  }
  const root = path.resolve(project);
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ProbePreflightError(`Unsafe staged project path: ${relativePath}`);
  return target;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new ProbePreflightError(`timeoutMs must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ProbePreflightError(`${label} must be a positive integer.`);
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new ProbePreflightError(`${label} must be a nonnegative integer.`);
  return parsed;
}

function finiteInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function candidateSavePaths(project: string): string[] {
  return [path.join(project, 'save'), path.join(project, 'www', 'save')];
}

function safeFingerprint(read: () => string): string {
  try { return read(); } catch { return ''; }
}

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function dedupeExisting(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && fs.existsSync(value))).map(path.normalize))];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildRunId(now: Date, uuid: string): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `probe-${stamp}-${uuid.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}`;
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ProbePreflightError extends Error {}
