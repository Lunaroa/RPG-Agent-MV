<script setup lang="ts">
import { computed, isRef, ref, type Ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { UI_DESIGNER_RUNTIME_VERSION, type UiRuntimeStatus, type UiValidationIssue } from '@contract/ui-designer'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = defineProps<{
  modelValue: boolean
  designer: UiDesignerController
  exportPath: string
  exportCompleted: boolean
  applyProjectChanges?: (fallbackFiles: string[]) => Promise<boolean>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'update:exportPath': [value: string]; completed: [value: boolean] }>()
const { t } = useUiDesignerI18n()
const busy = ref(false)
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const runtimeNeedsInstall = computed(() => ['missing', 'file-unconfigured', 'configured-disabled', 'version-too-old', 'content-mismatch'].includes(unwrap(props.designer.runtimeStatus).state))
const runtimeLabels: Record<UiRuntimeStatus['state'], UiDesignerMessageKey> = { unknown: 'runtimeUnknown', missing: 'runtimeMissing', 'file-unconfigured': 'runtimeFileUnconfigured', 'configured-disabled': 'runtimeConfiguredDisabled', 'enabled-compatible': 'runtimeEnabledCompatible', 'version-too-old': 'runtimeVersionTooOld', 'content-mismatch': 'runtimeContentMismatch', 'staged-pending': 'runtimeStagedPending', error: 'runtimeError' }
const runtimeLabel = (state: UiRuntimeStatus['state']) => t(runtimeLabels[state])
const validationLabels: Partial<Record<UiValidationIssue['code'], UiDesignerMessageKey>> = { 'invalid-value': 'invalidValue', 'invalid-code': 'invalidCode', 'invalid-reference': 'invalidReference', 'missing-resource': 'missingResource' }
const validationIssueLabel = (issue: UiValidationIssue) => t(validationLabels[issue.code] ?? 'validationIssue')
const validationLocation = (issue: UiValidationIssue) => issue.nodeName ? `${t('validationNode')}: ${issue.nodeName}${issue.path ? ` · ${issue.path}` : ''}` : issue.path ? `${t('validationPath')}: ${issue.path}` : t('document')
const confirmRuntimeReplacement = async () => {
  if (!unwrap(props.designer.runtimeStatus).needsConfirmation) return true
  try {
    await ElMessageBox.confirm(t('runtimeModifiedBody'), t('runtimeModifiedTitle'), {
      type: 'warning',
      confirmButtonText: t('replaceRuntime'),
      cancelButtonText: t('lifecycleCancel'),
      closeOnClickModal: false,
    })
    return true
  } catch {
    return false
  }
}
const prepareRuntime = async () => {
  if (!(await confirmRuntimeReplacement())) return false
  return props.designer.installRuntime({ enable: true, forceModifiedRuntime: unwrap(props.designer.runtimeStatus).needsConfirmation === true })
}
const reviewStagedChanges = async () => {
  if (!props.applyProjectChanges) return false
  const applied = await props.applyProjectChanges(props.designer.runtimeStaging?.affectedFiles ?? [])
  if (applied) {
    await props.designer.checkRuntime()
    emit('update:modelValue', false)
  }
  return applied
}
const installRuntime = async () => {
  if (busy.value) return
  busy.value = true
  try {
    const staged = await prepareRuntime()
    emit('completed', staged)
    if (staged) await reviewStagedChanges()
  } finally {
    busy.value = false
  }
}
const stageExport = async () => {
  if (busy.value) return
  busy.value = true
  try {
    if (runtimeNeedsInstall.value && !(await prepareRuntime())) return
    const staged = await props.designer.stageRuntime({ targetPath: props.exportPath.trim() || undefined, overwrite: false })
    emit('completed', staged)
    if (staged) await reviewStagedChanges()
  } finally {
    busy.value = false
  }
}
const close = (visible: boolean) => emit('update:modelValue', visible)
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('exportDialogTitle')" width="min(620px, 92vw)" destroy-on-close @update:model-value="close">
    <div class="dialog-stack">
      <p class="dialog-copy">{{ t('exportDialogBody') }}</p>
      <p class="dialog-copy source-file-hint">{{ t('designFileHint') }}</p>
      <el-alert v-if="props.exportCompleted" data-testid="ui-designer-stage-result" type="success" :closable="false" :title="t('stagedSummary')" />
      <dl class="export-summary"><dt>{{ t('sceneName') }}</dt><dd>{{ designer.document.meta.sceneName }}</dd><dt>{{ t('author') }}</dt><dd>{{ designer.document.meta.author || '—' }}</dd><dt>{{ t('description') }}</dt><dd>{{ designer.document.meta.description || '—' }}</dd><dt>{{ t('runtimeVersion') }}</dt><dd>{{ designer.runtimeStatus.version || designer.runtimeStatus.requiredVersion || UI_DESIGNER_RUNTIME_VERSION }}</dd></dl>
      <section v-if="designer.validation.issues.length" class="export-validation" aria-live="polite">
        <div class="validation-heading">{{ t('validationIssue') }}</div>
        <ul class="validation-list">
          <li v-for="(issue, index) in designer.validation.issues" :key="`${issue.code}-${issue.path ?? index}`" :class="`validation-${issue.severity}`"><span class="validation-severity">{{ issue.severity === 'error' ? t('validationError') : t('validationWarning') }}</span><button v-if="issue.nodeId" type="button" class="validation-target" @click="designer.selectNodes([issue.nodeId])">{{ validationIssueLabel(issue) }}</button><span v-else>{{ validationIssueLabel(issue) }}</span><span class="validation-location">{{ validationLocation(issue) }}</span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ issue.message }}</span></details></li>
        </ul>
      </section>
      <p class="dialog-copy">{{ t('runtime') }}: {{ runtimeLabel(designer.runtimeStatus.state) }}<details v-if="designer.runtimeStatus.message" class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ designer.runtimeStatus.message }}</span></details></p>
      <p v-if="designer.runtimeStaging?.affectedFiles.length" class="dialog-copy staged-files">{{ designer.runtimeStaging.affectedFiles.join(', ') }}</p>
      <el-collapse class="advanced-export">
        <el-collapse-item name="advanced" :title="t('advancedExport')">
          <el-form label-position="top"><el-form-item :label="t('stageTargetPath')"><el-input :model-value="props.exportPath" :placeholder="t('targetPathPlaceholder')" @update:model-value="emit('update:exportPath', $event)" /></el-form-item></el-form>
          <p class="dialog-copy export-json-help">{{ t('exportJsonHelp') }}</p>
          <el-button data-testid="ui-designer-export-json" :disabled="busy || !designer.canSave" @click="void designer.exportRuntimeJson()">{{ t('exportJson') }}</el-button>
        </el-collapse-item>
      </el-collapse>
    </div>
    <template #footer><el-button data-testid="ui-designer-export-cancel" :disabled="busy" @click="emit('update:modelValue', false)">{{ t('lifecycleCancel') }}</el-button><el-button v-if="designer.runtimeStaging?.affectedFiles.length && props.applyProjectChanges" data-testid="ui-designer-review-staged" :disabled="busy" @click="void reviewStagedChanges()">{{ t('reviewProjectChanges') }}</el-button><el-button v-if="runtimeNeedsInstall" data-testid="ui-designer-runtime-install" :disabled="busy || !designer.canManageRuntime" @click="void installRuntime()">{{ t('installRuntime') }}</el-button><el-button data-testid="ui-designer-export-stage" type="primary" :loading="busy" :disabled="!designer.canExport" @click="void stageExport()">{{ t('preparePublish') }}</el-button></template>
  </el-dialog>
