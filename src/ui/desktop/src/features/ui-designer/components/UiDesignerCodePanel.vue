<script setup lang="ts">
import { computed, isRef, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiRuntimeDiagnostic, UiValidationIssue, UiValidationReport } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const setCodeTab = (value: 'ready' | 'update') => {
  if (isRef(designer.codeTab)) designer.codeTab.value = value
  else (designer as unknown as { codeTab: 'ready' | 'update' }).codeTab = value
}
const codeTab = computed<'ready' | 'update'>({ get: () => unwrap(designer.codeTab), set: setCodeTab })
const document = computed(() => unwrap(designer.document))
const draftCode = computed<Record<string, string>>(() => unwrap(designer.draftCode))
const code = computed(() => draftCode.value[`${unwrap(designer.activeSceneId)}:${codeTab.value}`] ?? document.value.code[codeTab.value])
const validationReport = computed<UiValidationReport>(() => unwrap(designer.validation))
const codeIssues = computed<UiValidationIssue[]>(() => validationReport.value.issues.filter((issue) => {
  if (issue.code !== 'invalid-code') return false
  const path = issue.path ?? ''
  return path === `code.${codeTab.value}` || path.includes(`code.${codeTab.value}`)
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
const editorRef = ref<{ format: () => void }>()
const formatCode = () => editorRef.value?.format()
let commitTimer: ReturnType<typeof setTimeout> | undefined
let pendingDraft: { sceneId: string; key: 'ready' | 'update' } | undefined

const commitPending = () => {
  if (!pendingDraft) return
  const draft = pendingDraft
  pendingDraft = undefined
  designer.commitSourceCode(draft.key, draft.sceneId)
}

const updateCode = (value: string, sourceSceneId?: string) => {
  const sceneId = sourceSceneId ?? unwrap(designer.activeSceneId)
  const key = codeTab.value
  designer.previewSourceCode(key, value, sceneId)
  pendingDraft = { sceneId, key }
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(() => { commitPending(); commitTimer = undefined }, 1000)
}
const changeCodeTab = (value: 'ready' | 'update') => { if (commitTimer) clearTimeout(commitTimer); commitPending(); codeTab.value = value }
onBeforeUnmount(() => { if (commitTimer) clearTimeout(commitTimer); commitPending() })
const handleFormatShortcut = () => formatCode()
onMounted(() => window.addEventListener('agent-rpg:ui-designer-format', handleFormatShortcut))
onBeforeUnmount(() => window.removeEventListener('agent-rpg:ui-designer-format', handleFormatShortcut))
</script>

<template>
  <section class="code-panel">
    <div class="code-head">
      <div class="code-tabs">
        <el-button size="small" text :class="{ active: codeTab === 'ready' }" @click="changeCodeTab('ready')">ready()</el-button>
        <el-button size="small" text :class="{ active: codeTab === 'update' }" @click="changeCodeTab('update')">update()</el-button>
      </div>
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
  <UiCodeMirrorEditor ref="editorRef" :adapter="designer.adapters.code" :model-value="code" :rows="18" :debounce-ms="1000" :scene-id="designer.activeSceneId" :completion-items="document.nodes.flatMap((node) => [node.id, node.name])" :draft-coordinator="designer.draftCoordinator" @update:model-value="updateCode" />
  </section>
</template>

<style scoped>
.code-panel { display: flex; flex-direction: column; gap: 9px; height: 100%; min-height: 0; padding: 12px; background: var(--app-bg); }
.code-head { display: flex; align-items: center; justify-content: space-between; }
.code-tabs { display: flex; gap: 2px; }
.code-tabs .el-button { margin: 0; color: var(--app-ink-soft); }
.code-tabs .el-button.active { border-bottom: 2px solid var(--app-accent); color: var(--app-accent); }
.code-panel :deep(.CodeMirror) { min-height: 300px; height: 100%; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.5; }
.code-issues { margin: 0; padding-left: 16px; }.code-issues li { margin-bottom: 4px; }.status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
