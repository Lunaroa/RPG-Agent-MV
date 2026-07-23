import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  MapPreviewDevToolsResult,
  MapPreviewFailureCode,
  MapPreviewFailureDetail,
  MapPreviewFrame,
  MapPreviewOverrides,
  MapPreviewResumeRequest,
  MapPreviewResult,
  MapPreviewSession,
  MapPreviewVariableValue,
  MapPreviewViewRequest,
} from '../../../../contract/types.ts';
import { isMapPreviewVariableValue, parseMapPreviewSelfSwitchKey } from '../../../../contract/map-preview-state.ts';
import { readJson } from '../rmmv/json.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import { resolveDataDir } from '../rmmv/project-scanner.ts';
import {
  cleanupIsolatedProject,
  snapshotProjectStaging,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
  type IsolatedStagingSnapshot,
} from './isolated-project-preparation.ts';
import {
  MapPreviewPreparationCancelledError,
  MapPreviewPreparationFailedError,
  startMapPreviewPreparation,
  type MapPreviewPreparationTask,
} from './map-preview-preparation.ts';
import { normalizeMapPreviewStagingConflictFiles } from './map-preview-staging-conflict.ts';
import type {
  InteractiveProjectRuntime,
  InteractiveProjectRuntimeResolution,
} from './interactive-playtest-runtime.ts';
import {
  getProjectStagingStatus,
  getMapFileForRead,
  getProjectFileForRead,
  preflightStagedProjectFiles,
} from './staging-service.ts';

const PACKET_HANDSHAKE = 1;
const PACKET_STATUS = 2;
const PACKET_FRAME = 3;
const PACKET_COMMAND = 10;
const HEADER_BYTES = 5;
const STARTUP_TIMEOUT_MS = 20_000;
const MAX_PACKET_BYTES = 128 * 1024 * 1024;
const MAX_DIAGNOSTIC_TEXT_LENGTH = 8_192;
const MAX_RUNTIME_OUTPUT_LENGTH = 4_096;
const MAX_FAILED_RESOURCES = 50;
const DEVTOOLS_RESPONSE_TIMEOUT_MS = 5_000;
export const MAP_PREVIEW_DEBUG_MARKER = '__rpg_agent_debugger__';

export class MapPreviewPacketDecoder {
  readonly #maximumPayloadBytes: number;
  readonly #onPacket: (type: number, payload: Buffer) => void;
  #header = Buffer.allocUnsafe(HEADER_BYTES);
  #headerOffset = 0;
  #payload: Buffer | null = null;
  #payloadOffset = 0;
  #type = 0;

  constructor(onPacket: (type: number, payload: Buffer) => void, maximumPayloadBytes = MAX_PACKET_BYTES) {
    this.#onPacket = onPacket;
    this.#maximumPayloadBytes = maximumPayloadBytes;
  }

