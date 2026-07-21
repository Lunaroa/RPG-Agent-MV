import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  MapPreviewDevToolsResult,
  MapPreviewFailureCode,
  MapPreviewFailureDetail,
  MapPreviewOverrides,
  MapPreviewResult,
  MapPreviewResumeRequest,
  MapPreviewRuntimeCommand,
  MapPreviewRuntimeEvent,
  MapPreviewSession,
  MapPreviewViewRequest,
} from '../../../../contract/types.ts';
import { inspectRmmvProject } from '../rmmv/rmmv-layout.ts';
import {
  cleanupIsolatedProject,
  type IsolatedProjectPreparation,
  type IsolatedStagingSnapshot,
  verifyIsolatedSourceState,
} from './isolated-project-preparation.ts';
import {
  MapPreviewPreparationCancelledError,
  MapPreviewPreparationFailedError,
  startMapPreviewPreparation,
  type MapPreviewPreparationTask,
} from './map-preview-preparation.ts';
import { injectMapPreviewIframeHarness } from './map-preview-iframe-harness.ts';
import {
  assertNoStagingConflicts,
  effectiveMapRevision,
  inspectWarmProjectChanges,
  mapPreviewLoadPurpose,
  mapPreviewRequiresReload,
  normalizeMapPreviewFailureDetail,
  previewMapGeometry,
  sanitizeMapPreviewDiagnosticText,
  syncEffectiveMap,
  syncEffectiveMapInfos,
  type ProjectFileSnapshot,
} from './map-preview-service.ts';

const RUNTIME_TIMEOUT_MS = 20_000;

export interface MapPreviewIframeServiceDependencies {
  isPlaytestActive?(): boolean;
  onStatus?(session: MapPreviewSession): void;
  onCommand?(command: MapPreviewRuntimeCommand): void;
  registerPreviewRoot(key: string, resourceRoot: string): string;
  unregisterPreviewRoot(key: string): void;
  verifyFrameIsolation(url: string): boolean;
}

export class MapPreviewIframeService {
  readonly #workflowRoot: string;
  readonly #dependencies: MapPreviewIframeServiceDependencies;
  #session: MapPreviewSession | null = null;
  #preparation: IsolatedProjectPreparation | null = null;
  #preparationTask: MapPreviewPreparationTask | null = null;
  #preparationGeneration = 0;
  #sourceSnapshot: ProjectFileSnapshot | null = null;
  #stagingSnapshot: IsolatedStagingSnapshot | null = null;
  #pendingMapSyncIds = new Set<number>();
  #protocolKey = '';
  #channelToken = '';
  #runtimeTimer: ReturnType<typeof setTimeout> | null = null;
  #nextOperationId = 0;
  #activeOperationId = 0;
  #desiredRunning = true;
  #pendingResume: MapPreviewResumeRequest | null = null;
  #resumePromise: Promise<MapPreviewResult> | null = null;
  #cleanupInProgress = false;

  constructor(workflowRoot: string, dependencies: MapPreviewIframeServiceDependencies) {
    this.#workflowRoot = path.resolve(workflowRoot);
    this.#dependencies = dependencies;
  }

  current(): MapPreviewResult {
    return this.#session ? { session: { ...this.#session } } : {};
  }

