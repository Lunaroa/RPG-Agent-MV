import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  UiDesignerHistory,
  UiExportValidationError,
  alignNodes,
  accumulateRotationDegrees,
  applyNodeGeometryTransaction,
  analyzePerformance,
  cloneUiDocument,
  clampNodePositionToParent,
  clampNodeRectToParent,
  collectNodeSubtreeIds,
  containContainerChildren,
  copySelection,
  createDefaultNode,
  createUiDocument,
  distributeNodes,
  exportRuntimeDocument,
  importRuntimeSceneDocument,
  groupNodes,
  localResizeNodeRect,
  moveNodeStep,
  moveNodeToEdge,
  nodeVisualCenter,
  normalizeDocumentGeometry,
  normalizePaneSize,
  nodeRect,
  pasteClipboard,
  parseUiDocument,
  pointerResizeDelta,
  reparentNode,
  rotateSubtreeTransforms,
  scaleSubtreeRects,
  serializeDocument,
  shortestRotationDelta,
  snapFeedbackFor,
  snapPoint,
  snapRect,
  smartSnapTargetsForNode,
  type UiDesignerDocument,
  topmostNodeAtPoint,
  resizeRect,
  resizeCursor,
  resolveNodeActionPolicy,
  selectionRootNodeIds,
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
  test('creates a current document with the complete node factory', () => {
    const document = createUiDocument('Scene_Test')
    const types = ['container', 'list', 'sprite', 'nineSlice', 'frameAnimation', 'button', 'text', 'progressBar', 'overlay', 'video', 'particle'] as const
    const nodes = types.map((type, index) => createDefaultNode(type, { id: `node_${index}`, name: `${type}_${index}` }))
    assert.equal(document.meta.sceneName, 'Scene_Test')
    assert.equal(document.nodes[0].type, 'container')
    assert.equal(document.canvas.width, 816)
    assert.equal(nodes.length, 11)
    assert.equal(nodes.every((node) => node.parentId === null && node.props.visible), true)
    assert.equal(nodes.every((node) => node.focusAnim.type === 'none'), true)
    const container = nodes.find((node) => node.type === 'container')
    assert.equal(container?.type === 'container' ? container.props.clip : undefined, false)
    assert.equal(document.nodes[0]?.type === 'container' ? document.nodes[0].props.clip : undefined, true)
    const list = nodes.find((node) => node.type === 'list')
    assert.deepEqual(list?.type === 'list' ? { dataSource: list.props.dataSource, columns: list.props.columns, maxItems: list.props.maxItems, columnWidths: list.props.columnWidths, maxWidth: list.props.maxWidth } : undefined, { dataSource: '[]', columns: 1, maxItems: 100, columnWidths: [], maxWidth: 0 })
    const progress = nodes.find((node) => node.type === 'progressBar')
    assert.equal(progress?.type === 'progressBar' ? progress.props.currentValue : undefined, 50)
    const button = nodes.find((node) => node.type === 'button')
    assert.equal(button?.type === 'button' ? button.props.content : undefined, 'Button')
    const text = nodes.find((node) => node.type === 'text')
    assert.equal(text?.type === 'text' ? text.props.content : undefined, 'Text')
    const particle = nodes.find((node) => node.type === 'particle')
    assert.equal(particle?.type === 'particle' ? particle.props.shape : undefined, 'circle')
    assert.equal(particle?.type === 'particle' ? particle.props.velocityY < 0 : false, true)
    assert.equal(particle?.type === 'particle' ? particle.props.endScale < particle.props.startScale : false, true)
    assert.equal(particle?.type === 'particle' ? particle.props.glow > 0 : false, true)
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

  test('treats a selected container as the transform owner for its complete subtree', () => {
    const document = createUiDocument()
    const parent = createDefaultNode('container', { id: 'node_transform_parent', name: 'TransformParent', parentId: 'node_root' })
    const child = createDefaultNode('text', { id: 'node_transform_child', name: 'TransformChild', parentId: parent.id })
    const grandchild = createDefaultNode('sprite', { id: 'node_transform_grandchild', name: 'TransformGrandchild', parentId: child.id })
    document.nodes.push(parent, child, grandchild)
    document.nodes[0].children.push(parent.id)
    parent.children.push(child.id)
    child.children.push(grandchild.id)

    assert.deepEqual(selectionRootNodeIds(document, [child.id, parent.id, grandchild.id]), [parent.id])
    assert.deepEqual(collectNodeSubtreeIds(document, [parent.id]), [parent.id, child.id, grandchild.id])
  })

  test('clamps moved and resized children to their parent-local bounds', () => {
    const document = createUiDocument()
    const parent = createDefaultNode('container', { id: 'node_bounds_parent', name: 'BoundsParent', parentId: 'node_root', x: 40, y: 30, width: 300, height: 180 })
    const child = createDefaultNode('sprite', { id: 'node_bounds_child', name: 'BoundsChild', parentId: parent.id, x: 40, y: 30, width: 100, height: 60 })
    document.nodes.push(parent, child)
    document.nodes[0].children.push(parent.id)
    parent.children.push(child.id)
    assert.equal(parent.props.clip, false)
    assert.deepEqual(clampNodePositionToParent(document, child.id, { x: 999, y: 999 }), { x: 999, y: 999 })
    assert.deepEqual(clampNodeRectToParent(document, child.id, { x: 300, y: 180, width: 120, height: 80 }), { x: 300, y: 180, width: 120, height: 80 })
    assert.deepEqual(containContainerChildren(document, parent.id, { x: 80, y: 70, width: 40, height: 20 }), { x: 80, y: 70, width: 40, height: 20 })
    parent.props.clip = true
    assert.deepEqual(clampNodePositionToParent(document, child.id, { x: 999, y: 999 }), { x: 240, y: 150 })
    child.props.width = 400
    child.props.height = 240
    assert.deepEqual(clampNodePositionToParent(document, child.id, { x: 999, y: 999 }), { x: 316, y: 186 })
    child.props.width = 100
    child.props.height = 60
    assert.deepEqual(clampNodeRectToParent(document, child.id, { x: 300, y: 180, width: 120, height: 80 }), { x: 220, y: 130, width: 120, height: 80 })
    assert.deepEqual(clampNodeRectToParent(document, child.id, { x: -20, y: -10, width: 500, height: 400 }), { x: 40, y: 30, width: 300, height: 180 })
    assert.deepEqual(clampNodeRectToParent(document, child.id, { x: -20, y: -10, width: 500, height: 400 }, true), { x: 40, y: 30, width: 225, height: 180 })
    assert.deepEqual(containContainerChildren(document, parent.id, { x: 80, y: 70, width: 40, height: 20 }), { x: 40, y: 30, width: 100, height: 60 })
  })

  test('shares structural action policy across multi-select, locks, ancestry and top-level siblings', () => {
    const document = createUiDocument()
    const first = createDefaultNode('text', { id: 'node_first_policy', name: 'FirstPolicy', parentId: 'node_root' })
    const second = createDefaultNode('text', { id: 'node_second_policy', name: 'SecondPolicy', parentId: 'node_root' })
    const group = createDefaultNode('container', { id: 'node_group_policy', name: 'GroupPolicy', parentId: 'node_root' })
    const nested = createDefaultNode('text', { id: 'node_nested_policy', name: 'NestedPolicy', parentId: group.id })
    const topFirst = createDefaultNode('text', { id: 'node_top_first', name: 'TopFirst', parentId: null })
    const topSecond = createDefaultNode('text', { id: 'node_top_second', name: 'TopSecond', parentId: null })
    document.nodes.push(first, second, group, nested, topFirst, topSecond)
    document.nodes[0].children.push(first.id, second.id, group.id)
    group.children.push(nested.id)
    document.zOrder.push(topFirst.id, topSecond.id)

    const retained = resolveNodeActionPolicy(document, [first.id, second.id], first.id, false)
    assert.deepEqual(retained.selectionIds, [first.id, second.id])
    assert.equal(retained.allowed.group, true)
    assert.equal(retained.canTransform, true)
    assert.deepEqual(resolveNodeActionPolicy(document, [first.id, second.id], group.id, false).selectionIds, [group.id])
    assert.equal(resolveNodeActionPolicy(document, ['node_root'], 'node_root', false).allowed.rename, false)
    assert.throws(() => reparentNode(document, first.id, 'node_root', 'before'))
    second.locked = true
    assert.throws(() => reparentNode(document, first.id, second.id, 'before'))
    second.locked = false

    nested.locked = true
    const protectedGroup = resolveNodeActionPolicy(document, [group.id], group.id, false)
    assert.equal(protectedGroup.allowed.delete, false)
    assert.equal(protectedGroup.allowed.duplicate, false)
    assert.equal(protectedGroup.canTransform, false)
    assert.equal(protectedGroup.canReparent, false)
    assert.equal(protectedGroup.canUngroup, false)
    assert.equal(protectedGroup.allowed.toggleLock, true)
    assert.throws(() => reparentNode(document, group.id, document.nodes[0].id, 'inner'))
    assert.throws(() => pasteClipboard(document, copySelection(document, [group.id]), document.nodes[0].id))
    group.locked = true
    const protectedNested = resolveNodeActionPolicy(document, [nested.id], nested.id, false)
    assert.equal(protectedNested.allowed.cut, false)
    assert.equal(protectedNested.allowed.group, false)
    assert.equal(protectedNested.canTransform, false)
    assert.equal(protectedNested.canReparent, false)
    assert.equal(protectedNested.allowed.rename, false)
    assert.equal(protectedNested.allowed.toggleLock, true)

    const firstTopLevel = resolveNodeActionPolicy(document, [topFirst.id], topFirst.id, false)
    assert.equal(firstTopLevel.allowed.moveUp, false)
    assert.equal(firstTopLevel.allowed.moveTop, true)
    assert.equal(firstTopLevel.allowed.moveBottom, false)
    const movedTopLevel = moveNodeStep(document, topSecond.id, 'up')
    assert.deepEqual(movedTopLevel.zOrder, ['node_root', topSecond.id, topFirst.id])
    assert.deepEqual(moveNodeStep(movedTopLevel, topSecond.id, 'up').zOrder, movedTopLevel.zOrder)
    assert.deepEqual(moveNodeToEdge(document, topFirst.id, 'bottom').zOrder, ['node_root', topFirst.id, topSecond.id])
    assert.deepEqual(moveNodeToEdge(document, topSecond.id, 'top').zOrder, ['node_root', topFirst.id, topSecond.id])
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

  test('keeps particle blend modes aligned with the shared Runtime contract', () => {
    const source = createUiDocument()
    const particle = createDefaultNode('particle', { id: 'particle_contract', name: 'Particle', parentId: 'node_root' })
    particle.props.blendMode = 'multiply' as never
    source.nodes.push(particle)
    source.nodes[0].children.push(particle.id)
    const parsed = parseUiDocument(source)
    assert.equal(parsed.ok, false)
    assert.equal(parsed.issues.some((entry) => entry.path === 'nodes.1.props.blendMode'), true)
  })
})

describe('ui designer history, geometry and performance', () => {
  test('accumulates clockwise and counterclockwise rotation symmetrically across zero degrees', () => {
    assert.equal(shortestRotationDelta(5, 355), -10)
    assert.equal(shortestRotationDelta(355, 5), 10)
    assert.equal(accumulateRotationDegrees(5, 5, 355), -5)
    assert.equal(accumulateRotationDegrees(355, 355, 5), 365)
  })

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

  test('snap hits identify their alignment source for transient feedback', () => {
    const options = {
      gridEnabled: false,
      smartEnabled: true,
      sensitivity: 6,
      canvasWidth: 400,
      canvasHeight: 300,
      guides: [{ id: 'guide_v', type: 'vertical' as const, position: 120, locked: false }],
      targets: [{ id: 'target', rect: { x: 210, y: 40, width: 60, height: 30 } }],
    }
    const smart = snapPoint({ x: 213, y: 20 }, options)
    assert.deepEqual(smart.hits, [{ axis: 'x', value: 210, source: 'node', nodeId: 'target' }])
    const guide = snapPoint({ x: 123, y: 100 }, options)
    assert.deepEqual(guide.hits, [{ axis: 'x', value: 120, source: 'guide', guideId: 'guide_v' }])
    const canvasCenter = snapPoint({ x: 197, y: 147 }, options)
    assert.deepEqual(canvasCenter.hits, [
      { axis: 'x', value: 200, source: 'canvas' },
      { axis: 'y', value: 150, source: 'canvas' },
    ])
    const grid = snapPoint({ x: 31, y: 63 }, { gridEnabled: true, gridSize: 32, smartEnabled: false, sensitivity: 5, guides: [] })
    assert.deepEqual(grid.hits, [])

    const document = { nodes: [createDefaultNode('text', { id: 'target', x: 210, y: 40, width: 60, height: 30 })], canvas: { width: 400, height: 300 } } as unknown as UiDesignerDocument
    const feedback = snapFeedbackFor(document, { x: 180, y: 60, width: 40, height: 20 }, [
      { axis: 'x', value: 210, source: 'node', nodeId: 'target' },
      { axis: 'y', value: 150, source: 'canvas' },
      { axis: 'x', value: 120, source: 'guide', guideId: 'guide_v' },
    ])
    assert.deepEqual(feedback.lines, [
      { axis: 'x', position: 210, start: 40, end: 80, source: 'node' },
      { axis: 'y', position: 150, start: 0, end: 400, source: 'canvas' },
    ])
    assert.deepEqual(feedback.guideIds, ['guide_v'])
  })

  test('stores one canonical history point per explicit Inspector transaction', () => {
    const initial = createUiDocument()
    const history = new UiDesignerHistory(initial)
    const edited = cloneUiDocument(initial)
    edited.nodes[0].props.opacity = 192
    const current = history.commitOwned(edited, 'Update opacity')
    assert.equal(history.availableUndoSteps, 1)
    assert.equal(current.nodes[0].props.opacity, 192)
    assert.equal(history.undo().nodes[0].props.opacity, 255)
    assert.equal(history.redo().nodes[0].props.opacity, 192)
  })

  test('normalizes geometry and pane sizes through one deterministic integer contract', () => {
    const document = createUiDocument()
    document.canvas.width = 816.6
    document.canvas.height = 623.5
    document.meta.canvasWidth = 816.6
    document.meta.canvasHeight = 623.5
    const node = createDefaultNode('text', { id: 'node_decimal', name: 'Decimal', parentId: 'node_root' })
    node.props.x = 10.4
    node.props.y = -2.6
    node.props.width = 100.5
    node.props.height = 50.49
    document.nodes.push(node)
    document.nodes[0].children.push(node.id)
    const parsed = parseUiDocument(document)
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.deepEqual([parsed.document.nodes.at(-1)?.props.x, parsed.document.nodes.at(-1)?.props.y], [10, -3])
    const normalized = normalizeDocumentGeometry(document)
    assert.deepEqual([normalized.canvas.width, normalized.canvas.height], [817, 624])
    assert.deepEqual([normalized.nodes.at(-1)?.props.x, normalized.nodes.at(-1)?.props.y, normalized.nodes.at(-1)?.props.width, normalized.nodes.at(-1)?.props.height], [10, -3, 101, 50])
    const updated = applyNodeGeometryTransaction(normalized, node.id, { kind: 'properties', patch: { x: 12.6, y: 4.4, width: 80.8, height: 40.2 } })
    assert.deepEqual([updated.nodes.at(-1)?.props.x, updated.nodes.at(-1)?.props.y, updated.nodes.at(-1)?.props.width, updated.nodes.at(-1)?.props.height], [13, 4, 81, 40])
    const history = new UiDesignerHistory(document)
    assert.equal(history.current.nodes.at(-1)?.props.width, 101)
    assert.equal(importRuntimeSceneDocument(exportRuntimeDocument(document)).nodes.at(-1)?.props.height, 50)
    assert.equal(normalizePaneSize('left', 260.6), 261)
    assert.equal(normalizePaneSize('right', 1000), 550)
  })

  test('resizes freely by default, preserves aspect on request, supports Alt center and snap targets', () => {
    const origin = { x: 10, y: 20, width: 100, height: 50 }
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const resized = resizeRect(origin, handle, { x: 12, y: 7 }, { preserveAspect: true, fromCenter: false })
      assert.ok(Math.abs(resized.width / resized.height - 2) < 1e-9, handle)
    }
    const sideLocked = resizeRect(origin, 'e', { x: 12, y: 0 }, { preserveAspect: true, fromCenter: false })
    assert.notEqual(sideLocked.height, origin.height)
    const sideFree = resizeRect(origin, 'e', { x: 12, y: 0 }, { preserveAspect: false, fromCenter: false })
    assert.equal(sideFree.height, origin.height)
    const centered = resizeRect(origin, 'se', { x: 10, y: 5 }, { preserveAspect: true, fromCenter: true })
    assert.deepEqual({ x: centered.x + centered.width / 2, y: centered.y + centered.height / 2 }, { x: 60, y: 45 })
    // Aspect-locked corner drags track the pointer along the corner direction:
    // a pointer moving exactly along the diagonal keeps the corner under the cursor.
    const diagonal = resizeRect(origin, 'se', { x: 20, y: 10 }, { preserveAspect: true, fromCenter: false })
    assert.deepEqual([diagonal.x + diagonal.width, diagonal.y + diagonal.height], [130, 80])
    const offAxis = resizeRect(origin, 'se', { x: 30, y: 60 }, { preserveAspect: true, fromCenter: false })
    assert.ok(Math.abs(offAxis.width - 148) < 1e-9)

    const options = { gridEnabled: true, gridSize: 16, smartEnabled: true, sensitivity: 3, guides: [{ id: 'guide', type: 'vertical' as const, position: 150, locked: false }], targets: [{ id: 'target', rect: { x: 200, y: 20, width: 40, height: 50 } }] }
    const grid = snapRect(resizeRect(origin, 'e', { x: 17, y: 0 }, { preserveAspect: false, fromCenter: false }), origin, 'e', { preserveAspect: false, fromCenter: false }, options)
    assert.deepEqual([grid.x, grid.width, grid.x + grid.width], [10, 118, 128])
    const guide = snapRect(resizeRect(origin, 'e', { x: 39, y: 0 }, { preserveAspect: false, fromCenter: false }), origin, 'e', { preserveAspect: false, fromCenter: false }, options)
    assert.equal(guide.x + guide.width, 150)
    const smart = snapRect(resizeRect(origin, 'e', { x: 88, y: 0 }, { preserveAspect: false, fromCenter: false }), origin, 'e', { preserveAspect: false, fromCenter: false }, options)
    assert.equal(smart.x + smart.width, 200)
    const aspect = snapRect(resizeRect(origin, 'e', { x: 17, y: 0 }, { preserveAspect: true, fromCenter: false }), origin, 'e', { preserveAspect: true, fromCenter: false }, options)
    assert.equal(aspect.width / aspect.height, 2)
    const disabled = snapRect(resizeRect(origin, 'e', { x: 17, y: 0 }, { preserveAspect: false, fromCenter: false }), origin, 'e', { preserveAspect: false, fromCenter: false }, { ...options, enabled: false })
    assert.deepEqual([disabled.width, disabled.snapped, disabled.guides.length], [117, false, 0])
    assert.equal(resizeCursor('e', 0), 'ew-resize')
    assert.equal(resizeCursor('e', 90), 'ns-resize')
  })

  test('pointer-driven resize keeps the min-1 floor recoverable without gesture state', () => {
    const node = createDefaultNode('sprite', { id: 'node_drag', name: 'Drag', parentId: 'node_root' })
    node.props.x = 100
    node.props.y = 100
    node.props.width = 160
    node.props.height = 80
    const origin = nodeRect(node)
    const modifiers = { preserveAspect: false, fromCenter: false }
    const dragWest = (pointerX: number) => resizeRect(origin, 'w', pointerResizeDelta(node, origin, 'w', { x: pointerX, y: 130 }, false), modifiers)
    assert.deepEqual(dragWest(60), { x: 60, y: 100, width: 200, height: 80 })
    assert.equal(dragWest(250).width, 10)
    assert.equal(dragWest(259).width, 1)
    assert.equal(dragWest(400).width, 1)
    assert.equal(dragWest(240).width, 20)
  })

  test('rebuilds resized rects in the node local frame so rotated nodes grow along their own axes', () => {
    const node = createDefaultNode('sprite', { id: 'node_rot', name: 'Rotated', parentId: 'node_root' })
    node.props.x = 500
    node.props.y = 500
    node.props.width = 100
    node.props.height = 50
    node.props.rotate = 90
    const origin = nodeRect(node)
    assert.deepEqual(localResizeNodeRect(node, origin, 'w', 140, 50, false), { x: 500, y: 460, width: 140, height: 50 })
  })

  test('scales subtree rects through the container local frame for rotated containers', () => {
    const document = createUiDocument()
    const container = createDefaultNode('container', { id: 'rot_container', name: 'Rotated', parentId: 'node_root' })
    container.props.x = 500
    container.props.y = 500
    container.props.width = 100
    container.props.height = 50
    container.props.rotate = 90
    const child = createDefaultNode('sprite', { id: 'rot_child', name: 'Child', parentId: 'rot_container' })
    child.props.x = 510
    child.props.y = 510
    document.nodes.push(container, child)
    document.nodes[0].children.push(container.id)
    container.children.push(child.id)
    const origin = nodeRect(container)
    const final = { x: origin.x, y: origin.y, width: 120, height: 50 }
    const subtreeIds = collectNodeSubtreeIds(document, [container.id]).filter((id) => id !== container.id)
    assert.deepEqual(scaleSubtreeRects(document, subtreeIds, container.id, origin, final, 'w', false), {
      rot_child: { x: 510, y: 492, width: 192, height: 80 },
    })
  })

  test('rotates a nested subtree rigidly around the selection visual center for any anchor', () => {
    const document = createUiDocument()
    const container = createDefaultNode('container', { id: 'nest_container', name: 'Nest', parentId: 'node_root' })
    container.props.width = 240
    container.props.height = 160
    container.props.anchorX = 0.5
    container.props.anchorY = 0.5
    container.props.x = 360
    container.props.y = 260
    const nested = createDefaultNode('container', { id: 'nest_inner', name: 'Inner', parentId: 'nest_container' })
    nested.props.x = 264
    nested.props.y = 212
    const leaf = createDefaultNode('text', { id: 'nest_leaf', name: 'Leaf', parentId: 'nest_inner' })
    leaf.props.x = 300
    leaf.props.y = 240
    document.nodes.push(container, nested, leaf)
    document.nodes[0].children.push(container.id)
    container.children.push(nested.id)
    nested.children.push(leaf.id)
    const drafts = rotateSubtreeTransforms(document, collectNodeSubtreeIds(document, [container.id]), container.id, 180)
    assert.deepEqual(drafts.positions, { nest_container: { x: 360, y: 260 }, nest_inner: { x: 456, y: 308 }, nest_leaf: { x: 420, y: 280 } })
    assert.deepEqual(drafts.rotations, { nest_container: 180, nest_inner: 180, nest_leaf: 180 })
  })

  test('limits smart resize snap targets to visible unlocked siblings in the same local space', () => {
    const document = createUiDocument()
    const source = createDefaultNode('text', { id: 'snap_source', name: 'Source', parentId: 'node_root' })
    const sibling = createDefaultNode('text', { id: 'snap_sibling', name: 'Sibling', parentId: 'node_root', x: 120, y: 48 })
    const hidden = createDefaultNode('text', { id: 'snap_hidden', name: 'Hidden', parentId: 'node_root' })
    hidden.props.visible = false
    const locked = createDefaultNode('text', { id: 'snap_locked', name: 'Locked', parentId: 'node_root' })
    locked.locked = true
    const container = createDefaultNode('container', { id: 'snap_container', name: 'Container', parentId: 'node_root' })
    const nested = createDefaultNode('text', { id: 'snap_nested', name: 'Nested', parentId: container.id })
    document.nodes.push(source, sibling, hidden, locked, container, nested)
    document.nodes[0].children.push(source.id, sibling.id, hidden.id, locked.id, container.id)
    container.children.push(nested.id)

    assert.deepEqual(smartSnapTargetsForNode(document, source.id), [{ id: sibling.id, rect: nodeRect(sibling) }, { id: container.id, rect: nodeRect(container) }])
    assert.deepEqual(smartSnapTargetsForNode(document, nested.id), [])
    assert.deepEqual(smartSnapTargetsForNode(document, 'missing'), [])
  })

  test('resolves the visible top-most canvas node at a context-menu point', () => {
    const document = createUiDocument()
    const background = createDefaultNode('container', { id: 'context_background', name: 'Background', parentId: 'node_root', x: 40, y: 40, width: 220, height: 180 })
    const front = createDefaultNode('text', { id: 'context_front', name: 'Front', parentId: 'node_root', x: 80, y: 80, width: 120, height: 50 })
    const hidden = createDefaultNode('button', { id: 'context_hidden', name: 'Hidden', parentId: 'node_root', x: 80, y: 80, width: 120, height: 50 })
    background.props.zIndex = 1
    front.props.zIndex = 2
    hidden.props.zIndex = 3
    hidden.props.visible = false
    document.nodes.push(background, front, hidden)
    document.nodes[0].children.push(background.id, front.id, hidden.id)

    assert.equal(topmostNodeAtPoint(document, { x: 100, y: 100 })?.id, front.id)
    assert.equal(topmostNodeAtPoint(document, { x: 50, y: 50 })?.id, background.id)
    assert.equal(topmostNodeAtPoint(document, { x: 320, y: 180 }, false, {
      [front.id]: { x: 300, y: 160, width: 120, height: 50, visible: true },
    })?.id, front.id)
    assert.equal(topmostNodeAtPoint(document, { x: 700, y: 500 }), undefined)
  })

  test('hit testing treats the last tree sibling as the front-most layer', () => {
    const document = createUiDocument()
    const front = createDefaultNode('container', { id: 'hit_front', name: 'Front', parentId: 'node_root', x: 0, y: 0, width: 200, height: 200 })
    const back = createDefaultNode('button', { id: 'hit_back', name: 'Back', parentId: 'node_root', x: 0, y: 0, width: 200, height: 200 })
    document.nodes.push(front, back)
    document.nodes[0].children.push(front.id, back.id)

    assert.equal(topmostNodeAtPoint(document, { x: 100, y: 100 })?.id, back.id)

    const reordered = reparentNode(document, front.id, back.id, 'after')
    assert.equal(topmostNodeAtPoint(reordered, { x: 100, y: 100 })?.id, front.id)
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
