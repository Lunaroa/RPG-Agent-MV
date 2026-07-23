import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  MapPreviewDevToolsResult,
  MapPreviewFailureCode,
  MapPreviewFailureDetail,
  MapPreviewLoadProgress,
  MapPreviewLoadStage,
  MapPreviewOverrides,
  MapPreviewEventState,
  MapPreviewResult,
  MapPreviewResumeRequest,
  MapPreviewRuntimeCommand,
  MapPreviewRuntimeCommandPayload,
  MapPreviewRuntimeEvent,
  MapPreviewSelfSwitchLetter,
  MapPreviewSession,
  MapPreviewVariableValue,
  MapPreviewViewRequest,
} from '../../../../contract/types.ts';
import {
  isMapPreviewVariableValue,
  mapPreviewSelfSwitchKey,
  parseMapPreviewSelfSwitchKey,
} from '../../../../contract/map-preview-state.ts';
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
import { injectMapPreviewIframeHarness, writeMapPreviewIframeHarness } from './map-preview-iframe-harness.ts';
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

interface PreparedRuntimeTarget {
  revision: string;
  reload: boolean;
  geometry: ReturnType<typeof previewMapGeometry>;
  runtime: ReturnType<typeof inspectRmmvProject>;
}

export class MapPreviewIframeService {
  readonly #workflowRoot: string;
  readonly #dependencies: MapPreviewIframeServiceDependencies;
  #session: MapPreviewSession | null = null;
  #sourceProject = '';
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
  #activeLoadStartedAt = '';
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
    assertSelfSwitchMap(overrides, mapId);
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
    const taskId = crypto.randomUUID();
    this.#nextOperationId = 1;
    this.#activeOperationId = 1;
    this.#activeLoadStartedAt = now;
    this.#desiredRunning = true;
    this.#sourceProject = project;
    this.#pendingResume = null;
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
      eventExecutionEnabled: false,
      inputWait: { kind: 'none' },
      mapChangeSource: 'editor',
      loadProgress: loadProgress(taskId, 'isolation', 'starting-worker', now),
      startedAt: now,
      updatedAt: now,
    };
    this.#publish();
    const generation = ++this.#preparationGeneration;
    try {
      const task = startMapPreviewPreparation(this.#workflowRoot, project, {
        taskId,
        onProgress: (progress) => this.#handlePreparationProgress(generation, progress),
      });
      this.#preparationTask = task;
      void this.#completeStart(generation, task, mapId, mapRevision, overrides);
      return this.current();
    } catch (error) {
      await this.#failPreparation(error, mapId);
      return this.current();
    }
  }

  async #completeStart(
    generation: number,
    task: MapPreviewPreparationTask,
    mapId: number,
    mapRevision: string,
    overrides: MapPreviewOverrides,
  ): Promise<void> {
    try {
      const prepared = await task.result;
      if (this.#preparationTask === task) this.#preparationTask = null;
      if (!this.#startIsCurrent(generation)) {
        cleanupIsolatedProject(prepared);
        return;
      }
      this.#preparation = prepared;
      const pendingResume = this.#pendingResume;
      const targetMapId = pendingResume?.mapId ?? mapId;
      const targetMapRevision = pendingResume
        ? effectiveMapRevision(this.#workflowRoot, prepared.sourceProject, targetMapId)
        : mapRevision;
      const targetOverrides = pendingResume?.overrides ?? overrides;
      this.#pendingResume = null;
      const progressNow = new Date().toISOString();
      this.#update({
        mapId: targetMapId,
        mapRevision: targetMapRevision,
        loadProgress: loadProgress(
          task.taskId,
          'isolation',
          'preparing-runtime',
          progressNow,
          this.#session.loadProgress?.taskStartedAt || this.#session.startedAt,
        ),
      });
      this.#sourceSnapshot = new Map(prepared.sourceSnapshot.map((entry) => [entry.relativePath, {
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        hash: entry.hash,
      }]));
      this.#stagingSnapshot = prepared.staging;
      const copied = inspectRmmvProject(prepared.temporaryProject);
      const geometry = previewMapGeometry(prepared.temporaryProject, targetMapId, copied.tileSize);
      this.#channelToken = crypto.randomBytes(32).toString('hex');
      this.#protocolKey = crypto.randomBytes(32).toString('hex');
      injectMapPreviewIframeHarness(copied.resourceRoot, {
        sessionId: this.#session.sessionId,
        channelToken: this.#channelToken,
        mapId: targetMapId,
        mapRevision: targetMapRevision,
        operationId: this.#activeOperationId,
        viewportWidth: copied.screenWidth,
        viewportHeight: copied.screenHeight,
        tileSize: copied.tileSize,
        geometry,
        overrides: targetOverrides,
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
    } catch (error) {
      if (this.#preparationTask === task) this.#preparationTask = null;
      if (error instanceof MapPreviewPreparationCancelledError || !this.#startIsCurrent(generation)) return;
      await this.#failPreparation(error, this.#session?.mapId ?? mapId);
    }
  }

  #handlePreparationProgress(generation: number, progress: MapPreviewLoadProgress): void {
    if (!this.#startIsCurrent(generation) || this.#session?.status !== 'preparing') return;
    if (this.#session.loadProgress?.taskId !== progress.taskId) return;
    this.#update({ loadProgress: progress });
  }

  async #failPreparation(error: unknown, mapId: number): Promise<void> {
    await this.#fail(
      errorMessage(error),
      error instanceof MapPreviewPreparationFailedError ? 'isolation-preparation-failed' : 'map-render-failed',
      {
        stage: error instanceof MapPreviewPreparationFailedError ? error.stage : 'iframe-runtime-preparation',
        operationId: this.#activeOperationId,
        targetMapId: mapId,
        message: errorMessage(error),
        ...(error instanceof MapPreviewPreparationFailedError && error.runtimeOutput
          ? { runtimeOutput: error.runtimeOutput }
          : {}),
      },
    );
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
        status: this.#desiredRunning && !this.#pendingResume ? 'running' : 'suspending',
        mapId: event.mapId,
        mapRevision: event.mapRevision,
        mapPixelWidth: positiveInteger(event.mapPixelWidth, 'runtime map pixel width'),
        mapPixelHeight: positiveInteger(event.mapPixelHeight, 'runtime map pixel height'),
        switchValues: booleanRecord(event.switchValues),
        variableValues: variableRecord(event.variableValues),
        unsupportedVariableTypes: stringRecord(event.unsupportedVariableTypes),
        selfSwitchValues: selfSwitchRecord(event.selfSwitchValues),
        eventStates: eventStateArray(event.eventStates),
        eventExecutionEnabled: Boolean(event.eventExecutionEnabled),
        executionCheckpointMapId: optionalPositiveInteger(event.checkpointMapId),
        inputWait: { kind: 'none' },
        mapChangeSource: 'editor',
        loadProgress: undefined,
      });
      if (!this.#desiredRunning || this.#pendingResume) {
        this.#sendCommand({ type: 'suspend', operationId: this.#activeOperationId });
      }
    } else if (event.phase === 'loading-map') {
      this.#update({
        status: this.#session.status === 'resuming' ? 'resuming' : 'starting',
        actualFps: undefined,
      });
    } else if (event.phase === 'loading-progress') {
      this.#update({
        status: this.#session.status === 'resuming' ? 'resuming' : 'starting',
        actualFps: undefined,
        loadProgress: loadProgress(
          this.#runtimeLoadTaskId(),
          'runtime',
          runtimeLoadStage(event.stage),
          new Date().toISOString(),
          this.#activeLoadStartedAt,
        ),
      });
    } else if (event.phase === 'suspended') {
      this.#clearRuntimeTimeout();
      this.#update({ status: 'suspended', actualFps: undefined });
      if (this.#desiredRunning && this.#pendingResume) void this.#resumeSuspended();
    } else if (event.phase === 'state') {
      this.#update({
        switchValues: booleanRecord(event.switchValues),
        variableValues: variableRecord(event.variableValues),
        unsupportedVariableTypes: stringRecord(event.unsupportedVariableTypes),
        selfSwitchValues: selfSwitchRecord(event.selfSwitchValues),
        eventStates: eventStateArray(event.eventStates),
        ...(typeof event.eventExecutionEnabled === 'boolean' ? { eventExecutionEnabled: event.eventExecutionEnabled } : {}),
        ...(optionalPositiveInteger(event.checkpointMapId)
          ? { executionCheckpointMapId: optionalPositiveInteger(event.checkpointMapId) }
          : {}),
      });
    } else if (event.phase === 'input-waiting') {
      this.#update({ inputWait: inputWaitState(event) });
    } else if (event.phase === 'input-ended') {
      this.#update({ inputWait: { kind: 'none' } });
    } else if (event.phase === 'runtime-map-changed') {
      const runtimeMapId = event.mapId;
      let revision = this.#session.mapRevision || '';
      try {
        revision = effectiveMapRevision(this.#workflowRoot, this.#preparation.sourceProject, runtimeMapId);
      } catch (error) {
        this.#sendCommand({ type: 'set-event-execution', operationId: this.#activeOperationId, enabled: false });
        this.#update({
          eventExecutionEnabled: false,
          inputWait: { kind: 'none' },
          error: `Event transfer target could not be loaded: ${errorMessage(error)}`,
        });
        return this.current();
      }
      this.#update({
        mapId: runtimeMapId,
        mapRevision: revision,
        mapPixelWidth: positiveInteger(event.mapPixelWidth, 'runtime map pixel width'),
        mapPixelHeight: positiveInteger(event.mapPixelHeight, 'runtime map pixel height'),
        switchValues: booleanRecord(event.switchValues),
        variableValues: variableRecord(event.variableValues),
        unsupportedVariableTypes: stringRecord(event.unsupportedVariableTypes),
        selfSwitchValues: selfSwitchRecord(event.selfSwitchValues),
        eventStates: eventStateArray(event.eventStates),
        eventExecutionEnabled: Boolean(event.eventExecutionEnabled),
        executionCheckpointMapId: optionalPositiveInteger(event.checkpointMapId),
        inputWait: { kind: 'none' },
        mapChangeSource: 'preview-runtime',
      });
    } else if (event.phase === 'execution-error') {
      this.#update({
        eventExecutionEnabled: false,
        inputWait: { kind: 'none' },
        error: String(event.message || 'Event execution stopped and the preview checkpoint was restored.'),
      });
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
    let request: MapPreviewResumeRequest = {
      project,
      mapId: positiveInteger(requestInput.mapId, 'mapId'),
      overrides: normalizedOverrides(requestInput.overrides),
      ...(requestInput.mapRevision ? { mapRevision: requestInput.mapRevision } : {}),
      ...(requestInput.forceReload === true ? { forceReload: true } : {}),
    };
    assertSelfSwitchMap(request.overrides, request.mapId);
    if (!this.#session || !this.isActive()) return this.start(project, request.mapId, request.overrides);
    const sourceProject = this.#preparation?.sourceProject || this.#sourceProject;
    if (!sourceProject) throw new Error('The active map preview has no source project.');
    if (fs.realpathSync.native(sourceProject) !== project) {
      await this.stop();
      const result = await this.start(project, request.mapId, request.overrides);
      if (result.session) this.#update({ resumeKind: 'reisolated' });
      return this.current();
    }
    request = {
      ...request,
      mapRevision: effectiveMapRevision(this.#workflowRoot, project, request.mapId),
    };
    this.#desiredRunning = true;
    if (this.#session.status === 'preparing') {
      this.#pendingResume = request;
      this.#update({
        mapId: request.mapId,
        mapRevision: request.mapRevision,
        mapChangeSource: 'editor',
      });
      return this.current();
    }
    if (!this.#preparation) return this.current();
    if (['starting', 'resuming'].includes(this.#session.status)) {
      const sameTarget = request.mapId === this.#session.mapId
        && request.mapRevision === this.#session.mapRevision
        && request.forceReload !== true;
      if (sameTarget) {
        this.#pendingResume = null;
        return this.current();
      }
      return this.#restartLoadingRuntime(request);
    }
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

  setVariable(idInput: number, valueInput: MapPreviewVariableValue): MapPreviewResult {
    this.#requireRuntime();
    if (!isMapPreviewVariableValue(valueInput)) throw new Error('Variable value must be a finite number or string.');
    this.#sendCommand({ type: 'set-variable', operationId: this.#activeOperationId, id: positiveInteger(idInput, 'variable id'), value: valueInput });
    return this.current();
  }

  setSelfSwitch(mapIdInput: number, eventIdInput: number, letter: MapPreviewSelfSwitchLetter, value: boolean): MapPreviewResult {
    this.#requireRuntime();
    const mapId = strictPositiveInteger(mapIdInput, 'self switch map id');
    const eventId = strictPositiveInteger(eventIdInput, 'self switch event id');
    if (mapId !== this.#session?.mapId) throw new Error('Self switches can only be changed for the current preview map.');
    this.#sendCommand({
      type: 'set-self-switch',
      operationId: this.#activeOperationId,
      key: mapPreviewSelfSwitchKey(mapId, eventId, letter),
      value: Boolean(value),
    });
    return this.current();
  }

  evaluate(requestId: string, code: string): MapPreviewResult {
    this.#requireRuntime();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(requestId)) throw new Error('Console request id is invalid.');
    if (!code.trim() || code.length > 65_536) throw new Error('Console code is invalid.');
    this.#sendCommand({ type: 'evaluate', operationId: this.#activeOperationId, requestId, code });
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

  setEventExecution(enabled: boolean): MapPreviewResult {
    this.#requireRuntime();
    if (enabled && this.#session?.inputWait?.kind === 'unsupported') {
      throw new Error('Unsupported preview input must be handled in a standalone playtest.');
    }
    this.#sendCommand({ type: 'set-event-execution', operationId: this.#activeOperationId, enabled: Boolean(enabled) });
    this.#update({
      eventExecutionEnabled: Boolean(enabled),
      executionCheckpointMapId: enabled ? this.#session?.mapId : this.#session?.executionCheckpointMapId,
      inputWait: enabled ? { kind: 'none' } : this.#session?.inputWait,
    });
    return this.current();
  }

  sendInput(key: 'up' | 'down' | 'left' | 'right' | 'ok' | 'cancel'): MapPreviewResult {
    this.#requireRuntime();
    if (!['message', 'choice'].includes(this.#session?.inputWait?.kind || 'none')) {
      throw new Error('The preview runtime is not waiting for supported input.');
    }
    this.#sendCommand({ type: 'input-key', operationId: this.#activeOperationId, key });
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
    const target = this.#prepareRuntimeTarget(request);
    if (!target) {
      await this.stop();
      const result = await this.start(request.project, request.mapId, request.overrides);
      if (result.session) this.#update({ resumeKind: 'reisolated' });
      return this.current();
    }
    const purpose = mapPreviewLoadPurpose(this.#session.mapId, request.mapId, target.reload);
    const operationId = ++this.#nextOperationId;
    this.#activeOperationId = operationId;
    this.#activeLoadStartedAt = new Date().toISOString();
    this.#pendingResume = null;
    this.#update({
      operationId,
      status: 'resuming',
      mapId: request.mapId,
      mapRevision: target.revision,
      mapPixelWidth: target.geometry.pixelWidth,
      mapPixelHeight: target.geometry.pixelHeight,
      actualFps: undefined,
      resumeKind: target.reload ? 'map-sync' : 'warm',
      loadProgress: undefined,
    });
    this.#sendCommand({
      type: 'resume',
      operationId,
      purpose: purpose || 'warm',
      mapId: request.mapId,
      mapRevision: target.revision,
      geometry: target.geometry,
      overrides: request.overrides,
    });
    this.#armRuntimeTimeout('iframe-runtime-resume');
    return this.current();
  }

  async #restartLoadingRuntime(request: MapPreviewResumeRequest): Promise<MapPreviewResult> {
    if (!this.#session || !this.#preparation || !this.#session.iframeUrl) return this.current();
    const target = this.#prepareRuntimeTarget(request);
    if (!target) {
      await this.stop();
      const result = await this.start(request.project, request.mapId, request.overrides);
      if (result.session) this.#update({ resumeKind: 'reisolated' });
      return this.current();
    }
    const operationId = ++this.#nextOperationId;
    const now = new Date().toISOString();
    this.#activeOperationId = operationId;
    this.#activeLoadStartedAt = now;
    this.#pendingResume = null;
    this.#clearRuntimeTimeout();
    writeMapPreviewIframeHarness(target.runtime.resourceRoot, {
      sessionId: this.#session.sessionId,
      channelToken: this.#channelToken,
      mapId: request.mapId,
      mapRevision: target.revision,
      operationId,
      viewportWidth: target.runtime.screenWidth,
      viewportHeight: target.runtime.screenHeight,
      tileSize: target.runtime.tileSize,
      geometry: target.geometry,
      overrides: request.overrides,
    });
    this.#update({
      operationId,
      status: 'resuming',
      mapId: request.mapId,
      mapRevision: target.revision,
      mapPixelWidth: target.geometry.pixelWidth,
      mapPixelHeight: target.geometry.pixelHeight,
      iframeUrl: runtimeReloadUrl(this.#session.iframeUrl, operationId),
      actualFps: undefined,
      resumeKind: 'map-sync',
      mapChangeSource: 'editor',
      loadProgress: loadProgress(
        this.#runtimeLoadTaskId(),
        'runtime',
        'waiting-for-engine',
        now,
        now,
      ),
    });
    this.#armRuntimeTimeout('iframe-runtime-resume');
    return this.current();
  }

  #prepareRuntimeTarget(request: MapPreviewResumeRequest): PreparedRuntimeTarget | null {
    if (!this.#session || !this.#preparation) return null;
    assertNoStagingConflicts(this.#workflowRoot, request.project);
    const changes = inspectWarmProjectChanges(this.#workflowRoot, request.project, this.#sourceSnapshot, this.#stagingSnapshot);
    if (changes.unsafePaths.length) return null;
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
    if (reload) {
      syncEffectiveMap(this.#workflowRoot, request.project, this.#preparation.temporaryProject, request.mapId);
      this.#pendingMapSyncIds.delete(request.mapId);
    }
    const runtime = inspectRmmvProject(this.#preparation.temporaryProject);
    const geometry = previewMapGeometry(this.#preparation.temporaryProject, request.mapId, runtime.tileSize);
    return { revision, reload, geometry, runtime };
  }

  #sendCommand(command: MapPreviewRuntimeCommandPayload): void {
    if (!this.#session || !this.#channelToken) throw new Error('Map preview iframe is not available.');
    this.#dependencies.onCommand?.({
      kind: 'rpg-agent-map-preview-command',
      sessionId: this.#session.sessionId,
      channelToken: this.#channelToken,
      command,
    });
  }

  #runtimeLoadTaskId(): string {
    return `${this.#session?.sessionId || 'preview'}:${this.#activeOperationId}`;
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
    this.#sourceProject = '';
    this.#sourceSnapshot = null;
    this.#stagingSnapshot = null;
    this.#pendingMapSyncIds.clear();
    this.#pendingResume = null;
    this.#activeOperationId = 0;
    this.#activeLoadStartedAt = '';
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
      loadProgress: undefined,
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
  if (![
    'ready', 'loading-map', 'suspended', 'state', 'fps', 'console', 'error',
    'loading-progress', 'input-waiting', 'input-ended', 'runtime-map-changed', 'execution-error',
  ].includes(String(value.phase))) {
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
  return {
    switches: booleanRecord(value?.switches),
    variables: variableRecord(value?.variables),
    selfSwitches: selfSwitchRecord(value?.selfSwitches),
  };
}
function booleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [id, entry] of Object.entries(value)) if (/^[1-9]\d*$/.test(id) && typeof entry === 'boolean') out[id] = entry;
  return out;
}
function variableRecord(value: unknown): Record<string, MapPreviewVariableValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, MapPreviewVariableValue> = {};
  for (const [id, entry] of Object.entries(value)) if (/^[1-9]\d*$/.test(id) && isMapPreviewVariableValue(entry)) out[id] = entry;
  return out;
}
function selfSwitchRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (parseMapPreviewSelfSwitchKey(key) && typeof entry === 'boolean') out[key] = entry;
  }
  return out;
}
function assertSelfSwitchMap(overrides: MapPreviewOverrides | undefined, mapId: number): void {
  for (const key of Object.keys(overrides?.selfSwitches || {})) {
    if (parseMapPreviewSelfSwitchKey(key)?.mapId !== mapId) throw new Error('Self switch override belongs to another map.');
  }
}
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(value)) if (/^[1-9]\d*$/.test(id) && typeof entry === 'string') out[id] = entry;
  return out;
}
function eventStateArray(value: unknown): MapPreviewEventState[] {
  if (!Array.isArray(value)) return [];
  const states: MapPreviewEventState[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const x = record.x;
    const y = record.y;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) continue;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (typeof record.active !== 'boolean' || typeof record.visible !== 'boolean') continue;
    const reason = String(record.hiddenReason || '');
    const hiddenReason = ['inactive', 'erased', 'transparent', 'no-graphic'].includes(reason)
      ? reason as MapPreviewEventState['hiddenReason']
      : undefined;
    states.push({ id, x, y, active: record.active, visible: record.visible, ...(hiddenReason ? { hiddenReason } : {}) });
  }
  return states;
}
function inputWaitState(value: MapPreviewRuntimeEvent): NonNullable<MapPreviewSession['inputWait']> {
  const kind = String(value.input || 'none');
  if (kind === 'message' || kind === 'choice') {
    return {
      kind,
      sourceMapId: optionalPositiveInteger(value.sourceMapId),
      eventId: optionalPositiveInteger(value.eventId),
    };
  }
  if (kind === 'unsupported') {
    const unsupportedType = String(value.unsupportedType || 'plugin');
    return {
      kind,
      unsupportedType: ['number', 'item', 'name', 'plugin'].includes(unsupportedType)
        ? unsupportedType as 'number' | 'item' | 'name' | 'plugin'
        : 'plugin',
      sourceMapId: optionalPositiveInteger(value.sourceMapId),
      eventId: optionalPositiveInteger(value.eventId),
    };
  }
  return { kind: 'none' };
}
function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}
function strictPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
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

function loadProgress(
  taskId: string,
  phase: MapPreviewLoadProgress['phase'],
  stage: MapPreviewLoadStage,
  now = new Date().toISOString(),
  taskStartedAt = now,
): MapPreviewLoadProgress {
  return {
    taskId,
    phase,
    stage,
    taskStartedAt,
    stageStartedAt: now,
    updatedAt: now,
  };
}

function runtimeLoadStage(value: unknown): MapPreviewLoadStage {
  const stage = String(value || '');
  const allowed: MapPreviewLoadStage[] = [
    'waiting-for-engine',
    'waiting-for-boot',
    'resetting-game-state',
    'loading-map',
    'loading-map-resources',
    'ready',
  ];
  if (!allowed.includes(stage as MapPreviewLoadStage)) {
    throw new Error('Invalid map preview runtime loading stage.');
  }
  return stage as MapPreviewLoadStage;
}

function runtimeReloadUrl(value: string, operationId: number): string {
  const url = new URL(value);
  url.searchParams.set('previewOperation', String(operationId));
  return url.toString();
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
