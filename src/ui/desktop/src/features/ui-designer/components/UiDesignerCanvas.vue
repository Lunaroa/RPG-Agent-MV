<script setup lang="ts">
import { computed, isRef, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { UiDesignerDocument, UiNode, UiRuntimeSceneExport, UiViewport } from '@contract/ui-designer'
import type { UiDesignerRendererExecutionMode } from '@contract/ui-designer-renderer-bridge'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { useUiDesignerRendererHost } from '../composables/useUiDesignerRendererHost'
import UiDesignerFabricCanvas from './UiDesignerFabricCanvas.vue'
import { viewportClientToWorld, worldPointToViewport, type UiCanvasViewportFrame } from '../models/geometry'
import { canvasScrollForWorldPoint, createCanvasScrollLayout, fitCanvasZoom, panCanvasScroll } from '../models/viewport-navigation'
import { fitContextMenuPosition } from '../models/context-menu-position'
import type { UiNodeActionCommand, UiNodeActionPolicy } from '../models/actions'
import { exportRuntimeDocument } from '../models/export'

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{ editNode: [nodeId: string] }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const STAGE_MARGIN = 46

const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const document = computed<UiDesignerDocument>(() => unwrap(designer.document))
const viewport = computed<UiViewport>(() => unwrap(designer.viewport))
const selectedIds = computed<string[]>(() => unwrap(designer.selectedIds))
const selectedNode = computed<UiNode | undefined>(() => unwrap(designer.selectedNode))
const draftPositions = computed(() => unwrap(designer.draftPositions))
const draftRects = computed(() => unwrap(designer.draftRects))
const draftRotations = computed(() => unwrap(designer.draftRotations))
const resourceCatalog = computed(() => unwrap(designer.resourceCatalog))
const gamePreviewing = computed(() => unwrap(designer.isPreviewing))
const previewing = computed(() => gamePreviewing.value || unwrap(designer.isEditorPreviewing))
const rendererRequested = computed(() => previewing.value || unwrap(designer.previewStatus) === 'preparing')
const requestedExecutionMode = computed<UiDesignerRendererExecutionMode>(() => unwrap(designer.previewExecutionMode))
const preferences = computed<Record<string, unknown>>(() => unwrap(designer.preferences))
const gridEnabled = computed(() => typeof preferences.value.gridEnabled === 'boolean' ? preferences.value.gridEnabled : document.value.canvas.grid.enabled)
const snapEnabled = computed(() => typeof preferences.value.snapEnabled === 'boolean' ? preferences.value.snapEnabled : document.value.canvas.snap.enabled)
const editStack = ref<string[]>([])
const editingRootId = computed(() => editStack.value.at(-1) ?? 'node_root')
const editingRoot = computed(() => document.value.nodes.find((node) => node.id === editingRootId.value))
const panning = ref<{ pointerId: number; mode: 'space' | 'middle'; startX: number; startY: number; scrollLeft: number; scrollTop: number }>()
const guideDragging = ref<{ id: string; type: 'vertical' | 'horizontal'; pointerId: number }>()
const guideMenu = ref<{ x: number; y: number; guideId?: string }>()
const nodeMenu = ref<{ x: number; y: number; nodeId: string }>()
const guideMenuElement = ref<HTMLElement>()
const nodeMenuElement = ref<HTMLElement>()
const spacePressed = ref(false)
const viewportElement = ref<HTMLElement>()
const viewportSize = ref({ width: 1, height: 1 })
const rendererFrame = ref<HTMLIFrameElement>()
const fabricCanvas = ref<InstanceType<typeof UiDesignerFabricCanvas>>()
const alignmentLabels: Record<'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom', UiDesignerMessageKey> = {
  left: 'alignLeft', centerX: 'alignCenter', right: 'alignRight', top: 'alignTop', centerY: 'alignCenterY', bottom: 'alignBottom',
}
const alignmentOptions = Object.keys(alignmentLabels) as Array<keyof typeof alignmentLabels>
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
const rulerTicks = computed(() => ({
  horizontal: Array.from({ length: Math.ceil(document.value.canvas.width / 100) + 1 }, (_, index) => index * 100),
  vertical: Array.from({ length: Math.ceil(document.value.canvas.height / 100) + 1 }, (_, index) => index * 100),
}))

const canvasViewport = computed<UiViewport>(() => ({ ...viewport.value, panX: 0, panY: 0, width: viewportSize.value.width, height: viewportSize.value.height }))
const canvasPanRoom = (viewport: number) => Math.round(Math.min(420, Math.max(120, viewport * 0.35)))
const scrollLayout = computed(() => createCanvasScrollLayout(
  viewportSize.value.width,
  viewportSize.value.height,
  document.value.canvas.width,
  document.value.canvas.height,
  previewing.value ? 1 : canvasViewport.value.zoom,
  previewing.value ? 0 : STAGE_MARGIN,
  previewing.value ? 0 : canvasPanRoom(viewportSize.value.width),
  previewing.value ? 0 : canvasPanRoom(viewportSize.value.height),
))
const centerCanvasScroll = () => {
  const element = viewportElement.value
  if (!element || previewing.value) return
  element.scrollLeft = scrollLayout.value.centerScrollX
  element.scrollTop = scrollLayout.value.centerScrollY
}
const viewportFrame = (): UiCanvasViewportFrame => {
  const element = viewportElement.value
  const bounds = element?.getBoundingClientRect()
  return {
    left: bounds?.left ?? 0,
    top: bounds?.top ?? 0,
    scrollLeft: element?.scrollLeft ?? 0,
    scrollTop: element?.scrollTop ?? 0,
    stageMargin: STAGE_MARGIN,
    stageOffsetX: scrollLayout.value.stageOffsetX,
    stageOffsetY: scrollLayout.value.stageOffsetY,
  }
}
const scrollContentStyle = computed(() => ({ width: `${scrollLayout.value.contentWidth}px`, height: `${scrollLayout.value.contentHeight}px` }))
const stageStyle = computed(() => ({
  width: `${document.value.canvas.width}px`,
  height: `${document.value.canvas.height}px`,
  left: `${scrollLayout.value.stageOffsetX}px`,
  top: `${scrollLayout.value.stageOffsetY}px`,
  transform: previewing.value ? 'none' : `scale(${canvasViewport.value.zoom})`,
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
  active: () => rendererRequested.value,
  onExecutionModeReady: (mode) => {
    designer.acknowledgePreviewExecutionMode(mode)
    if (mode !== 'authoring') void nextTick(() => rendererFrame.value?.focus())
  },
  onExecutionModeError: (message, cleanupPending) => designer.failPreview(message, cleanupPending),
  onPreviewExitRequest: () => { if (unwrap(designer.isEditorPreviewing)) designer.stopEditorPreview(); else designer.stopPreview() },
})
const rendererStatus = rendererHost.status
const rendererFailureCode = rendererHost.failureCode
const rendererIframeUrl = rendererHost.iframeUrl
const rendererStage = rendererHost.stage
const rendererReady = computed(() => rendererStatus.value === 'running')
const previewInteractive = computed(() => previewing.value && rendererReady.value && rendererHost.executionModeReady.value && rendererHost.executionMode.value !== 'authoring')

const isEditableTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], .CodeMirror'))
const clearNativeCanvasSelection = (event?: Event) => {
  if (event && isEditableTarget(event.target)) return
  window.getSelection()?.removeAllRanges()
}
const preventNativeCanvasSelection = (event: Event) => { if (!isEditableTarget(event.target)) event.preventDefault() }
const preventNativeCanvasDrag = (event: DragEvent) => { if (!isEditableTarget(event.target)) event.preventDefault() }

const resetLegacyPan = () => {
  if (viewport.value.panX || viewport.value.panY) designer.pan({ x: -viewport.value.panX, y: -viewport.value.panY })
}
const updateViewportSize = () => {
  const element = viewportElement.value
  if (!element) return
  viewportSize.value = { width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) }
}
const setCanvasZoom = (scale: number, clientPoint?: { x: number; y: number }) => {
  const element = viewportElement.value
  const bounds = element?.getBoundingClientRect()
  if (!element || !bounds) { resetLegacyPan(); designer.setZoom(scale, { x: 0, y: 0 }); return }
  const anchor = clientPoint ?? { x: bounds.left + element.clientWidth / 2, y: bounds.top + element.clientHeight / 2 }
  const worldPoint = viewportClientToWorld(anchor, viewportFrame(), canvasViewport.value)
  resetLegacyPan()
  designer.setZoom(scale, { x: 0, y: 0 })
  void nextTick(() => {
    updateViewportSize()
    const nextBounds = element.getBoundingClientRect()
    const scroll = canvasScrollForWorldPoint(scrollLayout.value, worldPoint, { x: anchor.x - nextBounds.left, y: anchor.y - nextBounds.top }, canvasViewport.value.zoom)
    element.scrollLeft = scroll.x
    element.scrollTop = scroll.y
  })
}
const fitCanvasView = () => {
  const element = viewportElement.value
  if (!element) return
  resetLegacyPan()
  designer.setZoom(fitCanvasZoom(element.clientWidth, element.clientHeight, document.value.canvas.width, document.value.canvas.height, STAGE_MARGIN), { x: 0, y: 0 })
  void nextTick(() => { updateViewportSize(); centerCanvasScroll() })
}
const zoom = (event: WheelEvent) => {
  if (previewing.value || (!event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  setCanvasZoom(canvasViewport.value.zoom * (event.deltaY > 0 ? 0.9 : 1.1), { x: event.clientX, y: event.clientY })
}
const beginPan = (event: PointerEvent) => {
  if (previewing.value) return false
  const spaceDrag = event.button === 0 && spacePressed.value
  if (event.button !== 1 && !spaceDrag) return false
  const element = viewportElement.value
  if (!element) return false
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  clearNativeCanvasSelection()
  panning.value = { pointerId: event.pointerId, mode: spaceDrag ? 'space' : 'middle', startX: event.clientX, startY: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }
  window.addEventListener('pointermove', movePan)
  window.addEventListener('pointerup', endPan)
  window.addEventListener('pointercancel', endPan)
  return true
}
const movePan = (event: PointerEvent) => {
  const active = panning.value
  if (!active || active.pointerId !== event.pointerId) return
  event.preventDefault()
  const element = viewportElement.value
  if (!element) return
  const scroll = panCanvasScroll(scrollLayout.value, { x: active.scrollLeft, y: active.scrollTop }, { x: event.clientX - active.startX, y: event.clientY - active.startY })
  element.scrollLeft = scroll.x
  element.scrollTop = scroll.y
}
const endPan = (event?: PointerEvent) => {
  if (event && panning.value && panning.value.pointerId !== event.pointerId) return
  panning.value = undefined
  window.removeEventListener('pointermove', movePan)
  window.removeEventListener('pointerup', endPan)
  window.removeEventListener('pointercancel', endPan)
}
const handleViewportPointerDown = (event: PointerEvent) => {
  if (!beginPan(event)) clearNativeCanvasSelection(event)
}
const worldFromClient = (event: PointerEvent | MouseEvent) => viewportClientToWorld({ x: event.clientX, y: event.clientY }, viewportFrame(), canvasViewport.value)

const beginGuideFromRuler = (event: PointerEvent, type: 'vertical' | 'horizontal') => {
  if (previewing.value) return
  const point = worldFromClient(event)
  const id = designer.addGuide(type, type === 'vertical' ? point.x : point.y)
  beginGuideDrag(event, { id, type, locked: false })
}
const beginGuideDrag = (event: PointerEvent, guide: { id: string; type: 'vertical' | 'horizontal'; locked?: boolean }) => {
  if (previewing.value || guide.locked) return
  event.preventDefault()
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
  if (active && event && active.pointerId === event.pointerId) designer.setGuidePosition(active.id, active.type === 'vertical' ? worldFromClient(event).x : worldFromClient(event).y)
  guideDragging.value = undefined
  window.removeEventListener('pointermove', moveGuide)
  window.removeEventListener('pointerup', endGuide)
  window.removeEventListener('pointercancel', cancelGuide)
}
const cancelGuide = () => endGuide()
const contextMenuAnchor = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY })
const fitOpenContextMenu = async (kind: 'guide' | 'node') => {
  await nextTick()
  const element = kind === 'guide' ? guideMenuElement.value : nodeMenuElement.value
  const state = kind === 'guide' ? guideMenu.value : nodeMenu.value
  if (!element || !state) return
  const bounds = element.getBoundingClientRect()
  const fitted = fitContextMenuPosition(
    state,
    { width: bounds.width, height: bounds.height },
    { width: window.innerWidth, height: window.innerHeight },
  )
  if (kind === 'guide' && guideMenu.value) guideMenu.value = { ...guideMenu.value, ...fitted }
  if (kind === 'node' && nodeMenu.value) nodeMenu.value = { ...nodeMenu.value, ...fitted }
}
const openGuideMenu = (event: MouseEvent, guideId?: string) => {
  nodeMenu.value = undefined
  guideMenu.value = { ...contextMenuAnchor(event), guideId }
  void fitOpenContextMenu('guide')
}
const closeGuideMenu = () => { guideMenu.value = undefined }
const nodeMenuPolicy = computed<UiNodeActionPolicy | undefined>(() => nodeMenu.value ? designer.getNodeActionPolicy(nodeMenu.value.nodeId) as UiNodeActionPolicy : undefined)
const openNodeMenu = (event: MouseEvent, node: UiNode) => {
  guideMenu.value = undefined
  designer.selectNodeActionTarget(node.id)
  nodeMenu.value = { ...contextMenuAnchor(event), nodeId: node.id }
  void fitOpenContextMenu('node')
}
const openFabricContextMenu = (payload: { event: MouseEvent; node?: UiNode }) => {
  if (payload.node) openNodeMenu(payload.event, payload.node)
  else openGuideMenu(payload.event)
}
const closeNodeMenu = () => { nodeMenu.value = undefined }
const closeContextMenus = () => { closeGuideMenu(); closeNodeMenu() }
const dismissContextMenus = (event: PointerEvent) => {
  const target = event.target
  if (target instanceof Element && target.closest('.guide-context-menu, .node-context-menu')) return
  closeContextMenus()
}
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