</template>

<style scoped>
.dialog-stack, .dialog-copy { color: var(--app-ink); font-size: 13px; line-height: 1.6; }.source-file-hint { color: var(--app-ink-soft); }.staged-files { overflow-wrap: anywhere; }.advanced-export { margin-top: 8px; }.export-summary { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 4px 10px; margin: 8px 0; font-size: 12px; }.export-summary dt { color: var(--app-ink-soft); }.export-summary dd { margin: 0; overflow-wrap: anywhere; }.export-validation { border: 1px solid var(--app-border); border-radius: 6px; padding: 8px; }.validation-heading { margin-bottom: 5px; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; }.validation-list { display: flex; flex-direction: column; gap: 5px; margin: 0; padding: 0; list-style: none; font-size: 11px; }.validation-list li { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 5px; align-items: baseline; }.validation-severity { font-weight: 650; }.validation-error .validation-severity { color: var(--el-color-danger); }.validation-warning .validation-severity { color: var(--el-color-warning); }.validation-target { padding: 0; border: 0; background: transparent; color: var(--app-accent); cursor: pointer; font: inherit; text-align: left; }.validation-location { overflow: hidden; color: var(--app-ink-soft); text-overflow: ellipsis; white-space: nowrap; }.validation-list .status-detail { grid-column: 2 / -1; }
</style>
