<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import type { UiCodeEditorAdapter, UiPropertyMode, UiValidationIssue } from '@contract/ui-designer'
import { normalizeUiDesignerProjectRelativeResourcePath, type UiDesignerManagedAssetKind } from '@contract/ui-designer-resources'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import UiResourceReferenceControl from './UiResourceReferenceControl.vue'
import { useUiDesignerI18n } from '../i18n'
import type { UiDesignerDraftCoordinator } from '../composables/draftCoordinator'
import type { UiDesignerMessageKey } from '../i18n'

const props = withDefaults(defineProps<{
  label: string
  fieldKey?: string
  unit?: string
  help?: string
  value: unknown
  mode?: UiPropertyMode
  code?: string
  kind?: 'number' | 'text' | 'boolean' | 'color' | 'enum' | 'resource'
  multiline?: boolean
  options?: Array<{ label: string; value: string }>
  resourceCategory?: UiDesignerManagedAssetKind
  resourcePicker?: () => Promise<string | null>
  resourcePickerDisabled?: boolean
  formatOnBlur?: boolean
  codeFontFamily?: string
  codeFontSize?: number
  min?: number
  max?: number
  step?: number
  codeAdapter?: UiCodeEditorAdapter
  completionItems?: string[]
  draftCoordinator?: UiDesignerDraftCoordinator
  sceneId?: string
  nodeId?: string
  issues?: UiValidationIssue[]
}>(), { mode: 'value', kind: 'text', code: '', min: undefined, max: undefined, step: 1 })
const emit = defineEmits<{
  value: [value: unknown, sceneId?: string, nodeId?: string]
  preview: [value: unknown, sceneId?: string, nodeId?: string]
  commit: [sceneId?: string, nodeId?: string]
  cancel: [sceneId?: string, nodeId?: string]
  mode: [mode: UiPropertyMode]
  code: [code: string, sceneId?: string, nodeId?: string]
}>()
const { t } = useUiDesignerI18n()
const resourceActionLabel = computed(() => props.resourceCategory === 'image'
  ? t('chooseImageResource')
  : props.resourceCategory === 'video'
    ? t('chooseVideoResource')
    : props.resourceCategory === 'audio'
      ? t('chooseAudioResource')
      : props.resourceCategory === 'font'
        ? t('chooseFontResource')
        : t('chooseResource'))