const enterContainer = (node: UiNode) => {
  if (node.type !== 'container' || node.locked) return
  editStack.value = [...editStack.value.filter((id) => id !== node.id), node.id]
  designer.selectNodes(node.children.length ? [node.children[0]] : [node.id])
}
const exitContainer = () => {
  if (!editStack.value.length) return
  editStack.value = editStack.value.slice(0, -1)
  designer.selectNodes([editingRootId.value])
}
const activateNode = (node: UiNode) => {
  designer.selectNodes([node.id])
  if (node.type === 'container') enterContainer(node)
  else emit('editNode', node.id)
}
const parentContainerPath = (node: UiNode) => {
  const ancestors: string[] = []
  const seen = new Set<string>()
  let parentId = node.parentId
  while (parentId && parentId !== 'node_root' && !seen.has(parentId)) {
    seen.add(parentId)
    ancestors.unshift(parentId)
    parentId = document.value.nodes.find((candidate) => candidate.id === parentId)?.parentId ?? null
  }
  return ancestors
}
const activateNodeById = async (nodeId: string) => {
  const node = document.value.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.id === 'node_root') return
  editStack.value = parentContainerPath(node)
  designer.selectNodes([node.id])
  await nextTick()
  if (!fabricCanvas.value?.activateNode(node.id)) activateNode(node)
}
defineExpose({ activateNodeById })

