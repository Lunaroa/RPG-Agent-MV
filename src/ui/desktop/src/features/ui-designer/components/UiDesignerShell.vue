<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { UiDesignerAdapterBundle, UiDesignerLifecycleAdapter, UiViewport } from '@contract/ui-designer'
import { useUiDesigner, type UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerLifecycle } from '../composables/useUiDesignerLifecycle'
import { createUiDesignerShortcutRegistry, type UiDesignerShortcutDisplay } from '../composables/shortcutRegistry'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { normalizePaneSize } from '../models/geometry'
import UiDesignerCanvas from './UiDesignerCanvas.vue'
import UiDesignerCodePanel from './UiDesignerCodePanel.vue'
import UiDesignerInspector from './UiDesignerInspector.vue'
import UiDesignerNodePanel from './UiDesignerNodePanel.vue'
import UiDesignerSceneTabs from './UiDesignerSceneTabs.vue'
import UiDesignerToolbar from './UiDesignerToolbar.vue'
import UiDesignerWelcome from './UiDesignerWelcome.vue'
import UiDesignerSettingsSurface from './UiDesignerSettingsSurface.vue'
import UiDesignerExportSurface from './UiDesignerExportSurface.vue'
import UiDesignerNewSceneSurface from './UiDesignerNewSceneSurface.vue'
import UiDesignerHelpSurface from './UiDesignerHelpSurface.vue'

const props = withDefaults(defineProps<{
  adapters?: UiDesignerAdapterBundle
  projectPath?: string
  lifecycleAdapter?: UiDesignerLifecycleAdapter
  manageProjectContext?: boolean
}>(), { adapters: undefined, projectPath: undefined, lifecycleAdapter: undefined, manageProjectContext: true })
const { t } = useUiDesignerI18n()
let rawDesigner!: ReturnType<typeof useUiDesigner>
const surface = ref<'settings' | 'help' | 'shortcuts' | 'tour' | 'export' | 'newScene' | null>(null)
const tourStep = ref(0)
const showWelcome = ref(true)
const exportPath = ref('')
const exportCompleted = ref(false)
const newSceneDraft = reactive({ name: '', width: 816, height: 624, sceneBase: 'Scene_Base' })
const newSceneTemplate = ref('blank')
const leftPaneWidth = ref(260)
const centerPaneWidth = ref(640)
const rightPaneWidth = ref(320)
const paneDrag = ref<{ side: 'left' | 'right'; startX: number; left: number; center: number; right: number }>()
const workspaceStyle = computed(() => ({
  '--ui-designer-left-pane-width': `${leftPaneWidth.value}px`,
  '--ui-designer-right-pane-width': `${rightPaneWidth.value}px`,
}))
const sceneTemplateOptions = computed(() => ['blank', ...rawDesigner.templates.value])
const sceneTemplateLabels: Record<string, UiDesignerMessageKey> = {
  'builtin:title': 'sceneTemplateTitle', 'builtin:menu': 'sceneTemplateMenu', 'builtin:dialog': 'sceneTemplateDialog', 'builtin:scrolling-credits': 'sceneTemplateScrollingCredits', 'builtin:portrait-frame': 'sceneTemplatePortraitFrame', 'builtin:status-bars': 'sceneTemplateStatusBars', 'builtin:game-over': 'sceneTemplateGameOver', 'builtin:save-slots': 'sceneTemplateSaveSlots', 'builtin:hud-bars': 'sceneTemplateHudBars', 'builtin:item-tooltip': 'sceneTemplateItemTooltip', 'builtin:choice-menu': 'sceneTemplateChoiceMenu', 'builtin:logo-animation': 'sceneTemplateLogoAnimation',
}
interface LastActiveDocumentRecord {
  projectPath: string
  sourcePath: string
}
const LAST_ACTIVE_DOCUMENTS_PREFERENCE = 'lastActiveDocuments'
let workspaceTrackingReady = false
let lastActiveDocumentWrite = Promise.resolve(true)
const currentProjectKey = () => props.projectPath?.trim() ?? ''
const lastActiveDocumentRecords = () => {
  const value = rawDesigner.preferences.value[LAST_ACTIVE_DOCUMENTS_PREFERENCE]
  if (!Array.isArray(value)) return []
  return value.filter((record): record is LastActiveDocumentRecord => Boolean(
    record
    && typeof record === 'object'
    && typeof (record as LastActiveDocumentRecord).projectPath === 'string'
    && typeof (record as LastActiveDocumentRecord).sourcePath === 'string',
  ))
}
const rememberLastActiveDocument = (sourcePath?: string) => {
  const projectPath = currentProjectKey()
  lastActiveDocumentWrite = lastActiveDocumentWrite.then(async () => {
    const retained = lastActiveDocumentRecords().filter((record) => record.projectPath !== projectPath)
    const next = [{ projectPath, sourcePath: sourcePath?.trim() ?? '' }, ...retained].slice(0, 20)
    return rawDesigner.savePreferences({ [LAST_ACTIVE_DOCUMENTS_PREFERENCE]: next })
  })
  return lastActiveDocumentWrite
}
const restoreLastActiveDocument = async () => {
  const remembered = lastActiveDocumentRecords().find((record) => record.projectPath === currentProjectKey())
  const legacyRecent = remembered ? undefined : rawDesigner.recentFiles.value.find((record) => record.exists)
  const sourcePath = remembered ? remembered.sourcePath.trim() : legacyRecent?.sourcePath
  if (!sourcePath) return false
  const initialSceneId = rawDesigner.activeSceneId.value
  if (!(await rawDesigner.open({ path: sourcePath }))) return false
  if (rawDesigner.scenes.value.length > 1 && rawDesigner.scenes.value.some((scene) => scene.id === initialSceneId)) {
    await rawDesigner.closeScene(initialSceneId)
  }
  await rememberLastActiveDocument(rawDesigner.activeScene.value?.sourcePath)
  return true
}
const sceneTemplateLabel = (name: string) => name === 'blank' ? t('blankScene') : sceneTemplateLabels[name] ? t(sceneTemplateLabels[name]) : name
const shortcutRegistry = createUiDesignerShortcutRegistry()
const shortcutBindings = ref<UiDesignerShortcutDisplay[]>([])
interface PreviewEditorSnapshot {
  activeSceneId: string
  selectedIds: string[]
  expandedNodeIds: string[]
  viewport: UiViewport
}

