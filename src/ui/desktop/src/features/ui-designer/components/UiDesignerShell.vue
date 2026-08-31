<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UiDesignerAdapterBundle, UiDesignerLifecycleAdapter } from '@contract/ui-designer'
import { useUiDesigner, type UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerLifecycle } from '../composables/useUiDesignerLifecycle'
import { createUiDesignerShortcutRegistry, type UiDesignerShortcutDisplay } from '../composables/shortcutRegistry'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { UI_DESIGNER_MENU_COMMAND_EVENT, uiDesignerMenuCommandFromEvent } from '../menuCommands'
import { normalizePaneSize } from '../models/geometry'
import { isBuiltInUiDesignerTemplate, uiDesignerBuiltInTemplateSceneName } from '../models/templates'
import UiDesignerCanvas from './UiDesignerCanvas.vue'
import UiDesignerCodePanel from './UiDesignerCodePanel.vue'
import UiDesignerJsonPanel from './UiDesignerJsonPanel.vue'
import UiDesignerInspector from './UiDesignerInspector.vue'
import UiDesignerNodePanel from './UiDesignerNodePanel.vue'
import UiDesignerSceneTabs from './UiDesignerSceneTabs.vue'
import UiDesignerToolbar from './UiDesignerToolbar.vue'
import UiDesignerWelcome from './UiDesignerWelcome.vue'
import UiDesignerSettingsSurface from './UiDesignerSettingsSurface.vue'
import UiDesignerSceneSettingsSurface from './UiDesignerSceneSettingsSurface.vue'
import UiDesignerOpenSceneSurface from './UiDesignerOpenSceneSurface.vue'
import UiDesignerSaveAsSurface from './UiDesignerSaveAsSurface.vue'
import UiDesignerGlobalDataSurface from './UiDesignerGlobalDataSurface.vue'
import UiDesignerNewSceneSurface from './UiDesignerNewSceneSurface.vue'
import UiDesignerHelpSurface from './UiDesignerHelpSurface.vue'
import UiDesignerRuntimeReplacementDialog from './UiDesignerRuntimeReplacementDialog.vue'

