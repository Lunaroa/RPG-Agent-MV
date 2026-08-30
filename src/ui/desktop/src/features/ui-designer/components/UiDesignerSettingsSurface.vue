<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  modelValue: boolean
  designer: UiDesignerController
  leftPaneWidth: number
  rightPaneWidth: number
  clampPane: (side: 'left' | 'right', value: number) => number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useUiDesignerI18n()
const close = (visible: boolean) => emit('update:modelValue', visible)
const updatePane = (side: 'left' | 'right', value: unknown) => {
  const fallback = side === 'left' ? 260 : 320
  const next = props.clampPane(side, Number(value ?? fallback))
  void props.designer.savePreferences(side === 'left' ? { leftPaneWidth: next } : { rightPaneWidth: next })
}
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('settings')" width="min(760px, 94vw)" destroy-on-close @update:model-value="close">
    <div class="dialog-stack">
      <el-form class="settings-form" label-position="left" label-width="132px">
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
        <el-form-item :label="t('paneSizes')"><div class="inline-fields"><el-input-number :model-value="props.leftPaneWidth" :min="200" :max="500" @change="updatePane('left', $event)" /><el-input-number :model-value="props.rightPaneWidth" :min="240" :max="550" @change="updatePane('right', $event)" /></div></el-form-item>
      </el-form>
    </div>
  </el-dialog>
</template>

<style scoped>
.dialog-stack { color: var(--app-ink); font-size: 13px; line-height: 1.6; }.settings-form :deep(.el-form-item) { align-items: flex-start; margin-bottom: 10px; }.settings-form :deep(.el-form-item__label) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }.settings-form :deep(.el-form-item__content) { min-width: 0; }.settings-form :deep(.el-input), .settings-form :deep(.el-select), .settings-form :deep(.el-input-number) { width: 100%; }.inline-fields { display: flex; flex-wrap: nowrap; gap: 8px; width: 100%; min-width: 0; }.inline-fields > * { min-width: 0; flex: 1; }
</style>
