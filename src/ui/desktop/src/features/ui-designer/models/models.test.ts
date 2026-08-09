import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  UiDesignerHistory,
  UiExportValidationError,
  alignNodes,
  analyzePerformance,
  cloneUiDocument,
  copySelection,
  createDefaultNode,
  createUiDocument,
  distributeNodes,
  exportRuntimeDocument,
  importRuntimeSceneDocument,
  groupNodes,
  moveNodeStep,
  pasteClipboard,
  parseUiDocument,
  reparentNode,
  serializeDocument,
  snapPoint,
  viewportClientToContent,
  viewportClientToWorld,
  viewportClientToZoomAnchor,
  viewportContentToClient,
  worldPointToClient,
  worldPointToViewport,
  worldRectToViewport,
  zoomViewport,
  nodesIntersectingRect,
  validateDocument,
  validateTreeInvariants,
  UI_DESIGNER_BUILT_IN_TEMPLATES,
  createBuiltInUiDesignerTemplate,
  reorderEventActions,
} from './index'

describe('ui designer document model', () => {
  test('reorders event action chains for drag and keyboard commands without mutation', () => {
    const actions = [{ type: 'newGame' }, { type: 'continue' }, { type: 'options' }] as const
    const reordered = reorderEventActions(actions, 0, 2)
    assert.deepEqual(reordered.map((action) => action.type), ['continue', 'options', 'newGame'])
    assert.deepEqual(actions.map((action) => action.type), ['newGame', 'continue', 'options'])
    assert.deepEqual(reorderEventActions(actions, -1, 0), actions)
  })
  test('built-in templates are valid dirty-document sources with unique identities', () => {
    assert.equal(UI_DESIGNER_BUILT_IN_TEMPLATES.length, 12)
    for (const name of UI_DESIGNER_BUILT_IN_TEMPLATES) {
      const document = createBuiltInUiDesignerTemplate(name)
      const report = validateDocument(document)
      assert.equal(report.valid, true, name)
      assert.equal(new Set(document.nodes.map((node) => node.id)).size, document.nodes.length)
      assert.equal(document.meta.sceneName.startsWith('Scene_'), true)
    }
    const menu = createBuiltInUiDesignerTemplate('builtin:menu')
    const menuActions = menu.nodes.filter((node) => node.type === 'button').flatMap((node) => node.events.onClick?.actions ?? [])
    assert.deepEqual(menuActions.map((action) => action.type), ['newGame', 'continue', 'options', 'exit'])
    const gameOver = createBuiltInUiDesignerTemplate('builtin:game-over')
    assert.equal(gameOver.nodes.find((node) => node.id === 'builtin_gameover_text')?.enterAnim.type, 'fadeIn')
    const logo = createBuiltInUiDesignerTemplate('builtin:logo-animation')
    const logoFrames = logo.nodes.find((node) => node.id === 'builtin_logo_fade')
    assert.equal(logoFrames?.type === 'frameAnimation' ? logoFrames.props.frames.length : 0, 2)
    const slots = createBuiltInUiDesignerTemplate('builtin:save-slots')
    const container = slots.nodes.find((node) => node.id === 'builtin_slots_container')
    const firstSlot = slots.nodes.find((node) => node.id === 'builtin_slot_1')
    assert.equal(container?.props.x, 70)
    assert.equal(firstSlot?.props.x, 94)
    assert.equal(firstSlot?.props.y, 104)
  })

  test('runtime scene data import adds editor defaults and remains a dirty editable copy', () => {
    const source = createUiDocument('Scene_RuntimeImport')
    source.nodes[0].children = []
    const runtime = exportRuntimeDocument(source)
    const imported = importRuntimeSceneDocument(runtime)
    assert.equal(imported.editorVersion.length > 0, true)
    assert.equal(imported.guides.length, 0)
    assert.equal(imported.canvas.width, runtime.meta.canvasWidth)
    assert.equal(imported.meta.sceneName, runtime.meta.sceneName)
    assert.equal(validateDocument(imported).valid, true)
  })
  test('migrates legacy lifecycle bodies into one canonical scene script', () => {
    const current = createUiDocument('Scene_LegacyMigration')
    const legacy = structuredClone(current) as unknown as Record<string, unknown>
    legacy.version = '1.0.0'
    legacy.editorVersion = '1.0.0'
    delete legacy.sceneScript
    legacy.code = {
      ready: 'this.__readyValue = arguments.length; return 1;',
      update: 'this.__updateValue = $var(1);',
    }
    const parsed = parseUiDocument(legacy)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.document.version, '1.1.0')
    assert.match(parsed.document.sceneScript.source, /onReady\(function/)
    assert.match(parsed.document.sceneScript.source, /return 1;/)
    assert.match(parsed.document.sceneScript.source, /onUpdate\(function/)
    assert.equal('code' in parsed.document, false)
    const runtime = exportRuntimeDocument(parsed.document)
    assert.equal(runtime.runtimeVersion, '>=1.1.0')
    assert.equal(runtime.sceneScript.source, parsed.document.sceneScript.source)
  })
  test('creates a current document with the complete ten-node factory', () => {
    const document = createUiDocument('Scene_Test')
    const types = ['container', 'sprite', 'nineSlice', 'frameAnimation', 'button', 'text', 'progressBar', 'overlay', 'video', 'particle'] as const
    const nodes = types.map((type, index) => createDefaultNode(type, { id: `node_${index}`, name: `${type}_${index}` }))
    assert.equal(document.meta.sceneName, 'Scene_Test')
    assert.equal(document.nodes[0].type, 'container')
    assert.equal(document.canvas.width, 816)
    assert.equal(nodes.length, 10)
    assert.equal(nodes.every((node) => node.parentId === null && node.props.visible), true)
  })

  test('canvas box selection ignores the non-interactive root shell', () => {
    const document = createUiDocument()
    const child = createDefaultNode('text', { id: 'node_box_child', name: 'BoxChild', parentId: 'node_root', x: 20, y: 20, width: 80, height: 40 })
    document.nodes.push(child)
    document.nodes[0].children.push(child.id)
    assert.deepEqual(nodesIntersectingRect(document, { x: 0, y: 0, width: 200, height: 120 }), [child.id])
  })

  test('validates duplicate names and cycles as errors', () => {
    const document = createUiDocument()
    const child = createDefaultNode('text', { id: 'node_child', name: 'same', parentId: 'node_root' })
    const duplicate = createDefaultNode('sprite', { id: 'node_duplicate', name: 'same', parentId: 'node_root' })
    document.nodes.push(child, duplicate)
    document.nodes[0].children.push(child.id, duplicate.id)
    child.children.push(document.nodes[0].id)
    const issues = validateTreeInvariants(document)
    assert.ok(issues.some((issue) => issue.code === 'duplicate-node-name'))
    assert.ok(issues.some((issue) => issue.code === 'cycle'))
  })

  test('reparents and groups without creating invalid parent links', () => {
    const document = createUiDocument()
    const first = createDefaultNode('text', { id: 'node_first', name: 'First', parentId: 'node_root' })
    const second = createDefaultNode('text', { id: 'node_second', name: 'Second', parentId: 'node_root' })
    document.nodes.push(first, second)
    document.nodes[0].children.push(first.id, second.id)
    const reparented = reparentNode(document, first.id, document.nodes[0].id, 'inner')
    assert.equal(reparented.nodes.find((node) => node.id === first.id)?.parentId, 'node_root')
    const grouped = groupNodes(document, [first.id, second.id], 'Controls')
    assert.equal(grouped.document.nodes.find((node) => node.id === grouped.groupId)?.children.length, 2)
    assert.equal(validateTreeInvariants(grouped.document).length, 0)
  })

  test('moves siblings one slot without crossing the root shell', () => {
    const document = createUiDocument()
    const first = createDefaultNode('text', { id: 'node_first_step', name: 'FirstStep', parentId: 'node_root' })
    const second = createDefaultNode('text', { id: 'node_second_step', name: 'SecondStep', parentId: 'node_root' })
    document.nodes.push(first, second)
    document.nodes[0].children.push(first.id, second.id)
    const moved = moveNodeStep(document, second.id, 'up')
    assert.deepEqual(moved.nodes[0].children, [second.id, first.id])
    assert.deepEqual(moveNodeStep(moved, second.id, 'up').nodes[0].children, [second.id, first.id])
  })

  test('copies and pastes a subtree with remapped ids', () => {
    const document = createUiDocument()
    const text = createDefaultNode('text', { id: 'node_text', name: 'Label', parentId: 'node_root' })
    document.nodes.push(text)
    document.nodes[0].children.push(text.id)
    const clipboard = copySelection(document, [text.id])
    const pasted = pasteClipboard(document, clipboard)
    assert.equal(pasted.ids.length, 1)
    assert.notEqual(pasted.ids[0], text.id)
    assert.equal(validateTreeInvariants(pasted.document).length, 0)
  })

  test('allocates unique factory identities and remaps nested action references', () => {
    const generatedA = createDefaultNode('text')
    const generatedB = createDefaultNode('text')
    assert.notEqual(generatedA.id, generatedB.id)
    assert.notEqual(generatedA.name, generatedB.name)
    const document = createUiDocument()
    const group = createDefaultNode('container', { id: 'group', name: 'Group', parentId: 'node_root' })
    const button = createDefaultNode('button', { id: 'button', name: 'Button', parentId: 'group' })
    button.events.onClick = {
      actions: [
        { id: 'toggle', type: 'toggleNode', targetNodeId: 'button' },
        { id: 'tween', type: 'tweenProp', tweenNodeId: 'button', tweenProp: 'opacity', tweenTarget: 10, tweenDuration: 12, tweenEasing: 'Linear' },
      ],
    }
    document.nodes.push(group, button)
    document.nodes[0].children.push(group.id)
    group.children.push(button.id)
    const clipboard = copySelection(document, [group.id])
    const pasted = pasteClipboard(document, clipboard, 'node_root')
    const copiedButton = pasted.document.nodes.find((node) => node.name.startsWith('Button_copy'))!
    const copiedGroup = pasted.document.nodes.find((node) => node.name.startsWith('Group_copy'))!
    const actions = copiedButton.events.onClick?.actions ?? []
    assert.equal(actions[0].type === 'toggleNode' ? actions[0].targetNodeId : '', copiedButton.id)
    assert.equal(actions[1].type === 'tweenProp' ? actions[1].tweenNodeId : '', copiedButton.id)
    assert.equal(copiedButton.parentId, copiedGroup.id)
    assert.throws(() => pasteClipboard(document, clipboard, 'button'))
  })

})

describe('ui designer export and validation', () => {
  test('strips editor-only guides and nine-slice helper flags', () => {
    const document = createUiDocument()
    const nineSlice = createDefaultNode('nineSlice', { id: 'frame', name: 'Frame', parentId: 'node_root' })
    document.nodes.push(nineSlice)
    document.nodes[0].children.push(nineSlice.id)
    document.guides.push({ id: 'guide_1', type: 'vertical', position: 100, locked: false })
    const runtime = exportRuntimeDocument(document)
    assert.equal('guides' in runtime, false)
    assert.equal('editorVersion' in runtime, false)
    assert.equal('showGuides' in runtime.nodes.find((node) => node.id === nineSlice.id)!.props, false)
  })

  test('blocks export when user code is syntactically invalid', () => {
    const document = createUiDocument()
    document.sceneScript.source = 'onReady(function () {'
    const report = validateDocument(document)
    assert.equal(report.valid, false)
    assert.throws(() => exportRuntimeDocument(document), UiExportValidationError)
  })

  test('checks property and condition code as expressions alongside the scene script', () => {
    const document = createUiDocument()
    const text = createDefaultNode('text', { id: 'text_expression', name: 'ExpressionText', parentId: 'node_root' })
    text.propCodes.content = '1 + 2'
    text.condition = { type: 'code', code: '$gameSwitches.value(1) === true' }
    document.nodes.push(text)
    document.nodes[0].children.push(text.id)
    assert.equal(validateDocument(document).valid, true)
    text.propCodes.content = 'if ('
    assert.equal(validateDocument(document).valid, false)
  })

  test('allows finite negative variable values and tween targets but keeps ids and timing non-negative', () => {
    const document = createUiDocument()
    const button = createDefaultNode('button', { id: 'node_actions_numbers', name: 'NumberActions', parentId: 'node_root' })
    button.events.onClick = {
      actions: [
        { type: 'setVariable', variableId: 1, variableOp: '=', variableVal: -12 },
        { type: 'tweenProp', tweenNodeId: button.id, tweenProp: 'x', tweenTarget: -48, tweenDuration: 20, tweenEasing: 'Linear' },
      ],
    }
    document.nodes.push(button)
    document.nodes[0].children.push(button.id)
    assert.equal(validateDocument(document).valid, true)
    const actions = button.events.onClick.actions
    if (actions[0].type === 'setVariable') actions[0].variableId = -1
    assert.equal(validateDocument(document).valid, false)
    if (actions[0].type === 'setVariable') actions[0].variableId = 1
    if (actions[1].type === 'tweenProp') actions[1].tweenDuration = -1
    assert.equal(validateDocument(document).valid, false)
  })

  test('rejects malformed source JSON without throwing validation', () => {
    const malformed = JSON.stringify({ version: '1.0.0', editorVersion: '1.1.0', meta: { sceneName: 42 }, nodes: [{ children: [1] }], zOrder: [], guides: [], code: {} })
    const parsed = parseUiDocument(malformed)
    assert.equal(parsed.ok, false)
    assert.equal(validateDocument(malformed).valid, false)
    assert.doesNotThrow(() => validateDocument({ version: '1.0.0', editorVersion: '1.0.0', meta: { sceneName: 42 } }))
  })

  test('blocks canvas drift and invalid nested conditions/actions', () => {
    const document = createUiDocument()
    document.canvas.width = 900
    assert.equal(parseUiDocument(document).ok, false)
    const text = createDefaultNode('text', { id: 'text_bad', name: 'Bad', parentId: 'node_root' })
    text.condition = { type: 'and', children: [{ type: 'or', children: [{ type: 'code', code: 'if (' }] }] }
    text.events.onClick = { actions: [{ id: 'missing-target', type: 'toggleNode', targetNodeId: 'missing' }] }
    document.canvas.width = document.meta.canvasWidth
    document.nodes.push(text)
    document.nodes[0].children.push(text.id)
    const report = validateDocument(document)
    assert.ok(report.errors.some((issue) => issue.code === 'invalid-code'))
    assert.ok(report.errors.some((issue) => issue.code === 'invalid-reference'))
  })

  test('validates script and message payloads by action type without requiring action ids', () => {
    const document = createUiDocument()
    const text = createDefaultNode('text', { id: 'node_actions', name: 'Actions', parentId: 'node_root' })
    text.events.onClick = {
      actions: [
        { type: 'script', message: 'wrong field' } as never,
        { type: 'showMessage', code: 'wrong field' } as never,
        { type: 'showMessage', message: 'valid payload' } as never,
      ],
    }
    document.nodes.push(text)
    document.nodes[0].children.push(text.id)
    const parsed = parseUiDocument(document)
    assert.equal(parsed.ok, false)
    assert.ok(parsed.issues.some((item) => item.path?.endsWith('actions.0.code')))
    assert.ok(parsed.issues.some((item) => item.path?.endsWith('actions.1.message')))
    assert.ok(!parsed.issues.some((item) => item.message.includes('requires an id')))
  })

  test('normalizes only stable shorthand editor fields while rejecting typed corruption', () => {
    const source = createUiDocument()
    const root = source.nodes[0]
    delete (root.props as unknown as Record<string, unknown>).zIndex
    delete (root as unknown as Record<string, unknown>).propModes
    source.guides.push({ type: 'vertical', position: 100 } as never)
    const parsed = parseUiDocument(source)
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.document.nodes[0].props.zIndex, 0)
      assert.equal(parsed.document.nodes[0].propModes && typeof parsed.document.nodes[0].propModes, 'object')
      assert.equal(parsed.document.guides[0].locked, false)
      assert.match(parsed.document.guides[0].id, /^guide_/)
    }
    const broken = createUiDocument()
    ;(broken.nodes[0].props as unknown as Record<string, unknown>).opacity = 'never'
    const brokenParsed = parseUiDocument(broken)
    assert.equal(brokenParsed.ok, false)
  })

  test('rejects dangerous URL action protocols before export', () => {
    const document = createUiDocument()
    const button = createDefaultNode('button', { id: 'button_url', name: 'UrlButton', parentId: 'node_root' })
    button.events.onClick = { actions: [{ type: 'url', url: 'javascript:alert(1)' }] }
    document.nodes.push(button)
    document.nodes[0].children.push(button.id)
    const parsed = parseUiDocument(document)
    assert.equal(parsed.ok, false)
    assert.throws(() => exportRuntimeDocument(document), UiExportValidationError)
  })

  test('preserves JSON-safe same-version extensions while stripping editor lock state', () => {
    const document = createUiDocument()
    const root = document.nodes[0] as unknown as Record<string, unknown>
    root.runtimeExtension = { featureFlag: true, values: [1, 'two'] }
    ;(document.nodes[0].props as unknown as Record<string, unknown>).runtimeBlend = { mode: 'soft-light' }
    document.nodes[0].locked = true
    const parsed = parseUiDocument(document)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.deepEqual((parsed.document.nodes[0] as unknown as Record<string, unknown>).runtimeExtension, { featureFlag: true, values: [1, 'two'] })
    const runtime = exportRuntimeDocument(parsed.document)
    assert.deepEqual((runtime.nodes[0] as unknown as Record<string, unknown>).runtimeExtension, { featureFlag: true, values: [1, 'two'] })
    assert.equal('locked' in (runtime.nodes[0] as unknown as Record<string, unknown>), false)
  })

  test('rejects unsafe extension keys and malformed cycles during parsing', () => {
    const source = createUiDocument()
    source.nodes[0].children.push('node_root')
    assert.equal(parseUiDocument(source).ok, false)
    const unsafe = JSON.parse(JSON.stringify(createUiDocument())) as Record<string, unknown>
    unsafe.extension = { constructor: 'blocked' }
    const parsed = parseUiDocument(unsafe)
    assert.equal(parsed.ok, false)
    assert.ok(parsed.issues.some((item) => item.path?.includes('extension')))
  })

  test('normalizes condition frequency and rejects unsupported values', () => {
    const source = createUiDocument()
    assert.equal(source.nodes[0].conditionFrequency, 'per-frame')
    const shorthand = JSON.parse(JSON.stringify(source)) as typeof source
    delete (shorthand.nodes[0] as unknown as Record<string, unknown>).conditionFrequency
    const normalized = parseUiDocument(shorthand)
    assert.equal(normalized.ok, true)
    if (normalized.ok) assert.equal(normalized.document.nodes[0].conditionFrequency, 'per-frame')
    source.nodes[0].conditionFrequency = 'unsupported' as never
    assert.equal(parseUiDocument(source).ok, false)
  })
})

