<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import type { UiCodeEditorAdapter, UiPropertyMode, UiValidationIssue } from '@contract/ui-designer'
import { normalizeUiDesignerProjectRelativeResourcePath, type UiDesignerManagedAssetKind } from '@contract/ui-designer-resources'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import { useUiDesignerI18n } from '../i18n'
import type { UiDesignerDraftCoordinator } from '../composables/draftCoordinator'
import type { UiDesignerMessageKey } from '../i18n'

const props = withDefaults(defineProps<{
  label: string
  fieldKey?: string
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
  value: [value: unknown]
  mode: [mode: UiPropertyMode]
  code: [code: string, sceneId?: string, nodeId?: string]
}>()
const { t } = useUiDesignerI18n()
const issueLabels: Partial<Record<UiValidationIssue['code'], UiDesignerMessageKey>> = { 'invalid-value': 'invalidValue', 'invalid-code': 'invalidCode', 'invalid-reference': 'invalidReference', 'missing-resource': 'missingResource' }
const issueLabel = (issue: UiValidationIssue) => t(issueLabels[issue.code] ?? 'validationIssue')
const draftValue = ref<unknown>(props.value)
const resourceDropError = ref('')
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
const unregisterDraft = props.draftCoordinator?.register(flushCode, {
  cancel: cancelCode,
  sceneId: () => pendingSceneId ?? props.sceneId,
  pending: () => pendingCode !== undefined,
})
watch(() => props.value, (value) => { draftValue.value = value })
const updateDraft = (value: unknown) => { draftValue.value = value }
const commitValue = () => emit('value', draftValue.value)
const dropResource = (event: DragEvent) => {
  if (props.kind !== 'resource') return
  const rawPath = event.dataTransfer?.getData('text/ui-resource-path') ?? ''
  const category = event.dataTransfer?.getData('text/ui-resource-category') ?? ''
  let path = ''
  try { path = normalizeUiDesignerProjectRelativeResourcePath(rawPath) } catch { resourceDropError.value = t('resourceDropInvalid'); return }
  if (!path) { resourceDropError.value = t('resourceDropInvalid'); return }
  if (props.resourceCategory && category && category !== props.resourceCategory) { resourceDropError.value = t('resourceDropCategory'); return }
  resourceDropError.value = ''
  emit('value', path)
}
const chooseResource = async () => {
  if (!props.resourcePicker) return
  const path = await props.resourcePicker()
  if (path !== null) emit('value', path)
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
onBeforeUnmount(() => { flushCode(); unregisterDraft?.() })
</script>

<template>
  <div class="property-field" :class="{ 'has-error': props.issues?.length }" :aria-invalid="Boolean(props.issues?.length)">
    <div class="property-head">
      <span class="property-label"><label>{{ props.label }}</label><el-tooltip v-if="props.help" :content="props.help" placement="top"><el-icon class="property-help"><QuestionFilled /></el-icon></el-tooltip></span>
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
    />
    <el-switch
      v-else-if="props.mode === 'value' && props.kind === 'boolean'"
      :model-value="Boolean(props.value)"
      size="small"
      @update:model-value="emit('value', $event)"
    />
    <el-color-picker
      v-else-if="props.mode === 'value' && props.kind === 'color'"
      :model-value="typeof props.value === 'string' ? props.value : '#ffffff'"
      show-alpha
      size="small"
      @update:model-value="emit('value', $event ?? '#ffffff')"
    />
    <el-select
      v-else-if="props.mode === 'value' && props.kind === 'enum'"
      :model-value="typeof props.value === 'string' ? props.value : undefined"
      size="small"
      @update:model-value="emit('value', $event)"
    >
      <el-option v-for="option in props.options ?? []" :key="option.value" :label="option.label" :value="option.value" />
    </el-select>
    <div
      v-else-if="props.mode === 'value' && props.kind === 'resource'"
      class="resource-control"
      @dragover.prevent
      @drop.prevent="dropResource"
    >
        <el-input :model-value="typeof props.value === 'string' ? props.value : ''" readonly size="small" :placeholder="props.resourcePickerDisabled ? t('noProject') : t('chooseResource')">
        <template #append><el-button :data-ui-id="props.fieldKey ? `ui-designer-resource-${props.fieldKey}-select` : undefined" size="small" :disabled="!props.resourcePicker || props.resourcePickerDisabled" @click="void chooseResource()">{{ t('chooseResource') }}</el-button></template>
      </el-input>
      <el-button v-if="props.value" :data-ui-id="props.fieldKey ? `ui-designer-resource-${props.fieldKey}-clear` : undefined" size="small" text @click="emit('value', '')">{{ t('clearResource') }}</el-button>
      <span v-if="props.resourcePickerDisabled" class="resource-picker-hint">{{ t('noProject') }}</span>
    </div>
    <el-input
      v-else-if="props.mode === 'value'"
      :type="props.multiline ? 'textarea' : 'text'"
      :autosize="props.multiline ? { minRows: 2, maxRows: 6 } : undefined"
      :model-value="typeof draftValue === 'string' ? draftValue : String(draftValue ?? '')"
      size="small"
      @update:model-value="updateDraft($event)"
      @blur="commitValue"
      @keydown.enter.prevent="commitValue"
    />
    <div v-else class="code-field">
      <UiCodeMirrorEditor v-if="props.codeAdapter" :adapter="props.codeAdapter" :model-value="props.code" :rows="3" :format-on-blur="props.formatOnBlur" :scene-id="props.sceneId" :completion-items="props.completionItems" :draft-coordinator="props.draftCoordinator" @update:model-value="updateCodeDraft" />
      <span v-else class="code-note">{{ t('unavailable') }}</span>
    </div>
    <p v-if="props.kind === 'resource' && resourceDropError" class="resource-drop-error">{{ resourceDropError }}</p>
    <p v-for="issue in props.issues ?? []" :key="`${issue.code}-${issue.path ?? ''}`" class="field-error"><span>{{ issueLabel(issue) }}</span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ issue.message }}</span></details></p>
  </div>
</template>

<style scoped>
.property-field { display: flex; flex-direction: column; gap: 4px; }
.property-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: var(--app-ink-soft); font-size: 11px; }.property-label { display: inline-flex; align-items: center; gap: 3px; min-width: 0; }.property-help { color: var(--app-ink-soft); font-size: 11px; }
.property-head label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.property-head .el-button { padding: 3px 6px; font-size: 10px; }
.property-field > .el-input-number, .property-field > .el-input, .property-field > .el-switch, .property-field > .el-color-picker { width: 100%; }
.number-control { display: grid; grid-template-columns: minmax(0, 1fr) 88px; align-items: center; gap: 8px; }.number-control :deep(.el-input-number) { width: 88px; }
.code-field { position: relative; }
.code-note { position: absolute; right: 6px; bottom: 4px; color: var(--app-ink-soft); font-size: 9px; pointer-events: none; }
.resource-drop-error, .resource-picker-hint { margin: 0; color: var(--app-ink-soft); font-size: 10px; line-height: 1.3; }
.resource-control { display: flex; align-items: center; gap: 4px; }.resource-control .el-input { min-width: 0; flex: 1; }
.property-field.has-error :deep(.el-input), .property-field.has-error :deep(.el-input-number), .property-field.has-error :deep(.el-select), .property-field.has-error :deep(.el-color-picker) { outline: 1px solid var(--el-color-danger); border-radius: 4px; }.field-error { margin: 0; color: var(--el-color-danger); font-size: 10px; line-height: 1.3; }.field-error .status-detail { color: var(--app-ink-soft); font-size: 9px; }
</style>
