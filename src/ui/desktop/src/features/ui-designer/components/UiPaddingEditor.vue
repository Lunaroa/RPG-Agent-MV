<script setup lang="ts">
import type { UiPadding } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ value: UiPadding }>()
const emit = defineEmits<{ update: [value: UiPadding] }>()
const { t } = useUiDesignerI18n()
const sideLabels = { top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft' } as const
const update = (key: keyof UiPadding, value: number | null) => emit('update', { ...props.value, [key]: value ?? 0 })
</script>

<template>
  <div class="padding-editor">
    <span class="field-label">{{ t('padding') }}</span>
    <label v-for="side in ['top', 'right', 'bottom', 'left']" :key="side" class="padding-side">
      <span class="padding-side-label">{{ t(sideLabels[side as keyof typeof sideLabels]) }}</span>
      <el-input-number :model-value="value[side as keyof UiPadding]" :aria-label="`${t('padding')} ${t(sideLabels[side as keyof typeof sideLabels])}`" :min="0" size="small" @update:model-value="update(side as keyof UiPadding, $event)" />
    </label>
  </div>
</template>

<style scoped>
.padding-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }.field-label { grid-column: 1 / -1; color: var(--app-ink-soft); font-size: 11px; }
.padding-side { display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: center; gap: 4px; min-width: 0; }
.padding-side-label { color: var(--app-ink-soft); font-size: 10px; text-align: center; }
.padding-side :deep(.el-input-number) { width: 100%; }
</style>