const props = withDefaults(defineProps<{
  adapters?: UiDesignerAdapterBundle
  projectPath?: string
  lifecycleAdapter?: UiDesignerLifecycleAdapter
  manageProjectContext?: boolean
}>(), { adapters: undefined, projectPath: undefined, lifecycleAdapter: undefined, manageProjectContext: true })
const { t } = useUiDesignerI18n()
let rawDesigner!: ReturnType<typeof useUiDesigner>
const surface = ref<'settings' | 'sceneSettings' | 'about' | 'shortcuts' | 'tour' | 'newScene' | 'openScene' | 'saveAs' | 'globalData' | null>(null)
const tourStep = ref(0)
const showWelcome = ref(true)
const saveAsInitialName = ref('')
const saveAsBusy = ref(false)
const newSceneDraft = reactive({ name: '', width: 816, height: 624, sceneBase: 'Scene_Base' })
const newSceneTemplate = ref('blank')
const newSceneNameAutomatic = ref(true)
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
const sceneTemplateLabel = (name: string) => name === 'blank' ? t('blankScene') : sceneTemplateLabels[name] ? t(sceneTemplateLabels[name]) : name
const shortcutRegistry = createUiDesignerShortcutRegistry()
const shortcutBindings = ref<UiDesignerShortcutDisplay[]>([])
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
watch(() => rawDesigner.fileStatus.value, (status, previous) => {
  if (status !== 'error' || previous === 'error') return
  ElMessage({ type: 'error', message: rawDesigner.fileMessage.value ? `${t('operationError')}: ${rawDesigner.fileMessage.value}` : t('operationError') })
})
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
  newSceneNameAutomatic.value = true
  newSceneDraft.width = size.width
  newSceneDraft.height = size.height
  newSceneDraft.sceneBase = 'Scene_Base'
  newSceneTemplate.value = 'blank'
  surface.value = 'newScene'
}
const selectNewSceneTemplate = (template: string) => {
  newSceneTemplate.value = template
  if (!newSceneNameAutomatic.value) return
  newSceneDraft.name = isBuiltInUiDesignerTemplate(template)
    ? uiDesignerBuiltInTemplateSceneName(template)
    : `Scene_New_${rawDesigner.scenes.value.length + 1}`
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
const openScenePicker = async () => {
  if (!rawDesigner.hasProject.value) return
  await rawDesigner.loadWelcomeRecords()
  surface.value = 'openScene'
}
const openProjectScene = async (sourcePath: string) => {
  if (!(await rawDesigner.open({ path: sourcePath }))) return
  surface.value = null
  showWelcome.value = false
}
const importSceneFile = async () => {
  if (!(await rawDesigner.importSceneFile())) return
  surface.value = null
  showWelcome.value = false
}
const openSaveAs = () => {
  if (!rawDesigner.activeScene.value || !rawDesigner.hasProject.value) return
  saveAsInitialName.value = rawDesigner.document.value.meta.sceneName
  surface.value = 'saveAs'
}
const saveAsScene = async (sceneName: string) => {
  if (saveAsBusy.value) return
  saveAsBusy.value = true
  try {
    if (await rawDesigner.save('saveAs', { sceneName })) {
      surface.value = null
      showWelcome.value = false
    } else if (rawDesigner.fileConflict.value) {
      surface.value = null
    }
  } finally {
    saveAsBusy.value = false
  }
}
const saveConflictAs = () => {
  rawDesigner.clearFileConflict()
  openSaveAs()
}
const inspectorRef = ref<UiDesignerInspectorExpose>()
const canvasRef = ref<UiDesignerCanvasExpose>()
const editPrimaryNode = (nodeId: string) => {
  rawDesigner.selectNodes([nodeId])
  void nextTick(() => inspectorRef.value?.editPrimaryNode(nodeId))
}
const activateNode = (nodeId: string) => canvasRef.value?.activateNodeById(nodeId)
const toggleGamePreview = () => {
  if (designer.isPreviewing) void designer.stopPreview()
  else if (designer.canStartPreview) void designer.startPreview()
}
const toggleEditorPreview = () => {
  if (designer.isEditorPreviewing) designer.stopEditorPreview()
  else if (designer.canStartEditorPreview) designer.startEditorPreview()
}
const saveCurrentCanvas = () => {
  if (!showWelcome.value && rawDesigner.canSave.value) void rawDesigner.saveScene(rawDesigner.activeSceneId.value)
}
const showEditingMode = () => {
  if (rawDesigner.scenes.value.length) showWelcome.value = false
}
const onUiDesignerMenuCommand = (event: Event) => {
  const command = uiDesignerMenuCommandFromEvent(event)
  if (!command) return
  if (command === 'new') openNewScene()
  else if (command === 'open') void openScenePicker()
  else if (command === 'import') void importSceneFile()
  else if (command === 'save') saveCurrentCanvas()
  else if (command === 'saveAs') openSaveAs()
  else if (command === 'editorPreview') { showEditingMode(); toggleEditorPreview() }
  else if (command === 'gamePreview') { showEditingMode(); toggleGamePreview() }
  else if (command === 'globalData') surface.value = 'globalData'
  else if (command === 'settings') surface.value = 'settings'
  else if (command === 'tour') openTour()
  else if (command === 'shortcuts') surface.value = 'shortcuts'
  else if (command === 'about') surface.value = 'about'
}
const captureSaveShortcut = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 's') return
  if (showWelcome.value || !rawDesigner.canSave.value) return
  event.preventDefault()
  event.stopPropagation()
  saveCurrentCanvas()
}
const clampPane = (side: 'left' | 'center' | 'right', value: number) => normalizePaneSize(side, value)
const beginPaneDrag = (side: 'left' | 'right', event: PointerEvent) => {
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
watch(() => designer.scenes.length, (count, previous) => {
  if (count === 0) showWelcome.value = true
  else if (count > (previous ?? 0)) showWelcome.value = false
})
watch(() => props.projectPath, (next, previous) => {
  if (props.manageProjectContext && next !== previous) void rawDesigner.setProjectContext(next, props.adapters)
})
onMounted(async () => {
  const modifier = (key: string, handler: () => void | Promise<void>, shift = false, description?: string) => shortcutRegistry.register({ key, ctrlOrMeta: true, shift, description, handler })
  modifier('n', openNewScene, false, 'shortcutNewScene')
  modifier('o', openScenePicker, false, 'shortcutOpen')
  shortcutRegistry.register({
    key: 's',
    ctrlOrMeta: true,
    allowInEditable: true,
    description: 'shortcutSave',
    handler: saveCurrentCanvas,
  })
  modifier('z', () => designer.undo(), false, 'shortcutUndo')
  modifier('z', () => designer.redo(), true, 'shortcutRedo')
  modifier('c', () => designer.copy(), false, 'shortcutCopy')
  modifier('x', () => { if (designer.selectedIds[0]) designer.executeNodeAction('cut', designer.selectedIds[0]) }, false, 'shortcutCut')
  modifier('v', () => designer.paste(), false, 'shortcutPaste')
  modifier('w', () => { void designer.closeScene(designer.activeSceneId) }, false, 'shortcutCloseScene')
  modifier('y', () => designer.redo(), false, 'shortcutRedo')
  modifier('d', () => { designer.duplicateSelected() }, false, 'shortcutDuplicate')
  modifier('a', () => { designer.selectNodes(designer.document.nodes.filter((node) => node.id !== 'node_root').map((node) => node.id)) }, false, 'shortcutSelectAll')
  modifier('g', () => { designer.group() }, false, 'shortcutGroup')
  modifier('g', () => { designer.ungroup() }, true, 'shortcutUngroup')
  modifier('[', () => { if (designer.selectedIds.length) designer.moveStep(designer.selectedIds[0], 'up') }, false, 'shortcutMoveUp')
  modifier(']', () => { if (designer.selectedIds.length) designer.moveStep(designer.selectedIds[0], 'down') }, false, 'shortcutMoveDown')
  modifier('[', () => { if (designer.selectedIds.length) designer.moveToEdge(designer.selectedIds[0], 'top') }, true, 'shortcutToTop')
  modifier(']', () => { if (designer.selectedIds.length) designer.moveToEdge(designer.selectedIds[0], 'bottom') }, true, 'shortcutToBottom')
  modifier('0', () => designer.setZoom(1), false, 'shortcutResetZoom')
  modifier('h', () => designer.fitCanvas(), true, 'shortcutFitCanvas')
  modifier('p', toggleEditorPreview, false, 'shortcutEditorPreview')
  modifier(';', () => { designer.setCanvasSetting('guidesVisible', !designer.document.canvas.guidesVisible) }, false, 'shortcutToggleGuides')
  // Bare arrows nudge 1px, Shift+arrows nudge 10px. During editor/game preview,
  // bare arrows belong to runtime button focus navigation, so nudge is skipped.
  for (const [key, delta] of [['ArrowLeft', { x: -1, y: 0 }], ['ArrowRight', { x: 1, y: 0 }], ['ArrowUp', { x: 0, y: -1 }], ['ArrowDown', { x: 0, y: 1 }]] as const) {
    shortcutRegistry.register({ key, description: 'shortcutNudge', handler: () => { if (!designer.isPreviewing && !designer.isEditorPreviewing) designer.nudgeSelected({ x: delta.x, y: delta.y }) } })
    shortcutRegistry.register({ key, shift: true, description: 'shortcutNudge', handler: () => { designer.nudgeSelected({ x: delta.x * 10, y: delta.y * 10 }) } })
  }
  shortcutRegistry.register({ key: 'Delete', description: 'shortcutDelete', handler: () => { designer.removeSelected() } })
  shortcutRegistry.register({ key: 'F6', description: 'shortcutGamePreview', handler: toggleGamePreview })
  shortcutRegistry.register({ key: 'f', shift: true, alt: true, allowInEditable: true, description: 'shortcutFormat', handler: () => { window.dispatchEvent(new Event('agent-rpg:ui-designer-format')) } })
  shortcutRegistry.register({ key: 'Escape', description: 'shortcutEscape', allowInEditable: true, handler: () => { if (designer.isPreviewing) void designer.stopPreview(); else if (designer.isEditorPreviewing) designer.stopEditorPreview() } })
  shortcutRegistry.register({ key: '?', shift: true, description: 'shortcutShortcuts', handler: () => { surface.value = 'shortcuts' } })
  shortcutBindings.value = shortcutRegistry.list()
  window.addEventListener('keydown', captureSaveShortcut, true)
  window.addEventListener('keydown', shortcutRegistry.handle)
  window.addEventListener(UI_DESIGNER_MENU_COMMAND_EVENT, onUiDesignerMenuCommand)
  await rawDesigner.loadPreferences()
  await rawDesigner.loadWelcomeRecords()
  await rawDesigner.loadProjectProfile()
  // The home page is an explicit page: launch lands on it with no scene tabs,
  // so the pristine placeholder scene the controller starts with is closed.
  const initialScene = rawDesigner.scenes.value[0]
  if (initialScene && !initialScene.sourcePath && !rawDesigner.isSceneDirty(initialScene.id)) await rawDesigner.closeScene(initialScene.id)
  showWelcome.value = true
  if (!Boolean(designer.preferences.tourCompleted)) openTour()
})
onBeforeUnmount(() => {
  endPaneDrag()
  window.removeEventListener('keydown', captureSaveShortcut, true)
  window.removeEventListener('keydown', shortcutRegistry.handle)
  window.removeEventListener(UI_DESIGNER_MENU_COMMAND_EVENT, onUiDesignerMenuCommand)
  shortcutRegistry.unregisterAll()
  rawDesigner.flushDrafts()
  if (rawDesigner.isEditorPreviewing.value) rawDesigner.stopEditorPreview()
  if (rawDesigner.isPreviewing.value) rawDesigner.stopPreview()
  void rawDesigner.disposePreview('unload')
  void rawDesigner.flushRecovery()
})
</script>

<template>
    <section class="ui-designer-shell" :class="{ 'code-mode-active': designer.editingMode === 'code' || designer.editingMode === 'json' }" data-ui-id="ui-designer-shell">
    <UiDesignerToolbar :designer="designer" @home="showWelcome = true" @open="void openScenePicker()" @import="void importSceneFile()" @save-as="openSaveAs" @editing-mode="showEditingMode" @scene-settings="surface = 'sceneSettings'" @global-data="surface = 'globalData'" />
    <UiDesignerSceneTabs :designer="designer" @new-scene="openNewScene" />
    <div class="designer-workspace" :class="{ 'welcome-active': showWelcome }" :style="workspaceStyle">
      <aside v-if="!showWelcome" class="left-pane">
        <UiDesignerNodePanel :designer="designer" @activate-node="activateNode" />
      </aside>
      <div v-if="!showWelcome" class="workspace-splitter" role="separator" :aria-label="t('leftPane')" @pointerdown="beginPaneDrag('left', $event)" />
      <main class="center-pane">
        <UiDesignerWelcome v-if="showWelcome" :designer="designer" @new-scene="openNewScene" @open="void openScenePicker()" @return-to-scene="showWelcome = false" @scene-ready="showWelcome = false" />
        <template v-else>
          <UiDesignerCanvas ref="canvasRef" v-show="designer.editingMode === 'design'" :designer="designer" @edit-node="editPrimaryNode" />
          <UiDesignerCodePanel v-show="designer.editingMode === 'code'" :designer="designer" />
          <UiDesignerJsonPanel v-if="designer.editingMode === 'json'" :designer="designer" />
        </template>
      </main>
      <div v-if="!showWelcome" class="workspace-splitter" role="separator" :aria-label="t('rightPane')" @pointerdown="beginPaneDrag('right', $event)" />
      <UiDesignerInspector v-if="!showWelcome" ref="inspectorRef" :designer="designer" />
    </div>
    <UiDesignerNewSceneSurface v-if="surface === 'newScene'" :model-value="true" :draft="newSceneDraft" :template="newSceneTemplate" :template-options="sceneTemplateOptions" :template-label="sceneTemplateLabel" @update:model-value="closeSurface" @update:template="selectNewSceneTemplate" @name-edited="newSceneNameAutomatic = false" @create="createNewScene" @cancel="surface = null" />
    <UiDesignerSettingsSurface v-if="surface === 'settings'" :model-value="true" :designer="designer" :left-pane-width="leftPaneWidth" :right-pane-width="rightPaneWidth" :clamp-pane="(side, value) => clampPane(side, value)" @update:model-value="closeSurface" />
    <UiDesignerSceneSettingsSurface v-if="surface === 'sceneSettings'" :model-value="true" :designer="designer" @update:model-value="closeSurface" />
    <UiDesignerOpenSceneSurface v-if="surface === 'openScene'" :model-value="true" :designer="designer" @update:model-value="closeSurface" @open="void openProjectScene($event)" />
    <UiDesignerSaveAsSurface v-if="surface === 'saveAs'" :model-value="true" :initial-name="saveAsInitialName" :busy="saveAsBusy" @update:model-value="closeSurface" @save="void saveAsScene($event)" />
    <UiDesignerGlobalDataSurface v-if="surface === 'globalData'" :model-value="true" :designer="designer" @update:model-value="closeSurface" />
    <UiDesignerHelpSurface v-if="surface === 'about' || surface === 'shortcuts' || surface === 'tour'" :model-value="true" :surface="surface" :tour-step="tourStep" :shortcut-bindings="shortcutBindings" @update:model-value="closeSurface" @update:tour-step="tourStep = $event" @complete="void completeTour()" />
    <UiDesignerRuntimeReplacementDialog :model-value="designer.runtimeReplacementPending" :busy="designer.fileStatus === 'busy'" @cancel="void designer.resolveRuntimeReplacement('cancel')" @confirm="void designer.resolveRuntimeReplacement('replace')" />

    <el-dialog :model-value="Boolean(designer.fileConflict)" :title="t(designer.saveAsConflict ? 'sceneNameConflictTitle' : 'conflictTitle')" width="min(470px, 92vw)" :close-on-click-modal="false" :show-close="false">
      <p class="dialog-copy">{{ t(designer.saveAsConflict ? 'sceneNameConflictBody' : 'conflictBody') }}</p>
      <template #footer>
        <el-button data-testid="ui-designer-conflict-cancel" @click="designer.clearFileConflict()">{{ t('lifecycleCancel') }}</el-button>
        <el-button v-if="!designer.saveAsConflict" data-testid="ui-designer-conflict-reload" @click="void designer.resolveFileConflict('reload')">{{ t('reload') }}</el-button>
        <el-button v-if="!designer.saveAsConflict" data-testid="ui-designer-conflict-save-as" @click="saveConflictAs">{{ t('saveAs') }}</el-button>
        <el-button data-testid="ui-designer-conflict-force" type="danger" @click="void designer.resolveFileConflict('force')">{{ t('forceSave') }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.ui-designer-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--app-bg-page); color: var(--app-ink); }
