<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type {
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import { useI18n } from '../../i18n';
import PluginParameterInput from '../editor/PluginParameterInput.vue';
import { clonePluginParameterValue } from './plugin-parameter-model';

const props = defineProps<{
  modelValue: boolean;
  field: PluginParameterSchemaField | null;
  value: unknown;
  catalog: EditorProjectCatalog | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  commit: [value: unknown];
}>();

const { t } = useI18n();
const editorBody = ref<HTMLElement | null>(null);
const draft = ref<unknown>('');

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const changed = computed(() => stableValue(draft.value) !== stableValue(props.value));
const isComplex = computed(() =>
  props.field?.kind === 'multiline'
  || props.field?.kind === 'struct'
  || props.field?.kind === 'array'
  || props.field?.kind === 'location',
);

watch(
  () => [props.modelValue, props.field?.key] as const,
  ([open]) => {
    if (open) draft.value = clonePluginParameterValue(props.value);
  },
  { immediate: true },
);

function commit(): void {
  if (!props.field || !changed.value) return;
  emit('commit', clonePluginParameterValue(draft.value));
  visible.value = false;
}

async function focusFirstControl(): Promise<void> {
  await nextTick();
  const control = editorBody.value?.querySelector<HTMLElement>(
    'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])',
  );
  control?.focus();
}

function stableValue(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="plugin-parameter-value-dialog"
    data-ui-id="plugin-parameter-value-dialog"
    :title="t('plugins.editParameterTitle', { name: field?.label || '' })"
    :width="isComplex ? 'min(720px, calc(100vw - 48px))' : 'min(520px, calc(100vw - 48px))'"
    top="10vh"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    @opened="focusFirstControl"
  >
    <div v-if="field" ref="editorBody" class="parameter-value-editor" :class="{ complex: isComplex }">
      <PluginParameterInput
        :field="field"
        :model-value="draft"
        :catalog="catalog"
        @update:model-value="draft = $event"
      />
      <p v-if="field.description" class="parameter-description">{{ field.description }}</p>
    </div>

    <template #footer>
      <button type="button" @click="visible = false">
        {{ t('editor.mapProperties.cancel') }}
      </button>
      <button type="button" class="primary" :disabled="!changed" @click="commit">
        {{ t('plugins.confirmParameter') }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
:global(.plugin-parameter-value-dialog) {
  display: flex;
  max-height: 78vh;
  flex-direction: column;
}
:global(.plugin-parameter-value-dialog .el-dialog__body) {
  min-height: 0;
  overflow: auto;
}
.parameter-value-editor {
  display: grid;
  gap: 10px;
}
.parameter-value-editor.complex {
  min-height: 180px;
}
.parameter-description {
  margin: 0;
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
button.primary {
  border-color: var(--console-accent, #be5630);
  background: var(--console-accent, #be5630);
  color: #fff;
}
button:focus-visible {
  outline: 2px solid var(--console-accent, #be5630);
  outline-offset: 2px;
}
</style>
