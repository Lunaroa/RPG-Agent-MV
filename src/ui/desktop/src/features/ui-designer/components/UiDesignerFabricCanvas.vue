<script setup lang="ts">
import { ActiveSelection, Canvas, Point, Textbox, type FabricObject } from 'fabric'
import { isRef, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { UiDesignerDocument, UiNode, UiPoint, UiProjectResourceCatalog, UiRect } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { accumulateRotationDegrees, nodeRect, normalizeRotationDegrees, pointerResizeDelta, type UiResizeHandle } from '../models/geometry'
import { collectNodeSubtreeIds, selectionRootNodeIds } from '../models/tree'
import {
  animateFabricNode,
  applyFabricNodeGeometry,
  createFabricNodeObject,
  disposeFabricNodeObject,
  fabricNodeVisualSignature,
  positionFabricNodeFromRect,
  scopeNodes,
  type UiFabricNodeObject,
} from '../fabric/fabricNodeFactory'
import { resolveUiContainerLabelLayout } from '../fabric/uiContainerLabel'
import { useUiDesignerI18n } from '../i18n'
import type { UiCanvasWorkspace } from '../models/canvas-workspace'
import { normalizeUiSingleLineText } from '../fabric/uiSingleLineText'

const props = defineProps<{
  designer: UiDesignerController
  document: UiDesignerDocument
  resourceCatalog?: UiProjectResourceCatalog | null
  scopeNodeId: string
  workspace: UiCanvasWorkspace
  zoom: number
  active: boolean
}>()
const emit = defineEmits<{
  activate: [node: UiNode]
  contextmenu: [payload: { event: MouseEvent; node?: UiNode }]
}>()

const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const { language: designerLanguage } = useUiDesignerI18n()
const canvasElement = ref<HTMLCanvasElement>()
let canvas: Canvas | undefined
let reconcileGeneration = 0
let renderFrame = 0
let syncingSelection = false
let selectionSyncQueued = false
let reconcileRunning = 0
const objects = new Map<string, UiFabricNodeObject>()
const containerLabels = new Map<string, Textbox>()

interface TransformState {
  action: 'move' | 'resize' | 'rotate'
  nodeIds: string[]
  subtreeIds: string[]
  origins: Record<string, { x: number; y: number }>
  nodeId?: string
  originRect?: UiRect
  originRotation?: number
  lastFabricRotation?: number
  accumulatedRotation?: number
  corner?: string
  targetLeft?: number
  targetTop?: number
  pointerStart?: UiPoint
}

let transformState: TransformState | undefined

const nodeById = (id: string) => props.document.nodes.find((node) => node.id === id)
const objectNodeId = (object?: FabricObject) => (object as UiFabricNodeObject | undefined)?.data?.nodeId
const objectNode = (object?: FabricObject) => {
  const nodeId = objectNodeId(object)
  return nodeId ? nodeById(nodeId) : undefined
}
const objectList = (target: FabricObject) => target instanceof ActiveSelection ? target.getObjects() : [target]
const selectedObjectIds = (target?: FabricObject) => target ? objectList(target).map(objectNodeId).filter((id): id is string => Boolean(id)) : []
const contextNode = (target?: FabricObject) => {
  const direct = objectNode(target)
  if (direct) return direct
  if (!(target instanceof ActiveSelection)) return undefined
  const selectedId = selectedObjectIds(target)[0] ?? unwrap(props.designer.selectedIds)[0]
  return selectedId ? nodeById(selectedId) : undefined
}
const contextTargetAt = (event: MouseEvent, target?: FabricObject) => {
  if (target || !canvas) return target
  const active = canvas.getActiveObject()
  if (!(active instanceof ActiveSelection)) return undefined
  return active.containsPoint(canvas.getScenePoint(event)) ? active : undefined
}

const applyControllerSelection = (target?: FabricObject) => {
  // Reconcile removes and recreates objects; fabric reports that as selection
  // events, but the controller's selection stays authoritative and is
  // reasserted by syncFabricSelection at the end of reconcile.
  if (syncingSelection || reconcileRunning > 0) return
  const ids = selectedObjectIds(target)
  syncingSelection = true
  props.designer.selectNodes(ids.length ? ids : [props.scopeNodeId])
  void nextTick(() => { syncingSelection = false })
}

const syncFabricSelection = () => {
  if (!canvas) return
  if (syncingSelection) {
    selectionSyncQueued = true
    return
  }
  const ids = unwrap(props.designer.selectedIds)
  const selected = ids.map((id) => objects.get(id)).filter((object): object is UiFabricNodeObject => Boolean(object))
  syncingSelection = true
  const active = canvas.getActiveObject()
  if (active && (selected.length !== 1 || active !== selected[0])) canvas.discardActiveObject()
  selected.forEach((object) => object.setCoords())
  if (!selected.length) canvas.discardActiveObject()
  else if (selected.length === 1) canvas.setActiveObject(selected[0])
  else {
    const selection = new ActiveSelection(selected, { canvas, hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true })
    canvas.setActiveObject(selection)
  }
  canvas.requestRenderAll()
  void nextTick(() => {
    syncingSelection = false
    if (!selectionSyncQueued) return
    selectionSyncQueued = false
    syncFabricSelection()
  })
}

const attachTextEditing = (object: UiFabricNodeObject) => {
  if (!(object instanceof Textbox)) return
  object.on('editing:exited', () => {
    const nodeId = object.data.nodeId
    const node = nodeById(nodeId)
    if (node && (node.type === 'text' || node.type === 'button')) props.designer.commitNodePropertyPreview(nodeId, 'content')
  })
}

const removeObject = (nodeId: string) => {
  const object = objects.get(nodeId)
  if (object) {
    canvas?.remove(object)
    objects.delete(nodeId)
    disposeFabricNodeObject(object)
  }
  const label = containerLabels.get(nodeId)
  if (label) {
    canvas?.remove(label)
    containerLabels.delete(nodeId)
    label.dispose()
  }
}

const syncContainerLabel = (nodeId: string) => {
  if (!canvas) return
  const node = nodeById(nodeId)
  const object = objects.get(nodeId)
  if (!node || node.type !== 'container' && node.type !== 'list' || !object) {
    const existing = containerLabels.get(nodeId)
    if (existing) {
      canvas.remove(existing)
      containerLabels.delete(nodeId)
      existing.dispose()
    }
    return
  }
  let label = containerLabels.get(nodeId)
  if (!label) {
    label = new Textbox(node.name, {
      originX: 'left',
      originY: 'bottom',
      fill: '#c7cbd6',
      selectable: false,
      evented: false,
      objectCaching: false,
      excludeFromExport: true,
    })
    containerLabels.set(nodeId, label)
    canvas.add(label)
  }
  const layout = resolveUiContainerLabelLayout(object.getCoords(), props.zoom, node.name)
  label.set({
    text: node.name,
    ...layout,
    angle: 0,
    visible: object.visible,
  })
  label.setCoords()
}

const syncContainerLabels = () => {
  for (const nodeId of [...containerLabels.keys()]) if (!objects.has(nodeId)) syncContainerLabel(nodeId)
  for (const nodeId of objects.keys()) syncContainerLabel(nodeId)
  const offset = objects.size
  ;[...containerLabels.values()].forEach((label, index) => canvas?.moveObjectTo(label, offset + index))
  canvas?.requestRenderAll()
}

const reconcile = async () => {
  if (!canvas) return
  const generation = ++reconcileGeneration
  reconcileRunning += 1
  try {
  // Geometry below is written in canvas-absolute coordinates. Objects inside a
  // multi-select ActiveSelection interpret left/top relative to the selection
  // group, so dissolve it first; syncFabricSelection rebuilds it at the end.
  if (canvas.getActiveObject() instanceof ActiveSelection) {
    syncingSelection = true
    canvas.discardActiveObject()
    syncingSelection = false
  }
  const desiredNodes = scopeNodes(props.document, props.scopeNodeId)
  const desiredIds = new Set(desiredNodes.map((node) => node.id))
  for (const nodeId of [...objects.keys()]) if (!desiredIds.has(nodeId)) removeObject(nodeId)
  for (const node of desiredNodes) {
    const signature = fabricNodeVisualSignature(node, props.resourceCatalog)
    let object = objects.get(node.id)
    if (object && object.data.signature !== signature) {
      removeObject(node.id)
      object = undefined
    }
    if (!object) {
      const created = await createFabricNodeObject(node, props.resourceCatalog, props.document, designerLanguage.value)
      if (generation !== reconcileGeneration || !canvas || !nodeById(node.id)) {
        disposeFabricNodeObject(created)
        continue
      }
      object = created
      objects.set(node.id, object)
      attachTextEditing(object)
      canvas.add(object)
    }
    const current = nodeById(node.id)
    if (current) {
      applyFabricNodeGeometry(object, current, props.document)
      syncContainerLabel(current.id)
    }
  }
  if (generation !== reconcileGeneration || !canvas) return
  desiredNodes.forEach((node, index) => {
    const object = objects.get(node.id)
    if (object) canvas?.moveObjectTo(object, index)
  })
  syncContainerLabels()
  syncFabricSelection()
  canvas.requestRenderAll()
  } finally {
    reconcileRunning -= 1
  }
}

const startTransform = (event: { e?: MouseEvent; transform: { target: FabricObject; action?: string; corner: string; original: { left: number; top: number } } }) => {
  const target = event.transform.target
  const ids = selectionRootNodeIds(props.document, selectedObjectIds(target))
  if (!ids.length) return
  const actionName = event.transform.action ?? ''
  const action = actionName === 'drag' ? 'move' : actionName.startsWith('rotate') ? 'rotate' : 'resize'
  const subtreeIds = collectNodeSubtreeIds(props.document, ids)
  const transformIds = action === 'move' ? subtreeIds : ids
  const origins = Object.fromEntries(transformIds.map((id) => {
    const node = nodeById(id)
    return [id, { x: node?.props.x ?? 0, y: node?.props.y ?? 0 }]
  }))
  const nodeId = ids.length === 1 ? ids[0] : undefined
  const node = nodeId ? nodeById(nodeId) : undefined
  transformState = {
    action,
    nodeIds: ids,
    subtreeIds,
    origins,
    nodeId,
    originRect: node ? nodeRect(node) : undefined,
    originRotation: node?.props.rotate,
    lastFabricRotation: node ? normalizeRotationDegrees(target.angle) : undefined,
    accumulatedRotation: node?.props.rotate,
    corner: event.transform.corner,
    targetLeft: event.transform.original.left,
    targetTop: event.transform.original.top,
    pointerStart: event.e && Number.isFinite(event.e.clientX) && Number.isFinite(event.e.clientY)
      ? { x: event.e.clientX, y: event.e.clientY }
      : undefined,
  }
}

const moveObject = (target: FabricObject, event?: MouseEvent) => {
  const state = transformState
  if (!state || state.action !== 'move') return
  const zoom = Math.max(0.01, Number.isFinite(props.zoom) ? props.zoom : 1)
  const rawDelta = state.pointerStart && event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
    ? { x: (event.clientX - state.pointerStart.x) / zoom, y: (event.clientY - state.pointerStart.y) / zoom }
    : { x: target.left - (state.targetLeft ?? target.left), y: target.top - (state.targetTop ?? target.top) }
  const shiftKey = Boolean(event?.shiftKey)
  const axisLock = shiftKey ? (Math.abs(rawDelta.x) >= Math.abs(rawDelta.y) ? 'x' : 'y') : undefined
  const delta = axisLock === 'x' ? { x: rawDelta.x, y: 0 } : axisLock === 'y' ? { x: 0, y: rawDelta.y } : rawDelta
  const drafts = props.designer.previewSelectedPositionsWithSnap(state.nodeIds, state.origins, delta, axisLock)
  const anchorId = state.nodeIds[0]
  const anchorDraft = drafts[anchorId]
  const anchorOrigin = state.origins[anchorId]
  if (anchorDraft && anchorOrigin) {
    target.set({
      left: (state.targetLeft ?? target.left) + anchorDraft.x - anchorOrigin.x,
      top: (state.targetTop ?? target.top) + anchorDraft.y - anchorOrigin.y,
    }).setCoords()
  }
  // ActiveSelection members interpret left/top relative to the selection group;
  // fabric already moves them with the group, so writing absolute drafts to them
  // would teleport them mid-drag. Non-member descendants stay flat/absolute.
  const selectionMembers = target instanceof ActiveSelection ? new Set(target.getObjects()) : undefined
  for (const [id, position] of Object.entries(drafts)) {
    const object = objects.get(id)
    if (!object) continue
    if (selectionMembers?.has(object)) {
      // fabric moves members with the group and getCoords() applies the group
      // transform, so labels can track them without writing geometry.
      syncContainerLabel(id)
      continue
    }
    object.set({ left: position.x, top: position.y }).setCoords()
    syncContainerLabel(id)
  }
  canvas?.requestRenderAll()
}

const cornerHandle = (corner: string): UiResizeHandle => ({ tl: 'nw', mt: 'n', tr: 'ne', mr: 'e', br: 'se', mb: 's', bl: 'sw', ml: 'w' } as const)[corner as 'tl'] ?? 'se'

const scaleObject = (target: FabricObject, shiftKey: boolean, altKey: boolean, corner: string, pointer: UiPoint) => {
  const state = transformState
  if (!state?.nodeId || !state.originRect || target instanceof ActiveSelection) return
  const node = nodeById(state.nodeId)
  if (!node) return
  const handle = cornerHandle(corner || state.corner || 'br')
  const delta = pointerResizeDelta(node, state.originRect, handle, pointer, altKey)
  const rect = props.designer.previewNodeResizeWithSnap(node.id, state.originRect, handle, delta, { preserveAspect: shiftKey, fromCenter: altKey })
  if (!rect) return
  const drafts = unwrap(props.designer.draftRects)
  const draftRect = drafts[state.nodeId]
  if (!draftRect) return
  positionFabricNodeFromRect(target as UiFabricNodeObject, node, props.document, draftRect)
  if (node.type === 'container' || node.type === 'list') syncContainerLabel(node.id)
}

const rotateObject = (target: FabricObject, shiftKey: boolean) => {
  const state = transformState
  if (!state?.nodeId || state.originRotation === undefined || target instanceof ActiveSelection) return
  const node = nodeById(state.nodeId)
  if (!node) return
  const wrappedAngle = normalizeRotationDegrees(target.angle)
  const accumulatedAngle = accumulateRotationDegrees(
    state.accumulatedRotation ?? state.originRotation,
    state.lastFabricRotation ?? normalizeRotationDegrees(state.originRotation),
    wrappedAngle,
  )
  state.lastFabricRotation = wrappedAngle
  state.accumulatedRotation = accumulatedAngle
  const angle = shiftKey ? Math.round(accumulatedAngle / 15) * 15 : accumulatedAngle
  if (props.designer.previewNodeRotation(state.nodeId, angle) === undefined) return
  const rotations = unwrap(props.designer.draftRotations)
  const positions = unwrap(props.designer.draftPositions)
  for (const id of state.subtreeIds) {
    const draftRotation = rotations[id]
    const draftPosition = positions[id]
    const object = id === state.nodeId ? target : objects.get(id)
    const draftNode = nodeById(id)
    if (draftRotation === undefined || draftPosition === undefined || !object || !draftNode) continue
    object.set({ angle: draftRotation })
    object.setPositionByOrigin(new Point(draftPosition.x, draftPosition.y), draftNode.props.anchorX, draftNode.props.anchorY)
    object.setCoords()
    if (draftNode.type === 'container' || draftNode.type === 'list') syncContainerLabel(id)
  }
}

const commitTransform = () => {
  const state = transformState
  transformState = undefined
  if (!state) return
  if (state.action === 'move') props.designer.commitDraftPositions(state.nodeIds)
  else if (state.action === 'resize' && state.nodeId) props.designer.commitDraftRect(state.nodeId)
  else if (state.action === 'rotate' && state.nodeId) props.designer.commitDraftRotation(state.nodeId)
}

const startEditing = (object: UiFabricNodeObject) => {
  const node = objectNode(object)
  if (!(object instanceof Textbox) || !node || node.locked || (node.type !== 'text' && node.type !== 'button')) return false
  canvas?.setActiveObject(object)
  object.enterEditing()
  object.selectAll()
  object.hiddenTextarea?.focus()
  canvas?.requestRenderAll()
  return true
}

const activateObject = (object?: FabricObject) => {
  const node = objectNode(object)
  if (!node || node.locked) return
  if (object && startEditing(object as UiFabricNodeObject)) return
  emit('activate', node)
}

const activateNode = (nodeId: string) => {
  const object = objects.get(nodeId)
  if (!object) return false
  canvas?.setActiveObject(object)
  canvas?.requestRenderAll()
  const node = nodeById(nodeId)
  if (node && (node.type === 'text' || node.type === 'button')) return startEditing(object)
  if (node) emit('activate', node)
  return true
}

const captureThumbnail = (): string | undefined => {
  if (!canvas) return undefined
  const width = Math.max(1, props.document.canvas.width)
  const height = Math.max(1, props.document.canvas.height)
  const scale = Math.min(320 / width, 180 / height, 1)
  const hidden = [
    ...[...containerLabels.values()].map((object) => ({ object, visible: object.visible })),
    ...[...objects.values()]
      .filter((object) => object.data.nodeType === 'list')
      .map((object) => ({ object, visible: object.visible })),
  ]
  hidden.forEach(({ object }) => { object.visible = false })
  let source: HTMLCanvasElement
  try {
    source = canvas.toCanvasElement(1, {
      left: props.workspace.left,
      top: props.workspace.top,
      width,
      height,
    })
  } finally {
    hidden.forEach(({ object, visible }) => { object.visible = visible })
  }
  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(width * scale))
  output.height = Math.max(1, Math.round(height * scale))
  const context = output.getContext('2d')
  if (!context) return undefined
  context.fillStyle = props.document.canvas.backgroundColor || '#000000'
  context.fillRect(0, 0, output.width, output.height)
  context.drawImage(source, 0, 0, output.width, output.height)
  return output.toDataURL('image/png')
}