  push(input: Buffer | Uint8Array): void {
    const chunk = Buffer.isBuffer(input)
      ? input
      : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.#payload) {
        const copied = Math.min(HEADER_BYTES - this.#headerOffset, chunk.length - offset);
        chunk.copy(this.#header, this.#headerOffset, offset, offset + copied);
        this.#headerOffset += copied;
        offset += copied;
        if (this.#headerOffset < HEADER_BYTES) continue;
        this.#type = this.#header.readUInt8(0);
        const length = this.#header.readUInt32BE(1);
        if (length > this.#maximumPayloadBytes) {
          this.#reset();
          throw new Error('Map preview packet exceeded the size limit.');
        }
        this.#payload = Buffer.allocUnsafe(length);
        this.#payloadOffset = 0;
        if (length === 0) this.#emitPacket();
        continue;
      }
      const copied = Math.min(this.#payload.length - this.#payloadOffset, chunk.length - offset);
      chunk.copy(this.#payload, this.#payloadOffset, offset, offset + copied);
      this.#payloadOffset += copied;
      offset += copied;
      if (this.#payloadOffset === this.#payload.length) this.#emitPacket();
    }
  }

  #emitPacket(): void {
    const type = this.#type;
    const payload = this.#payload || Buffer.alloc(0);
    this.#reset();
    this.#onPacket(type, payload);
  }

  #reset(): void {
    this.#headerOffset = 0;
    this.#payload = null;
    this.#payloadOffset = 0;
    this.#type = 0;
  }
}

export interface PreviewMapGeometry {
  mapId: number;
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  pixelWidth: number;
  pixelHeight: number;
}

interface PreviewFrameMeta {
  operationId: number;
  mapId: number;
  sequence: number;
  generation: number;
  kind: 'full' | 'overview' | 'tile';
  mapPixelWidth: number;
  mapPixelHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  mapRevision: string;
}

export interface ProjectFileSnapshotEntry {
  size: number;
  mtimeMs: number;
  hash: string;
}

export type ProjectFileSnapshot = Map<string, ProjectFileSnapshotEntry>;

type PreviewChild = childProcess.ChildProcessWithoutNullStreams;

interface PendingDevToolsRequest {
  id: number;
  promise: Promise<MapPreviewDevToolsResult>;
  resolve(result: MapPreviewDevToolsResult): void;
  timer: ReturnType<typeof setTimeout>;
}

export type MapPreviewLoadPurpose = 'fresh' | 'switch' | 'reload';

export function mapPreviewLoadPurpose(currentMapId: number, targetMapId: number, requiresReload: boolean): MapPreviewLoadPurpose | null {
  if (!requiresReload) return null;
  return currentMapId === targetMapId ? 'reload' : 'switch';
}

export function mapPreviewRequiresReload(
  currentMapId: number,
  currentMapRevision: string | undefined,
  targetMapId: number,
  targetMapRevision: string,
  pendingMapSync: boolean,
  forceReload = false,
): boolean {
  return forceReload
    || targetMapId !== currentMapId
    || targetMapRevision !== currentMapRevision
    || pendingMapSync;
}

export function isCurrentMapPreviewFrame(
  frame: Pick<PreviewFrameMeta, 'operationId' | 'mapId' | 'mapRevision'>,
  session: Pick<MapPreviewSession, 'operationId' | 'mapId' | 'mapRevision'>,
  activeOperationId: number,
): boolean {
  return frame.operationId === activeOperationId
    && frame.operationId === session.operationId
    && frame.mapId === session.mapId
    && frame.mapRevision === session.mapRevision;
}

export interface MapPreviewServiceDependencies {
  resolveProjectRuntime(
    project: string,
    engine: 'rpg-maker-mv' | 'rpg-maker-mz',
  ): InteractiveProjectRuntimeResolution;
  isPlaytestActive?(): boolean;
  onStatus?(session: MapPreviewSession): void;
  onFrame?(frame: MapPreviewFrame): void;
  spawnProcess?(executable: string, args: string[], options: childProcess.SpawnOptions): PreviewChild;
}

export class MapPreviewService {
  readonly #workflowRoot: string;
  readonly #dependencies: Required<Pick<MapPreviewServiceDependencies, 'resolveProjectRuntime'>> & MapPreviewServiceDependencies;
  #session: MapPreviewSession | null = null;
  #preparation: IsolatedProjectPreparation | null = null;
  #child: PreviewChild | null = null;
  #server: net.Server | null = null;
  #socket: net.Socket | null = null;
  #token = '';
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #startupStage = 'not-started';
  #runtimeOutput = '';
  #cleanupInProgress = false;
  #pendingFrameMeta: PreviewFrameMeta | null = null;
  #sourceSnapshot: ProjectFileSnapshot | null = null;
  #stagingSnapshot: IsolatedStagingSnapshot | null = null;
  #pendingMapSyncIds = new Set<number>();
  #desiredRunning = true;
  #pendingResume: MapPreviewResumeRequest | null = null;
  #resumePromise: Promise<MapPreviewResult> | null = null;
  #nextOperationId = 0;
  #activeOperationId = 0;
  #bridgeConnected = false;
  #preparationTask: MapPreviewPreparationTask | null = null;
  #preparationGeneration = 0;
  #nextDevToolsRequestId = 0;
  #pendingDevToolsRequest: PendingDevToolsRequest | null = null;

  constructor(workflowRoot: string, dependencies: MapPreviewServiceDependencies) {
    this.#workflowRoot = path.resolve(workflowRoot);
    this.#dependencies = dependencies as Required<Pick<MapPreviewServiceDependencies, 'resolveProjectRuntime'>> & MapPreviewServiceDependencies;
  }

  current(): MapPreviewResult {
    return this.#session ? { session: { ...this.#session } } : {};
  }

  isActive(): boolean {
    return Boolean(this.#session && !['stopped', 'failed'].includes(this.#session.status));
  }

  async start(projectInput: string, mapIdInput: number, overridesInput?: MapPreviewOverrides): Promise<MapPreviewResult> {
    if (this.isActive()) throw new Error('A map preview is already running.');
    if (this.#dependencies.isPlaytestActive?.()) {
      throw new Error('Stop the current game runtime before starting map preview.');
    }
    const project = fs.realpathSync.native(path.resolve(projectInput));
    const mapId = positiveInteger(mapIdInput, 'mapId');
    const overrides = normalizedOverrides(overridesInput);
    const manifest = inspectRmmvProject(project);
    if (!manifest.editable || !manifest.runnableStructure) {
      throw new Error(`The RPG Maker project is not runnable: ${manifest.missingRequired.join(', ')}`);
    }
    if (!manifest.mapFiles.some((entry) => entry.id === mapId && entry.exists)) {
      throw new Error(`Map${String(mapId).padStart(3, '0')}.json does not exist.`);
    }
    assertNoStagingConflicts(this.#workflowRoot, project);
    const mapRevision = effectiveMapRevision(this.#workflowRoot, project, mapId);

    const runtimeResolution = this.#dependencies.resolveProjectRuntime(project, manifest.engine);
    if (runtimeResolution.selectionRequired) {
      return { runtimeSelectionRequired: runtimeResolution.selectionRequired };
    }
    if (!runtimeResolution.runtime) return { error: 'The RPG Maker preview runtime could not be resolved.' };

    const now = new Date().toISOString();
    this.#nextOperationId = 1;
    this.#activeOperationId = 1;
    this.#session = {
      sessionId: crypto.randomUUID(),
      operationId: this.#activeOperationId,
      status: 'preparing',
      engine: manifest.engine,
      mapId,
      mapRevision,
      viewportWidth: manifest.screenWidth,
      viewportHeight: manifest.screenHeight,
      startedAt: now,
      updatedAt: now,
    };
    this.#publish();
    this.#startupStage = 'preparing-isolated-project';
    this.#runtimeOutput = '';
    this.#bridgeConnected = false;

    const preparationGeneration = ++this.#preparationGeneration;
    try {
      const preparationTask = startMapPreviewPreparation(this.#workflowRoot, project, {
        spawnProcess: this.#dependencies.spawnProcess,
      });
      this.#preparationTask = preparationTask;
      const prepared = await preparationTask.result;
      if (this.#preparationTask === preparationTask) this.#preparationTask = null;
      if (!this.#startIsCurrent(preparationGeneration)) {
        cleanupIsolatedProject(prepared);
        throw new MapPreviewPreparationCancelledError('Map preview preparation was superseded.');
      }
      this.#preparation = prepared;
      this.#sourceSnapshot = new Map(prepared.sourceSnapshot.map((entry) => [entry.relativePath, {
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        hash: entry.hash,
      }]));
      this.#stagingSnapshot = this.#preparation.staging;
      this.#pendingMapSyncIds.clear();
      this.#desiredRunning = true;
      this.#pendingResume = null;
      const copiedManifest = inspectRmmvProject(this.#preparation.temporaryProject);
      const geometry = previewMapGeometry(this.#preparation.temporaryProject, mapId, copiedManifest.tileSize);
      this.#update({ mapPixelWidth: geometry.pixelWidth, mapPixelHeight: geometry.pixelHeight });
      this.#token = crypto.randomBytes(32).toString('hex');
      const port = await this.#listen();
      if (!this.#startIsCurrent(preparationGeneration)) {
        throw new MapPreviewPreparationCancelledError('Map preview preparation was superseded.');
      }
      injectPreviewHarness(this.#preparation.temporaryProject, copiedManifest.resourceRoot, {
        token: this.#token,
        port,
        mapId,
        viewportWidth: copiedManifest.screenWidth,
        viewportHeight: copiedManifest.screenHeight,
        geometry,
        mapRevision,
        operationId: this.#activeOperationId,
        overrides,
      });
      this.#update({ status: 'starting' });
      this.#startupStage = 'launching-runtime';
      this.#launch(runtimeResolution.runtime);
      this.#armStartupTimeout();
      return this.current();
    } catch (error) {
      if (error instanceof MapPreviewPreparationCancelledError || !this.#startIsCurrent(preparationGeneration)) {
        return this.current();
      }
      const isolationFailure = error instanceof MapPreviewPreparationFailedError
        || this.#startupStage === 'preparing-isolated-project';
      await this.#fail(errorMessage(error), isolationFailure ? 'isolation-preparation-failed' : undefined, {
        stage: error instanceof MapPreviewPreparationFailedError ? error.stage : this.#startupStage,
        operationId: this.#activeOperationId,
        targetMapId: mapId,
        message: errorMessage(error),
      });
      return this.current();
    }
  }

  selectMap(mapIdInput: number, overridesInput?: MapPreviewOverrides): MapPreviewResult {
    const mapId = positiveInteger(mapIdInput, 'mapId');
    if (!this.#preparation || !this.#session || !this.isActive()) throw new Error('Map preview is not active.');
    const project = this.#preparation.sourceProject;
    const mapRevision = effectiveMapRevision(this.#workflowRoot, project, mapId);
    void this.resume({
      project,
      mapId,
      mapRevision,
      overrides: normalizedOverrides(overridesInput),
    }).catch((error) => { void this.#fail(errorMessage(error), 'runtime-resume-failed'); });
    return this.current();
  }

  panCamera(deltaX: number, deltaY: number): MapPreviewResult {
    this.#requireRunning();
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new Error('Camera deltas must be finite numbers.');
    this.#sendCommand({ type: 'pan-camera', deltaX, deltaY });
    return this.current();
  }

  setSwitch(idInput: number, value: boolean): MapPreviewResult {
    this.#requireRunning();
    const id = positiveInteger(idInput, 'switch id');
    if (typeof value !== 'boolean') throw new Error('Switch value must be boolean.');
    this.#sendCommand({ type: 'set-switch', id, value });
    return this.current();
  }

  setVariable(idInput: number, valueInput: MapPreviewVariableValue): MapPreviewResult {
    this.#requireRunning();
    const id = positiveInteger(idInput, 'variable id');
    if (!isMapPreviewVariableValue(valueInput)) throw new Error('Variable value must be a finite number or string.');
    this.#sendCommand({ type: 'set-variable', id, value: valueInput });
    return this.current();
  }

  resetOverrides(): MapPreviewResult {
    this.#requireRunning();
    this.#sendCommand({ type: 'reset-overrides' });
    return this.current();
  }

  replaceOverrides(overridesInput?: MapPreviewOverrides): MapPreviewResult {
    this.#requireRunning();
    this.#sendCommand({ type: 'replace-overrides', overrides: normalizedOverrides(overridesInput) });
    return this.current();
  }

  ackFrame(sequenceInput: number): MapPreviewResult {
    this.#requireRunning();
    const sequence = positiveInteger(sequenceInput, 'frame sequence');
    this.#sendCommand({ type: 'ack-frame', sequence });
    return this.current();
  }

  setView(request: MapPreviewViewRequest): MapPreviewResult {
    this.#requireRunning();
    const view = normalizedView(request);
    this.#sendCommand({ type: 'set-view', ...view });
    return this.current();
  }

  toggleDevTools(): Promise<MapPreviewDevToolsResult> {
    if (this.#pendingDevToolsRequest) return this.#pendingDevToolsRequest.promise;
    if (
      !this.#session
      || !['running', 'suspended'].includes(this.#session.status)
      || !this.#socket
      || this.#socket.destroyed
    ) {
      return Promise.resolve({
        code: 'preview-runtime-unavailable',
        error: 'Start a map preview before opening its developer tools.',
      });
    }

    const id = ++this.#nextDevToolsRequestId;
    let resolveRequest!: (result: MapPreviewDevToolsResult) => void;
    const promise = new Promise<MapPreviewDevToolsResult>((resolve) => { resolveRequest = resolve; });
    const timer = setTimeout(() => {
      if (this.#pendingDevToolsRequest?.id !== id) return;
      this.#pendingDevToolsRequest = null;
      resolveRequest({
        code: 'preview-devtools-unsupported',
        error: 'The map preview runtime did not open its developer tools.',
      });
    }, DEVTOOLS_RESPONSE_TIMEOUT_MS);
    this.#pendingDevToolsRequest = { id, promise, resolve: resolveRequest, timer };
    try {
      this.#sendCommand({ type: 'toggle-devtools', requestId: id });
    } catch {
      this.#resolvePendingDevTools({
        code: 'preview-runtime-unavailable',
        error: 'The map preview runtime is not connected.',
      });
    }
    return promise;
  }

  async suspend(): Promise<MapPreviewResult> {
    if (!this.#session || !this.isActive()) return this.current();
    this.#desiredRunning = false;
    this.#pendingResume = null;
    if (this.#session.status === 'preparing') {
      this.#cleanupInProgress = true;
      const cleanupError = await this.#cleanupRuntime();
      this.#finish(cleanupError ? 'failed' : 'stopped', cleanupError || undefined);
      this.#cleanupInProgress = false;
      return this.current();
    }
    if (this.#session.status === 'running') this.#beginSuspend();
    return this.current();
  }

  async resume(requestInput: MapPreviewResumeRequest): Promise<MapPreviewResult> {
    const project = fs.realpathSync.native(path.resolve(requestInput.project));
    const mapId = positiveInteger(requestInput.mapId, 'mapId');
    const overrides = normalizedOverrides(requestInput.overrides);
    const request: MapPreviewResumeRequest = {
      project,
      mapId,
      overrides,
      ...(typeof requestInput.mapRevision === 'string' && requestInput.mapRevision ? { mapRevision: requestInput.mapRevision } : {}),
      ...(requestInput.forceReload === true ? { forceReload: true } : {}),
    };
    if (!this.#session || !this.isActive() || !this.#preparation) return this.start(project, mapId, overrides);
    if (fs.realpathSync.native(this.#preparation.sourceProject) !== project) {
      await this.stop();
      const result = await this.start(project, mapId, overrides);
      if (result.session) this.#update({ resumeKind: 'reisolated' });
      return this.current();
    }
    this.#desiredRunning = true;
    this.#pendingResume = request;
    if (this.#session.status === 'running') {
      this.#beginSuspend();
      return this.current();
    }
    if (this.#session.status !== 'suspended') return this.current();
    return this.#resumeSuspended();
  }

  async stop(): Promise<MapPreviewResult> {
    if (!this.#session) return {};
    if (!this.isActive()) return this.current();
    this.#desiredRunning = false;
    this.#pendingResume = null;
    this.#update({ status: 'stopping' });
    this.#cleanupInProgress = true;
    const cleanupError = await this.#cleanupRuntime();
    this.#finish(cleanupError ? 'failed' : 'stopped', cleanupError || undefined);
    this.#cleanupInProgress = false;
    return this.current();
  }

  #beginSuspend(runtimeReady = false): void {
    if (!this.#session || (!runtimeReady && this.#session.status !== 'running')) return;
    this.#pendingFrameMeta = null;
    this.#sendCommand({ type: 'suspend', operationId: this.#activeOperationId });
    this.#update({ status: 'suspending' });
    this.#armResumeTimeout('suspending-runtime');
  }

  async #resumeSuspended(): Promise<MapPreviewResult> {
    if (this.#resumePromise) return this.#resumePromise;
    this.#resumePromise = this.#resumeSuspendedInternal()
      .catch(async (error) => {
        await this.#fail(errorMessage(error), 'runtime-resume-failed');
        return this.current();
      })
      .finally(() => { this.#resumePromise = null; });
    return this.#resumePromise;
  }

  async #resumeSuspendedInternal(): Promise<MapPreviewResult> {
    if (!this.#session || this.#session.status !== 'suspended' || !this.#preparation || !this.#pendingResume) {
      return this.current();
    }
    const request = this.#pendingResume;
    assertNoStagingConflicts(this.#workflowRoot, request.project);
    const changes = inspectWarmProjectChanges(
      this.#workflowRoot,
      request.project,
      this.#sourceSnapshot,
      this.#stagingSnapshot,
    );
    if (changes.unsafePaths.length) {
      await this.stop();
      const result = await this.start(request.project, request.mapId, request.overrides);
      if (result.session) this.#update({ resumeKind: 'reisolated' });
      return this.current();
    }
    this.#sourceSnapshot = changes.sourceSnapshot;
    this.#stagingSnapshot = changes.stagingSnapshot;
    for (const mapId of changes.changedMapIds) this.#pendingMapSyncIds.add(mapId);
    if (changes.mapInfosChanged) syncEffectiveMapInfos(this.#workflowRoot, request.project, this.#preparation.temporaryProject);

    const revision = effectiveMapRevision(this.#workflowRoot, request.project, request.mapId);
    const requiresReload = mapPreviewRequiresReload(
      this.#session.mapId,
      this.#session.mapRevision,
      request.mapId,
      revision,
      this.#pendingMapSyncIds.has(request.mapId),
      request.forceReload,
    );
    const purpose = mapPreviewLoadPurpose(this.#session.mapId, request.mapId, requiresReload);
    const manifest = inspectRmmvProject(this.#preparation.temporaryProject);
    let geometry = previewMapGeometry(this.#preparation.temporaryProject, this.#session.mapId, manifest.tileSize);
    if (requiresReload) {
      syncEffectiveMap(this.#workflowRoot, request.project, this.#preparation.temporaryProject, request.mapId);
      this.#pendingMapSyncIds.delete(request.mapId);
      geometry = previewMapGeometry(this.#preparation.temporaryProject, request.mapId, manifest.tileSize);
    }
    const operationId = ++this.#nextOperationId;
    this.#activeOperationId = operationId;
    this.#pendingResume = null;
    this.#pendingFrameMeta = null;
    this.#update({
      operationId,
      status: 'resuming',
      mapId: request.mapId,
      mapRevision: revision,
      mapPixelWidth: geometry.pixelWidth,
      mapPixelHeight: geometry.pixelHeight,
      resumeKind: requiresReload ? 'map-sync' : 'warm',
    });
    this.#sendCommand({
      type: 'resume',
      operationId,
      purpose: purpose || 'warm',
      mapId: request.mapId,
      geometry,
      mapRevision: revision,
      overrides: request.overrides,
    });
    this.#armResumeTimeout('resuming-runtime');
    return this.current();
  }

  async shutdown(): Promise<MapPreviewResult> {
    return this.stop();
  }

  shutdownSync(): void {
    if (!this.#session || !this.isActive()) return;
    this.#cleanupInProgress = true;
    const cleanupError = this.#cleanupRuntimeSync();
    this.#finish(cleanupError ? 'failed' : 'stopped', cleanupError || undefined);
    this.#cleanupInProgress = false;
  }

  #launch(runtime: InteractiveProjectRuntime): void {
    const preparation = this.#preparation!;
    const profileDirectory = createMapPreviewProfileDirectory(preparation.temporaryProject);
    const { executable, args } = buildMapPreviewLaunchCommand(runtime, preparation, profileDirectory);
    const spawn = this.#dependencies.spawnProcess || ((command, commandArgs, options) => (
      childProcess.spawn(command, commandArgs, options) as PreviewChild
    ));
    this.#child = spawn(executable, args, {
      cwd: preparation.temporaryProject,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.#child.stdout.on('data', (chunk) => this.#appendRuntimeOutput(chunk));
    this.#child.stderr.on('data', (chunk) => this.#appendRuntimeOutput(chunk));
    this.#child.once('spawn', () => { this.#startupStage = 'runtime-process-started'; });
    this.#child.once('error', (error) => void this.#fail(errorMessage(error), undefined, {
      stage: this.#startupStage,
      operationId: this.#activeOperationId,
      targetMapId: this.#session?.mapId,
      message: errorMessage(error),
    }));
    this.#child.once('exit', (code, signal) => {
      if (!this.#session || this.#cleanupInProgress || ['stopping', 'stopped', 'failed'].includes(this.#session.status)) return;
      const output = this.#runtimeOutput.trim();
      if (output) {
        console.warn(`[map-preview] Runtime exited unexpectedly: ${redactPreviewError(output, this.#preparation)}`);
      }
      const message = `Map preview runtime exited unexpectedly (${code ?? signal ?? 'unknown'}).`;
      void this.#fail(message, undefined, {
        stage: this.#startupStage,
        operationId: this.#activeOperationId,
        targetMapId: this.#session.mapId,
        message,
        ...(!this.#bridgeConnected && output ? { runtimeOutput: output.slice(-MAX_RUNTIME_OUTPUT_LENGTH) } : {}),
      });
    });
  }

  async #listen(): Promise<number> {
    this.#server = net.createServer((socket) => this.#acceptSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.#server!.once('error', reject);
      this.#server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new Error('Map preview bridge did not allocate a TCP port.');
    return address.port;
  }

  #acceptSocket(socket: net.Socket): void {
    if (!isLoopback(socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    if (this.#socket && !this.#socket.destroyed) {
      socket.destroy();
      return;
    }
    let authenticated = false;
    const decoder = new MapPreviewPacketDecoder((type, payload) => {
      if (!authenticated) {
        if (type !== PACKET_HANDSHAKE || parseJson(payload).token !== this.#token) {
          socket.destroy(new Error('Map preview bridge authentication failed.'));
          return;
        }
        authenticated = true;
        this.#socket = socket;
        this.#bridgeConnected = true;
        this.#startupStage = 'preview-bridge-connected';
        return;
      }
      this.#handlePacket(type, payload);
    });
    socket.on('data', (chunk) => {
      try {
        decoder.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
      } catch (error) {
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.once('close', () => {
      if (this.#socket === socket) {
        this.#socket = null;
        this.#resolvePendingDevTools({
          code: 'preview-runtime-unavailable',
          error: 'The map preview runtime disconnected.',
        });
      }
    });
    socket.once('error', () => undefined);
  }

  #handlePacket(type: number, payload: Buffer): void {
    if (type === PACKET_FRAME) {
      const meta = this.#pendingFrameMeta;
      this.#pendingFrameMeta = null;
      if (!meta) {
        if (this.#session?.status === 'running') void this.#fail('Map preview frame metadata was missing.', 'map-render-failed');
        return;
      }
      if (!this.#session || this.#session.status !== 'running') return;
      if (!isCurrentMapPreviewFrame(meta, this.#session, this.#activeOperationId)) return;
      this.#dependencies.onFrame?.({
        sessionId: this.#session.sessionId,
        ...meta,
        mime: 'image/png',
        data: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
      });
      return;
    }
    if (type !== PACKET_STATUS) return;
    const status = parseJson(payload);
    if (status.phase === 'devtools') {
      const request = this.#pendingDevToolsRequest;
      if (!request || positiveInteger(status.requestId, 'developer tools request id') !== request.id) return;
      if (status.status === 'opened' || status.status === 'closed') {
        this.#resolvePendingDevTools({ status: status.status });
      } else {
        const diagnostic = redactPreviewError(String(status.message || 'Developer tools are unavailable.'), this.#preparation);
        console.warn(`[map-preview] Developer tools unavailable: ${diagnostic}`);
        this.#resolvePendingDevTools({
          code: 'preview-devtools-unsupported',
          error: 'The map preview runtime does not support developer tools.',
        });
      }
      return;
    }
    if (status.phase === 'frame-meta') {
      this.#pendingFrameMeta = frameMeta(status);
      return;
    }
    const operationId = positiveInteger(status.operationId, 'runtime operation id');
    if (operationId !== this.#activeOperationId) return;
    if (status.phase === 'ready') {
      this.#clearStartupTimeout();
      const readyPatch: Partial<MapPreviewSession> = {
        operationId,
        mapId: positiveInteger(status.mapId, 'runtime mapId'),
        viewportWidth: positiveInteger(status.width, 'runtime viewport width'),
        viewportHeight: positiveInteger(status.height, 'runtime viewport height'),
        mapPixelWidth: positiveInteger(status.mapPixelWidth, 'runtime map pixel width'),
        mapPixelHeight: positiveInteger(status.mapPixelHeight, 'runtime map pixel height'),
        renderMode: status.renderMode === 'tiled' ? 'tiled' : 'full',
        mapRevision: revisionString(status.mapRevision, 'runtime map revision'),
        switchValues: booleanRecord(status.switchValues),
        variableValues: numberRecord(status.variableValues),
      };
      if (!this.#desiredRunning || this.#pendingResume) {
        this.#update({ ...readyPatch, status: 'resuming' });
        this.#beginSuspend(true);
      } else {
        this.#update({ ...readyPatch, status: 'running' });
      }
    } else if (status.phase === 'suspended') {
      this.#clearStartupTimeout();
      this.#pendingFrameMeta = null;
      this.#update({
        status: 'suspended',
        operationId,
        mapId: positiveInteger(status.mapId, 'runtime mapId'),
        mapRevision: revisionString(status.mapRevision, 'runtime map revision'),
      });
      if (this.#desiredRunning && this.#pendingResume) void this.#resumeSuspended().catch((error) => {
        void this.#fail(errorMessage(error), 'runtime-resume-failed');
      });
    } else if (status.phase === 'state') {
      this.#update({
        switchValues: booleanRecord(status.switchValues),
        variableValues: numberRecord(status.variableValues),
      });
    } else if (status.phase === 'loading-map') {
      this.#startupStage = 'loading-map';
      this.#update({
        status: this.#session?.status === 'resuming' ? 'resuming' : 'starting',
        mapId: positiveInteger(status.mapId, 'runtime mapId'),
      });
    } else if (status.phase === 'error') {
      const failureDetail = mapPreviewRuntimeFailureDetail(status, this.#preparation);
      const failureCode = status.failureCode === 'map-render-failed'
        || status.failureCode === 'preview-debug-marker-conflict'
        ? status.failureCode as MapPreviewFailureCode
        : undefined;
      void this.#fail(
        failureDetail.message,
        failureCode,
        failureDetail,
      );
    }
  }

  #sendCommand(command: Record<string, unknown>): void {
    if (!this.#socket || this.#socket.destroyed) throw new Error('Map preview runtime is not connected.');
    this.#socket.write(encodePacket(PACKET_COMMAND, Buffer.from(JSON.stringify(command), 'utf8')));
  }

  #resolvePendingDevTools(result: MapPreviewDevToolsResult): void {
    const request = this.#pendingDevToolsRequest;
    if (!request) return;
    this.#pendingDevToolsRequest = null;
    clearTimeout(request.timer);
    request.resolve(result);
  }

  #requireRunning(): void {
    if (!this.#session || this.#session.status !== 'running' || !this.#preparation) {
      throw new Error('Map preview is not running.');
    }
  }

  #armStartupTimeout(): void {
    this.#clearStartupTimeout();
    this.#startupTimer = setTimeout(() => {
      const output = this.#runtimeOutput.trim();
      if (output) {
        console.warn(`[map-preview] Runtime startup timed out during ${this.#startupStage}: ${redactPreviewError(output, this.#preparation)}`);
      }
      const failure = describeMapPreviewStartupTimeout(this.#startupStage);
      void this.#fail(failure.message, failure.failureCode, {
        stage: this.#startupStage,
        operationId: this.#activeOperationId,
        targetMapId: this.#session?.mapId,
        message: failure.message,
      });
    }, STARTUP_TIMEOUT_MS);
  }

  #armResumeTimeout(stage: string): void {
    this.#clearStartupTimeout();
    this.#startupStage = stage;
    this.#startupTimer = setTimeout(() => {
      const message = `Map preview runtime did not complete ${stage}.`;
      void this.#fail(message, 'runtime-resume-failed', {
        stage,
        operationId: this.#activeOperationId,
        targetMapId: this.#session?.mapId,
        message,
      });
    }, STARTUP_TIMEOUT_MS);
  }

  #clearStartupTimeout(): void {
    if (this.#startupTimer) clearTimeout(this.#startupTimer);
    this.#startupTimer = null;
  }

  async #fail(
    message: string,
    failureCode?: MapPreviewFailureCode,
    failureDetail?: MapPreviewFailureDetail,
  ): Promise<void> {
    if (!this.#session || this.#session.status === 'failed' || this.#cleanupInProgress) return;
    this.#cleanupInProgress = true;
    const preparation = this.#preparation;
    const diagnostic = redactPreviewError(message, preparation);
    const detail = normalizeMapPreviewFailureDetail({
      stage: failureDetail?.stage || this.#startupStage,
      operationId: failureDetail?.operationId ?? this.#activeOperationId,
      targetMapId: failureDetail?.targetMapId ?? this.#session.mapId,
      ...failureDetail,
      message: failureDetail?.message || diagnostic,
    }, preparation);
    console.warn(`[map-preview] Runtime failed${failureCode ? ` (${failureCode})` : ''}: ${diagnostic}`);
    const cleanupError = await this.#cleanupRuntime();
    this.#finish(
      'failed',
      sanitizeMapPreviewDiagnosticText([diagnostic, cleanupError].filter(Boolean).join(' '), preparation),
      failureCode,
      detail,
    );
    this.#cleanupInProgress = false;
  }

  #appendRuntimeOutput(chunk: unknown): void {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    this.#runtimeOutput = `${this.#runtimeOutput}${text}`.slice(-4000);
  }

  async #cleanupRuntime(): Promise<string> {
    this.#clearStartupTimeout();
    await this.#cancelPreparation();
    this.#resolvePendingDevTools({
      code: 'preview-runtime-unavailable',
      error: 'The map preview runtime stopped.',
    });
    this.#socket?.destroy();
    this.#socket = null;
    this.#server?.close();
    this.#server = null;
    this.#pendingFrameMeta = null;
    const processResult = await stopProcessTree(this.#child);
    this.#child = null;
    return this.#cleanupIsolation(processResult);
  }

  #cleanupRuntimeSync(): string {
    this.#clearStartupTimeout();
    this.#cancelPreparationSync();
    this.#resolvePendingDevTools({
      code: 'preview-runtime-unavailable',
      error: 'The map preview runtime stopped.',
    });
    this.#socket?.destroy();
    this.#socket = null;
    this.#server?.close();
    this.#server = null;
    const processResult = stopProcessTreeSync(this.#child);
    this.#child = null;
    return this.#cleanupIsolation(processResult);
  }

  #cleanupIsolation(processResult: ProcessStopResult): string {
    let isolationError = '';
    if (this.#preparation) {
      const preparation = this.#preparation;
      const evidence = verifyIsolatedSourceState(this.#workflowRoot, preparation);
      if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
        console.warn('[map-preview] Source or staging changed while the isolated preview was warm; cleanup will continue.');
      }
      if (processResult.exited) {
        try {
          cleanupIsolatedProject(preparation);
        } catch (error) {
          isolationError = `Preview temporary project cleanup failed: ${errorMessage(error)}`;
        }
      } else {
        isolationError = 'Preview temporary project was retained because the runtime process did not exit.';
      }
      this.#preparation = null;
    }
    this.#sourceSnapshot = null;
    this.#stagingSnapshot = null;
    this.#pendingMapSyncIds.clear();
    this.#pendingResume = null;
    this.#nextOperationId = 0;
    this.#activeOperationId = 0;
    this.#bridgeConnected = false;
    this.#nextDevToolsRequestId = 0;
    return [processResult.error, isolationError].filter(Boolean).join(' ');
  }

  #update(patch: Partial<MapPreviewSession>): void {
    if (!this.#session) return;
    this.#session = { ...this.#session, ...patch, updatedAt: new Date().toISOString() };
    this.#publish();
  }

  #startIsCurrent(generation: number): boolean {
    return generation === this.#preparationGeneration
      && Boolean(this.#session)
      && !['stopping', 'stopped', 'failed'].includes(this.#session!.status);
  }

  async #cancelPreparation(): Promise<void> {
    this.#preparationGeneration += 1;
    const task = this.#preparationTask;
    this.#preparationTask = null;
    if (task) await task.cancel();
  }

  #cancelPreparationSync(): void {
    this.#preparationGeneration += 1;
    const task = this.#preparationTask;
    this.#preparationTask = null;
    task?.cancelSync();
  }

  #finish(
    status: 'stopped' | 'failed',
    error?: string,
    failureCode?: MapPreviewFailureCode,
    failureDetail?: MapPreviewFailureDetail,
  ): void {
    if (!this.#session) return;
    this.#session = {
      ...this.#session,
      status,
      updatedAt: new Date().toISOString(),
      ...(failureCode ? { failureCode } : {}),
      ...(failureDetail ? { failureDetail } : {}),
      ...(error ? { error } : {}),
    };
    this.#publish();
  }

  #publish(): void {
    if (this.#session) this.#dependencies.onStatus?.({ ...this.#session });
  }
}

