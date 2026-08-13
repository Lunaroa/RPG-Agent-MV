<script setup lang="ts">
import { ActiveSelection, Canvas, Textbox, type FabricObject } from 'fabric'
import { isRef, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { UiDesignerDocument, UiNode, UiProjectResourceCatalog, UiRect } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { accumulateRotationDegrees, nodeRect, normalizeRotationDegrees, type UiResizeHandle } from '../models/geometry'
import { collectNodeSubtreeIds, selectionRootNodeIds } from '../models/tree'
import {
  animateFabricNode,
  applyFabricNodeGeometry,
  createFabricNodeObject,
  disposeFabricNodeObject,
  fabricNodeVisualSignature,
  positionFabricObjectFromRect,
  scopeNodes,
  type UiFabricNodeObject,
} from '../fabric/fabricNodeFactory'

const props = defineProps<{
  designer: UiDesignerController
  document: UiDesignerDocument
  resourceCatalog?: UiProjectResourceCatalog | null
  scopeNodeId: string
  active: boolean
}>()
const emit = defineEmits<{
  activate: [node: UiNode]
  contextmenu: [payload: { event: MouseEvent; node?: UiNode }]
}>()

const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const canvasElement = ref<HTMLCanvasElement>()
let canvas: Canvas | undefined
let reconcileGeneration = 0
let renderFrame = 0
let syncingSelection = false
const objects = new Map<string, UiFabricNodeObject>()

interface TransformState {
  action: 'move' | 'scale' | 'rotate'
  nodeIds: string[]
  origins: Record<string, { x: number; y: number }>
  nodeId?: string
  originRect?: UiRect
  originRotation?: number
  lastFabricRotation?: number
  accumulatedRotation?: number
  corner?: string
  targetLeft?: number
  targetTop?: number
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

const applyControllerSelection = (target?: FabricObject) => {
  if (syncingSelection) return
  const ids = selectedObjectIds(target)
  syncingSelection = true
  props.designer.selectNodes(ids.length ? ids : [props.scopeNodeId])
  void nextTick(() => { syncingSelection = false })
}

const syncFabricSelection = () => {
  if (!canvas || syncingSelection) return
  const ids = unwrap(props.designer.selectedIds)
  const selected = ids.map((id) => objects.get(id)).filter((object): object is UiFabricNodeObject => Boolean(object))
  syncingSelection = true
  if (!selected.length) canvas.discardActiveObject()
  else if (selected.length === 1) canvas.setActiveObject(selected[0])
  else {
    const selection = new ActiveSelection(selected, { canvas, hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true })
    canvas.setActiveObject(selection)
  }
  canvas.requestRenderAll()
  void nextTick(() => { syncingSelection = false })
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
  if (!object) return
  canvas?.remove(object)
  objects.delete(nodeId)
  disposeFabricNodeObject(object)
}

const reconcile = async () => {
  if (!canvas) return
  const generation = ++reconcileGeneration
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
      const created = await createFabricNodeObject(node, props.resourceCatalog, props.document)
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
    if (current) applyFabricNodeGeometry(object, current, props.document)
  }
  if (generation !== reconcileGeneration || !canvas) return
  desiredNodes.forEach((node, index) => {
    const object = objects.get(node.id)
    if (object) canvas?.moveObjectTo(object, index)
  })
  syncFabricSelection()
  canvas.requestRenderAll()
}

const startTransform = (event: { transform: { target: FabricObject; action?: string; corner: string; original: { left: number; top: number } } }) => {
  const target = event.transform.target
  const ids = selectionRootNodeIds(props.document, selectedObjectIds(target))
  if (!ids.length) return
  const transformIds = collectNodeSubtreeIds(props.document, ids)
  const actionName = event.transform.action ?? ''
  const action = actionName === 'drag' ? 'move' : actionName.startsWith('rotate') ? 'rotate' : 'scale'
  const origins = Object.fromEntries(transformIds.map((id) => {
    const node = nodeById(id)
    return [id, { x: node?.props.x ?? 0, y: node?.props.y ?? 0 }]
  }))
  const nodeId = ids.length === 1 ? ids[0] : undefined
  const node = nodeId ? nodeById(nodeId) : undefined
  transformState = {
    action,
    nodeIds: ids,
    origins,
    nodeId,
    originRect: node ? nodeRect(node) : undefined,
    originRotation: node?.props.rotate,
    lastFabricRotation: node ? normalizeRotationDegrees(target.angle) : undefined,
    accumulatedRotation: node?.props.rotate,
    corner: event.transform.corner,
    targetLeft: event.transform.original.left,
    targetTop: event.transform.original.top,
  }
}

const moveObject = (target: FabricObject) => {
  const state = transformState
  if (!state || state.action !== 'move') return
  const delta = { x: target.left - (state.targetLeft ?? target.left), y: target.top - (state.targetTop ?? target.top) }
  const drafts = props.designer.previewSelectedPositionsWithSnap(state.nodeIds, state.origins, delta)
  const selectedRoots = new Set(state.nodeIds)
  for (const [id, position] of Object.entries(drafts)) {
    const object = objects.get(id)
    if (!object || target instanceof ActiveSelection && selectedRoots.has(id)) continue
    object.set({ left: position.x, top: position.y }).setCoords()
  }
}

const cornerHandle = (corner: string): UiResizeHandle => ({ tl: 'nw', mt: 'n', tr: 'ne', mr: 'e', br: 'se', mb: 's', bl: 'sw', ml: 'w' } as const)[corner as 'tl'] ?? 'se'

const targetNodeRect = (target: FabricObject, node: UiNode): UiRect => {
  const width = Math.max(1, Math.abs(target.width * target.scaleX))
  const height = Math.max(1, Math.abs(target.height * target.scaleY))
  const anchor = target.getPositionByOrigin(node.props.anchorX, node.props.anchorY)
  return {
    x: anchor.x - width * node.props.anchorX,
    y: anchor.y - height * node.props.anchorY,
    width,
    height,
  }
}

const scaleObject = (target: FabricObject, shiftKey: boolean, altKey: boolean, corner: string) => {
  const state = transformState
  if (!state?.nodeId || !state.originRect || target instanceof ActiveSelection) return
  const node = nodeById(state.nodeId)
  if (!node) return
  const handle = cornerHandle(corner || state.corner || 'br')
  const requested = targetNodeRect(target, node)
  const originRight = state.originRect.x + state.originRect.width
  const originBottom = state.originRect.y + state.originRect.height
  const deltaX = handle.includes('w')
    ? requested.x - state.originRect.x
    : handle.includes('e')
      ? requested.x + requested.width - originRight
      : 0
  const deltaY = handle.includes('n')
    ? requested.y - state.originRect.y
    : handle.includes('s')
      ? requested.y + requested.height - originBottom
      : 0
  const rect = props.designer.previewNodeResizeWithSnap(node.id, state.originRect, handle, { x: deltaX, y: deltaY }, { preserveAspect: shiftKey, fromCenter: altKey })
  if (rect) positionFabricObjectFromRect(target as UiFabricNodeObject, node, rect)
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
  if (shiftKey) {
    const anchor = target.getPositionByOrigin(node.props.anchorX, node.props.anchorY)
    target.set({ angle })
    target.setPositionByOrigin(anchor, node.props.anchorX, node.props.anchorY)
    target.setCoords()
  }
  props.designer.previewNodeRotation(state.nodeId, angle)
}

const commitTransform = () => {
  const state = transformState
  transformState = undefined
  if (!state) return
  if (state.action === 'move') props.designer.commitDraftPositions(state.nodeIds)
  else if (state.action === 'scale' && state.nodeId) props.designer.commitDraftRect(state.nodeId)
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

defineExpose({ activateNode })

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
    width: props.document.canvas.width,
    height: props.document.canvas.height,
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
  canvas.on('before:transform', startTransform)
  canvas.on('object:moving', (event) => moveObject(event.target))
  canvas.on('object:scaling', (event) => scaleObject(event.target, (event.e as MouseEvent).shiftKey, (event.e as MouseEvent).altKey, event.transform.corner))
  canvas.on('object:rotating', (event) => rotateObject(event.target, (event.e as MouseEvent).shiftKey))
  canvas.on('object:modified', commitTransform)
  canvas.on('mouse:dblclick', (event) => activateObject(event.target))
  canvas.on('mouse:over', (event) => props.designer.setHoveredNode(objectNodeId(event.target)))
  canvas.on('mouse:out', () => props.designer.setHoveredNode(undefined))
  canvas.on('mouse:down', (event) => {
    if ((event.e as MouseEvent).button !== 2) return
    emit('contextmenu', { event: event.e as MouseEvent, node: objectNode(event.target) })
  })
  canvas.on('text:changed', (event) => {
    const object = event.target
    const node = objectNode(object)
    if (object instanceof Textbox && node && (node.type === 'text' || node.type === 'button')) props.designer.previewNodeProperty(node.id, 'content', object.text)
  })
  void reconcile()
  renderFrame = window.requestAnimationFrame(animationLoop)
})