const issueLabels: Partial<Record<UiValidationIssue['code'], UiDesignerMessageKey>> = { 'invalid-value': 'invalidValue', 'invalid-code': 'invalidCode', 'invalid-reference': 'invalidReference', 'missing-resource': 'missingResource' }
const issueLabel = (issue: UiValidationIssue) => t(issueLabels[issue.code] ?? 'validationIssue')
const draftValue = ref<unknown>(props.value)
const resourceDropError = ref('')
let valueDraftPending = false
let valueDraftBaseline: unknown = props.value
let codeTimer: ReturnType<typeof setTimeout> | undefined
let pendingCode: string | undefined
let pendingSceneId: string | undefined
let pendingNodeId: string | undefined
const flushCode = () => {
  if (codeTimer) { clearTimeout(codeTimer); codeTimer = undefined }
  if (pendingCode !== undefined) {
    const value = pendingCode
    const sceneId = pendingSceneId ?? props.sceneId
    const nodeId = pendingNodeId ?? props.nodeId
    pendingCode = undefined
    pendingSceneId = undefined
    pendingNodeId = undefined
    emit('code', value, sceneId, nodeId)
  }
}
const cancelCode = () => {
  if (codeTimer) { clearTimeout(codeTimer); codeTimer = undefined }
  pendingCode = undefined
  pendingSceneId = undefined
  pendingNodeId = undefined
}
const updateDraft = (value: unknown) => {
  if (!valueDraftPending) valueDraftBaseline = props.value
  draftValue.value = value
  valueDraftPending = true
  emit('preview', value, props.sceneId, props.nodeId)
}
const emitValue = (value: unknown) => emit('value', value, props.sceneId, props.nodeId)
const commitValue = () => {
  if (!valueDraftPending) return
  const value = draftValue.value
  valueDraftPending = false
  if (!Object.is(value, valueDraftBaseline)) emit('commit', props.sceneId, props.nodeId)
  else emit('cancel', props.sceneId, props.nodeId)
  valueDraftBaseline = value
}
const cancelValue = () => {
  if (valueDraftPending) emit('cancel', props.sceneId, props.nodeId)
  valueDraftPending = false
  draftValue.value = valueDraftBaseline
}
const handleTextEnter = (event: KeyboardEvent) => {
  if (props.multiline && !event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  commitValue()
}
const flushDraft = () => { commitValue(); flushCode() }
const cancelDraft = () => { cancelValue(); cancelCode() }
const unregisterDraft = props.draftCoordinator?.register(flushDraft, {
  cancel: cancelDraft,
  sceneId: () => pendingSceneId ?? props.sceneId,
  pending: () => valueDraftPending || pendingCode !== undefined,
})
watch(() => props.value, (value) => {
  if (valueDraftPending && Object.is(value, draftValue.value)) return
  valueDraftPending = false
  valueDraftBaseline = value
  draftValue.value = value
})
const dropResource = (event: DragEvent) => {
  if (props.kind !== 'resource') return
  const rawPath = event.dataTransfer?.getData('text/ui-resource-path') ?? ''
  const category = event.dataTransfer?.getData('text/ui-resource-category') ?? ''
  let path = ''
  try { path = normalizeUiDesignerProjectRelativeResourcePath(rawPath) } catch { resourceDropError.value = t('resourceDropInvalid'); return }
  if (!path) { resourceDropError.value = t('resourceDropInvalid'); return }
  if (props.resourceCategory && category && category !== props.resourceCategory) { resourceDropError.value = t('resourceDropCategory'); return }
  resourceDropError.value = ''
  emitValue(path)
}
const chooseResource = async () => {
  if (!props.resourcePicker) return
  const path = await props.resourcePicker()
  if (path !== null) emitValue(path)
}
const updateCodeDraft = (value: string, sceneId?: string) => {
  pendingCode = value
  pendingSceneId = sceneId ?? props.sceneId
  pendingNodeId = props.nodeId
  if (codeTimer) clearTimeout(codeTimer)
  const capturedSceneId = pendingSceneId
  const capturedNodeId = pendingNodeId
  codeTimer = setTimeout(() => {
    emit('code', value, capturedSceneId, capturedNodeId)
    pendingCode = undefined
    pendingSceneId = undefined
    pendingNodeId = undefined
    codeTimer = undefined
  }, 1000)
}
onBeforeUnmount(() => { flushDraft(); unregisterDraft?.() })
</script>

<template>
  <div class="property-field" :class="{ 'has-error': props.issues?.length }" :aria-invalid="Boolean(props.issues?.length)">
    <div class="property-head">
      <span class="property-label"><label>{{ props.label }}</label><el-tooltip v-if="props.help" :content="props.help" placement="top">
        <el-icon class="property-help"><QuestionFilled /></el-icon></el-tooltip>
      </span>
      <el-button-group size="small">
        <el-button size="small" :type="props.mode === 'value' ? 'primary' : 'default'" @click="emit('mode', 'value')">{{ t('value') }}</el-button>
        <el-button size="small" :type="props.mode === 'code' ? 'primary' : 'default'" @click="emit('mode', 'code')">{{ t('expression') }}</el-button>
      </el-button-group>
    </div>
    <div v-if="props.mode === 'value' && props.kind === 'number' && props.min !== undefined && props.max !== undefined" class="number-control">
      <el-slider :model-value="typeof draftValue === 'number' ? draftValue : props.min" :min="props.min" :max="props.max" :step="props.step" size="small" @update:model-value="updateDraft($event)" @change="commitValue" />
      <el-input-number :model-value="typeof draftValue === 'number' ? draftValue : props.min" :min="props.min" :max="props.max" :step="props.step" size="small" controls-position="right" @update:model-value="updateDraft($event ?? props.min)" @change="commitValue" />
    </div>
    <el-input-number
      v-else-if="props.mode === 'value' && props.kind === 'number'"
      :model-value="typeof draftValue === 'number' ? draftValue : 0"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      size="small"
      controls-position="right"
      @update:model-value="updateDraft($event ?? 0)"
      @change="commitValue"
    >
      <template #suffix>
        <span>{{ props.unit }}</span>
      </template>
    </el-input-number>
    <el-switch
      v-else-if="props.mode === 'value' && props.kind === 'boolean'"
      :model-value="Boolean(props.value)"
      size="small"
      @update:model-value="emitValue($event)"
    />
    <el-color-picker
      v-else-if="props.mode === 'value' && props.kind === 'color'"
      :model-value="typeof draftValue === 'string' ? draftValue : '#ffffff'"
      show-alpha
      size="small"
      @active-change="updateDraft($event ?? '#ffffff')"
      @update:model-value="updateDraft($event ?? '#ffffff')"
      @change="commitValue"
    />
    <el-select
      v-else-if="props.mode === 'value' && props.kind === 'enum'"
      :model-value="typeof props.value === 'string' ? props.value : undefined"
      size="small"
      @update:model-value="emitValue($event)"
    >
      <el-option v-for="option in props.options ?? []" :key="option.value" :label="option.label" :value="option.value" />
    </el-select>
    <div
      v-else-if="props.mode === 'value' && props.kind === 'resource'"
      class="resource-control"
      @dragover.prevent
      @drop.prevent="dropResource"
    >
      <UiResourceReferenceControl
        :model-value="typeof props.value === 'string' ? props.value : ''"
        :placeholder="props.resourcePickerDisabled ? t('noProject') : resourceActionLabel"
        :select-label="resourceActionLabel"
        :clear-label="t('clearResource')"
        :select-disabled="!props.resourcePicker || props.resourcePickerDisabled"
        :value-ui-id="props.fieldKey ? `ui-designer-resource-${props.fieldKey}-value` : undefined"
        :select-ui-id="props.fieldKey ? `ui-designer-resource-${props.fieldKey}-select` : undefined"
        :clear-ui-id="props.fieldKey ? `ui-designer-resource-${props.fieldKey}-clear` : undefined"
        @select="void chooseResource()"
        @clear="emitValue('')"
      />
      <span v-if="props.resourcePickerDisabled" class="resource-picker-hint">{{ t('noProject') }}</span>
    </div>
    <el-input
      v-else-if="props.mode === 'value'"
      :type="props.multiline ? 'textarea' : 'text'"
      :autosize="props.multiline ? { minRows: 2, maxRows: 6 } : undefined"
      :model-value="typeof draftValue === 'string' ? draftValue : String(draftValue ?? '')"
      size="small"
      :data-ui-id="props.fieldKey ? `ui-designer-property-${props.fieldKey}-input` : undefined"
      :data-testid="props.fieldKey ? `ui-designer-property-${props.fieldKey}-input` : undefined"
      @update:model-value="updateDraft($event)"
      @blur="commitValue"
      @keydown.enter="handleTextEnter"
    />
    <div v-else class="code-field">
      <UiCodeMirrorEditor v-if="props.codeAdapter" :adapter="props.codeAdapter" :model-value="props.code" :rows="1" :format-on-blur="props.formatOnBlur" :font-family="props.codeFontFamily" :font-size="props.codeFontSize" :scene-id="props.sceneId" :completion-items="props.completionItems" :draft-coordinator="props.draftCoordinator" @update:model-value="updateCodeDraft" />
      <span v-else class="code-note">{{ t('unavailable') }}</span>
    </div>
    <p v-if="props.kind === 'resource' && resourceDropError" class="resource-drop-error">{{ resourceDropError }}</p>
    <div v-for="issue in props.issues ?? []" :key="`${issue.code}-${issue.path ?? ''}`" class="field-error"><span>{{ issueLabel(issue) }}</span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ issue.message }}</span></details></div>
  </div>