interface HarnessOptions {
  token: string;
  port: number;
  mapId: number;
  viewportWidth: number;
  viewportHeight: number;
  geometry: PreviewMapGeometry;
  mapRevision: string;
  operationId: number;
  overrides: MapPreviewOverrides;
}

export function injectPreviewHarness(projectRoot: string, resourceRoot: string, options: HarnessOptions): void {
  const root = fs.realpathSync.native(path.resolve(projectRoot));
  const resources = fs.realpathSync.native(path.resolve(resourceRoot));
  if (!isInside(root, resources)) throw new Error('Map preview resource root escaped the isolated project.');
  const indexPath = path.join(resources, 'index.html');
  const harnessPath = path.join(resources, 'js', 'rpg-agent-map-preview.js');
  const index = fs.readFileSync(indexPath, 'utf8');
  const mainPattern = /(<script\b[^>]*\bsrc=["']js\/main\.js["'][^>]*><\/script>)/i;
  if (!mainPattern.test(index)) throw new Error('RPG Maker index.html does not contain the standard js/main.js entry.');
  const injected = index.replace(mainPattern, '<script src="js/rpg-agent-map-preview.js"></script>\n$1');
  fs.writeFileSync(indexPath, injected, 'utf8');
  fs.writeFileSync(harnessPath, previewHarnessSource(options), 'utf8');

  const packageCandidates = [path.join(root, 'package.json'), path.join(resources, 'package.json')];
  let packageUpdated = false;
  for (const packagePath of [...new Set(packageCandidates)]) {
    if (!fs.existsSync(packagePath)) continue;
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
    const window = manifest.window && typeof manifest.window === 'object' && !Array.isArray(manifest.window)
      ? manifest.window as Record<string, unknown>
      : {};
    manifest.window = {
      ...window,
      width: options.viewportWidth,
      height: options.viewportHeight,
      frame: false,
      show: false,
      show_in_taskbar: false,
      resizable: false,
      inject_js_start: path.relative(path.dirname(packagePath), harnessPath).split(path.sep).join('/'),
    };
    manifest.name = `rmmv-agent-map-preview-${options.token.slice(0, 12)}`;
    manifest['single-instance'] = false;
    const args = String(manifest['chromium-args'] || '').split(/\s+/).filter(Boolean);
    if (!args.includes('--disable-raf-throttling')) args.push('--disable-raf-throttling');
    manifest['chromium-args'] = args.join(' ');
    fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    packageUpdated = true;
  }
  if (!packageUpdated) throw new Error('RPG Maker package.json was not found in the isolated preview project.');
}

export function mapPreviewDebugMarkerBootstrapSource(): string {
  const marker = JSON.stringify(MAP_PREVIEW_DEBUG_MARKER);
  return `  const previewDebugMarkerDescriptor = Object.getOwnPropertyDescriptor(window, ${marker});
  let previewDebugMarkerConflict = '';
  if (!previewDebugMarkerDescriptor) {
    Object.defineProperty(window, ${marker}, {
      value: true,
      writable: false,
      configurable: false,
      enumerable: false
    });
  } else if (
    previewDebugMarkerDescriptor.value !== true
    || previewDebugMarkerDescriptor.writable !== false
    || previewDebugMarkerDescriptor.configurable !== false
    || previewDebugMarkerDescriptor.enumerable !== false
  ) {
    previewDebugMarkerConflict = 'The project defines an incompatible RPG Agent preview debug marker.';
  }`;
}

function previewHarnessSource(options: HarnessOptions): string {
  const config = JSON.stringify(options).replace(/</g, '\\u003c');
  return `/* Generated only inside an isolated map-preview project. */
(function () {
  'use strict';
  const config = ${config};
${mapPreviewDebugMarkerBootstrapSource()}
  if (window.__rpgAgentMapPreviewInstalled) return;
  window.__rpgAgentMapPreviewInstalled = true;
  const net = require('net');
  const HEADER_BYTES = 5;
  const PACKET_HANDSHAKE = 1;
  const PACKET_STATUS = 2;
  const PACKET_FRAME = 3;
  const PACKET_COMMAND = 10;
  const switchOverrides = Object.create(null);
  const variableOverrides = Object.create(null);
  const baselineSwitchValues = Object.create(null);
  const baselineVariableValues = Object.create(null);
  let socket = null;
  let receiveBuffer = Buffer.alloc(0);
  let captureStarted = false;
  let captureTimer = null;
  let awaitingFrameAck = false;
  let encodingFrame = false;
  let captureEpoch = 0;
  let nextFrameDeadline = 0;
  let lastFrameSequence = 0;
  let frameGeneration = 0;
  let initializing = false;
  let currentMapId = Number(config.mapId);
  let currentGeometry = config.geometry;
  let currentMapRevision = String(config.mapRevision || '');
  let currentOperationId = Number(config.operationId);
  let currentRenderMode = 'full';
  let currentView = { x: 0, y: 0, width: Number(config.viewportWidth), height: Number(config.viewportHeight), scale: 1 };
  let tiledOverviewDelivered = false;
  let runtimeSuspended = false;
  let newGameInitialized = false;
  let runtimeStage = 'boot';
  let runtimeSourceMapId = 0;
  let runtimeTargetMapId = currentMapId;
  let overviewCanvas = null;
  let overviewContext = null;
  let detailCanvas = null;
  let detailContext = null;
  const failedResources = new Set();
  const FRAME_INTERVAL_MS = 1000 / 15;

  replaceObject(switchOverrides, config.overrides && config.overrides.switches);
  replaceObject(variableOverrides, config.overrides && config.overrides.variables);

  function packet(type, payload) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8');
    const header = Buffer.allocUnsafe(HEADER_BYTES);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(body.length, 1);
    return Buffer.concat([header, body]);
  }
  function send(type, value) {
    if (!socket || socket.destroyed) return;
    const payload = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
    socket.write(packet(type, payload));
  }
  function reportError(error) {
    const message = String(error && (error.stack || error.message) || error || 'Unknown map preview error');
    const scene = window.SceneManager && SceneManager._scene;
    let resourcesReady = false;
    try { resourcesReady = !window.ImageManager || !ImageManager.isReady || ImageManager.isReady(); } catch (_) {}
    send(PACKET_STATUS, {
      phase: 'error',
      operationId: currentOperationId,
      mapId: runtimeTargetMapId,
      mapRevision: currentMapRevision,
      failureCode: 'map-render-failed',
      stage: runtimeStage,
      sourceMapId: runtimeSourceMapId,
      targetMapId: runtimeTargetMapId,
      scene: scene && scene.constructor ? scene.constructor.name : null,
      transferring: Boolean(window.$gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring()),
      resourcesReady: resourcesReady,
      resources: Array.from(failedResources).slice(0, ${MAX_FAILED_RESOURCES}),
      message: message.slice(0, 3000)
    });
  }
  function installResourceErrorTracking() {
    if (!window.Bitmap || !Bitmap.prototype || Bitmap.prototype.__rpgAgentPreviewErrorTracking) return;
    const prototype = Bitmap.prototype;
    const originalOnError = prototype._onError;
    prototype._onError = function () {
      const resource = String(this && this._url || '');
      if (resource) failedResources.add(resource);
      if (typeof originalOnError === 'function') return originalOnError.apply(this, arguments);
    };
    Object.defineProperty(prototype, '__rpgAgentPreviewErrorTracking', { value: true, configurable: true });
  }
  window.addEventListener('error', function (event) {
    reportError(event && (event.error || event.message));
  });
  window.addEventListener('unhandledrejection', function (event) {
    reportError(event && event.reason);
  });
  function connect() {
    socket = net.connect({ host: '127.0.0.1', port: Number(config.port) }, function () {
      send(PACKET_HANDSHAKE, { token: config.token });
      if (previewDebugMarkerConflict) {
        send(PACKET_STATUS, {
          phase: 'error',
          operationId: currentOperationId,
          mapId: currentMapId,
          mapRevision: currentMapRevision,
          failureCode: 'preview-debug-marker-conflict',
          stage: 'preview-debug-marker',
          sourceMapId: 0,
          targetMapId: currentMapId,
          scene: null,
          transferring: false,
          resourcesReady: false,
          resources: [],
          message: previewDebugMarkerConflict
        });
        return;
      }
      loadMap('fresh', currentMapId, currentGeometry, config.overrides, false, currentMapRevision, currentOperationId).catch(reportError);
    });
    socket.on('data', function (chunk) {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
      while (receiveBuffer.length >= HEADER_BYTES) {
        const type = receiveBuffer.readUInt8(0);
        const length = receiveBuffer.readUInt32BE(1);
        if (receiveBuffer.length < HEADER_BYTES + length) return;
        const payload = receiveBuffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
        receiveBuffer = receiveBuffer.subarray(HEADER_BYTES + length);
        if (type === PACKET_COMMAND) {
          try { handleCommand(JSON.parse(payload.toString('utf8'))); } catch (error) { reportError(error); }
        }
      }
    });
    socket.on('error', reportError);
  }

  function installFreezeRules() {
    if (window.SceneManager && !SceneManager._rpgAgentPreviewCatchInstalled && typeof SceneManager.catchException === 'function') {
      const catchException = SceneManager.catchException;
      SceneManager.catchException = function (error) {
        reportError(error);
        return catchException.apply(this, arguments);
      };
      SceneManager._rpgAgentPreviewCatchInstalled = true;
    }
    if (window.SceneManager) {
      SceneManager.isGameActive = function () { return true; };
    }
    if (window.Input) {
      Input.clear && Input.clear();
      Input.update = function () { this._currentState = {}; this._latestButton = null; };
      Input._onKeyDown = function () {};
      Input._onKeyUp = function () {};
    }
    if (window.TouchInput) {
      TouchInput.clear && TouchInput.clear();
      TouchInput.update = function () {};
      TouchInput._onMouseDown = function () {};
      TouchInput._onTouchStart = function () {};
    }
    if (window.Game_Player) {
      Game_Player.prototype.moveByInput = function () {};
      Game_Player.prototype.canMove = function () { return false; };
      Game_Player.prototype.updateScroll = function () {};
      Game_Player.prototype.updateVehicle = function () {};
      Game_Player.prototype.triggerAction = function () { return false; };
      Game_Player.prototype.checkEventTriggerHere = function () {};
      Game_Player.prototype.checkEventTriggerThere = function () {};
      Game_Player.prototype.checkEventTriggerTouch = function () {};
    }
    if (window.Game_Event) {
      Game_Event.prototype.start = function () {};
      Game_Event.prototype.update = function () {};
      Game_Event.prototype.updateSelfMovement = function () {};
      Game_Event.prototype.updateParallel = function () {};
    }
    if (window.Game_Map) {
      Game_Map.prototype.updateInterpreter = function () {};
      Game_Map.prototype.setupStartingEvent = function () { return false; };
    }
    if (window.Game_CommonEvent) Game_CommonEvent.prototype.update = function () {};
    if (window.Game_Interpreter) Game_Interpreter.prototype.update = function () {};
    if (window.Utils && Utils.RPGMAKER_NAME === 'MZ' && window.Scene_Map && Scene_Map.prototype) {
      Scene_Map.prototype.createMenuButton = function () { this._menuButton = null; };
    }
    if (window.DataManager) {
      const isMZ = window.Utils && Utils.RPGMAKER_NAME === 'MZ';
      DataManager.saveGame = function () { return isMZ ? Promise.resolve(false) : false; };
      DataManager.saveGameWithoutRescue = function () { return isMZ ? Promise.resolve(false) : false; };
      if (isMZ && window.Scene_Base) Scene_Base.prototype.requestAutosave = function () {};
    }
    if (window.AudioManager) {
      AudioManager.stopAll && AudioManager.stopAll();
      AudioManager.playBgm = function () {};
      AudioManager.playBgs = function () {};
      AudioManager.playMe = function () {};
      AudioManager.playSe = function () {};
    }
  }

  function waitFor(predicate, label, timeout, diagnostic) {
    const deadline = Date.now() + (timeout || 12000);
    return new Promise(function (resolve, reject) {
      (function poll() {
        try {
          if (predicate()) return resolve();
          if (Date.now() >= deadline) {
            const detail = typeof diagnostic === 'function' ? String(diagnostic() || '') : '';
            return reject(new Error('Timed out waiting for ' + label + (detail ? ': ' + detail : '')));
          }
        } catch (error) { return reject(error); }
        setTimeout(poll, 16);
      }());
    });
  }

  function refreshEvents() {
    if (!$gameMap || !$gameMap.events) return;
    $gameMap.requestRefresh && $gameMap.requestRefresh();
    $gameMap.events().forEach(function (event) { event && event.refresh && event.refresh(); });
  }
  function replaceObject(target, source) {
    Object.keys(target).forEach(function (id) { delete target[id]; });
    Object.keys(source || {}).forEach(function (id) { target[id] = source[id]; });
  }
  function replaceOverrides(overrides) {
    restoreOverrideBaseline();
    replaceObject(switchOverrides, overrides && overrides.switches);
    replaceObject(variableOverrides, overrides && overrides.variables);
    if (window.$gameSwitches && window.$gameVariables) applyOverrides();
  }
  function restoreOverrideBaseline() {
    Object.keys(switchOverrides).forEach(function (id) {
      if ($gameSwitches) $gameSwitches.setValue(Number(id), Boolean(baselineSwitchValues[id]));
    });
    Object.keys(variableOverrides).forEach(function (id) {
      if ($gameVariables) $gameVariables.setValue(Number(id), Number(baselineVariableValues[id] || 0));
    });
    replaceObject(switchOverrides, null);
    replaceObject(variableOverrides, null);
    refreshEvents();
  }
  function applyOverrides() {
    Object.keys(switchOverrides).forEach(function (id) { $gameSwitches.setValue(Number(id), Boolean(switchOverrides[id])); });
    Object.keys(variableOverrides).forEach(function (id) { $gameVariables.setValue(Number(id), Number(variableOverrides[id])); });
    refreshEvents();
  }
  function currentState() {
    const switchValues = Object.create(null);
    const variableValues = Object.create(null);
    ($gameSwitches._data || []).forEach(function (value, id) { if (id > 0) switchValues[id] = Boolean(value); });
    ($gameVariables._data || []).forEach(function (value, id) { if (id > 0 && Number.isFinite(Number(value))) variableValues[id] = Number(value); });
    return { switchValues: switchValues, variableValues: variableValues };
  }
  function captureBaselineState() {
    Object.keys(baselineSwitchValues).forEach(function (id) { delete baselineSwitchValues[id]; });
    Object.keys(baselineVariableValues).forEach(function (id) { delete baselineVariableValues[id]; });
    const state = currentState();
    Object.keys(state.switchValues).forEach(function (id) { baselineSwitchValues[id] = state.switchValues[id]; });
    Object.keys(state.variableValues).forEach(function (id) { baselineVariableValues[id] = state.variableValues[id]; });
  }
  function sendState() {
    const state = currentState();
    send(PACKET_STATUS, {
      phase: 'state',
      operationId: currentOperationId,
      mapId: currentMapId,
      mapRevision: currentMapRevision,
      switchValues: state.switchValues,
      variableValues: state.variableValues
    });
  }

  function rendererAndCanvas() {
    const renderer = window.Graphics && (Graphics.app && Graphics.app.renderer || Graphics._renderer);
    const canvas = window.Graphics && (Graphics._canvas || renderer && renderer.view);
    if (!renderer || !canvas || typeof renderer.render !== 'function') {
      throw new Error('The RPG Maker renderer is unavailable.');
    }
    return { renderer: renderer, canvas: canvas };
  }
  function maxTextureSize() {
    try {
      const renderer = rendererAndCanvas().renderer;
      const gl = renderer.gl || renderer.context && renderer.context.gl;
      return gl && gl.getParameter ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096 : 4096;
    } catch (_) { return 4096; }
  }
  function chooseRenderMode(geometry) {
    const maxTexture = maxTextureSize();
    const pixels = Number(geometry.pixelWidth) * Number(geometry.pixelHeight);
    return Number(geometry.pixelWidth) <= maxTexture
      && Number(geometry.pixelHeight) <= maxTexture
      && pixels <= 67108864 ? 'full' : 'tiled';
  }
  function resizeGraphics(width, height) {
    const nextWidth = Math.max(1, Math.floor(Number(width)));
    const nextHeight = Math.max(1, Math.floor(Number(height)));
    if (typeof Graphics.resize === 'function') {
      Graphics.resize(nextWidth, nextHeight);
    } else {
      Graphics._width = nextWidth;
      Graphics._height = nextHeight;
      if (Object.prototype.hasOwnProperty.call(Graphics, '_boxWidth')) Graphics._boxWidth = nextWidth;
      if (Object.prototype.hasOwnProperty.call(Graphics, '_boxHeight')) Graphics._boxHeight = nextHeight;
      Graphics._updateAllElements && Graphics._updateAllElements();
    }
    Graphics._boxWidth = nextWidth;
    Graphics._boxHeight = nextHeight;
    if (window.SceneManager) {
      SceneManager._screenWidth = nextWidth;
      SceneManager._screenHeight = nextHeight;
      SceneManager._boxWidth = nextWidth;
      SceneManager._boxHeight = nextHeight;
    }
  }

  function resumeSceneManager() {
    if (!window.SceneManager || !runtimeSuspended) return;
    if (typeof SceneManager.resume === 'function') SceneManager.resume();
    else if (typeof SceneManager.requestUpdate === 'function') SceneManager.requestUpdate();
    runtimeSuspended = false;
  }

  function suspendRuntime(operationId) {
    if (Number(operationId) !== currentOperationId) return;
    invalidateCapture();
    frameGeneration += 1;
    if (window.SceneManager && typeof SceneManager.stop === 'function') SceneManager.stop();
    runtimeSuspended = true;
    send(PACKET_STATUS, { phase: 'suspended', operationId: currentOperationId, mapId: currentMapId, mapRevision: currentMapRevision });
  }

  function resumeRuntime(overrides, operationId) {
    currentOperationId = Number(operationId);
    replaceOverrides(overrides || {});
    resumeSceneManager();
    const state = currentState();
    send(PACKET_STATUS, {
      phase: 'ready',
      operationId: currentOperationId,
      mapId: currentMapId,
      width: Number(config.viewportWidth),
      height: Number(config.viewportHeight),
      mapPixelWidth: Number(currentGeometry.pixelWidth),
      mapPixelHeight: Number(currentGeometry.pixelHeight),
      renderMode: currentRenderMode,
      mapRevision: currentMapRevision,
      switchValues: state.switchValues,
      variableValues: state.variableValues
    });
    startCapture();
  }

  async function loadMap(purpose, mapId, geometry, overrides, forceTiled, mapRevision, operationId) {
    if (initializing) throw new Error('A map preview load is already active.');
    if (purpose !== 'fresh' && purpose !== 'switch' && purpose !== 'reload') {
      throw new Error('Unsupported map preview load purpose: ' + String(purpose));
    }
    const targetMapId = Number(mapId);
    const targetGeometry = geometry || currentGeometry;
    const targetRevision = String(mapRevision || '');
    const targetOperationId = Number(operationId);
    const previousScene = window.SceneManager && SceneManager._scene;
    runtimeSourceMapId = currentMapId;
    runtimeTargetMapId = targetMapId;
    currentOperationId = targetOperationId;
    runtimeStage = 'prepare-' + purpose;
    let loaded = false;
    initializing = true;
    invalidateCapture();
    tiledOverviewDelivered = false;
    failedResources.clear();
    send(PACKET_STATUS, {
      phase: 'loading-map',
      operationId: targetOperationId,
      mapId: targetMapId,
      mapRevision: targetRevision,
      purpose: purpose
    });
    try {
      runtimeStage = 'database-ready';
      await waitFor(function () {
        return window.DataManager && window.SceneManager && window.Scene_Map && DataManager.isDatabaseLoaded && DataManager.isDatabaseLoaded();
      }, 'RPG Maker database');
      installFreezeRules();
      installResourceErrorTracking();
      resumeSceneManager();
      if (purpose === 'fresh' && window.Scene_Boot) {
        runtimeStage = 'boot-sequence';
        await waitFor(function () {
          const scene = SceneManager._scene;
          return scene && !(scene instanceof Scene_Boot) && SceneManager._sceneStarted !== false;
        }, 'RPG Maker boot sequence', 18000, function () {
          const scene = SceneManager._scene;
          return JSON.stringify({
            scene: scene && scene.constructor ? scene.constructor.name : null,
            sceneStarted: SceneManager._sceneStarted
          });
        });
      }
      if (purpose === 'fresh' && window.Utils && Utils.RPGMAKER_NAME === 'MZ' && DataManager._globalInfo == null && DataManager.loadGlobalInfo) {
        runtimeStage = 'save-metadata';
        DataManager.loadGlobalInfo();
        await waitFor(function () { return Array.isArray(DataManager._globalInfo); }, 'RPG Maker save metadata');
      }
      runtimeStage = 'resize-renderer';
      const targetRenderMode = forceTiled ? 'tiled' : chooseRenderMode(targetGeometry);
      if (targetRenderMode === 'full' && window.PluginManager && PluginManager._parameters) {
        PluginManager._parameters.shadertilemap = Object.assign(
          {},
          PluginManager._parameters.shadertilemap || {},
          { squareShader: '1' }
        );
      }
      resizeGraphics(
        targetRenderMode === 'full' ? targetGeometry.pixelWidth : config.viewportWidth,
        targetRenderMode === 'full' ? targetGeometry.pixelHeight : config.viewportHeight
      );
      runtimeStage = 'prepare-game-objects';
      if (purpose === 'fresh') {
        if (newGameInitialized) throw new Error('New game initialization may only run once per preview runtime.');
        DataManager.setupNewGame();
        newGameInitialized = true;
      } else {
        if (!newGameInitialized) throw new Error('Map preview cannot switch before new game initialization.');
        restoreOverrideBaseline();
      }
      replaceObject(switchOverrides, overrides && overrides.switches);
      replaceObject(variableOverrides, overrides && overrides.variables);
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      runtimeStage = 'reserve-transfer';
      $gamePlayer.reserveTransfer(targetMapId, 0, 0, 2, 2);
      runtimeStage = 'rebuild-scene';
      SceneManager.goto(Scene_Map);
      await waitFor(function () {
        return SceneManager._scene
          && SceneManager._scene instanceof Scene_Map
          && SceneManager._scene !== previousScene
          && SceneManager._scene._spriteset
          && SceneManager._sceneStarted !== false
          && (!$gamePlayer.isTransferring || !$gamePlayer.isTransferring())
          && $gameMap.mapId() === targetMapId;
      }, 'map scene', 12000, function () {
        const scene = SceneManager._scene;
        return JSON.stringify({
          scene: scene && scene.constructor ? scene.constructor.name : null,
          sceneReplaced: scene !== previousScene,
          spriteset: Boolean(scene && scene._spriteset),
          sceneStarted: SceneManager._sceneStarted,
          transferring: Boolean($gamePlayer && $gamePlayer.isTransferring && $gamePlayer.isTransferring()),
          mapId: $gameMap && $gameMap.mapId ? $gameMap.mapId() : null,
          targetMapId: targetMapId
        });
      });
      runtimeStage = 'renderer-resources';
      await waitFor(function () {
        if (failedResources.size) throw new Error('One or more map resources failed to load.');
        return (!window.ImageManager || !ImageManager.isReady || ImageManager.isReady())
          && (!SceneManager._scene.isReady || SceneManager._scene.isReady());
      }, 'map renderer resources');
      currentMapId = targetMapId;
      currentGeometry = targetGeometry;
      currentMapRevision = targetRevision;
      currentRenderMode = targetRenderMode;
      runtimeSourceMapId = currentMapId;
      $gamePlayer.setTransparent(true);
      $gamePlayer.setThrough(true);
      runtimeStage = 'apply-overrides';
      captureBaselineState();
      applyOverrides();
      $gameMap.setDisplayPos(0, 0);
      const state = currentState();
      runtimeStage = 'ready';
      send(PACKET_STATUS, {
        phase: 'ready',
        operationId: currentOperationId,
        mapId: currentMapId,
        width: Number(config.viewportWidth),
        height: Number(config.viewportHeight),
        mapPixelWidth: Number(currentGeometry.pixelWidth),
        mapPixelHeight: Number(currentGeometry.pixelHeight),
        renderMode: currentRenderMode,
        mapRevision: currentMapRevision,
        switchValues: state.switchValues,
        variableValues: state.variableValues
      });
      startCapture();
      loaded = true;
    } finally {
      if (loaded) runtimeStage = 'idle';
      initializing = false;
    }
  }

  function sendDevToolsResult(requestId, status, message) {
    send(PACKET_STATUS, {
      phase: 'devtools',
      requestId: Number(requestId),
      status: status,
      message: String(message || '')
    });
  }

  function toggleRuntimeDevTools(requestId) {
    try {
      if (typeof nw !== 'object' || !nw.Window || typeof nw.Window.get !== 'function') {
        sendDevToolsResult(requestId, 'unsupported', 'The NW.js window API is unavailable.');
        return;
      }
      const runtimeWindow = nw.Window.get();
      if (
        !runtimeWindow
        || typeof runtimeWindow.showDevTools !== 'function'
        || typeof runtimeWindow.closeDevTools !== 'function'
        || typeof runtimeWindow.isDevToolsOpen !== 'function'
      ) {
        sendDevToolsResult(requestId, 'unsupported', 'This NW.js runtime does not expose developer tools control.');
        return;
      }
      if (runtimeWindow.isDevToolsOpen()) {
        runtimeWindow.closeDevTools();
        sendDevToolsResult(requestId, 'closed');
        return;
      }
      let reported = false;
      runtimeWindow.showDevTools(function () {
        if (reported) return;
        reported = true;
        sendDevToolsResult(requestId, 'opened');
      });
    } catch (error) {
      sendDevToolsResult(
        requestId,
        'unsupported',
        String(error && (error.stack || error.message) || error || 'Developer tools failed to open.')
      );
    }
  }

  function handleCommand(command) {
    if (!command || typeof command !== 'object') throw new Error('Invalid map preview command');
    if (command.type === 'toggle-devtools') {
      toggleRuntimeDevTools(command.requestId);
      return;
    }
    if (command.type === 'select-map') {
      loadMap('switch', Number(command.mapId), command.geometry, command.overrides, false, command.mapRevision, Number(command.operationId)).catch(reportError);
      return;
    }
    if (command.type === 'suspend') {
      suspendRuntime(command.operationId);
      return;
    }
    if (command.type === 'resume') {
      if (command.purpose === 'switch' || command.purpose === 'reload') {
        resumeSceneManager();
        loadMap(command.purpose, Number(command.mapId), command.geometry, command.overrides, false, command.mapRevision, Number(command.operationId)).catch(reportError);
      } else {
        currentMapRevision = String(command.mapRevision || currentMapRevision || '');
        resumeRuntime(command.overrides, command.operationId);
      }
      return;
    }
    if (command.type === 'pan-camera') {
      if (!$gameMap) return;
      const tileWidth = Math.max(1, Number($gameMap.tileWidth && $gameMap.tileWidth()) || 48);
      const tileHeight = Math.max(1, Number($gameMap.tileHeight && $gameMap.tileHeight()) || tileWidth);
      $gameMap.setDisplayPos(
        Number($gameMap.displayX()) + Number(command.deltaX || 0) / tileWidth,
        Number($gameMap.displayY()) + Number(command.deltaY || 0) / tileHeight
      );
      return;
    }
    if (command.type === 'set-switch') {
      switchOverrides[Number(command.id)] = Boolean(command.value);
      $gameSwitches.setValue(Number(command.id), Boolean(command.value));
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'set-variable') {
      const value = Number(command.value);
      if (!Number.isFinite(value)) throw new Error('Variable override must be finite');
      variableOverrides[Number(command.id)] = value;
      $gameVariables.setValue(Number(command.id), value);
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'reset-overrides') {
      Object.keys(switchOverrides).forEach(function (id) {
        delete switchOverrides[id];
        $gameSwitches.setValue(Number(id), Boolean(baselineSwitchValues[id]));
      });
      Object.keys(variableOverrides).forEach(function (id) {
        delete variableOverrides[id];
        $gameVariables.setValue(Number(id), Number(baselineVariableValues[id] || 0));
      });
      refreshEvents();
      sendState();
      return;
    }
    if (command.type === 'replace-overrides') {
      replaceOverrides(command.overrides || {});
      sendState();
      return;
    }
    if (command.type === 'ack-frame') {
      if (Number(command.sequence) === lastFrameSequence) {
        awaitingFrameAck = false;
        scheduleCapture();
      }
      return;
    }
    if (command.type === 'set-view') {
      currentView = {
        x: Math.max(0, Number(command.x) || 0),
        y: Math.max(0, Number(command.y) || 0),
        width: Math.max(1, Number(command.width) || Number(config.viewportWidth)),
        height: Math.max(1, Number(command.height) || Number(config.viewportHeight)),
        scale: Math.max(0.01, Number(command.scale) || 1)
      };
      return;
    }
    throw new Error('Unsupported map preview command: ' + String(command.type));
  }

  function startCapture() {
    if (captureStarted) return;
    captureStarted = true;
    nextFrameDeadline = nowMilliseconds();
    scheduleCapture();
  }

  function invalidateCapture() {
    captureStarted = false;
    awaitingFrameAck = false;
    captureEpoch += 1;
    nextFrameDeadline = 0;
    if (captureTimer) clearTimeout(captureTimer);
    captureTimer = null;
  }

  function nowMilliseconds() {
    return window.performance && typeof performance.now === 'function' ? performance.now() : Date.now();
  }

  function scheduleCapture() {
    if (!captureStarted || awaitingFrameAck || encodingFrame || captureTimer) return;
    const delay = Math.max(0, nextFrameDeadline - nowMilliseconds());
    captureTimer = setTimeout(function () {
      captureTimer = null;
      captureNext().catch(reportError);
    }, delay);
  }

  async function captureNext() {
    if (!captureStarted || awaitingFrameAck || encodingFrame || initializing) return;
    const epoch = captureEpoch;
    encodingFrame = true;
    nextFrameDeadline = nowMilliseconds() + FRAME_INTERVAL_MS;
    try {
      if (window.SceneManager && SceneManager._scene && typeof SceneManager._scene.update === 'function') {
        SceneManager._scene.update();
      }
      if (currentRenderMode === 'full') await captureFullFrame(epoch);
      else if (!tiledOverviewDelivered || currentView.scale < 1) await captureOverviewFrame(epoch);
      else await captureVisibleDetailFrame(epoch);
    } finally {
      encodingFrame = false;
      if (captureStarted && !awaitingFrameAck) scheduleCapture();
    }
  }

  function renderCurrentScene() {
    const state = rendererAndCanvas();
    state.renderer.render(SceneManager._scene);
    return state.canvas;
  }

  async function captureFullFrame(epoch) {
    const canvas = renderCurrentScene();
    const bytes = await encodeCanvas(canvas);
    if (!captureIsCurrent(epoch)) return;
    if (bytes.length > 134217728) {
      currentRenderMode = 'tiled';
      loadMap(
        'reload',
        currentMapId,
        currentGeometry,
        { switches: Object.assign({}, switchOverrides), variables: Object.assign({}, variableOverrides) },
        true,
        currentMapRevision,
        currentOperationId
      ).catch(reportError);
      return;
    }
    emitCanvasFrame(canvas, bytes, 'full', 0, 0, Number(currentGeometry.pixelWidth), Number(currentGeometry.pixelHeight), epoch);
  }

  async function captureOverviewFrame(epoch) {
    const mapWidth = Number(currentGeometry.pixelWidth);
    const mapHeight = Number(currentGeometry.pixelHeight);
    const viewportWidth = Number(config.viewportWidth);
    const viewportHeight = Number(config.viewportHeight);
    const overviewScale = Math.min(1, 4096 / mapWidth, 4096 / mapHeight, Math.sqrt(4000000 / (mapWidth * mapHeight)));
    const overviewState = reusableCanvas('overview', Math.max(1, Math.ceil(mapWidth * overviewScale)), Math.max(1, Math.ceil(mapHeight * overviewScale)));
    const overview = overviewState.canvas;
    const context = overviewState.context;
    context.clearRect(0, 0, overview.width, overview.height);
    context.imageSmoothingEnabled = false;
    const tileWidth = Math.max(1, Number($gameMap.tileWidth && $gameMap.tileWidth()) || Number(currentGeometry.tileSize));
    const tileHeight = Math.max(1, Number($gameMap.tileHeight && $gameMap.tileHeight()) || tileWidth);
    for (let y = 0; y < mapHeight; y += viewportHeight) {
      const cameraY = Math.max(0, Math.min(y, mapHeight - viewportHeight));
      for (let x = 0; x < mapWidth; x += viewportWidth) {
        const cameraX = Math.max(0, Math.min(x, mapWidth - viewportWidth));
        $gameMap.setDisplayPos(cameraX / tileWidth, cameraY / tileHeight);
        SceneManager._scene._spriteset && SceneManager._scene._spriteset.update && SceneManager._scene._spriteset.update();
        const source = renderCurrentScene();
        const sourceX = Math.max(0, x - cameraX);
        const sourceY = Math.max(0, y - cameraY);
        const sourceWidth = Math.min(viewportWidth - sourceX, mapWidth - x);
        const sourceHeight = Math.min(viewportHeight - sourceY, mapHeight - y);
        context.drawImage(
          source,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          Math.floor(x * overviewScale),
          Math.floor(y * overviewScale),
          Math.ceil(sourceWidth * overviewScale),
          Math.ceil(sourceHeight * overviewScale)
        );
      }
    }
    $gameMap.setDisplayPos(0, 0);
    const bytes = await encodeCanvas(overview);
    if (!captureIsCurrent(epoch)) return;
    if (bytes.length > 134217728) throw new Error('The complete map preview overview exceeded 128 MiB.');
    tiledOverviewDelivered = true;
    emitCanvasFrame(overview, bytes, 'overview', 0, 0, mapWidth, mapHeight, epoch);
  }

  async function captureVisibleDetailFrame(epoch) {
    const mapWidth = Number(currentGeometry.pixelWidth);
    const mapHeight = Number(currentGeometry.pixelHeight);
    const viewportWidth = Number(config.viewportWidth);
    const viewportHeight = Number(config.viewportHeight);
    const x = Math.max(0, Math.min(Math.floor(currentView.x), mapWidth - 1));
    const y = Math.max(0, Math.min(Math.floor(currentView.y), mapHeight - 1));
    const width = Math.max(1, Math.min(Math.ceil(currentView.width), mapWidth - x));
    const height = Math.max(1, Math.min(Math.ceil(currentView.height), mapHeight - y));
    const detailState = reusableCanvas('detail', width, height);
    const detail = detailState.canvas;
    const context = detailState.context;
    context.clearRect(0, 0, detail.width, detail.height);
    context.imageSmoothingEnabled = false;
    const tileWidth = Math.max(1, Number($gameMap.tileWidth && $gameMap.tileWidth()) || Number(currentGeometry.tileSize));
    const tileHeight = Math.max(1, Number($gameMap.tileHeight && $gameMap.tileHeight()) || tileWidth);
    for (let targetY = y; targetY < y + height; targetY += viewportHeight) {
      const cameraY = Math.max(0, Math.min(targetY, mapHeight - viewportHeight));
      for (let targetX = x; targetX < x + width; targetX += viewportWidth) {
        const cameraX = Math.max(0, Math.min(targetX, mapWidth - viewportWidth));
        $gameMap.setDisplayPos(cameraX / tileWidth, cameraY / tileHeight);
        SceneManager._scene._spriteset && SceneManager._scene._spriteset.update && SceneManager._scene._spriteset.update();
        const source = renderCurrentScene();
        const sourceX = Math.max(0, targetX - cameraX);
        const sourceY = Math.max(0, targetY - cameraY);
        const sourceWidth = Math.min(viewportWidth - sourceX, x + width - targetX);
        const sourceHeight = Math.min(viewportHeight - sourceY, y + height - targetY);
        context.drawImage(
          source,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          targetX - x,
          targetY - y,
          sourceWidth,
          sourceHeight
        );
      }
    }
    const bytes = await encodeCanvas(detail);
    if (!captureIsCurrent(epoch)) return;
    if (bytes.length > 134217728) throw new Error('The visible map preview detail exceeded 128 MiB.');
    emitCanvasFrame(detail, bytes, 'tile', x, y, width, height, epoch);
  }

  function encodeCanvas(canvas) {
    if (!canvas || typeof canvas.toBlob !== 'function' || typeof FileReader !== 'function') {
      return Promise.reject(new Error('The RPG Maker runtime does not support asynchronous PNG capture.'));
    }
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) return reject(new Error('The RPG Maker renderer returned an invalid preview frame.'));
        const reader = new FileReader();
        reader.onerror = function () { reject(new Error('The RPG Maker runtime could not read the encoded preview frame.')); };
        reader.onload = function () {
          if (!(reader.result instanceof ArrayBuffer)) return reject(new Error('The encoded preview frame was not binary data.'));
          resolve(Buffer.from(reader.result));
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  }

  function reusableCanvas(kind, width, height) {
    let canvas = kind === 'overview' ? overviewCanvas : detailCanvas;
    let context = kind === 'overview' ? overviewContext : detailContext;
    if (!canvas) {
      canvas = document.createElement('canvas');
      context = canvas.getContext('2d');
      if (!context) throw new Error('The map preview ' + kind + ' canvas is unavailable.');
      context.imageSmoothingEnabled = false;
      if (kind === 'overview') {
        overviewCanvas = canvas;
        overviewContext = context;
      } else {
        detailCanvas = canvas;
        detailContext = context;
      }
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.imageSmoothingEnabled = false;
    return { canvas: canvas, context: context };
  }

  function captureIsCurrent(epoch) {
    return captureStarted && !initializing && epoch === captureEpoch;
  }

  function emitCanvasFrame(canvas, bytes, kind, x, y, width, height, epoch) {
    if (!captureIsCurrent(epoch)) return;
    lastFrameSequence += 1;
    frameGeneration += 1;
    send(PACKET_STATUS, {
      phase: 'frame-meta',
      operationId: currentOperationId,
      mapId: currentMapId,
      sequence: lastFrameSequence,
      generation: frameGeneration,
      kind: kind,
      mapPixelWidth: Number(currentGeometry.pixelWidth),
      mapPixelHeight: Number(currentGeometry.pixelHeight),
      x: x,
      y: y,
      width: width,
      height: height,
      outputWidth: Number(canvas.width),
      outputHeight: Number(canvas.height),
      mapRevision: currentMapRevision
    });
    send(PACKET_FRAME, bytes);
    awaitingFrameAck = true;
  }

  window.addEventListener('error', function (event) { reportError(event.error || event.message); });
  window.addEventListener('unhandledrejection', function (event) { reportError(event.reason); });
  process.on && process.on('uncaughtException', reportError);
  installFreezeRules();
  connect();
}());
`;
}

export function assertNoStagingConflicts(workflowRoot: string, project: string): void {
  const status = getProjectStagingStatus(workflowRoot, project) as { files?: Array<Record<string, unknown>> };
  const relativePaths = (status.files || []).map((entry) => String(entry.relativePath || '')).filter(Boolean);
  if (!relativePaths.length) return;
  const preflight = preflightStagedProjectFiles(workflowRoot, project, relativePaths) as Array<Record<string, unknown>>;
  const conflicts = preflight.filter((entry) => Array.isArray(entry.conflictReasons) && entry.conflictReasons.length > 0);
  if (conflicts.length) throw new Error('Resolve staged project conflicts before starting map preview.');
}

function previewExecutable(runtime: InteractiveProjectRuntime, preparation: IsolatedProjectPreparation): string {
  if (runtime.source === 'project-local') {
    const relative = path.relative(preparation.sourceProject, runtime.executable);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      const copied = path.join(preparation.temporaryProject, relative);
      if (fs.existsSync(copied)) return copied;
    }
  }
  if (runtime.launchStyle === 'embedded') {
    throw new Error('The project-local embedded runtime was not copied into the isolated preview project.');
  }
  return runtime.executable;
}

export function createMapPreviewProfileDirectory(temporaryProject: string): string {
  const root = fs.realpathSync.native(path.resolve(temporaryProject));
  const profile = fs.mkdtempSync(path.join(root, '.rpg-agent-preview-profile-'));
  if (!isInside(root, profile)) throw new Error('Map preview profile directory escaped the isolated project.');
  return profile;
}

export function describeMapPreviewStartupTimeout(stage: string): {
  message: string;
  failureCode?: MapPreviewFailureCode;
} {
  return {
    message: `Map preview runtime startup timed out during ${stage}.`,
    ...(stage === 'runtime-process-started' ? { failureCode: 'runtime-handshake-timeout' as const } : {}),
  };
}

export function buildMapPreviewLaunchCommand(
  runtime: InteractiveProjectRuntime,
  preparation: IsolatedProjectPreparation,
  profileDirectory: string,
): { executable: string; args: string[] } {
  const temporaryProject = fs.realpathSync.native(path.resolve(preparation.temporaryProject));
  const profile = fs.realpathSync.native(path.resolve(profileDirectory));
  if (!isInside(temporaryProject, profile)) {
    throw new Error('Map preview profile directory must be inside the isolated project.');
  }
  const profileArgument = `--user-data-dir=${profile}`;
  const args = runtime.launchStyle === 'external'
    ? runtime.engine === 'rpg-maker-mv'
      ? [profileArgument, temporaryProject, 'test']
      : [profileArgument, temporaryProject]
    : [profileArgument];
  return { executable: previewExecutable(runtime, preparation), args };
}

function encodePacket(type: number, payload: Buffer): Buffer {
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function parseJson(payload: Buffer): Record<string, any> {
  const value = JSON.parse(payload.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Map preview packet must contain an object.');
  return value as Record<string, any>;
}

export function mapPreviewRuntimeFailureDetail(
  value: Record<string, unknown>,
  preparation: IsolatedProjectPreparation | null,
): MapPreviewFailureDetail {
  return normalizeMapPreviewFailureDetail({
    stage: String(value.stage || 'unknown'),
    operationId: Number(value.operationId) || undefined,
    sourceMapId: Number(value.sourceMapId) || undefined,
    targetMapId: Number(value.targetMapId) || undefined,
    scene: value.scene == null ? null : String(value.scene),
    ...(typeof value.transferring === 'boolean' ? { transferring: value.transferring } : {}),
    ...(typeof value.resourcesReady === 'boolean' ? { resourcesReady: value.resourcesReady } : {}),
    resources: Array.isArray(value.resources) ? value.resources.map(String) : [],
    message: String(value.message || 'Unknown runtime error'),
  }, preparation);
}

function frameMeta(value: Record<string, unknown>): PreviewFrameMeta {
  const kind = value.kind;
  if (kind !== 'full' && kind !== 'overview' && kind !== 'tile') {
    throw new Error('Map preview frame kind is invalid.');
  }
  return {
    operationId: positiveInteger(value.operationId, 'frame operation id'),
    mapId: positiveInteger(value.mapId, 'frame map id'),
    sequence: positiveInteger(value.sequence, 'frame sequence'),
    generation: positiveInteger(value.generation, 'frame generation'),
    kind,
    mapPixelWidth: positiveInteger(value.mapPixelWidth, 'frame map width'),
    mapPixelHeight: positiveInteger(value.mapPixelHeight, 'frame map height'),
    x: nonNegativeFinite(value.x, 'frame x'),
    y: nonNegativeFinite(value.y, 'frame y'),
    width: positiveInteger(value.width, 'frame width'),
    height: positiveInteger(value.height, 'frame height'),
    outputWidth: positiveInteger(value.outputWidth, 'frame output width'),
    outputHeight: positiveInteger(value.outputHeight, 'frame output height'),
    mapRevision: revisionString(value.mapRevision, 'frame map revision'),
  };
}

function normalizedOverrides(value?: MapPreviewOverrides): MapPreviewOverrides {
  const switches: Record<string, boolean> = {};
  const variables: Record<string, MapPreviewVariableValue> = {};
  const selfSwitches: Record<string, boolean> = {};
  for (const [rawId, rawValue] of Object.entries(value?.switches || {})) {
    const id = positiveInteger(rawId, 'switch id');
    if (typeof rawValue !== 'boolean') throw new Error(`Switch override ${id} must be boolean.`);
    switches[String(id)] = rawValue;
  }
  for (const [rawId, rawValue] of Object.entries(value?.variables || {})) {
    const id = positiveInteger(rawId, 'variable id');
    if (!isMapPreviewVariableValue(rawValue)) throw new Error(`Variable override ${id} must be a finite number or string.`);
    variables[String(id)] = rawValue;
  }
  for (const [key, rawValue] of Object.entries(value?.selfSwitches || {})) {
    if (!parseMapPreviewSelfSwitchKey(key) || typeof rawValue !== 'boolean') throw new Error(`Self switch override ${key} is invalid.`);
    selfSwitches[key] = rawValue;
  }
  return { switches, variables, selfSwitches };
}

function normalizedView(value: MapPreviewViewRequest): MapPreviewViewRequest {
  return {
    x: nonNegativeFinite(value.x, 'view x'),
    y: nonNegativeFinite(value.y, 'view y'),
    width: positiveFinite(value.width, 'view width'),
    height: positiveFinite(value.height, 'view height'),
    scale: positiveFinite(value.scale, 'view scale'),
  };
}

export interface WarmProjectChanges {
  sourceSnapshot: ProjectFileSnapshot;
  stagingSnapshot: IsolatedStagingSnapshot;
  changedMapIds: Set<number>;
  mapInfosChanged: boolean;
  unsafePaths: string[];
}

export function inspectWarmProjectChanges(
  workflowRoot: string,
  project: string,
  previousSource: ProjectFileSnapshot | null,
  previousStaging: IsolatedStagingSnapshot | null,
): WarmProjectChanges {
  const sourceSnapshot = captureProjectSnapshot(project, previousSource || undefined);
  const stagingSnapshot = snapshotProjectStaging(workflowRoot, project);
  const changedPaths = changedSnapshotPaths(previousSource, sourceSnapshot);
  for (const relative of changedStagingPaths(previousStaging, stagingSnapshot)) changedPaths.add(relative);
  const classification = classifyWarmPreviewPaths(project, changedPaths);
  return { sourceSnapshot, stagingSnapshot, ...classification };
}

export function classifyWarmPreviewPaths(
  project: string,
  changedPaths: Iterable<string>,
): Pick<WarmProjectChanges, 'changedMapIds' | 'mapInfosChanged' | 'unsafePaths'> {
  const dataRelative = normalizeRelativePath(path.relative(project, resolveDataDir(project)));
  const mapPattern = new RegExp(`^${escapeRegExp(dataRelative)}/Map(\\d+)\\.json$`, 'i');
  const mapInfosPath = `${dataRelative}/MapInfos.json`.toLowerCase();
  const changedMapIds = new Set<number>();
  const unsafePaths: string[] = [];
  let mapInfosChanged = false;
  for (const relative of changedPaths) {
    const normalized = normalizeRelativePath(relative);
    const match = normalized.match(mapPattern);
    if (match) {
      changedMapIds.add(Number(match[1]));
    } else if (normalized.toLowerCase() === mapInfosPath) {
      mapInfosChanged = true;
    } else {
      unsafePaths.push(normalized);
    }
  }
  return { changedMapIds, mapInfosChanged, unsafePaths };
}

function captureProjectSnapshot(project: string, previous?: ProjectFileSnapshot): ProjectFileSnapshot {
  const root = fs.realpathSync.native(path.resolve(project));
  const snapshot: ProjectFileSnapshot = new Map();
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelativePath(path.relative(root, absolute));
      if (excludedWarmSnapshotPath(relative)) continue;
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      const stat = fs.lstatSync(absolute);
      const prior = previous?.get(relative);
      if (prior && prior.size === stat.size && prior.mtimeMs === stat.mtimeMs) {
        snapshot.set(relative, prior);
        continue;
      }
      const body = entry.isSymbolicLink() ? Buffer.from(fs.readlinkSync(absolute), 'utf8') : fs.readFileSync(absolute);
      snapshot.set(relative, { size: stat.size, mtimeMs: stat.mtimeMs, hash: sha256(body) });
    }
  };
  visit(root);
  return snapshot;
}

function changedSnapshotPaths(previous: ProjectFileSnapshot | null, current: ProjectFileSnapshot): Set<string> {
  if (!previous) return new Set();
  const changed = new Set<string>();
  for (const [relative, entry] of current) {
    if (previous.get(relative)?.hash !== entry.hash) changed.add(relative);
  }
  for (const relative of previous.keys()) {
    if (!current.has(relative)) changed.add(relative);
  }
  return changed;
}

function changedStagingPaths(previous: IsolatedStagingSnapshot | null, current: IsolatedStagingSnapshot): Set<string> {
  if (!previous) return new Set(current.files.map((entry) => entry.relativePath));
  const serialize = (snapshot: IsolatedStagingSnapshot) => new Map(snapshot.files.map((entry) => [
    normalizeRelativePath(entry.relativePath),
    `${entry.delete ? 'delete' : 'write'}:${entry.draftHash || ''}`,
  ]));
  const before = serialize(previous);
  const after = serialize(current);
  const changed = new Set<string>();
  for (const [relative, value] of after) if (before.get(relative) !== value) changed.add(relative);
  for (const relative of before.keys()) if (!after.has(relative)) changed.add(relative);
  return changed;
}

export function syncEffectiveMap(workflowRoot: string, sourceProject: string, temporaryProject: string, mapId: number): void {
  const source = getMapFileForRead(workflowRoot, sourceProject, mapId);
  if (!source || !fs.existsSync(source)) throw new Error(`Map${String(mapId).padStart(3, '0')}.json no longer exists.`);
  const target = path.join(resolveDataDir(temporaryProject), `Map${String(mapId).padStart(3, '0')}.json`);
  atomicCopyJson(source, target, temporaryProject);
}

export function syncEffectiveMapInfos(workflowRoot: string, sourceProject: string, temporaryProject: string): void {
  const relative = normalizeRelativePath(path.relative(sourceProject, path.join(resolveDataDir(sourceProject), 'MapInfos.json')));
  const source = getProjectFileForRead(workflowRoot, sourceProject, relative)
    || path.join(sourceProject, relative.split('/').join(path.sep));
  if (!fs.existsSync(source)) throw new Error('MapInfos.json no longer exists.');
  atomicCopyJson(source, path.join(resolveDataDir(temporaryProject), 'MapInfos.json'), temporaryProject);
}

function atomicCopyJson(source: string, target: string, temporaryProject: string): void {
  const root = fs.realpathSync.native(path.resolve(temporaryProject));
  const resolvedTarget = path.resolve(target);
  if (!isInside(root, resolvedTarget)) throw new Error('Map preview incremental target escaped the isolated project.');
  const body = fs.readFileSync(source);
  JSON.parse(body.toString('utf8'));
  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
  const temporary = `${resolvedTarget}.rpg-agent-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, body, { flag: 'wx' });
    fs.renameSync(temporary, resolvedTarget);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function effectiveMapRevision(workflowRoot: string, project: string, mapId: number): string {
  const file = getMapFileForRead(workflowRoot, project, mapId);
  if (!file || !fs.existsSync(file)) throw new Error(`Map${String(mapId).padStart(3, '0')}.json does not exist.`);
  return sha256(fs.readFileSync(file));
}

function excludedWarmSnapshotPath(relative: string): boolean {
  const lower = normalizeRelativePath(relative).toLowerCase();
  return lower === '.git' || lower.startsWith('.git/')
    || lower === 'save' || lower.startsWith('save/')
    || lower === 'www/save' || lower.startsWith('www/save/');
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function revisionString(value: unknown, label: string): string {
  const revision = String(value || '');
  if (!/^[a-f0-9]{64}$/i.test(revision)) throw new Error(`${label} must be a SHA-256 digest.`);
  return revision.toLowerCase();
}

export function previewMapGeometry(project: string, mapId: number, tileSizeInput: number): PreviewMapGeometry {
  const tileSize = positiveInteger(tileSizeInput, 'tile size');
  const file = path.join(resolveDataDir(project), `Map${String(mapId).padStart(3, '0')}.json`);
  const map = readJson(file) as Record<string, unknown>;
  const widthTiles = positiveInteger(map.width, 'map width');
  const heightTiles = positiveInteger(map.height, 'map height');
  return {
    mapId,
    widthTiles,
    heightTiles,
    tileSize,
    pixelWidth: widthTiles * tileSize,
    pixelHeight: heightTiles * tileSize,
  };
}

function nonNegativeFinite(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return number;
}

function positiveFinite(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive finite number.`);
  return number;
}

