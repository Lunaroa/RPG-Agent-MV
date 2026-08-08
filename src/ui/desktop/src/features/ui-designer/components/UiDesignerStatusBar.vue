<script setup lang="ts">
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import type { UiPreviewState, UiRuntimeStatus } from '@contract/ui-designer'

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const runtimeLabels: Record<UiRuntimeStatus['state'], UiDesignerMessageKey> = {
  unknown: 'runtimeUnknown', missing: 'runtimeMissing', 'file-unconfigured': 'runtimeFileUnconfigured', 'configured-disabled': 'runtimeConfiguredDisabled', 'enabled-compatible': 'runtimeEnabledCompatible', 'version-too-old': 'runtimeVersionTooOld', 'content-mismatch': 'runtimeContentMismatch', 'staged-pending': 'runtimeStagedPending', error: 'runtimeError',
}
const previewLabels: Record<UiPreviewState, UiDesignerMessageKey> = { idle: 'previewIdle', unavailable: 'previewUnavailable', preparing: 'previewPreparing', running: 'previewRunning', stopped: 'previewStopped', error: 'previewError' }
const performanceLabels: Record<'smooth' | 'moderate' | 'mayStutter', UiDesignerMessageKey> = { smooth: 'performanceSmooth', moderate: 'performanceModerate', mayStutter: 'performanceMayStutter' }
const editorLabels: Record<'idle' | 'running' | 'stopped', UiDesignerMessageKey> = { idle: 'editorIdle', running: 'editorRunning', stopped: 'editorStopped' }
const runtimeLabel = (state: UiRuntimeStatus['state']) => t(runtimeLabels[state])
const previewLabel = (state: UiPreviewState) => t(previewLabels[state])
const performanceLabel = (rating: 'smooth' | 'moderate' | 'mayStutter') => t(performanceLabels[rating])
const editorLabel = (state: 'idle' | 'running' | 'stopped') => t(editorLabels[state])
const operationSummary = () => designer.previewStatus === 'error' || designer.previewStatus === 'unavailable' || designer.fileStatus === 'error' || designer.resourceStatus === 'error' || designer.actionError ? t('operationError') : previewLabel(designer.previewStatus)
const compatibilitySummary = () => {
  const compatibility = designer.runtimeStatus.projectCompatibility
  if (!compatibility) return ''
  const engine = compatibility.engine === 'unknown' ? t('projectCompatibilityUnknown') : `${compatibility.engine} ${compatibility.engineVersion ?? ''}`.trim()
  const state = compatibility.engineVersionSupported ? t('projectCompatibilitySupported') : t('projectCompatibilityWarning')
  return `${t('projectCompatibility')}: ${engine} · ${state}`
}
</script>

<template>
  <footer class="status-bar">
    <span class="status-item" :class="{ warning: designer.isDirty }">{{ designer.isDirty ? t('unsaved') : t('saved') }}</span>
    <span class="status-item">{{ designer.performance.nodeCount }} {{ t('nodes') }} · {{ performanceLabel(designer.performance.rating) }}</span>
    <span class="status-item" :class="{ error: designer.validation.errors.length > 0 }">{{ designer.validation.errors.length ? `${designer.validation.errors.length} ${t('validationErrors')}` : t('valid') }}</span>
    <span v-if="designer.previewDiagnostics.length" class="status-item warning">{{ t('runtimeDiagnostics') }}: {{ designer.previewDiagnostics.length }}</span>
    <span class="status-item">{{ t('runtime') }}: {{ runtimeLabel(designer.runtimeStatus.state) }}</span>
    <span v-if="designer.runtimeStatus.projectCompatibility" class="status-item" :class="{ warning: !designer.runtimeStatus.projectCompatibility.engineVersionSupported }">{{ compatibilitySummary() }}</span>
    <span v-if="designer.runtimeStaging?.affectedFiles.length" class="status-item">{{ t('stagedSummary') }} ({{ designer.runtimeStaging.affectedFiles.join(', ') }})</span>
    <span class="status-item">{{ t('editorPreviewStatus') }}: {{ editorLabel(designer.editorPreviewStatus) }}</span>
    <el-button size="small" text :disabled="designer.isEditorPreviewing || !designer.canManageRuntime" @click="void designer.checkRuntime()">{{ t('checkRuntime') }}</el-button>
    <span class="status-item" :class="{ error: designer.previewStatus === 'error' || designer.previewStatus === 'unavailable' || designer.fileStatus === 'error' || designer.resourceStatus === 'error' || designer.actionError || designer.recoveryCleanupPending || designer.runtimeProofMissing }">{{ designer.recoveryCleanupPending ? t('recoveryCleanupPending') : designer.runtimeProofMissing ? t('runtimeProofMissing') : operationSummary() }}<details v-if="!designer.recoveryCleanupPending && (designer.previewMessage || designer.fileMessage || designer.resourceMessage || designer.actionError)" class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ designer.previewMessage || designer.fileMessage || designer.resourceMessage || designer.actionError }}</span></details></span>
  </footer>
</template>

<style scoped>
.status-bar { display: flex; align-items: center; gap: 13px; min-height: 27px; padding: 4px 10px; overflow: hidden; border-top: 1px solid var(--app-border); background: var(--app-bg); color: var(--app-ink-soft); font-size: 10px; white-space: nowrap; }
.status-item { overflow: hidden; text-overflow: ellipsis; }
.status-detail { margin-left: 5px; opacity: .75; }
.status-item.warning { color: var(--el-color-warning); }.status-item.error { color: var(--el-color-danger); }
.status-item:last-child { margin-left: auto; }
</style>