const keyDown = (event: KeyboardEvent) => {
  if (event.code !== 'Space' || previewing.value || isEditableTarget(event.target)) return
  event.preventDefault()
  spacePressed.value = true
}
const keyUp = (event: KeyboardEvent) => {
  if (event.code === 'Space') {
    spacePressed.value = false
    if (panning.value?.mode === 'space') endPan()
  }
  if (previewing.value || event.code !== 'Escape' || isEditableTarget(event.target)) return
  exitContainer()
}
const dropResource = (event: DragEvent) => {
  event.preventDefault()
  if (previewing.value) return
  const nodeType = event.dataTransfer?.getData('text/ui-node-type')?.trim() as UiDesignerDocument['nodes'][number]['type'] | ''
  if (nodeType && ['container', 'sprite', 'nineSlice', 'frameAnimation', 'button', 'text', 'progressBar', 'video', 'particle'].includes(nodeType)) {
    designer.addNode(nodeType, editingRootId.value, worldFromClient(event))
    return
  }
  const path = event.dataTransfer?.getData('text/ui-resource-path')?.trim() ?? ''
  const category = event.dataTransfer?.getData('text/ui-resource-category')?.trim() ?? 'image'
  if (!path) return
  let node = selectedNode.value
  if (!node) {
    const type = category === 'video' ? 'video' : category === 'font' ? 'text' : category === 'audio' ? 'button' : 'sprite'
    const nodeId = designer.addNode(type, editingRootId.value, worldFromClient(event))
    node = nodeId ? document.value.nodes.find((candidate) => candidate.id === nodeId) : undefined
  }
  if (!node) return
  const nodeProps = node.props as unknown as Record<string, unknown>
  const preferred = category === 'font' ? 'fontFile' : category === 'audio' ? 'clickSe' : category === 'video' ? 'path' : undefined
  const property = preferred && preferred in nodeProps ? preferred : ['path', 'backgroundPath', 'imagePath', 'trackImage', 'fillImage', 'posterPath'].find((key) => key in nodeProps)
  if (property) designer.updateNodeProperty(node.id, property, path)
}
const clearSpacePressed = () => { spacePressed.value = false; if (panning.value?.mode === 'space') endPan() }