interface ProcessStopResult {
  exited: boolean;
  error: string;
}

async function stopProcessTree(child: PreviewChild | null): Promise<ProcessStopResult> {
  if (!child || !child.pid) return { exited: true, error: '' };
  const closed = waitForChildClose(child, 2_000);
  const stopped = stopProcessTreeSync(child, false);
  const exited = await closed;
  return {
    exited,
    error: [stopped.error, exited ? '' : 'Map preview process tree did not exit after termination.'].filter(Boolean).join(' '),
  };
}

function stopProcessTreeSync(child: PreviewChild | null, waitForExit = true): ProcessStopResult {
  if (!child || !child.pid || child.exitCode != null) return { exited: true, error: '' };
  if (process.platform === 'win32') {
    const result = childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const error = result.status === 0 || result.status === 128
      ? ''
      : result.error?.message || `Map preview process cleanup failed with status ${result.status ?? 'unknown'}.`;
    const exited = child.exitCode != null
      || !isProcessAlive(child.pid)
      || (waitForExit && waitForProcessExitSync(child.pid, 2_000));
    return { exited, error };
  }
  try {
    child.kill('SIGKILL');
    const exited = child.exitCode != null
      || !isProcessAlive(child.pid)
      || (waitForExit && waitForProcessExitSync(child.pid, 2_000));
    return { exited, error: '' };
  } catch (error) {
    return { exited: false, error: errorMessage(error) };
  }
}