defineExpose({ activateNode, captureThumbnail })

const animationLoop = (timestamp: number) => {
  if (canvas && props.active) {
    let animated = false
    for (const [nodeId, object] of objects) {
      const node = nodeById(nodeId)
      if (!node) continue
      animated = animateFabricNode(object, node, timestamp) || animated || Boolean(object.data.videoElement && !object.data.videoElement.paused)
    }
    if (animated) canvas.requestRenderAll()
  }
  renderFrame = window.requestAnimationFrame(animationLoop)
}

onMounted(() => {
  const element = canvasElement.value
  if (!element) return
  canvas = new Canvas(element, {
    width: props.workspace.width,
    height: props.workspace.height,
    viewportTransform: [1, 0, 0, 1, props.workspace.left, props.workspace.top],
    selection: true,
    selectionKey: ['shiftKey', 'ctrlKey', 'metaKey'],
    preserveObjectStacking: true,
    uniformScaling: false,
    uniScaleKey: 'shiftKey',
    centeredKey: 'altKey',
    fireRightClick: true,
    stopContextMenu: true,
    renderOnAddRemove: false,
    backgroundColor: '#00000000',
  })
  canvas.on('selection:created', (event) => applyControllerSelection(event.selected.length > 1 ? canvas?.getActiveObject() : event.selected[0]))
  canvas.on('selection:updated', () => applyControllerSelection(canvas?.getActiveObject()))
  canvas.on('selection:cleared', () => applyControllerSelection(undefined))
  canvas.on('before:transform', (event) => startTransform({ ...event, e: event.e as MouseEvent | undefined }))
  canvas.on('object:moving', (event) => moveObject(event.target, event.e as MouseEvent | undefined))
  canvas.on('object:scaling', (event) => {
    if (!canvas) return
    scaleObject(event.target, (event.e as MouseEvent).shiftKey, (event.e as MouseEvent).altKey, event.transform.corner, canvas.getScenePoint(event.e))
  })
  canvas.on('object:rotating', (event) => rotateObject(event.target, (event.e as MouseEvent).shiftKey))
  canvas.on('object:modified', commitTransform)
  canvas.on('mouse:dblclick', (event) => activateObject(event.target))
  canvas.on('mouse:over', (event) => props.designer.setHoveredNode(objectNodeId(event.target)))
  canvas.on('mouse:out', () => props.designer.setHoveredNode(undefined))
  canvas.on('mouse:down', (event) => {
    const pointerEvent = event.e as MouseEvent
    if (pointerEvent.button !== 2) return
    emit('contextmenu', { event: pointerEvent, node: contextNode(contextTargetAt(pointerEvent, event.target)) })
  })
  canvas.on('text:changed', (event) => {
    const object = event.target
    const node = objectNode(object)
    if (object instanceof Textbox && node && (node.type === 'text' || node.type === 'button')) {
      const content = normalizeUiSingleLineText(object.text)
      if (content !== object.text) {
        const selection = Math.min(content.length, object.selectionStart)
        object.set({ text: content })
        object.initDimensions()
        object.selectionStart = selection
        object.selectionEnd = selection
      }
      props.designer.previewNodeProperty(node.id, 'content', content)
    }
  })
  void reconcile()
  renderFrame = window.requestAnimationFrame(animationLoop)
})

