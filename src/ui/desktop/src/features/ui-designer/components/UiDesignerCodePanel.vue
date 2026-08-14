<script setup lang="ts">
import { computed, isRef, nextTick, onBeforeUnmount, onMounted, ref, type Ref, watch } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiRuntimeDiagnostic, UiValidationIssue, UiValidationReport } from '@contract/ui-designer'
import { UI_DESIGNER_SCENE_SCRIPT_COMPLETIONS } from '@contract/ui-designer-script'
import { useUiDesignerI18n } from '../i18n'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'
import UiScriptContextHint from './UiScriptContextHint.vue'

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const document = computed(() => unwrap(designer.document))
const draftCode = computed<Record<string, string>>(() => unwrap(designer.draftCode))
const code = computed(() => draftCode.value[unwrap(designer.activeSceneId)] ?? document.value.sceneScript.source)
const validationReport = computed<UiValidationReport>(() => unwrap(designer.validation))
const codeIssues = computed<UiValidationIssue[]>(() => validationReport.value.issues.filter((issue) => {
  if (issue.code !== 'invalid-code') return false
  const path = issue.path ?? ''
  return path === 'sceneScript.source' || path.includes('sceneScript.source')
}))
const previewDiagnostics = computed<UiRuntimeDiagnostic[]>(() => unwrap(designer.previewDiagnostics))
const runtimeCodeDiagnostics = computed<UiRuntimeDiagnostic[]>(() => {
  const sceneName = document.value.meta.sceneName
  return previewDiagnostics.value.filter((diagnostic) => {
    if (diagnostic.scene && diagnostic.scene !== sceneName) return false
    const fields = [diagnostic.file, diagnostic.node, diagnostic.type, diagnostic.phase, diagnostic.event, diagnostic.code, diagnostic.label].filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase()
    return /ready|update|code|script|property|expression|condition|event/.test(fields)
  })
})
const editorRef = ref<{ format: () => void, refreshLayout: () => void }>()
const formatCode = () => editorRef.value?.format()
const activeSceneId = computed(() => unwrap(designer.activeSceneId))
const isCodeMode = computed(() => unwrap(designer.editingMode) === 'code')
const refreshEditorLayout = async () => {
  await nextTick()
  editorRef.value?.refreshLayout()
}
const completionItems = computed(() => [...UI_DESIGNER_SCENE_SCRIPT_COMPLETIONS, ...document.value.nodes.flatMap((node) => [node.id, node.name])])

const updateCode = (value: string, sourceSceneId?: string) => {
  const sceneId = sourceSceneId ?? unwrap(designer.activeSceneId)
  designer.previewSourceCode(value, sceneId)
  designer.commitSourceCode(sceneId)
}
const handleFormatShortcut = () => formatCode()
onMounted(() => {
  window.addEventListener('agent-rpg:ui-designer-format', handleFormatShortcut)
  if (isCodeMode.value) void refreshEditorLayout()
})
watch([isCodeMode, activeSceneId], ([visible]) => {
  if (visible) void refreshEditorLayout()
}, { flush: 'post' })
onBeforeUnmount(() => window.removeEventListener('agent-rpg:ui-designer-format', handleFormatShortcut))
</script>

<template>
  <section class="code-panel">
    <div class="code-head">
      <el-tag size="small" :type="designer.canEditCode ? 'success' : 'danger'" effect="plain">{{ designer.adapters.code.label }}</el-tag>
      <el-button size="small" text :title="`${t('formatCode')} (Shift+Alt+F)`" :disabled="!designer.canEditCode" @click="formatCode">{{ t('formatCode') }}</el-button>
    </div>
    <el-alert v-if="codeIssues.length" type="warning" :closable="false" :title="`${t('invalidCode')} · ${codeIssues.length}`">
      <ul class="code-issues">
        <li v-for="issue in codeIssues" :key="`${issue.path ?? ''}:${issue.message}`">
          <span>{{ t('invalidCode') }}<template v-if="issue.path"> · {{ issue.path }}</template></span>
          <details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ issue.message }}</span></details>
        </li>
      </ul>
    </el-alert>
    <el-alert v-if="runtimeCodeDiagnostics.length" type="warning" :closable="false" :title="`${t('runtimeDiagnostics')} · ${runtimeCodeDiagnostics.length}`">
      <ul class="code-issues">
        <li v-for="diagnostic in runtimeCodeDiagnostics" :key="`${diagnostic.sessionId}:${diagnostic.code}:${diagnostic.node ?? ''}:${diagnostic.message}`">
          <span>{{ t('runtimeDiagnostic') }}<template v-if="diagnostic.count > 1"> ×{{ diagnostic.count }}</template></span>
          <details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ diagnostic.label }}: {{ diagnostic.message }}</span></details>
        </li>
      </ul>
    </el-alert>
    <UiScriptContextHint kind="scene" :issues="codeIssues" />
    <UiCodeMirrorEditor ref="editorRef" :adapter="designer.adapters.code" :model-value="code" :rows="18" :debounce-ms="1000" :format-on-blur="Boolean(designer.preferences.autoFormat)" :scene-id="designer.activeSceneId" :completion-items="completionItems" :draft-coordinator="designer.draftCoordinator" @update:model-value="updateCode" />
  </section>
</template>

<style scoped>
.code-panel { display: flex; flex: 1; flex-direction: column; gap: 9px; width: 100%; height: 100%; min-height: 0; padding: 12px; box-sizing: border-box; background: var(--app-bg); }
.code-panel :deep(.code-mirror-editor), .code-panel :deep(.editor-host) { flex: 1; }
.code-head { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.code-panel :deep(.CodeMirror) { min-height: 300px; height: 100%; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.5; }
.code-issues { margin: 0; padding-left: 16px; }.code-issues li { margin-bottom: 4px; }.status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
