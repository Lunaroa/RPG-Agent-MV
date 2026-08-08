<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { UiDesignerController, UiDesignerSceneState } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{ newScene: [] }>()
const { t } = useUiDesignerI18n()
const designer = props.designer

const close = (sceneId: string) => { void designer.closeScene(sceneId) }
const closeOthers = async (sceneId: string) => {
  for (const scene of [...designer.scenes]) if (scene.id !== sceneId && !(await designer.closeScene(scene.id))) break
}
const closeAll = async () => {
  for (const scene of [...designer.scenes]) if (!(await designer.closeScene(scene.id))) break
}
const revealSource = async (scene: UiDesignerSceneState) => {
  if (!scene.sourcePath) return
  const result = await designer.adapters.file.revealSource(scene.sourcePath)
  if (result.status !== 'success') { designer.fileStatus = result.status; designer.fileMessage = result.message }
}
const draggedSceneId = ref<string>()
const onDragStart = (sceneId: string, event: DragEvent) => { draggedSceneId.value = sceneId; event.dataTransfer?.setData('text/ui-scene-id', sceneId); event.dataTransfer!.effectAllowed = 'move' }
const onDrop = (targetSceneId: string, event: DragEvent) => { event.preventDefault(); const sceneId = draggedSceneId.value ?? event.dataTransfer?.getData('text/ui-scene-id'); if (sceneId) designer.reorderScenes(sceneId, targetSceneId); draggedSceneId.value = undefined }
const switchTab = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Tab' || (typeof HTMLElement !== 'undefined' && event.target instanceof HTMLElement && event.target.matches('input,textarea,select,.CodeMirror'))) return
  event.preventDefault()
  const current = designer.scenes.findIndex((scene) => scene.id === designer.activeSceneId)
  const delta = event.shiftKey ? -1 : 1
  const next = (current + delta + designer.scenes.length) % designer.scenes.length
  if (designer.scenes[next]) designer.selectScene(designer.scenes[next].id)
}
onMounted(() => window.addEventListener('keydown', switchTab))
onBeforeUnmount(() => window.removeEventListener('keydown', switchTab))
const tabLabel = (scene: UiDesignerSceneState) => {
  const source = scene.sourcePath?.split(/[\\/]/).pop()
  return source ? `${source} · ${scene.document.meta.sceneName}` : scene.document.meta.sceneName
}
</script>

<template>
  <nav class="scene-tabs" :aria-label="t('scenes')">
    <button
      v-for="scene in designer.scenes"
      :key="scene.id"
      class="scene-tab"
      :class="{ active: scene.id === designer.activeSceneId }"
      type="button"
      :disabled="designer.isEditorPreviewing"
      draggable="true"
      @click="designer.selectScene(scene.id)"
      @dragstart="onDragStart(scene.id, $event)"
      @dragover.prevent
      @drop="onDrop(scene.id, $event)"
    >
      <el-dropdown trigger="contextmenu" @command="(command: string) => command === 'close' ? close(scene.id) : command === 'closeOthers' ? void closeOthers(scene.id) : command === 'closeAll' ? void closeAll() : command === 'revealSource' ? void revealSource(scene) : undefined">
        <span class="scene-tab-content"><span>{{ tabLabel(scene) }}</span><span v-if="designer.isSceneDirty(scene.id)" class="tab-dirty">•</span><el-icon v-if="!designer.isEditorPreviewing" class="tab-close" :title="t('close')" @click.stop="close(scene.id)"><Close /></el-icon></span>
        <template #dropdown><el-dropdown-menu><el-dropdown-item command="close" :disabled="designer.isEditorPreviewing">{{ t('close') }}</el-dropdown-item><el-dropdown-item command="closeOthers" :disabled="designer.isEditorPreviewing">{{ t('closeOthers') }}</el-dropdown-item><el-dropdown-item command="closeAll" :disabled="designer.isEditorPreviewing">{{ t('closeAll') }}</el-dropdown-item><el-dropdown-item command="revealSource" :disabled="designer.isEditorPreviewing || !scene.sourcePath">{{ t('revealSource') }}</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
    </button>
    <el-button class="scene-add" size="small" text :disabled="designer.isEditorPreviewing" :aria-label="t('newScene')" @click="emit('newScene')">+</el-button>
  </nav>
</template>

<style scoped>
.scene-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 34px;
  padding: 3px 10px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-bg) 92%, var(--app-accent) 8%);
}

.scene-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 190px;
  padding: 6px 9px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.scene-tab.active {
  border-bottom-color: var(--app-accent);
  color: var(--app-ink);
}

.tab-dirty { color: var(--el-color-warning); }
.tab-close { opacity: .6; }
.tab-close:hover { opacity: 1; color: var(--el-color-danger); }
.scene-add { margin-left: 2px; }
</style>