.designer-workspace { display: grid; grid-template-columns: var(--ui-designer-left-pane-width, 260px) 5px minmax(0, 1fr) 5px var(--ui-designer-right-pane-width, 320px); flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.designer-workspace.welcome-active { grid-template-columns: minmax(0, 1fr); }
.workspace-splitter { position: relative; z-index: 3; cursor: col-resize; background: var(--app-border); }.workspace-splitter::after { position: absolute; inset: 0 -3px; content: ''; }
.left-pane { display: flex; min-width: 0; min-height: 0; overflow: hidden; padding: 9px; border-right: 1px solid var(--app-border); background: var(--app-bg); }
.center-pane { display: flex; min-width: 0; min-height: 0; }
.inspector-panel { min-width: 0; border-left: 1px solid var(--app-border); }
.code-mode-active .left-pane, .code-mode-active .workspace-splitter, .code-mode-active .inspector-panel { display: none; }
.code-mode-active .designer-workspace { grid-template-columns: minmax(0, 1fr) !important; }
.dialog-stack, .dialog-copy, .tour-copy { color: var(--app-ink); font-size: 13px; line-height: 1.6; }.dialog-copy p { margin: 0 0 10px; }.tour-copy p { min-height: 50px; }
.shortcut-list { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; margin: 0; font-size: 12px; }.shortcut-list dt { color: var(--app-ink-soft); }.shortcut-list dd { margin: 0; }
.export-validation { border: 1px solid var(--app-border); border-radius: 6px; padding: 8px; }.validation-heading { margin-bottom: 5px; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; }.validation-list { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; font-size: 11px; }.validation-list li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 5px; align-items: baseline; }.validation-severity { font-weight: 650; }.validation-error .validation-severity { color: var(--el-color-danger); }.validation-warning .validation-severity { color: var(--el-color-warning); }.validation-target { padding: 0; border: 0; background: transparent; color: var(--app-accent); cursor: pointer; font: inherit; text-align: left; }.validation-location { overflow: hidden; color: var(--app-ink-soft); text-overflow: ellipsis; white-space: nowrap; }.validation-list .status-detail { grid-column: 2 / -1; }
@media (max-width: 900px) { .designer-workspace { grid-template-columns: 180px 0 minmax(0, 1fr) 0 240px; }.workspace-splitter { display: none; } }
</style>
