import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, beforeEach, test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { bootstrapDatabase } from '../db/bootstrap.ts'
import { closeDatabase } from '../db/pool.ts'
import {
  UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH,
  UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
  UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
  UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH,
  UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
  UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH,
  UiDesignerPreviewBusyError,
  UiDesignerPreviewSceneConflictError,
  UiDesignerPreviewService,
  type UiDesignerPreviewLauncher,
  waitForPreviewSceneReadiness,
} from './ui-designer-preview-service.ts'

let tempRoot = ''

const createPreviewService = (
  launcher: Omit<UiDesignerPreviewLauncher, 'captureFailureEvidence'> & Partial<Pick<UiDesignerPreviewLauncher, 'captureFailureEvidence'>>,
  preparation?: ConstructorParameters<typeof UiDesignerPreviewService>[1],
) => new UiDesignerPreviewService({
  ...launcher,
  captureFailureEvidence: launcher.captureFailureEvidence || (() => undefined),
}, preparation, async (session, expectedScene) => {
  fs.writeFileSync(path.join(path.dirname(session.diagnosticsPath), '.ui-designer-engine-entry.json'), JSON.stringify({
    schemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
    sessionId: session.sessionId,
    phase: 'engine-entry-loaded',
  }), 'utf8')
  return { status: 'ready', expectedScene, actualScene: expectedScene }
})

const previewScene = (sceneName: string) => ({
  version: '1.1.0', runtimeVersion: '>=1.1.0',
  meta: { sceneName, sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
  transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
  globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
}) as any

const writeMinimalMvEngineEntry = (resourceRoot: string, projectRoot = resourceRoot) => {
  fs.writeFileSync(path.join(resourceRoot, 'index.html'), [
    '<!doctype html>',
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">',
    '<script type="text/javascript" src="js/rpg_managers.js"></script>',
    '<script type="text/javascript" src="js/rpg_scenes.js"></script>',
    '<script type="text/javascript" src="js/plugins.js"></script>',
    '<script type="text/javascript" src="js/main.js"></script>',
  ].join('\n'), 'utf8')
  fs.writeFileSync(path.join(resourceRoot, 'js', 'main.js'), [
    'PluginManager.setup($plugins);',
    'window.onload = function() {',
    '    SceneManager.run(Scene_Boot);',
    '};',
  ].join('\n'), 'utf8')
  const main = path.relative(projectRoot, path.join(resourceRoot, 'index.html')).replace(/\\/g, '/')
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ main }), 'utf8')
}

const createMinimalMvProject = (name: string) => {
  const project = path.join(tempRoot, name)
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(project)
  return project
}

const createMinimalMvWwwProject = (name: string) => {
  const project = path.join(tempRoot, name)
  const resourceRoot = path.join(project, 'www')
  fs.mkdirSync(path.join(resourceRoot, 'data'), { recursive: true })
  fs.mkdirSync(path.join(resourceRoot, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(resourceRoot, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(resourceRoot, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(resourceRoot, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(resourceRoot, project)
  return project
}

const createMinimalMzProject = (name: string) => {
  const project = path.join(tempRoot, name)
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'game.rmmzproject'), 'RPGMZ 1.10.0', 'utf8')
  fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html>', 'utf8')
  fs.writeFileSync(path.join(project, 'package.json'), '{"main":"index.html"}', 'utf8')
  for (const fileName of ['rmmz_managers.js', 'rmmz_objects.js', 'rmmz_scenes.js', 'rmmz_sprites.js', 'rmmz_windows.js']) {
    fs.writeFileSync(path.join(project, 'js', fileName), '', 'utf8')
  }
  fs.writeFileSync(path.join(project, 'js', 'main.js'), [
    'const scriptUrls = [',
    '    "js/rmmz_core.js",',
    '    "js/rmmz_managers.js",',
    '    "js/rmmz_objects.js",',
    '    "js/rmmz_scenes.js",',
    '    "js/rmmz_sprites.js",',
    '    "js/rmmz_windows.js",',
    '    "js/plugins.js"',
    '];',
    'const main = {',
    '    loadCount: 0,',
    '    onLoad() { if (++this.loadCount === this.numScripts) this.onEffekseerLoad(); },',
    '    run() {',
    '        this.loadCount = 0;',
    '        this.numScripts = scriptUrls.length;',
    '        for (const scriptUrl of scriptUrls) {',
    '            const script = document.createElement("script");',
    '            script.src = scriptUrl;',
    '            script.async = false;',
    '            script.onload = this.onLoad.bind(this);',
    '            document.body.appendChild(script);',
    '        }',
    '    }',
    '};',
    'main.run();',
  ].join('\n'), 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'rmmz_core.js'), 'Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "1.10.0";\n', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), JSON.stringify({
    switches: [null], variables: [null], gameTitle: 'Sample', tileSize: 48, faceSize: 144, iconSize: 32,
    advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 },
  }), 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  return project
}

beforeEach(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-designer-preview-'))
  await bootstrapDatabase(tempRoot, { skipWorkspaceLegacyCleanup: true, skipRuntimeLegacyCleanup: true, pruneExpiredSessions: false })
})

afterEach(() => {
  closeDatabase()
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = ''
})

