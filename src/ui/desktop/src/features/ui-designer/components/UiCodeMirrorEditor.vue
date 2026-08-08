<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { UiCodeEditorAdapter, UiCodeEditorHandle } from '@contract/ui-designer'
import type { UiDesignerDraftCoordinator } from '../composables/draftCoordinator'
import { useUiDesignerI18n } from '../i18n'

const props = withDefaults(defineProps<{
  adapter: UiCodeEditorAdapter
  modelValue: string
  label?: string
  rows?: number
  completionItems?: string[]
  debounceMs?: number
  draftCoordinator?: UiDesignerDraftCoordinator
  /** Stable scene identity captured with a delayed edit. */
  sceneId?: string
}>(), { label: 'JavaScript', rows: 12, debounceMs: 0 })
const { t } = useUiDesignerI18n()
const emit = defineEmits<{ 'update:modelValue': [value: string, sceneId?: string] }>()
const host = ref<HTMLElement>()
const error = ref('')
let editor: UiCodeEditorHandle | undefined
let changeTimer: ReturnType<typeof setTimeout> | undefined
let pendingChange: string | undefined
let pendingSceneId: string | undefined
const flushPendingChange = () => {
  if (changeTimer) { clearTimeout(changeTimer); changeTimer = undefined }
  if (pendingChange !== undefined) {
    const value = pendingChange
    const sceneId = pendingSceneId ?? props.sceneId
    pendingChange = undefined
    pendingSceneId = undefined
    emit('update:modelValue', value, sceneId)
  }
}
const cancelPendingChange = () => {
  if (changeTimer) { clearTimeout(changeTimer); changeTimer = undefined }
  pendingChange = undefined
  pendingSceneId = undefined
}
const unregisterDraft = props.draftCoordinator?.register(flushPendingChange, {
  cancel: cancelPendingChange,
  sceneId: () => pendingSceneId ?? props.sceneId,
  pending: () => pendingChange !== undefined,
})

const emitChange = (value: string) => {
  if (!props.debounceMs) { emit('update:modelValue', value, props.sceneId); return }
  pendingChange = value
  pendingSceneId = props.sceneId
  if (changeTimer) clearTimeout(changeTimer)
  const sceneId = pendingSceneId
  changeTimer = setTimeout(() => {
    emit('update:modelValue', value, sceneId)
    pendingChange = undefined
    pendingSceneId = undefined
    changeTimer = undefined
  }, props.debounceMs)
}

const mountEditor = () => {
  if (!host.value) return
  if (!props.adapter.available || !props.adapter.mount) {
    error.value = `${props.adapter.label} CodeMirror editor is unavailable; editing is disabled.`
    return
  }
  try {
    editor = props.adapter.mount(host.value, {
      value: props.modelValue,
      mode: 'javascript',
      lineNumbers: true,
      foldGutter: true,
      searchReplace: true,
      completionItems: props.completionItems,
      onChange: emitChange,
    })
    error.value = ''
  } catch (mountError) {
    error.value = `CodeMirror failed to initialize: ${mountError instanceof Error ? mountError.message : String(mountError)}`
  }
}

onMounted(() => { void nextTick(mountEditor) })
watch(() => props.modelValue, (value) => {
  if (editor && editor.getValue() !== value) editor.setValue(value)
})
onBeforeUnmount(() => { flushPendingChange(); unregisterDraft?.(); editor?.dispose(); editor = undefined })

const format = () => editor?.format?.()
defineExpose({ format })
</script>

<template>
  <div class="code-mirror-editor">
    <div ref="host" class="editor-host" :style="{ minHeight: `${props.rows * 1.5}em` }" />
    <el-alert v-if="error" type="error" :closable="false" :title="t('operationError')">
      <details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ error }}</span></details>
    </el-alert>
  </div>
</template>

<style scoped>
.code-mirror-editor { display: flex; flex-direction: column; gap: 7px; min-height: 0; }
.editor-host { min-height: 120px; border: 1px solid var(--app-border); border-radius: 4px; overflow: hidden; background: #101218; }
.status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
