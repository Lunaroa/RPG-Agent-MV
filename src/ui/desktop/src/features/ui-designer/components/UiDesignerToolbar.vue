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
  <header class="ui-designer-toolbar">
    <div class="toolbar-brand">
      <span class="toolbar-title">{{ t('title') }}</span>
      <span v-if="designer.isDirty" data-testid="ui-designer-dirty" class="dirty-dot" :title="t('unsaved')" />
    </div>

    <div class="toolbar-actions">
      <el-button-group>
        <el-button data-testid="ui-designer-new" size="small" :disabled="designer.isEditorPreviewing" @click="emit('newScene')">{{ t('newScene') }}</el-button>
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
        <el-button data-testid="ui-designer-design-mode" size="small" :disabled="designer.isEditorPreviewing" :type="designer.editingMode === 'design' ? 'primary' : 'default'" @click="designer.editingMode = 'design'">{{ t('design') }}</el-button>
        <el-button data-testid="ui-designer-code-mode" size="small" :disabled="designer.isEditorPreviewing" :type="designer.editingMode === 'code' ? 'primary' : 'default'" @click="designer.editingMode = 'code'">{{ t('code') }}</el-button>
      </el-button-group>

      <el-button data-testid="ui-designer-editor-preview-toggle" class="editor-preview-toggle" size="small" :aria-label="designer.isEditorPreviewing ? t('exitEditorPreview') : t('editorPreview')" :type="designer.isEditorPreviewing ? 'success' : 'default'" @click="toggleEditorPreview">
        {{ designer.isEditorPreviewing ? t('exitEditorPreview') : t('editorPreview') }}
      </el-button>
      <template v-if="designer.isEditorPreviewing">
        <el-select size="small" :model-value="designer.editorPreviewResolution" :aria-label="t('editorPreviewResolution')" @update:model-value="designer.setEditorPreviewResolution($event)">
          <el-option value="816x624" :label="t('resolution816')" />
          <el-option value="1280x720" :label="t('resolution1280')" />
          <el-option value="1920x1080" :label="t('resolution1920')" />
        </el-select>
        <el-select size="small" :model-value="designer.editorPreviewConditionMode" :aria-label="t('previewConditions')" @update:model-value="designer.setEditorPreviewConditionMode($event)">
          <el-option value="all-on" :label="t('conditionAllOn')" />
          <el-option value="all-off" :label="t('conditionAllOff')" />
        </el-select>
      </template>
      <el-button :data-testid="designer.isPreviewing ? 'ui-designer-preview-stop' : 'ui-designer-preview'" size="small" :type="designer.isPreviewing ? 'success' : 'default'" :disabled="designer.isEditorPreviewing || !designer.canPreview" @click="togglePreview">
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
