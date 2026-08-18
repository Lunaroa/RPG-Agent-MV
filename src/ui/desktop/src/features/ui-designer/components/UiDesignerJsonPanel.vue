<script setup lang="ts">
import { computed, isRef, nextTick, onMounted, ref, watch, type Ref } from 'vue'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n } from '../i18n'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const document = computed(() => unwrap(designer.document))
const draft = ref('')
const applyError = ref('')
const editorRef = ref<{ format: () => void, refreshLayout: () => void }>()
const isJsonMode = computed(() => unwrap(designer.editingMode) === 'json')

watch(document, () => { draft.value = JSON.stringify(document.value, null, 2) }, { immediate: true })

const apply = () => {
  const result = designer.applyJsonDocument(draft.value)
  applyError.value = result.ok ? '' : (result.message ?? '')
}

const refreshEditorLayout = async () => {
  await nextTick()
  editorRef.value?.refreshLayout()
}
onMounted(() => {
  if (isJsonMode.value) void refreshEditorLayout()
})
watch(isJsonMode, (visible) => {
  if (visible) void refreshEditorLayout()
}, { flush: 'post' })
</script>

<template>
  <section class="json-panel" data-ui-id="ui-designer-json-panel">
    <div class="json-head">
      <el-button size="small" text data-ui-id="ui-designer-json-apply" @click="apply">{{ t('applyJson') }}</el-button>
    </div>
    <el-alert v-if="applyError" type="error" :closable="false" :title="t('operationError')">
      <details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ applyError }}</span></details>
    </el-alert>
    <UiCodeMirrorEditor ref="editorRef" :adapter="designer.adapters.code" mode="json" :model-value="draft" :rows="18" :font-family="designer.preferences.codeFontFamily" :font-size="designer.preferences.codeFontSize" @update:model-value="draft = $event" />
  </section>
</template>

<style scoped>
.json-panel { display: flex; flex: 1; flex-direction: column; gap: 9px; width: 100%; height: 100%; min-height: 0; padding: 12px; box-sizing: border-box; background: var(--app-bg); }
.json-panel :deep(.code-mirror-editor), .json-panel :deep(.editor-host) { flex: 1; }
.json-panel :deep(.CodeMirror) { min-height: 300px; height: 100%; line-height: 1.5; }
.json-head { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
