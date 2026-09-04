<script setup lang="ts">
import { computed } from 'vue'
import type { UiButtonImageStates, UiCodeEditorAdapter, UiPropertyMode, UiResourceEntry } from '@contract/ui-designer'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import UiResourceReferenceControl from './UiResourceReferenceControl.vue'
import type { UiDesignerDraftCoordinator } from '../composables/draftCoordinator'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  value: UiButtonImageStates
  resources?: UiResourceEntry[]
  pickResource?: (currentPath?: string) => Promise<string | null>
  resourcePickerDisabled?: boolean
  /** Per-state value/code mode, keyed by state name (normal/hover/pressed/disabled). */
  modes?: Partial<Record<keyof UiButtonImageStates, UiPropertyMode>>
  /** Per-state expression source, keyed by state name. */
  codes?: Partial<Record<keyof UiButtonImageStates, string>>
  codeAdapter?: UiCodeEditorAdapter
  draftCoordinator?: UiDesignerDraftCoordinator
  sceneId?: string
  nodeId?: string
  formatOnBlur?: boolean
  codeFontFamily?: string
  codeFontSize?: number
  completionItems?: string[]
}>()
const emit = defineEmits<{
  update: [value: UiButtonImageStates]
  mode: [state: keyof UiButtonImageStates, mode: UiPropertyMode]
  code: [state: keyof UiButtonImageStates, code: string, sceneId?: string]
}>()
const { t } = useUiDesignerI18n()
const STATES: Array<keyof UiButtonImageStates> = ['normal', 'hover', 'pressed', 'disabled']
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
const stateLabel = (state: keyof UiButtonImageStates) => t(state === 'normal' ? 'normalState' : state === 'hover' ? 'hoverState' : state === 'pressed' ? 'pressedState' : 'disabledState')
const modeFor = (state: keyof UiButtonImageStates): UiPropertyMode => props.modes?.[state] ?? 'value'
const codeFor = (state: keyof UiButtonImageStates): string => props.codes?.[state] ?? ''
const updateCode = (state: keyof UiButtonImageStates, code: string, sceneId?: string) => emit('code', state, code, sceneId)
</script>

<template>
  <div class="states-editor" data-ui-id="ui-designer-button-states" data-testid="ui-designer-button-states">
    <span class="field-label">{{ t('imageStatesOptional') }}</span>
    <div v-for="state in STATES" :key="state" class="state-row">
      <div class="state-head">
        <span class="state-name">{{ stateLabel(state) }}</span>
        <el-button-group size="small">
          <el-button size="small" :type="modeFor(state) === 'value' ? 'primary' : 'default'" :data-ui-id="`ui-designer-button-state-${state}-mode-value`" @click="emit('mode', state, 'value')">{{ t('value') }}</el-button>
          <el-button size="small" :type="modeFor(state) === 'code' ? 'primary' : 'default'" :data-ui-id="`ui-designer-button-state-${state}-mode-code`" @click="emit('mode', state, 'code')">{{ t('expression') }}</el-button>
        </el-button-group>
      </div>
      <div v-if="modeFor(state) === 'code'" class="state-code">
        <UiCodeMirrorEditor
          v-if="codeAdapter"
          :adapter="codeAdapter"
          :model-value="codeFor(state)"
          :rows="3"
          resizable
          :format-on-blur="formatOnBlur"
          :font-family="codeFontFamily"
          :font-size="codeFontSize"
          :scene-id="sceneId"
          :completion-items="completionItems"
          :draft-coordinator="draftCoordinator"
          @update:model-value="updateCode(state, $event, sceneId)"
        />
        <span v-else class="code-note">{{ t('unavailable') }}</span>
      </div>
      <label v-else class="state-value">
        <span class="state-thumbnail" :class="{ empty: !value[state] }" :data-ui-id="`ui-designer-button-state-${state}-preview`" :data-testid="`ui-designer-button-state-${state}-preview`">
          <img
            v-if="value[state] && (resourceForPath(value[state])?.thumbnailUrl || resourceForPath(value[state])?.previewUrl)"
            :src="resourceForPath(value[state])?.thumbnailUrl ?? resourceForPath(value[state])?.previewUrl"
            :alt="String(value[state])"
          />
          <span v-else>{{ value[state] ? t('missing') : t('defaultStyle') }}</span>
        </span>
        <span class="state-resource-control">
          <UiResourceReferenceControl
            :model-value="value[state]"
            :placeholder="resourcePickerDisabled ? t('noProject') : t('chooseImageResource')"
            :select-label="t('chooseImageResource')"
            :clear-label="t('clearResource')"
            :select-disabled="!pickResource || resourcePickerDisabled"
            :select-ui-id="`ui-designer-button-state-${state}-select`"
            :clear-ui-id="`ui-designer-button-state-${state}-clear`"
            @select="void choose(state)"
            @clear="update(state, '')"
          />
        </span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.states-editor { display: flex; flex-direction: column; gap: 5px; }.field-label { color: var(--app-ink-soft); font-size: 11px; }
.state-row { display: flex; flex-direction: column; gap: 4px; }
.state-head { display: flex; align-items: center; justify-content: space-between; gap: 5px; }
.state-name { color: var(--app-ink-soft); font-size: 10px; }
.state-head .el-button-group { white-space: nowrap; }.state-head .el-button { padding: 3px 6px; font-size: 10px; }
.state-value { display: grid; grid-template-columns: 60px minmax(0, 1fr); align-items: center; gap: 5px; }
.state-thumbnail { display: grid; place-items: center; width: 60px; height: 32px; overflow: hidden; border: 1px solid var(--app-border); border-radius: 3px; background: var(--app-bg-sunken); color: var(--app-ink-soft); }.state-thumbnail.empty { border-style: dashed; }.state-thumbnail img { width: 100%; height: 100%; object-fit: contain; }
.state-resource-control { min-width: 0; }.state-resource-control > * { width: 100%; min-width: 0; }
.state-code { position: relative; }
.code-note { position: absolute; right: 6px; bottom: 4px; color: var(--app-ink-soft); font-size: 9px; pointer-events: none; }
</style>
