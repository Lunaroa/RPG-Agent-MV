<script setup lang="ts">
import { computed, isRef, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { UiDesignerDocument, UiNode, UiRect, UiRuntimeSceneExport, UiViewport } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiDesignerRendererExecutionMode } from '@contract/ui-designer-renderer-bridge'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { useUiDesignerRendererHost } from '../composables/useUiDesignerRendererHost'
import UiCanvasNode from './UiCanvasNode.vue'
import { nodeRect, nodesIntersectingRect, viewportClientToContent, viewportClientToWorld, viewportClientToZoomAnchor, worldPointToViewport, worldRectToViewport, type UiCanvasViewportFrame, type UiResizeHandle } from '../models/geometry'
import type { UiNodeActionCommand, UiNodeActionPolicy } from '../models/actions'
import { exportRuntimeDocument } from '../models/export'

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const STAGE_MARGIN = 46

const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const document = computed<UiDesignerDocument>(() => unwrap(designer.document))
const nodeIndex = computed(() => new Map(document.value.nodes.map((node) => [node.id, node])))
const viewport = computed<UiViewport>(() => unwrap(designer.viewport))
const selectedIds = computed<string[]>(() => unwrap(designer.selectedIds))
const hoveredNodeId = computed<string | undefined>(() => unwrap(designer.hoveredNodeId))
const selectedNode = computed<UiNode | undefined>(() => unwrap(designer.selectedNode))
const draftPositions = computed<Record<string, { x: number; y: number }>>(() => unwrap(designer.draftPositions))
const draftRects = computed<Record<string, UiRect>>(() => unwrap(designer.draftRects))
const draftRotations = computed<Record<string, number>>(() => unwrap(designer.draftRotations))
const previewing = computed(() => unwrap(designer.isPreviewing))
const requestedExecutionMode = computed<UiDesignerRendererExecutionMode>(() => unwrap(designer.previewExecutionMode))
const preferences = computed<Record<string, unknown>>(() => unwrap(designer.preferences))
const gridEnabled = computed(() => typeof preferences.value.gridEnabled === 'boolean' ? preferences.value.gridEnabled : document.value.canvas.grid.enabled)
const snapEnabled = computed(() => typeof preferences.value.snapEnabled === 'boolean' ? preferences.value.snapEnabled : document.value.canvas.snap.enabled)
const visibleRoots = computed(() => {
  const editingId = editStack.value.at(-1)
  if (!editingId) return document.value.nodes.filter((item) => item.parentId === null)
  const editing = document.value.nodes.find((item) => item.id === editingId)
  return editing ? [editing] : document.value.nodes.filter((item) => item.parentId === null)
})
const editingRootId = computed(() => editStack.value.at(-1))
const dragging = ref<{ nodeIds: string[]; pointerId: number; startX: number; startY: number; origins: Record<string, { x: number; y: number }> }>()
const transforming = ref<{ nodeId: string; handle: UiResizeHandle | 'rotate'; pointerId: number; startX: number; startY: number; originRect: UiRect; originRotation: number; startAngle: number; centerX: number; centerY: number; fromCenter: boolean }>()
const panning = ref<{ pointerId: number; startX: number; startY: number }>()
const selecting = ref<{ pointerId: number; startX: number; startY: number; currentX: number; currentY: number }>()
const guideDragging = ref<{ id: string; type: 'vertical' | 'horizontal'; pointerId: number }>()
const guideMenu = ref<{ x: number; y: number; guideId?: string }>()
const nodeMenu = ref<{ x: number; y: number; nodeId: string }>()
const spacePressed = ref(false)
const viewportElement = ref<HTMLElement>()
const rendererFrame = ref<HTMLIFrameElement>()
const editStack = ref<string[]>([])
const alignmentLabels: Record<'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom', UiDesignerMessageKey> = {
  left: 'alignLeft', centerX: 'alignCenter', right: 'alignRight', top: 'alignTop', centerY: 'alignCenterY', bottom: 'alignBottom',
}
const alignmentOptions = (Object.keys(alignmentLabels) as Array<keyof typeof alignmentLabels>)
const alignmentReference = ref<'selection' | 'canvas'>('selection')
const selectedActionPolicy = computed<UiNodeActionPolicy | undefined>(() => selectedIds.value[0] ? designer.getNodeActionPolicy(selectedIds.value[0]) as UiNodeActionPolicy : undefined)
const nodeMenuItems = computed<Array<{ command: UiNodeActionCommand; label: string; danger?: boolean }>>(() => {
  const target = nodeMenu.value ? document.value.nodes.find((node) => node.id === nodeMenu.value?.nodeId) : undefined
  return [
    { command: 'copy', label: t('copyAction') },
    { command: 'cut', label: t('cutAction') },
    { command: 'paste', label: t('pasteAction') },
    { command: 'addChild', label: t('addChild') },
    { command: 'rename', label: t('renameNode') },
    { command: 'duplicate', label: t('duplicateNode') },
    { command: 'group', label: t('group') },
    { command: 'sameType', label: t('selectSameType') },
    { command: 'moveUp', label: t('moveUp') },
    { command: 'moveDown', label: t('moveDown') },
    { command: 'moveTop', label: t('moveTop') },
    { command: 'moveBottom', label: t('moveBottom') },
    { command: 'toggleVisibility', label: target?.props.visible ? t('hideNode') : t('showNode') },
    { command: 'toggleLock', label: target?.locked ? t('unlockNode') : t('lockNode') },
    { command: 'delete', label: t('deleteNode'), danger: true },
  ]
})
const rulerTicks = computed(() => {
  const step = 100
  const horizontal = Array.from({ length: Math.ceil(document.value.canvas.width / step) + 1 }, (_, index) => index * step)
  const vertical = Array.from({ length: Math.ceil(document.value.canvas.height / step) + 1 }, (_, index) => index * step)
  return { horizontal, vertical }
})