</template>

<style scoped>
.property-field { display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; align-items: start; gap: 4px 6px; }
.property-head { display: contents; color: var(--app-ink-soft); font-size: 11px; }.property-label { display: inline-flex; grid-column: 1; align-items: center; min-width: 0; min-height: 24px; gap: 3px; }
.property-help { flex: 0 0 auto; color: var(--app-ink-muted); font-size: 12px; }
.property-head label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.property-head .el-button-group { grid-column: 3; align-self: start; white-space: nowrap; }.property-head .el-button { padding: 3px 6px; font-size: 10px; }
.property-field > .el-input-number,
.property-field > .el-input,
.property-field > .el-textarea,
.property-field > .el-select,
.property-field > .el-switch,
.property-field > .el-color-picker,
.property-field > .number-control,
.property-field > .resource-control,
.property-field > .code-field {
  grid-column: 2; grid-row: 1; width: 100%; min-width: 0;
}
.number-control { display: grid; grid-template-columns: minmax(0, 1fr) 88px; align-items: center; gap: 8px; }
.number-control :deep(.el-slider) { box-sizing: border-box; min-width: 0; padding-inline: 10px; }
.number-control :deep(.el-input-number) { width: 88px; }
.code-field { position: relative; }
.code-note { position: absolute; right: 6px; bottom: 4px; color: var(--app-ink-soft); font-size: 9px; pointer-events: none; }
.resource-drop-error, .resource-picker-hint { margin: 0; color: var(--app-ink-soft); font-size: 10px; line-height: 1.3; }.property-field > .resource-drop-error, .property-field > .field-error { grid-column: 2 / -1; }
.resource-control { display: flex; flex-direction: column; gap: 4px; }.resource-control > :first-child { width: 100%; min-width: 0; }
.property-field.has-error :deep(.el-input), .property-field.has-error :deep(.el-input-number), .property-field.has-error :deep(.el-select), .property-field.has-error :deep(.el-color-picker) { outline: 1px solid var(--el-color-danger); border-radius: 4px; }.field-error { margin: 0; color: var(--el-color-danger); font-size: 10px; line-height: 1.3; }.field-error .status-detail { color: var(--app-ink-soft); font-size: 9px; }
@media (max-width: 360px) { .property-field { grid-template-columns: 70px minmax(0, 1fr) auto; gap-inline: 4px; } }
</style>