let viewportResizeObserver: ResizeObserver | undefined
let authoringScroll = { x: 0, y: 0 }
watch(previewing, async (isPreviewing) => {
  const element = viewportElement.value
  if (!element) return
  if (isPreviewing) authoringScroll = { x: element.scrollLeft, y: element.scrollTop }
  await nextTick()
  updateViewportSize()
  element.scrollLeft = isPreviewing ? 0 : authoringScroll.x
  element.scrollTop = isPreviewing ? 0 : authoringScroll.y
})

onMounted(() => {
  window.addEventListener('keydown', keyDown)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', clearSpacePressed)
  window.addEventListener('pointerdown', dismissContextMenus, true)
  resetLegacyPan()
  updateViewportSize()
  centerCanvasScroll()
  viewportResizeObserver = new ResizeObserver(updateViewportSize)
  if (viewportElement.value) viewportResizeObserver.observe(viewportElement.value)
})
onBeforeUnmount(() => {
  endPan()
  endGuide()
  closeContextMenus()
  window.removeEventListener('keydown', keyDown)
  window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', clearSpacePressed)
  window.removeEventListener('pointerdown', dismissContextMenus, true)
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = undefined
})
</script>

<template>
  <section
    class="canvas-panel"
    :class="{ 'editor-preview-canvas': previewing }"
    data-ui-id="ui-designer-canvas"
    :data-renderer-status="rendererStatus"
    :data-renderer-stage="rendererStage"
    :data-renderer-failure-code="rendererFailureCode || undefined"
    :data-preview-status="unwrap(designer.previewStatus)"
    :data-preview-mode="requestedExecutionMode"
    :data-renderer-execution-mode="rendererHost.executionMode.value"
    :data-renderer-mode-ready="rendererHost.executionModeReady.value ? 'true' : 'false'"
  >
    <div v-if="!previewing" class="canvas-toolbar">
      <span class="canvas-title">{{ document.meta.sceneName }}</span>
      <span class="canvas-zoom">{{ Math.round(canvasViewport.zoom * 100) }}%</span>
      <el-button size="small" text @click="setCanvasZoom(1)">{{ t('resetZoom') }}</el-button>
      <el-button size="small" text @click="fitCanvasView">{{ t('fitCanvas') }}</el-button>
      <el-checkbox :model-value="gridEnabled" size="small" @update:model-value="designer.setGridEnabled($event)">{{ t('grid') }}</el-checkbox>
      <el-checkbox :model-value="snapEnabled" size="small" @update:model-value="designer.setSnapEnabled($event)">{{ t('snap') }}</el-checkbox>
      <el-dropdown trigger="click" :disabled="selectedIds.length < 2 || !selectedActionPolicy?.canTransform">
        <el-button size="small" text>{{ t('alignment') }}⌄</el-button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item disabled>{{ t('alignmentReference') }}</el-dropdown-item>
          <el-dropdown-item :disabled="alignmentReference === 'selection'" @click="alignmentReference = 'selection'">{{ t('referenceSelection') }}</el-dropdown-item>
          <el-dropdown-item :disabled="alignmentReference === 'canvas'" @click="alignmentReference = 'canvas'">{{ t('referenceCanvas') }}</el-dropdown-item>
          <el-dropdown-item v-for="alignment in alignmentOptions" :key="alignment" @click="designer.align(alignment, alignmentReference)">{{ t(alignmentLabels[alignment]) }}</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
      <el-dropdown trigger="click" :disabled="selectedIds.length < 3 || !selectedActionPolicy?.canTransform">
        <el-button size="small" text>{{ t('distribute') }}⌄</el-button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item @click="designer.distribute('horizontal')">{{ t('distributeHorizontal') }}</el-dropdown-item>
          <el-dropdown-item @click="designer.distribute('vertical')">{{ t('distributeVertical') }}</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
    </div>
    <div ref="viewportElement" class="canvas-viewport" :class="{ 'preview-viewport': previewing, 'pan-ready': spacePressed && !previewing, panning: Boolean(panning) }" @wheel="zoom" @pointerdown.capture="handleViewportPointerDown" @selectstart="preventNativeCanvasSelection" @dragstart="preventNativeCanvasDrag" @dragover.prevent @drop="dropResource">
      <div class="canvas-scroll-content" :style="scrollContentStyle">
      <div v-if="!previewing && document.canvas.rulers" class="canvas-ruler horizontal" aria-hidden="true" @pointerdown.stop="beginGuideFromRuler($event, 'horizontal')"><span v-for="tick in rulerTicks.horizontal" :key="`h-${tick}`" class="ruler-tick" :style="{ left: `${worldPointToViewport({ x: tick, y: 0 }, viewportFrame(), canvasViewport).x}px` }">{{ tick }}</span></div>
      <div v-if="!previewing && document.canvas.rulers" class="canvas-ruler vertical" aria-hidden="true" @pointerdown.stop="beginGuideFromRuler($event, 'vertical')"><span v-for="tick in rulerTicks.vertical" :key="`v-${tick}`" class="ruler-tick" :style="{ top: `${worldPointToViewport({ x: 0, y: tick }, viewportFrame(), canvasViewport).y}px` }">{{ tick }}</span></div>
      <template v-if="!previewing && document.canvas.guidesVisible">
        <div v-for="guide in document.guides" :key="guide.id" class="canvas-guide" :class="[guide.type, { locked: guide.locked }]" :style="guide.type === 'vertical' ? { left: `${worldPointToViewport({ x: guide.position, y: 0 }, viewportFrame(), canvasViewport).x}px` } : { top: `${worldPointToViewport({ x: 0, y: guide.position }, viewportFrame(), canvasViewport).y}px` }" :title="guide.locked ? `🔒 ${t('guideLocked')}` : t('guide')" @pointerdown.stop="beginGuideDrag($event, guide)" @dblclick.stop="openGuideMenu($event, guide.id); void editGuidePosition()" @contextmenu.prevent.stop="openGuideMenu($event, guide.id)" />
      </template>
      <Teleport to="body">
        <div v-if="!previewing && guideMenu" ref="guideMenuElement" class="guide-context-menu" :style="{ left: `${guideMenu.x}px`, top: `${guideMenu.y}px` }" @pointerdown.stop>
          <template v-if="selectedGuide">
            <el-button size="small" text @click="void editGuidePosition()">{{ t('guidePositionTitle') }}</el-button>
            <el-button size="small" text @click="toggleGuideLock">{{ selectedGuide.locked ? t('guideMenuUnlock') : t('guideMenuLock') }}</el-button>
            <el-button size="small" text type="danger" @click="deleteGuide">{{ t('guideMenuDelete') }}</el-button>
          </template>
          <el-button size="small" text type="danger" @click="clearGuides">{{ t('guideMenuClear') }}</el-button>
        </div>
        <div v-if="!previewing && nodeMenu && nodeMenuPolicy" ref="nodeMenuElement" class="node-context-menu" :style="{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }" :data-ui-id="`ui-designer-node-menu-${nodeMenu.nodeId}`" @pointerdown.stop @contextmenu.prevent>
          <el-button v-for="item in nodeMenuItems" :key="item.command" size="small" text :type="item.danger ? 'danger' : undefined" :disabled="!nodeMenuPolicy.allowed[item.command]" :data-ui-id="`ui-designer-node-command-${nodeMenu.nodeId}-${item.command}`" @click="runNodeCommand(item.command)">{{ item.label }}</el-button>
        </div>
      </Teleport>
      <div class="canvas-stage" :class="{ checkerboard: !previewing && document.canvas.backgroundPattern === 'checkerboard', 'preview-stage': previewing }" :style="stageStyle">
        <div v-if="!previewing && editStack.length" class="canvas-edit-breadcrumb" data-ui-id="ui-designer-container-scope" @pointerdown.stop>
          <span>{{ t('editingContainer') }}: {{ editingRoot?.name }}</span>
          <el-button size="small" text data-ui-id="ui-designer-container-scope-exit" @click="exitContainer">{{ t('returnToParent') }}</el-button>
        </div>
        <iframe
          v-if="rendererIframeUrl"
          v-show="previewing"
          ref="rendererFrame"
          class="canvas-runtime-frame"
          :class="{ 'preview-interactive': previewInteractive }"
          :src="rendererIframeUrl"
          sandbox="allow-scripts allow-same-origin"
          :tabindex="previewInteractive ? 0 : -1"
          :aria-label="t(gamePreviewing ? 'gamePreview' : 'editorPreview')"
          data-ui-id="ui-designer-runtime-canvas-frame"
          @load="rendererHost.onIframeLoad"
          @error="rendererHost.onIframeError"
        />
        <div v-if="!previewing" class="canvas-grid" :class="{ active: gridEnabled }" :style="{ '--grid-size': `${document.canvas.grid.size}px`, '--grid-color': document.canvas.grid.color }" />
        <UiDesignerFabricCanvas
          v-show="!previewing"
          ref="fabricCanvas"
          :designer="designer"
          :document="document"
          :resource-catalog="resourceCatalog"
          :scope-node-id="editingRootId"
          :zoom="canvasViewport.zoom"
          :active="!previewing"
          @activate="activateNode"
          @contextmenu="openFabricContextMenu"
        />
        <template v-if="previewing">
          <div v-if="!designer.canRenderCanvas" class="canvas-runtime-state" data-ui-id="ui-designer-runtime-canvas-project-required">{{ t('projectRequired') }}</div>
          <div v-else-if="rendererStatus === 'error'" class="canvas-runtime-state" aria-live="polite" :data-failure-code="rendererFailureCode || undefined" :data-failure-stage="rendererStage" data-ui-id="ui-designer-runtime-canvas-status">
            <span>{{ t('rendererDisconnected') }}</span>
            <el-button data-ui-id="ui-designer-runtime-canvas-restart" data-testid="ui-designer-runtime-canvas-restart" size="small" @click="rendererHost.retry()">{{ t('restartPreview') }}</el-button>
          </div>
          <div v-else-if="rendererStatus !== 'running'" class="canvas-runtime-state" aria-live="polite" data-ui-id="ui-designer-runtime-canvas-status"><span>{{ `${t(designer.previewStatus === 'preparing' ? 'previewPreparing' : 'canvasSyncing')} · ${rendererStage}` }}</span></div>
        </template>
      </div>
      </div>
    </div>
    <div v-if="!previewing" class="canvas-hint">{{ t('chooseNode') }}</div>
  </section>
