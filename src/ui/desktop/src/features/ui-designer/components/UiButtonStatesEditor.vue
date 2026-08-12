<script setup lang="ts">
import { computed } from 'vue'
import type { UiButtonImageStates, UiResourceEntry } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  value: UiButtonImageStates
  resources?: UiResourceEntry[]
  pickResource?: (currentPath?: string) => Promise<string | null>
  resourcePickerDisabled?: boolean
}>()
const emit = defineEmits<{ update: [value: UiButtonImageStates] }>()
const { t } = useUiDesignerI18n()
const imageResourcesByPath = computed(() => new Map((props.resources ?? [])
  .filter((entry) => entry.category === 'image')
  .flatMap((entry) => {
    const resourcePath = (entry.relativePath ?? entry.path).replace(/\\/g, '/')
    return [[resourcePath, entry], [resourcePath.replace(/^www\//, ''), entry]] as const
  })))
const resourceForPath = (resourcePath: string) => {
  const normalized = resourcePath.replace(/\\/g, '/')
  return imageResourcesByPath.value.get(normalized) ?? imageResourcesByPath.value.get(normalized.replace(/^www\//, ''))
}
const update = (key: keyof UiButtonImageStates, value: string) => emit('update', { ...props.value, [key]: value })
const choose = async (key: keyof UiButtonImageStates) => {
  const path = await props.pickResource?.(props.value[key])
  if (path !== null && path !== undefined) update(key, path)
}
</script>

<template>
  <div class="states-editor" data-ui-id="ui-designer-button-states" data-testid="ui-designer-button-states">
    <span class="field-label">{{ t('imageStates') }}</span>
    <label v-for="state in ['normal', 'hover', 'pressed', 'disabled']" :key="state">
      <span>{{ t(state === 'normal' ? 'normalState' : state === 'hover' ? 'hoverState' : state === 'pressed' ? 'pressedState' : 'disabledState') }}</span>
      <span class="state-thumbnail" :class="{ empty: !value[state as keyof UiButtonImageStates] }" :data-ui-id="`ui-designer-button-state-${state}-preview`" :data-testid="`ui-designer-button-state-${state}-preview`">
        <img
          v-if="value[state as keyof UiButtonImageStates] && (resourceForPath(value[state as keyof UiButtonImageStates])?.thumbnailUrl || resourceForPath(value[state as keyof UiButtonImageStates])?.previewUrl)"
          :src="resourceForPath(value[state as keyof UiButtonImageStates])?.thumbnailUrl ?? resourceForPath(value[state as keyof UiButtonImageStates])?.previewUrl"
          :alt="String(value[state as keyof UiButtonImageStates])"
        />
        <span v-else>{{ value[state as keyof UiButtonImageStates] ? t('missing') : t('noResources') }}</span>
      </span>
      <span class="state-resource-control">
        <el-input :model-value="value[state as keyof UiButtonImageStates]" readonly size="small" :placeholder="resourcePickerDisabled ? t('noProject') : t('chooseResource')" />
        <el-button :data-ui-id="`ui-designer-button-state-${state}-select`" :data-testid="`ui-designer-button-state-${state}-select`" size="small" :disabled="!pickResource || resourcePickerDisabled" @click="void choose(state as keyof UiButtonImageStates)">{{ t('chooseResource') }}</el-button>
        <el-button :data-ui-id="`ui-designer-button-state-${state}-clear`" :data-testid="`ui-designer-button-state-${state}-clear`" size="small" text :disabled="!value[state as keyof UiButtonImageStates]" @click="update(state as keyof UiButtonImageStates, '')">{{ t('clearResource') }}</el-button>
      </span>
    </label>
  </div>
</template>

<style scoped>
.states-editor { display: flex; flex-direction: column; gap: 5px; }.field-label { color: var(--app-ink-soft); font-size: 11px; }.states-editor label { display: grid; grid-template-columns: 58px 42px minmax(0, 1fr); align-items: center; gap: 5px; color: var(--app-ink-soft); font-size: 10px; }.state-thumbnail { display: grid; place-items: center; width: 38px; height: 32px; overflow: hidden; border: 1px solid var(--app-border); border-radius: 3px; background: var(--app-bg-sunken); color: var(--app-ink-soft); }.state-thumbnail.empty { border-style: dashed; }.state-thumbnail img { width: 100%; height: 100%; object-fit: contain; }.state-resource-control { display: flex; align-items: center; min-width: 0; gap: 4px; }.state-resource-control .el-input { min-width: 0; flex: 1; }
</style>