interface UiDesignerNodePanelExpose {
  getExpandedKeys: () => string[]
  setExpandedKeys: (ids: readonly string[]) => void
}
interface UiDesignerInspectorExpose {
  editPrimaryNode: (nodeId: string) => void | Promise<void>
}
interface UiDesignerCanvasExpose {
  activateNodeById: (nodeId: string) => void
}

const confirmDiscard = async (sceneId?: string) => {
  try {
    await ElMessageBox.confirm(t('lifecycleMessage'), t('lifecycleTitle'), { type: 'warning', distinguishCancelAndClose: true, confirmButtonText: t('lifecycleSave'), cancelButtonText: t('lifecycleDiscard'), closeOnClickModal: false })
    return await (sceneId ? rawDesigner.saveScene(sceneId) : rawDesigner.saveAllDirtyScenes())
  } catch (action) {
    const result = typeof action === 'string' ? action : (action as { action?: string } | null)?.action
    if (result === 'cancel') return sceneId ? rawDesigner.discardScene(sceneId) : rawDesigner.discardAllDirtyScenes()
    return false
  }
}

rawDesigner = useUiDesigner({ adapters: props.adapters, projectPath: props.projectPath, confirmDiscard })
// Child templates receive a reactive facade so nested refs/computed values are
// unwrapped consistently; the raw controller remains available for lifecycle.
const designer = reactive(rawDesigner) as unknown as UiDesignerController
const fullscreenPreview = computed(() => designer.isEditorPreviewing || designer.isPreviewing)

const lifecycle = useUiDesignerLifecycle({
  adapter: props.lifecycleAdapter,
  isDirty: () => rawDesigner.isDirty.value || rawDesigner.isEditorPreviewing.value || rawDesigner.isPreviewing.value || rawDesigner.previewCleanupPending.value || rawDesigner.previewDisposalInFlight.value,
  save: async () => {
    if (rawDesigner.isEditorPreviewing.value) rawDesigner.stopEditorPreview()
    if (rawDesigner.isPreviewing.value && !(await rawDesigner.stopPreview())) return false
    if (!(await rawDesigner.disposePreview('unload'))) return false
    return rawDesigner.saveAllDirtyScenes()
  },
  discard: async () => {
    if (rawDesigner.isEditorPreviewing.value) rawDesigner.stopEditorPreview()
    if (rawDesigner.isPreviewing.value && !(await rawDesigner.stopPreview())) return false
    if (!(await rawDesigner.disposePreview('unload'))) return false
    return rawDesigner.discardAllDirtyScenes()
  },
  confirmDiscard,
})