  isActive(): boolean {
    return Boolean(this.#session && !['stopped', 'failed'].includes(this.#session.status));
  }

  async start(projectInput: string, mapIdInput: number, overridesInput?: MapPreviewOverrides): Promise<MapPreviewResult> {
    if (this.isActive()) throw new Error('A map preview is already running.');
    if (this.#dependencies.isPlaytestActive?.()) throw new Error('Stop the current game runtime before starting map preview.');
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
    const now = new Date().toISOString();
    this.#nextOperationId = 1;
    this.#activeOperationId = 1;
    this.#desiredRunning = true;
    this.#session = {
      sessionId: crypto.randomUUID(),
      operationId: 1,
      status: 'preparing',
      engine: manifest.engine,
      mapId,
      mapRevision,
      viewportWidth: manifest.screenWidth,
      viewportHeight: manifest.screenHeight,
      transportMode: 'iframe',
      startedAt: now,
      updatedAt: now,
    };
    this.#publish();
    const generation = ++this.#preparationGeneration;
    try {
      const task = startMapPreviewPreparation(this.#workflowRoot, project);
      this.#preparationTask = task;
      const prepared = await task.result;
      if (this.#preparationTask === task) this.#preparationTask = null;
      if (!this.#startIsCurrent(generation)) {
        cleanupIsolatedProject(prepared);
        return this.current();
      }
      this.#preparation = prepared;
      this.#sourceSnapshot = new Map(prepared.sourceSnapshot.map((entry) => [entry.relativePath, {
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        hash: entry.hash,
      }]));
      this.#stagingSnapshot = prepared.staging;
      const copied = inspectRmmvProject(prepared.temporaryProject);
      const geometry = previewMapGeometry(prepared.temporaryProject, mapId, copied.tileSize);
      this.#channelToken = crypto.randomBytes(32).toString('hex');
      this.#protocolKey = crypto.randomBytes(32).toString('hex');
      injectMapPreviewIframeHarness(copied.resourceRoot, {
        sessionId: this.#session.sessionId,
        channelToken: this.#channelToken,
        mapId,
        mapRevision,
        operationId: this.#activeOperationId,
        viewportWidth: copied.screenWidth,
        viewportHeight: copied.screenHeight,
        geometry,
        overrides,
      });
      const iframeUrl = this.#dependencies.registerPreviewRoot(this.#protocolKey, copied.resourceRoot);
      this.#update({
        status: 'starting',
        iframeUrl,
        mapPixelWidth: geometry.pixelWidth,
        mapPixelHeight: geometry.pixelHeight,
        renderMode: 'full',
        actualFps: undefined,
      });
      this.#armRuntimeTimeout('iframe-runtime-startup');
      return this.current();
    } catch (error) {
      if (error instanceof MapPreviewPreparationCancelledError || !this.#startIsCurrent(generation)) return this.current();
      await this.#fail(errorMessage(error), error instanceof MapPreviewPreparationFailedError ? 'isolation-preparation-failed' : 'map-render-failed', {
        stage: error instanceof MapPreviewPreparationFailedError ? error.stage : 'iframe-runtime-preparation',
        operationId: this.#activeOperationId,
        targetMapId: mapId,
        message: errorMessage(error),
      });
      return this.current();
    }
  }

  handleRuntimeEvent(eventInput: MapPreviewRuntimeEvent): MapPreviewResult {
    if (!this.#session || !this.#preparation || !this.isActive()) return this.current();
    const event = runtimeEvent(eventInput);
    if (event.sessionId !== this.#session.sessionId || event.channelToken !== this.#channelToken) return this.current();
    if (event.operationId !== this.#activeOperationId) return this.current();
    if (event.phase === 'ready') {
      if (!this.#session.iframeUrl || !this.#dependencies.verifyFrameIsolation(this.#session.iframeUrl)) {
        void this.#fail('The embedded map runtime did not receive an isolated renderer process.', 'map-render-failed', {
          stage: 'iframe-process-isolation',
          operationId: event.operationId,
          targetMapId: event.mapId,
          message: 'The embedded map runtime did not receive an isolated renderer process.',
        });
        return this.current();
      }
      this.#clearRuntimeTimeout();
      this.#update({
        status: this.#desiredRunning ? 'running' : 'suspending',
        mapId: event.mapId,
        mapRevision: event.mapRevision,
        mapPixelWidth: positiveInteger(event.mapPixelWidth, 'runtime map pixel width'),
        mapPixelHeight: positiveInteger(event.mapPixelHeight, 'runtime map pixel height'),
        switchValues: booleanRecord(event.switchValues),
        variableValues: numberRecord(event.variableValues),
      });
      if (!this.#desiredRunning) this.#sendCommand({ type: 'suspend', operationId: this.#activeOperationId });
    } else if (event.phase === 'loading-map') {
      this.#update({ status: this.#session.status === 'resuming' ? 'resuming' : 'starting', actualFps: undefined });
    } else if (event.phase === 'suspended') {
      this.#clearRuntimeTimeout();
      this.#update({ status: 'suspended', actualFps: undefined });
      if (this.#desiredRunning && this.#pendingResume) void this.#resumeSuspended();
    } else if (event.phase === 'state') {
      this.#update({ switchValues: booleanRecord(event.switchValues), variableValues: numberRecord(event.variableValues) });
    } else if (event.phase === 'fps') {
      const fps = Number(event.fps);
      if (this.#session.status === 'running' && Number.isFinite(fps)) this.#update({ actualFps: Math.max(0, Math.min(60, Math.round(fps))) });
    } else if (event.phase === 'error') {
      const detail: MapPreviewFailureDetail = {
        stage: String(event.stage || 'iframe-runtime'),
        operationId: event.operationId,
        sourceMapId: optionalPositiveInteger(event.sourceMapId),
        targetMapId: optionalPositiveInteger(event.targetMapId) || event.mapId,
        scene: typeof event.scene === 'string' ? event.scene : null,
        transferring: typeof event.transferring === 'boolean' ? event.transferring : undefined,
        resourcesReady: typeof event.resourcesReady === 'boolean' ? event.resourcesReady : undefined,
        resources: Array.isArray(event.resources) ? event.resources.map(String) : [],
        message: String(event.message || 'The embedded map runtime failed.'),
      };
      void this.#fail(detail.message, failureCode(event.failureCode), detail);
    }
    return this.current();
  }

  selectMap(mapId: number, overrides?: MapPreviewOverrides): MapPreviewResult {
    if (!this.#preparation) throw new Error('Map preview is not active.');
    void this.resume({ project: this.#preparation.sourceProject, mapId, overrides: normalizedOverrides(overrides) });
    return this.current();
  }

  async suspend(): Promise<MapPreviewResult> {
    if (!this.#session || !this.isActive()) return this.current();
    this.#desiredRunning = false;
    this.#pendingResume = null;
    if (this.#session.status === 'preparing') {
      await this.stop();
      return this.current();
    }
    if (this.#session.status === 'running') {
      this.#update({ status: 'suspending', actualFps: undefined });
      this.#sendCommand({ type: 'suspend', operationId: this.#activeOperationId });
      this.#armRuntimeTimeout('iframe-runtime-suspend');
    }
    return this.current();
  }

  async resume(requestInput: MapPreviewResumeRequest): Promise<MapPreviewResult> {
    const project = fs.realpathSync.native(path.resolve(requestInput.project));
    const request: MapPreviewResumeRequest = {
      project,
      mapId: positiveInteger(requestInput.mapId, 'mapId'),
      overrides: normalizedOverrides(requestInput.overrides),
      ...(requestInput.mapRevision ? { mapRevision: requestInput.mapRevision } : {}),
      ...(requestInput.forceReload === true ? { forceReload: true } : {}),
    };
    if (!this.#session || !this.isActive() || !this.#preparation) return this.start(project, request.mapId, request.overrides);
    if (fs.realpathSync.native(this.#preparation.sourceProject) !== project) {
      await this.stop();
      const result = await this.start(project, request.mapId, request.overrides);
      if (result.session) this.#update({ resumeKind: 'reisolated' });
      return this.current();
    }
    this.#desiredRunning = true;
    this.#pendingResume = request;
    if (this.#session.status === 'running') {
      this.#update({ status: 'suspending', actualFps: undefined });
      this.#sendCommand({ type: 'suspend', operationId: this.#activeOperationId });
      this.#armRuntimeTimeout('iframe-runtime-suspend');
      return this.current();
    }
    if (this.#session.status === 'suspended') return this.#resumeSuspended();
    return this.current();
  }

  setSwitch(idInput: number, value: boolean): MapPreviewResult {
    this.#requireRuntime();
    this.#sendCommand({ type: 'set-switch', operationId: this.#activeOperationId, id: positiveInteger(idInput, 'switch id'), value: Boolean(value) });
    return this.current();
  }

  setVariable(idInput: number, valueInput: number): MapPreviewResult {
    this.#requireRuntime();
    const value = Number(valueInput);
    if (!Number.isFinite(value)) throw new Error('Variable value must be finite.');
    this.#sendCommand({ type: 'set-variable', operationId: this.#activeOperationId, id: positiveInteger(idInput, 'variable id'), value });
    return this.current();
  }

  resetOverrides(): MapPreviewResult {
    this.#requireRuntime();
    this.#sendCommand({ type: 'reset-overrides', operationId: this.#activeOperationId });
    return this.current();
  }

  replaceOverrides(overrides?: MapPreviewOverrides): MapPreviewResult {
    this.#requireRuntime();
    this.#sendCommand({ type: 'replace-overrides', operationId: this.#activeOperationId, overrides: normalizedOverrides(overrides) });
    return this.current();
  }

  panCamera(_deltaX: number, _deltaY: number): MapPreviewResult { return this.current(); }
  ackFrame(_sequence: number): MapPreviewResult { return this.current(); }
  setView(_request: MapPreviewViewRequest): MapPreviewResult { return this.current(); }
  toggleDevTools(): Promise<MapPreviewDevToolsResult> {
    return Promise.resolve({ code: 'preview-devtools-unsupported', error: 'Use the editor developer tools and select the embedded preview frame.' });
  }

  async stop(): Promise<MapPreviewResult> {
    if (!this.#session) return {};
    if (!this.isActive()) return this.current();
    this.#desiredRunning = false;
    this.#pendingResume = null;
    this.#update({ status: 'stopping', actualFps: undefined });
    this.#cleanupInProgress = true;
    const cleanupError = await this.#cleanup();
    this.#finish(cleanupError ? 'failed' : 'stopped', cleanupError || undefined);
    this.#cleanupInProgress = false;
    return this.current();
  }

  shutdown(): Promise<MapPreviewResult> { return this.stop(); }
  shutdownSync(): void {
    if (!this.#session || !this.isActive()) return;
    this.#cleanupInProgress = true;
    const error = this.#cleanupSync();
    this.#finish(error ? 'failed' : 'stopped', error || undefined);
    this.#cleanupInProgress = false;
  }

  async #resumeSuspended(): Promise<MapPreviewResult> {
    if (this.#resumePromise) return this.#resumePromise;
    this.#resumePromise = this.#resumeSuspendedInternal().finally(() => { this.#resumePromise = null; });
    return this.#resumePromise;
  }

  async #resumeSuspendedInternal(): Promise<MapPreviewResult> {
    if (!this.#session || this.#session.status !== 'suspended' || !this.#preparation || !this.#pendingResume) return this.current();
    const request = this.#pendingResume;
    assertNoStagingConflicts(this.#workflowRoot, request.project);
    const changes = inspectWarmProjectChanges(this.#workflowRoot, request.project, this.#sourceSnapshot, this.#stagingSnapshot);
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
    const reload = mapPreviewRequiresReload(
      this.#session.mapId,
      this.#session.mapRevision,
      request.mapId,
      revision,
      this.#pendingMapSyncIds.has(request.mapId),
      request.forceReload,
    );
    const purpose = mapPreviewLoadPurpose(this.#session.mapId, request.mapId, reload);
    const manifest = inspectRmmvProject(this.#preparation.temporaryProject);
    let geometry = previewMapGeometry(this.#preparation.temporaryProject, this.#session.mapId, manifest.tileSize);
    if (reload) {
      syncEffectiveMap(this.#workflowRoot, request.project, this.#preparation.temporaryProject, request.mapId);
      this.#pendingMapSyncIds.delete(request.mapId);
      geometry = previewMapGeometry(this.#preparation.temporaryProject, request.mapId, manifest.tileSize);
    }
    const operationId = ++this.#nextOperationId;
    this.#activeOperationId = operationId;
    this.#pendingResume = null;
    this.#update({
      operationId,
      status: 'resuming',
      mapId: request.mapId,
      mapRevision: revision,
      mapPixelWidth: geometry.pixelWidth,
      mapPixelHeight: geometry.pixelHeight,
      actualFps: undefined,
      resumeKind: reload ? 'map-sync' : 'warm',
    });
    this.#sendCommand({
      type: 'resume',
      operationId,
      purpose: purpose || 'warm',
      mapId: request.mapId,
      mapRevision: revision,
      geometry,
      overrides: request.overrides,
    });
    this.#armRuntimeTimeout('iframe-runtime-resume');
    return this.current();
  }

  #sendCommand(command: Record<string, unknown>): void {
    if (!this.#session || !this.#channelToken) throw new Error('Map preview iframe is not available.');
    this.#dependencies.onCommand?.({
      kind: 'rpg-agent-map-preview-command',
      sessionId: this.#session.sessionId,
      channelToken: this.#channelToken,
      command,
    });
  }

  #requireRuntime(): void {
    if (!this.#session || !['running', 'suspended'].includes(this.#session.status) || !this.#preparation) {
      throw new Error('Map preview is not available.');
    }
  }

  async #fail(message: string, code?: MapPreviewFailureCode, detail?: MapPreviewFailureDetail): Promise<void> {
    if (!this.#session || this.#session.status === 'failed' || this.#cleanupInProgress) return;
    this.#cleanupInProgress = true;
    const preparation = this.#preparation;
    const normalized = normalizeMapPreviewFailureDetail({
      stage: detail?.stage || 'iframe-runtime',
      operationId: detail?.operationId ?? this.#activeOperationId,
      targetMapId: detail?.targetMapId ?? this.#session.mapId,
      ...detail,
      message: detail?.message || message,
    }, preparation);
    const cleanupError = await this.#cleanup();
    this.#finish('failed', sanitizeMapPreviewDiagnosticText([message, cleanupError].filter(Boolean).join(' '), preparation), code, normalized);
    this.#cleanupInProgress = false;
  }

  async #cleanup(): Promise<string> {
    this.#clearRuntimeTimeout();
    await this.#cancelPreparation();
    return this.#cleanupIsolation();
  }

  #cleanupSync(): string {
    this.#clearRuntimeTimeout();
    this.#cancelPreparationSync();
    return this.#cleanupIsolation();
  }

  #cleanupIsolation(): string {
    if (this.#protocolKey) this.#dependencies.unregisterPreviewRoot(this.#protocolKey);
    this.#protocolKey = '';
    this.#channelToken = '';
    let error = '';
    if (this.#preparation) {
      const preparation = this.#preparation;
      const evidence = verifyIsolatedSourceState(this.#workflowRoot, preparation);
      if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
        console.warn('[map-preview] Source or staging changed while the isolated iframe preview was warm.');
      }
      try { cleanupIsolatedProject(preparation); }
      catch (cleanupError) { error = `Preview temporary project cleanup failed: ${errorMessage(cleanupError)}`; }
    }
    this.#preparation = null;
    this.#sourceSnapshot = null;
    this.#stagingSnapshot = null;
    this.#pendingMapSyncIds.clear();
    this.#pendingResume = null;
    this.#activeOperationId = 0;
    this.#nextOperationId = 0;
    return error;
  }

  #armRuntimeTimeout(stage: string): void {
    this.#clearRuntimeTimeout();
    this.#runtimeTimer = setTimeout(() => {
      void this.#fail('The embedded map runtime did not become ready in time.', 'map-render-failed', {
        stage,
        operationId: this.#activeOperationId,
        targetMapId: this.#session?.mapId,
        message: 'The embedded map runtime did not become ready in time.',
      });
    }, RUNTIME_TIMEOUT_MS);
  }

  #clearRuntimeTimeout(): void {
    if (this.#runtimeTimer) clearTimeout(this.#runtimeTimer);
    this.#runtimeTimer = null;
  }

  #update(patch: Partial<MapPreviewSession>): void {
    if (!this.#session) return;
    this.#session = { ...this.#session, ...patch, updatedAt: new Date().toISOString() };
    this.#publish();
  }

  #finish(status: 'stopped' | 'failed', error?: string, failureCode?: MapPreviewFailureCode, failureDetail?: MapPreviewFailureDetail): void {
    if (!this.#session) return;
    this.#session = {
      ...this.#session,
      status,
      actualFps: undefined,
      updatedAt: new Date().toISOString(),
      ...(failureCode ? { failureCode } : {}),
      ...(failureDetail ? { failureDetail } : {}),
      ...(error ? { error } : {}),
    };
    this.#publish();
  }

  #publish(): void { if (this.#session) this.#dependencies.onStatus?.({ ...this.#session }); }
  #startIsCurrent(generation: number): boolean {
    return generation === this.#preparationGeneration && Boolean(this.#session) && !['stopping', 'stopped', 'failed'].includes(this.#session!.status);
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
}

function runtimeEvent(value: MapPreviewRuntimeEvent): MapPreviewRuntimeEvent {
  if (!value || value.kind !== 'rpg-agent-map-preview') throw new Error('Invalid map preview runtime event.');
  if (!['ready', 'loading-map', 'suspended', 'state', 'fps', 'error'].includes(String(value.phase))) {
    throw new Error('Invalid map preview runtime event phase.');
  }
  return {
    ...value,
    sessionId: String(value.sessionId || ''),
    channelToken: String(value.channelToken || ''),
    operationId: positiveInteger(value.operationId, 'runtime operation id'),
    mapId: positiveInteger(value.mapId, 'runtime map id'),
    mapRevision: String(value.mapRevision || ''),
  };
}

function normalizedOverrides(value?: MapPreviewOverrides): MapPreviewOverrides {
  return { switches: booleanRecord(value?.switches), variables: numberRecord(value?.variables) };
}
function booleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [id, entry] of Object.entries(value)) if (/^[1-9]\d*$/.test(id) && typeof entry === 'boolean') out[id] = entry;
  return out;
}
function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(value)) if (/^[1-9]\d*$/.test(id) && Number.isFinite(Number(entry))) out[id] = Number(entry);
  return out;
}
function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}
function optionalPositiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
function failureCode(value: unknown): MapPreviewFailureCode {
  const code = String(value || '');
  const allowed: MapPreviewFailureCode[] = [
    'runtime-handshake-timeout',
    'runtime-resume-failed',
    'map-render-failed',
    'isolation-preparation-failed',
    'preview-debug-marker-conflict',
  ];
  return allowed.includes(code as MapPreviewFailureCode) ? code as MapPreviewFailureCode : 'map-render-failed';
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