watch(() => [props.document, props.resourceCatalog, props.scopeNodeId] as const, () => { void reconcile() }, { deep: false })
watch(() => props.zoom, syncContainerLabels)
watch(() => unwrap(props.designer.selectedIds), syncFabricSelection, { deep: true })
watch(() => [props.workspace.width, props.workspace.height, props.workspace.left, props.workspace.top] as const, ([width, height, left, top]) => {
  if (!canvas) return
  canvas.setDimensions({ width, height })
  canvas.setViewportTransform([1, 0, 0, 1, left, top])
  for (const object of objects.values()) object.setCoords()
  canvas.getActiveObject()?.setCoords()
  syncContainerLabels()
  canvas.requestRenderAll()
})

onBeforeUnmount(() => {
  reconcileGeneration += 1
  window.cancelAnimationFrame(renderFrame)
  for (const object of objects.values()) disposeFabricNodeObject(object)
  objects.clear()
  for (const label of containerLabels.values()) label.dispose()
  containerLabels.clear()
  canvas?.dispose()
  canvas = undefined
})
</script>

<template>
  <div class="fabric-editor-canvas" data-ui-id="ui-designer-fabric-canvas" @contextmenu.prevent>
    <canvas ref="canvasElement" />
  </div>
</template>

<style scoped>
.fabric-editor-canvas { position: absolute; z-index: 2; inset: 0; overflow: hidden; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
.fabric-editor-canvas :deep(.canvas-container), .fabric-editor-canvas :deep(.lower-canvas), .fabric-editor-canvas :deep(.upper-canvas) { user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
.fabric-editor-canvas :deep(textarea) { user-select: text; -webkit-user-select: text; }
</style>