const viewportFrame = (): UiCanvasViewportFrame => {
  const element = viewportElement.value
  const bounds = element?.getBoundingClientRect()
  return {
    left: bounds?.left ?? 0,
    top: bounds?.top ?? 0,
    scrollLeft: element?.scrollLeft ?? 0,
    scrollTop: element?.scrollTop ?? 0,
    stageMargin: STAGE_MARGIN,
  }
}

const stageStyle = computed(() => ({
  width: `${document.value.canvas.width}px`,
  height: `${document.value.canvas.height}px`,
  transform: previewing.value ? 'none' : `translate(${viewport.value.panX}px, ${viewport.value.panY}px) scale(${viewport.value.zoom})`,
  backgroundColor: document.value.canvas.backgroundColor,
}))

const runtimeScene = (): UiRuntimeSceneExport => {
  const source = JSON.parse(JSON.stringify(document.value)) as UiDesignerDocument
  for (const node of source.nodes) {
    const draftRect = draftRects.value[node.id]
    const draftPosition = draftPositions.value[node.id]
    if (draftRect) {
      const scaleX = Math.max(Math.abs(Number.isFinite(node.props.scaleX) ? node.props.scaleX : 1), 0.0001)
      const scaleY = Math.max(Math.abs(Number.isFinite(node.props.scaleY) ? node.props.scaleY : 1), 0.0001)
      node.props.x = draftRect.x + draftRect.width * node.props.anchorX
      node.props.y = draftRect.y + draftRect.height * node.props.anchorY
      node.props.width = draftRect.width / scaleX
      node.props.height = draftRect.height / scaleY
    } else if (draftPosition) {
      node.props.x = draftPosition.x
      node.props.y = draftPosition.y
    }
    const draftRotation = draftRotations.value[node.id]
    if (draftRotation !== undefined) node.props.rotate = draftRotation
  }
  return exportRuntimeDocument(source)
}

const rendererHost = useUiDesignerRendererHost({
  designer,
  iframe: rendererFrame,
  runtimeScene,
  executionMode: () => requestedExecutionMode.value,
  onExecutionModeReady: (mode) => {
    designer.acknowledgePreviewExecutionMode(mode)
    if (mode === 'full-preview') void nextTick(() => rendererFrame.value?.focus())
  },
  onExecutionModeError: (message, cleanupPending) => designer.failPreview(message, cleanupPending),
  onPreviewExitRequest: () => designer.stopPreview(),
})
const rendererStatus = rendererHost.status
const rendererFailureCode = rendererHost.failureCode
const rendererIframeUrl = rendererHost.iframeUrl
const rendererBounds = rendererHost.bounds
const rendererStage = rendererHost.stage
const rendererReady = computed(() => rendererStatus.value === 'running')
const previewInteractive = computed(() => previewing.value && rendererReady.value && rendererHost.executionModeReady.value && rendererHost.executionMode.value === 'full-preview')
const selectionStyle = computed(() => {
  const box = selecting.value
  if (!box) return {}
  const frame = viewportFrame()
  const start = viewportClientToWorld({ x: box.startX, y: box.startY }, frame, viewport.value)
  const end = viewportClientToWorld({ x: box.currentX, y: box.currentY }, frame, viewport.value)
  const worldSelection = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
  const display = worldRectToViewport(worldSelection, frame, viewport.value)
  return {
    left: `${display.x}px`,
    top: `${display.y}px`,
    width: `${display.width}px`,
    height: `${display.height}px`,
  }
})

