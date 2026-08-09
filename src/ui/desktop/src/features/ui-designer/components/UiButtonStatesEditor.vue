<script setup lang="ts">
import type { UiButtonImageStates } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  value: UiButtonImageStates
  pickResource?: (currentPath?: string) => Promise<string | null>
  resourcePickerDisabled?: boolean
}>()
const emit = defineEmits<{ update: [value: UiButtonImageStates] }>()
const { t } = useUiDesignerI18n()
const update = (key: keyof UiButtonImageStates, value: string) => emit('update', { ...props.value, [key]: value })
const choose = async (key: keyof UiButtonImageStates) => {
  const path = await props.pickResource?.(props.value[key])
  if (path !== null && path !== undefined) update(key, path)
}
</script>

<template>
  <div class="states-editor">
    <span class="field-label">{{ t('imageStates') }}</span>
    <label v-for="state in ['normal', 'hover', 'pressed', 'disabled']" :key="state">
      <span>{{ t(state === 'normal' ? 'normalState' : state === 'hover' ? 'hoverState' : state === 'pressed' ? 'pressedState' : 'disabledState') }}</span>
      <span class="state-resource-control">
        <el-input :model-value="value[state as keyof UiButtonImageStates]" readonly size="small" :placeholder="resourcePickerDisabled ? t('noProject') : t('chooseResource')" />
        <el-button :data-ui-id="`ui-designer-button-state-${state}-select`" size="small" :disabled="!pickResource || resourcePickerDisabled" @click="void choose(state as keyof UiButtonImageStates)">{{ t('chooseResource') }}</el-button>
        <el-button :data-ui-id="`ui-designer-button-state-${state}-clear`" size="small" text :disabled="!value[state as keyof UiButtonImageStates]" @click="update(state as keyof UiButtonImageStates, '')">{{ t('clearResource') }}</el-button>
      </span>
    </label>
  </div>
</template>

<style scoped>
.states-editor { display: flex; flex-direction: column; gap: 5px; }.field-label { color: var(--app-ink-soft); font-size: 11px; }.states-editor label { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 5px; color: var(--app-ink-soft); font-size: 10px; }.state-resource-control { display: flex; align-items: center; min-width: 0; gap: 4px; }.state-resource-control .el-input { min-width: 0; flex: 1; }
</style>