function waitForChildClose(child: PreviewChild, timeoutMs: number): Promise<boolean> {
  if (!child.pid || (child.exitCode != null && child.stdout.destroyed && child.stderr.destroyed)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(value);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(
      !child.pid || (!isProcessAlive(child.pid) && child.stdout.destroyed && child.stderr.destroyed),
    ), timeoutMs);
    child.once('close', onClose);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForProcessExitSync(pid: number, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  const delay = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    Atomics.wait(delay, 0, 0, 25);
  }
  return !isProcessAlive(pid);
}

export function normalizeMapPreviewFailureDetail(
  detail: MapPreviewFailureDetail,
  preparation: IsolatedProjectPreparation | null,
): MapPreviewFailureDetail {
  const resources = [...new Set((detail.resources || [])
    .map((resource) => sanitizeMapPreviewResource(resource, preparation))
    .filter(Boolean))]
    .slice(0, MAX_FAILED_RESOURCES);
  const operationId = positiveOptionalInteger(detail.operationId);
  const sourceMapId = positiveOptionalInteger(detail.sourceMapId);
  const targetMapId = positiveOptionalInteger(detail.targetMapId);
  const stagingConflicts = normalizeMapPreviewStagingConflictFiles(detail.stagingConflicts || []);
  return {
    stage: boundedText(detail.stage || 'unknown', 128),
    ...(operationId ? { operationId } : {}),
    ...(sourceMapId ? { sourceMapId } : {}),
    ...(targetMapId ? { targetMapId } : {}),
    ...(detail.scene === null ? { scene: null } : detail.scene ? { scene: boundedText(detail.scene, 128) } : {}),
    ...(typeof detail.transferring === 'boolean' ? { transferring: detail.transferring } : {}),
    ...(typeof detail.resourcesReady === 'boolean' ? { resourcesReady: detail.resourcesReady } : {}),
    ...(resources.length ? { resources } : {}),
    ...(stagingConflicts.length ? { stagingConflicts } : {}),
    message: sanitizeMapPreviewDiagnosticText(detail.message || 'Map preview failed.', preparation),
    ...(detail.runtimeOutput ? {
      runtimeOutput: sanitizeMapPreviewDiagnosticText(
        detail.runtimeOutput.slice(-MAX_RUNTIME_OUTPUT_LENGTH),
        preparation,
      ),
    } : {}),
  };
}

