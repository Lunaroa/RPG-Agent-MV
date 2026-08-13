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
  type UiDesignerRendererResourceSyncRequest,
  type UiDesignerRendererResourceSyncResult,
} from '../../../../contract/ui-designer.ts'
import { inspectRmmvProject, resolveRmmvLayout } from '../rmmv/rmmv-layout.ts'
import { assertUiDesignerProjectEngineSupported } from './ui-designer-project-service.ts'
import {
  cleanupIsolatedProject,
  prepareUiDesignerRendererOverlay,
  verifyIsolatedSourceState,
  type IsolatedProjectStateEvidence,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts'
import {
  attestIsolatedPreparationResponse,
  cleanupOwnedIsolatedProject,
  type IsolatedProjectOwnershipChallenge,
} from './isolated-project-attestation.ts'
import { PreparationWorkerError } from './playtest-preparation.ts'
import { bundledUiDesignerRuntime } from './ui-designer-runtime-service.ts'
import { syncUiDesignerRendererResources } from './ui-designer-renderer-resource-sync.ts'

const HOST_PLUGIN_NAME = 'MZUIDesignerCanvasHost'
const HOST_STORAGE_PLUGIN_NAME = 'MZUIDesignerSessionStorage'
const HOST_PLUGIN_RELATIVE_PATH = `js/plugins/${HOST_PLUGIN_NAME}.js`
const HOST_STORAGE_PLUGIN_RELATIVE_PATH = `js/plugins/${HOST_STORAGE_PLUGIN_NAME}.js`
const HOST_RUNTIME_RELATIVE_PATH = 'js/plugins/MZUIRuntime.js'

export interface UiDesignerRendererHostPreparationFactory {
  (workflowRoot: string, project: string, temporaryPrefix?: string): Promise<IsolatedProjectPreparation> | IsolatedProjectPreparation
}

export interface UiDesignerRendererHostDependencies {
  registerPreviewRoot(
    key: string,
    resourceRoot: string,
    sourceProject: string,
    options?: { fallback?: { root: string; prefixes: readonly string[] }; deniedPaths?: readonly string[] },
  ): string
  unregisterPreviewRoot(key: string): void
  verifyFrameIsolation(url: string): boolean
  prepareIsolated?: UiDesignerRendererHostPreparationFactory
  verifySourceState?: (
    workflowRoot: string,
    preparation: IsolatedProjectPreparation,
    expected?: { sourceProject?: string; temporaryProject?: string },
  ) => IsolatedProjectStateEvidence
}

interface ActiveRendererHost {
  publicSession: UiDesignerRendererHostSession
  protocolKey: string
  preparation: IsolatedProjectPreparation
  sourceProject: string
  protocolRegistered: boolean
}

export class UiDesignerRendererHostService {
  readonly #workflowRoot: string
  readonly #dependencies: UiDesignerRendererHostDependencies
  readonly #prepareIsolated: UiDesignerRendererHostPreparationFactory
  readonly #verifySourceState: NonNullable<UiDesignerRendererHostDependencies['verifySourceState']>
  #active: ActiveRendererHost | null = null
  #retiring = new Map<string, ActiveRendererHost>()
  #retainedPreparations: Array<{ preparation: IsolatedProjectPreparation; sourceProject: string }> = []
  #generation = 0
  #retainedWorkerOwners: IsolatedProjectOwnershipChallenge[] = []

  constructor(workflowRoot: string, dependencies: UiDesignerRendererHostDependencies) {
    this.#workflowRoot = path.resolve(workflowRoot)
    this.#dependencies = dependencies
    this.#prepareIsolated = dependencies.prepareIsolated || ((root, project, prefix) => prepareUiDesignerRendererOverlay(root, project, {
      temporaryPrefix: prefix,
    }))
    this.#verifySourceState = dependencies.verifySourceState || verifyIsolatedSourceState
  }

  async start(projectInput: string, generationInput: number): Promise<UiDesignerRendererHostSession> {
    if (typeof projectInput !== 'string' || !projectInput.trim()) {
      throw Object.assign(new Error('Select an RPG Maker project before starting the UI designer canvas renderer.'), { code: 'UI_DESIGNER_PROJECT_REQUIRED' })
    }
    if (!Number.isSafeInteger(generationInput) || generationInput < 0) throw new Error('UI designer renderer generation must be a non-negative safe integer.')
    if (this.#retainedPreparations.length || this.#retainedWorkerOwners.length) {
      throw Object.assign(new Error('A previous UI designer renderer isolation owner is retained for recovery.'), {
        code: 'UI_DESIGNER_RENDERER_RECOVERY_REQUIRED',
      })
    }
    const operation = ++this.#generation
    if (this.#active) {
      this.#retiring.set(this.#active.publicSession.sessionId, this.#active)
      this.#active = null
    }
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
      attestIsolatedPreparationResponse({
        sourceProject: project,
        temporaryProject: preparation.temporaryProject,
        ownership: preparation.ownership,
      }, preparation)
      if (operation !== this.#generation) {
        cleanupIsolatedProject(preparation, { sourceProject: project, temporaryProject: preparation.temporaryProject })
        throw new Error('UI designer renderer preparation was superseded by a newer project generation.')
      }
      const sessionId = crypto.randomUUID()
      stageUiDesignerRendererHost(preparation, project, { sessionId, generation: generationInput })
      protocolKey = crypto.randomBytes(32).toString('hex')
      const sourceLayout = resolveRmmvLayout(project)
      const iframeUrl = this.#dependencies.registerPreviewRoot(
        protocolKey,
        overlayResourceRoot(preparation.temporaryProject, sourceLayout.resourceRootRelative),
        project,
        rendererProtocolOptions(preparation, sourceLayout.resourceRoot, sourceLayout.resourceRootRelative),
      )
      const publicSession: UiDesignerRendererHostSession = {
        sessionId,
        generation: generationInput,
        iframeUrl,
        engine,
        engineVersion: manifest.engineVersion,
        runtimeVersion: bundledUiDesignerRuntime().version,
        resourceRevision: 0,
      }
      this.#active = { publicSession, protocolKey, preparation, sourceProject: project, protocolRegistered: true }
      return { ...publicSession }
    } catch (error) {
      if (protocolKey) this.#dependencies.unregisterPreviewRoot(protocolKey)
      if (error instanceof PreparationWorkerError) {
        for (const owner of error.retainedOwners) {
          if (!this.#retainedWorkerOwners.some((entry) => entry.temporaryProject === owner.temporaryProject)) {
            this.#retainedWorkerOwners.push(owner)
          }
        }
      }
      if (preparation && this.#active?.preparation !== preparation && fs.existsSync(preparation.temporaryProject)) {
        try {
          cleanupIsolatedProject(preparation, { sourceProject: project, temporaryProject: preparation.temporaryProject })
        } catch {
          this.#retainedPreparations.push({ preparation, sourceProject: project })
        }
      }
      throw error
    }
  }

  confirm(sessionId: string): UiDesignerRendererHostSession {
    const active = this.#requireActive(sessionId)
    if (!this.#dependencies.verifyFrameIsolation(active.publicSession.iframeUrl)) {
      throw new Error('The UI designer canvas did not receive an isolated Electron renderer process.')
    }
    return { ...active.publicSession }
  }

  syncResources(request: UiDesignerRendererResourceSyncRequest): UiDesignerRendererResourceSyncResult {
    const active = this.#requireActive(request.sessionId)
    if (!Number.isSafeInteger(request.generation) || request.generation !== active.publicSession.generation) {
      throw Object.assign(new Error('UI designer renderer resource synchronization belongs to a stale project generation.'), {
        code: 'UI_DESIGNER_RENDERER_GENERATION_STALE',
      })
    }
    const project = fs.realpathSync.native(path.resolve(request.project))
    if (project !== active.sourceProject) {
      throw Object.assign(new Error('UI designer renderer resource synchronization belongs to a different project.'), {
        code: 'UI_DESIGNER_RENDERER_PROJECT_STALE',
      })
    }
    const assertOwned = () => {
      if (this.#active !== active) {
        throw Object.assign(new Error('UI designer renderer resource synchronization was superseded.'), {
          code: 'UI_DESIGNER_RENDERER_SESSION_STALE',
        })
      }
      attestIsolatedPreparationResponse({
        sourceProject: active.sourceProject,
        temporaryProject: active.preparation.temporaryProject,
        ownership: active.preparation.ownership,
      }, active.preparation)
    }
    const receipt = syncUiDesignerRendererResources({
      sourceProject: active.sourceProject,
      temporaryProject: active.preparation.temporaryProject,
      sessionId: active.publicSession.sessionId,
      generation: active.publicSession.generation,
      resourceRevision: active.publicSession.resourceRevision,
      assertOwned,
    }, request.manifest)
    active.publicSession.resourceRevision = receipt.resourceRevision
    return receipt
  }

  stop(sessionId?: string): void {
    if (!sessionId) {
      this.#generation += 1
      return
    }
    if (this.#active?.publicSession.sessionId === sessionId) {
      this.#generation += 1
      this.#cleanupHost(this.#active)
      return
    }
    const retiring = this.#retiring.get(sessionId)
    if (!retiring) throw new Error('The requested UI designer renderer session is not active.')
    this.#cleanupHost(retiring)
  }

  shutdownSync(): void {
    this.#generation += 1
    if (this.#active || this.#retiring.size) {
      throw Object.assign(new Error('UI designer renderer disposal is not confirmed; the isolated project was kept for recovery.'), {
        code: 'UI_DESIGNER_RENDERER_DISPOSE_UNCONFIRMED',
      })
    }
    for (const retained of [...this.#retainedPreparations]) {
      cleanupIsolatedProject(retained.preparation, {
        sourceProject: retained.sourceProject,
        temporaryProject: retained.preparation.temporaryProject,
      })
      this.#retainedPreparations.splice(this.#retainedPreparations.indexOf(retained), 1)
    }
    for (const owner of [...this.#retainedWorkerOwners]) {
      cleanupOwnedIsolatedProject(owner)
      this.#retainedWorkerOwners.splice(this.#retainedWorkerOwners.indexOf(owner), 1)
    }
  }

  current(): UiDesignerRendererHostSession | null {
    return this.#active ? { ...this.#active.publicSession } : null
  }

  #requireActive(sessionId: string): ActiveRendererHost {
    if (!this.#active || !sessionId || this.#active.publicSession.sessionId !== sessionId) throw new Error('The requested UI designer renderer session is not active.')
    return this.#active
  }

  #cleanupHost(active: ActiveRendererHost): void {
    const evidence = this.#verifySourceState(this.#workflowRoot, active.preparation, {
      sourceProject: active.sourceProject,
      temporaryProject: active.preparation.temporaryProject,
    })
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
    cleanupIsolatedProject(active.preparation, {
      sourceProject: active.sourceProject,
      temporaryProject: active.preparation.temporaryProject,
    })
    if (this.#active === active) this.#active = null
    this.#retiring.delete(active.publicSession.sessionId)
  }
}