defineExpose({ designer, lifecycle, setProjectContext: rawDesigner.setProjectContext, disposePreview: rawDesigner.disposePreview })

const openTour = () => { tourStep.value = 0; surface.value = 'tour' }
const openNewScene = () => {
  const size = rawDesigner.newSceneCanvasSize.value
  if (!size) return
  newSceneDraft.name = `Scene_New_${rawDesigner.scenes.value.length + 1}`
  newSceneDraft.width = size.width
  newSceneDraft.height = size.height
  newSceneDraft.sceneBase = 'Scene_Base'
  newSceneTemplate.value = 'blank'
  surface.value = 'newScene'
}
const createNewScene = () => {
  const created = rawDesigner.newScene(newSceneDraft.name, { width: newSceneDraft.width, height: newSceneDraft.height, sceneBase: newSceneDraft.sceneBase, template: newSceneTemplate.value === 'blank' ? undefined : newSceneTemplate.value })
  if (created) {
    surface.value = null
    showWelcome.value = false
  }
}
const completeTour = async () => {
  surface.value = null
  await rawDesigner.savePreferences({ tourCompleted: true })
}
const closeSurface = (visible: boolean) => { if (!visible) { if (surface.value === 'tour') void completeTour(); else surface.value = null } }
const cycleNodeSelection = (step: 1 | -1) => {
  const nodes = designer.document.nodes.filter((node) => node.id !== 'node_root')
  if (!nodes.length) return
  const index = nodes.findIndex((node) => node.id === designer.selectedIds[0])
  designer.selectNodes([nodes[(index + step + nodes.length) % nodes.length].id])
}
const previewSnapshot = ref<PreviewEditorSnapshot>()
const nodePanelRef = ref<UiDesignerNodePanelExpose>()
const inspectorRef = ref<UiDesignerInspectorExpose>()
const canvasRef = ref<UiDesignerCanvasExpose>()
const editPrimaryNode = (nodeId: string) => {
  rawDesigner.selectNodes([nodeId])
  void nextTick(() => inspectorRef.value?.editPrimaryNode(nodeId))
}
const activateNode = (nodeId: string) => canvasRef.value?.activateNodeById(nodeId)
const capturePreviewState = () => {
  if (previewSnapshot.value) return
  previewSnapshot.value = {
    activeSceneId: rawDesigner.activeSceneId.value,
    selectedIds: [...rawDesigner.selectedIds.value],
    expandedNodeIds: nodePanelRef.value?.getExpandedKeys() ?? [],
    viewport: { ...rawDesigner.viewport.value },
  }
}
const restorePreviewState = () => {
  const snapshot = previewSnapshot.value
  if (!snapshot) return
  if (rawDesigner.scenes.value.some((scene) => scene.id === snapshot.activeSceneId)) rawDesigner.selectScene(snapshot.activeSceneId)
  const availableIds = new Set(rawDesigner.document.value.nodes.map((node) => node.id))
  rawDesigner.selectNodes(snapshot.selectedIds.filter((id) => availableIds.has(id)))
  rawDesigner.viewport.value = { ...snapshot.viewport }
  void nextTick(() => nodePanelRef.value?.setExpandedKeys(snapshot.expandedNodeIds))
  previewSnapshot.value = undefined
}
const toggleGamePreview = () => {
  if (designer.isPreviewing) void designer.stopPreview()
  else if (designer.canStartPreview) void designer.startPreview()
}
const toggleEditorPreview = () => {
  if (designer.isEditorPreviewing) designer.stopEditorPreview()
  else if (designer.canStartEditorPreview) designer.startEditorPreview()
}
const saveCurrentCanvas = () => {
  if (!fullscreenPreview.value && !showWelcome.value && rawDesigner.canSave.value) void rawDesigner.saveScene(rawDesigner.activeSceneId.value)
}
const captureSaveShortcut = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 's') return
  if (fullscreenPreview.value || showWelcome.value || !rawDesigner.canSave.value) return
  event.preventDefault()
  event.stopPropagation()
  saveCurrentCanvas()
}
const clampPane = (side: 'left' | 'center' | 'right', value: number) => normalizePaneSize(side, value)
const beginPaneDrag = (side: 'left' | 'right', event: PointerEvent) => {
  if (fullscreenPreview.value) return
  paneDrag.value = { side, startX: event.clientX, left: leftPaneWidth.value, center: centerPaneWidth.value, right: rightPaneWidth.value }
  window.addEventListener('pointermove', movePaneDrag)
  window.addEventListener('pointerup', endPaneDrag, { once: true })
  window.addEventListener('pointercancel', endPaneDrag, { once: true })
}
const movePaneDrag = (event: PointerEvent) => {
  const drag = paneDrag.value
  if (!drag) return
  const delta = event.clientX - drag.startX
  if (drag.side === 'left') {
    leftPaneWidth.value = clampPane('left', drag.left + delta)
    centerPaneWidth.value = clampPane('center', drag.center - delta)
  } else {
    rightPaneWidth.value = clampPane('right', drag.right - delta)
    centerPaneWidth.value = clampPane('center', drag.center + delta)
  }
}
const endPaneDrag = () => {
  const active = Boolean(paneDrag.value)
  paneDrag.value = undefined
  window.removeEventListener('pointermove', movePaneDrag)
  window.removeEventListener('pointerup', endPaneDrag)
  window.removeEventListener('pointercancel', endPaneDrag)
  if (!active) return
  void rawDesigner.savePreferences({ leftPaneWidth: leftPaneWidth.value, centerPaneWidth: centerPaneWidth.value, rightPaneWidth: rightPaneWidth.value })
}
watch(() => [designer.preferences.leftPaneWidth, designer.preferences.centerPaneWidth, designer.preferences.rightPaneWidth], ([left, center, right]) => {
  if (!paneDrag.value) {
    leftPaneWidth.value = clampPane('left', Number(left ?? 260))
    centerPaneWidth.value = clampPane('center', Number(center ?? 640))
    rightPaneWidth.value = clampPane('right', Number(right ?? 320))
  }
}, { immediate: true })
watch(() => designer.scenes.length, (count, previous) => { if (count > 1 || (previous !== undefined && count !== previous)) showWelcome.value = false })
watch(() => designer.document.nodes.length, (count) => { if (count > 1) showWelcome.value = false })
watch(() => [rawDesigner.activeSceneId.value, rawDesigner.activeScene.value?.sourcePath] as const, ([, sourcePath]) => {
  if (workspaceTrackingReady) void rememberLastActiveDocument(sourcePath)
}, { flush: 'sync' })
watch(fullscreenPreview, (active, previous) => {
  if (active && !previous) {
    capturePreviewState()
    showWelcome.value = false
    surface.value = null
  } else if (!active && previous) {
    restorePreviewState()
  }
})
watch(() => props.projectPath, (next, previous) => { if (props.manageProjectContext && next !== previous) void rawDesigner.setProjectContext(next, props.adapters) })
onMounted(async () => {
  const modifier = (key: string, handler: () => void | Promise<void>, shift = false, description?: string) => shortcutRegistry.register({ key, ctrlOrMeta: true, shift, description, handler })
  modifier('n', () => { if (!fullscreenPreview.value) openNewScene() }, false, 'shortcutNewScene')
  modifier('o', () => { if (!fullscreenPreview.value && designer.canSave) void designer.open() }, false, 'shortcutOpen')
  shortcutRegistry.register({
    key: 's',
    ctrlOrMeta: true,
    allowInEditable: true,
    description: 'shortcutSave',
    handler: saveCurrentCanvas,
  })
  modifier('z', () => { if (!fullscreenPreview.value) designer.undo() }, false, 'shortcutUndo')
  modifier('z', () => { if (!fullscreenPreview.value) designer.redo() }, true, 'shortcutRedo')
  modifier('c', () => { if (!fullscreenPreview.value) designer.copy() }, false, 'shortcutCopy')
  modifier('x', () => { if (!fullscreenPreview.value && designer.selectedIds[0]) designer.executeNodeAction('cut', designer.selectedIds[0]) }, false, 'shortcutCut')
  modifier('v', () => { if (!fullscreenPreview.value) designer.paste() }, false, 'shortcutPaste')
  modifier('w', () => { if (!fullscreenPreview.value) void designer.closeScene(designer.activeSceneId) }, false, 'shortcutCloseScene')
  modifier('y', () => { if (!fullscreenPreview.value) designer.redo() }, false, 'shortcutRedo')
  modifier('d', () => { if (!fullscreenPreview.value) designer.duplicateSelected() }, false, 'shortcutDuplicate')
  modifier('a', () => { if (!fullscreenPreview.value) designer.selectNodes(designer.document.nodes.filter((node) => node.id !== 'node_root').map((node) => node.id)) }, false, 'shortcutSelectAll')
  modifier('g', () => { if (!fullscreenPreview.value) designer.group() }, false, 'shortcutGroup')
  modifier('g', () => { if (!fullscreenPreview.value) designer.ungroup() }, true, 'shortcutUngroup')
  modifier('[', () => { if (!fullscreenPreview.value && designer.selectedIds.length) designer.moveStep(designer.selectedIds[0], 'up') }, false, 'shortcutMoveUp')
  modifier(']', () => { if (!fullscreenPreview.value && designer.selectedIds.length) designer.moveStep(designer.selectedIds[0], 'down') }, false, 'shortcutMoveDown')
  modifier('[', () => { if (!fullscreenPreview.value && designer.selectedIds.length) designer.moveToEdge(designer.selectedIds[0], 'top') }, true, 'shortcutToTop')
  modifier(']', () => { if (!fullscreenPreview.value && designer.selectedIds.length) designer.moveToEdge(designer.selectedIds[0], 'bottom') }, true, 'shortcutToBottom')
  modifier('0', () => { if (!fullscreenPreview.value) designer.setZoom(1) }, false, 'shortcutResetZoom')
  modifier('h', () => { if (!fullscreenPreview.value) designer.fitCanvas() }, true, 'shortcutFitCanvas')
  modifier('e', () => { if (!fullscreenPreview.value) { exportCompleted.value = false; surface.value = 'export' } }, false, 'shortcutExport')
  modifier('p', toggleEditorPreview, false, 'shortcutEditorPreview')
  modifier(';', () => { if (!fullscreenPreview.value) designer.setCanvasSetting('guidesVisible', !designer.document.canvas.guidesVisible) }, false, 'shortcutToggleGuides')
  // Plain arrows drive spatial selection navigation (UiDesignerCanvas keyDown);
  // Shift+arrows remain the coarse nudge. Plain 1px nudge is intentionally retired.
  for (const [key, delta] of [['ArrowLeft', { x: -1, y: 0 }], ['ArrowRight', { x: 1, y: 0 }], ['ArrowUp', { x: 0, y: -1 }], ['ArrowDown', { x: 0, y: 1 }]] as const) {
    shortcutRegistry.register({ key, shift: true, description: 'shortcutNudge', handler: () => { if (!fullscreenPreview.value) designer.nudgeSelected({ x: delta.x * 10, y: delta.y * 10 }) } })
  }
  shortcutRegistry.register({ key: 'Tab', description: 'shortcutNextNode', handler: () => { if (!fullscreenPreview.value) cycleNodeSelection(1) } })
  shortcutRegistry.register({ key: 'Tab', shift: true, description: 'shortcutPreviousNode', handler: () => { if (!fullscreenPreview.value) cycleNodeSelection(-1) } })
  shortcutRegistry.register({ key: 'Delete', description: 'shortcutDelete', handler: () => { if (!fullscreenPreview.value) designer.removeSelected() } })
  shortcutRegistry.register({ key: 'F6', description: 'shortcutGamePreview', handler: toggleGamePreview })
  shortcutRegistry.register({ key: 'f', shift: true, alt: true, allowInEditable: true, description: 'shortcutFormat', handler: () => { window.dispatchEvent(new Event('agent-rpg:ui-designer-format')) } })
  shortcutRegistry.register({ key: 'Escape', description: 'shortcutEscape', allowInEditable: true, handler: () => { if (designer.isPreviewing) void designer.stopPreview(); else if (designer.isEditorPreviewing) designer.stopEditorPreview() } })
  shortcutRegistry.register({ key: '?', shift: true, description: 'shortcutShortcuts', handler: () => { if (!fullscreenPreview.value) surface.value = 'shortcuts' } })
  shortcutBindings.value = shortcutRegistry.list()
  window.addEventListener('keydown', captureSaveShortcut, true)
  window.addEventListener('keydown', shortcutRegistry.handle)
  await rawDesigner.loadPreferences()
  await rawDesigner.loadWelcomeRecords()
  await rawDesigner.loadProjectProfile()
  showWelcome.value = !(await restoreLastActiveDocument())
  workspaceTrackingReady = true
  if (!Boolean(designer.preferences.tourCompleted)) openTour()
})
onBeforeUnmount(() => {
  endPaneDrag()
  window.removeEventListener('keydown', captureSaveShortcut, true)
  window.removeEventListener('keydown', shortcutRegistry.handle)
  shortcutRegistry.unregisterAll()
  rawDesigner.flushDrafts()
  if (rawDesigner.isEditorPreviewing.value) rawDesigner.stopEditorPreview()
  if (rawDesigner.isPreviewing.value) rawDesigner.stopPreview()
  void rawDesigner.disposePreview('unload').then(() => restorePreviewState())
  void rawDesigner.flushRecovery()
})
</script>

