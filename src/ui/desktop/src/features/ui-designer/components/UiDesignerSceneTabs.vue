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
  if (designer.isPreviewing) return
  if (!(event.ctrlKey || event.metaKey) || event.key !== 'Tab' || (typeof HTMLElement !== 'undefined' && event.target instanceof HTMLElement && event.target.matches('input,textarea,select,.CodeMirror'))) return
  event.preventDefault()
  const current = designer.scenes.findIndex((scene) => scene.id === designer.activeSceneId)
  const delta = event.shiftKey ? -1 : 1
  const next = (current + delta + designer.scenes.length) % designer.scenes.length
  if (designer.scenes[next]) designer.selectScene(designer.scenes[next].id)
}
onMounted(() => window.addEventListener('keydown', switchTab))
onBeforeUnmount(() => window.removeEventListener('keydown', switchTab))
const tabLabel = (scene: UiDesignerSceneState) => scene.document.meta.sceneName
</script>

<template>
  <nav class="scene-tabs" data-ui-id="ui-designer-scene-tabs" data-testid="ui-designer-scene-tabs" :aria-label="t('scenes')">
    <button
      v-for="scene in designer.scenes"
      :key="scene.id"
      class="scene-tab"
      :data-ui-id="`ui-designer-scene-tab-${scene.id}`"
      :data-testid="`ui-designer-scene-tab-${scene.id}`"
      :class="{ active: scene.id === designer.activeSceneId }"
      :title="tabLabel(scene)"
      type="button"
      :disabled="designer.isPreviewing"
      draggable="true"
      @click="designer.selectScene(scene.id)"
      @dragstart="onDragStart(scene.id, $event)"
      @dragover.prevent
      @drop="onDrop(scene.id, $event)"
    >
      <el-dropdown trigger="contextmenu" @command="(command: string) => command === 'close' ? close(scene.id) : command === 'closeOthers' ? void closeOthers(scene.id) : command === 'closeAll' ? void closeAll() : command === 'revealSource' ? void revealSource(scene) : undefined">
        <span class="scene-tab-content"><span class="scene-tab-label">{{ tabLabel(scene) }}</span><span v-if="designer.isSceneDirty(scene.id)" class="tab-dirty">•</span><el-icon v-if="!designer.isPreviewing" class="tab-close" :data-ui-id="`ui-designer-scene-tab-${scene.id}-close`" :data-testid="`ui-designer-scene-tab-${scene.id}-close`" :title="t('close')" @click.stop="close(scene.id)"><Close /></el-icon></span>
        <template #dropdown><el-dropdown-menu><el-dropdown-item command="close" :disabled="designer.isPreviewing">{{ t('close') }}</el-dropdown-item><el-dropdown-item command="closeOthers" :disabled="designer.isPreviewing">{{ t('closeOthers') }}</el-dropdown-item><el-dropdown-item command="closeAll" :disabled="designer.isPreviewing">{{ t('closeAll') }}</el-dropdown-item><el-dropdown-item command="revealSource" :disabled="designer.isPreviewing || !scene.sourcePath">{{ t('revealSource') }}</el-dropdown-item></el-dropdown-menu></template>
      </el-dropdown>
    </button>
    <el-button class="scene-add" data-ui-id="ui-designer-scene-tab-new" data-testid="ui-designer-scene-tab-new" size="small" text :disabled="designer.isPreviewing" :aria-label="t('newScene')" @click="emit('newScene')">+</el-button>
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
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 190px;
  overflow: hidden;
  padding: 6px 9px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.scene-tab :deep(.el-dropdown) { min-width: 0; max-width: 100%; overflow: hidden; }
.scene-tab-content { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
.scene-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.scene-tab.active {
  border-bottom-color: var(--app-accent);
  color: var(--app-ink);
}

.tab-dirty { flex: 0 0 auto; color: var(--el-color-warning); }
.tab-close { flex: 0 0 auto; opacity: .6; }
.tab-close:hover { opacity: 1; color: var(--el-color-danger); }
.scene-add { flex: 0 0 auto; margin-left: 2px; }
</style>
