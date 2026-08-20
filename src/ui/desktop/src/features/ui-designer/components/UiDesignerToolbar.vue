<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{
  settings: []
  help: []
  shortcuts: []
  tour: []
  export: []
  home: []
  'editing-mode': [mode: 'design' | 'code' | 'json']
}>()
const { t } = useUiDesignerI18n()
const designer = props.designer
const sceneNameDraft = ref(designer.document.meta.sceneName)
let sceneNamePending = false
const previewSceneName = (value: string) => {
  sceneNameDraft.value = value
  sceneNamePending = value !== designer.document.meta.sceneName
}
const commitSceneName = () => {
  if (!sceneNamePending) return
  const value = sceneNameDraft.value
  sceneNamePending = false
  if (value !== designer.document.meta.sceneName) designer.setSceneMeta('sceneName', value)
}
const cancelSceneName = () => {
  sceneNamePending = false
  sceneNameDraft.value = designer.document.meta.sceneName
}
const unregisterSceneNameDraft = designer.draftCoordinator.register(commitSceneName, {
  cancel: cancelSceneName,
  sceneId: () => designer.activeSceneId,
  pending: () => sceneNamePending,
})
watch(() => designer.document.meta.sceneName, (value) => {
  sceneNamePending = false
  sceneNameDraft.value = value
})
onBeforeUnmount(() => { commitSceneName(); unregisterSceneNameDraft() })

const toggleEditorPreview = () => { void (designer.isEditorPreviewing ? designer.stopEditorPreview() : designer.startEditorPreview()) }
const toggleGamePreview = () => { void (designer.isPreviewing ? designer.stopPreview() : designer.startPreview()) }
const selectEditingMode = (mode: 'design' | 'code' | 'json') => {
  designer.setEditingMode(mode)
  emit('editing-mode', mode)
}
</script>

<template>
  <header class="ui-designer-toolbar">
    <div class="toolbar-brand">
      <span class="toolbar-title">{{ t('title') }}</span>
      <span v-if="designer.isDirty" data-testid="ui-designer-dirty" class="dirty-dot" :title="t('unsaved')" />
    </div>

    <div class="toolbar-actions">
      <el-button data-testid="ui-designer-home" data-ui-id="ui-designer-home" size="small" text @click="emit('home')">{{ t('home') }}</el-button>
      <el-button-group>
        <el-button data-testid="ui-designer-open" size="small" :disabled="!designer.canSave" @click="void designer.open()">{{ t('open') }}</el-button>
        <el-button data-testid="ui-designer-save" size="small" type="primary" :disabled="!designer.canSave || !designer.isDirty" @click="void designer.save()">{{ t('save') }}</el-button>
        <el-button data-testid="ui-designer-export" size="small" :disabled="!designer.canExport" @click="emit('export')">{{ t('export') }}</el-button>
      </el-button-group>

      <el-button-group>
        <el-tooltip :content="t('undo')"><el-button size="small" :aria-label="t('undo')" :disabled="!designer.activeScene?.history.canUndo" @click="designer.undo()">↶</el-button></el-tooltip>
        <el-tooltip :content="t('redo')"><el-button size="small" :aria-label="t('redo')" :disabled="!designer.activeScene?.history.canRedo" @click="designer.redo()">↷</el-button></el-tooltip>
      </el-button-group>

      <el-button-group>
        <el-button data-testid="ui-designer-design-mode" data-ui-id="ui-designer-design-mode" size="small" :type="designer.editingMode === 'design' ? 'primary' : 'default'" @click="selectEditingMode('design')">{{ t('design') }}</el-button>
        <el-button data-testid="ui-designer-code-mode" data-ui-id="ui-designer-code-mode" size="small" :type="designer.editingMode === 'code' ? 'primary' : 'default'" @click="selectEditingMode('code')">{{ t('code') }}</el-button>
        <el-button data-testid="ui-designer-json-mode" data-ui-id="ui-designer-json-mode" size="small" :type="designer.editingMode === 'json' ? 'primary' : 'default'" @click="selectEditingMode('json')">{{ t('json') }}</el-button>
      </el-button-group>

      <el-button data-testid="ui-designer-preview-toggle" data-ui-id="ui-designer-preview-enter" class="editor-preview-toggle" size="small" :type="designer.isEditorPreviewing ? 'success' : 'default'" :aria-label="t(designer.isEditorPreviewing ? 'exitEditorPreview' : 'editorPreview')" :disabled="!designer.isEditorPreviewing && !designer.canStartEditorPreview" @click="toggleEditorPreview">
        {{ t(designer.isEditorPreviewing ? 'exitEditorPreview' : 'editorPreview') }}
      </el-button>
      <el-button data-testid="ui-designer-game-preview-toggle" data-ui-id="ui-designer-game-preview-enter" size="small" :type="designer.isPreviewing ? 'success' : 'default'" :aria-label="t(designer.isPreviewing ? 'exitGamePreview' : 'gamePreview')" :disabled="!designer.isPreviewing && !designer.canStartPreview" @click="toggleGamePreview">
        {{ t(designer.isPreviewing ? 'exitGamePreview' : 'gamePreview') }}
      </el-button>

      <el-button size="small" text @click="emit('settings')">{{ t('settings') }}</el-button>
      <el-button size="small" text @click="emit('help')">{{ t('help') }}</el-button>
      <el-button size="small" text @click="emit('shortcuts')">{{ t('shortcuts') }}</el-button>
      <el-button size="small" text @click="emit('tour')">{{ t('tour') }}</el-button>
    </div>

    <div class="toolbar-scene">
      <el-input
        :model-value="sceneNameDraft"
        size="small"
        :aria-label="t('sceneName')"
        @update:model-value="previewSceneName"
        @blur="commitSceneName"
        @keydown.enter.prevent="commitSceneName"
      />
      <span class="scene-version">v{{ designer.document.version }}</span>
    </div>
  </header>
</template>

<style scoped>
.ui-designer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
}

.toolbar-brand {
  display: flex;
  align-items: center;
  min-width: 130px;
  gap: 7px;
}

.toolbar-title {
  font-weight: 650;
  white-space: nowrap;
}

.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-warning);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.editor-preview-toggle { font-weight: 650; }
.toolbar-scene {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
}

.scene-version {
  color: var(--app-ink-soft);
  font-size: 11px;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .toolbar-brand { min-width: auto; }
  .toolbar-scene { width: 150px; }
}
</style>
