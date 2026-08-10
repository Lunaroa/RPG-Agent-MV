import assert from 'node:assert/strict'
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
        assert.ok(isolatedPlugins.indexOf('MZUIRuntime') < isolatedPlugins.indexOf('MZUIDesignerCanvasHost'))
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
      SceneManager: { goto: () => undefined },
      MZUIRuntime: { VERSION: '1.1.0', configure: () => undefined, create: () => ({}) },
      addEventListener: (name: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      AudioManager: { stopAll: () => undefined },
      Video: {},
    }
    context.window = context
    vm.runInNewContext(source, context, { filename: 'MZUIDesignerCanvasHost.js' })
    assert.equal(messages[0]?.kind, 'hello')
    const onMessage = listeners.get('message')
    assert.ok(onMessage)
    onMessage!({ source: parent, data: envelope(session, 0, 'mount', { revision: 1, executionMode: 'authoring', scene: runtimeScene('../outside.png') }) })
    assert.equal(messages.at(-1)?.kind, 'diagnostic')
    onMessage!({ source: parent, data: envelope(session, 1, 'input', { type: 'pointerdown', nodeId: 'node_1', x: 1, y: 2, button: 9, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }) })
    assert.equal(messages.at(-1)?.kind, 'diagnostic')
  } finally {
    try { service.shutdownSync() } catch { /* asserted through staged cleanup */ }
    fs.rmSync(root, { recursive: true, force: true })
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true })
  }
})

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
    if (relative === 'index.html') body = '<!doctype html>'
    else if (relative === 'package.json') body = '{"main":"index.html"}'
    else if (relative === 'js/plugins.js') body = 'var $plugins = [];'
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