export function stageUiDesignerRendererHost(
  preparation: IsolatedProjectPreparation,
  expectedSourceProject: string,
  session: Pick<UiDesignerRendererHostSession, 'sessionId' | 'generation'>,
): void {
  const temporaryProject = preparation.temporaryProject
  const assertStageOwnership = () => attestIsolatedPreparationResponse({
    sourceProject: expectedSourceProject,
    temporaryProject,
    ownership: preparation.ownership,
  }, preparation)
  const ownedWrite = (write: () => void): void => {
    assertStageOwnership()
    write()
    assertStageOwnership()
  }
  assertStageOwnership()
  const sourceLayout = resolveRmmvLayout(expectedSourceProject)
  const manifest = inspectRmmvProject(expectedSourceProject)
  const resourceRoot = overlayResourceRoot(temporaryProject, sourceLayout.resourceRootRelative)
  ownedWrite(() => fs.mkdirSync(resourceRoot, { recursive: true }))
  const pluginDirectory = path.join(resourceRoot, 'js', 'plugins')
  const pluginsPath = materializeRendererHostInput(preparation, sourceLayout.resourceRoot, resourceRoot, 'js/plugins.js', assertStageOwnership)
  materializeRendererHostInput(preparation, sourceLayout.resourceRoot, resourceRoot, 'index.html', assertStageOwnership)
  if (manifest.engine === 'rpg-maker-mz') {
    materializeRendererHostInput(preparation, sourceLayout.resourceRoot, resourceRoot, 'js/main.js', assertStageOwnership)
  }
  ownedWrite(() => fs.mkdirSync(pluginDirectory, { recursive: true }))
  const runtimeBundle = bundledUiDesignerRuntime()
  ownedWrite(() => fs.writeFileSync(path.join(resourceRoot, ...HOST_STORAGE_PLUGIN_RELATIVE_PATH.split('/')), rendererSessionStoragePluginSource(session), 'utf8'))
  ownedWrite(() => stageUiDesignerSessionStorageBootstrap(resourceRoot, manifest.engine))
  ownedWrite(() => fs.writeFileSync(path.join(resourceRoot, ...HOST_RUNTIME_RELATIVE_PATH.split('/')), runtimeBundle.source, 'utf8'))
  ownedWrite(() => fs.writeFileSync(path.join(resourceRoot, ...HOST_PLUGIN_RELATIVE_PATH.split('/')), rendererHostPluginSource(session, runtimeBundle.version), 'utf8'))
  const plugins = parsePluginsJs(fs.readFileSync(pluginsPath, 'utf8'))
    .filter((entry) => {
      const configuredName = typeof entry.name === 'string' ? entry.name.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.js$/i, '') : ''
      return configuredName !== HOST_STORAGE_PLUGIN_NAME && configuredName !== 'MZUIRuntime' && configuredName !== HOST_PLUGIN_NAME
    })
  plugins.push({ name: 'MZUIRuntime', status: true, description: 'UI designer shared MV/MZ runtime', parameters: { AutoRegister: 'false' } })
  plugins.push({ name: HOST_PLUGIN_NAME, status: true, description: 'Isolated UI designer canvas host', parameters: {} })
  ownedWrite(() => fs.writeFileSync(pluginsPath, `var $plugins =\n${JSON.stringify(plugins, null, 2)};\n`, 'utf8'))
}

function overlayResourceRoot(temporaryProject: string, resourceRootRelative: '' | 'www'): string {
  return resourceRootRelative ? path.join(temporaryProject, resourceRootRelative) : temporaryProject
}

function materializeRendererHostInput(
  preparation: IsolatedProjectPreparation,
  sourceResourceRoot: string,
  targetResourceRoot: string,
  relativePath: string,
  assertOwned: () => void,
): string {
  const target = path.join(targetResourceRoot, ...relativePath.split('/'))
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target
  const projectRelative = path.relative(preparation.temporaryProject, target).replace(/\\/g, '/')
  if (preparation.staging.files.some((entry) => entry.delete && entry.relativePath.replace(/\\/g, '/') === projectRelative)) {
    throw new Error(`The staged UI designer renderer deletes required host file: ${relativePath}`)
  }
  const source = path.join(sourceResourceRoot, ...relativePath.split('/'))
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`The selected project does not expose required UI designer renderer file: ${relativePath}`)
  }
  assertOwned()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  assertOwned()
  return target
}

function rendererProtocolOptions(
  preparation: IsolatedProjectPreparation,
  sourceResourceRoot: string,
  resourceRootRelative: '' | 'www',
): { fallback: { root: string; prefixes: readonly string[] }; deniedPaths: readonly string[] } {
  const rootPrefix = resourceRootRelative ? `${resourceRootRelative}/` : ''
  const stagedDeletes = preparation.staging.files
    .filter((entry) => entry.delete)
    .map((entry) => entry.relativePath.replace(/\\/g, '/'))
    .filter((relative) => !rootPrefix || relative.startsWith(rootPrefix))
    .map((relative) => rootPrefix ? relative.slice(rootPrefix.length) : relative)
    .filter(Boolean)
  return {
    fallback: { root: sourceResourceRoot, prefixes: [''] },
    deniedPaths: ['save/', '.git/', ...stagedDeletes],
  }
}

