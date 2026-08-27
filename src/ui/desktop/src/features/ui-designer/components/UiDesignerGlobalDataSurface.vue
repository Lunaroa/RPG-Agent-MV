<script setup lang="ts">
import { isRef, onMounted, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { UiDesignerController } from '../composables/useUiDesigner'
import type { UiDesignerFileMetadata, UiDesignerGlobalDataValue } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'
import UiCodeMirrorEditor from './UiCodeMirrorEditor.vue'

const props = defineProps<{
  modelValue: boolean
  designer: UiDesignerController
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useUiDesignerI18n()
const designer = props.designer
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const draft = ref('')
const busy = ref(false)
const loadError = ref('')
const saveError = ref('')
const savedMetadata = ref<Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'> | null>(null)

onMounted(async () => {
  busy.value = true
  try {
    const result = await props.designer.adapters.file.readGlobalData()
    if (result.status !== 'success' || !result.value) {
      loadError.value = result.message || t('operationError')
      return
    }
    draft.value = JSON.stringify(result.value.data, null, 2)
    savedMetadata.value = result.value.metadata ? { digest: result.value.metadata.digest, mtimeMs: result.value.metadata.mtimeMs } : null
  } finally {
    busy.value = false
  }
})

const save = async () => {
  if (busy.value) return
  saveError.value = ''
  let parsed: UiDesignerGlobalDataValue
  try {
    const value: unknown = JSON.parse(draft.value)
    if (!value || typeof value !== 'object') throw new Error(t('globalDataInvalid'))
    parsed = value as UiDesignerGlobalDataValue
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error)
    return
  }
  busy.value = true
  try {
    const result = await props.designer.adapters.file.saveGlobalData(parsed, {
      ...(savedMetadata.value ? { expected: savedMetadata.value } : {}),
    })
    if (result.status !== 'success') {
      saveError.value = result.message || t('operationError')
      return
    }
    savedMetadata.value = result.metadata ? { digest: result.metadata.digest, mtimeMs: result.metadata.mtimeMs } : null
    ElMessage.success(t('globalDataSaved'))
  } finally {
    busy.value = false
  }
}
const close = (visible: boolean) => emit('update:modelValue', visible)
</script>

<template>
  <el-dialog :model-value="props.modelValue" :title="t('globalDataTitle')" width="min(720px, 94vw)" destroy-on-close @update:model-value="close">
    <div class="dialog-stack">
      <p class="dialog-copy">{{ t('globalDataBody') }}</p>
      <el-alert v-if="loadError" type="error" :closable="false" :title="t('operationError')">
        <details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ loadError }}</span></details>
      </el-alert>
      <el-alert v-else-if="saveError" data-testid="ui-designer-global-data-error" type="error" :closable="false" :title="t('operationError')">
        <details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ saveError }}</span></details>
      </el-alert>
      <UiCodeMirrorEditor v-if="!loadError" :adapter="designer.adapters.code" mode="json" :model-value="draft" :rows="18" :font-family="unwrap(designer.preferences).codeFontFamily" :font-size="unwrap(designer.preferences).codeFontSize" @update:model-value="draft = $event" />
    </div>
    <template #footer>
      <el-button data-testid="ui-designer-global-data-cancel" :disabled="busy" @click="emit('update:modelValue', false)">{{ t('lifecycleCancel') }}</el-button>
      <el-button data-testid="ui-designer-global-data-save" type="primary" :loading="busy" :disabled="Boolean(loadError) || !unwrap(designer.hasProject)" @click="void save()">{{ t('save') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-stack { display: flex; flex-direction: column; gap: 9px; color: var(--app-ink); font-size: 13px; line-height: 1.6; }
.dialog-copy { margin: 0; color: var(--app-ink-soft); }
.dialog-stack :deep(.CodeMirror) { min-height: 300px; line-height: 1.5; }
.status-detail { color: var(--app-ink-soft); font-size: 10px; }
</style>
