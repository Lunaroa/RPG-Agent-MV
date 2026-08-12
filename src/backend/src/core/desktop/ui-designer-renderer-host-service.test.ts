import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { UI_DESIGNER_RENDERER_BRIDGE_VERSION } from '../../../../contract/ui-designer-renderer-bridge.ts'
import { RMMV_STANDARD_DATABASE_FILES } from '../rmmv/rmmv-layout.ts'
import { RPG_MAKER_ENGINE_PROFILES } from '../rmmv/rpg-maker-engine.ts'
import { createOwnedEmptyIsolatedProject } from './isolated-project-attestation.ts'
import type { IsolatedProjectPreparation } from './isolated-project-preparation.ts'
import { UiDesignerRendererHostService } from './ui-designer-renderer-host-service.ts'

type Engine = 'MV' | 'MZ'

test('isolated UI canvas host stages and cleans physical MV and MZ projects', async (t) => {
  for (const engine of ['MV', 'MZ'] as const) {
    await t.test(engine, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-host-'))
      const project = path.join(root, 'projects', `sample-${engine.toLowerCase()}`)
      writeProject(project, engine)
      const originalPlugins = fs.readFileSync(path.join(resourceRoot(project, engine), 'js', 'plugins.js'), 'utf8')
      let isolated = ''
      const registered: string[] = []
      const unregistered: string[] = []
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const prepared = preparation(source, 'ui-renderer-isolated-')
          isolated = prepared.temporaryProject
          return prepared
        },
        registerPreviewRoot: (key) => { registered.push(key); return `rpg-agent-preview://${key}/index.html` },
        unregisterPreviewRoot: (key) => { unregistered.push(key) },
        verifyFrameIsolation: () => true,
        verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      })
      try {
        const session = await service.start(project, 7)
        assert.equal(session.engine, engine)
        assert.ok(session.engineVersion)
        assert.equal(session.runtimeVersion, '1.1.0')
        assert.match(session.iframeUrl, /^rpg-agent-preview:\/\/[a-f0-9]{64}\/index\.html$/)
        assert.equal(session.iframeUrl.includes(project), false)
        assert.equal(fs.existsSync(path.join(resourceRoot(isolated, engine), 'js', 'plugins', 'MZUIRuntime.js')), true)
        assert.equal(fs.existsSync(path.join(resourceRoot(isolated, engine), 'js', 'plugins', 'MZUIDesignerCanvasHost.js')), true)
        const isolatedPlugins = fs.readFileSync(path.join(resourceRoot(isolated, engine), 'js', 'plugins.js'), 'utf8')
        assert.equal(isolatedPlugins.includes('MZUIDesignerSessionStorage'), false)
        assert.ok(isolatedPlugins.indexOf('MZUIRuntime') < isolatedPlugins.indexOf('MZUIDesignerCanvasHost'))
        if (engine === 'MV') {
          const isolatedIndex = fs.readFileSync(path.join(resourceRoot(isolated, engine), 'index.html'), 'utf8')
          assert.equal((isolatedIndex.match(/js\/plugins\/MZUIDesignerSessionStorage\.js/g) || []).length, 1)
          assert.ok(isolatedIndex.indexOf('js/rpg_managers.js') < isolatedIndex.indexOf('js/plugins/MZUIDesignerSessionStorage.js'))
          assert.ok(isolatedIndex.indexOf('js/plugins/MZUIDesignerSessionStorage.js') < isolatedIndex.indexOf('js/plugins.js'))
        } else {
          const isolatedMain = fs.readFileSync(path.join(resourceRoot(isolated, engine), 'js', 'main.js'), 'utf8')
          assert.equal((isolatedMain.match(/js\/plugins\/MZUIDesignerSessionStorage\.js/g) || []).length, 1)
          assert.ok(isolatedMain.indexOf('js/rmmz_managers.js') < isolatedMain.indexOf('js/plugins/MZUIDesignerSessionStorage.js'))
          assert.ok(isolatedMain.indexOf('js/plugins/MZUIDesignerSessionStorage.js') < isolatedMain.indexOf('js/plugins.js'))
        }
        assert.equal(fs.readFileSync(path.join(resourceRoot(project, engine), 'js', 'plugins.js'), 'utf8'), originalPlugins)
        assert.equal(service.confirm(session.sessionId).sessionId, session.sessionId)
        service.stop(session.sessionId)
        assert.equal(fs.existsSync(isolated), false)
        assert.deepEqual(unregistered, registered)
      } finally {
        try { service.shutdownSync() } catch { /* asserted by the test body */ }
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('UI canvas host uses a sparse MV www or MZ root overlay with read-only source fallback', async (t) => {
  for (const engine of ['MV', 'MZ'] as const) {
    await t.test(engine, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-sparse-'))
      const project = path.join(root, 'projects', `sample-${engine.toLowerCase()}`)
      writeProject(project, engine)
      fs.mkdirSync(path.join(resourceRoot(project, engine), 'img', 'pictures'), { recursive: true })
      fs.writeFileSync(path.join(resourceRoot(project, engine), 'img', 'pictures', 'menu.png'), 'source-image', 'utf8')
      const sourceBefore = treeDigest(project)
      let isolated = ''
      let registration: {
        resourceRoot?: string
        fallback?: { root: string; prefixes: readonly string[] }
        deniedPaths?: readonly string[]
      } = {}
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const challenge = createOwnedEmptyIsolatedProject(source, { temporaryPrefix: 'ui-renderer-sparse-owner-' })
          isolated = challenge.temporaryProject
          return {
            ...challenge,
            sourceFingerprint: 'read-only',
            saveFingerprint: 'save',
            staging: { files: [], digest: 'staging' },
            savesExcluded: true,
            sourceAccessMode: 'protocol-read-only',
          }
        },
        registerPreviewRoot: (key, overlayRoot, _sourceProject, options) => {
          registration = { resourceRoot: overlayRoot, fallback: options?.fallback, deniedPaths: options?.deniedPaths }
          return `rpg-agent-preview://${key}/index.html`
        },
        unregisterPreviewRoot: () => undefined,
        verifyFrameIsolation: () => true,
        verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      })
      try {
        const session = await service.start(project, 1)
        const overlayRoot = resourceRoot(isolated, engine)
        assert.equal(registration.resourceRoot, overlayRoot)
        assert.equal(registration.fallback?.root, fs.realpathSync.native(resourceRoot(project, engine)))
        assert.deepEqual(registration.fallback?.prefixes, [''])
        assert.equal(registration.deniedPaths?.includes('save/'), true)
        assert.equal(fs.existsSync(path.join(overlayRoot, 'data')), false)
        assert.equal(fs.existsSync(path.join(overlayRoot, 'img')), false)
        assert.equal(fs.existsSync(path.join(overlayRoot, 'js', engine === 'MV' ? 'rpg_core.js' : 'rmmz_core.js')), false)
        assert.equal(fs.readFileSync(path.join(resourceRoot(project, engine), 'img', 'pictures', 'menu.png'), 'utf8'), 'source-image')
        assert.equal(treeDigest(project), sourceBefore)
        service.stop(session.sessionId)
      } finally {
        try { service.shutdownSync() } catch { /* asserted by the test body */ }
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('isolated UI canvas host fails before resolving or copying an empty project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-required-'))
  let prepared = false
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: () => { prepared = true; throw new Error('must not prepare') },
    registerPreviewRoot: () => { throw new Error('must not register') },
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    await assert.rejects(service.start(' ', 0), (error: Error & { code?: string }) => error.code === 'UI_DESIGNER_PROJECT_REQUIRED')
    assert.equal(prepared, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('synchronous renderer teardown retains an active owner without disposed acknowledgement', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-terminal-proof-'))
  const project = path.join(root, 'projects', 'sample-mz')
  writeProject(project, 'MZ')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-terminal-proof-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 1)
    assert.throws(
      () => service.shutdownSync(),
      (error: Error & { code?: string }) => error.code === 'UI_DESIGNER_RENDERER_DISPOSE_UNCONFIRMED',
    )
    assert.equal(service.current()?.sessionId, session.sessionId)
    assert.equal(fs.existsSync(isolated), true)

    service.stop(session.sessionId)
    assert.equal(service.current(), null)
    assert.equal(fs.existsSync(isolated), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('stale session stop cannot supersede a replacement renderer preparation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-replacement-'))
  const project = path.join(root, 'projects', 'sample-mz')
  writeProject(project, 'MZ')
  const isolatedProjects: string[] = []
  let prepareCount = 0
  let releaseReplacement!: () => void
  let replacementPreparationStarted!: () => void
  const replacementGate = new Promise<void>((resolve) => { releaseReplacement = resolve })
  const replacementStarted = new Promise<void>((resolve) => { replacementPreparationStarted = resolve })
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: async (_workflowRoot, source) => {
      prepareCount += 1
      const prepared = preparation(source, 'ui-renderer-replacement-copy-')
      isolatedProjects.push(prepared.temporaryProject)
      if (prepareCount === 2) {
        replacementPreparationStarted()
        await replacementGate
      }
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const previous = await service.start(project, 1)
    const replacementPromise = service.start(project, 2)
    await replacementStarted

    service.stop(previous.sessionId)
    releaseReplacement()

    const replacement = await replacementPromise
    assert.equal(replacement.generation, 2)
    assert.equal(service.current()?.sessionId, replacement.sessionId)
    service.stop(replacement.sessionId)
    assert.equal(service.current(), null)
  } finally {
    releaseReplacement?.()
    try { service.shutdownSync() } catch { /* asserted by the test body */ }
    fs.rmSync(root, { recursive: true, force: true })
    for (const isolated of isolatedProjects) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('anonymous stop cancels a pending renderer preparation and cleans its temporary project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-cancel-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  let releasePreparation!: () => void
  let preparationStarted!: () => void
  const preparationGate = new Promise<void>((resolve) => { releasePreparation = resolve })
  const started = new Promise<void>((resolve) => { preparationStarted = resolve })
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: async (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-cancel-copy-')
      isolated = prepared.temporaryProject
      preparationStarted()
      await preparationGate
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const pending = service.start(project, 1)
    await started
    service.stop()
    releasePreparation()
    await assert.rejects(pending, /superseded by a newer project generation/)
    assert.equal(service.current(), null)
    assert.equal(fs.existsSync(isolated), false)
  } finally {
    releasePreparation?.()
    try { service.shutdownSync() } catch { /* asserted by the test body */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('unsupported engine version fails before isolated copy or protocol registration', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-version-'))
  const project = path.join(root, 'projects', 'sample-mz')
  writeProject(project, 'MZ', '1.9.0')
  let prepared = false
  let registered = false
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: () => { prepared = true; throw new Error('must not prepare') },
    registerPreviewRoot: () => { registered = true; throw new Error('must not register') },
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
  })
  try {
    await assert.rejects(
      service.start(project, 0),
      (error: Error & { code?: string }) => error.code === 'UI_DESIGNER_PROJECT_ENGINE_UNSUPPORTED',
    )
    assert.equal(prepared, false)
    assert.equal(registered, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('generated host rejects unsafe resource and input envelopes before runtime dispatch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-protocol-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-protocol-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 3)
    const source = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
    assert.match(source, /function validateDiagnostic\(entry, sceneId\)/)
    assert.match(source, /entry\.scene !== null && entry\.scene !== sceneId/)
    assert.match(source, /validateDiagnostic\(entry, message\.sceneId\)/)
    const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
    const messages: Array<Record<string, unknown>> = []
    const listeners = new Map<string, (event: { source: unknown; data: unknown }) => void>()
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) }
    function SceneBase(this: unknown) { /* engine fixture */ }
    SceneBase.prototype.initialize = () => undefined
    SceneBase.prototype.create = () => undefined
    SceneBase.prototype.update = () => undefined
    SceneBase.prototype.terminate = () => undefined
    function SceneBoot(this: unknown) { /* engine fixture */ }
    SceneBoot.prototype.start = () => undefined
    const context: Record<string, unknown> = {
      parent,
      TextEncoder,
      Utils: { RPGMAKER_NAME: 'MV', RPGMAKER_VERSION: '1.6.2' },
      PIXI: { VERSION: '4.8.9' },
      Graphics: { width: 816, height: 624 },
      Scene_Base: SceneBase,
      Scene_Boot: SceneBoot,
      SceneManager: { goto: () => undefined, push: () => undefined, pop: () => undefined, changeScene: () => undefined, catchException: () => undefined },
      StorageManager: {},
      JsonEx: { stringify: (value: unknown) => JSON.stringify(value), parse: (value: string) => JSON.parse(value) },
      MZUIRuntime: { VERSION: '1.1.0', configure: () => undefined, create: () => ({}) },
      addEventListener: (name: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      AudioManager: { stopAll: () => undefined },
      Video: {},
    }
    context.window = context
    vm.runInNewContext(storageSource, context, { filename: 'MZUIDesignerSessionStorage.js' })
    vm.runInNewContext(source, context, { filename: 'MZUIDesignerCanvasHost.js' })
    assert.equal(messages.find((message) => message.kind === 'hello')?.kind, 'hello')
    assert.equal(messages.find((message) => message.kind === 'receipt' && (message.payload as { stage?: string })?.stage === 'iframe-load')?.kind, 'receipt')
    const onMessage = listeners.get('message')
    assert.ok(onMessage)
    onMessage!({ source: parent, data: envelope(session, 0, 'mount', { revision: 1, executionMode: 'authoring', scene: runtimeScene('../outside.png') }) })
    assert.equal(messages.some((message) => message.kind === 'diagnostic'), true)
    onMessage!({ source: parent, data: envelope(session, 1, 'input', { type: 'pointerdown', nodeId: 'node_1', x: 1, y: 2, button: 9, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }) })
    assert.equal(messages.some((message) => message.kind === 'fatal'), true)
  } finally {
    try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('generated host keeps patch bounds incremental without a periodic full-bounds poll', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-incremental-bounds-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-incremental-bounds-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 4)
    const source = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
    assert.doesNotMatch(source, /boundsFrame/)
    assert.doesNotMatch(source, /boundsFrame\s*%\s*6/)
    assert.match(source, /var lastBoundsByNode = \{\};/)
    assert.match(source, /function changedBounds\(bounds, force\)/)
    assert.match(source, /var bounds = runtime\.patchNodes\(message\.payload\.nodes\);/)
    assert.match(source, /rememberBounds\(bounds\);/)
    service.stop(session.sessionId)
  } finally {
    try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('generated host transition polling is single-shot and disposed-safe', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-transition-poll-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-transition-poll-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 6)
    const hostSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
    const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
    const messages: Array<Record<string, unknown>> = []
    const listeners = new Map<string, (...args: any[]) => void>()
    const timers = new Map<number, () => void>()
    const delays: number[] = []
    const cleared: number[] = []
    let nextTimer = 1
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) }
    function SceneBase(this: unknown) { /* engine fixture */ }
    SceneBase.prototype.initialize = () => undefined
    SceneBase.prototype.create = () => undefined
    SceneBase.prototype.update = () => undefined
    SceneBase.prototype.terminate = () => undefined
    function SceneBoot(this: unknown) { /* engine fixture */ }
    SceneBoot.prototype.start = () => undefined
    function SceneCanvasHost(this: unknown) { /* engine fixture */ }
    function SceneOptions(this: unknown) { /* engine fixture */ }
    const sceneManager: Record<string, unknown> = {
      _scene: { constructor: SceneCanvasHost },
      goto: () => undefined,
      push: () => undefined,
      pop: () => undefined,
      changeScene: () => { sceneManager._scene = { constructor: SceneOptions } },
      catchException: () => undefined,
      updateMain: () => undefined,
    }
    const originalSave = () => 'source-save'
    const context: Record<string, unknown> = {
      parent,
      TextEncoder,
      Utils: { RPGMAKER_NAME: 'MV', RPGMAKER_VERSION: '1.6.2' },
      PIXI: { VERSION: '4.8.9' },
      Graphics: { width: 816, height: 624 },
      Scene_Base: SceneBase,
      Scene_Boot: SceneBoot,
      SceneManager: sceneManager,
      StorageManager: { save: originalSave },
      JsonEx: { stringify: (value: unknown) => JSON.stringify(value), parse: (value: string) => JSON.parse(value) },
      MZUIRuntime: { VERSION: '1.1.0', configure: () => undefined, create: () => ({}) },
      addEventListener: (name: string, listener: (...args: any[]) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      setTimeout: (callback: () => void, delay: number) => { const id = nextTimer++; timers.set(id, callback); delays.push(delay); return id },
      clearTimeout: (id: number) => { cleared.push(id); timers.delete(id) },
      AudioManager: { stopAll: () => undefined },
      Video: {},
    }
    context.window = context
    vm.runInNewContext(storageSource, context, { filename: 'MZUIDesignerSessionStorage.js' })
    vm.runInNewContext(hostSource, context, { filename: 'MZUIDesignerCanvasHost.js' })

    ;(sceneManager.changeScene as () => void)()
    assert.equal(timers.size, 1)
    assert.deepEqual(delays, [16])
    const timer = [...timers.entries()][0]
    assert.ok(timer)
    const messageCountBeforeDispose = messages.length
    listeners.get('beforeunload')?.()
    assert.deepEqual(cleared, [timer[0]])
    assert.equal(timers.size, 0)
    assert.equal((context.StorageManager as { save: unknown }).save, originalSave)
    assert.equal(context.__mzuiSessionStorage, null)
    timer[1]()
    assert.equal(timers.size, 0)
    assert.equal(messages.length, messageCountBeforeDispose + 1)
    assert.equal(messages.at(-1)?.kind, 'disposed')
    service.stop(session.sessionId)
  } finally {
    try { service.shutdownSync() } catch { /* asserted through generated host cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('engine entry keeps StorageManager undefined until the official manager stage, then installs storage before project plugins', async (t) => {
  for (const engine of ['MV', 'MZ'] as const) {
    await t.test(engine, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `ui-renderer-storage-order-${engine.toLowerCase()}-`))
      const project = path.join(root, 'projects', `sample-${engine.toLowerCase()}`)
      writeProject(project, engine)
      let isolated = ''
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const prepared = preparation(source, `ui-renderer-storage-order-${engine.toLowerCase()}-`)
          isolated = prepared.temporaryProject
          return prepared
        },
        registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
        unregisterPreviewRoot: () => undefined,
        verifyFrameIsolation: () => true,
        verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      })
      try {
        const session = await service.start(project, 8)
        const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, engine), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
        const context: Record<string, unknown> = {
          Utils: { RPGMAKER_NAME: engine },
          JsonEx: { stringify: (value: unknown) => JSON.stringify(value), parse: (value: string) => JSON.parse(value) },
        }
        context.window = context

        assert.throws(
          () => vm.runInNewContext(storageSource, context, { filename: 'MZUIDesignerSessionStorage.js' }),
          /StorageManager is unavailable after the official engine manager stage/,
        )

        const originalSave = () => 'source-save'
        const originalLoad = () => 'source-load'
        context.StorageManager = { save: originalSave, load: originalLoad }
        vm.runInNewContext(storageSource, context, { filename: 'MZUIDesignerSessionStorage.js' })
        const manager = context.StorageManager as Record<string, (...args: any[]) => any>
        const storage = context.__mzuiSessionStorage as { assertInstalled: () => boolean }
        const installedSave = manager.save
        assert.throws(
          () => vm.runInNewContext('StorageManager.save = function () { return "source-plugin-save"; };', context),
          /attempted to replace the isolated UI preview StorageManager adapter/,
        )
        assert.equal(manager.save, installedSave)
        assert.equal(storage.assertInstalled(), true)
        if (engine === 'MV') assert.equal(manager.save('order-check', 'payload'), true)
        else assert.equal(await manager.save('order-check', 'payload'), true)

        const resourceRootPath = resourceRoot(isolated, engine)
        if (engine === 'MV') {
          const index = fs.readFileSync(path.join(resourceRootPath, 'index.html'), 'utf8')
          assert.ok(index.indexOf('js/rpg_managers.js') < index.indexOf('js/plugins/MZUIDesignerSessionStorage.js'))
          assert.ok(index.indexOf('js/plugins/MZUIDesignerSessionStorage.js') < index.indexOf('js/plugins.js'))
        } else {
          const main = fs.readFileSync(path.join(resourceRootPath, 'js', 'main.js'), 'utf8')
          assert.ok(main.indexOf('js/rmmz_managers.js') < main.indexOf('js/plugins/MZUIDesignerSessionStorage.js'))
          assert.ok(main.indexOf('js/plugins/MZUIDesignerSessionStorage.js') < main.indexOf('js/plugins.js'))
        }
        service.stop(session.sessionId)
      } finally {
        try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('generated session storage keeps MV sync and MZ promise state in memory', async (t) => {
  for (const engine of ['MV', 'MZ'] as const) {
    await t.test(engine, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-storage-'))
      const project = path.join(root, 'projects', `sample-${engine.toLowerCase()}`)
      writeProject(project, engine)
      let isolated = ''
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const prepared = preparation(source, `ui-renderer-storage-${engine.toLowerCase()}-`)
          isolated = prepared.temporaryProject
          return prepared
        },
        registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
        unregisterPreviewRoot: () => undefined,
        verifyFrameIsolation: () => true,
        verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      })
      try {
        const session = await service.start(project, 5)
        const source = fs.readFileSync(path.join(resourceRoot(isolated, engine), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
        let stringifyCalls = 0
        let parseCalls = 0
        const originalSave = () => 'source-save'
        const originalLoad = () => 'source-load'
        const context: Record<string, unknown> = {
          Utils: { RPGMAKER_NAME: engine },
          StorageManager: { save: originalSave, load: originalLoad },
          JsonEx: {
            stringify: (value: unknown) => { stringifyCalls += 1; return JSON.stringify(value) },
            parse: (value: string) => { parseCalls += 1; return JSON.parse(value) },
          },
        }
        context.window = context
        vm.runInNewContext(source, context, { filename: 'MZUIDesignerSessionStorage.js' })
        const manager = context.StorageManager as Record<string, (...args: any[]) => any>
        const storage = context.__mzuiSessionStorage as { assertInstalled: () => boolean; restore: () => boolean }
        const wrappedSave = manager.save
        assert.throws(
          () => vm.runInNewContext('StorageManager.save = function () { return "source-plugin-save"; };', context),
          /attempted to replace the isolated UI preview StorageManager adapter/,
        )
        assert.equal(manager.save, wrappedSave)
        assert.equal(storage.assertInstalled(), true)
        const payload = { value: 7, nested: ['session'] }
        if (engine === 'MV') {
          assert.equal(manager.save('save-1', JSON.stringify(payload)), true)
          assert.equal(manager.load('save-1'), JSON.stringify(payload))
          assert.equal(manager.load(-1), '')
          assert.equal(manager.load('missing'), '')
          assert.equal(manager.exists('missing'), false)
          assert.equal(manager.saveObject('object-1', payload), true)
          assert.deepEqual(manager.loadObject('object-1'), payload)
          const objectJson = manager.objectToJson(payload)
          assert.equal(typeof objectJson, 'string')
          assert.deepEqual(manager.jsonToObject(objectJson), payload)
          assert.equal(manager.backup('save-1'), true)
          assert.equal(manager.backupExists('save-1'), true)
          assert.equal(manager.remove('save-1'), true)
          assert.equal(manager.restoreBackup('save-1'), true)
          assert.equal(manager.load('save-1'), JSON.stringify(payload))
        } else {
          await manager.save('save-1', JSON.stringify(payload))
          assert.equal(await manager.load('save-1'), JSON.stringify(payload))
          await assert.rejects(manager.load('missing'))
          assert.equal(manager.exists('missing'), false)
          await manager.saveObject('object-1', payload)
          assert.deepEqual(await manager.loadObject('object-1'), payload)
          const objectJson = manager.objectToJson(payload)
          assert.equal(typeof objectJson?.then, 'function')
          const json = await objectJson
          assert.deepEqual(await manager.jsonToObject(json), payload)
          assert.equal(typeof manager.jsonToZip(json)?.then, 'function')
          await assert.rejects(manager.loadObject('missing-object'))
          await manager.saveToForage('forage-1', 'forage')
          assert.equal(await manager.loadFromForage('forage-1'), 'forage')
          assert.equal(manager.forageExists('forage-1'), true)
          await manager.backup('save-1')
          assert.equal(manager.backupExists('save-1'), true)
          await manager.remove('save-1')
          await manager.restoreBackup('save-1')
          assert.equal(await manager.load('save-1'), JSON.stringify(payload))
        }
        assert.equal(stringifyCalls > 0, true)
        assert.equal(parseCalls > 0, true)
        const installedSaveDescriptor = Object.getOwnPropertyDescriptor(manager, 'save')
        assert.ok(installedSaveDescriptor)
        Object.defineProperty(manager, 'save', { configurable: true, enumerable: installedSaveDescriptor.enumerable, writable: true, value: originalSave })
        assert.throws(() => storage.assertInstalled(), /replaced the isolated UI preview StorageManager adapter/)
        Object.defineProperty(manager, 'save', installedSaveDescriptor)
        assert.equal(storage.assertInstalled(), true)
        const snapshot = (context.__mzuiSessionStorage as { snapshot: () => { values: number; backups: number } }).snapshot()
        assert.equal(snapshot.values, engine === 'MZ' ? 3 : 2)
        assert.equal(snapshot.backups, 0)
        assert.equal(storage.restore(), true)
        assert.equal(manager.save, originalSave)
        assert.equal(manager.load, originalLoad)
        assert.equal(context.__mzuiSessionStorage, null)
        service.stop(session.sessionId)
      } finally {
        try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('MV config -1 fresh boot and save missing values keep official empty-result semantics', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-mv-config-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-mv-config-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 9)
    const source = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
    const context: Record<string, any> = {
      Utils: { RPGMAKER_NAME: 'MV' },
      StorageManager: { save: () => undefined, load: () => undefined },
      JsonEx: { stringify: (value: unknown) => JSON.stringify(value), parse: (value: string) => JSON.parse(value) },
    }
    context.window = context
    vm.runInNewContext(source, context, { filename: 'MZUIDesignerSessionStorage.js' })
    const manager = context.StorageManager as { load: (id: string | number) => string | null; exists: (id: string | number) => boolean }
    let appliedConfig: Record<string, unknown> | null = null
    context.ConfigManager = {
      load: () => {
        const json = manager.load(-1)
        appliedConfig = json ? JSON.parse(json) : {}
        return appliedConfig
      },
    }
    context.ConfigManager.load()
    assert.deepEqual(appliedConfig, {})
    assert.equal(manager.load(-1), '')
    assert.equal(manager.load(1), '')
    assert.equal(manager.exists(1), false)
    service.stop(session.sessionId)
  } finally {
    try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('official MV 1.6.1 loader reaches ready before lazy Window_Message creation and unloads the host session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-mv-scene-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-mv-scene-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 10)
    const hostSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
    const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')

    const officialMv = createOfficialMv161LoaderFixture()
    vm.runInNewContext(storageSource, officialMv.context, { filename: 'MZUIDesignerSessionStorage.js' })
    vm.runInNewContext(hostSource, officialMv.context, { filename: 'MZUIDesignerCanvasHost.js' })
    assert.equal(officialMv.messages.some((message) => message.kind === 'ready'), false)

    officialMv.runLoader()

    assert.deepEqual(
      officialMv.messages
        .filter((message) => message.kind === 'receipt' && (message.payload as { stage?: string }).stage === 'ready')
        .map((message) => (message.payload as { status?: string }).status),
      ['begin', 'success'],
    )
    assert.equal(officialMv.messages.filter((message) => message.kind === 'ready').length, 1)
    assert.equal(officialMv.messages.some((message) => message.kind === 'fatal'), false, JSON.stringify(officialMv.messages))
    assert.deepEqual(officialMv.lifecycle, [
      'boot-start',
      'scene-start:Scene_Boot',
      'setup-new-game',
      'goto:Scene_Title',
      'goto:Scene_MZUIDesignerCanvasHost',
      'scene-terminate:Scene_Boot',
      'scene-create:Scene_MZUIDesignerCanvasHost',
      'scene-start:Scene_MZUIDesignerCanvasHost',
    ])
    assert.equal(officialMv.setupNewGameCalls(), 1)
    assert.equal(officialMv.createGameObjectsCalls(), 0)
    assert.equal(officialMv.messageWindowTone(), null)

    const onMessage = officialMv.listeners.get('message')
    assert.ok(onMessage)
    onMessage!({
      source: officialMv.context.parent,
      data: envelope(session, 0, 'mount', { revision: 1, executionMode: 'authoring', scene: runtimeScene('') }),
    })
    assert.equal(officialMv.setupNewGameCalls(), 1)
    assert.equal(officialMv.messageWindowTone(), null)
    const actions = officialMv.context.MZUIRuntime.contextProvider().actions
    actions.showMessage({ message: 'session message' })
    assert.deepEqual(officialMv.messageWindowTone(), [0, 0, 0])
    assert.deepEqual(officialMv.context.$gameMessage.added, ['session message'])

    let cachedBitmapDestroyed = 0
    officialMv.context.ImageManager = { _cache: { 'img/pictures/menu.png:0': { destroy: () => { cachedBitmapDestroyed += 1 } } } }
    const mountedBeforeRefresh = officialMv.messages.filter((message) => message.kind === 'mounted').length
    onMessage!({
      source: officialMv.context.parent,
      data: envelope(session, 1, 'resource-refresh', { revision: 2, resourceRevision: 1, relativePaths: ['img/pictures/menu.png'] }),
    })
    assert.equal(cachedBitmapDestroyed, 1)
    assert.equal(Object.keys(officialMv.context.ImageManager._cache).length, 0)
    assert.equal(officialMv.messages.filter((message) => message.kind === 'mounted').length, mountedBeforeRefresh + 1)

    let cacheMapEntryFreed = 0
    const cacheMapInner: Record<string, { free(force: boolean): void }> = {}
    cacheMapInner['img/pictures/menu.png:0'] = {
      free: (force: boolean) => {
        assert.equal(force, true)
        cacheMapEntryFreed += 1
        delete cacheMapInner['img/pictures/menu.png:0']
      },
    }
    officialMv.context.ImageManager = {
      _cache: {
        _inner: cacheMapInner,
      },
    }
    onMessage!({
      source: officialMv.context.parent,
      data: envelope(session, 2, 'resource-refresh', { revision: 3, resourceRevision: 2, relativePaths: ['img/pictures/menu.png'] }),
    })
    assert.equal(cacheMapEntryFreed, 1)
    assert.equal(Object.keys(cacheMapInner).length, 0)

    officialMv.listeners.get('beforeunload')?.()
    assert.equal(officialMv.messages.filter((message) => message.kind === 'disposed').length, 1)
    assert.equal(officialMv.context.__mzuiSessionStorage, null)
    assert.equal(officialMv.context.StorageManager.load, officialMv.originalLoad)
    assert.equal(officialMv.context.Scene_Boot.prototype.start, officialMv.originalBootStart)
    for (const [method, original] of Object.entries(officialMv.originalSceneManager)) {
      assert.equal(officialMv.context.SceneManager[method], original, `${method} should restore its official MV owner`)
    }
    assert.equal(officialMv.stopped(), true)
    service.stop(session.sessionId)
  } finally {
    try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

test('ready failures publish one atomic safe fatal as the only terminal message before the official MV loader aborts', async (t) => {
  const failureCases = [
    ['scene-create', 'UI_RENDERER_READY_SCENE_CREATE'],
    ['canvas-host', 'UI_RENDERER_READY_CANVAS_HOST'],
    ['ready-signal', 'UI_RENDERER_READY_SIGNAL'],
  ] as const
  for (const [failurePoint, expectedCode] of failureCases) {
    await t.test(failurePoint, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-ready-failure-'))
      const project = path.join(root, 'projects', 'sample-mv')
      writeProject(project, 'MV')
      let isolated = ''
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const prepared = preparation(source, 'ui-renderer-ready-failure-copy-')
          isolated = prepared.temporaryProject
          return prepared
        },
        registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
        unregisterPreviewRoot: () => undefined,
        verifyFrameIsolation: () => true,
        verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      })
      try {
        const session = await service.start(project, 11)
        const privatePath = path.join(os.tmpdir(), 'fixture project', 'System.json')
        const opaqueKey = 'b'.repeat(64)
        const failureMessage = `fixture failure at ${privatePath} for ${session.sessionId} rpg-agent-preview://${opaqueKey}/index.html`
        const officialMv = createOfficialMv161LoaderFixture({ failurePoint, failureMessage })
        const hostSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
        const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
        vm.runInNewContext(storageSource, officialMv.context, { filename: 'MZUIDesignerSessionStorage.js' })
        vm.runInNewContext(hostSource, officialMv.context, { filename: 'MZUIDesignerCanvasHost.js' })

        assert.throws(() => officialMv.runLoader(), (error) => String(error).includes('fixture failure'))
        officialMv.listeners.get('beforeunload')?.()
        const readyReceipts = officialMv.messages.filter((message) => message.kind === 'receipt' && (message.payload as { stage?: string }).stage === 'ready')
        assert.deepEqual(
          readyReceipts.map((message) => (message.payload as { status?: string }).status),
          ['begin'],
          JSON.stringify(officialMv.messages),
        )
        const terminalMessages = officialMv.messages.filter((message) => message.kind === 'fatal' || (
          message.kind === 'receipt' && (message.payload as { status?: string }).status === 'error'
        ))
        assert.deepEqual(terminalMessages.map((message) => message.kind), ['fatal'])
        const fatal = officialMv.messages.find((message) => message.kind === 'fatal')
        assert.ok(fatal)
        const fatalIndex = officialMv.messages.indexOf(fatal)
        const disposedIndex = officialMv.messages.findIndex((message) => message.kind === 'disposed')
        assert.ok(fatalIndex >= 0 && disposedIndex > fatalIndex)
        assert.deepEqual(
          {
            stage: (fatal.payload as { stage?: string }).stage,
            code: (fatal.payload as { code?: string }).code,
            revision: (fatal.payload as { revision?: number }).revision,
          },
          { stage: 'ready', code: expectedCode, revision: 0 },
        )
        const diagnostic = officialMv.messages.find((message) => message.kind === 'diagnostic')
        assert.ok(diagnostic)
        const diagnosticEntry = (diagnostic.payload as { entries: Array<Record<string, unknown>> }).entries[0]
        assert.equal(diagnosticEntry.phase, 'ready')
        assert.equal(diagnosticEntry.code, expectedCode)
        const safeText = JSON.stringify([
          (fatal.payload as { message?: string }).message,
          diagnosticEntry.message,
          diagnosticEntry.node,
          diagnosticEntry.event,
        ])
        assert.equal(safeText.includes(session.sessionId), false)
        assert.equal(safeText.includes(opaqueKey), false)
        assert.equal(safeText.includes(privatePath), false)
        assert.equal(officialMv.messages.some((message) => message.kind === 'ready'), false)
        service.stop(session.sessionId)
      } finally {
        try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('official MV 1.6.1 loader reports scene transition failures before the engine catch and preserves official throws', async (t) => {
  const cases = [
    ['scene-state-publish', 'scene-state-publish'],
    ['goto', 'goto'],
    ['push', 'push'],
    ['pop', 'pop'],
    ['host-initialize', 'goto'],
    ['change-scene', 'change-scene'],
    ['catch-exception', 'catch-exception'],
  ] as const
  for (const [failurePoint, expectedEvent] of cases) {
    await t.test(failurePoint, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-transition-failure-'))
      const project = path.join(root, 'projects', 'sample-mv')
      writeProject(project, 'MV')
      let isolated = ''
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const prepared = preparation(source, 'ui-renderer-transition-failure-copy-')
          isolated = prepared.temporaryProject
          return prepared
        },
        registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
        unregisterPreviewRoot: () => undefined,
        verifyFrameIsolation: () => true,
        verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
      })
      try {
        const session = await service.start(project, 12)
        const privatePath = path.join(os.tmpdir(), 'fixture project', 'Map001.json')
        const opaqueKey = 'c'.repeat(64)
        const failureMessage = `transition failed for ${session.sessionId} at rpg-agent-preview://${opaqueKey}/index.html from ${privatePath}`
        const officialMv = createOfficialMv161LoaderFixture({ failurePoint, failureMessage })
        const hostSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
        const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
        vm.runInNewContext(storageSource, officialMv.context, { filename: 'MZUIDesignerSessionStorage.js' })
        vm.runInNewContext(hostSource, officialMv.context, { filename: 'MZUIDesignerCanvasHost.js' })

        let caught: unknown = null
        if (failurePoint === 'catch-exception') {
          const engineError = new Error(failureMessage)
          officialMv.context.SceneManager.catchException(engineError)
          officialMv.context.SceneManager.catchException(engineError)
        } else {
          try {
            if (failurePoint === 'push') officialMv.context.SceneManager.push(officialMv.context.Scene_Title)
            else if (failurePoint === 'pop') officialMv.context.SceneManager.pop()
            else officialMv.runLoader()
          } catch (error) {
            caught = error
          }
          assert.ok(caught)
          assert.match(String(caught), /transition failed/)
          officialMv.context.SceneManager.catchException(caught)
          officialMv.context.SceneManager.catchException(caught)
        }

        const fatalMessages = officialMv.messages.filter((message) => message.kind === 'fatal')
        assert.equal(fatalMessages.length, 1, JSON.stringify(officialMv.messages))
        const fatal = fatalMessages[0]
        assert.deepEqual(
          {
            stage: fatal.payload.stage,
            code: fatal.payload.code,
            revision: fatal.payload.revision,
          },
          { stage: 'scene-state', code: 'UI_RENDERER_SCENE_TRANSITION_FAILED', revision: 0 },
        )
        const diagnosticMessages = officialMv.messages.filter((message) => message.kind === 'diagnostic')
        assert.equal(diagnosticMessages.length, 1, JSON.stringify(officialMv.messages))
        const diagnosticEntry = diagnosticMessages[0].payload.entries[0]
        assert.equal(diagnosticEntry.phase, 'scene-state')
        assert.equal(diagnosticEntry.event, expectedEvent)
        assert.equal(diagnosticEntry.code, 'UI_RENDERER_SCENE_TRANSITION_FAILED')
        const fatalEventIndex = officialMv.eventOrder.indexOf('message:fatal')
        const officialCatchIndex = officialMv.eventOrder.indexOf('official-catch')
        assert.ok(fatalEventIndex >= 0 && officialCatchIndex > fatalEventIndex, JSON.stringify(officialMv.eventOrder))
        const safeText = JSON.stringify([fatal.payload.message, diagnosticEntry.message])
        assert.equal(safeText.includes(session.sessionId), false)
        assert.equal(safeText.includes(opaqueKey), false)
        assert.equal(safeText.includes(privatePath), false)
        assert.match(safeText, /<session>/)
        assert.match(safeText, /<preview>/)
        assert.match(safeText, /<path>/)

        officialMv.listeners.get('beforeunload')?.()
        for (const [method, original] of Object.entries(officialMv.originalSceneManager)) {
          assert.equal(officialMv.context.SceneManager[method], original, `${method} should restore after ${failurePoint}`)
        }
        assert.equal(officialMv.context.Scene_Boot.prototype.start, officialMv.originalBootStart)
        service.stop(session.sessionId)
      } finally {
        try { service.shutdownSync() } catch { /* asserted through generated host cleanup */ }
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('official MV 1.6.1 unload preserves later plugin owners of wrapped scene methods', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-transition-owner-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-transition-owner-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 13)
    const officialMv = createOfficialMv161LoaderFixture()
    const hostSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerCanvasHost.js'), 'utf8')
    const storageSource = fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'js', 'plugins', 'MZUIDesignerSessionStorage.js'), 'utf8')
    vm.runInNewContext(storageSource, officialMv.context, { filename: 'MZUIDesignerSessionStorage.js' })
    vm.runInNewContext(hostSource, officialMv.context, { filename: 'MZUIDesignerCanvasHost.js' })

    const delegatedCalls: string[] = []
    const laterPluginMethods: Record<string, (...args: any[]) => unknown> = {}
    for (const method of Object.keys(officialMv.originalSceneManager)) {
      const installed = officialMv.context.SceneManager[method]
      laterPluginMethods[method] = (...args: any[]) => {
        delegatedCalls.push(method)
        return installed.apply(officialMv.context.SceneManager, args)
      }
    }
    for (const [method, replacement] of Object.entries(laterPluginMethods)) officialMv.context.SceneManager[method] = replacement
    const laterBootStart = () => undefined
    officialMv.context.Scene_Boot.prototype.start = laterBootStart

    officialMv.listeners.get('beforeunload')?.()

    for (const [method, replacement] of Object.entries(laterPluginMethods)) {
      assert.equal(officialMv.context.SceneManager[method], replacement, `${method} should keep the later plugin owner`)
    }
    assert.equal(officialMv.context.Scene_Boot.prototype.start, laterBootStart)
    officialMv.context.SceneManager.goto(officialMv.context.Scene_Title)
    officialMv.context.SceneManager.changeScene()
    officialMv.context.SceneManager.push(officialMv.context.Scene_Title)
    officialMv.context.SceneManager.pop()
    officialMv.context.SceneManager.catchException(new Error('later plugin handled error'))
    officialMv.context.SceneManager.updateMain()
    for (const method of Object.keys(laterPluginMethods)) assert.ok(delegatedCalls.includes(method), `${method} should still delegate after unload`)
    service.stop(session.sessionId)
  } finally {
    try { service.shutdownSync() } catch { /* asserted through generated host cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

type OfficialMv161ReadyFailurePoint = 'scene-create' | 'canvas-host' | 'ready-signal'
type OfficialMv161TransitionFailurePoint = 'scene-state-publish' | 'goto' | 'push' | 'pop' | 'host-initialize' | 'change-scene' | 'catch-exception'

function createOfficialMv161LoaderFixture(options: {
  failurePoint?: OfficialMv161ReadyFailurePoint | OfficialMv161TransitionFailurePoint
  failureMessage?: string
} = {}): {
  context: Record<string, any>
  listeners: Map<string, (...args: any[]) => void>
  messages: Array<Record<string, any>>
  lifecycle: string[]
  eventOrder: string[]
  runLoader: () => void
  createGameObjectsCalls: () => number
  setupNewGameCalls: () => number
  messageWindowTone: () => number[] | null
  stopped: () => boolean
  originalLoad: unknown
  originalBootStart: unknown
  originalSceneManager: Record<string, unknown>
} {
  const listeners = new Map<string, (...args: any[]) => void>()
  const messages: Array<Record<string, any>> = []
  const lifecycle: string[] = []
  const eventOrder: string[] = []
  const fail = () => { throw new Error(options.failureMessage || 'official MV ready fixture failure') }
  const context: Record<string, any> = {
    parent: {
      postMessage: (message: Record<string, any>) => {
        if (options.failurePoint === 'ready-signal' && message.kind === 'ready') fail()
        if (options.failurePoint === 'scene-state-publish' && message.kind === 'scene-state') fail()
        messages.push(message)
        eventOrder.push(`message:${message.kind}`)
      },
    },
    TextEncoder,
    Utils: { RPGMAKER_NAME: 'MV', RPGMAKER_VERSION: '1.6.1' },
    PIXI: { VERSION: '4.5.4' },
    Graphics: { width: 816, height: 624, resize: (width: number, height: number) => { context.Graphics.width = width; context.Graphics.height = height } },
    AudioManager: { stopAll: () => undefined },
    Video: {},
    $dataSystem: { windowTone: [0, 0, 0, 0] },
  }
  const originalLoad = () => 'original-load'
  context.StorageManager = { save: () => undefined, load: originalLoad }
  context.JsonEx = { stringify: (value: unknown) => JSON.stringify(value), parse: (value: string) => JSON.parse(value) }
  context.PIXI.Container = function Container(this: { children: any[]; addChild: (child: unknown) => void }) {
    if (options.failurePoint === 'canvas-host') fail()
    this.children = []
    this.addChild = (child: unknown) => { this.children.push(child) }
  }
  let createGameObjectsCalls = 0
  let setupNewGameCalls = 0
  let latestTone: number[] | null = null
  const establishGameObjects = () => {
    const values = ['$gameTemp', '$gameSystem', '$gameScreen', '$gameTimer', '$gameMessage', '$gameSwitches', '$gameVariables', '$gameSelfSwitches', '$gameActors', '$gameParty', '$gameTroop', '$gameMap', '$gamePlayer']
    for (const name of values) context[name] = {}
    context.$gameSystem.windowTone = () => context.$dataSystem.windowTone.slice(0, 3)
    context.$gameMessage.added = []
    context.$gameMessage.add = (message: string) => { context.$gameMessage.added.push(message) }
  }
  context.DataManager = {
    createGameObjects: () => { createGameObjectsCalls += 1; establishGameObjects() },
    setupNewGame: () => { lifecycle.push('setup-new-game'); setupNewGameCalls += 1; establishGameObjects() },
  }
  function SceneBase(this: { initialize: () => void }) { this.initialize() }
  SceneBase.prototype.initialize = function () {
    if (options.failurePoint === 'host-initialize' && this.constructor.name === 'Scene_MZUIDesignerCanvasHost') fail()
    this.children = []
  }
  SceneBase.prototype.create = function () {
    lifecycle.push(`scene-create:${this.constructor.name}`)
    if (options.failurePoint === 'scene-create') fail()
  }
  SceneBase.prototype.start = function () { lifecycle.push(`scene-start:${this.constructor.name}`) }
  SceneBase.prototype.update = function () { /* official base hook */ }
  SceneBase.prototype.terminate = function () { lifecycle.push(`scene-terminate:${this.constructor.name}`) }
  SceneBase.prototype.addChild = function (child: unknown) { this.children.push(child) }
  SceneBase.prototype.addWindow = function (child: unknown) { this._windowLayer.addChild(child) }
  SceneBase.prototype.createWindowLayer = function () {
    this._windowLayer = { children: [] as unknown[], addChild(child: unknown) { this.children.push(child) } }
    this.addChild(this._windowLayer)
  }
  function Scene_Boot(this: { initialize: () => void }) { this.initialize() }
  Scene_Boot.prototype = Object.create(SceneBase.prototype)
  Scene_Boot.prototype.constructor = Scene_Boot
  Scene_Boot.prototype.start = function () {
    lifecycle.push('boot-start')
    SceneBase.prototype.start.call(this)
    context.DataManager.setupNewGame()
    context.SceneManager.goto(context.Scene_Title)
  }
  const originalBootStart = Scene_Boot.prototype.start
  function Scene_Title(this: { initialize: () => void }) { this.initialize() }
  Scene_Title.prototype = Object.create(SceneBase.prototype)
  Scene_Title.prototype.constructor = Scene_Title
  function SceneMap(this: any) { /* official map fixture */ }
  SceneMap.prototype.createMessageWindow = function () {
    this._messageWindow = new context.Window_Message()
    this.addWindow(this._messageWindow)
    this._messageWindow.subWindows().forEach((window: unknown) => this.addWindow(window))
  }
  function WindowMessage(this: { tone: number[]; subWindows: () => unknown[] }) {
    if (!context.$gameSystem || typeof context.$gameSystem.windowTone !== 'function') throw new Error('Window_Base.updateTone received an unavailable window tone')
    latestTone = context.$gameSystem.windowTone()
    this.tone = latestTone
    this.subWindows = () => [{ type: 'choice' }, { type: 'number' }, { type: 'item' }]
  }
  let sceneManagerStopped = false
  const sceneManager: Record<string, any> = {
    _scene: null,
    _nextScene: null,
    goto(target: new () => unknown) {
      lifecycle.push(`goto:${target.name}`)
      if (options.failurePoint === 'goto' && target.name === 'Scene_MZUIDesignerCanvasHost') fail()
      this._nextScene = new target()
    },
    push(target: new () => unknown) {
      if (options.failurePoint === 'push') fail()
      this.goto(target)
    },
    pop() { if (options.failurePoint === 'pop') fail() },
    changeScene() {
      if (options.failurePoint === 'change-scene') fail()
      if (!this._nextScene) return
      if (this._scene && typeof this._scene.terminate === 'function') this._scene.terminate()
      this._scene = this._nextScene
      this._nextScene = null
      this._scene.create()
    },
    catchException(error: unknown) {
      eventOrder.push('official-catch')
      return error
    },
    updateMain: () => undefined,
    stop: () => { sceneManagerStopped = true },
  }
  const originalSceneManager = {
    goto: sceneManager.goto,
    push: sceneManager.push,
    pop: sceneManager.pop,
    changeScene: sceneManager.changeScene,
    catchException: sceneManager.catchException,
    updateMain: sceneManager.updateMain,
  }
  const runtime: Record<string, any> = {
    VERSION: '1.1.0',
    configure: (options: Record<string, unknown>) => { Object.assign(runtime, options) },
    create: () => ({ mount: () => undefined, cleanup: () => undefined, update: () => undefined, getNodeBounds: () => [] }),
  }
  Object.assign(context, {
    Scene_Base: SceneBase,
    Scene_Boot,
    Scene_Title,
    Scene_Map: SceneMap,
    Window_Message: WindowMessage,
    SceneManager: sceneManager,
    MZUIRuntime: runtime,
    addEventListener: (name: string, listener: (...args: any[]) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  })
  context.window = context
  return {
    context,
    listeners,
    messages,
    lifecycle,
    eventOrder,
    runLoader: () => {
      const boot = new context.Scene_Boot()
      context.SceneManager._scene = boot
      boot.start()
      context.SceneManager.changeScene()
      context.SceneManager._scene.start()
    },
    createGameObjectsCalls: () => createGameObjectsCalls,
    setupNewGameCalls: () => setupNewGameCalls,
    messageWindowTone: () => latestTone,
    stopped: () => sceneManagerStopped,
    originalLoad,
    originalBootStart,
    originalSceneManager,
  }
}

test('source save and staging evidence changes retain the isolated project for recovery', async (t) => {
  for (const changed of ['sourceUnchanged', 'savesUnchanged', 'stagingUnchanged'] as const) {
    await t.test(changed, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-evidence-'))
      const project = path.join(root, 'projects', 'sample-mv')
      writeProject(project, 'MV')
      let isolated = ''
      let evidence = { sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }
      const service = new UiDesignerRendererHostService(root, {
        prepareIsolated: (_workflowRoot, source) => {
          const prepared = preparation(source, 'ui-renderer-evidence-copy-')
          isolated = prepared.temporaryProject
          return prepared
        },
        registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
        unregisterPreviewRoot: () => undefined,
        verifyFrameIsolation: () => true,
        verifySourceState: () => evidence,
      })
      try {
        const session = await service.start(project, 1)
        const mutation = changed === 'sourceUnchanged'
          ? path.join(resourceRoot(project, 'MV'), 'data', 'System.json')
          : changed === 'savesUnchanged'
            ? path.join(resourceRoot(project, 'MV'), 'save', 'file1.rpgsave')
            : path.join(root, 'runtime', 'staging-evidence.json')
        fs.mkdirSync(path.dirname(mutation), { recursive: true })
        fs.appendFileSync(mutation, '\nchanged', 'utf8')
        evidence = { ...evidence, [changed]: false }
        assert.throws(() => service.stop(session.sessionId), /kept for recovery/)
        assert.equal(service.current()?.sessionId, session.sessionId)
        assert.equal(fs.existsSync(isolated), true)
        evidence = { sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }
        service.stop(session.sessionId)
        assert.equal(fs.existsSync(isolated), false)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
        if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
      }
    })
  }
})

test('active renderer resource sync applies only its manifest and rejects stale generations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-renderer-resource-session-'))
  const project = path.join(root, 'projects', 'sample-mv')
  writeProject(project, 'MV')
  const sourceResource = path.join(resourceRoot(project, 'MV'), 'img', 'pictures', 'menu.png')
  fs.mkdirSync(path.dirname(sourceResource), { recursive: true })
  fs.writeFileSync(sourceResource, 'new-resource', 'utf8')
  let isolated = ''
  const service = new UiDesignerRendererHostService(root, {
    prepareIsolated: (_workflowRoot, source) => {
      const prepared = preparation(source, 'ui-renderer-resource-copy-')
      isolated = prepared.temporaryProject
      return prepared
    },
    registerPreviewRoot: (key) => `rpg-agent-preview://${key}/index.html`,
    unregisterPreviewRoot: () => undefined,
    verifyFrameIsolation: () => true,
    verifySourceState: () => ({ sourceUnchanged: true, savesUnchanged: true, stagingUnchanged: true }),
  })
  try {
    const session = await service.start(project, 9)
    fs.writeFileSync(sourceResource, 'updated-resource', 'utf8')
    const receipt = service.syncResources({
      project,
      sessionId: session.sessionId,
      generation: session.generation,
      manifest: { schemaVersion: '1.0.0', upsertRelativePaths: ['www/img/pictures/menu.png'], deleteRelativePaths: [] },
    })
    assert.equal(receipt.resourceRevision, 1)
    assert.equal(service.current()?.resourceRevision, 1)
    assert.equal(fs.readFileSync(path.join(resourceRoot(isolated, 'MV'), 'img', 'pictures', 'menu.png'), 'utf8'), 'updated-resource')
    assert.equal(fs.readFileSync(sourceResource, 'utf8'), 'updated-resource')
    assert.throws(() => service.syncResources({
      project,
      sessionId: session.sessionId,
      generation: session.generation - 1,
      manifest: { schemaVersion: '1.0.0', upsertRelativePaths: ['www/img/pictures/menu.png'], deleteRelativePaths: [] },
    }), /stale project generation/)
    service.stop(session.sessionId)
  } finally {
    try { service.shutdownSync() } catch { /* asserted by the test body */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

function preparation(sourceProject: string, temporaryPrefix: string): IsolatedProjectPreparation {
  const challenge = createOwnedEmptyIsolatedProject(sourceProject, { temporaryPrefix })
  fs.cpSync(sourceProject, challenge.temporaryProject, { recursive: true })
  return {
    ...challenge,
    sourceFingerprint: 'source',
    saveFingerprint: 'save',
    staging: { files: [], digest: 'staging' },
    savesExcluded: true,
  }
}

function treeDigest(root: string): string {
  const hash = crypto.createHash('sha256')
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).replace(/\\/g, '/')
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${relative}\n`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute))
    }
  }
  visit(root)
  return hash.digest('hex')
}

function resourceRoot(project: string, engine: Engine): string { return engine === 'MV' ? path.join(project, 'www') : project }

function writeProject(project: string, engine: Engine, version = engine === 'MV' ? '1.6.2' : '1.10.0'): void {
  const resources = resourceRoot(project, engine)
  const data = path.join(resources, 'data')
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(project, engine === 'MV' ? 'Game.rpgproject' : 'game.rmmzproject'), engine === 'MV' ? `RPGMV ${version}` : `RPGMZ ${version}`, 'utf8')
  const profile = RPG_MAKER_ENGINE_PROFILES[engine === 'MV' ? 'rpg-maker-mv' : 'rpg-maker-mz']
  for (const relative of profile.engineFiles) {
    const target = path.join(resources, ...relative.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    let body = ''
    if (relative === 'index.html') {
      body = engine === 'MV'
        ? '<!doctype html>\n<body>\n<script type="text/javascript" src="js/rpg_core.js"></script>\n<script type="text/javascript" src="js/rpg_managers.js"></script>\n<script type="text/javascript" src="js/rpg_objects.js"></script>\n<script type="text/javascript" src="js/rpg_scenes.js"></script>\n<script type="text/javascript" src="js/rpg_sprites.js"></script>\n<script type="text/javascript" src="js/rpg_windows.js"></script>\n<script type="text/javascript" src="js/plugins.js"></script>\n<script type="text/javascript" src="js/main.js"></script>\n</body>'
        : '<!doctype html>\n<body><script type="text/javascript" src="js/main.js"></script></body>'
    }
    else if (relative === 'package.json') body = '{"main":"index.html"}'
    else if (relative === 'js/plugins.js') body = 'var $plugins = [];'
    else if (relative === 'js/main.js' && engine === 'MZ') body = 'const scriptUrls = [\n  "js/rmmz_core.js",\n  "js/rmmz_managers.js",\n  "js/rmmz_objects.js",\n  "js/plugins.js"\n];\nPluginManager.setup($plugins);'
    else if (relative === 'js/rmmz_core.js') body = `Utils.RPGMAKER_NAME = "MZ";\nUtils.RPGMAKER_VERSION = "${version}";`
    fs.writeFileSync(target, body, 'utf8')
  }
  for (const fileName of RMMV_STANDARD_DATABASE_FILES) {
    const value = fileName === 'System.json'
      ? engine === 'MZ'
        ? { switches: [null], variables: [null], gameTitle: 'Sample', tileSize: 48, faceSize: 144, iconSize: 32, advanced: { screenWidth: 816, screenHeight: 624, uiAreaWidth: 816, uiAreaHeight: 624 } }
        : { switches: [null], variables: [null], gameTitle: 'Sample' }
      : []
    fs.writeFileSync(path.join(data, fileName), JSON.stringify(value), 'utf8')
  }
  fs.writeFileSync(path.join(data, 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Sample' }]), 'utf8')
  fs.writeFileSync(path.join(data, 'Map001.json'), JSON.stringify({ width: 1, height: 1, data: [], events: [null] }), 'utf8')
}

function envelope(session: { sessionId: string; generation: number }, sequence: number, kind: string, payload: unknown): Record<string, unknown> {
  return { version: UI_DESIGNER_RENDERER_BRIDGE_VERSION, sessionId: session.sessionId, generation: session.generation, sequence, sceneId: 'Scene_CanvasHost', kind, payload }
}

function runtimeScene(pathValue: string): Record<string, unknown> {
  return {
    version: '1.1.0', runtimeVersion: '>=1.1.0',
    meta: { sceneName: 'Scene_CanvasHost', sceneBase: 'Scene_Base', canvasWidth: 816, canvasHeight: 624, author: '', description: '' },
    transitions: {}, globalFilter: {}, zOrder: ['node_1'], sceneScript: { version: '1.0.0', source: '' },
    nodes: [{ id: 'node_1', name: 'Node', type: 'sprite', parentId: null, children: [], condition: { type: 'none' }, enterAnim: { type: 'none' }, exitAnim: { type: 'none' }, events: {}, propModes: {}, propCodes: {}, props: { path: pathValue } }],
  }
}
