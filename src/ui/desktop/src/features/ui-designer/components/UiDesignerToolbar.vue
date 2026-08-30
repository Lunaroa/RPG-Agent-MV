<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{
  open: []
  'save-as': []
  'scene-settings': []
  'global-data': []
  home: []
  'editing-mode': [mode: 'design' | 'code' | 'json']
}>()
const { t } = useUiDesignerI18n()
const designer = props.designer

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
        <el-button data-testid="ui-designer-open" size="small" :disabled="!designer.canSave || !designer.hasProject" @click="emit('open')">{{ t('open') }}</el-button>
        <el-button data-testid="ui-designer-save" size="small" type="primary" :disabled="!designer.canSave || !designer.isDirty" @click="void designer.save()">{{ t('save') }}</el-button>
        <el-button data-testid="ui-designer-save-as" size="small" :disabled="!designer.canSave || !designer.hasProject" @click="emit('save-as')">{{ t('saveAs') }}</el-button>
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

      <el-button data-testid="ui-designer-preview-toggle" :data-ui-id="designer.isEditorPreviewing ? 'ui-designer-preview-exit' : 'ui-designer-preview-enter'" class="editor-preview-toggle" size="small" :type="designer.isEditorPreviewing ? 'success' : 'default'" :aria-label="t(designer.isEditorPreviewing ? 'exitEditorPreview' : 'editorPreview')" :disabled="!designer.isEditorPreviewing && !designer.canStartEditorPreview" @click="toggleEditorPreview">
        {{ t(designer.isEditorPreviewing ? 'exitEditorPreview' : 'editorPreview') }}
      </el-button>
      <el-button data-testid="ui-designer-game-preview-toggle" :data-ui-id="designer.isPreviewing ? 'ui-designer-game-preview-exit' : 'ui-designer-game-preview-enter'" size="small" :type="designer.isPreviewing ? 'success' : 'default'" :aria-label="t(designer.isPreviewing ? 'exitGamePreview' : 'gamePreview')" :disabled="!designer.isPreviewing && !designer.canStartPreview" @click="toggleGamePreview">
        {{ t(designer.isPreviewing ? 'exitGamePreview' : 'gamePreview') }}
      </el-button>

      <el-button data-testid="ui-designer-scene-settings" size="small" text :disabled="!designer.activeScene" @click="emit('scene-settings')">{{ t('sceneSettings') }}</el-button>
      <el-button data-testid="ui-designer-global-data" size="small" text :disabled="!designer.hasProject" @click="emit('global-data')">{{ t('globalData') }}</el-button>
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

@media (max-width: 1100px) {
  .toolbar-brand { min-width: auto; }
}
</style>