test('stages a UI scene/runtime, launches the isolated runner, and cleans up without touching source', async () => {
  const project = path.join(tempRoot, 'sample-project')
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'img'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'img', 'source.png'), 'source-image', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(project)
  let launchCount = 0
  let stopCount = 0
  let runnerStatus = 'running'
  let ordinaryCollision = false
  let launchedProfileDirectory = ''
  const service = createPreviewService({
    async start(projectRoot, options) {
      launchCount += 1
      assert.ok(fs.existsSync(path.join(projectRoot, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js')))
      const enginePlugins = fs.readFileSync(path.join(projectRoot, 'js', 'plugins.js'), 'utf8')
      assert.doesNotMatch(enginePlugins, /MZUIRuntime|MZUIDesignerPreviewBoot/)
      const engineEntry = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8')
      assert.match(engineEntry, /Content-Security-Policy/)
      assert.doesNotMatch(engineEntry, /__mzuiPreviewEngineEntryReceipt/)
      const pluginsIndex = engineEntry.indexOf('js/plugins.js')
      const entryIndex = engineEntry.indexOf('js/plugins/MZUIDesignerPreviewEntry.js')
      const runtimeIndex = engineEntry.indexOf('js/plugins/MZUIRuntime.js')
      const bootIndex = engineEntry.indexOf('js/plugins/MZUIDesignerPreviewBoot.js')
      const mainIndex = engineEntry.indexOf('js/main.js')
      assert.ok(pluginsIndex >= 0 && entryIndex > pluginsIndex)
      assert.ok(runtimeIndex > entryIndex)
      assert.ok(bootIndex > runtimeIndex)
      assert.ok(mainIndex > bootIndex)
      assert.equal(engineEntry.slice(0, pluginsIndex).includes('MZUIDesignerPreviewEntry'), false)
      assert.equal((engineEntry.match(/js\/plugins\/MZUIDesignerPreviewEntry\.js/g) || []).length, 1)
      const packageValue = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as Record<string, any>
      assert.equal(packageValue['single-instance'], false)
      assert.match(String(packageValue.name), /^rpg-agent-ui-preview-[a-f0-9]{20}$/)
      assert.equal(Object.hasOwn(packageValue, 'inject_js_start'), false)
      assert.equal(Object.hasOwn(packageValue.window, 'inject_js_start'), false)
      assert.equal(options.sourceProject, project)
      assert.equal(options.evidence.paths.engineEntry, 'js/plugins/mzui-data/.ui-designer-engine-entry.json')
      assert.equal(options.evidence.paths.loadState, UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH)
      assert.equal(options.evidence.schemas.engineEntry, UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION)
      assert.equal(options.evidence.application.entryRelativePath, 'js/plugins/MZUIDesignerPreviewEntry.js')
      assert.equal(options.evidence.application.activePackageMain, 'index.html')
      assert.equal(options.evidence.application.uniqueNameValid, true)
      assert.equal(Object.values(options.evidence.application.digests).every((value) => /^[a-f0-9]{64}$/.test(value)), true)
      assert.equal(path.dirname(options.profileDirectory), projectRoot)
      launchedProfileDirectory = options.profileDirectory
      const entryPath = path.join(projectRoot, ...options.evidence.application.entryRelativePath.split('/'))
      const engineEntryReceiptPath = path.join(projectRoot, ...options.evidence.paths.engineEntry.split('/'))
      assert.equal(fs.existsSync(entryPath), true)
      assert.equal(fs.existsSync(engineEntryReceiptPath), false)
      const entrySource = fs.readFileSync(entryPath, 'utf8')
      assert.doesNotMatch(entrySource, /SceneManager|PIXI|MZUIRuntime\.(?:configure|scanScenes|mount)/)
      const unrelatedRoot = path.join(tempRoot, 'unrelated receipt root')
      fs.mkdirSync(path.join(unrelatedRoot, 'js', 'plugins', 'mzui-data'), { recursive: true })
      fs.mkdirSync(path.join(unrelatedRoot, 'data'), { recursive: true })
      const unrelatedUrl = pathToFileURL(path.join(unrelatedRoot, 'index.html'))
      const unrelatedLocation = { protocol: unrelatedUrl.protocol, pathname: unrelatedUrl.pathname, href: unrelatedUrl.href }
      let invokedObservedBeforeDocumentValidation = false
      const unrelatedContext: Record<string, unknown> = {
        get document() {
          const invoked = JSON.parse(fs.readFileSync(engineEntryReceiptPath, 'utf8')) as Record<string, unknown>
          invokedObservedBeforeDocumentValidation = invoked.phase === 'entry-invoked'
          return { location: unrelatedLocation }
        },
        location: unrelatedLocation,
        require(name: string) {
          if (name === 'fs') return fs
          if (name === 'path') return path
          throw new Error(`unexpected module: ${name}`)
        },
      }
      unrelatedContext.window = unrelatedContext
      vm.runInNewContext(entrySource, unrelatedContext, { filename: 'MZUIDesignerPreviewEngineEntry-WrongRoot.js' })
      assert.equal(fs.existsSync(path.join(unrelatedRoot, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/'))), false)
      assert.equal(invokedObservedBeforeDocumentValidation, true)
      assert.deepEqual(JSON.parse(fs.readFileSync(engineEntryReceiptPath, 'utf8')), {
        schemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
        sessionId: options.sessionId,
        phase: 'entry-failed',
        stage: 'document-root',
      })
      assert.equal(fs.existsSync(`${engineEntryReceiptPath}.tmp`), false)
      const appUrl = pathToFileURL(path.join(projectRoot, 'index.html'))
      const location = { protocol: appUrl.protocol, pathname: appUrl.pathname, href: appUrl.href }
      const receiptContext: Record<string, unknown> = {
        console,
        document: { location },
        location,
        addEventListener() {},
        require(name: string) {
          if (name === 'fs') return fs
          if (name === 'path') return path
          throw new Error(`unexpected module: ${name}`)
        },
      }
      receiptContext.window = receiptContext
      vm.runInNewContext(entrySource, receiptContext, { filename: 'MZUIDesignerPreviewEngineEntry-MV.js' })
      const engineEntryReceipt = JSON.parse(fs.readFileSync(engineEntryReceiptPath, 'utf8')) as Record<string, unknown>
      assert.equal(engineEntryReceipt.schemaVersion, UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION)
      assert.equal(engineEntryReceipt.sessionId, options.sessionId)
      assert.equal(engineEntryReceipt.phase, 'engine-entry-loaded')
      const loadState = JSON.parse(fs.readFileSync(path.join(projectRoot, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/')), 'utf8')) as Record<string, unknown>
      assert.equal(loadState.sessionId, options?.sessionId)
      assert.equal(loadState.phase, 'engine-entry-loaded')
      assert.equal(fs.existsSync(path.join(projectRoot, 'js', 'plugins', 'plugins.js')), false)
      return ordinaryCollision
        ? { run: { runId: 'ordinary-run', sessionId: 'ordinary-session', status: 'running' } }
        : { run: { runId: options?.sessionId || 'preview-run', sessionId: options?.sessionId, status: 'running' } }
    },
    async stop() {
      stopCount += 1
      runnerStatus = 'stopped'
      return { run: { status: 'stopped' } }
    },
    async current() {
      return { run: { status: runnerStatus } }
    },
  })
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Sample', sceneBase: 'Scene_Base', canvasWidth: 815.6, canvasHeight: 623.5, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  const started = await service.start(tempRoot, project, scene)
  assert.equal(started.state, 'running')
  assert.equal(started.projectCompatibility?.engine, 'MV')
  assert.equal(started.projectCompatibility?.engineVersionSupported, true)
  assert.deepEqual(started.sceneHandshake, { status: 'ready', expectedScene: 'Scene_Sample', actualScene: 'Scene_Sample' })
  assert.equal(launchCount, 1)
  assert.ok(started.temporaryPath)
  assert.ok(fs.existsSync(launchedProfileDirectory))
  assert.equal(path.dirname(launchedProfileDirectory), started.temporaryPath)
  assert.ok(fs.existsSync(path.join(started.temporaryPath!, 'js', 'plugins', 'MZUIRuntime.js')))
  const stagedScenePath = path.join(started.temporaryPath!, 'js', 'plugins', 'mzui-data', 'Scene_Sample.json')
  assert.ok(fs.existsSync(stagedScenePath))
  const stagedScene = JSON.parse(fs.readFileSync(stagedScenePath, 'utf8')) as { meta: { canvasWidth: number; canvasHeight: number } }
  assert.deepEqual([stagedScene.meta.canvasWidth, stagedScene.meta.canvasHeight], [816, 624])
  assert.equal(fs.lstatSync(path.join(started.temporaryPath!, 'img')).isSymbolicLink(), false)
  fs.writeFileSync(path.join(started.temporaryPath!, 'img', 'source.png'), 'preview-edit', 'utf8')
  assert.equal(fs.readFileSync(path.join(project, 'img', 'source.png'), 'utf8'), 'source-image')
  const bootstrap = fs.readFileSync(path.join(started.temporaryPath!, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js'), 'utf8')
  assert.match(bootstrap, /MZUIRuntime\.isRegistered/)
  assert.match(bootstrap, /MZUIRuntime\.configure/)
  assert.match(bootstrap, /SceneManager\.goto/)
  const marker = JSON.parse(fs.readFileSync(path.join(started.temporaryPath!, 'js', 'plugins', 'mzui-data', '.ui-designer-preview.json'), 'utf8')) as Record<string, unknown>
  assert.equal(marker.sessionId, started.sessionId)
  assert.equal(marker.schemaVersion, UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION)
  assert.equal(marker.diagnosticsPath, UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH)
  assert.ok(!fs.existsSync(path.join(project, 'js', 'plugins', 'MZUIRuntime.js')))
  await assert.rejects(() => service.start(tempRoot, project, scene), (error: unknown) => error instanceof UiDesignerPreviewBusyError)
  const stopped = await service.stop(started.sessionId)
  assert.equal(stopped.state, 'stopped')
  assert.equal(stopCount, 1)
  assert.equal(fs.existsSync(started.temporaryPath!), false)
  assert.equal(fs.existsSync(launchedProfileDirectory), false)
  ordinaryCollision = true
  const collided = await service.start(tempRoot, project, scene)
  assert.equal(collided.state, 'error')
  assert.equal(collided.cleanup?.ok, true)
  assert.equal(stopCount, 1)
})

test('records only bounded engine-entry failure stages before Runtime and Boot load', async () => {
  const project = createMinimalMvProject('entry-stage-project')
  const service = createPreviewService({
    async start(projectRoot, options) {
      const entryPath = path.join(projectRoot, ...options.evidence.application.entryRelativePath.split('/'))
      const receiptPath = path.join(projectRoot, ...options.evidence.paths.engineEntry.split('/'))
      const loadStatePath = path.join(projectRoot, ...options.evidence.paths.loadState.split('/'))
      const markerPath = path.join(path.dirname(receiptPath), '.ui-designer-preview.json')
      const markerSource = fs.readFileSync(markerPath, 'utf8')
      const entrySource = fs.readFileSync(entryPath, 'utf8')
      const appUrl = pathToFileURL(path.join(projectRoot, 'index.html'))
      const validLocation = { protocol: appUrl.protocol, pathname: appUrl.pathname, href: appUrl.href }
      const execute = (
        expectedStage: 'node-api' | 'document-url' | 'document-root' | 'targets' | 'session-marker' | 'session-boundary',
        context: Record<string, unknown>,
      ) => {
        fs.rmSync(receiptPath, { force: true })
        fs.rmSync(`${receiptPath}.tmp`, { force: true })
        context.window = context
        vm.runInNewContext(entrySource, context, { filename: `MZUIDesignerPreviewEntry-${expectedStage}.js` })
        assert.deepEqual(JSON.parse(fs.readFileSync(receiptPath, 'utf8')), {
          schemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
          sessionId: options.sessionId,
          phase: 'entry-failed',
          stage: expectedStage,
        })
        assert.equal(fs.existsSync(`${receiptPath}.tmp`), false)
      }
      const moduleRequire = (pathModule: typeof path = path) => (name: string) => {
        if (name === 'fs') return fs
        if (name === 'path') return pathModule
        throw new Error(`unexpected module: ${name}`)
      }
      const incompletePath = Object.create(path) as typeof path
      Object.defineProperty(incompletePath, 'basename', { value: undefined })
      execute('node-api', { document: { location: validLocation }, location: validLocation, require: moduleRequire(incompletePath) })
      execute('document-url', { require: moduleRequire() })

      const unrelatedRoot = path.join(tempRoot, 'entry-stage-unrelated-root')
      fs.mkdirSync(path.join(unrelatedRoot, 'data'), { recursive: true })
      fs.mkdirSync(path.join(unrelatedRoot, 'js', 'plugins'), { recursive: true })
      const unrelatedUrl = pathToFileURL(path.join(unrelatedRoot, 'index.html'))
      const unrelatedLocation = { protocol: unrelatedUrl.protocol, pathname: unrelatedUrl.pathname, href: unrelatedUrl.href }
      execute('document-root', { document: { location: unrelatedLocation }, location: unrelatedLocation, require: moduleRequire() })

      fs.mkdirSync(loadStatePath)
      execute('targets', { document: { location: validLocation }, location: validLocation, require: moduleRequire() })
      fs.rmSync(loadStatePath, { recursive: true })

      fs.writeFileSync(markerPath, '{invalid-marker', 'utf8')
      execute('session-marker', { document: { location: validLocation }, location: validLocation, require: moduleRequire() })
      const mismatchedMarker = JSON.parse(markerSource) as Record<string, unknown>
      mismatchedMarker.sessionId = 'another-session'
      fs.writeFileSync(markerPath, JSON.stringify(mismatchedMarker), 'utf8')
      execute('session-boundary', { document: { location: validLocation }, location: validLocation, require: moduleRequire() })
      fs.writeFileSync(markerPath, markerSource, 'utf8')
      return { run: { runId: options.sessionId, sessionId: options.sessionId, status: 'running' } }
    },
    async stop() { return { run: { status: 'stopped' } } },
    async current() { return { run: { status: 'running' } } },
  })
  const started = await service.start(tempRoot, project, previewScene('Scene_EntryStages'))
  assert.equal(started.state, 'running')
  assert.equal((await service.stop(started.sessionId)).state, 'stopped')
})

test('stages preview runtime and boot inside the MZ main-script load barrier', async () => {
  const project = createMinimalMzProject('sample-mz-project')
  const projectPluginNames = Array.from({ length: 118 }, (_, index) => `SamplePlugin${String(index + 1).padStart(3, '0')}`)
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), `var $plugins =\n${JSON.stringify(projectPluginNames.map((name) => ({
    name,
    status: true,
    description: 'Neutral project plugin fixture',
    parameters: {},
  })), null, 2)};\n`, 'utf8')
  const sourcePlugins = fs.readFileSync(path.join(project, 'js', 'plugins.js'), 'utf8')
  let launchedProject = ''
  const service = createPreviewService({
    async start(projectRoot, options) {
      launchedProject = projectRoot
      const enginePluginsPath = path.join(projectRoot, 'js', 'plugins.js')
      const enginePlugins = fs.readFileSync(enginePluginsPath, 'utf8')
      const plugins = JSON.parse(enginePlugins.slice(enginePlugins.indexOf('['), enginePlugins.lastIndexOf(']') + 1)) as Array<{ name: string; status: boolean; parameters?: Record<string, string> }>
      assert.equal(plugins.some((entry) => (
        entry.name === 'MZUIDesignerPreviewEntry'
        || entry.name === 'MZUIRuntime'
        || entry.name === 'MZUIDesignerPreviewBoot'
      )), false)
      assert.deepEqual(plugins.map((entry) => entry.name), projectPluginNames)
      const mainSource = fs.readFileSync(path.join(projectRoot, 'js', 'main.js'), 'utf8')
      assert.doesNotMatch(mainSource, /__mzuiPreviewEngineEntryReceipt/)
      const entryIndex = mainSource.indexOf('js/plugins/MZUIDesignerPreviewEntry.js')
      const runtimeIndex = mainSource.indexOf('js/plugins/MZUIRuntime.js')
      const bootstrapIndex = mainSource.indexOf('js/plugins/MZUIDesignerPreviewBoot.js')
      const projectPluginsIndex = mainSource.indexOf('js/plugins.js')
      assert.ok(entryIndex >= 0)
      assert.ok(runtimeIndex > entryIndex)
      assert.ok(bootstrapIndex > runtimeIndex)
      assert.ok(projectPluginsIndex > bootstrapIndex)
      assert.equal(fs.existsSync(path.join(projectRoot, 'js', 'plugins', 'plugins.js')), false)
      assert.ok(fs.existsSync(path.join(projectRoot, 'js', 'plugins', 'MZUIDesignerPreviewEntry.js')))
      assert.ok(fs.existsSync(path.join(projectRoot, 'js', 'plugins', 'MZUIRuntime.js')))
      const bootstrapPath = path.join(projectRoot, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js')
      assert.ok(fs.existsSync(bootstrapPath))
      const bootstrap = fs.readFileSync(bootstrapPath, 'utf8')
      const externalRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-preview-external-runtime-'))
      try {
        function SceneBoot(this: unknown) { /* engine fixture */ }
        SceneBoot.prototype.start = () => undefined
        function PreviewScene(this: { created?: boolean }) { this.created = false }
        PreviewScene.prototype.create = function () { this.created = true }
        const appUrl = pathToFileURL(path.join(projectRoot, 'index.html'))
        const location = { protocol: appUrl.protocol, pathname: appUrl.pathname, href: appUrl.href }
        const runtime = {
          resolveEngineRoot: () => projectRoot,
          configure: () => runtime,
          isRegistered: (sceneName: string) => sceneName === 'Scene_MzPreview',
          scanScenes: () => { throw new Error('registered preview scene must not rescan') },
        }
        const sceneManager: any = {
          run(startScene) { this._pendingScene = startScene },
          goto(target) { this._scene = new target(); this._scene.create() },
        }
        const globalHandlers = new Map<string, (event: Record<string, unknown>) => void>()
        const context: Record<string, unknown> = {
          console,
          document: { location },
          location,
          addEventListener(type: string, listener: (event: Record<string, unknown>) => void) { globalHandlers.set(type, listener) },
          MZUIRuntime: runtime,
          Scene_Boot: SceneBoot,
          Scene_MzPreview: PreviewScene,
          SceneManager: sceneManager,
          process: { cwd: () => externalRuntime },
          require(name: string) {
            if (name === 'fs') return fs
            if (name === 'path') return path
            throw new Error(`unexpected module: ${name}`)
          },
        }
        context.window = context
        const packageValue = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as Record<string, any>
        assert.equal(Object.hasOwn(packageValue, 'inject_js_start'), false)
        assert.equal(Object.hasOwn(packageValue.window, 'inject_js_start'), false)
        assert.equal(path.dirname(options.profileDirectory), projectRoot)
        const receiptPath = path.join(projectRoot, ...options.evidence.paths.engineEntry.split('/'))
        const entrySource = fs.readFileSync(path.join(projectRoot, ...options.evidence.application.entryRelativePath.split('/')), 'utf8')
        assert.equal(fs.existsSync(receiptPath), false)
        vm.runInNewContext(entrySource, context, { filename: 'MZUIDesignerPreviewEngineEntry.js' })
        assert.equal(fs.existsSync(receiptPath), true)
        vm.runInNewContext(bootstrap, context, { filename: 'MZUIDesignerPreviewBoot.js' })
        globalHandlers.get('error')?.({
          message: 'Runtime resource load failed.',
          target: { tagName: 'SCRIPT', src: path.join(projectRoot, 'js', 'plugins', 'MZUIRuntime.js') },
        })
        globalHandlers.get('error')?.({
          message: 'Boot resource load failed.',
          target: { tagName: 'SCRIPT', src: path.join(projectRoot, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js') },
        })
        const diagnosticsPath = path.join(projectRoot, ...UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH.split('/'))
        const diagnosticRecords = fs.readFileSync(diagnosticsPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
        const loadError = diagnosticRecords[0]
        assert.equal(loadError.code, 'UI_PREVIEW_SCRIPT_LOAD_ERROR')
        assert.equal(loadError.file, 'MZUIRuntime.js')
        assert.equal(diagnosticRecords[1].code, 'UI_PREVIEW_SCRIPT_LOAD_ERROR')
        assert.equal(diagnosticRecords[1].file, 'MZUIDesignerPreviewBoot.js')
        assert.doesNotMatch(JSON.stringify(loadError), new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
        let overwrittenBootStartCalls = 0
        let overwrittenRunCalls = 0
        ;(context.SceneManager as any).run = function (startScene: unknown) { overwrittenRunCalls += 1; this._pendingScene = startScene }
        ;(context.SceneManager as any).run(context.Scene_Boot)
        ;(context.Scene_Boot as any).prototype.start = function () { overwrittenBootStartCalls += 1 }
        const bootScene = new (context.SceneManager as any)._pendingScene()
        bootScene.start()
        assert.equal(overwrittenRunCalls, 1)
        assert.equal(overwrittenBootStartCalls, 1)
        const handshakePath = path.join(projectRoot, ...UI_DESIGNER_PREVIEW_SCENE_HANDSHAKE_RELATIVE_PATH.split('/'))
        const handshake = JSON.parse(fs.readFileSync(handshakePath, 'utf8')) as Record<string, unknown>
        assert.equal(handshake.status, 'ready')
        assert.equal(handshake.expectedScene, 'Scene_MzPreview')
        assert.equal(handshake.actualScene, 'Scene_MzPreview')
        const loadStatePath = path.join(projectRoot, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/'))
        const loadState = JSON.parse(fs.readFileSync(loadStatePath, 'utf8')) as Record<string, unknown>
        assert.equal(loadState.sessionId, options?.sessionId)
        assert.equal(loadState.phase, 'scene-ready')

        const invalidAppUrl = pathToFileURL(path.join(externalRuntime, 'index.html'))
        const invalidLocation = { protocol: invalidAppUrl.protocol, pathname: invalidAppUrl.pathname, href: invalidAppUrl.href }
        const invalidEntryContext: Record<string, unknown> = {
          document: { location: invalidLocation },
          location: invalidLocation,
          require: context.require,
        }
        invalidEntryContext.window = invalidEntryContext
        vm.runInNewContext(entrySource, invalidEntryContext, { filename: 'MZUIDesignerPreviewEngineEntry-invalid-root.js' })
        assert.deepEqual(JSON.parse(fs.readFileSync(receiptPath, 'utf8')), {
          schemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
          sessionId: options.sessionId,
          phase: 'entry-failed',
          stage: 'document-root',
        })

        const bootstrapErrors: string[] = []
        const failedContext: Record<string, unknown> = {
          console: { error: (...values: unknown[]) => bootstrapErrors.push(values.map(String).join(' ')) },
          MZUIRuntime: { resolveEngineRoot: () => { throw new Error('App document root unavailable.') } },
          process: { cwd: () => externalRuntime },
          require: context.require,
        }
        failedContext.window = failedContext
        vm.runInNewContext(bootstrap, failedContext, { filename: 'MZUIDesignerPreviewBoot-no-root.js' })
        assert.match(bootstrapErrors.join('\n'), /UI_PREVIEW_MARKER_UNAVAILABLE/)
        assert.doesNotMatch(bootstrapErrors.join('\n'), new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
      } finally {
        fs.rmSync(externalRuntime, { recursive: true, force: true })
      }
      return { run: { runId: options?.sessionId || 'mz-preview-run', sessionId: options?.sessionId, status: 'running' } }
    },
    async stop() { return { run: { status: 'stopped' } } },
    async current() { return { run: { status: 'running' } } },
  })

  const started = await service.start(tempRoot, project, previewScene('Scene_MzPreview'))
  assert.equal(started.state, 'running', JSON.stringify(started))
  assert.equal(started.projectCompatibility?.engine, 'MZ')
  assert.ok(started.temporaryPath)
  assert.equal(launchedProject, started.temporaryPath)
  assert.equal(started.stagingSummary?.affectedFiles.includes('js/plugins.js'), true)
  assert.equal(started.stagingSummary?.affectedFiles.includes('js/plugins/plugins.js'), false)
  assert.equal(fs.readFileSync(path.join(project, 'js', 'plugins.js'), 'utf8'), sourcePlugins)
  const stopped = await service.stop(started.sessionId)
  assert.equal(stopped.state, 'stopped')
  assert.equal(fs.existsSync(started.temporaryPath!), false)
  fs.writeFileSync(path.join(project, 'js', 'main.js'), 'const scriptUrls = ["js/plugins.js"];\n', 'utf8')
  await assert.rejects(
    () => service.start(tempRoot, project, previewScene('Scene_MzUnsupportedEntry')),
    /supported scriptUrls load-count barrier/,
  )
})

test('requires the NW package main to match the canonical MV root-data or root-www entry', async () => {
  const projects = [
    { project: createMinimalMvProject('package-root-data-project'), main: 'index.html' },
    { project: createMinimalMvWwwProject('package-root-www-project'), main: 'www/index.html' },
  ]

  for (const { project, main } of projects) {
    let launched = false
    const service = createPreviewService({
      async start(projectRoot, options) {
        launched = true
        const packageValue = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as Record<string, any>
        assert.equal(packageValue.main, main)
        const resourceRoot = main === 'www/index.html' ? path.join(projectRoot, 'www') : projectRoot
        const indexSource = fs.readFileSync(path.join(resourceRoot, 'index.html'), 'utf8')
        assert.doesNotMatch(indexSource, /__mzuiPreviewEngineEntryReceipt/)
        assert.ok(indexSource.indexOf('js/plugins.js') < indexSource.indexOf('js/plugins/MZUIDesignerPreviewEntry.js'))
        assert.ok(indexSource.indexOf('js/plugins/MZUIDesignerPreviewEntry.js') < indexSource.indexOf('js/plugins/MZUIRuntime.js'))
        assert.ok(indexSource.indexOf('js/plugins/MZUIRuntime.js') < indexSource.indexOf('js/plugins/MZUIDesignerPreviewBoot.js'))
        assert.ok(indexSource.indexOf('js/plugins/MZUIDesignerPreviewBoot.js') < indexSource.indexOf('js/main.js'))
        assert.match(indexSource, /js\/plugins\/MZUIRuntime\.js/)
        assert.equal(Object.hasOwn(packageValue, 'inject_js_start'), false)
        assert.equal(Object.hasOwn(packageValue.window, 'inject_js_start'), false)
        assert.equal(options.evidence.application.activePackageMain, main)
        const entryPath = path.join(projectRoot, ...options.evidence.application.entryRelativePath.split('/'))
        const receiptPath = path.join(projectRoot, ...options.evidence.paths.engineEntry.split('/'))
        assert.ok(fs.existsSync(entryPath))
        assert.equal(fs.existsSync(receiptPath), false)
        const appUrl = pathToFileURL(path.join(resourceRoot, 'index.html'))
        const location = { protocol: appUrl.protocol, pathname: appUrl.pathname, href: appUrl.href }
        const context: Record<string, unknown> = {
          console,
          document: { location },
          location,
          require(name: string) {
            if (name === 'fs') return fs
            if (name === 'path') return path
            throw new Error(`unexpected module: ${name}`)
          },
        }
        context.window = context
        vm.runInNewContext(fs.readFileSync(entryPath, 'utf8'), context, { filename: 'MZUIDesignerPreviewEngineEntry-Layout.js' })
        const engineEntryReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as Record<string, unknown>
        assert.equal(engineEntryReceipt.phase, 'engine-entry-loaded')
        const loadState = JSON.parse(fs.readFileSync(path.join(resourceRoot, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/')), 'utf8')) as Record<string, unknown>
        assert.equal(loadState.phase, 'engine-entry-loaded')
        assert.equal(loadState.sessionId, options.sessionId)
        assert.equal(path.dirname(options.profileDirectory), projectRoot)
        return { run: { runId: options?.sessionId || 'package-main-run', sessionId: options?.sessionId, status: 'running' } }
      },
      async stop() { return { run: { status: 'stopped' } } },
      async current() { return { run: { status: 'running' } } },
    })

    const started = await service.start(tempRoot, project, previewScene(`Scene_${path.basename(project).replace(/-/g, '_')}`))
    assert.equal(started.state, 'running', JSON.stringify(started))
    assert.equal(launched, true)
    assert.equal((JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as Record<string, unknown>).main, main)
    const stopped = await service.stop(started.sessionId)
    assert.equal(stopped.state, 'stopped')
  }
})

test('rejects missing, malformed, unbounded, or noncanonical NW package entries before launch', async () => {
  const cases: Array<{
    name: string
    mutate: (project: string) => void
    expected: RegExp
  }> = [
    {
      name: 'missing-package',
      mutate: (project) => fs.rmSync(path.join(project, 'package.json')),
      expected: /package\.json does not exist/,
    },
    {
      name: 'invalid-json',
      mutate: (project) => fs.writeFileSync(path.join(project, 'package.json'), '{invalid-json', 'utf8'),
      expected: /valid JSON/,
    },
    {
      name: 'oversized-package',
      mutate: (project) => fs.writeFileSync(path.join(project, 'package.json'), Buffer.alloc((64 * 1024) + 1, 0x20)),
      expected: /exceeded the bounded size/,
    },
    {
      name: 'uri-main',
      mutate: (project) => fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ main: 'https://example.invalid/index.html' }), 'utf8'),
      expected: /safe project-relative path/,
    },
    {
      name: 'absolute-main',
      mutate: (project) => fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ main: path.join(project, 'index.html') }), 'utf8'),
      expected: /safe project-relative path/,
    },
    {
      name: 'escaping-main',
      mutate: (project) => fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ main: '../index.html' }), 'utf8'),
      expected: /safe project-relative path/,
    },
    {
      name: 'other-entry',
      mutate: (project) => {
        fs.writeFileSync(path.join(project, 'alternate.html'), '<!doctype html>', 'utf8')
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ main: 'alternate.html' }), 'utf8')
      },
      expected: /must resolve exactly/,
    },
  ]

  for (const testCase of cases) {
    const project = createMinimalMvProject(`invalid-package-${testCase.name}`)
    testCase.mutate(project)
    let launchCount = 0
    const service = createPreviewService({
      async start() { launchCount += 1; return { run: { runId: 'invalid-package-run', status: 'running' } } },
      async stop() { return { run: { status: 'stopped' } } },
      async current() { return { run: { status: 'stopped' } } },
    })
    await assert.rejects(
      () => service.start(tempRoot, project, previewScene(`Scene_${testCase.name.replace(/-/g, '_')}`)),
      testCase.expected,
    )
    assert.equal(launchCount, 0)
  }
})

test('rejects a title-scene handshake and cleans the isolated preview', async () => {
  const project = createMinimalMvProject('scene-mismatch-project')
  let stopCount = 0
  let launchedProject = ''
  const captured: Array<{ sessionId: string; reason: string }> = []
  const service = new UiDesignerPreviewService({
    async start(projectRoot, options) { launchedProject = projectRoot; return { run: { runId: 'mismatch-run', sessionId: options?.sessionId, status: 'running' } } },
    async stop() { stopCount += 1; return { run: { runId: 'mismatch-run', status: 'stopped' } } },
    async current() { return { run: { runId: 'mismatch-run', status: 'running' } } },
    captureFailureEvidence(sessionId, reason) {
      assert.equal(fs.existsSync(launchedProject), true)
      captured.push({ sessionId, reason })
    },
  }, undefined, async (_session, expectedScene) => ({ status: 'mismatch', expectedScene, actualScene: 'Scene_Title' }))

  const result = await service.start(tempRoot, project, previewScene('Scene_Expected'))
  assert.equal(result.state, 'error')
  assert.deepEqual(result.sceneHandshake, { status: 'mismatch', expectedScene: 'Scene_Expected', actualScene: 'Scene_Title' })
  assert.equal(result.cleanup?.ok, true)
  assert.equal(stopCount, 1)
  assert.deepEqual(captured, [{ sessionId: result.sessionId, reason: 'handshake-failed' }])
  assert.equal(fs.existsSync(launchedProject), false)
  assert.equal(result.temporaryPath, undefined)
})

test('requires a loaded engine-entry receipt before accepting a ready scene handshake', async () => {
  const project = createMinimalMvProject('entry-success-gate-project')
  const cases: Array<null | { phase: 'entry-invoked' } | { phase: 'entry-failed'; stage: 'document-root' }> = [
    null,
    { phase: 'entry-invoked' },
    { phase: 'entry-failed', stage: 'document-root' },
  ]
  let stopCount = 0
  for (const receipt of cases) {
    const service = new UiDesignerPreviewService({
      async start(projectRoot, options) {
        if (receipt) {
          const receiptPath = path.join(projectRoot, ...options.evidence.paths.engineEntry.split('/'))
          fs.writeFileSync(receiptPath, JSON.stringify({
            schemaVersion: UI_DESIGNER_PREVIEW_ENGINE_ENTRY_RECEIPT_SCHEMA_VERSION,
            sessionId: options.sessionId,
            ...receipt,
          }), 'utf8')
        }
        return { run: { runId: options.sessionId, sessionId: options.sessionId, status: 'running' } }
      },
      async stop() { stopCount += 1; return { run: { status: 'stopped' } } },
      async current() { return { run: { status: 'running' } } },
      captureFailureEvidence() { /* Evidence is asserted through the start result. */ },
    }, undefined, async (_session, expectedScene) => ({ status: 'ready', expectedScene, actualScene: expectedScene }))
    const result = await service.start(tempRoot, project, previewScene('Scene_EntryGate'))
    assert.equal(result.state, 'error')
    assert.match(result.message, /engine Entry did not reach its loaded phase/)
    assert.equal(result.cleanup?.ok, true)
  }
  assert.equal(stopCount, cases.length)
})

test('reports a bounded session-owned boot phase when scene readiness times out', async () => {
  const project = createMinimalMvProject('load-state-project')
  const sessionId = 'preview-load-state-session'
  const statePath = path.join(project, ...UI_DESIGNER_PREVIEW_LOAD_STATE_RELATIVE_PATH.split('/'))
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify({
    schemaVersion: UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
    sessionId,
    phase: 'runtime-configured',
  }), 'utf8')
  const session = { sessionId, temporaryProject: project } as any
  assert.deepEqual(
    await waitForPreviewSceneReadiness(session, 'Scene_LoadState', undefined, 1),
    { status: 'mismatch', expectedScene: 'Scene_LoadState', actualScene: 'unavailable:runtime-configured' },
  )
  fs.writeFileSync(statePath, JSON.stringify({
    schemaVersion: UI_DESIGNER_PREVIEW_LOAD_STATE_SCHEMA_VERSION,
    sessionId: 'another-session',
    phase: 'scene-ready',
  }), 'utf8')
  assert.deepEqual(
    await waitForPreviewSceneReadiness(session, 'Scene_LoadState', undefined, 1),
    { status: 'mismatch', expectedScene: 'Scene_LoadState', actualScene: 'unavailable:engine-entry-not-loaded' },
  )
})

test('stop during the scene-ready wait cancels the single start and cleans exactly once', async () => {
  const project = createMinimalMvProject('cancel-start-project')
  let announceRunner!: () => void
  const runnerStarted = new Promise<void>((resolve) => { announceRunner = resolve })
  let stopCount = 0
  let temporaryProject = ''
  const service = new UiDesignerPreviewService({
    async start(projectRoot, options) {
      temporaryProject = projectRoot
      announceRunner()
      return { run: { runId: 'cancel-run', sessionId: options?.sessionId, status: 'running' } }
    },
    async stop() { stopCount += 1; return { run: { runId: 'cancel-run', status: 'stopped' } } },
    async current() { return { run: { runId: 'cancel-run', status: 'running' } } },
    captureFailureEvidence() { /* The cancellation path is not a failed preview. */ },
  }, undefined, async () => new Promise<never>(() => undefined))

  const startPromise = service.start(tempRoot, project, previewScene('Scene_Cancelled'))
  await runnerStarted
  const stopResult = await service.stop()
  const startResult = await startPromise
  assert.equal(stopResult.state, 'stopped')
  assert.equal(startResult.state, 'stopped')
  assert.equal(stopCount, 1)
  assert.equal(fs.existsSync(temporaryProject), false)
})

test('stops the runner and retains the temporary project when startup isolation evidence changes', async () => {
  const project = path.join(tempRoot, 'isolation-project')
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(project)
  let stopped = false
  const service = createPreviewService({
    async start() {
      fs.writeFileSync(path.join(project, 'data', 'System.json'), '{"changed":true}', 'utf8')
      return { run: { runId: 'isolation-run', status: 'running' } }
    },
    async stop() { stopped = true; return { run: { runId: 'isolation-run', status: 'stopped' } } },
    async current() { return { run: { runId: 'isolation-run', status: stopped ? 'stopped' : 'running' } } },
  })
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Isolation', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  const result = await service.start(tempRoot, project, scene)
  assert.equal(result.state, 'error')
  assert.equal(stopped, true)
  assert.equal(result.cleanup?.ok, false)
  assert.ok(result.temporaryPath)
  assert.equal(fs.existsSync(result.temporaryPath!), true)
  fs.rmSync(result.temporaryPath!, { recursive: true, force: true })
})

test('reads only bounded, session-owned diagnostics and retains them through cleanup', async () => {
  const project = path.join(tempRoot, 'diagnostic-project')
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(project)
  let runnerStatus = 'running'
  const service = createPreviewService({
    async start(_projectRoot, options) { return { run: { runId: options?.sessionId || 'diagnostic-run', sessionId: options?.sessionId, status: 'running' } } },
    async stop() { runnerStatus = 'stopped'; return { run: { status: 'stopped' } } },
    async current() { return { run: { status: runnerStatus } } },
  })
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Diagnostics', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  const started = await service.start(tempRoot, project, scene)
  const diagnosticsPath = path.join(started.temporaryPath!, ...UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH.split('/'))
  const valid = {
    schemaVersion: UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
    sessionId: started.sessionId,
    scene: 'Scene_Diagnostics', file: 'Scene_Diagnostics.json', node: 'node-a', type: 'text', phase: 'update', event: 'onUpdate',
    code: 'UI_RUNTIME_HANDLER_ERROR', severity: 'error', label: 'code', message: 'runtime failure', count: 1,
  }
  fs.writeFileSync(diagnosticsPath, [
    JSON.stringify(valid),
    JSON.stringify(valid),
    JSON.stringify({ ...valid, sessionId: 'other-preview-session' }),
    '{not-json}',
    JSON.stringify({ ...valid, message: 'x'.repeat(20_000) }),
  ].join('\n') + '\n', 'utf8')
  let onError: ((entry: Record<string, unknown>) => void) | undefined
  function SceneDiagnostics() {}
  function SceneBoot() {}
  vm.runInNewContext(fs.readFileSync(path.join(started.temporaryPath!, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js'), 'utf8'), {
    require(name: string) {
      if (name === 'fs') return fs
      if (name === 'path') return path
      throw new Error(`unexpected module: ${name}`)
    },
    process: { cwd: () => started.temporaryPath },
    window: {
      MZUIRuntime: {
        resolveEngineRoot() { return started.temporaryPath },
        configure(options: { onError?: (entry: Record<string, unknown>) => void }) { onError = options.onError },
        scanScenes() { throw new Error('registered diagnostics scene must not rescan') },
        isRegistered() { return true },
      },
      Scene_Diagnostics: SceneDiagnostics,
      Scene_Boot: SceneBoot,
      SceneManager: { run() {} },
    },
    console,
  })
  assert.equal(typeof onError, 'function')
  onError?.({ scene: 'Scene_Diagnostics', node: 'boot-node', type: 'text', phase: 'ready', event: 'ready', label: 'boot', message: 'boot channel failure' })
  assert.match(fs.readFileSync(diagnosticsPath, 'utf8'), /boot channel failure/)
  const first = await service.current()
  assert.equal(first.diagnostics?.length, 2)
  assert.equal(first.diagnostics?.[0]?.phase, 'update')
  assert.equal(first.diagnostics?.[0]?.sessionId, started.sessionId)
  assert.equal(first.diagnostics?.[0]?.code, 'UI_RUNTIME_HANDLER_ERROR')
  assert.equal(first.diagnostics?.[0]?.severity, 'error')
  assert.equal(first.diagnostics?.[0]?.count, 2)

  fs.writeFileSync(diagnosticsPath, Array.from({ length: 100 }, (_, index) => JSON.stringify({
    ...valid,
    node: `node-${index}`,
    message: `runtime failure ${index}`,
  })).join('\n'), 'utf8')
  const bounded = await service.current()
  assert.equal(bounded.diagnostics?.length, 64)
  runnerStatus = 'stopped'
  const stopped = await service.current()
  assert.equal(stopped.state, 'stopped')
  assert.equal(stopped.diagnostics?.length, 64)
  assert.equal(fs.existsSync(started.temporaryPath!), false)
})

test('reconciles a natural runner exit before cleaning the isolated copy', async () => {
  const project = path.join(tempRoot, 'sample-project')
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(project)
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_NaturalExit', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  let status = 'running'
  const service = createPreviewService({
    async start() { return { run: { runId: 'natural-run', status: 'running' } } },
    async stop() { status = 'stopped'; return { run: { status: 'stopped' } } },
    async current() { return { run: { runId: 'natural-run', status } } },
  })
  const started = await service.start(tempRoot, project, scene)
  status = 'exited'
  const reconciled = await service.current()
  assert.equal(reconciled.state, 'stopped')
  assert.equal(fs.existsSync(started.temporaryPath!), false)
})

test('reports a crashed runner after cleanup instead of masking the failure', async () => {
  const project = path.join(tempRoot, 'sample-project')
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  writeMinimalMvEngineEntry(project)
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Crash', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  const service = createPreviewService({
    async start() { return { run: { runId: 'crash-run', status: 'running' } } },
    async stop() { return { run: { runId: 'crash-run', status: 'failed', error: 'runner-crash' } } },
    async current() { return { run: { runId: 'crash-run', status: 'failed', error: 'runner-crash' } } },
  })
  const started = await service.start(tempRoot, project, scene)
  const stopped = await service.stop(started.sessionId)
  assert.equal(stopped.state, 'error')
  assert.equal(stopped.runner?.error, 'runner-crash')
  assert.equal(stopped.cleanup?.ok, true)
})

test('retains the owned temporary project when launcher stop throws, then cleans it after a confirmed retry', async () => {
  const project = createMinimalMvProject('stop-throws-project')
  let stopThrows = true
  const service = createPreviewService({
    async start(_projectRoot, options) {
      return { run: { runId: options.sessionId, sessionId: options.sessionId, status: 'running' } }
    },
    async stop() {
      if (stopThrows) throw new Error('stop unavailable')
      return { run: { status: 'stopped' } }
    },
    async current() { return { run: { status: 'running' } } },
  })

  const started = await service.start(tempRoot, project, previewScene('Scene_StopThrows'))
  const retained = await service.stop(started.sessionId)
  assert.equal(retained.state, 'error')
  assert.equal(retained.cleanup?.ok, false)
  assert.equal(fs.existsSync(started.temporaryPath!), true)

  stopThrows = false
  const cleaned = await service.stop(started.sessionId)
  assert.equal(cleaned.state, 'stopped')
  assert.equal(cleaned.cleanup?.ok, true)
  assert.equal(fs.existsSync(started.temporaryPath!), false)
})

test('Electron teardown synchronously stops the active UI owner before verified cleanup', async () => {
  const project = createMinimalMvProject('teardown-owner-project')
  let syncStops = 0
  const service = createPreviewService({
    async start(_projectRoot, options) {
      return { run: { runId: options.sessionId, sessionId: options.sessionId, status: 'running' } }
    },
    async stop() { throw new Error('async stop must not own Electron teardown') },
    stopSync() {
      syncStops += 1
      return { run: { status: 'stopped' } }
    },
    async current() { return { run: { status: 'running' } } },
  })

  const started = await service.start(tempRoot, project, previewScene('Scene_TeardownOwner'))
  const stopped = service.shutdownSync()

  assert.equal(syncStops, 1)
  assert.equal(stopped.state, 'stopped')
  assert.equal(stopped.cleanup?.ok, true)
  assert.equal(fs.existsSync(started.temporaryPath!), false)
})

test('rejects native engine scene names before preparing or launching a preview', async () => {
  let launched = false
  const service = createPreviewService({
    async start() { launched = true; return { run: { runId: 'should-not-run', status: 'running' } } },
    async stop() { return { run: { status: 'stopped' } } },
    async current() { return { run: { status: 'stopped' } } },
  })
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_Title', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  await assert.rejects(() => service.start(tempRoot, tempRoot, scene), (error: unknown) => error instanceof UiDesignerPreviewSceneConflictError)
  assert.equal(launched, false)
})

test('rejects a concurrent start while isolated preparation is in flight', async () => {
  let release!: () => void
  const preparation = new Promise<never>((resolve) => { release = () => resolve(undefined as never) })
  const service = createPreviewService({
    async start() { return { run: { runId: 'unused', status: 'running' } } },
    async stop() { return { run: { status: 'stopped' } } },
    async current() { return { run: { status: 'running' } } },
  }, async () => preparation as never)
  const scene = {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_InFlight', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], sceneScript: { version: '1.0.0', source: '' },
  } as any
  const first = service.start(tempRoot, tempRoot, scene)
  await Promise.resolve()
  await assert.rejects(() => service.start(tempRoot, tempRoot, scene), (error: unknown) => error instanceof UiDesignerPreviewBusyError)
  release()
  await assert.rejects(first)
})
