<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import {
  type EditorProjectCatalog,
  type ManagedPluginEntry,
  type PluginParameterSchemaField,
} from '../../api/client';
import { useI18n } from '../../i18n';
import {
  buildPluginParameterPayload,
  buildPluginParameterRows,
  clonePluginParameterValue,
  createPluginParameterForm,
  pluginParameterPayloadsEqual,
  type PluginParameterSummaryLabels,
} from './plugin-parameter-model';
import PluginParameterValueDialog from './PluginParameterValueDialog.vue';

const props = defineProps<{
  modelValue: boolean;
  busy: boolean;
  plugin: ManagedPluginEntry | null;
  catalog: EditorProjectCatalog | null;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  closed: [];
  save: [parameters: Record<string, unknown>];
}>();

const { t } = useI18n();
const parameterForm = ref<Record<string, unknown>>({});
const baselinePayload = ref<Record<string, unknown>>({});
const selectedParameterKey = ref('');
const valueDialogOpen = ref(false);
const editingField = ref<PluginParameterSchemaField | null>(null);
const parameterTable = ref<HTMLElement | null>(null);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const summaryLabels = computed<PluginParameterSummaryLabels>(() => ({
  enabled: t('plugins.parameterEnabled'),
  disabled: t('plugins.parameterDisabled'),
  empty: t('plugins.parameterEmptyValue'),
  itemCount: (count: number) => t('plugins.parameterItemCount', { count }),
  structuredValue: t('plugins.parameterStructuredValue'),
  location: (map: string, x: number, y: number) =>
    t('plugins.parameterLocationValue', { map, x, y }),
}));
const readonlyReason = computed(() =>
  props.plugin?.fileExists
    ? t('plugins.parameterReadonlyReason')
    : t('plugins.parameterMissingFileReadonly'),
);
const parameterRows = computed(() =>
  props.plugin
    ? buildPluginParameterRows(
        props.plugin,
        parameterForm.value,
        props.catalog,
        summaryLabels.value,
        readonlyReason.value,
      )
    : [],
);
const selectedRow = computed(() =>
  parameterRows.value.find((row) => row.key === selectedParameterKey.value)
  || parameterRows.value[0]
  || null,
);
const currentPayload = computed(() =>
  props.plugin
    ? buildPluginParameterPayload(props.plugin, parameterForm.value)
    : {},
);
const parametersDirty = computed(() =>
  Boolean(props.plugin)
  && !pluginParameterPayloadsEqual(currentPayload.value, baselinePayload.value),
);

watch(
  () => [props.modelValue, props.plugin?.name] as const,
  ([open]) => {
    if (open) resetEditor();
    else valueDialogOpen.value = false;
  },
  { immediate: true },
);

watch(
  () => parameterRows.value.map((row) => row.key).join('\u0000'),
  () => {
    if (!parameterRows.value.some((row) => row.key === selectedParameterKey.value)) {
      selectedParameterKey.value = parameterRows.value[0]?.key || '';
    }
  },
);

function resetEditor(): void {
  const plugin = props.plugin;
  valueDialogOpen.value = false;
  editingField.value = null;
  if (!plugin) {
    parameterForm.value = {};
    baselinePayload.value = {};
    selectedParameterKey.value = '';
    return;
  }
  parameterForm.value = createPluginParameterForm(plugin);
  baselinePayload.value = clonePluginParameterValue(
    buildPluginParameterPayload(plugin, parameterForm.value),
  );
  selectedParameterKey.value = parameterRows.value[0]?.key
    || plugin.parameterSchema?.fields[0]?.key
    || Object.keys(plugin.parameters || {})[0]
    || '';
}

async function confirmClose(done?: () => void): Promise<void> {
  if (props.busy) return;
  if (parametersDirty.value) {
    try {
      await ElMessageBox.confirm(
        t('plugins.unsavedParametersConfirm'),
        t('plugins.unsavedParametersTitle'),
        { type: 'warning' },
      );
    } catch {
      return;
    }
  }
  if (done) done();
  else visible.value = false;
}

function save(): void {
  if (props.busy || !props.plugin || !parametersDirty.value) return;
  emit('save', clonePluginParameterValue(currentPayload.value));
}

