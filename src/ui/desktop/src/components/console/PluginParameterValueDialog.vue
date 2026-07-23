<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type {
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import { useI18n } from '../../i18n';
import PluginParameterInput from '../editor/PluginParameterInput.vue';
import PluginParameterCollectionEditor from './PluginParameterCollectionEditor.vue';
import {
  parsePluginParameterRawStrict,
  serializePluginParameterRaw,
  type PluginParameterRawParseError,
} from './plugin-parameter-collection-model';
import {
  clonePluginParameterValue,
  createDefaultPluginParameterValue,
  replacePluginParameterChildValue,
  validatePluginParameterValue,
  type PluginParameterChildTarget,
  type PluginParameterValidationIssue,
} from './plugin-parameter-model';

defineOptions({ name: 'PluginParameterValueDialog' });

const props = defineProps<{
  modelValue: boolean;
  field: PluginParameterSchemaField | null;
  value: unknown;
  catalog: EditorProjectCatalog | null;
  title?: string;
  allowUnchangedCommit?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  commit: [value: unknown];
}>();

interface ChildEditorState {
  field: PluginParameterSchemaField;
  value: unknown;
  target: PluginParameterChildTarget;
  label: string;
  pendingAppend: boolean;
}

const { t } = useI18n();
const editorBody = ref<HTMLElement | null>(null);
const draft = ref<unknown>('');
const activeTab = ref<'structure' | 'text'>('structure');
const rawText = ref('');
const rawError = ref('');
const collectionVersion = ref(0);
const childDialogOpen = ref(false);
const childEditor = ref<ChildEditorState | null>(null);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const isCompound = computed(() =>
  props.field?.kind === 'struct' || props.field?.kind === 'array',
);
const isComplex = computed(() =>
  props.field?.kind === 'multiline'
  || isCompound.value
  || props.field?.kind === 'location',
);
const dialogTitle = computed(() =>
  props.title || t('plugins.editParameterTitle', { name: props.field?.label || '' }),
);
const baselineRaw = computed(() =>
  props.field && isCompound.value
    ? serializePluginParameterRaw(props.field, props.value)
    : stableValue(props.value),
);
const currentRaw = computed(() =>
  props.field && isCompound.value
    ? serializePluginParameterRaw(props.field, draft.value)
    : stableValue(draft.value),
);
const changed = computed(() =>
  activeTab.value === 'text' && isCompound.value
    ? rawText.value !== baselineRaw.value
    : currentRaw.value !== baselineRaw.value,
);
const childTitle = computed(() =>
  childEditor.value
    ? t('plugins.editParameterTitle', { name: childEditor.value.label })
    : '',
);
const validationIssue = computed(() =>
  props.field
    ? validatePluginParameterValue(props.field, draft.value, props.field.key, props.value)
    : null,
);
const validationMessage = computed(() =>
  validationIssue.value ? formatValidationIssue(validationIssue.value) : '',
);

watch(
  () => [props.modelValue, props.field?.key] as const,
  ([open]) => {
    if (open) {
      draft.value = clonePluginParameterValue(props.value);
      activeTab.value = 'structure';
      rawText.value = props.field && isCompound.value
        ? serializePluginParameterRaw(props.field, draft.value)
        : '';
      rawError.value = '';
      collectionVersion.value += 1;
    } else {
      childDialogOpen.value = false;
      childEditor.value = null;
    }
  },
  { immediate: true },
);

function commit(): void {
  if (!props.field) return;
  if (activeTab.value === 'text' && isCompound.value && !applyRawText()) return;
  if (validationIssue.value) return;
  if (
    !props.allowUnchangedCommit
    && !changed.value
    && currentRaw.value === baselineRaw.value
  ) return;
  emit('commit', clonePluginParameterValue(draft.value));
  visible.value = false;
}

function handleTabChange(name: string | number): void {
  if (!props.field || !isCompound.value) return;
  if (name === 'text') {
    rawText.value = serializePluginParameterRaw(props.field, draft.value);
    rawError.value = '';
    return;
  }
  if (name === 'structure' && !applyRawText()) {
    void nextTick(() => {
      activeTab.value = 'text';
      focusRawText();
    });
  }
}

function applyRawText(): boolean {
  const field = props.field;
  if (!field || !isCompound.value) return true;
  const parsed = parsePluginParameterRawStrict(field, rawText.value);
  if (!parsed.ok) {
    rawError.value = formatRawError(parsed.error);
    return false;
  }
  draft.value = clonePluginParameterValue(parsed.value);
  rawError.value = '';
  collectionVersion.value += 1;
  return true;
}

function formatRawError(error: PluginParameterRawParseError): string {
  if (error.reason === 'syntax') {
    return t('plugins.parameterRawSyntaxError', {
      line: error.line,
      column: error.column,
      path: error.path,
    });
  }
  return t('plugins.parameterRawShapeError', { path: error.path });
}

function formatValidationIssue(issue: PluginParameterValidationIssue): string {
  if (issue.kind === 'number-required') {
    return t('plugins.parameterNumberRequired', { path: issue.path });
  }
  if (issue.kind === 'number-invalid') {
    return t('plugins.parameterNumberInvalid', { path: issue.path });
  }
  if (issue.kind === 'number-min') {
    return t('plugins.parameterNumberMin', { path: issue.path, min: issue.min });
  }
  if (issue.kind === 'number-max') {
    return t('plugins.parameterNumberMax', { path: issue.path, max: issue.max });
  }
  if (issue.kind === 'number-decimals') {
    return t('plugins.parameterNumberDecimals', {
      path: issue.path,
      decimals: issue.decimals,
    });
  }
  return t('plugins.parameterLocationInvalid', { path: issue.path });
}

function updateDraft(value: unknown): void {
  draft.value = clonePluginParameterValue(value);
}

function openChildEditor(payload: {
  field: PluginParameterSchemaField;
  value: unknown;
  target: PluginParameterChildTarget;
  label: string;
}): void {
  childEditor.value = {
    ...payload,
    value: clonePluginParameterValue(payload.value),
    pendingAppend: false,
  };
  childDialogOpen.value = true;
}

function addArrayItem(): void {
  const item = props.field?.kind === 'array' ? props.field.item : undefined;
  if (!item) return;
  childEditor.value = {
    field: item,
    value: createDefaultPluginParameterValue(item),
    target: { kind: 'array', index: arrayValue(draft.value).length },
    label: t('plugins.parameterArrayItem', {
      index: arrayValue(draft.value).length + 1,
    }),
    pendingAppend: true,
  };
  childDialogOpen.value = true;
}

function commitChild(value: unknown): void {
  const child = childEditor.value;
  if (!child) return;
  if (child.pendingAppend) {
    draft.value = [
      ...arrayValue(draft.value).map((entry) => clonePluginParameterValue(entry)),
      clonePluginParameterValue(value),
    ];
  } else {
    draft.value = replacePluginParameterChildValue(draft.value, child.target, value);
  }
}

async function confirmClose(done?: () => void): Promise<void> {
  if (!changed.value) {
    done ? done() : (visible.value = false);
    return;
  }
  try {
    await ElMessageBox.confirm(
      t('plugins.unsavedParameterValueConfirm'),
      t('plugins.unsavedParametersTitle'),
      {
        type: 'warning',
        confirmButtonText: t('plugins.discardChanges'),
        cancelButtonText: t('editor.mapProperties.cancel'),
      },
    );
    done ? done() : (visible.value = false);
  } catch {
    // Keep the current layer and its draft open.
  }
}

async function focusFirstControl(): Promise<void> {
  await nextTick();
  editorBody.value?.querySelector<HTMLElement>(
    'tbody tr, input:not([disabled]), textarea:not([disabled]), button:not([disabled])',
  )?.focus();
}

function focusRawText(): void {
  document.querySelector<HTMLElement>(
    '.plugin-parameter-value-dialog .parameter-raw-input textarea',
  )?.focus();
}

function stableValue(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="plugin-parameter-value-dialog"
    data-ui-id="plugin-parameter-value-dialog"
    :title="dialogTitle"
    :width="isCompound
      ? 'min(1040px, calc(100vw - 48px))'
      : isComplex
        ? 'min(720px, calc(100vw - 48px))'
        : 'min(520px, calc(100vw - 48px))'"
    top="7vh"
    append-to-body
    destroy-on-close
    :close-on-click-modal="true"
    :before-close="confirmClose"
    @opened="focusFirstControl"
  >
    <div
      v-if="field"
      ref="editorBody"
      class="parameter-value-editor"
      :class="{ complex: isComplex }"
    >
      <PluginParameterInput
        v-if="!isCompound"
        :field="field"
        :model-value="draft"
        :catalog="catalog"
        @update:model-value="draft = $event"
      />

      <el-tabs
        v-else
        v-model="activeTab"
        class="parameter-mode-tabs"
        type="card"
        @tab-change="handleTabChange"
      >
        <el-tab-pane
          :label="t('plugins.parameterStructureTab')"
          name="structure"
        >
          <PluginParameterCollectionEditor
            :key="collectionVersion"
            :field="field"
            :model-value="draft"
            :catalog="catalog"
            @update:model-value="updateDraft"
            @edit="openChildEditor"
            @add="addArrayItem"
          />
        </el-tab-pane>
        <el-tab-pane
          :label="t('plugins.parameterTextTab')"
          name="text"
        >
          <div class="parameter-raw-editor">
            <el-input
              v-model="rawText"
              class="parameter-raw-input"
              type="textarea"
              resize="none"
              spellcheck="false"
              :autosize="{ minRows: 14, maxRows: 24 }"
              :aria-label="t('plugins.parameterRawTextLabel')"
              @input="rawError = ''"
            />
            <p class="raw-help">
              {{ t('plugins.parameterRawTextHelp') }}
            </p>
            <p v-if="rawError" class="raw-error" role="alert">
              {{ rawError }}
            </p>
          </div>
        </el-tab-pane>
      </el-tabs>

      <p v-if="field.description" class="parameter-description">
        {{ field.description }}
      </p>
      <p v-if="validationMessage" class="parameter-validation-error" role="alert">
        {{ validationMessage }}
      </p>
    </div>

    <template #footer>
      <el-button @click="confirmClose()">
        {{ t('editor.mapProperties.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :disabled="Boolean(validationIssue) || (!changed && !allowUnchangedCommit)"
        @click="commit"
      >
        {{ t('plugins.confirmParameter') }}
      </el-button>
    </template>
  </el-dialog>

  <PluginParameterValueDialog
    v-if="childDialogOpen && childEditor"
    v-model="childDialogOpen"
    :field="childEditor.field"
    :value="childEditor.value"
    :catalog="catalog"
    :title="childTitle"
    :allow-unchanged-commit="childEditor.pendingAppend"
    @commit="commitChild"
  />
</template>

<style scoped>
:global(.plugin-parameter-value-dialog) {
  display: flex;
  max-height: 86vh;
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
.parameter-mode-tabs {
  min-height: 0;
}
.parameter-mode-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
.parameter-raw-editor {
  display: grid;
  gap: 8px;
}
.parameter-raw-input :deep(textarea) {
  min-height: 320px !important;
  padding: 12px;
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 82%, white);
  color: var(--console-text, #312d28);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
}
.raw-help,
.raw-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.raw-help {
  color: var(--console-text-muted, #756b5e);
}
.raw-error {
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--el-color-danger) 38%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-color-danger) 9%, transparent);
  color: var(--el-color-danger-dark-2);
}
.parameter-description {
  min-height: 36px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 8px;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.parameter-validation-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--el-color-danger) 38%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-color-danger) 9%, transparent);
  color: var(--el-color-danger-dark-2);
  font-size: 12px;
  line-height: 1.5;
}
</style>
