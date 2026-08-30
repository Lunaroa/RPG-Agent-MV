<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'
import UiNamedEntryField from './UiNamedEntryField.vue'

const props = defineProps<{ modelValue: boolean; designer: UiDesignerController }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useUiDesignerI18n()
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('sceneSettings')" width="min(760px, 94vw)" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <el-form class="settings-form" label-position="left" label-width="132px">
      <el-form-item :label="t('sceneName')"><el-input :model-value="designer.document.meta.sceneName" @change="designer.setSceneMeta('sceneName', String($event))" /></el-form-item>
      <el-form-item :label="t('sceneBase')"><el-input :model-value="designer.document.meta.sceneBase" @update:model-value="designer.setSceneMeta('sceneBase', $event)" /></el-form-item>
      <el-form-item :label="t('author')"><el-input :model-value="designer.document.meta.author" @update:model-value="designer.setSceneMeta('author', $event)" /></el-form-item>
      <el-form-item :label="t('description')"><el-input type="textarea" :model-value="designer.document.meta.description" @update:model-value="designer.setSceneMeta('description', $event)" /></el-form-item>
      <el-form-item :label="`${t('width')} × ${t('height')}`"><div class="inline-fields"><el-input-number :model-value="designer.document.canvas.width" :min="1" :max="8192" @change="designer.setCanvasSetting('width', Number($event ?? 1))" /><el-input-number :model-value="designer.document.canvas.height" :min="1" :max="8192" @change="designer.setCanvasSetting('height', Number($event ?? 1))" /></div></el-form-item>
      <el-form-item :label="t('backgroundColor')"><el-color-picker :model-value="designer.document.canvas.backgroundColor" @update:model-value="designer.setCanvasSetting('backgroundColor', $event ?? '#1a1b26')" /></el-form-item>
      <el-form-item :label="t('backgroundPattern')"><el-select :model-value="designer.document.canvas.backgroundPattern" @update:model-value="designer.setCanvasSetting('backgroundPattern', $event)"><el-option value="solid" :label="t('solidPattern')" /><el-option value="checkerboard" :label="t('checkerboardPattern')" /></el-select></el-form-item>
      <el-form-item :label="t('mapBackground')"><div class="inline-fields"><el-input-number :model-value="designer.document.canvas.mapBackground.mapId" :min="0" @change="designer.setMapBackground('mapId', Number($event ?? 0))" /><el-input-number :model-value="designer.document.canvas.mapBackground.blur" :min="0" @change="designer.setMapBackground('blur', Number($event ?? 0))" /><UiNamedEntryField kind="switch" allow-none :model-value="designer.document.canvas.mapBackground.switchId" ui-id="ui-designer-scene-settings-map-switch" @update:model-value="designer.setMapBackground('switchId', $event)" /></div></el-form-item>
      <el-form-item :label="t('globalFilter')"><div class="inline-fields"><el-input-number :model-value="designer.document.globalFilter.blur" :min="0" @change="designer.setGlobalFilter('blur', Number($event ?? 0))" /><el-input-number :model-value="designer.document.globalFilter.glow" :min="0" @change="designer.setGlobalFilter('glow', Number($event ?? 0))" /><el-input :model-value="designer.document.globalFilter.preset" @update:model-value="designer.setGlobalFilter('preset', $event)" /></div></el-form-item>
      <el-form-item :label="t('enterAnimation')"><div class="inline-fields"><el-select :model-value="designer.document.transitions.enter.type" @update:model-value="designer.setTransition('enter', 'type', $event)"><el-option value="none" :label="t('transitionNone')" /><el-option value="fade" :label="t('transitionFade')" /><el-option value="slideLeft" :label="t('transitionSlideLeft')" /><el-option value="slideRight" :label="t('transitionSlideRight')" /></el-select><el-input-number :model-value="designer.document.transitions.enter.duration" :min="0" @change="designer.setTransition('enter', 'duration', Number($event ?? 0))" /></div></el-form-item>
      <el-form-item :label="t('exitAnimation')"><div class="inline-fields"><el-select :model-value="designer.document.transitions.exit.type" @update:model-value="designer.setTransition('exit', 'type', $event)"><el-option value="none" :label="t('transitionNone')" /><el-option value="fade" :label="t('transitionFade')" /><el-option value="slideLeft" :label="t('transitionSlideLeft')" /><el-option value="slideRight" :label="t('transitionSlideRight')" /></el-select><el-input-number :model-value="designer.document.transitions.exit.duration" :min="0" @change="designer.setTransition('exit', 'duration', Number($event ?? 0))" /></div></el-form-item>
    </el-form>
  </el-dialog>
</template>

<style scoped>
.settings-form :deep(.el-form-item) { align-items: flex-start; margin-bottom: 10px; }
.settings-form :deep(.el-form-item__label) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.settings-form :deep(.el-form-item__content) { min-width: 0; }
.settings-form :deep(.el-input), .settings-form :deep(.el-select), .settings-form :deep(.el-input-number) { width: 100%; }
.inline-fields { display: flex; flex-wrap: nowrap; gap: 8px; width: 100%; min-width: 0; }
.inline-fields > * { min-width: 0; flex: 1; }
</style>