<template>
    <section class="ui-designer-shell" :class="{ 'editor-preview-active': fullscreenPreview, 'code-mode-active': designer.editingMode === 'code' && !fullscreenPreview }" data-ui-id="ui-designer-shell">
    <UiDesignerToolbar :designer="designer" @home="showWelcome = true" @settings="surface = 'settings'" @help="surface = 'help'" @shortcuts="surface = 'shortcuts'" @tour="openTour" @export="exportCompleted = false; surface = 'export'" />
    <UiDesignerSceneTabs v-show="!fullscreenPreview" :designer="designer" @new-scene="openNewScene" />
    <div class="designer-workspace" :style="workspaceStyle">
      <aside v-show="!fullscreenPreview" class="left-pane">
        <UiDesignerNodePanel ref="nodePanelRef" :designer="designer" @activate-node="activateNode" />
      </aside>
      <div v-show="!fullscreenPreview" class="workspace-splitter" role="separator" :aria-label="t('leftPane')" @pointerdown="beginPaneDrag('left', $event)" />
      <main class="center-pane">
        <UiDesignerWelcome v-if="showWelcome" :designer="designer" @new-scene="openNewScene" @return-to-scene="showWelcome = false" @scene-ready="showWelcome = false" />
        <template v-else>
          <UiDesignerCanvas ref="canvasRef" v-show="designer.editingMode === 'design' || fullscreenPreview" :designer="designer" @edit-node="editPrimaryNode" />
          <UiDesignerCodePanel v-show="designer.editingMode === 'code' && !fullscreenPreview" :designer="designer" />
        </template>
      </main>
      <div v-show="!fullscreenPreview" class="workspace-splitter" role="separator" :aria-label="t('rightPane')" @pointerdown="beginPaneDrag('right', $event)" />
      <UiDesignerInspector ref="inspectorRef" v-show="!fullscreenPreview" :designer="designer" />
    </div>
    <UiDesignerNewSceneSurface v-if="!fullscreenPreview && surface === 'newScene'" :model-value="true" :draft="newSceneDraft" :template="newSceneTemplate" :template-options="sceneTemplateOptions" :template-label="sceneTemplateLabel" @update:model-value="closeSurface" @update:template="newSceneTemplate = $event" @create="createNewScene" @cancel="surface = null" />
    <UiDesignerSettingsSurface v-if="!fullscreenPreview && surface === 'settings'" :model-value="true" :designer="designer" :left-pane-width="leftPaneWidth" :right-pane-width="rightPaneWidth" :clamp-pane="(side, value) => clampPane(side, value)" @update:model-value="closeSurface" />
    <UiDesignerExportSurface v-if="!fullscreenPreview && surface === 'export'" :model-value="true" :designer="designer" :export-path="exportPath" :export-completed="exportCompleted" @update:model-value="closeSurface" @update:export-path="exportPath = $event" @completed="exportCompleted = $event" />
    <UiDesignerHelpSurface v-if="!fullscreenPreview && (surface === 'help' || surface === 'shortcuts' || surface === 'tour')" :model-value="true" :surface="surface" :tour-step="tourStep" :shortcut-bindings="shortcutBindings" @update:model-value="closeSurface" @update:tour-step="tourStep = $event" @complete="void completeTour()" />

    <el-dialog :model-value="!fullscreenPreview && Boolean(designer.fileConflict)" :title="t('conflictTitle')" width="min(470px, 92vw)" :close-on-click-modal="false" :show-close="false">
      <p class="dialog-copy">{{ designer.runtimeConflict ? t('overwriteConflictBody') : t('conflictBody') }}</p>
       <dl v-if="designer.runtimeConflict && designer.fileConflict?.actual" class="conflict-metadata"><dt>{{ t('modifiedTime') }}</dt><dd>{{ designer.fileConflict.actual.mtimeMs }}</dd><dt>{{ t('digest') }}</dt><dd>{{ designer.fileConflict.actual.digest }}</dd><template v-if="designer.runtimeConflictFiles?.length"><dt>{{ t('affectedFiles') }}</dt><dd>{{ designer.runtimeConflictFiles.join(', ') }}</dd></template></dl>
      <template #footer>
        <el-button data-testid="ui-designer-conflict-cancel" @click="designer.clearFileConflict()">{{ t('lifecycleCancel') }}</el-button>
        <el-button v-if="!designer.runtimeConflict" @click="void designer.resolveFileConflict('reload')">{{ t('reload') }}</el-button>
        <el-button data-testid="ui-designer-conflict-force" type="danger" @click="void designer.resolveFileConflict('force')">{{ t('forceSave') }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.ui-designer-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--app-bg-page); color: var(--app-ink); }
