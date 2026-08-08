<script setup lang="ts">
import type { UiButtonImageStates } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{ value: UiButtonImageStates }>()
const emit = defineEmits<{ update: [value: UiButtonImageStates] }>()
const { t } = useUiDesignerI18n()
const update = (key: keyof UiButtonImageStates, value: string) => emit('update', { ...props.value, [key]: value })
</script>

<template>
  <div class="states-editor">
    <span class="field-label">{{ t('imageStates') }}</span>
    <label v-for="state in ['normal', 'hover', 'pressed', 'disabled']" :key="state"><span>{{ t(state === 'normal' ? 'normalState' : state === 'hover' ? 'hoverState' : state === 'pressed' ? 'pressedState' : 'disabledState') }}</span><el-input :model-value="value[state as keyof UiButtonImageStates]" size="small" @update:model-value="update(state as keyof UiButtonImageStates, $event)" /></label>
  </div>
</template>

<style scoped>
.states-editor { display: flex; flex-direction: column; gap: 5px; }.field-label { color: var(--app-ink-soft); font-size: 11px; }.states-editor label { display: grid; grid-template-columns: 72px 1fr; align-items: center; gap: 5px; color: var(--app-ink-soft); font-size: 10px; }
</style>
