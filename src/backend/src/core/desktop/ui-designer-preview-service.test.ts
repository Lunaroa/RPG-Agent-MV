import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, beforeEach, test } from 'node:test'

import { bootstrapDatabase } from '../db/bootstrap.ts'
import { closeDatabase } from '../db/pool.ts'
import {
  UI_DESIGNER_PREVIEW_DIAGNOSTICS_RELATIVE_PATH,
  UI_DESIGNER_PREVIEW_DIAGNOSTICS_SCHEMA_VERSION,
  UiDesignerPreviewBusyError,
  UiDesignerPreviewSceneConflictError,
  UiDesignerPreviewService,
} from './ui-designer-preview-service.ts'

let tempRoot = ''

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
  let launchCount = 0
  let stopCount = 0
  let runnerStatus = 'running'
  let ordinaryCollision = false
  const service = new UiDesignerPreviewService({
    async start(projectRoot, options) {
      launchCount += 1
      assert.ok(fs.existsSync(path.join(projectRoot, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js')))
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
    version: '1.0.0', runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_Sample', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
  } as any
  const started = await service.start(tempRoot, project, scene)
  assert.equal(started.state, 'running')
  assert.equal(started.projectCompatibility?.engine, 'MV')
  assert.equal(started.projectCompatibility?.engineVersionSupported, true)
  assert.equal(launchCount, 1)
  assert.ok(started.temporaryPath)
  assert.ok(fs.existsSync(path.join(started.temporaryPath!, 'js', 'plugins', 'MZUIRuntime.js')))
  assert.ok(fs.existsSync(path.join(started.temporaryPath!, 'js', 'plugins', 'mzui-data', 'Scene_Sample.json')))
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
  ordinaryCollision = true
  const collided = await service.start(tempRoot, project, scene)
  assert.equal(collided.state, 'error')
  assert.equal(collided.cleanup?.ok, true)
  assert.equal(stopCount, 1)
})

test('reads only bounded, session-owned diagnostics and retains them through cleanup', async () => {
  const project = path.join(tempRoot, 'diagnostic-project')
  fs.mkdirSync(path.join(project, 'data'), { recursive: true })
  fs.mkdirSync(path.join(project, 'js', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(project, 'Game.rpgproject'), 'RPGMV', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'System.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(project, 'data', 'MapInfos.json'), '[null]', 'utf8')
  fs.writeFileSync(path.join(project, 'js', 'plugins.js'), 'var $plugins = [];\n', 'utf8')
  let runnerStatus = 'running'
  const service = new UiDesignerPreviewService({
    async start(_projectRoot, options) { return { run: { runId: options?.sessionId || 'diagnostic-run', sessionId: options?.sessionId, status: 'running' } } },
    async stop() { runnerStatus = 'stopped'; return { run: { status: 'stopped' } } },
    async current() { return { run: { status: runnerStatus } } },
  })
  const scene = {
    version: '1.0.0', runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_Diagnostics', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
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
  vm.runInNewContext(fs.readFileSync(path.join(started.temporaryPath!, 'js', 'plugins', 'MZUIDesignerPreviewBoot.js'), 'utf8'), {
    require(name: string) {
      if (name === 'fs') return fs
      if (name === 'path') return path
      throw new Error(`unexpected module: ${name}`)
    },
    process: { cwd: () => started.temporaryPath },
    window: {
      MZUIRuntime: {
        configure(options: { onError?: (entry: Record<string, unknown>) => void }) { onError = options.onError },
        isRegistered() { return false },
      },
      SceneManager: {},
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
  const scene = {
    version: '1.0.0', runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_NaturalExit', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
  } as any
  let status = 'running'
  const service = new UiDesignerPreviewService({
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
  const scene = {
    version: '1.0.0', runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_Crash', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
  } as any
  const service = new UiDesignerPreviewService({
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

test('rejects native engine scene names before preparing or launching a preview', async () => {
  let launched = false
  const service = new UiDesignerPreviewService({
    async start() { launched = true; return { run: { runId: 'should-not-run', status: 'running' } } },
    async stop() { return { run: { status: 'stopped' } } },
    async current() { return { run: { status: 'stopped' } } },
  })
  const scene = {
    version: '1.0.0', runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_Title', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
  } as any
  await assert.rejects(() => service.start(tempRoot, tempRoot, scene), (error: unknown) => error instanceof UiDesignerPreviewSceneConflictError)
  assert.equal(launched, false)
})

test('rejects a concurrent start while isolated preparation is in flight', async () => {
  let release!: () => void
  const preparation = new Promise<never>((resolve) => { release = () => resolve(undefined as never) })
  const service = new UiDesignerPreviewService({
    async start() { return { run: { runId: 'unused', status: 'running' } } },
    async stop() { return { run: { status: 'stopped' } } },
    async current() { return { run: { status: 'running' } } },
  }, async () => preparation as never)
  const scene = {
    version: '1.0.0', runtimeVersion: '>=1.0.0',
    meta: { sceneName: 'Scene_InFlight', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: { enter: { type: 'fade', duration: 0 }, exit: { type: 'fade', duration: 0 } },
    globalFilter: { blur: 0, glow: 0, preset: '' }, nodes: [], zOrder: [], code: { ready: '', update: '' },
  } as any
  const first = service.start(tempRoot, tempRoot, scene)
  await Promise.resolve()
  await assert.rejects(() => service.start(tempRoot, tempRoot, scene), (error: unknown) => error instanceof UiDesignerPreviewBusyError)
  release()
  await assert.rejects(first)
})