const beginDrag = (event: PointerEvent, node: UiNode) => {
  if (previewing.value) return
  if (node.locked) return
  event.stopPropagation()
  if (!selectedIds.value.includes(node.id)) designer.selectNodes([node.id], event.metaKey || event.ctrlKey)
  const policy = designer.getNodeActionPolicy(node.id) as UiNodeActionPolicy
  if (!policy.canTransform) return
  const nodeIds = [...policy.selectionIds]
  const origins = Object.fromEntries(nodeIds.map((id) => { const selected = document.value.nodes.find((candidate) => candidate.id === id); return selected ? [id, { x: selected.props.x, y: selected.props.y }] : [id, { x: node.props.x, y: node.props.y }] }))
  dragging.value = { nodeIds, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origins }
  window.addEventListener('pointermove', moveDrag)
  window.addEventListener('pointerup', endDrag, { once: true })
  window.addEventListener('pointercancel', endDrag, { once: true })
}

const handlePointer = (payload: { event: PointerEvent; node: UiNode }) => beginDrag(payload.event, payload.node)
const handleSelect = (payload: { event: MouseEvent; node: UiNode }) => {
  if (previewing.value) return
  closeNodeMenu()
  designer.selectNodes([payload.node.id], payload.event.metaKey || payload.event.ctrlKey)
}
const enterContainer = (payload: { node: UiNode }) => {
  if (payload.node.type !== 'container') return
  editStack.value = [...editStack.value, payload.node.id]
  // Keep the frame visible as a non-interactive boundary.  Selection moves to
  // the first child (or clears) so the container itself can never be dragged,
  // resized, rotated, or accidentally edited while inside it.
  designer.selectNodes(payload.node.children.length ? [payload.node.children[0]] : [])
}

const moveDrag = (event: PointerEvent) => {
  const active = dragging.value
  if (!active || event.pointerId !== active.pointerId) return
  const deltaX = (event.clientX - active.startX) / Math.max(viewport.value.zoom, 0.01)
  const deltaY = (event.clientY - active.startY) / Math.max(viewport.value.zoom, 0.01)
  designer.previewSelectedPositionsWithSnap(active.nodeIds, active.origins, { x: deltaX, y: deltaY })
}

const endDrag = () => {
  if (dragging.value) designer.commitDraftPositions(dragging.value.nodeIds)
  dragging.value = undefined
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
}

