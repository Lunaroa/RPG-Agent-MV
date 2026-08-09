import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  UI_DESIGNER_RENDERER_BRIDGE_MAX_BOUNDS,
  UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES,
  UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES,
  UI_DESIGNER_RENDERER_BRIDGE_VERSION,
} from '../../../../contract/ui-designer-renderer-bridge.ts'
import {
  UI_DESIGNER_DOCUMENT_VERSION,
  UI_DESIGNER_RUNTIME_VERSION,
  UI_DESIGNER_SCENE_SCRIPT_VERSION,
  type UiDesignerRendererHostSession,
} from '../../../../contract/ui-designer.ts'
import { inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts'
import { assertUiDesignerProjectEngineSupported } from './ui-designer-project-service.ts'
import {
  cleanupIsolatedProject,
  prepareIsolatedStagedProject,
  verifyIsolatedSourceState,
  type IsolatedProjectStateEvidence,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts'
import { bundledUiDesignerRuntime } from './ui-designer-runtime-service.ts'

const HOST_PLUGIN_NAME = 'MZUIDesignerCanvasHost'
const HOST_PLUGIN_RELATIVE_PATH = `js/plugins/${HOST_PLUGIN_NAME}.js`
const HOST_RUNTIME_RELATIVE_PATH = 'js/plugins/MZUIRuntime.js'

export interface UiDesignerRendererHostPreparationFactory {
  (workflowRoot: string, project: string, temporaryPrefix?: string): Promise<IsolatedProjectPreparation> | IsolatedProjectPreparation
}

export interface UiDesignerRendererHostDependencies {
  registerPreviewRoot(key: string, resourceRoot: string, sourceProject: string): string
  unregisterPreviewRoot(key: string): void
  verifyFrameIsolation(url: string): boolean
  prepareIsolated?: UiDesignerRendererHostPreparationFactory
  verifySourceState?: (workflowRoot: string, preparation: IsolatedProjectPreparation) => IsolatedProjectStateEvidence
}

interface ActiveRendererHost {
  publicSession: UiDesignerRendererHostSession
  protocolKey: string
  preparation: IsolatedProjectPreparation
  protocolRegistered: boolean
}

export class UiDesignerRendererHostService {
  readonly #workflowRoot: string
  readonly #dependencies: UiDesignerRendererHostDependencies
  readonly #prepareIsolated: UiDesignerRendererHostPreparationFactory
  readonly #verifySourceState: (workflowRoot: string, preparation: IsolatedProjectPreparation) => IsolatedProjectStateEvidence
  #active: ActiveRendererHost | null = null
  #generation = 0

  constructor(workflowRoot: string, dependencies: UiDesignerRendererHostDependencies) {
    this.#workflowRoot = path.resolve(workflowRoot)
    this.#dependencies = dependencies
    this.#prepareIsolated = dependencies.prepareIsolated || ((root, project, prefix) => prepareIsolatedStagedProject(root, project, {
      temporaryPrefix: prefix,
      physicalCopyAllProjectDirectories: true,
    }))
    this.#verifySourceState = dependencies.verifySourceState || verifyIsolatedSourceState
  }

  async start(projectInput: string, generationInput: number): Promise<UiDesignerRendererHostSession> {
    if (typeof projectInput !== 'string' || !projectInput.trim()) {
      throw Object.assign(new Error('Select an RPG Maker project before starting the UI designer canvas renderer.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
    }
    if (!Number.isSafeInteger(generationInput) || generationInput < 0) throw new Error('UI designer renderer generation must be a non-negative safe integer.')
    const operation = ++this.#generation
    this.#cleanupActive()
    const project = fs.realpathSync.native(path.resolve(projectInput))
    const manifest = inspectRmmvProject(project)
    assertUiDesignerProjectEngineSupported(manifest)
    if (!manifest.editable || !manifest.runnableStructure) {
      throw new Error(`The selected RPG Maker project cannot host the UI designer canvas: ${manifest.missingRequired.join(', ')}`)
    }
    const engine = manifest.engine === 'rpg-maker-mv' ? 'MV' : 'MZ'
    if (!manifest.engineVersion) throw new Error('The selected RPG Maker project does not expose a verifiable engine version.')
    let preparation: IsolatedProjectPreparation | null = null
    let protocolKey = ''
    try {
      preparation = await this.#prepareIsolated(this.#workflowRoot, project, 'ui-designer-canvas-')
      if (operation !== this.#generation) {
        cleanupIsolatedProject(preparation)
        throw new Error('UI designer renderer preparation was superseded by a newer project generation.')
      }
      const sessionId = crypto.randomUUID()
      stageUiDesignerRendererHost(preparation.temporaryProject, { sessionId, generation: generationInput })
      protocolKey = crypto.randomBytes(32).toString('hex')
      const iframeUrl = this.#dependencies.registerPreviewRoot(
        protocolKey,
        resolveRmmvLayout(preparation.temporaryProject).resourceRoot,
        preparation.sourceProject,
      )
      const publicSession: UiDesignerRendererHostSession = {
        sessionId,
        generation: generationInput,
        iframeUrl,
        engine,
        engineVersion: manifest.engineVersion,
        runtimeVersion: bundledUiDesignerRuntime().version,
      }
      this.#active = { publicSession, protocolKey, preparation, protocolRegistered: true }
      return { ...publicSession }
    } catch (error) {
      if (protocolKey) this.#dependencies.unregisterPreviewRoot(protocolKey)
      if (preparation && this.#active?.preparation !== preparation && fs.existsSync(preparation.temporaryProject)) {
        try { cleanupIsolatedProject(preparation) } catch { /* Preserve the host preparation error. */ }
      }
      throw error
    }
  }

  confirm(sessionId: string): UiDesignerRendererHostSession {
    const active = this.#requireActive(sessionId)
    if (!this.#dependencies.verifyFrameIsolation(active.publicSession.iframeUrl)) {
      this.#cleanupActive()
      throw new Error('The UI designer canvas did not receive an isolated Electron renderer process.')
    }
    return { ...active.publicSession }
  }

  stop(sessionId?: string): void {
    this.#generation += 1
    if (!this.#active) return
    if (sessionId && sessionId !== this.#active.publicSession.sessionId) throw new Error('The requested UI designer renderer session is not active.')
    this.#cleanupActive()
  }

  shutdownSync(): void {
    this.#generation += 1
    this.#cleanupActive()
  }

  current(): UiDesignerRendererHostSession | null {
    return this.#active ? { ...this.#active.publicSession } : null
  }

  #requireActive(sessionId: string): ActiveRendererHost {
    if (!this.#active || !sessionId || this.#active.publicSession.sessionId !== sessionId) throw new Error('The requested UI designer renderer session is not active.')
    return this.#active
  }

  #cleanupActive(): void {
    const active = this.#active
    if (!active) return
    const evidence = this.#verifySourceState(this.#workflowRoot, active.preparation)
    if (!evidence.sourceUnchanged || !evidence.savesUnchanged || !evidence.stagingUnchanged) {
      throw Object.assign(new Error(`UI designer renderer isolation evidence changed; the temporary project was kept for recovery.${evidence.stagingError ? ` ${evidence.stagingError}` : ''}`), {
        code: 'UI_DESIGNER_RENDERER_ISOLATION_CHANGED',
        evidence,
      })
    }
    if (active.protocolRegistered) {
      this.#dependencies.unregisterPreviewRoot(active.protocolKey)
      active.protocolRegistered = false
    }
    cleanupIsolatedProject(active.preparation)
    this.#active = null
  }
}

export function stageUiDesignerRendererHost(
  temporaryProject: string,
  session: Pick<UiDesignerRendererHostSession, 'sessionId' | 'generation'>,
): void {
  const layout = resolveRmmvLayout(temporaryProject)
  const manifest = inspectRmmvProject(temporaryProject)
  if (!manifest.runnableStructure) throw new Error('The isolated UI designer renderer project is not runnable.')
  const pluginDirectory = path.join(layout.resourceRoot, 'js', 'plugins')
  const pluginsPath = path.join(layout.resourceRoot, 'js', 'plugins.js')
  const indexPath = path.join(layout.resourceRoot, 'index.html')
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) throw new Error('The isolated UI designer renderer requires the project index.html.')
  if (!fs.existsSync(pluginsPath) || !fs.statSync(pluginsPath).isFile()) throw new Error('The isolated UI designer renderer requires js/plugins.js.')
  fs.mkdirSync(pluginDirectory, { recursive: true })
  const runtimeBundle = bundledUiDesignerRuntime()
  fs.writeFileSync(path.join(layout.resourceRoot, ...HOST_RUNTIME_RELATIVE_PATH.split('/')), runtimeBundle.source, 'utf8')
  fs.writeFileSync(path.join(layout.resourceRoot, ...HOST_PLUGIN_RELATIVE_PATH.split('/')), rendererHostPluginSource(session, runtimeBundle.version), 'utf8')
  const plugins = parsePluginsJs(fs.readFileSync(pluginsPath, 'utf8'))
    .filter((entry) => entry?.name !== 'MZUIRuntime' && entry?.name !== HOST_PLUGIN_NAME)
  plugins.push({ name: 'MZUIRuntime', status: true, description: 'UI designer shared MV/MZ runtime', parameters: { AutoRegister: 'false' } })
  plugins.push({ name: HOST_PLUGIN_NAME, status: true, description: 'Isolated UI designer canvas host', parameters: {} })
  fs.writeFileSync(pluginsPath, `var $plugins =\n${JSON.stringify(plugins, null, 2)};\n`, 'utf8')
}

