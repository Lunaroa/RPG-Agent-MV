<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'
import { cloneUiDocument } from '../models/document'
import { isValidUiDesignerSceneName } from '../models/validation'
import UiNamedEntryField from './UiNamedEntryField.vue'

const props = defineProps<{ modelValue: boolean; designer: UiDesignerController }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  deleteScene: [scene: { sourcePath: string; sceneName: string }]
}>()
const { t } = useUiDesignerI18n()
const draft = reactive(cloneUiDocument(props.designer.document))
const sceneNameValid = computed(() => isValidUiDesignerSceneName(draft.meta.sceneName))
const confirm = () => {
  if (!sceneNameValid.value || !props.designer.applySceneSettings(draft)) return
  emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('sceneSettings')" width="min(760px, 94vw)" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <el-form class="settings-form" label-position="left" label-width="132px">
      <el-form-item :label="t('sceneTitle')"><el-input v-model="draft.meta.title" data-ui-id="ui-designer-scene-settings-title" /></el-form-item>
      <el-form-item :label="t('sceneName')" :error="sceneNameValid ? '' : t('sceneNameInvalid')"><el-input v-model="draft.meta.sceneName" /></el-form-item>
      <el-form-item :label="t('sceneBase')"><el-input v-model="draft.meta.sceneBase" /></el-form-item>
      <el-form-item :label="t('author')"><el-input v-model="draft.meta.author" /></el-form-item>
      <el-form-item :label="t('description')"><el-input v-model="draft.meta.description" type="textarea" /></el-form-item>
      <el-form-item :label="`${t('width')} × ${t('height')}`"><div class="inline-fields"><el-input-number v-model="draft.canvas.width" :min="1" :max="8192" /><el-input-number v-model="draft.canvas.height" :min="1" :max="8192" /></div></el-form-item>
      <el-form-item :label="t('backgroundColor')"><el-color-picker :model-value="draft.canvas.backgroundColor" @update:model-value="draft.canvas.backgroundColor = $event ?? '#1a1b26'" /></el-form-item>
      <el-form-item :label="t('backgroundPattern')"><el-select v-model="draft.canvas.backgroundPattern"><el-option value="solid" :label="t('solidPattern')" /><el-option value="checkerboard" :label="t('checkerboardPattern')" /></el-select></el-form-item>
      <el-form-item :label="t('mapBackground')"><div class="inline-fields"><el-input-number v-model="draft.canvas.mapBackground.mapId" :min="0" /><el-input-number v-model="draft.canvas.mapBackground.blur" :min="0" /><UiNamedEntryField kind="switch" allow-none :model-value="draft.canvas.mapBackground.switchId" ui-id="ui-designer-scene-settings-map-switch" @update:model-value="draft.canvas.mapBackground.switchId = $event" /></div></el-form-item>
      <el-form-item :label="t('globalFilter')"><div class="inline-fields"><el-input-number v-model="draft.globalFilter.blur" :min="0" /><el-input-number v-model="draft.globalFilter.glow" :min="0" /><el-input v-model="draft.globalFilter.preset" /></div></el-form-item>
      <el-form-item :label="t('enterAnimation')"><div class="inline-fields"><el-select v-model="draft.transitions.enter.type"><el-option value="none" :label="t('transitionNone')" /><el-option value="fade" :label="t('transitionFade')" /><el-option value="slideLeft" :label="t('transitionSlideLeft')" /><el-option value="slideRight" :label="t('transitionSlideRight')" /></el-select><el-input-number v-model="draft.transitions.enter.duration" :min="0" /></div></el-form-item>
      <el-form-item :label="t('exitAnimation')"><div class="inline-fields"><el-select v-model="draft.transitions.exit.type"><el-option value="none" :label="t('transitionNone')" /><el-option value="fade" :label="t('transitionFade')" /><el-option value="slideLeft" :label="t('transitionSlideLeft')" /><el-option value="slideRight" :label="t('transitionSlideRight')" /></el-select><el-input-number v-model="draft.transitions.exit.duration" :min="0" /></div></el-form-item>
    </el-form>
    <template #footer><div class="settings-footer">
      <el-button
        v-if="designer.activeScene?.sourcePath"
        class="delete-scene-button"
        data-testid="ui-designer-scene-settings-delete"
        type="danger"
        :disabled="designer.fileStatus === 'busy'"
        @click="emit('deleteScene', { sourcePath: designer.activeScene.sourcePath, sceneName: designer.document.meta.sceneName })"
      >{{ t('deleteScene') }}</el-button>
      <el-button @click="emit('update:modelValue', false)">{{ t('close') }}</el-button>
      <el-button data-ui-id="ui-designer-scene-settings-confirm" type="primary" :disabled="!sceneNameValid" @click="confirm">{{ t('sceneSettingsConfirm') }}</el-button>
    </div></template>
  </el-dialog>
</template>

<style scoped>
.settings-form :deep(.el-form-item) { align-items: flex-start; margin-bottom: 10px; }
.settings-form :deep(.el-form-item__label) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.settings-form :deep(.el-form-item__content) { min-width: 0; }
.settings-form :deep(.el-input), .settings-form :deep(.el-select), .settings-form :deep(.el-input-number) { width: 100%; }
.inline-fields { display: flex; flex-wrap: nowrap; gap: 8px; width: 100%; min-width: 0; }
.inline-fields > * { min-width: 0; flex: 1; }
.settings-footer { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
.settings-footer > .el-button { margin-left: 0; }
.settings-footer > .delete-scene-button { margin-right: auto; }
</style>