export function sanitizeMapPreviewDiagnosticText(
  message: string,
  preparation: IsolatedProjectPreparation | null,
): string {
  let sanitized = String(message || 'Map preview failed.').slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
  const roots = [preparation?.sourceProject, preparation?.temporaryProject]
    .filter(Boolean)
    .flatMap((root) => previewPathVariants(root as string))
    .sort((left, right) => right.length - left.length);
  for (const root of roots) {
    sanitized = sanitized.replace(new RegExp(`${escapeRegExp(root)}(?=$|[\\\\/])`, 'gi'), '[project]');
  }
  sanitized = sanitized
    .replace(/\[project\][\\/]\.rpg-agent-preview-profile-[^\\/\s:)]*/gi, '[preview-profile]')
    .replace(/\[project\][\\/](?:www[\\/])?/gi, '')
    .replace(/file:\/\/\/[a-z]:\/[^\s"'<>]+/gi, '[external-path]')
    .replace(/(["'])[a-z]:[\\/][^"'\r\n<>]+\1/gi, '$1[external-path]$1')
    .replace(/(?:\\\\|\/\/)[^\\/\s"'<>]+[\\/][^\s"'<> ,;)\]}]+/g, '[external-path]')
    .replace(/[a-z]:[\\/][^\s"'<> ,;)\]}]+/gi, '[external-path]')
    .replace(/\/(?:Users|home|tmp|var|opt|usr|etc|mnt)\/[^\s"'<> ,;)\]}]+/g, '[external-path]')
    .replace(/\\/g, '/');
  return sanitized.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
}

function sanitizeMapPreviewResource(
  resource: string,
  preparation: IsolatedProjectPreparation | null,
): string {
  let value = decodeUriSafely(String(resource || '').trim()).replace(/\\/g, '/');
  if (!value) return '';
  value = sanitizeMapPreviewDiagnosticText(value, preparation)
    .replace(/^\[project\]\/?/i, '')
    .replace(/^\.\//, '')
    .replace(/^www\//i, '')
    .replace(/[?#].*$/, '');
  if (/^\.\.\//.test(value)) return '[external-path]';
  return boundedText(value, 512);
}

function previewPathVariants(root: string): string[] {
  const resolved = path.resolve(root);
  const fileUrl = pathToFileURL(resolved).href.replace(/\/$/, '');
  return [...new Set([
    resolved,
    resolved.replace(/\\/g, '/'),
    fileUrl,
    decodeUriSafely(fileUrl),
  ].map((value) => value.replace(/[\\/]$/, '')))];
}

function decodeUriSafely(value: string): string {
  try { return decodeURI(value); } catch { return value; }
}

function boundedText(value: string, maximum: number): string {
  return String(value || '').slice(0, maximum);
}

function positiveOptionalInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function redactPreviewError(message: string, preparation: IsolatedProjectPreparation | null): string {
  return sanitizeMapPreviewDiagnosticText(message, preparation);
}

function isLoopback(address?: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => Number.isInteger(Number(key)) && Number(key) > 0)
    .map(([key, entry]) => [key, Boolean(entry)]));
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, entry]) => Number.isInteger(Number(key)) && Number(key) > 0 && Number.isFinite(Number(entry)))
    .map(([key, entry]) => [key, Number(entry)]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