const beginTransform = (payload: { event: PointerEvent; node: UiNode; handle: string }) => {
  if (previewing.value || payload.node.locked) return
  if (payload.handle !== 'rotate' && !['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(payload.handle)) return
  if (!(designer.getNodeActionPolicy(payload.node.id) as UiNodeActionPolicy).canTransform) return
  const value = nodeRect(payload.node)
  const host = (payload.event.currentTarget as HTMLElement | null)?.closest('.canvas-node') as HTMLElement | null
  const bounds = host?.getBoundingClientRect()
  const centerX = bounds ? bounds.left + bounds.width / 2 : payload.event.clientX
  const centerY = bounds ? bounds.top + bounds.height / 2 : payload.event.clientY
  const startAngle = Math.atan2(payload.event.clientY - centerY, payload.event.clientX - centerX)
  transforming.value = { nodeId: payload.node.id, handle: payload.handle as UiResizeHandle | 'rotate', pointerId: payload.event.pointerId, startX: payload.event.clientX, startY: payload.event.clientY, originRect: value, originRotation: payload.node.props.rotate, startAngle, centerX, centerY, fromCenter: payload.event.altKey }
  window.addEventListener('pointermove', moveTransform)
  window.addEventListener('pointerup', endTransform, { once: true })
  window.addEventListener('pointercancel', endTransform, { once: true })
}
const moveTransform = (event: PointerEvent) => {
  const active = transforming.value
  if (!active || active.pointerId !== event.pointerId) return
  const dx = (event.clientX - active.startX) / Math.max(viewport.value.zoom, 0.01)
  const dy = (event.clientY - active.startY) / Math.max(viewport.value.zoom, 0.01)
  if (active.handle === 'rotate') {
    const angle = Math.atan2(event.clientY - active.centerY, event.clientX - active.centerX)
    let delta = (angle - active.startAngle) * 180 / Math.PI
    if (event.shiftKey) delta = Math.round(delta / 15) * 15
    designer.previewNodeRotation(active.nodeId, active.originRotation + delta)
    return
  }
  const radians = -active.originRotation * Math.PI / 180
  const localDx = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localDy = dx * Math.sin(radians) + dy * Math.cos(radians)
  designer.previewNodeResizeWithSnap(active.nodeId, active.originRect, active.handle, { x: localDx, y: localDy }, { preserveAspect: !event.ctrlKey, fromCenter: active.fromCenter })
}
const endTransform = () => {
  const active = transforming.value
  if (active) {
    if (active.handle === 'rotate') designer.commitDraftRotation(active.nodeId)
    else designer.commitDraftRect(active.nodeId)
  }
  transforming.value = undefined
  window.removeEventListener('pointermove', moveTransform)
  window.removeEventListener('pointerup', endTransform)
  window.removeEventListener('pointercancel', endTransform)
}

const zoom = (event: WheelEvent) => {
  if (previewing.value) return
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const factor = event.deltaY > 0 ? 0.9 : 1.1
  const frame = viewportFrame()
  const anchor = viewportClientToZoomAnchor({ x: event.clientX, y: event.clientY }, frame)
  designer.setZoom(viewport.value.zoom * factor, anchor)
}

const selectCanvas = () => {
  if (!previewing.value) designer.selectNodes(editStack.value.length ? [] : ['node_root'])
}
const beginBoxSelect = (event: PointerEvent) => {
  if (previewing.value || event.button !== 0 || spacePressed.value) return
  nodeMenu.value = undefined
  selecting.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY }
  window.addEventListener('pointermove', moveBoxSelect)
  window.addEventListener('pointerup', endBoxSelect, { once: true })
  window.addEventListener('pointercancel', endBoxSelect, { once: true })
}
const moveBoxSelect = (event: PointerEvent) => {
  if (!selecting.value || selecting.value.pointerId !== event.pointerId) return
  selecting.value.currentX = event.clientX
  selecting.value.currentY = event.clientY
}
const endBoxSelect = () => {
  const box = selecting.value
  if (box) {
    const frame = viewportFrame()
    const start = viewportClientToWorld({ x: box.startX, y: box.startY }, frame, viewport.value)
    const end = viewportClientToWorld({ x: box.currentX, y: box.currentY }, frame, viewport.value)
    const selection = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
    if (selection.width > 3 || selection.height > 3) {
      const ids = nodesIntersectingRect(document.value, selection)
      designer.selectNodes(ids)
    } else selectCanvas()
  }
  selecting.value = undefined
  window.removeEventListener('pointermove', moveBoxSelect)
  window.removeEventListener('pointerup', endBoxSelect)
  window.removeEventListener('pointercancel', endBoxSelect)
}
const beginPan = (event: PointerEvent) => {
  if (previewing.value) return
  if (event.button !== 1 && !spacePressed.value) return
  panning.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
  window.addEventListener('pointermove', movePan)
  window.addEventListener('pointerup', endPan, { once: true })
  window.addEventListener('pointercancel', endPan, { once: true })
}
const movePan = (event: PointerEvent) => {
  const active = panning.value
  if (!active || active.pointerId !== event.pointerId) return
  designer.pan({ x: event.clientX - active.startX, y: event.clientY - active.startY })
  active.startX = event.clientX; active.startY = event.clientY
}
const endPan = () => { panning.value = undefined; window.removeEventListener('pointermove', movePan); window.removeEventListener('pointerup', endPan); window.removeEventListener('pointercancel', endPan) }
const worldFromClient = (event: PointerEvent | MouseEvent) => {
  return viewportClientToWorld({ x: event.clientX, y: event.clientY }, viewportFrame(), viewport.value)
}
const beginGuideFromRuler = (event: PointerEvent, type: 'vertical' | 'horizontal') => {
  if (previewing.value) return
  const point = worldFromClient(event)
  const id = designer.addGuide(type, type === 'vertical' ? point.x : point.y)
  beginGuideDrag(event, { id, type, locked: false })
}
const beginGuideDrag = (event: PointerEvent, guide: { id: string; type: 'vertical' | 'horizontal'; locked?: boolean }) => {
  if (previewing.value || guide.locked) return
  guideDragging.value = { id: guide.id, type: guide.type, pointerId: event.pointerId }
  window.addEventListener('pointermove', moveGuide)
  window.addEventListener('pointerup', endGuide, { once: true })
  window.addEventListener('pointercancel', cancelGuide, { once: true })
}
const moveGuide = (event: PointerEvent) => {
  const active = guideDragging.value
  if (!active || active.pointerId !== event.pointerId) return
  const point = worldFromClient(event)
  designer.setGuidePosition(active.id, active.type === 'vertical' ? point.x : point.y)
}
const endGuide = (event?: PointerEvent) => {
  const active = guideDragging.value
  if (active && event) {
    const frame = viewportFrame()
    const nearRuler = active.type === 'horizontal' ? event.clientY <= frame.top + 18 : event.clientX <= frame.left + 18
    if (nearRuler) designer.removeGuide(active.id)
  }
  guideDragging.value = undefined
  window.removeEventListener('pointermove', moveGuide)
  window.removeEventListener('pointerup', endGuide)
  window.removeEventListener('pointercancel', cancelGuide)
}
const cancelGuide = () => endGuide()
const guideMenuPosition = (event: MouseEvent) => {
  const point = viewportClientToContent({ x: event.clientX, y: event.clientY }, viewportFrame())
  return { x: point.x, y: point.y }
}
const openGuideMenu = (event: MouseEvent, guideId?: string) => { nodeMenu.value = undefined; guideMenu.value = { ...guideMenuPosition(event), guideId } }
const closeGuideMenu = () => { guideMenu.value = undefined }
const nodeMenuPolicy = computed<UiNodeActionPolicy | undefined>(() => nodeMenu.value ? designer.getNodeActionPolicy(nodeMenu.value.nodeId) as UiNodeActionPolicy : undefined)
const openNodeMenu = (payload: { event: MouseEvent; node: UiNode }) => {
  if (previewing.value) return
  closeGuideMenu()
  designer.selectNodeActionTarget(payload.node.id)
  nodeMenu.value = { ...guideMenuPosition(payload.event), nodeId: payload.node.id }
}
const closeNodeMenu = () => { nodeMenu.value = undefined }
const renameNodeFromMenu = async (nodeId: string) => {
  const node = document.value.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !(designer.getNodeActionPolicy(nodeId) as UiNodeActionPolicy).allowed.rename) return
  closeNodeMenu()
  try {
    const result = await ElMessageBox.prompt(t('nodeNamePlaceholder'), t('renameNode'), { inputValue: node.name, confirmButtonText: t('save'), cancelButtonText: t('lifecycleCancel') })
    designer.renameNode(nodeId, result.value)
  } catch { /* cancel */ }
}
const runNodeCommand = (command: UiNodeActionCommand) => {
  const targetId = nodeMenu.value?.nodeId
  if (!targetId) return
  if (command === 'rename') { void renameNodeFromMenu(targetId); return }
  designer.executeNodeAction(command, targetId)
  closeNodeMenu()
}
const selectedGuide = computed(() => guideMenu.value?.guideId ? document.value.guides.find((guide) => guide.id === guideMenu.value?.guideId) : undefined)
const editGuidePosition = async () => {
  const guide = selectedGuide.value
  closeGuideMenu()
  if (!guide) return
  try {
    const result = await ElMessageBox.prompt(t('guidePositionPrompt'), t('guidePositionTitle'), { inputValue: String(guide.position), inputPattern: /^-?\d+(\.\d+)?$/, inputErrorMessage: t('invalidValue'), confirmButtonText: t('save'), cancelButtonText: t('lifecycleCancel') })
    const value = Number(result.value)
    if (Number.isFinite(value)) designer.setGuidePosition(guide.id, value)
  } catch { /* cancel */ }
}
const toggleGuideLock = () => { const guide = selectedGuide.value; closeGuideMenu(); if (guide) designer.setGuideLocked(guide.id, !guide.locked) }
const deleteGuide = () => { const guide = selectedGuide.value; closeGuideMenu(); if (guide) designer.removeGuide(guide.id) }
const clearGuides = () => { closeGuideMenu(); designer.clearGuides() }
const keyDown = (event: KeyboardEvent) => { if (event.code === 'Space') spacePressed.value = true }
const keyUp = (event: KeyboardEvent) => {
  if (event.code === 'Space') spacePressed.value = false
  if (previewing.value) return
  if (event.code === 'Escape') {
    if (editStack.value.length) editStack.value = editStack.value.slice(0, -1)
    designer.selectNodes([editStack.value.at(-1) ?? 'node_root'])
  }
}

