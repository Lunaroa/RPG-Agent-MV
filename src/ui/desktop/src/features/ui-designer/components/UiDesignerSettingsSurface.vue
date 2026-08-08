<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  modelValue: boolean
  designer: UiDesignerController
  leftPaneWidth: number
  leftNodePaneHeight: number
  rightPaneWidth: number
  clampPane: (side: 'left' | 'right', value: number) => number
  clampLeftStack: (value: number) => number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useUiDesignerI18n()
const close = (visible: boolean) => emit('update:modelValue', visible)
const updatePane = (side: 'left' | 'right', value: unknown) => {
  const fallback = side === 'left' ? 260 : 320
  const next = props.clampPane(side, Number(value ?? fallback))
  void props.designer.savePreferences(side === 'left' ? { leftPaneWidth: next } : { rightPaneWidth: next })
}
const updateNodePane = (value: unknown) => {
  const next = props.clampLeftStack(Number(value ?? 420))
  void props.designer.savePreferences({ leftNodePaneHeight: next })
}
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('settings')" width="min(620px, 92vw)" destroy-on-close @update:model-value="close">
    <div class="dialog-stack">
      <el-form label-position="top">
        <el-form-item :label="t('sceneBase')"><el-input :model-value="designer.document.meta.sceneBase" @update:model-value="designer.setSceneMeta('sceneBase', $event)" /></el-form-item>
        <el-form-item :label="t('author')"><el-input :model-value="designer.document.meta.author" @update:model-value="designer.setSceneMeta('author', $event)" /></el-form-item>
        <el-form-item :label="t('description')"><el-input type="textarea" :model-value="designer.document.meta.description" @update:model-value="designer.setSceneMeta('description', $event)" /></el-form-item>
        <el-form-item :label="`${t('width')} × ${t('height')}`"><div class="inline-fields"><el-input-number :model-value="designer.document.canvas.width" :min="1" :max="8192" @change="designer.setCanvasSetting('width', Number($event ?? 1))" /><el-input-number :model-value="designer.document.canvas.height" :min="1" :max="8192" @change="designer.setCanvasSetting('height', Number($event ?? 1))" /></div></el-form-item>
        <el-form-item :label="t('backgroundColor')"><el-color-picker :model-value="designer.document.canvas.backgroundColor" @update:model-value="designer.setCanvasSetting('backgroundColor', $event ?? '#1a1b26')" /></el-form-item>
        <el-form-item :label="t('backgroundPattern')"><el-select :model-value="designer.document.canvas.backgroundPattern" @update:model-value="designer.setCanvasSetting('backgroundPattern', $event)"><el-option value="solid" :label="t('solidPattern')" /><el-option value="checkerboard" :label="t('checkerboardPattern')" /></el-select></el-form-item>
        <el-form-item :label="t('mapBackground')"><div class="inline-fields"><el-input-number :model-value="designer.document.canvas.mapBackground.mapId" :min="0" @change="designer.setMapBackground('mapId', Number($event ?? 0))" /><el-input-number :model-value="designer.document.canvas.mapBackground.blur" :min="0" @change="designer.setMapBackground('blur', Number($event ?? 0))" /><el-input-number :model-value="designer.document.canvas.mapBackground.switchId" :min="0" @change="designer.setMapBackground('switchId', Number($event ?? 0))" /></div></el-form-item>
        <el-form-item :label="t('globalFilter')"><div class="inline-fields"><el-input-number :model-value="designer.document.globalFilter.blur" :min="0" @change="designer.setGlobalFilter('blur', Number($event ?? 0))" /><el-input-number :model-value="designer.document.globalFilter.glow" :min="0" @change="designer.setGlobalFilter('glow', Number($event ?? 0))" /><el-input :model-value="designer.document.globalFilter.preset" @update:model-value="designer.setGlobalFilter('preset', $event)" /></div></el-form-item>
        <el-form-item :label="t('enterAnimation')"><div class="inline-fields"><el-select :model-value="designer.document.transitions.enter.type" @update:model-value="designer.setTransition('enter', 'type', $event)"><el-option value="none" :label="t('transitionNone')" /><el-option value="fade" :label="t('transitionFade')" /><el-option value="slideLeft" :label="t('transitionSlideLeft')" /><el-option value="slideRight" :label="t('transitionSlideRight')" /></el-select><el-input-number :model-value="designer.document.transitions.enter.duration" :min="0" @change="designer.setTransition('enter', 'duration', Number($event ?? 0))" /></div></el-form-item>
        <el-form-item :label="t('exitAnimation')"><div class="inline-fields"><el-select :model-value="designer.document.transitions.exit.type" @update:model-value="designer.setTransition('exit', 'type', $event)"><el-option value="none" :label="t('transitionNone')" /><el-option value="fade" :label="t('transitionFade')" /><el-option value="slideLeft" :label="t('transitionSlideLeft')" /><el-option value="slideRight" :label="t('transitionSlideRight')" /></el-select><el-input-number :model-value="designer.document.transitions.exit.duration" :min="0" @change="designer.setTransition('exit', 'duration', Number($event ?? 0))" /></div></el-form-item>
        <el-form-item :label="t('historyLimit')"><el-input-number :model-value="Number(designer.preferences.historyLimit ?? 100)" :min="1" :max="500" @change="void designer.setHistoryLimit(Number($event ?? 100))" /></el-form-item>
        <el-form-item :label="t('gridPreference')"><el-switch :model-value="Boolean(designer.preferences.gridEnabled)" @update:model-value="void designer.setGridPreference($event)" /></el-form-item>
        <el-form-item :label="t('snapPreference')"><el-switch :model-value="Boolean(designer.preferences.snapEnabled)" @update:model-value="void designer.setSnapPreference($event)" /></el-form-item>
        <el-form-item :label="t('gridSize')"><el-input-number :model-value="Number(designer.preferences.gridSize ?? 16)" :min="1" :max="256" @change="void designer.savePreferences({ gridSize: Number($event ?? 16) })" /></el-form-item>
        <el-form-item :label="t('gridColor')"><el-color-picker :model-value="String(designer.preferences.gridColor ?? '#394150')" @update:model-value="void designer.savePreferences({ gridColor: $event ?? '#394150' })" /></el-form-item>
        <el-form-item :label="t('snapSensitivity')"><el-input-number :model-value="Number(designer.preferences.snapSensitivity ?? 8)" :min="0" :max="64" @change="void designer.savePreferences({ snapSensitivity: Number($event ?? 8) })" /></el-form-item>
        <el-form-item :label="t('autoSaveIntervalMinutes')"><el-input-number :model-value="Number(designer.preferences.autoSaveIntervalMinutes ?? 1)" :min="0" :max="120" :step="1" @change="void designer.savePreferences({ autoSaveIntervalMinutes: Number($event ?? 1) })" /></el-form-item>
        <el-form-item :label="t('defaultCanvas')"><div class="inline-fields"><el-input-number :model-value="Number(designer.preferences.defaultCanvasWidth ?? 816)" :min="1" :max="8192" @change="void designer.savePreferences({ defaultCanvasWidth: Number($event ?? 816) })" /><el-input-number :model-value="Number(designer.preferences.defaultCanvasHeight ?? 624)" :min="1" :max="8192" @change="void designer.savePreferences({ defaultCanvasHeight: Number($event ?? 624) })" /></div></el-form-item>
        <el-form-item :label="t('defaultAuthor')"><el-input :model-value="String(designer.preferences.defaultAuthor ?? '')" @update:model-value="void designer.savePreferences({ defaultAuthor: $event })" /></el-form-item>
        <el-form-item :label="t('codeFont')"><el-input :model-value="String(designer.preferences.codeFontFamily ?? 'ui-monospace')" @update:model-value="void designer.savePreferences({ codeFontFamily: $event })" /></el-form-item>
        <el-form-item :label="t('codeFontSize')"><el-input-number :model-value="Number(designer.preferences.codeFontSize ?? 12)" :min="8" :max="32" @change="void designer.savePreferences({ codeFontSize: Number($event ?? 12) })" /></el-form-item>
        <el-form-item :label="t('codeTabSize')"><el-input-number :model-value="Number(designer.preferences.codeTabSize ?? 2)" :min="1" :max="8" @change="void designer.savePreferences({ codeTabSize: Number($event ?? 2) })" /></el-form-item>
        <el-form-item :label="t('theme')"><el-select :model-value="String(designer.preferences.theme ?? 'system')" @update:model-value="void designer.savePreferences({ theme: $event })"><el-option value="system" :label="t('themeSystem')" /><el-option value="light" :label="t('themeLight')" /><el-option value="dark" :label="t('themeDark')" /></el-select></el-form-item>
        <el-form-item :label="t('autoFormat')"><el-switch :model-value="Boolean(designer.preferences.autoFormat)" @update:model-value="void designer.savePreferences({ autoFormat: $event })" /></el-form-item>
        <el-divider />
        <el-form-item :label="t('paneSizes')"><div class="inline-fields"><el-input-number :model-value="props.leftPaneWidth" :min="200" :max="500" @change="updatePane('left', $event)" /><el-input-number :model-value="props.leftNodePaneHeight" :min="180" :max="800" @change="updateNodePane($event)" /><el-input-number :model-value="props.rightPaneWidth" :min="240" :max="550" @change="updatePane('right', $event)" /></div></el-form-item>
      </el-form>
    </div>
  </el-dialog>
</template>

<style scoped>
.dialog-stack { color: var(--app-ink); font-size: 13px; line-height: 1.6; }.inline-fields { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }.inline-fields > * { min-width: 120px; flex: 1; }
</style>