</template>

<style scoped>
.canvas-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; background: #12141b; }
.canvas-toolbar { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 5px 10px; border-bottom: 1px solid var(--app-border); color: var(--app-ink-soft); font-size: 11px; }
.canvas-title { margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.canvas-zoom { font-variant-numeric: tabular-nums; }
.canvas-viewport { position: relative; flex: 1; min-height: 0; overflow: auto; background: #20232c; user-select: none; -webkit-user-select: none; -webkit-user-drag: none; scrollbar-width: none; }.canvas-viewport::-webkit-scrollbar { display: none; }.canvas-viewport * { -webkit-user-drag: none; }.canvas-viewport.pan-ready { cursor: grab; }.canvas-viewport.panning { cursor: grabbing; }
.preview-viewport { display: flex; box-sizing: border-box; align-items: flex-start; justify-content: center; padding: 20px; background: #090a0d; }
.canvas-scroll-content { position: relative; flex: none; }
.canvas-ruler { position: absolute; z-index: 5; pointer-events: auto; cursor: crosshair; background: repeating-linear-gradient(to right, #ffffff55 0 1px, transparent 1px 32px); opacity: .35; }.canvas-ruler.horizontal { inset: 0 0 auto; height: 18px; }.canvas-ruler.vertical { inset: 0 auto 0 0; width: 18px; background: repeating-linear-gradient(to bottom, #ffffff55 0 1px, transparent 1px 32px); }.ruler-tick { position: absolute; color: #fff; font-size: 8px; line-height: 12px; pointer-events: none; transform: translateX(-1px); }.canvas-ruler.vertical .ruler-tick { transform: translateY(-1px) rotate(-90deg); transform-origin: left top; }
.canvas-guide { position: absolute; z-index: 4; pointer-events: auto; cursor: ew-resize; background: var(--el-color-warning); opacity: .55; }.canvas-guide.vertical { top: 0; bottom: 0; width: 3px; margin-left: -1px; }.canvas-guide.horizontal { right: 0; left: 0; height: 3px; margin-top: -1px; cursor: ns-resize; }.canvas-guide.locked { cursor: not-allowed; opacity: .35; }
.guide-context-menu, .node-context-menu { position: fixed; z-index: 4000; display: flex; flex-direction: column; min-width: 150px; max-height: min(480px, calc(100vh - 16px)); overflow: auto; padding: 5px; border: 1px solid var(--app-border); border-radius: 5px; background: var(--app-bg); box-shadow: 0 8px 18px #0007; }.guide-context-menu .el-button, .node-context-menu .el-button { justify-content: flex-start; margin: 0; }
.canvas-stage { position: absolute; overflow: hidden; box-shadow: 0 16px 36px #0007; transform-origin: 0 0; }.canvas-stage.preview-stage { box-shadow: 0 16px 48px #000b; }.canvas-edit-breadcrumb { position: absolute; z-index: 8; top: 8px; left: 8px; display: flex; align-items: center; gap: 4px; padding: 3px 5px; border: 1px solid #ffffff1f; border-radius: 4px; color: var(--app-ink-soft); background: #12141be8; font-size: 10px; }.canvas-edit-breadcrumb .el-button { padding: 2px 5px; }.canvas-stage.checkerboard { background-image: conic-gradient(#ffffff09 25%, transparent 0 50%, #ffffff09 0 75%, transparent 0); background-size: 24px 24px; }
.canvas-runtime-frame { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; user-select: none; }.canvas-runtime-frame.preview-interactive { z-index: 3; pointer-events: auto; touch-action: none; user-select: none; }
.canvas-grid { position: absolute; z-index: 1; inset: 0; opacity: 0; background-image: linear-gradient(to right, var(--grid-color) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-color) 1px, transparent 1px); background-size: var(--grid-size) var(--grid-size); pointer-events: none; }.canvas-grid.active { opacity: .18; }
.canvas-runtime-state { position: absolute; z-index: 9; top: 8px; right: 8px; display: flex; max-width: min(420px, calc(100% - 16px)); align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid var(--app-border); border-radius: 5px; color: var(--app-ink-soft); background: color-mix(in srgb, #12141b 92%, transparent); box-shadow: 0 5px 14px #0005; font-size: 11px; text-align: left; pointer-events: none; }.canvas-runtime-state .el-button { pointer-events: auto; }
.canvas-hint { min-height: 24px; padding: 5px 10px; border-top: 1px solid var(--app-border); color: var(--app-ink-soft); font-size: 11px; }
</style>