const dropResource = (event: DragEvent) => {
  event.preventDefault()
  if (previewing.value) return
  const nodeType = event.dataTransfer?.getData('text/ui-node-type')?.trim() as UiDesignerDocument['nodes'][number]['type'] | ''
  if (nodeType && ['container', 'sprite', 'nineSlice', 'frameAnimation', 'button', 'text', 'progressBar', 'overlay', 'video', 'particle'].includes(nodeType)) {
    const position = worldFromClient(event)
    designer.addNode(nodeType, undefined, position)
    return
  }
  const path = event.dataTransfer?.getData('text/ui-resource-path')?.trim() ?? ''
  const category = event.dataTransfer?.getData('text/ui-resource-category')?.trim() ?? 'image'
  if (!path) return
  let node = selectedNode.value
  if (!node) {
    const nodeType = category === 'video' ? 'video' : category === 'font' ? 'text' : category === 'audio' ? 'button' : 'sprite'
    const position = worldFromClient(event)
    designer.addNode(nodeType, undefined, position)
    node = document.value.nodes.find((candidate) => selectedIds.value.includes(candidate.id))
  }
  if (!node) return
  const props = node.props as unknown as Record<string, unknown>
  const preferred = category === 'font' ? 'fontFile' : category === 'audio' ? 'clickSe' : category === 'video' ? 'path' : undefined
  const property = preferred && preferred in props ? preferred : ['path', 'backgroundPath', 'imagePath', 'trackImage', 'fillImage', 'posterPath'].find((key) => key in props)
  if (property) designer.updateNodeProperty(node.id, property, path)
}