function parsePluginsJs(source: string): Array<Record<string, unknown>> {
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('The isolated UI designer renderer plugins.js is invalid.')
  const parsed = JSON.parse(source.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('The isolated UI designer renderer plugins.js must contain an array.')
  return parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
}

function rendererHostPluginSource(session: Pick<UiDesignerRendererHostSession, 'sessionId' | 'generation'>, runtimeVersion: string): string {
  const config = JSON.stringify({
    version: UI_DESIGNER_RENDERER_BRIDGE_VERSION,
    sessionId: session.sessionId,
    generation: session.generation,
    maxBytes: UI_DESIGNER_RENDERER_BRIDGE_MAX_BYTES,
    maxBounds: UI_DESIGNER_RENDERER_BRIDGE_MAX_BOUNDS,
    maxPatches: UI_DESIGNER_RENDERER_BRIDGE_MAX_PATCHES,
    documentVersion: UI_DESIGNER_DOCUMENT_VERSION,
    runtimeVersion,
    runtimeCompatibility: UI_DESIGNER_RUNTIME_VERSION,
    sceneScriptVersion: UI_DESIGNER_SCENE_SCRIPT_VERSION,
  })
  return String.raw`/*:
 * @target MV MZ
 * @plugindesc Isolated UI designer canvas host
 * @help Generated only inside a physically isolated temporary project.
 */
(function installUiDesignerCanvasHost(global) {
  'use strict';
  var config = ${config};
  var outgoingSequence = 0;
  var incomingSequence = -1;
  var activeSceneId = 'Scene_CanvasHost';
  var activeRevision = 0;
  var runtime = null;
  var hostScene = null;
  var pendingMount = null;
  var disposed = false;
  var lastBounds = '';
  var boundsFrame = 0;

  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys, label) {
    if (!object(value)) throw new Error(label + ' must be an object.');
    var allowed = {};
    keys.forEach(function (key) { allowed[key] = true; if (!(key in value)) throw new Error('Missing ' + label + ' field: ' + key); });
    Object.keys(value).forEach(function (key) { if (!allowed[key]) throw new Error('Unexpected ' + label + ' field: ' + key); });
  }
  function identifier(value, scene) {
    var pattern = scene ? /^Scene_[A-Za-z0-9_$]+$/ : /^[A-Za-z0-9_$-]+$/;
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && pattern.test(value);
  }
  function finite(value) { return typeof value === 'number' && isFinite(value) && Math.abs(value) <= 10000000; }
  function jsonSafe(value, depth) {
    if (depth > 16) throw new Error('Renderer bridge JSON nesting exceeds its bound.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
    if (typeof value === 'number') { if (!isFinite(value)) throw new Error('Renderer bridge number is not finite.'); return; }
    if (Array.isArray(value)) { if (value.length > 2048) throw new Error('Renderer bridge array exceeds its bound.'); value.forEach(function (entry) { jsonSafe(entry, depth + 1); }); return; }
    if (!object(value)) throw new Error('Renderer bridge value is not JSON-safe.');
    Object.keys(value).forEach(function (key) {
      if (key.length > 128 || key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Renderer bridge key is unsafe.');
      jsonSafe(value[key], depth + 1);
    });
  }
  var resourcePathKeys = { path: true, backgroundPath: true, fontFile: true, hoverSe: true, clickSe: true, trackImage: true, fillImage: true, posterPath: true, imagePath: true };
  var imageStateKeys = { normal: true, hover: true, pressed: true, disabled: true };
  function validResourcePath(value) {
    if (typeof value !== 'string') return false;
    var normalized = value.trim().replace(/\\/g, '/');
    if (!normalized) return true;
    if (normalized.indexOf('\0') >= 0 || normalized.charAt(0) === '/' || normalized.indexOf('//') === 0 || /^[A-Za-z]:\//.test(normalized) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return false;
    return !normalized.split('/').some(function (segment) { return segment === '..'; });
  }
  function resourcePaths(value, parentKey) {
    if (Array.isArray(value)) { value.forEach(function (entry) { resourcePaths(entry, parentKey); }); return; }
    if (!object(value)) return;
    Object.keys(value).forEach(function (key) {
      var entry = value[key];
      var resource = resourcePathKeys[key] || (parentKey === 'imageStates' && imageStateKeys[key]) || (parentKey === 'frames' && key === 'path');
      if (resource && typeof entry === 'string' && !validResourcePath(entry)) throw new Error('Renderer bridge resource path must be project-relative.');
      resourcePaths(entry, key);
    });
  }
  function boundedString(value, maximum) { return typeof value === 'string' && value.length <= maximum; }
  function validateRuntimeScene(scene) {
    if (!object(scene) || scene.version !== config.documentVersion || scene.runtimeVersion !== config.runtimeCompatibility) throw new Error('Renderer bridge Runtime scene version is unsupported.');
    if (!object(scene.meta) || !identifier(scene.meta.sceneName, true)) throw new Error('Renderer bridge Runtime scene meta is invalid.');
    if (!object(scene.sceneScript) || scene.sceneScript.version !== config.sceneScriptVersion || typeof scene.sceneScript.source !== 'string') throw new Error('Renderer bridge Runtime sceneScript is unsupported.');
    if (!Array.isArray(scene.nodes) || !Array.isArray(scene.zOrder)) throw new Error('Renderer bridge Runtime scene nodes/zOrder are invalid.');
    jsonSafe(scene, 0);
    resourcePaths(scene, '');
  }
  function validateDiagnostic(entry) {
    exact(entry, ['schemaVersion', 'sessionId', 'scene', 'file', 'node', 'type', 'phase', 'event', 'code', 'severity', 'label', 'message', 'count'], 'renderer diagnostic');
    if (entry.schemaVersion !== '1.0.0' || entry.sessionId !== config.sessionId || (entry.scene !== null && !identifier(entry.scene, true))) throw new Error('Renderer bridge diagnostic session is invalid.');
    if (entry.file !== null && (!boundedString(entry.file, 512) || !validResourcePath(entry.file))) throw new Error('Renderer bridge diagnostic file is invalid.');
    ['node', 'type', 'phase', 'event'].forEach(function (key) { if (entry[key] !== null && !boundedString(entry[key], 256)) throw new Error('Renderer bridge diagnostic field is invalid.'); });
    if (!boundedString(entry.code, 128) || (entry.severity !== 'error' && entry.severity !== 'warning') || !boundedString(entry.label, 256) || !boundedString(entry.message, 1024) || !Number.isSafeInteger(entry.count) || entry.count < 0) throw new Error('Renderer bridge diagnostic is invalid.');
  }
  function validateBounds(bounds) {
    if (!Array.isArray(bounds) || bounds.length > config.maxBounds) throw new Error('Renderer bridge bounds exceed their bound.');
    bounds.forEach(function (entry) {
      exact(entry, ['nodeId', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'interactive'], 'renderer bound');
      if (!identifier(entry.nodeId, false) || !finite(entry.x) || !finite(entry.y) || !finite(entry.width) || !finite(entry.height) || !finite(entry.rotation)) throw new Error('Renderer bridge bound is invalid.');
      if (typeof entry.visible !== 'boolean' || typeof entry.interactive !== 'boolean') throw new Error('Renderer bridge bound flags are invalid.');
    });
  }
  function validatePayload(message, direction) {
    var payload = message.payload;
    if (!object(payload)) throw new Error('Renderer bridge payload must be an object.');
    if (message.kind === 'hello') { exact(payload, ['engine', 'engineVersion', 'pixiVersion', 'runtimeVersion'], 'hello payload'); if ((payload.engine !== 'MV' && payload.engine !== 'MZ') || !boundedString(payload.engineVersion, 64) || !payload.engineVersion || !boundedString(payload.pixiVersion, 64) || !payload.pixiVersion || payload.runtimeVersion !== config.runtimeVersion) throw new Error('Renderer bridge hello capability is invalid.'); return; }
    if (message.kind === 'ready') { exact(payload, ['canvasWidth', 'canvasHeight'], 'ready payload'); if (!Number.isSafeInteger(payload.canvasWidth) || payload.canvasWidth < 1 || payload.canvasWidth > 16384 || !Number.isSafeInteger(payload.canvasHeight) || payload.canvasHeight < 1 || payload.canvasHeight > 16384) throw new Error('Renderer bridge canvas size is invalid.'); return; }
    if (message.kind === 'mount') { exact(payload, ['revision', 'scene'], 'mount payload'); if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new Error('Renderer bridge mount revision is invalid.'); validateRuntimeScene(payload.scene); return; }
    if (message.kind === 'mounted' || message.kind === 'bounds') { exact(payload, ['revision', 'bounds'], message.kind + ' payload'); if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new Error('Renderer bridge revision is invalid.'); validateBounds(payload.bounds); return; }
    if (message.kind === 'patch') {
      exact(payload, ['revision', 'nodes'], 'patch payload');
      if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || !Array.isArray(payload.nodes) || payload.nodes.length > config.maxPatches) throw new Error('Renderer bridge patch is invalid.');
      payload.nodes.forEach(function (patch) { exact(patch, ['nodeId', 'props'], 'node patch'); if (!identifier(patch.nodeId, false) || !object(patch.props)) throw new Error('Renderer bridge node patch is invalid.'); jsonSafe(patch.props, 0); resourcePaths(patch.props, ''); });
      return;
    }
    if (message.kind === 'select') { exact(payload, ['nodeIds'], 'select payload'); if (!Array.isArray(payload.nodeIds) || payload.nodeIds.length > config.maxBounds || payload.nodeIds.some(function (id) { return !identifier(id, false); })) throw new Error('Renderer bridge selection is invalid.'); return; }
    if (message.kind === 'input') { exact(payload, ['type', 'nodeId', 'x', 'y', 'button', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey'], 'input payload'); if (['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu'].indexOf(payload.type) < 0 || (payload.nodeId !== null && !identifier(payload.nodeId, false)) || !finite(payload.x) || !finite(payload.y) || !Number.isInteger(payload.button) || payload.button < -1 || payload.button > 5 || ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'].some(function (key) { return typeof payload[key] !== 'boolean'; })) throw new Error('Renderer bridge input is invalid.'); return; }
    if (message.kind === 'diagnostic') { exact(payload, ['entries'], 'diagnostic payload'); if (!Array.isArray(payload.entries) || payload.entries.length > 64) throw new Error('Renderer bridge diagnostics exceed their bound.'); payload.entries.forEach(validateDiagnostic); return; }
    if (message.kind === 'dispose') { exact(payload, ['reason'], 'dispose payload'); if (['scene-change', 'project-change', 'unload', 'shutdown'].indexOf(payload.reason) < 0) throw new Error('Renderer bridge dispose reason is invalid.'); return; }
    if (message.kind === 'disposed') { exact(payload, [], 'disposed payload'); return; }
    throw new Error('Unsupported renderer bridge ' + direction + ' kind: ' + message.kind);
  }
  function validate(message, direction) {
    exact(message, ['version', 'sessionId', 'generation', 'sequence', 'sceneId', 'kind', 'payload'], 'renderer bridge message');
    if (message.version !== config.version || message.sessionId !== config.sessionId || message.generation !== config.generation) throw new Error('Renderer bridge session/version is stale.');
    if (!identifier(message.sessionId, false) || message.sessionId.length < 8 || !Number.isSafeInteger(message.generation) || message.generation < 0 || !Number.isSafeInteger(message.sequence) || message.sequence < 0 || !identifier(message.sceneId, true)) throw new Error('Renderer bridge envelope is invalid.');
    if (['hello', 'ready', 'mount', 'mounted', 'patch', 'bounds', 'select', 'input', 'diagnostic', 'dispose', 'disposed'].indexOf(message.kind) < 0) throw new Error('Renderer bridge kind is invalid.');
    var bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    if (bytes > config.maxBytes) throw new Error('Renderer bridge message exceeds its byte bound.');
    validatePayload(message, direction);
    return message;
  }
  function send(kind, payload, sceneId) {
    if (disposed && kind !== 'disposed') return;
    var message = { version: config.version, sessionId: config.sessionId, generation: config.generation, sequence: outgoingSequence++, sceneId: sceneId || activeSceneId, kind: kind, payload: payload };
    validate(message, 'outgoing');
    global.parent.postMessage(message, '*');
  }
  function diagnostic(error, details) {
    var entry = {
      schemaVersion: '1.0.0', sessionId: config.sessionId, scene: activeSceneId === 'Scene_CanvasHost' ? null : activeSceneId,
      file: null, node: details && details.node ? String(details.node) : null, type: details && details.type ? String(details.type) : null,
      phase: details && details.phase ? String(details.phase) : 'host', event: null, code: details && details.code ? String(details.code) : 'UI_RENDERER_HOST_ERROR',
      severity: details && details.severity === 'warning' ? 'warning' : 'error', label: details && details.label ? String(details.label) : 'renderer-host',
      message: String(error && error.message ? error.message : error).slice(0, 1024), count: 1
    };
    try { send('diagnostic', { entries: [entry] }, activeSceneId); } catch (_) {}
  }
  function engineName() { return global.Utils && global.Utils.RPGMAKER_NAME === 'MV' ? 'MV' : 'MZ'; }
  function resizeCanvas(scene) {
    var width = Math.max(1, Math.round(Number(scene.meta && scene.meta.canvasWidth) || 816));
    var height = Math.max(1, Math.round(Number(scene.meta && scene.meta.canvasHeight) || 624));
    if (global.Graphics && typeof global.Graphics.resize === 'function') global.Graphics.resize(width, height);
    else if (global.Graphics && global.Graphics._renderer && typeof global.Graphics._renderer.resize === 'function') {
      global.Graphics._width = width; global.Graphics._height = height; global.Graphics._boxWidth = width; global.Graphics._boxHeight = height; global.Graphics._renderer.resize(width, height);
    } else throw new Error('The project MV/MZ Graphics host cannot resize the UI canvas.');
  }
  function currentBounds() { return runtime && typeof runtime.getNodeBounds === 'function' ? runtime.getNodeBounds() : []; }
  function publishBounds(force) {
    if (!runtime) return;
    var bounds = currentBounds();
    var encoded = JSON.stringify(bounds);
    if (!force && encoded === lastBounds) return;
    lastBounds = encoded;
    send('bounds', { revision: activeRevision, bounds: bounds }, activeSceneId);
  }
  function mountScene(message) {
    pendingMount = message;
    activeSceneId = message.sceneId;
    activeRevision = message.payload.revision;
    if (!hostScene || !global.MZUIRuntime) return;
    if (runtime && typeof runtime.cleanup === 'function') runtime.cleanup();
    resizeCanvas(message.payload.scene);
    runtime = global.MZUIRuntime.create();
    runtime.mount(message.payload.scene, { root: hostScene, context: { sceneApi: hostScene }, sceneApi: hostScene });
    hostScene._mzuiCanvasRuntime = runtime;
    pendingMount = null;
    lastBounds = JSON.stringify(currentBounds());
    send('mounted', { revision: activeRevision, bounds: currentBounds() }, activeSceneId);
  }
  function cleanupRuntime() {
    if (runtime && typeof runtime.cleanup === 'function') runtime.cleanup();
    runtime = null;
    if (hostScene) hostScene._mzuiCanvasRuntime = null;
    pendingMount = null;
    lastBounds = '';
    try { if (global.AudioManager && typeof global.AudioManager.stopAll === 'function') global.AudioManager.stopAll(); } catch (_) {}
    try { if (global.Video && global.Video._element && typeof global.Video._element.pause === 'function') { global.Video._element.pause(); global.Video._element.removeAttribute('src'); global.Video._element.load(); } } catch (_) {}
  }
  function dispose() {
    if (disposed) return;
    cleanupRuntime();
    send('disposed', {}, activeSceneId);
    disposed = true;
    global.removeEventListener('message', onMessage);
    global.removeEventListener('error', onWindowError);
    global.removeEventListener('unhandledrejection', onUnhandledRejection);
    global.removeEventListener('beforeunload', cleanupRuntime);
    try { if (global.SceneManager && typeof global.SceneManager.stop === 'function') global.SceneManager.stop(); } catch (_) {}
    try { if (global.Graphics && global.Graphics.app && typeof global.Graphics.app.stop === 'function') global.Graphics.app.stop(); } catch (_) {}
  }
  function onMessage(event) {
    if (event.source !== global.parent || disposed) return;
    try {
      var message = validate(event.data, 'incoming');
      if (message.sequence <= incomingSequence) throw new Error('Renderer bridge message sequence is stale.');
      incomingSequence = message.sequence;
      if (message.kind === 'mount') mountScene(message);
      else if (message.kind === 'patch') {
        if (!runtime || message.sceneId !== activeSceneId || message.payload.revision <= activeRevision) throw new Error('Renderer bridge patch does not target the active revision.');
        activeRevision = message.payload.revision;
        var bounds = runtime.patchNodes(message.payload.nodes);
        lastBounds = JSON.stringify(bounds);
        send('bounds', { revision: activeRevision, bounds: bounds }, activeSceneId);
      } else if (message.kind === 'select') {
        if (runtime) runtime.selectedNodeIds = message.payload.nodeIds.slice();
      } else if (message.kind === 'input') {
        if (runtime && typeof runtime.handleRendererInput === 'function') runtime.handleRendererInput(message.payload);
        publishBounds(false);
      } else if (message.kind === 'dispose') dispose();
      else throw new Error('Renderer host cannot consume message kind: ' + message.kind);
    } catch (error) { diagnostic(error, { code: 'UI_RENDERER_BRIDGE_PROTOCOL', phase: 'protocol' }); }
  }
  function onWindowError(event) { diagnostic(event.error || event.message || 'Renderer host error', { phase: 'window' }); }
  function onUnhandledRejection(event) { diagnostic(event.reason || 'Renderer host promise rejection', { phase: 'promise' }); }

  function installScene() {
    if (typeof global.Scene_Base !== 'function') throw new Error('The project MV/MZ Scene_Base host is unavailable.');
    function Scene_MZUIDesignerCanvasHost() { this.initialize.apply(this, arguments); }
    Scene_MZUIDesignerCanvasHost.prototype = Object.create(global.Scene_Base.prototype);
    Scene_MZUIDesignerCanvasHost.prototype.constructor = Scene_MZUIDesignerCanvasHost;
    Scene_MZUIDesignerCanvasHost.prototype.initialize = function () { global.Scene_Base.prototype.initialize.call(this); this._mzuiCanvasRuntime = null; };
    Scene_MZUIDesignerCanvasHost.prototype.create = function () { global.Scene_Base.prototype.create.call(this); hostScene = this; if (pendingMount) mountScene(pendingMount); send('ready', { canvasWidth: Math.round(Number(global.Graphics.width || global.Graphics.boxWidth || global.Graphics._width || 816)), canvasHeight: Math.round(Number(global.Graphics.height || global.Graphics.boxHeight || global.Graphics._height || 624)) }, activeSceneId); };
    Scene_MZUIDesignerCanvasHost.prototype.update = function () {
      global.Scene_Base.prototype.update.call(this);
      if (this._mzuiCanvasRuntime) this._mzuiCanvasRuntime.update();
      boundsFrame += 1;
      if (boundsFrame % 6 === 0) publishBounds(false);
    };
    Scene_MZUIDesignerCanvasHost.prototype.terminate = function () { cleanupRuntime(); hostScene = null; global.Scene_Base.prototype.terminate.call(this); };
    global.Scene_MZUIDesignerCanvasHost = Scene_MZUIDesignerCanvasHost;
    var originalStart = global.Scene_Boot && global.Scene_Boot.prototype.start;
    if (!originalStart) throw new Error('The project MV/MZ Scene_Boot host is unavailable.');
    global.Scene_Boot.prototype.start = function () { originalStart.apply(this, arguments); global.SceneManager.goto(Scene_MZUIDesignerCanvasHost); };
  }

  global.addEventListener('message', onMessage);
  global.addEventListener('error', onWindowError);
  global.addEventListener('unhandledrejection', onUnhandledRejection);
  global.addEventListener('beforeunload', cleanupRuntime);
  if (!global.MZUIRuntime || typeof global.MZUIRuntime.create !== 'function') throw new Error('The shared MZUIRuntime is unavailable.');
  global.MZUIRuntime.configure({ onError: function (entry) { diagnostic(entry && entry.message ? entry.message : 'MZUIRuntime error', entry || {}); } });
  installScene();
  send('hello', { engine: engineName(), engineVersion: global.Utils && global.Utils.RPGMAKER_VERSION ? String(global.Utils.RPGMAKER_VERSION) : null, pixiVersion: global.PIXI && global.PIXI.VERSION ? String(global.PIXI.VERSION) : '', runtimeVersion: String(global.MZUIRuntime.VERSION || global.MZUIRuntime.version || '') }, activeSceneId);
}(window));
`
}
