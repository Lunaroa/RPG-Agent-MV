<script setup lang="ts">
import type { UiPadding } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ value: UiPadding }>()
const emit = defineEmits<{ update: [value: UiPadding] }>()
const { t } = useUiDesignerI18n()
const sideLabels = { top: 'borderTop', right: 'borderRight', bottom: 'borderBottom', left: 'borderLeft' } as const
const update = (key: keyof UiPadding, value: number | null) => emit('update', { ...props.value, [key]: value ?? 0 })
</script>

<template>
  <div class="padding-editor">
    <span class="field-label">{{ t('padding') }}</span>
    <el-input-number v-for="side in ['top', 'right', 'bottom', 'left']" :key="side" :model-value="value[side as keyof UiPadding]" :aria-label="`${t('padding')} ${t(sideLabels[side as keyof typeof sideLabels])}`" :min="0" size="small" @update:model-value="update(side as keyof UiPadding, $event)" />
  </div>
</template>

<style scoped>
.padding-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }.field-label { grid-column: 1 / -1; color: var(--app-ink-soft); font-size: 11px; }
</style>