watch(() => [props.document, props.resourceCatalog, props.scopeNodeId] as const, () => { void reconcile() }, { deep: false })
watch(() => unwrap(props.designer.selectedIds), syncFabricSelection, { deep: true })
watch(() => [props.document.canvas.width, props.document.canvas.height] as const, ([width, height]) => {
  canvas?.setDimensions({ width, height })
  canvas?.requestRenderAll()
})

onBeforeUnmount(() => {
  reconcileGeneration += 1
  window.cancelAnimationFrame(renderFrame)
  for (const object of objects.values()) disposeFabricNodeObject(object)
  objects.clear()
  canvas?.dispose()
  canvas = undefined
})
</script>

<template>
  <div class="fabric-editor-canvas" data-ui-id="ui-designer-fabric-canvas" @contextmenu.prevent>
    <canvas ref="canvasElement" :width="document.canvas.width" :height="document.canvas.height" />
  </div>
</template>

<style scoped>
.fabric-editor-canvas { position: absolute; z-index: 2; inset: 0; overflow: hidden; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
.fabric-editor-canvas :deep(.canvas-container), .fabric-editor-canvas :deep(.lower-canvas), .fabric-editor-canvas :deep(.upper-canvas) { width: 100% !important; height: 100% !important; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; }
.fabric-editor-canvas :deep(textarea) { user-select: text; -webkit-user-select: text; }
</style>