function stageUiDesignerSessionStorageBootstrap(resourceRoot: string, engine: 'rpg-maker-mv' | 'rpg-maker-mz'): void {
  const relativeScript = HOST_STORAGE_PLUGIN_RELATIVE_PATH.replace(/\\/g, '/')
  if (engine === 'rpg-maker-mv') {
    const indexPath = path.join(resourceRoot, 'index.html')
    const source = fs.readFileSync(indexPath, 'utf8')
    const scriptPattern = new RegExp(`<script\\b[^>]*\\bsrc=["']${escapeRegExp(relativeScript)}["'][^>]*>\\s*</script>\\s*`, 'gi')
    const withoutExisting = source.replace(scriptPattern, '')
    const managerPattern = /<script\b[^>]*\bsrc=["']js\/rpg_managers\.js["'][^>]*>\s*<\/script>/i
    const managerMatch = managerPattern.exec(withoutExisting)
    if (!managerMatch || managerMatch.index === undefined) {
      throw new Error('The isolated MV UI renderer index.html does not expose the official rpg_managers.js load point.')
    }
    const pluginsPattern = /<script\b[^>]*\bsrc=["']js\/plugins\.js["'][^>]*>\s*<\/script>/i
    const pluginsMatch = pluginsPattern.exec(withoutExisting)
    if (!pluginsMatch || pluginsMatch.index === undefined || pluginsMatch.index <= managerMatch.index) {
      throw new Error('The isolated MV UI renderer index.html does not expose the official plugins.js load point after rpg_managers.js.')
    }
    const scriptTag = `<script type="text/javascript" src="${relativeScript}"></script>`
    const insertion = `${managerMatch[0]}\n        ${scriptTag}`
    const staged = `${withoutExisting.slice(0, managerMatch.index)}${insertion}${withoutExisting.slice(managerMatch.index + managerMatch[0].length)}`
    fs.writeFileSync(indexPath, staged, 'utf8')
    return
  }

  const mainPath = path.join(resourceRoot, 'js', 'main.js')
  const source = fs.readFileSync(mainPath, 'utf8')
  const scriptPattern = new RegExp(`^[ \\t]*["']${escapeRegExp(relativeScript)}["'],?[ \\t]*\\r?\\n`, 'gmi')
  const withoutExisting = source.replace(scriptPattern, '')
  const managerPattern = /(["']js\/rmmz_managers\.js["']\s*,)/g
  const managerMatches = [...withoutExisting.matchAll(managerPattern)]
  if (managerMatches.length !== 1 || managerMatches[0].index === undefined) {
    throw new Error('The isolated MZ UI renderer main.js does not expose the official rmmz_managers.js load point.')
  }
  const managerMatch = managerMatches[0]
  const managerEnd = managerMatch.index + managerMatch[0].length
  const pluginsMatches = [...withoutExisting.matchAll(/["']js\/plugins\.js["']/g)]
  if (pluginsMatches.length !== 1 || pluginsMatches[0].index === undefined || pluginsMatches[0].index <= managerMatch.index) {
    throw new Error('The isolated MZ UI renderer main.js does not expose the official plugins.js load point after rmmz_managers.js.')
  }
  const lineIndent = /^([ \t]*)/.exec(withoutExisting.slice(withoutExisting.lastIndexOf('\n', managerMatch.index) + 1, managerMatch.index))?.[1] || '    '
  const insertion = `\n${lineIndent}"${relativeScript}",`
  const staged = `${withoutExisting.slice(0, managerEnd)}${insertion}${withoutExisting.slice(managerEnd)}`
  fs.writeFileSync(mainPath, staged, 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parsePluginsJs(source: string): Array<Record<string, unknown>> {
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('The isolated UI designer renderer plugins.js is invalid.')
  const parsed = JSON.parse(source.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('The isolated UI designer renderer plugins.js must contain an array.')
  return parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
}

function rendererSessionStoragePluginSource(session: Pick<UiDesignerRendererHostSession, 'sessionId' | 'generation'>): string {
  const config = JSON.stringify({ sessionId: session.sessionId, generation: session.generation })
  return String.raw`/*:
 * @target MV MZ
 * @plugindesc Session-owned in-memory storage for isolated UI preview
 * @help Generated only inside a physically isolated temporary project.
 */
(function installUiDesignerSessionStorage(global) {
  'use strict';
  var config = ${config};
  var manager = global.StorageManager;
  if (!manager || (typeof manager !== 'object' && typeof manager !== 'function')) throw new Error('The project StorageManager is unavailable after the official engine manager stage.');
  var engineName = global.Utils && global.Utils.RPGMAKER_NAME;
  if (engineName !== 'MV' && engineName !== 'MZ') throw new Error('The isolated UI preview storage adapter requires a recognizable MV or MZ engine.');
  var isMZ = engineName === 'MZ';
  var values = Object.create(null);
  var backups = Object.create(null);
  var originalDescriptors = Object.create(null);
  var installed = Object.create(null);
  var restored = false;
  function key(value) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('The isolated UI preview storage key is invalid.');
    var normalized = String(value);
    if (!normalized || normalized.length > 256) throw new Error('The isolated UI preview storage key is invalid.');
    return normalized;
  }
  function missing(name) { return new Error('The requested isolated UI preview storage entry does not exist: ' + key(name)); }
  function read(value) { var name = key(value); if (!(name in values)) throw missing(name); return values[name]; }
  function install(name, implementation) {
    if (restored) throw new Error('The isolated UI preview storage adapter was already disposed.');
    if (!Object.prototype.hasOwnProperty.call(originalDescriptors, name)) {
      originalDescriptors[name] = Object.getOwnPropertyDescriptor(manager, name) || null;
    }
    var original = originalDescriptors[name];
    if (original && original.configurable === false) throw new Error('The project StorageManager method cannot be isolated: ' + name);
    Object.defineProperty(manager, name, {
      configurable: true,
      enumerable: original ? original.enumerable : true,
      get: function () { return implementation; },
      set: function (value) {
        if (value !== implementation) throw new Error('A project plugin attempted to replace the isolated UI preview StorageManager adapter: ' + name);
      }
    });
    installed[name] = implementation;
  }
  function saveText(name, text) { values[key(name)] = String(text); return true; }
  function loadText(name) {
    var normalized = key(name);
    if (!(normalized in values)) {
      // MV's StorageManager.load returns the decompressor's empty result for a
      // missing config/save file. ConfigManager.load relies on that result to
      // apply defaults during a fresh boot. MZ keeps the project's Promise
      // rejection behaviour through loadAsync below.
      if (!isMZ) return '';
      throw missing(normalized);
    }
    return String(values[normalized]);
  }
  function saveAsync(name, text) { return Promise.resolve().then(function () { return saveText(name, text); }); }
  function loadAsync(name) { return Promise.resolve().then(function () { return loadText(name); }); }
  function exists(name) { return key(name) in values; }
  function remove(name) { delete values[key(name)]; return true; }
  function removeAsync(name) { return Promise.resolve().then(function () { return remove(name); }); }
  function backup(name) { var normalized = key(name); if (normalized in values) backups[normalized] = values[normalized]; return true; }
  function backupAsync(name) { return Promise.resolve().then(function () { return backup(name); }); }
  function backupExists(name) { return key(name) in backups; }
  function cleanBackup(name) { delete backups[key(name)]; return true; }
  function cleanBackupAsync(name) { return Promise.resolve().then(function () { return cleanBackup(name); }); }
  function restoreBackup(name) { var normalized = key(name); if (!(normalized in backups)) throw new Error('The isolated UI preview backup does not exist.'); values[normalized] = backups[normalized]; delete backups[normalized]; return true; }
  function restoreBackupAsync(name) { return Promise.resolve().then(function () { return restoreBackup(name); }); }
  function jsonEx() {
    if (!global.JsonEx || typeof global.JsonEx.stringify !== 'function' || typeof global.JsonEx.parse !== 'function') throw new Error('The project MV/MZ JsonEx API is unavailable after the official engine manager stage.');
    return global.JsonEx;
  }
  function serialize(value) { return jsonEx().stringify(value); }
  function deserialize(value) { return jsonEx().parse(value); }
  function identity(value) { return value; }
  function identityAsync(value) { return Promise.resolve(value); }
  function objectToJsonSync(value) { return serialize(value); }
  function objectToJsonAsync(value) { return Promise.resolve().then(function () { return serialize(value); }); }
  function jsonToObjectSync(value) { return deserialize(value); }
  function jsonToObjectAsync(value) { return Promise.resolve().then(function () { return deserialize(value); }); }
  function saveZipSync(name, zip) { return saveText(name, zip); }
  function loadZipSync(name) { return loadText(name); }
  function saveZipAsync(name, zip) { return saveAsync(name, zip); }
  function loadZipAsync(name) { return loadAsync(name); }
  function saveObjectSync(name, value) { saveText(name, serialize(value)); return true; }
  function loadObjectSync(name) { return deserialize(loadText(name)); }
  function saveObjectAsync(name, value) {
    return objectToJsonAsync(value).then(jsonToZipAsync).then(function (zip) { return saveZipAsync(name, zip); });
  }
  function loadObjectAsync(name) {
    return loadZipAsync(name).then(zipToJsonAsync).then(jsonToObjectAsync);
  }
  function jsonToZipSync(value) { return identity(value); }
  function zipToJsonSync(value) { return identity(value); }
  function jsonToZipAsync(value) { return identityAsync(value); }
  function zipToJsonAsync(value) { return identityAsync(value); }

  install('save', isMZ ? saveAsync : saveText);
  install('load', isMZ ? loadAsync : loadText);
  install('exists', exists);
  install('remove', isMZ ? removeAsync : remove);
  install('backup', isMZ ? backupAsync : backup);
  install('backupExists', backupExists);
  install('cleanBackup', isMZ ? cleanBackupAsync : cleanBackup);
  install('restoreBackup', isMZ ? restoreBackupAsync : restoreBackup);
  install('saveToLocalFile', isMZ ? saveAsync : saveText);
  install('loadFromLocalFile', isMZ ? loadAsync : loadText);
  install('localFileExists', exists);
  install('removeLocalFile', isMZ ? removeAsync : remove);
  install('saveToWebStorage', isMZ ? saveAsync : saveText);
  install('loadFromWebStorage', isMZ ? loadAsync : loadText);
  install('webStorageExists', exists);
  install('removeWebStorage', isMZ ? removeAsync : remove);
  install('saveToForage', isMZ ? saveAsync : saveText);
  install('loadFromForage', isMZ ? loadAsync : loadText);
  install('removeForage', isMZ ? removeAsync : remove);
  install('forageExists', exists);
  install('saveZip', isMZ ? saveZipAsync : saveZipSync);
  install('loadZip', isMZ ? loadZipAsync : loadZipSync);
  install('objectToJson', isMZ ? objectToJsonAsync : objectToJsonSync);
  install('jsonToObject', isMZ ? jsonToObjectAsync : jsonToObjectSync);
  install('jsonToZip', isMZ ? jsonToZipAsync : jsonToZipSync);
  install('zipToJson', isMZ ? zipToJsonAsync : zipToJsonSync);
  install('saveObject', isMZ ? saveObjectAsync : saveObjectSync);
  install('loadObject', isMZ ? loadObjectAsync : loadObjectSync);

  global.__mzuiSessionStorage = {
    schemaVersion: '1.0.0',
    sessionId: config.sessionId,
    generation: config.generation,
    assertInstalled: function () {
      if (restored) throw new Error('The isolated UI preview storage adapter has been disposed.');
      Object.keys(installed).forEach(function (name) {
        if (manager[name] !== installed[name]) throw new Error('A project plugin replaced the isolated UI preview StorageManager adapter: ' + name);
      });
      return true;
    },
    clear: function () {
      Object.keys(values).forEach(function (name) { delete values[name]; });
      Object.keys(backups).forEach(function (name) { delete backups[name]; });
    },
    snapshot: function () { return { values: Object.keys(values).length, backups: Object.keys(backups).length }; },
    restore: function () {
      if (restored) return true;
      var names = Object.keys(originalDescriptors);
      for (var index = names.length - 1; index >= 0; index -= 1) {
        var name = names[index];
        var descriptor = originalDescriptors[name];
        if (descriptor) Object.defineProperty(manager, name, descriptor);
        else delete manager[name];
      }
      restored = true;
      global.__mzuiSessionStorage = null;
      return true;
    }
  };
}(window));
`
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
  var mountedDocumentSceneId = null;
  var documentSceneName = null;
  var activeRevision = 0;
  var runtime = null;
  var hostScene = null;
  var pendingMount = null;
  var lastMount = null;
  var disposed = false;
  var activeExecutionMode = 'authoring';
  var lastBoundsByNode = {};
  var lastActualScene = null;
  var lastPublishedActiveIdentity = null;
  var sceneManagerOriginals = null;
  var sceneManagerInstalled = null;
  var sceneBootOriginalStart = null;
  var sceneBootInstalledStart = null;
  var sceneIdentities = [];
  var explicitRequestedScene = null;
  var transitionPollHandle = null;
  var transitionPollToken = 0;
  var currentStage = 'iframe-load';
  var fatalSent = false;
  var mountReceiptPending = false;
  var hostSceneClass = 'Scene_MZUIDesignerCanvasHost';

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
  function validateDiagnostic(entry, sceneId) {
    exact(entry, ['schemaVersion', 'sessionId', 'scene', 'file', 'node', 'type', 'phase', 'event', 'code', 'severity', 'label', 'message', 'count'], 'renderer diagnostic');
    if (entry.schemaVersion !== '1.0.0' || entry.sessionId !== config.sessionId || (entry.scene !== null && entry.scene !== sceneId)) throw new Error('Renderer bridge diagnostic session or scene is invalid.');
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
    if (message.kind === 'hello') { exact(payload, ['engine', 'engineVersion', 'pixiVersion', 'runtimeVersion'], 'hello payload'); if ((payload.engine !== 'MV' && payload.engine !== 'MZ') || (payload.engineVersion !== null && !boundedString(payload.engineVersion, 64)) || !boundedString(payload.pixiVersion, 64) || !boundedString(payload.runtimeVersion, 64)) throw new Error('Renderer bridge hello capability is invalid.'); return; }
    if (message.kind === 'receipt') { exact(payload, ['stage', 'status', 'message'], 'receipt payload'); if (['iframe-load', 'entry-invoked', 'hello', 'confirm', 'ready', 'mount', 'mounted', 'scene-state'].indexOf(payload.stage) < 0 || ['begin', 'success', 'error'].indexOf(payload.status) < 0 || (payload.message !== null && !boundedString(payload.message, 512))) throw new Error('Renderer bridge receipt is invalid.'); return; }
    if (message.kind === 'fatal') { exact(payload, ['stage', 'code', 'message', 'revision'], 'fatal payload'); if (['iframe-load', 'entry-invoked', 'hello', 'confirm', 'ready', 'mount', 'mounted', 'scene-state'].indexOf(payload.stage) < 0 || !boundedString(payload.code, 128) || !/^[A-Z][A-Z0-9_]{2,127}$/.test(payload.code) || !boundedString(payload.message, 1024) || !Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new Error('Renderer bridge fatal payload is invalid.'); return; }
    if (message.kind === 'ready') { exact(payload, ['canvasWidth', 'canvasHeight', 'engineSceneClass'], 'ready payload'); if (!Number.isSafeInteger(payload.canvasWidth) || payload.canvasWidth < 1 || payload.canvasWidth > 16384 || !Number.isSafeInteger(payload.canvasHeight) || payload.canvasHeight < 1 || payload.canvasHeight > 16384 || !identifier(payload.engineSceneClass, true)) throw new Error('Renderer bridge canvas size or engine scene class is invalid.'); return; }
    if (message.kind === 'mount') { exact(payload, ['revision', 'executionMode', 'documentSceneId', 'scene'], 'mount payload'); if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || (payload.executionMode !== 'authoring' && payload.executionMode !== 'full-preview') || !identifier(payload.documentSceneId, false)) throw new Error('Renderer bridge mount revision, mode, or document identity is invalid.'); validateRuntimeScene(payload.scene); return; }
    if (message.kind === 'mounted' || message.kind === 'bounds') { exact(payload, message.kind === 'mounted' ? ['revision', 'executionMode', 'engineSceneClass', 'mountedDocumentSceneId', 'documentSceneName', 'bounds'] : ['revision', 'bounds'], message.kind + ' payload'); if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || (message.kind === 'mounted' && (payload.executionMode !== 'authoring' && payload.executionMode !== 'full-preview' || !identifier(payload.engineSceneClass, true) || !identifier(payload.mountedDocumentSceneId, false) || !identifier(payload.documentSceneName, true)))) throw new Error('Renderer bridge revision or mounted scene identity is invalid.'); validateBounds(payload.bounds); return; }
    if (message.kind === 'patch') {
      exact(payload, ['revision', 'nodes'], 'patch payload');
      if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || !Array.isArray(payload.nodes) || payload.nodes.length > config.maxPatches) throw new Error('Renderer bridge patch is invalid.');
      payload.nodes.forEach(function (patch) { exact(patch, ['nodeId', 'props'], 'node patch'); if (!identifier(patch.nodeId, false) || !object(patch.props)) throw new Error('Renderer bridge node patch is invalid.'); jsonSafe(patch.props, 0); resourcePaths(patch.props, ''); });
      return;
    }
    if (message.kind === 'resource-refresh') {
      exact(payload, ['revision', 'resourceRevision', 'relativePaths'], 'resource-refresh payload');
      if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || !Number.isSafeInteger(payload.resourceRevision) || payload.resourceRevision < 1 || !Array.isArray(payload.relativePaths) || payload.relativePaths.length > config.maxPatches || payload.relativePaths.some(function (entry) { return !entry || !validResourcePath(entry); })) throw new Error('Renderer bridge resource refresh is invalid.');
      return;
    }
    if (message.kind === 'select') { exact(payload, ['nodeIds'], 'select payload'); if (!Array.isArray(payload.nodeIds) || payload.nodeIds.length > config.maxBounds || payload.nodeIds.some(function (id) { return !identifier(id, false); })) throw new Error('Renderer bridge selection is invalid.'); return; }
    if (message.kind === 'input') { exact(payload, ['type', 'nodeId', 'x', 'y', 'button', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey'], 'input payload'); if (['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu'].indexOf(payload.type) < 0 || (payload.nodeId !== null && !identifier(payload.nodeId, false)) || !finite(payload.x) || !finite(payload.y) || !Number.isInteger(payload.button) || payload.button < -1 || payload.button > 5 || ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'].some(function (key) { return typeof payload[key] !== 'boolean'; })) throw new Error('Renderer bridge input is invalid.'); return; }
    if (message.kind === 'diagnostic') { exact(payload, ['entries'], 'diagnostic payload'); if (!Array.isArray(payload.entries) || payload.entries.length > 64) throw new Error('Renderer bridge diagnostics exceed their bound.'); payload.entries.forEach(function (entry) { validateDiagnostic(entry, message.sceneId); }); return; }
    if (message.kind === 'scene-state') { exact(payload, ['phase', 'requestedScene', 'actualScene', 'engineSceneClass', 'mountedDocumentSceneId', 'documentSceneName', 'revision', 'executionMode'], 'scene-state payload'); if (payload.phase !== 'transitioning' && payload.phase !== 'active') throw new Error('Renderer bridge scene-state phase is invalid.'); if (payload.requestedScene !== null && !identifier(payload.requestedScene, true)) throw new Error('Renderer bridge requested scene is invalid.'); if (payload.actualScene !== null && !identifier(payload.actualScene, true)) throw new Error('Renderer bridge actual scene is invalid.'); if (payload.engineSceneClass !== null && !identifier(payload.engineSceneClass, true)) throw new Error('Renderer bridge engine scene class is invalid.'); if (payload.mountedDocumentSceneId !== null && !identifier(payload.mountedDocumentSceneId, false)) throw new Error('Renderer bridge mounted document scene id is invalid.'); if (payload.documentSceneName !== null && !identifier(payload.documentSceneName, true)) throw new Error('Renderer bridge document scene name is invalid.'); if (!Number.isSafeInteger(payload.revision) || payload.revision < 0 || (payload.executionMode !== 'authoring' && payload.executionMode !== 'full-preview')) throw new Error('Renderer bridge scene-state revision or execution mode is invalid.'); return; }
    if (message.kind === 'exit-request') { exact(payload, ['key'], 'exit-request payload'); if (payload.key !== 'Escape' && payload.key !== 'F6' && payload.key !== 'action-exit') throw new Error('Renderer bridge exit request is invalid.'); return; }
    if (message.kind === 'dispose') { exact(payload, ['reason'], 'dispose payload'); if (['scene-change', 'project-change', 'unload', 'shutdown'].indexOf(payload.reason) < 0) throw new Error('Renderer bridge dispose reason is invalid.'); return; }
    if (message.kind === 'disposed') { exact(payload, [], 'disposed payload'); return; }
    throw new Error('Unsupported renderer bridge ' + direction + ' kind: ' + message.kind);
  }
  function validate(message, direction) {
    exact(message, ['version', 'sessionId', 'generation', 'sequence', 'sceneId', 'kind', 'payload'], 'renderer bridge message');
    if (message.version !== config.version || message.sessionId !== config.sessionId || message.generation !== config.generation) throw new Error('Renderer bridge session/version is stale.');
    if (!identifier(message.sessionId, false) || message.sessionId.length < 8 || !Number.isSafeInteger(message.generation) || message.generation < 0 || !Number.isSafeInteger(message.sequence) || message.sequence < 0 || !identifier(message.sceneId, true)) throw new Error('Renderer bridge envelope is invalid.');
    if (['hello', 'receipt', 'fatal', 'ready', 'mount', 'mounted', 'patch', 'resource-refresh', 'bounds', 'select', 'input', 'diagnostic', 'scene-state', 'exit-request', 'dispose', 'disposed'].indexOf(message.kind) < 0) throw new Error('Renderer bridge kind is invalid.');
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
  function safeProtocolMessage(value) {
    var text = String(value && value.message ? value.message : value || '').replace(config.sessionId, '<session>');
    text = text.replace(/rpg-agent-preview:\/\/[^\s/]+/gi, '<preview>');
    var pathMatch = /(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?:Users|home|tmp|var|private|opt|mnt|workspace|workspaces|project|projects|repo|repos)\b)/i.exec(text);
    if (pathMatch && pathMatch.index !== undefined) text = text.slice(0, pathMatch.index).replace(/\s+$/, '') + ' <path>';
    text = text.replace(/\b[a-f0-9]{32,}\b/gi, '<token>');
    return text.replace(/\s+/g, ' ').trim().slice(0, 1024);
  }
  function sendReceipt(stage, status, message) {
    try { send('receipt', { stage: stage, status: status, message: message === null ? null : safeProtocolMessage(message) }, activeSceneId); } catch (_) {}
  }
  function fatal(stage, code, message) {
    if (fatalSent) return;
    fatalSent = true;
    currentStage = stage;
    try { send('fatal', { stage: stage, code: String(code).slice(0, 128), message: safeProtocolMessage(message || 'The isolated UI renderer stopped before completing this stage.'), revision: activeRevision }, activeSceneId); } catch (_) {}
  }
  function diagnostic(error, details) {
    var entry = {
      schemaVersion: '1.0.0', sessionId: config.sessionId, scene: activeSceneId === 'Scene_CanvasHost' ? null : activeSceneId,
      file: null, node: details && details.node ? safeProtocolMessage(details.node) : null, type: details && details.type ? safeProtocolMessage(details.type) : null,
      phase: details && details.phase ? safeProtocolMessage(details.phase) : 'host', event: details && details.event ? safeProtocolMessage(details.event) : null, code: details && details.code ? safeProtocolMessage(details.code) : 'UI_RENDERER_HOST_ERROR',
      severity: details && details.severity === 'warning' ? 'warning' : 'error', label: details && details.label ? safeProtocolMessage(details.label) : 'renderer-host',
      message: safeProtocolMessage(error), count: 1
    };
    try { send('diagnostic', { entries: [entry] }, activeSceneId); } catch (_) {}
  }
  function runStageStep(stage, code, event, publicMessage, action) {
    try {
      return action();
    } catch (error) {
      diagnostic(error, { phase: stage, event: event, code: code });
      var reason = safeProtocolMessage(error);
      fatal(stage, code, publicMessage + (reason ? ' Cause: ' + reason : ''));
      throw error;
    }
  }
  function engineName() { return global.Utils && global.Utils.RPGMAKER_NAME === 'MV' ? 'MV' : 'MZ'; }
  function sceneName(value) {
    var name = null;
    var constructor = typeof value === 'function' ? value : value && value.constructor;
    for (var index = 0; constructor && index < sceneIdentities.length; index += 1) {
      if (sceneIdentities[index].constructor === constructor) return sceneIdentities[index].name;
    }
    if (constructor) name = constructor.name;
    return identifier(name, true) ? name : null;
  }
  function rememberSceneIdentity(constructor, name) {
    if (typeof constructor !== 'function' || !identifier(name, true)) throw new Error('The requested MV/MZ scene identity is invalid.');
    if (!sceneIdentities.some(function (entry) { return entry.constructor === constructor && entry.name === name; })) sceneIdentities.push({ constructor: constructor, name: name });
  }
  function currentActualScene() { return global.SceneManager ? sceneName(global.SceneManager._scene) : null; }
  function reportSceneTransitionFailure(error, event) {
    if (fatalSent) return;
    currentStage = 'scene-state';
    diagnostic(error, { phase: 'scene-state', event: event, code: 'UI_RENDERER_SCENE_TRANSITION_FAILED' });
    var reason = safeProtocolMessage(error);
    fatal('scene-state', 'UI_RENDERER_SCENE_TRANSITION_FAILED', 'The isolated UI renderer could not complete its official scene transition.' + (reason ? ' Cause: ' + reason : ''));
  }
  function runSceneTransition(event, action) {
    try {
      return action();
    } catch (error) {
      try { reportSceneTransitionFailure(error, event); } catch (_) {}
      throw error;
    }
  }
  function publishSceneState(phase, requestedScene) {
    return runSceneTransition('scene-state-publish', function () {
      var actual = currentActualScene();
      var activeIdentity = phase === 'active'
        ? JSON.stringify([actual, activeSceneId, mountedDocumentSceneId, documentSceneName, activeRevision, activeExecutionMode])
        : null;
      if (phase === 'active' && activeIdentity === lastPublishedActiveIdentity) return;
      if (phase === 'active') {
        lastActualScene = actual;
        lastPublishedActiveIdentity = activeIdentity;
      }
      currentStage = 'scene-state';
      sendReceipt('scene-state', 'begin', null);
      send('scene-state', {
        phase: phase,
        requestedScene: requestedScene || null,
        actualScene: actual,
        engineSceneClass: actual,
        mountedDocumentSceneId: mountedDocumentSceneId,
        documentSceneName: documentSceneName,
        revision: activeRevision,
        executionMode: activeExecutionMode
      }, activeSceneId);
      sendReceipt('scene-state', 'success', null);
    });
  }
  function cancelActualScenePolling() {
    transitionPollToken += 1;
    if (transitionPollHandle !== null && global.clearTimeout) global.clearTimeout(transitionPollHandle);
    transitionPollHandle = null;
  }
  function publishActualSceneAfterTransition(attempts) {
    if (disposed) return;
    var actual = currentActualScene();
    if (actual !== lastActualScene) publishSceneState('active', null);
    if (attempts <= 0 || !global.setTimeout || transitionPollHandle !== null) return;
    var pollToken = transitionPollToken;
    transitionPollHandle = global.setTimeout(function () {
      transitionPollHandle = null;
      if (disposed || pollToken !== transitionPollToken) return;
      publishActualSceneAfterTransition(attempts - 1);
    }, 16);
  }
  function requireSessionStorage(clear) {
    var storage = global.__mzuiSessionStorage;
    if (!storage || storage.sessionId !== config.sessionId || storage.generation !== config.generation || typeof storage.assertInstalled !== 'function' || typeof storage.clear !== 'function') {
      throw new Error('The isolated UI preview session storage adapter is unavailable.');
    }
    storage.assertInstalled();
    if (clear) storage.clear();
    return storage;
  }
  function transitionTo(method, target, requestedName) {
    var name = requestedName || sceneName(target);
    if (!identifier(name, true) || typeof target !== 'function' || !global.SceneManager || typeof global.SceneManager[method] !== 'function') throw new Error('The requested MV/MZ scene transition is unavailable.');
    rememberSceneIdentity(target, name);
    explicitRequestedScene = name;
    global.SceneManager[method](target);
  }
  var officialGameObjectNames = [
    '$gameTemp', '$gameSystem', '$gameScreen', '$gameTimer', '$gameMessage',
    '$gameSwitches', '$gameVariables', '$gameSelfSwitches', '$gameActors',
    '$gameParty', '$gameTroop', '$gameMap', '$gamePlayer'
  ];
  var officialGameObjectMode = null;
  function hasOfficialGameObjects() {
    for (var index = 0; index < officialGameObjectNames.length; index += 1) {
      if (global[officialGameObjectNames[index]] === null || global[officialGameObjectNames[index]] === undefined) return false;
    }
    if (typeof global.$gameSystem.windowTone !== 'function') return false;
    if (typeof global.$gameMessage.add !== 'function') return false;
    return true;
  }
  function ensureOfficialGameObjectsForMessageWindow() {
    var hasObjects = hasOfficialGameObjects();
    if (hasObjects && officialGameObjectMode === null) {
      // Scene_Boot.start normally ran the engine's own setupNewGame before
      // this host scene is entered. Keep those objects and avoid a second new
      // game side effect during the first full-preview mount.
      officialGameObjectMode = activeExecutionMode;
      return;
    }
    if (hasObjects && officialGameObjectMode === activeExecutionMode) return;
    if (!global.DataManager || (typeof global.DataManager !== 'object' && typeof global.DataManager !== 'function')) throw new Error('The official MV/MZ DataManager is unavailable before message-window creation.');
    if (activeExecutionMode === 'full-preview') {
      if (typeof global.DataManager.setupNewGame !== 'function') throw new Error('The official MV/MZ DataManager.setupNewGame lifecycle is unavailable before full-preview message-window creation.');
      global.DataManager.setupNewGame();
    } else {
      if (typeof global.DataManager.createGameObjects !== 'function') throw new Error('The official MV/MZ DataManager.createGameObjects lifecycle is unavailable before authoring message-window creation.');
      global.DataManager.createGameObjects();
    }
    officialGameObjectMode = activeExecutionMode;
    if (!hasOfficialGameObjects()) throw new Error('The official MV/MZ DataManager lifecycle did not establish complete game objects before message-window creation.');
  }
  function ensureSceneMessageHost(scene) {
    if (!scene || scene._messageWindow) return scene && scene._messageWindow;
    if (typeof scene.createWindowLayer !== 'function') throw new Error('The active MV/MZ scene cannot create an official message window layer.');
    ensureOfficialGameObjectsForMessageWindow();
    if (!scene._windowLayer) scene.createWindowLayer();
    if (engineName() === 'MZ') {
      var messagePrototype = global.Scene_Message && global.Scene_Message.prototype;
      var required = ['createAllWindows', 'createMessageWindow', 'messageWindowRect', 'createScrollTextWindow', 'scrollTextWindowRect', 'createNameBoxWindow', 'createChoiceListWindow', 'createNumberInputWindow', 'createEventItemWindow', 'eventItemWindowRect', 'associateWindows'];
      if (!messagePrototype) throw new Error('The project MZ Scene_Message contract is unavailable.');
      required.forEach(function (name) {
        if (typeof messagePrototype[name] !== 'function') throw new Error('The project MZ Scene_Message contract is incomplete: ' + name);
        if (typeof scene[name] !== 'function') scene[name] = messagePrototype[name];
      });
      scene.createAllWindows();
    } else {
      var mapPrototype = global.Scene_Map && global.Scene_Map.prototype;
      if (!mapPrototype || typeof mapPrototype.createMessageWindow !== 'function') throw new Error('The project MV message-window contract is unavailable.');
      mapPrototype.createMessageWindow.call(scene);
    }
    if (!scene._messageWindow) throw new Error('The project MV/MZ message window was not created.');
    return scene._messageWindow;
  }
  function previewActions() {
    return {
      exit: function () { send('exit-request', { key: 'action-exit' }, activeSceneId); },
      gotoScene: function (action) {
        if (!action || !identifier(action.sceneName, true) || typeof global[action.sceneName] !== 'function') throw new Error('The requested MV/MZ scene is unavailable.');
        transitionTo('push', global[action.sceneName], action.sceneName);
      },
      newGame: function () {
        if (!global.DataManager || typeof global.DataManager.setupNewGame !== 'function' || typeof global.Scene_Map !== 'function') throw new Error('The MV/MZ new-game action is unavailable.');
        global.DataManager.setupNewGame();
        transitionTo('goto', global.Scene_Map, 'Scene_Map');
      },
      continue: function () {
        if (typeof global.Scene_Load !== 'function') throw new Error('The MV/MZ continue scene is unavailable.');
        transitionTo('push', global.Scene_Load, 'Scene_Load');
      },
      options: function () {
        if (typeof global.Scene_Options !== 'function') throw new Error('The MV/MZ options scene is unavailable.');
        transitionTo('push', global.Scene_Options, 'Scene_Options');
      },
      showMessage: function (action) {
        ensureSceneMessageHost(global.SceneManager && global.SceneManager._scene);
        if (!global.$gameMessage || typeof global.$gameMessage.add !== 'function') throw new Error('The project MV/MZ game-message state is unavailable.');
        global.$gameMessage.add(String(action && action.message || ''));
      },
      setVariable: function (action) {
        if (!global.$gameVariables || typeof global.$gameVariables.value !== 'function' || typeof global.$gameVariables.setValue !== 'function') throw new Error('The project game-variable state is unavailable.');
        var current = Number(global.$gameVariables.value(action.variableId) || 0);
        var next = action.variableOp === '=' ? action.variableVal : action.variableOp === '+' ? current + action.variableVal : action.variableOp === '-' ? current - action.variableVal : action.variableOp === '*' ? current * action.variableVal : current / action.variableVal;
        global.$gameVariables.setValue(action.variableId, next);
      },
      setSwitch: function (action) {
        if (!global.$gameSwitches || typeof global.$gameSwitches.value !== 'function' || typeof global.$gameSwitches.setValue !== 'function') throw new Error('The project game-switch state is unavailable.');
        var next = action.switchVal === 'toggle' ? !global.$gameSwitches.value(action.switchId) : action.switchVal === 'on';
        global.$gameSwitches.setValue(action.switchId, next);
      }
    };
  }
  function installSceneStateBridge() {
    if (!global.SceneManager || typeof global.SceneManager.goto !== 'function' || typeof global.SceneManager.push !== 'function' || typeof global.SceneManager.pop !== 'function' || typeof global.SceneManager.changeScene !== 'function' || typeof global.SceneManager.catchException !== 'function') {
      throw new Error('The MV/MZ SceneManager transition contract is unavailable.');
    }
    sceneManagerOriginals = {
      goto: global.SceneManager.goto,
      push: global.SceneManager.push,
      pop: global.SceneManager.pop,
      changeScene: global.SceneManager.changeScene,
      catchException: global.SceneManager.catchException,
      updateMain: global.SceneManager.updateMain,
      update: global.SceneManager.update
    };
    var installedOriginals = sceneManagerOriginals;
    sceneManagerInstalled = {};
    sceneManagerInstalled.goto = function (target) {
      var receiver = this;
      var args = arguments;
      return runSceneTransition('goto', function () {
        var requested = explicitRequestedScene || sceneName(target);
        explicitRequestedScene = null;
        publishSceneState('transitioning', requested);
        return installedOriginals.goto.apply(receiver, args);
      });
    };
    sceneManagerInstalled.push = function (target) {
      var receiver = this;
      var args = arguments;
      return runSceneTransition('push', function () {
        var requested = explicitRequestedScene || sceneName(target);
        explicitRequestedScene = null;
        publishSceneState('transitioning', requested);
        return installedOriginals.push.apply(receiver, args);
      });
    };
    sceneManagerInstalled.pop = function () {
      var receiver = this;
      var args = arguments;
      return runSceneTransition('pop', function () {
        publishSceneState('transitioning', null);
        return installedOriginals.pop.apply(receiver, args);
      });
    };
    sceneManagerInstalled.changeScene = function () {
      var receiver = this;
      var args = arguments;
      return runSceneTransition('change-scene', function () {
        var before = currentActualScene();
        var result = installedOriginals.changeScene.apply(receiver, args);
        var after = currentActualScene();
        if (after !== before || after !== lastActualScene) publishSceneState('active', null);
        publishActualSceneAfterTransition(8);
        return result;
      });
    };
    sceneManagerInstalled.catchException = function (error) {
      try { reportSceneTransitionFailure(error, 'catch-exception'); } catch (_) {}
      return installedOriginals.catchException.apply(this, arguments);
    };
    global.SceneManager.goto = sceneManagerInstalled.goto;
    global.SceneManager.push = sceneManagerInstalled.push;
    global.SceneManager.pop = sceneManagerInstalled.pop;
    global.SceneManager.changeScene = sceneManagerInstalled.changeScene;
    global.SceneManager.catchException = sceneManagerInstalled.catchException;
    var updateMethod = typeof installedOriginals.updateMain === 'function' ? 'updateMain' : typeof installedOriginals.update === 'function' ? 'update' : null;
    if (updateMethod) {
      sceneManagerInstalled[updateMethod] = function () {
        var result = installedOriginals[updateMethod].apply(this, arguments);
        publishActualSceneAfterTransition(0);
        return result;
      };
      global.SceneManager[updateMethod] = sceneManagerInstalled[updateMethod];
    }
  }
  function restoreSceneStateBridge() {
    if (!sceneManagerOriginals || !sceneManagerInstalled || !global.SceneManager) return;
    ['goto', 'push', 'pop', 'changeScene', 'catchException', 'updateMain', 'update'].forEach(function (method) {
      if (sceneManagerInstalled[method] && global.SceneManager[method] === sceneManagerInstalled[method]) global.SceneManager[method] = sceneManagerOriginals[method];
    });
    sceneManagerOriginals = null;
    sceneManagerInstalled = null;
  }
  function restoreSceneBoot() {
    if (!sceneBootOriginalStart || !global.Scene_Boot || !global.Scene_Boot.prototype) return;
    if (global.Scene_Boot.prototype.start === sceneBootInstalledStart) global.Scene_Boot.prototype.start = sceneBootOriginalStart;
    sceneBootOriginalStart = null;
    sceneBootInstalledStart = null;
  }
  function createHostUi(scene) {
    if (!global.PIXI || typeof global.PIXI.Container !== 'function' || !scene || typeof scene.addChild !== 'function') throw new Error('The project PIXI scene container is unavailable.');
    scene._mzuiUiRoot = new global.PIXI.Container();
    scene.addChild(scene._mzuiUiRoot);
  }
  function readyCanvasSize() {
    if (!global.Graphics) throw new Error('The project MV/MZ Graphics host is unavailable.');
    var width = Math.round(Number(global.Graphics.width || global.Graphics.boxWidth || global.Graphics._width || 816));
    var height = Math.round(Number(global.Graphics.height || global.Graphics.boxHeight || global.Graphics._height || 624));
    if (!Number.isSafeInteger(width) || width < 1 || width > 16384 || !Number.isSafeInteger(height) || height < 1 || height > 16384) {
      throw new Error('The project MV/MZ Graphics host reported an invalid canvas size.');
    }
    return { canvasWidth: width, canvasHeight: height };
  }
  function resizeCanvas(scene) {
    var width = Math.max(1, Math.round(Number(scene.meta && scene.meta.canvasWidth) || 816));
    var height = Math.max(1, Math.round(Number(scene.meta && scene.meta.canvasHeight) || 624));
    if (global.Graphics && typeof global.Graphics.resize === 'function') global.Graphics.resize(width, height);
    else if (global.Graphics && global.Graphics._renderer && typeof global.Graphics._renderer.resize === 'function') {
      global.Graphics._width = width; global.Graphics._height = height; global.Graphics._boxWidth = width; global.Graphics._boxHeight = height; global.Graphics._renderer.resize(width, height);
    } else throw new Error('The project MV/MZ Graphics host cannot resize the UI canvas.');
  }
  function currentBounds(nodeIds) { return runtime && typeof runtime.getNodeBounds === 'function' ? runtime.getNodeBounds(nodeIds) : []; }
  function rememberBounds(bounds) {
    (bounds || []).forEach(function (entry) {
      if (entry && entry.nodeId) lastBoundsByNode[entry.nodeId] = JSON.stringify(entry);
    });
  }
  function changedBounds(bounds, force) {
    var changed = [];
    var next = {};
    (bounds || []).forEach(function (entry) {
      if (!entry || !entry.nodeId) return;
      var encoded = JSON.stringify(entry);
      next[entry.nodeId] = encoded;
      if (force || lastBoundsByNode[entry.nodeId] !== encoded) changed.push(entry);
    });
    lastBoundsByNode = next;
    return changed;
  }
  function publishBounds(force) {
    if (!runtime) return;
    var changed = changedBounds(currentBounds(), Boolean(force));
    if (!changed.length) return;
    send('bounds', { revision: activeRevision, bounds: changed }, activeSceneId);
  }
  function mountScene(message) {
    currentStage = 'mount';
    if (!mountReceiptPending) {
      mountReceiptPending = true;
      sendReceipt('mount', 'begin', null);
    }
    pendingMount = message;
    lastMount = message;
    if (message.sceneId !== message.payload.scene.meta.sceneName) throw new Error('Renderer bridge document scene identity does not match the Runtime scene name.');
    activeSceneId = message.sceneId;
    mountedDocumentSceneId = message.payload.documentSceneId;
    documentSceneName = message.payload.scene.meta.sceneName;
    activeRevision = message.payload.revision;
    activeExecutionMode = message.payload.executionMode;
    // A mode switch can remount while the host scene (and its existing
    // Window_Message) is still alive. Re-run the official DataManager
    // lifecycle before full-preview actions can observe the new mode; a
    // pending first mount defers this until Scene_*Host.create below.
    if (hostScene) ensureOfficialGameObjectsForMessageWindow();
    if (!hostScene || !global.MZUIRuntime || !global.SceneManager || global.SceneManager._scene !== hostScene) {
      if (global.SceneManager && typeof global.SceneManager.goto === 'function' && typeof global.Scene_MZUIDesignerCanvasHost === 'function') global.SceneManager.goto(global.Scene_MZUIDesignerCanvasHost);
      return;
    }
    if (runtime && typeof runtime.cleanup === 'function') runtime.cleanup();
    resizeCanvas(message.payload.scene);
    requireSessionStorage(activeExecutionMode === 'authoring');
    runtime = global.MZUIRuntime.create();
    runtime.mount(message.payload.scene, { root: hostScene._mzuiUiRoot, context: { sceneApi: hostScene }, sceneApi: hostScene, executionMode: activeExecutionMode });
    hostScene._mzuiCanvasRuntime = runtime;
    pendingMount = null;
    var mountedBounds = currentBounds();
    lastBoundsByNode = {};
    rememberBounds(mountedBounds);
    sendReceipt('mount', 'success', null);
    mountReceiptPending = false;
    currentStage = 'mounted';
    sendReceipt('mounted', 'begin', null);
    send('mounted', {
      revision: activeRevision,
      executionMode: activeExecutionMode,
      engineSceneClass: sceneName(hostScene) || hostSceneClass,
      mountedDocumentSceneId: mountedDocumentSceneId,
      documentSceneName: documentSceneName,
      bounds: mountedBounds
    }, activeSceneId);
    sendReceipt('mounted', 'success', null);
    publishSceneState('active', activeSceneId);
  }
  function cleanupRuntime() {
    if (runtime && typeof runtime.cleanup === 'function') runtime.cleanup();
    runtime = null;
    if (hostScene) hostScene._mzuiCanvasRuntime = null;
    pendingMount = null;
    lastBoundsByNode = {};
    try { if (global.AudioManager && typeof global.AudioManager.stopAll === 'function') global.AudioManager.stopAll(); } catch (_) {}
    try { if (global.Video && global.Video._element && typeof global.Video._element.pause === 'function') { global.Video._element.pause(); global.Video._element.removeAttribute('src'); global.Video._element.load(); } } catch (_) {}
  }
  function resourcePathMatches(cacheKey, relativePath) {
    var key = String(cacheKey || '').replace(/\\/g, '/').split('?')[0];
    var normalized = String(relativePath || '').replace(/\\/g, '/').split('?')[0];
    return key === normalized || key.slice(-normalized.length) === normalized || key.indexOf(normalized + ':') >= 0;
  }
  function destroyCachedTexture(value) {
    try {
      if (value && value.item) value = value.item;
      if (value && value.bitmap) value = value.bitmap;
      var texture = value && (value.texture || value._texture);
      if (texture && typeof texture.destroy === 'function') texture.destroy(true);
      if (value && value._baseTexture && typeof value._baseTexture.destroy === 'function') value._baseTexture.destroy();
      if (value && value.baseTexture && typeof value.baseTexture.destroy === 'function') value.baseTexture.destroy();
      if (value && typeof value.destroy === 'function') value.destroy();
    } catch (_) {}
  }
  function evictCacheEntries(owner, entries, relativePaths) {
    if (!entries || typeof entries !== 'object') return;
    if (typeof entries.forEach === 'function' && typeof entries.delete === 'function') {
      entries.forEach(function (value, key) {
        if (!relativePaths.some(function (relativePath) { return resourcePathMatches(key, relativePath); })) return;
        destroyCachedTexture(value);
        entries.delete(key);
      });
      return;
    }
    Object.keys(entries).forEach(function (key) {
      if (!relativePaths.some(function (relativePath) { return resourcePathMatches(key, relativePath); })) return;
      var entry = entries[key];
      if (entry && typeof entry.free === 'function') entry.free(true);
      else {
        destroyCachedTexture(entry);
        if (owner && typeof owner.remove === 'function') owner.remove(key);
        else if (owner && typeof owner.delete === 'function') owner.delete(key);
        else delete entries[key];
      }
    });
  }
  function evictObjectCache(cache, relativePaths) {
    if (!cache || typeof cache !== 'object') return;
    var entries = cache._inner && typeof cache._inner === 'object'
      ? cache._inner
      : cache._items && typeof cache._items === 'object'
        ? cache._items
        : cache;
    evictCacheEntries(cache, entries, relativePaths);
  }
  function evictResourceCaches(relativePaths) {
    evictObjectCache(global.ImageManager && global.ImageManager._cache, relativePaths);
    evictObjectCache(global.ImageManager && global.ImageManager._imageCache, relativePaths);
    var utils = global.PIXI && global.PIXI.utils;
    evictObjectCache(utils && utils.TextureCache, relativePaths);
    evictObjectCache(utils && utils.BaseTextureCache, relativePaths);
    if (global.PIXI && global.PIXI.Texture) evictObjectCache(global.PIXI.TextureCache, relativePaths);
    if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.delete === 'function') {
      relativePaths.filter(function (entry) { return /\.(woff2?|ttf|otf)$/i.test(entry); }).forEach(function (entry) {
        var family = 'MZUI_' + entry.replace(/[^A-Za-z0-9_$]/g, '_');
        Array.from(document.fonts).forEach(function (face) { if (face && face.family === family) document.fonts.delete(face); });
        if (global.FontManager && global.FontManager._states) delete global.FontManager._states[family];
        if (global.FontManager && global.FontManager._urls) delete global.FontManager._urls[family];
      });
    }
  }
  function dispose() {
    if (disposed) return;
    cancelActualScenePolling();
    cleanupRuntime();
    lastMount = null;
    send('disposed', {}, activeSceneId);
    disposed = true;
    global.removeEventListener('message', onMessage);
    global.removeEventListener('error', onWindowError);
    global.removeEventListener('unhandledrejection', onUnhandledRejection);
    global.removeEventListener('beforeunload', dispose);
    global.removeEventListener('keydown', onPreviewExitKey, true);
    try { if (global.MZUIRuntime && typeof global.MZUIRuntime.configure === 'function') global.MZUIRuntime.configure({ contextProvider: null, onError: null }); } catch (_) {}
    restoreSceneStateBridge();
    restoreSceneBoot();
    try {
      var storage = global.__mzuiSessionStorage;
      if (storage && storage.sessionId === config.sessionId && storage.generation === config.generation) {
        if (typeof storage.clear === 'function') storage.clear();
        if (typeof storage.restore === 'function') storage.restore();
      }
    } catch (_) {}
    try { if (global.SceneManager && typeof global.SceneManager.stop === 'function') global.SceneManager.stop(); } catch (_) {}
    try { if (global.Graphics && global.Graphics.app && typeof global.Graphics.app.stop === 'function') global.Graphics.app.stop(); } catch (_) {}
  }
  function onMessage(event) {
    if (event.source !== global.parent || disposed) return;
    try {
      var message = validate(event.data, 'incoming');
      if (message.sequence <= incomingSequence) throw new Error('Renderer bridge message sequence is stale.');
      incomingSequence = message.sequence;
      if (message.kind === 'mount' || message.kind === 'patch') currentStage = 'mount';
      if (message.kind === 'mount') {
        if (message.payload.revision <= activeRevision) throw new Error('Renderer bridge mount revision is stale.');
        mountScene(message);
      }
      else if (message.kind === 'patch') {
        if (!runtime || message.sceneId !== activeSceneId || message.payload.revision <= activeRevision) throw new Error('Renderer bridge patch does not target the active revision.');
        activeRevision = message.payload.revision;
        var bounds = runtime.patchNodes(message.payload.nodes);
        rememberBounds(bounds);
        send('bounds', { revision: activeRevision, bounds: bounds }, activeSceneId);
      } else if (message.kind === 'resource-refresh') {
        if (!lastMount || message.sceneId !== activeSceneId || message.payload.revision <= activeRevision) throw new Error('Renderer bridge resource refresh does not target the active revision.');
        activeRevision = message.payload.revision;
        evictResourceCaches(message.payload.relativePaths);
        var remount = JSON.parse(JSON.stringify(lastMount));
        remount.sequence = message.sequence;
        remount.payload.revision = activeRevision;
        mountScene(remount);
      } else if (message.kind === 'select') {
        if (runtime) runtime.selectedNodeIds = message.payload.nodeIds.slice();
      } else if (message.kind === 'input') {
        if (runtime && typeof runtime.handleRendererInput === 'function') runtime.handleRendererInput(message.payload);
        publishBounds(false);
      } else if (message.kind === 'dispose') dispose();
      else throw new Error('Renderer host cannot consume message kind: ' + message.kind);
    } catch (error) {
      if (!fatalSent) {
        diagnostic(error, { code: 'UI_RENDERER_BRIDGE_PROTOCOL', phase: currentStage });
        fatal(currentStage, 'UI_RENDERER_BRIDGE_PROTOCOL', 'The isolated UI renderer rejected a stale or invalid protocol message.');
      }
    }
  }
  function onWindowError(event) { if (fatalSent) return; diagnostic(event.error || event.message || 'Renderer host error', { phase: currentStage, code: 'UI_RENDERER_WINDOW_ERROR' }); fatal(currentStage, 'UI_RENDERER_WINDOW_ERROR', 'The isolated UI renderer reported a bounded window error.'); }
  function onUnhandledRejection(event) { if (fatalSent) return; diagnostic(event.reason || 'Renderer host promise rejection', { phase: currentStage, code: 'UI_RENDERER_PROMISE_ERROR' }); fatal(currentStage, 'UI_RENDERER_PROMISE_ERROR', 'The isolated UI renderer reported a bounded promise error.'); }
  function onPreviewExitKey(event) {
    if (activeExecutionMode !== 'full-preview' || !event || (event.key !== 'Escape' && event.key !== 'F6')) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    send('exit-request', { key: event.key }, activeSceneId);
  }

  function installScene() {
    if (typeof global.Scene_Base !== 'function') throw new Error('The project MV/MZ Scene_Base host is unavailable.');
    var hostBase = engineName() === 'MZ' ? global.Scene_Message : global.Scene_Base;
    if (typeof hostBase !== 'function') throw new Error('The project MV/MZ message scene host is unavailable.');
    function Scene_MZUIDesignerCanvasHost() { this.initialize.apply(this, arguments); }
    Scene_MZUIDesignerCanvasHost.prototype = Object.create(hostBase.prototype);
    Scene_MZUIDesignerCanvasHost.prototype.constructor = Scene_MZUIDesignerCanvasHost;
    Scene_MZUIDesignerCanvasHost.prototype.initialize = function () { hostBase.prototype.initialize.call(this); this._mzuiCanvasRuntime = null; this._mzuiUiRoot = null; };
    Scene_MZUIDesignerCanvasHost.prototype.create = function () {
      var scene = this;
      currentStage = 'ready';
      sendReceipt('ready', 'begin', null);
      runStageStep('ready', 'UI_RENDERER_READY_SCENE_CREATE', 'scene-create', 'The isolated UI renderer could not create its official host scene.', function () { hostBase.prototype.create.call(scene); });
      hostScene = scene;
      runStageStep('ready', 'UI_RENDERER_READY_CANVAS_HOST', 'canvas-host', 'The isolated UI renderer could not create its canvas host.', function () { createHostUi(scene); });
      runStageStep('ready', 'UI_RENDERER_READY_SIGNAL', 'ready-signal', 'The isolated UI renderer could not publish its ready capability.', function () {
        send('ready', Object.assign(readyCanvasSize(), { engineSceneClass: sceneName(scene) || hostSceneClass }), activeSceneId);
      });
      sendReceipt('ready', 'success', null);
      if (pendingMount) mountScene(pendingMount);
      else if (lastMount) mountScene(lastMount);
      publishSceneState('active', activeSceneId);
    };
    Scene_MZUIDesignerCanvasHost.prototype.update = function () {
      global.Scene_Base.prototype.update.call(this);
      if (this._mzuiCanvasRuntime) this._mzuiCanvasRuntime.update();
    };
    Scene_MZUIDesignerCanvasHost.prototype.terminate = function () { cleanupRuntime(); hostScene = null; hostBase.prototype.terminate.call(this); };
    global.Scene_MZUIDesignerCanvasHost = Scene_MZUIDesignerCanvasHost;
    var originalStart = global.Scene_Boot && global.Scene_Boot.prototype.start;
    if (!originalStart) throw new Error('The project MV/MZ Scene_Boot host is unavailable.');
    sceneBootOriginalStart = originalStart;
    sceneBootInstalledStart = global.Scene_Boot.prototype.start = function () { originalStart.apply(this, arguments); global.SceneManager.goto(Scene_MZUIDesignerCanvasHost); };
  }

  try {
    sendReceipt('iframe-load', 'begin', null);
    currentStage = 'entry-invoked';
    sendReceipt('entry-invoked', 'begin', null);
    global.addEventListener('message', onMessage);
    global.addEventListener('error', onWindowError);
    global.addEventListener('unhandledrejection', onUnhandledRejection);
    global.addEventListener('beforeunload', dispose);
    global.addEventListener('keydown', onPreviewExitKey, true);
    if (!global.MZUIRuntime || typeof global.MZUIRuntime.create !== 'function') throw new Error('The shared MZUIRuntime is unavailable.');
    requireSessionStorage(false);
    global.MZUIRuntime.configure({
      contextProvider: function () { return { actions: previewActions() }; },
      onError: function (entry) { diagnostic(entry && entry.message ? entry.message : 'MZUIRuntime error', entry || {}); }
    });
    installSceneStateBridge();
    installScene();
    currentStage = 'hello';
    sendReceipt('hello', 'begin', null);
    send('hello', { engine: engineName(), engineVersion: global.Utils && global.Utils.RPGMAKER_VERSION ? String(global.Utils.RPGMAKER_VERSION) : null, pixiVersion: global.PIXI && global.PIXI.VERSION ? String(global.PIXI.VERSION) : '', runtimeVersion: String(global.MZUIRuntime.VERSION || global.MZUIRuntime.version || '') }, activeSceneId);
    sendReceipt('hello', 'success', null);
    sendReceipt('entry-invoked', 'success', null);
    sendReceipt('iframe-load', 'success', null);
  } catch (error) {
    diagnostic(error, { code: 'UI_RENDERER_BOOT_FAILED', phase: currentStage });
    fatal(currentStage, 'UI_RENDERER_BOOT_FAILED', 'The isolated UI renderer could not complete its boot stage.');
  }
}(window));
`
}