describe('ui designer history, geometry and performance', () => {
  test('tracks a saved baseline and caps history at 100 steps', () => {
    const initial = createUiDocument()
    const history = new UiDesignerHistory(initial)
    history.markSaved()
    let current = initial
    for (let index = 0; index < 120; index += 1) {
      current = cloneUiDocument(current)
      current.meta.description = String(index)
      history.commit(current, `Description ${index}`)
    }
    assert.equal(history.entries().length, 100)
    assert.equal(history.isDirty, true)
    history.undo()
    assert.equal(history.canRedo, true)
    history.redo()
    assert.equal(serializeDocument(history.current), serializeDocument(current))
  })

  test('snaps to grid, guides and supports align/distribute', () => {
    const snap = snapPoint({ x: 31, y: 63 }, {
      gridEnabled: true,
      gridSize: 32,
      smartEnabled: false,
      sensitivity: 5,
      guides: [],
    })
    assert.equal(snap.x, 32)
    assert.equal(snap.y, 64)
    const document = createUiDocument()
    const first = createDefaultNode('text', { id: 'a', name: 'A', x: 10, y: 10, width: 20, height: 10 })
    const second = createDefaultNode('text', { id: 'b', name: 'B', x: 80, y: 30, width: 20, height: 10 })
    const third = createDefaultNode('text', { id: 'c', name: 'C', x: 140, y: 50, width: 20, height: 10 })
    document.nodes.push(first, second, third)
    document.nodes[0].children.push(first.id, second.id, third.id)
    const aligned = alignNodes(document, ['a', 'b', 'c'], 'centerY')
    assert.equal(new Set(aligned.nodes.filter((node) => ['a', 'b', 'c'].includes(node.id)).map((node) => node.props.y)).size, 1)
    const distributed = distributeNodes(document, ['a', 'b', 'c'], 'horizontal')
    assert.equal(distributed.nodes.find((node) => node.id === 'b')?.props.x, 75)
  })

  test('converts canvas pointers with scroll, margin, zoom and pan from one source of truth', () => {
    const viewport = { zoom: 2, panX: 12, panY: -8, width: 400, height: 300 }
    const frame = { left: 100, top: 50, scrollLeft: 30, scrollTop: 40, stageMargin: 46 }
    const world = viewportClientToWorld({ x: 100 + 46 + 12 + 20 * 2 - 30, y: 50 + 46 - 8 + 15 * 2 - 40 }, frame, viewport)
    assert.deepEqual(world, { x: 20, y: 15 })
    const content = worldPointToViewport(world, frame, viewport)
    assert.deepEqual(content, { x: 98, y: 68 })
    assert.deepEqual(worldRectToViewport({ x: 20, y: 15, width: 10, height: 5 }, frame, viewport), { x: 98, y: 68, width: 20, height: 10 })
  })

  test('keeps client/world round trips and zoom-at-cursor invariant across zoom levels', () => {
    const frame = { left: 120, top: 70, scrollLeft: 230, scrollTop: 145, stageMargin: 46 }
    const worldPoint = { x: 37.5, y: 18.25 }
    for (const zoom of [0.5, 1, 2]) {
      const viewport = { zoom, panX: -24, panY: 31, width: 800, height: 600 }
      const content = worldPointToViewport(worldPoint, frame, viewport)
      const client = viewportContentToClient(content, frame)
      assert.deepEqual(viewportClientToContent(client, frame), content)
      const roundTrip = viewportClientToWorld(client, frame, viewport)
      assert.ok(Math.abs(roundTrip.x - worldPoint.x) < 1e-9)
      assert.ok(Math.abs(roundTrip.y - worldPoint.y) < 1e-9)
      assert.deepEqual(worldPointToClient(worldPoint, frame, viewport), client)

      const anchor = viewportClientToZoomAnchor(client, frame)
      const next = zoomViewport(viewport, Math.min(3, zoom * 1.5), anchor)
      const before = { x: (anchor.x - viewport.panX) / viewport.zoom, y: (anchor.y - viewport.panY) / viewport.zoom }
      const after = { x: (anchor.x - next.panX) / next.zoom, y: (anchor.y - next.panY) / next.zoom }
      assert.ok(Math.abs(after.x - before.x) < 1e-9)
      assert.ok(Math.abs(after.y - before.y) < 1e-9)
    }
  })

  test('reports particle and code complexity suggestions', () => {
    const document = createUiDocument()
    for (let index = 0; index < 3; index += 1) {
      const particle = createDefaultNode('particle', { id: `particle_${index}`, name: `Particle_${index}`, parentId: 'node_root' })
      particle.props.maxParticles = 120
      for (const property of ['maxParticles', 'velocityX', 'velocityY', 'gravityX', 'gravityY', 'lifetime', 'startScale', 'endScale']) {
        particle.propModes[property] = 'code'
      }
      document.nodes.push(particle)
      document.nodes[0].children.push(particle.id)
    }
    const report = analyzePerformance(document)
    assert.equal(report.particleSystems, 3)
    assert.equal(report.maxParticleTotal, 360)
    assert.equal(report.rating, 'mayStutter')
    assert.ok(report.suggestions.length >= 2)
  })
})
