<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { normalizeUiDesignerProjectRelativeResourcePath } from '@contract/ui-designer-resources'
import type { UiDesignerDraftCoordinator } from '../composables/draftCoordinator'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  modelValue: string
  placeholder: string
  selectLabel: string
  clearLabel: string
  selectDisabled?: boolean
  valueUiId?: string
  selectUiId?: string
  clearUiId?: string
  editable?: boolean
  draftCoordinator?: UiDesignerDraftCoordinator
  sceneId?: string
  nodeId?: string
}>()
const emit = defineEmits<{ select: []; clear: []; change: [value: string] }>()
const { t } = useUiDesignerI18n()
const draft = ref(props.modelValue)
const error = ref('')
let pending = false
const cancel = () => { pending = false; draft.value = props.modelValue; error.value = '' }
const input = (value: string) => {
  if (!props.editable) return
  draft.value = value
  pending = value !== props.modelValue
  error.value = ''
}
const commit = (required = false) => {
  if (!pending) return
  let value: string
  try { value = normalizeUiDesignerProjectRelativeResourcePath(draft.value) } catch {
    error.value = t('resourceDropInvalid')
    if (required) throw new Error(error.value)
    return
  }
  pending = false
  draft.value = value
  error.value = ''
  if (value !== props.modelValue) emit('change', value)
}
const unregister = props.draftCoordinator?.register(() => commit(true), {
  sceneId: () => props.sceneId,
  pending: () => pending,
  cancel,
})
watch(() => [props.modelValue, props.sceneId, props.nodeId, props.editable], cancel)
onBeforeUnmount(() => { unregister?.(); cancel() })
const clear = () => { cancel(); emit('clear') }
</script>

<template>
  <div class="resource-reference">
    <el-input
      :model-value="draft"
      :readonly="!props.editable"
      :aria-invalid="Boolean(error)"
      size="small"
      :placeholder="props.placeholder"
      :data-ui-id="props.valueUiId"
      :data-testid="props.valueUiId"
      @update:model-value="input"
      @blur="commit()"
      @keydown.enter.stop.prevent="commit()"
      @keydown.esc.stop.prevent="cancel()"
    >
      <template #append>
        <span class="resource-actions">
          <el-button
            :data-ui-id="props.selectUiId"
            :data-testid="props.selectUiId"
            size="small"
            :disabled="props.selectDisabled"
            @click="emit('select')"
          >{{ props.selectLabel }}</el-button>
          <el-tooltip v-if="props.modelValue" :content="props.clearLabel" placement="top">
            <el-button
              class="resource-clear"
              :data-ui-id="props.clearUiId"
              :data-testid="props.clearUiId"
              size="small"
              :aria-label="props.clearLabel"
              @click="clear"
            >
              <el-icon><Close /></el-icon>
            </el-button>
          </el-tooltip>
        </span>
      </template>
    </el-input>
  <span v-if="error" class="resource-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.resource-reference { min-width: 0; }
.resource-error { color: var(--el-color-danger); font-size: 11px; }
.resource-actions { display: inline-flex; align-items: stretch; height: 100%; margin-left: -20px; margin-right: -20px; }
.resource-actions .el-button { height: 100%; margin: 0; border: 0; border-radius: 0; }
.resource-actions .el-button + .el-button { border-left: 1px solid var(--el-border-color); }
.resource-clear { width: 28px; padding: 0; }
</style>