.designer-workspace { display: grid; grid-template-columns: var(--ui-designer-left-pane-width, 260px) 5px minmax(0, 1fr) 5px var(--ui-designer-right-pane-width, 320px); flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.workspace-splitter { position: relative; z-index: 3; cursor: col-resize; background: var(--app-border); }.workspace-splitter::after { position: absolute; inset: 0 -3px; content: ''; }.editor-preview-active .workspace-splitter { pointer-events: none; opacity: .55; }
.left-pane { display: flex; min-width: 0; min-height: 0; overflow: hidden; padding: 9px; border-right: 1px solid var(--app-border); background: var(--app-bg); }
.center-pane { display: flex; min-width: 0; min-height: 0; }
.inspector-panel { min-width: 0; border-left: 1px solid var(--app-border); }
.code-mode-active .left-pane, .code-mode-active .workspace-splitter, .code-mode-active .inspector-panel { display: none; }
.code-mode-active .designer-workspace { grid-template-columns: minmax(0, 1fr) !important; }
.editor-preview-active .left-pane, .editor-preview-active .workspace-splitter, .editor-preview-active .inspector-panel { display: none; }
.editor-preview-active .designer-workspace { grid-template-columns: minmax(0, 1fr) !important; }
.dialog-stack, .dialog-copy, .tour-copy { color: var(--app-ink); font-size: 13px; line-height: 1.6; }.dialog-copy p { margin: 0 0 10px; }.tour-copy p { min-height: 50px; }
.shortcut-list { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; margin: 0; font-size: 12px; }.shortcut-list dt { color: var(--app-ink-soft); }.shortcut-list dd { margin: 0; }
.export-validation { border: 1px solid var(--app-border); border-radius: 6px; padding: 8px; }.validation-heading { margin-bottom: 5px; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; }.validation-list { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; font-size: 11px; }.validation-list li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 5px; align-items: baseline; }.validation-severity { font-weight: 650; }.validation-error .validation-severity { color: var(--el-color-danger); }.validation-warning .validation-severity { color: var(--el-color-warning); }.validation-target { padding: 0; border: 0; background: transparent; color: var(--app-accent); cursor: pointer; font: inherit; text-align: left; }.validation-location { overflow: hidden; color: var(--app-ink-soft); text-overflow: ellipsis; white-space: nowrap; }.validation-list .status-detail { grid-column: 2 / -1; }
@media (max-width: 900px) { .designer-workspace { grid-template-columns: 180px 0 minmax(0, 1fr) 0 240px; }.workspace-splitter { display: none; } }
</style>