function selectParameter(key: string): void {
  selectedParameterKey.value = key;
}

function openParameterEditor(key: string): void {
  selectedParameterKey.value = key;
  openSelectedParameterEditor();
}

function openSelectedParameterEditor(): void {
  const row = selectedRow.value;
  if (props.busy || !row?.editable || !row.field) return;
  editingField.value = row.field;
  valueDialogOpen.value = true;
}

function commitParameterValue(value: unknown): void {
  const field = editingField.value;
  if (!field) return;
  parameterForm.value = {
    ...parameterForm.value,
    [field.key]: value,
  };
}

function parameterRowKeydown(event: KeyboardEvent, index: number): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    selectedParameterKey.value = parameterRows.value[index]?.key || selectedParameterKey.value;
    openSelectedParameterEditor();
    return;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const nextIndex = Math.max(0, Math.min(
    parameterRows.value.length - 1,
    index + (event.key === 'ArrowUp' ? -1 : 1),
  ));
  const next = parameterRows.value[nextIndex];
  if (!next) return;
  selectedParameterKey.value = next.key;
  void nextTick(() => {
    parameterTable.value
      ?.querySelectorAll<HTMLElement>('tbody tr')
      .item(nextIndex)
      ?.focus();
  });
}

async function focusInitialParameter(): Promise<void> {
  await nextTick();
  parameterTable.value?.querySelector<HTMLElement>('tbody tr')?.focus();
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="plugin-parameter-dialog"
    data-ui-id="plugin-parameter-dialog"
    :title="t('plugins.parameterDialogTitle', { name: plugin?.name || '' })"
    width="min(860px, calc(100vw - 48px))"
    top="3vh"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    :before-close="confirmClose"
    @opened="focusInitialParameter"
    @closed="emit('closed')"
  >
    <div v-if="plugin" class="parameter-dialog-body">
      <section class="plugin-parameters">
        <h3>{{ t('plugins.parameters') }}</h3>
        <div v-if="parameterRows.length" ref="parameterTable" class="parameter-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{{ t('plugins.parameterNameColumn') }}</th>
                <th scope="col">{{ t('plugins.parameterValueColumn') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in parameterRows"
                :key="row.key"
                :data-parameter-key="row.key"
                :class="{ selected: selectedRow?.key === row.key, readonly: !row.editable }"
                tabindex="0"
                :aria-selected="selectedRow?.key === row.key"
                @click="selectParameter(row.key)"
                @dblclick="openParameterEditor(row.key)"
                @keydown="parameterRowKeydown($event, index)"
              >
                <td>
                  <div class="parameter-name-cell">
                    <span>{{ row.label }}</span>
                    <el-tag
                      size="small"
                      type="info"
                      effect="plain"
                      class="parameter-key-tag"
                    >
                      {{ row.key }}
                    </el-tag>
                  </div>
                  <small v-if="!row.editable">{{ t('plugins.parameterReadonly') }}</small>
                </td>
                <td :title="row.fullValue">
                  <div class="parameter-value-cell">
                    <span>{{ row.summary }}</span>
                    <el-button
                      v-if="row.editable"
                      link
                      type="primary"
                      size="small"
                      :disabled="busy"
                      class="parameter-row-edit"
                      @click.stop="openParameterEditor(row.key)"
                      @dblclick.stop
                    >
                      {{ t('plugins.editParameter') }}
                    </el-button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="parameter-empty">{{ t('plugins.noParameters') }}</div>

        <div v-if="selectedRow" class="parameter-detail" aria-live="polite">
          <p v-if="selectedRow.description">{{ selectedRow.description }}</p>
        </div>
        <p v-if="errorMessage" class="parameter-error" role="alert">{{ errorMessage }}</p>
      </section>
    </div>

    <template #footer>
      <el-button :disabled="busy" @click="confirmClose()">
        {{ t('editor.mapProperties.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="busy"
        :disabled="busy || !parametersDirty"
        @click="save"
      >
        {{ busy ? t('plugins.savingParams') : t('plugins.saveParams') }}
      </el-button>
    </template>
  </el-dialog>

  <PluginParameterValueDialog
    v-model="valueDialogOpen"
    :field="editingField"
    :value="editingField ? parameterForm[editingField.key] : ''"
    :catalog="catalog"
    @commit="commitParameterValue"
  />
</template>

<style scoped>
:global(.plugin-parameter-dialog) {
  display: flex;
  max-height: 94vh;
  flex-direction: column;
}
:global(.plugin-parameter-dialog .el-dialog__header) {
  flex: 0 0 auto;
  margin-right: 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
}
:global(.plugin-parameter-dialog .el-dialog__body) {
  min-height: 0;
  display: flex;
  overflow: hidden;
  padding: 14px;
}
:global(.plugin-parameter-dialog .el-dialog__footer) {
  flex: 0 0 auto;
  border-top: 1px solid var(--console-border, #e4dcce);
}
.parameter-dialog-body {
  min-height: 0;
  width: 100%;
}
.plugin-parameters {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 10px;
  background: var(--console-paper, #fffdfa);
}
h3 {
  margin: 0;
  padding: 9px 12px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  color: var(--console-text-soft, #5a5247);
  font-size: 12px;
  font-weight: 700;
}
.plugin-parameters {
  display: flex;
  flex-direction: column;
}
.parameter-table-wrap {
  min-height: 180px;
  flex: 1;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}
th,
td {
  padding: 7px 10px;
  overflow: hidden;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
th:first-child,
td:first-child {
  width: 42%;
  border-right: 1px solid var(--console-border, #e4dcce);
}
th:last-child {
  background: color-mix(
    in srgb,
    var(--console-paper-soft, #faf5ec) 76%,
    var(--console-border, #e4dcce)
  );
}
td:last-child {
  background: color-mix(
    in srgb,
    var(--console-paper-soft, #faf5ec) 58%,
    var(--console-paper, #fffdfa)
  );
  color: var(--console-text, #211d17);
  font-weight: 520;
}
th {
  position: sticky;
  z-index: 1;
  top: 0;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-soft, #5a5247);
  font-size: 11px;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover,
tbody tr.selected {
  background: var(--console-accent-soft, #f8e9df);
}
tbody tr:hover td:last-child,
tbody tr.selected td:last-child {
  background: color-mix(
    in srgb,
    var(--console-accent-soft, #f8e9df) 72%,
    var(--console-paper-soft, #faf5ec)
  );
}
tbody tr.readonly {
  color: var(--console-text-muted, #756b5e);
}
tbody tr:focus-visible {
  position: relative;
  outline: 2px solid var(--console-accent, #be5630);
  outline-offset: -2px;
}
.parameter-name-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}
.parameter-name-cell > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-key-tag {
  min-width: 0;
  max-width: 48%;
  flex: 0 1 auto;
  animation: none;
  transition: none;
}
.parameter-key-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.parameter-value-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.parameter-value-cell > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-row-edit {
  flex: 0 0 auto;
  visibility: hidden;
  color: #2f80ed;
  font-weight: 700;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.parameter-row-edit:hover,
.parameter-row-edit:focus-visible {
  color: #1769d2;
}
tbody tr:hover .parameter-row-edit,
tbody tr:focus-within .parameter-row-edit {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
}
td small {
  display: block;
  color: var(--console-text-muted, #756b5e);
  font-size: 9px;
  line-height: 1.2;
}
.parameter-empty {
  flex: 1;
  display: grid;
  min-height: 220px;
  place-items: center;
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
}
.parameter-detail {
  flex: 0 0 auto;
  min-height: 64px;
  padding: 10px;
  border-top: 1px solid var(--console-border, #e4dcce);
  background: var(--console-paper-soft, #faf5ec);
}
.parameter-detail p {
  margin: 0;
  color: var(--console-text-soft, #5a5247);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.parameter-error {
  margin: 0;
  padding: 9px 10px;
  border-top: 1px solid var(--app-danger);
  color: var(--app-danger);
  font-size: 11px;
}
@media (max-width: 820px) {
  :global(.plugin-parameter-dialog .el-dialog__body) {
    overflow: auto;
  }
  .plugin-parameters {
    min-height: 420px;
  }
}
</style>