onMounted(() => { window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp) })
onBeforeUnmount(() => { endDrag(); endTransform(); endPan(); endBoxSelect(); endGuide(); closeGuideMenu(); closeNodeMenu(); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp) })
</script>

<template>
  <section class="canvas-panel" :class="{ 'editor-preview-canvas': previewing }">
    <div v-if="!previewing" class="canvas-toolbar">
      <span class="canvas-title">{{ document.meta.sceneName }}</span>
      <span class="canvas-zoom">{{ Math.round(viewport.zoom * 100) }}%</span>
      <el-button data-ui-id="ui-designer-canvas-refresh" size="small" text :disabled="previewing || !rendererReady" @click="rendererHost.refreshCanvas()">{{ t('refreshCanvas') }}</el-button>
      <el-button size="small" text :disabled="previewing" @click="designer.setZoom(1)">{{ t('resetZoom') }}</el-button>
      <el-button size="small" text :disabled="previewing" @click="designer.fitCanvas()">{{ t('fitCanvas') }}</el-button>
      <el-checkbox :model-value="gridEnabled" :disabled="previewing" size="small" @update:model-value="designer.setGridEnabled($event)">{{ t('grid') }}</el-checkbox>
      <el-checkbox :model-value="snapEnabled" :disabled="previewing" size="small" @update:model-value="designer.setSnapEnabled($event)">{{ t('snap') }}</el-checkbox>
      <el-dropdown trigger="click" :disabled="previewing || selectedIds.length < 2 || !selectedActionPolicy?.canTransform">
        <el-button size="small" text>{{ t('alignment') }}⌄</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>{{ t('alignmentReference') }}</el-dropdown-item>
            <el-dropdown-item :disabled="alignmentReference === 'selection'" @click="alignmentReference = 'selection'">{{ t('referenceSelection') }}</el-dropdown-item>
            <el-dropdown-item :disabled="alignmentReference === 'canvas'" @click="alignmentReference = 'canvas'">{{ t('referenceCanvas') }}</el-dropdown-item>
            <el-dropdown-item v-for="alignment in alignmentOptions" :key="alignment" @click="designer.align(alignment, alignmentReference)">{{ t(alignmentLabels[alignment]) }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" :disabled="previewing || selectedIds.length < 3 || !selectedActionPolicy?.canTransform">
        <el-button size="small" text>{{ t('distribute') }}⌄</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="designer.distribute('horizontal')">{{ t('distributeHorizontal') }}</el-dropdown-item>
            <el-dropdown-item @click="designer.distribute('vertical')">{{ t('distributeVertical') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <div ref="viewportElement" class="canvas-viewport" :class="{ 'preview-viewport': previewing }" @wheel="zoom" @pointerdown.self="beginBoxSelect" @pointerdown="beginPan" @contextmenu.prevent.stop="openGuideMenu($event)" @dragover.prevent @drop="dropResource">
      <div v-if="!previewing && document.canvas.rulers" class="canvas-ruler horizontal" aria-hidden="true" @pointerdown.stop="beginGuideFromRuler($event, 'horizontal')"><span v-for="tick in rulerTicks.horizontal" :key="`h-${tick}`" class="ruler-tick" :style="{ left: `${worldPointToViewport({ x: tick, y: 0 }, { stageMargin: STAGE_MARGIN }, viewport).x}px` }">{{ tick }}</span></div>
      <div v-if="!previewing && document.canvas.rulers" class="canvas-ruler vertical" aria-hidden="true" @pointerdown.stop="beginGuideFromRuler($event, 'vertical')"><span v-for="tick in rulerTicks.vertical" :key="`v-${tick}`" class="ruler-tick" :style="{ top: `${worldPointToViewport({ x: 0, y: tick }, { stageMargin: STAGE_MARGIN }, viewport).y}px` }">{{ tick }}</span></div>
      <template v-if="!previewing && document.canvas.guidesVisible">
        <div v-for="guide in document.guides" :key="guide.id" class="canvas-guide" :class="[guide.type, { locked: guide.locked }]" :style="guide.type === 'vertical' ? { left: `${worldPointToViewport({ x: guide.position, y: 0 }, { stageMargin: STAGE_MARGIN }, viewport).x}px` } : { top: `${worldPointToViewport({ x: 0, y: guide.position }, { stageMargin: STAGE_MARGIN }, viewport).y}px` }" :title="guide.locked ? `🔒 ${t('guideLocked')}` : t('guide')" @pointerdown.stop="beginGuideDrag($event, guide)" @dblclick.stop="openGuideMenu($event, guide.id); void editGuidePosition()" @contextmenu.prevent.stop="openGuideMenu($event, guide.id)" />
      </template>
      <div v-if="!previewing && guideMenu" class="guide-context-menu" :style="{ left: `${guideMenu.x}px`, top: `${guideMenu.y}px` }" @pointerdown.stop>
        <template v-if="selectedGuide">
          <el-button size="small" text @click="void editGuidePosition()">{{ t('guidePositionTitle') }}</el-button>
          <el-button size="small" text @click="toggleGuideLock">{{ selectedGuide.locked ? t('guideMenuUnlock') : t('guideMenuLock') }}</el-button>
          <el-button size="small" text type="danger" @click="deleteGuide">{{ t('guideMenuDelete') }}</el-button>
        </template>
        <el-button size="small" text type="danger" @click="clearGuides">{{ t('guideMenuClear') }}</el-button>
      </div>
      <div v-if="!previewing && nodeMenu && nodeMenuPolicy" class="node-context-menu" :style="{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }" :data-ui-id="`ui-designer-node-menu-${nodeMenu.nodeId}`" @pointerdown.stop @contextmenu.prevent>
        <el-button v-for="item in nodeMenuItems" :key="item.command" size="small" text :type="item.danger ? 'danger' : undefined" :disabled="!nodeMenuPolicy.allowed[item.command]" :data-ui-id="`ui-designer-node-command-${nodeMenu.nodeId}-${item.command}`" @click="runNodeCommand(item.command)">{{ item.label }}</el-button>
      </div>
      <div v-if="!previewing && selecting" class="selection-box" :style="selectionStyle" />
      <div class="canvas-stage" :class="{ checkerboard: !previewing && document.canvas.backgroundPattern === 'checkerboard', 'preview-stage': previewing }" :style="stageStyle" @pointerdown.self="beginBoxSelect" @contextmenu.prevent.stop="openGuideMenu($event)">
        <div v-if="!previewing && editStack.length" class="canvas-edit-breadcrumb">{{ t('editingContainer') }}: {{ visibleRoots[0]?.name }} · {{ t('escapeToExit') }}</div>
        <iframe
          v-if="rendererIframeUrl"
          ref="rendererFrame"
          class="canvas-runtime-frame"
          :class="{ 'preview-interactive': previewInteractive }"
          :src="rendererIframeUrl"
          sandbox="allow-scripts allow-same-origin"
          :tabindex="previewInteractive ? 0 : -1"
          :aria-label="t('editorPreview')"
          data-ui-id="ui-designer-runtime-canvas-frame"
          @load="rendererHost.onIframeLoad"
          @error="rendererHost.onIframeError"
        />
        <div v-if="!previewing" class="canvas-grid" :class="{ active: gridEnabled }" :style="{ '--grid-size': `${document.canvas.grid.size}px`, '--grid-color': document.canvas.grid.color }" />
        <div v-if="!previewing" class="node-layer">
          <UiCanvasNode
            v-for="node in visibleRoots"
            :key="node.id"
            :node="node"
            :document="document"
            :node-index="nodeIndex"
            :selected-ids="selectedIds"
            :hovered-node-id="hoveredNodeId"
            :previewing="previewing"
            :interaction-disabled="node.id === 'node_root' || node.id === editingRootId"
            :origin-x="0"
            :origin-y="0"
            :renderer-bounds="rendererBounds"
            :draft-positions="draftPositions"
            :draft-rects="draftRects"
            :draft-rotations="draftRotations"
            @pointerdown="handlePointer"
            @select="handleSelect"
            @contextmenu="openNodeMenu"
            @enter="enterContainer"
            @handlepointerdown="beginTransform"
          />
        </div>
        <div v-if="!designer.canRenderCanvas" class="canvas-runtime-state" data-ui-id="ui-designer-runtime-canvas-project-required">{{ t('projectRequired') }}</div>
        <div v-else-if="rendererStatus === 'error'" class="canvas-runtime-state" aria-live="polite" :data-failure-code="rendererFailureCode || undefined" :data-failure-stage="rendererStage" data-ui-id="ui-designer-runtime-canvas-status">
          <span>{{ t('rendererDisconnected') }}</span>
          <el-button v-if="designer.canRenderCanvas" data-ui-id="ui-designer-runtime-canvas-restart" data-testid="ui-designer-runtime-canvas-restart" size="small" @click="rendererHost.retry()">{{ t('restartPreview') }}</el-button>
        </div>
        <div v-else-if="rendererStatus !== 'running'" class="canvas-runtime-state" aria-live="polite" data-ui-id="ui-designer-runtime-canvas-status">
          <span>{{ `${t(designer.previewStatus === 'preparing' ? 'previewPreparing' : 'canvasSyncing')} · ${rendererStage}` }}</span>
        </div>
      </div>
    </div>
    <div v-if="!previewing" class="canvas-hint">{{ t('chooseNode') }}</div>
  </section>
</template>

<style scoped>
.canvas-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; background: #12141b; }
.canvas-toolbar { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 5px 10px; border-bottom: 1px solid var(--app-border); color: var(--app-ink-soft); font-size: 11px; }
.canvas-title { margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-zoom { font-variant-numeric: tabular-nums; }
.canvas-viewport { flex: 1; min-height: 0; overflow: auto; position: relative; background: #20232c; }
.preview-viewport { display: flex; align-items: flex-start; justify-content: center; box-sizing: border-box; padding: 20px; background: #090a0d; }
.canvas-ruler { position: absolute; z-index: 5; pointer-events: auto; cursor: crosshair; background: repeating-linear-gradient(to right, #ffffff55 0 1px, transparent 1px 32px); opacity: .35; }.canvas-ruler.horizontal { inset: 0 0 auto; height: 18px; }.canvas-ruler.vertical { inset: 0 auto 0 0; width: 18px; background: repeating-linear-gradient(to bottom, #ffffff55 0 1px, transparent 1px 32px); }.ruler-tick { position: absolute; color: #fff; font-size: 8px; line-height: 12px; pointer-events: none; transform: translateX(-1px); }.canvas-ruler.vertical .ruler-tick { transform: translateY(-1px) rotate(-90deg); transform-origin: left top; }.canvas-guide { position: absolute; z-index: 4; pointer-events: auto; cursor: ew-resize; background: var(--el-color-warning); opacity: .55; }.canvas-guide.vertical { top: 0; bottom: 0; width: 3px; margin-left: -1px; }.canvas-guide.horizontal { left: 0; right: 0; height: 3px; margin-top: -1px; cursor: ns-resize; }.canvas-guide.locked { cursor: not-allowed; opacity: .35; }.guide-context-menu, .node-context-menu { position: absolute; z-index: 12; display: flex; flex-direction: column; min-width: 150px; max-height: min(480px, calc(100% - 12px)); overflow: auto; padding: 5px; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-bg); box-shadow: 0 8px 18px #0007; }.guide-context-menu .el-button, .node-context-menu .el-button { justify-content: flex-start; margin: 0; }.selection-box { position: absolute; z-index: 6; pointer-events: none; border: 1px solid var(--app-accent); background: color-mix(in srgb, var(--app-accent) 12%, transparent); }
.canvas-stage { position: relative; margin: 46px; transform-origin: 0 0; box-shadow: 0 16px 36px #0007; overflow: hidden; }
.canvas-stage.preview-stage { flex: none; margin: 0; box-shadow: 0 16px 48px #000b; }
.canvas-edit-breadcrumb { position: absolute; z-index: 8; top: -24px; left: 0; color: var(--app-ink-soft); font-size: 10px; pointer-events: none; }
.canvas-stage.checkerboard { background-image: conic-gradient(#ffffff09 25%, transparent 0 50%, #ffffff09 0 75%, transparent 0); background-size: 24px 24px; }
.canvas-runtime-frame { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; user-select: none; }
.canvas-runtime-frame.preview-interactive { z-index: 3; pointer-events: auto; touch-action: none; user-select: none; }
.canvas-grid { position: absolute; z-index: 1; inset: 0; opacity: 0; background-image: linear-gradient(to right, var(--grid-color) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-color) 1px, transparent 1px); background-size: var(--grid-size) var(--grid-size); pointer-events: none; }
.canvas-grid.active { opacity: .18; }
.node-layer { position: absolute; z-index: 2; inset: 0; pointer-events: none; }
.canvas-runtime-state { position: absolute; z-index: 9; top: 8px; right: 8px; display: flex; max-width: min(420px, calc(100% - 16px)); align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid var(--app-border); border-radius: 5px; color: var(--app-ink-soft); background: color-mix(in srgb, #12141b 92%, transparent); box-shadow: 0 5px 14px #0005; font-size: 11px; text-align: left; pointer-events: none; }
.canvas-runtime-state .el-button { pointer-events: auto; }
.canvas-hint { min-height: 24px; padding: 5px 10px; border-top: 1px solid var(--app-border); color: var(--app-ink-soft); font-size: 11px; }
</style>
