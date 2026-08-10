<script setup lang="ts">
import { isRef } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{
  settings: []
  newScene: []
  help: []
  shortcuts: []
  tour: []
  export: []
}>()
const { t } = useUiDesignerI18n()
const designer = props.designer

const togglePreview = () => {
  const previewing = isRef(designer.isPreviewing) ? designer.isPreviewing.value : designer.isPreviewing
  void (previewing ? designer.stopPreview() : designer.startPreview())
}
const toggleEditorPreview = () => {
  void (designer.isEditorPreviewing ? designer.stopEditorPreview() : designer.startEditorPreview())
}
</script>

<template>
  <header class="ui-designer-toolbar" :class="{ 'preview-toolbar': designer.isEditorPreviewing }">
    <template v-if="designer.isEditorPreviewing">
      <el-button data-testid="ui-designer-editor-preview-exit" data-ui-id="ui-designer-editor-preview-exit" class="editor-preview-toggle" size="small" type="success" @click="toggleEditorPreview">
        {{ t('exitEditorPreview') }}
      </el-button>
    </template>
    <template v-else>
    <div class="toolbar-brand">
      <span class="toolbar-title">{{ t('title') }}</span>
      <span v-if="designer.isDirty" data-testid="ui-designer-dirty" class="dirty-dot" :title="t('unsaved')" />
    </div>

    <div class="toolbar-actions">
      <el-button-group>
        <el-button data-testid="ui-designer-new" size="small" :disabled="!designer.canCreateScene" @click="emit('newScene')">{{ t('newScene') }}</el-button>
        <el-button data-testid="ui-designer-open" size="small" :disabled="designer.isEditorPreviewing || !designer.canSave" @click="void designer.open()">{{ t('open') }}</el-button>
        <el-button data-testid="ui-designer-save" size="small" type="primary" :disabled="designer.isEditorPreviewing || !designer.canSave || !designer.isDirty" @click="void designer.save()">{{ t('save') }}</el-button>
        <el-button size="small" :disabled="designer.isEditorPreviewing || !designer.canSave" @click="void designer.save('saveAs')">{{ t('saveAs') }}</el-button>
        <el-button data-testid="ui-designer-export" size="small" :disabled="designer.isEditorPreviewing || !designer.canExport" @click="emit('export')">{{ t('export') }}</el-button>
      </el-button-group>

      <el-button-group>
        <el-tooltip :content="t('undo')"><el-button size="small" :aria-label="t('undo')" :disabled="designer.isEditorPreviewing || !designer.activeScene?.history.canUndo" @click="designer.undo()">↶</el-button></el-tooltip>
        <el-tooltip :content="t('redo')"><el-button size="small" :aria-label="t('redo')" :disabled="designer.isEditorPreviewing || !designer.activeScene?.history.canRedo" @click="designer.redo()">↷</el-button></el-tooltip>
      </el-button-group>

      <el-button-group>
        <el-button data-testid="ui-designer-design-mode" size="small" :disabled="designer.isEditorPreviewing" :type="designer.editingMode === 'design' ? 'primary' : 'default'" @click="designer.setEditingMode('design')">{{ t('design') }}</el-button>
        <el-button data-testid="ui-designer-code-mode" size="small" :disabled="designer.isEditorPreviewing" :type="designer.editingMode === 'code' ? 'primary' : 'default'" @click="designer.setEditingMode('code')">{{ t('code') }}</el-button>
      </el-button-group>

      <el-button data-testid="ui-designer-editor-preview-toggle" class="editor-preview-toggle" size="small" :aria-label="t('editorPreview')" :disabled="!designer.canStartEditorPreview" @click="toggleEditorPreview">
        {{ t('editorPreview') }}
      </el-button>
      <el-button :data-testid="designer.isPreviewing ? 'ui-designer-preview-stop' : 'ui-designer-preview'" size="small" :type="designer.isPreviewing ? 'success' : 'default'" :disabled="!designer.isPreviewing && !designer.canStartGamePreview" @click="togglePreview">
        {{ designer.isPreviewing ? t('close') : t('gamePreview') }}
      </el-button>

      <el-button size="small" text :disabled="designer.isEditorPreviewing" @click="emit('settings')">{{ t('settings') }}</el-button>
      <el-button size="small" text :disabled="designer.isEditorPreviewing" @click="emit('help')">{{ t('help') }}</el-button>
      <el-button size="small" text :disabled="designer.isEditorPreviewing" @click="emit('shortcuts')">{{ t('shortcuts') }}</el-button>
      <el-button size="small" text :disabled="designer.isEditorPreviewing" @click="emit('tour')">{{ t('tour') }}</el-button>
    </div>

    <div class="toolbar-scene">
      <el-input
        :model-value="designer.document.meta.sceneName"
        size="small"
        :aria-label="t('sceneName')"
        :disabled="designer.isEditorPreviewing"
        @update:model-value="designer.setSceneMeta('sceneName', $event)"
      />
      <span class="scene-version">v{{ designer.document.version }}</span>
    </div>
    </template>
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
.preview-toolbar { justify-content: flex-end; min-height: 40px; border-bottom-color: #ffffff1c; background: #090a0d; }

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
