<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { ArrowRight, WarningFilled } from '@element-plus/icons-vue';
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
  type PluginParameterRow,
  type PluginParameterSummaryLabels,
} from './plugin-parameter-model';
import {
  buildPluginParameterTree,
  flattenPluginParameterTree,
  type VisiblePluginParameterTreeRow,
} from './plugin-parameter-tree-model';
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
const parameterQuery = ref('');
const expandedParameterKeys = ref<Set<string>>(new Set());

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
const parameterTree = computed(() => buildPluginParameterTree(parameterRows.value));
const visibleParameterRows = computed(() =>
  flattenPluginParameterTree(
    parameterTree.value,
    expandedParameterKeys.value,
    parameterQuery.value,
  ),
);
const selectedRow = computed(() =>
  parameterRows.value.find((row) => row.key === selectedParameterKey.value)
  || parameterRows.value[0]
  || null,
);
const selectedTreeNode = computed(() =>
  selectedParameterKey.value
    ? parameterTree.value.nodes.get(selectedParameterKey.value) || null
    : null,
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
  () => visibleParameterRows.value.map((row) => row.key).join('\u0000'),
  () => {
    if (!visibleParameterRows.value.some((row) => row.key === selectedParameterKey.value)) {
      selectedParameterKey.value = visibleParameterRows.value[0]?.key || '';
    }
  },
);

function resetEditor(): void {
  const plugin = props.plugin;
  valueDialogOpen.value = false;
  editingField.value = null;
  parameterQuery.value = '';
  expandedParameterKeys.value = new Set();
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

function displayReadonlyReason(row: PluginParameterRow): string {
  if (!props.plugin?.fileExists) return t('plugins.parameterMissingFileReadonly');
  if (String(row.field?.rawType || '').trim().toLowerCase() === 'image') {
    return t('plugins.parameterImageTypeUnsupported');
  }
  return t('plugins.parameterReadonlyReason');
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

function parameterRowKeydown(
  event: KeyboardEvent,
  row: VisiblePluginParameterTreeRow,
  index: number,
): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    selectedParameterKey.value = row.key;
    openSelectedParameterEditor();
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    selectedParameterKey.value = row.key;
    if (row.hasChildren && !row.expanded && !parameterQuery.value.trim()) {
      setParameterExpanded(row.key, true);
      return;
    }
    if (row.childKeys[0]) focusParameterRow(row.childKeys[0]);
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    selectedParameterKey.value = row.key;
    if (row.hasChildren && row.expanded && !parameterQuery.value.trim()) {
      setParameterExpanded(row.key, false);
      return;
    }
    if (row.parentKey) focusParameterRow(row.parentKey);
    return;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const nextIndex = Math.max(0, Math.min(
    visibleParameterRows.value.length - 1,
    index + (event.key === 'ArrowUp' ? -1 : 1),
  ));
  const next = visibleParameterRows.value[nextIndex];
  if (!next) return;
  focusParameterRow(next.key);
}

function toggleParameterExpanded(row: VisiblePluginParameterTreeRow): void {
  if (!row.hasChildren || parameterQuery.value.trim()) return;
  selectedParameterKey.value = row.key;
  setParameterExpanded(row.key, !row.expanded);
}

function setParameterExpanded(key: string, expanded: boolean): void {
  const next = new Set(expandedParameterKeys.value);
  if (expanded) next.add(key);
  else next.delete(key);
  expandedParameterKeys.value = next;
}

function focusParameterRow(key: string): void {
  selectedParameterKey.value = key;
  void nextTick(() => {
    parameterTable.value
      ?.querySelector<HTMLElement>(`[data-parameter-key="${CSS.escape(key)}"]`)
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
        <div class="parameter-section-header">
          <h3>{{ t('plugins.parameters') }}</h3>
          <el-input
            v-if="parameterRows.length"
            v-model="parameterQuery"
            clearable
            size="small"
            :placeholder="t('plugins.parameterTreeSearchPlaceholder')"
            :aria-label="t('plugins.parameterTreeSearchPlaceholder')"
          />
        </div>
        <div v-if="parameterRows.length" ref="parameterTable" class="parameter-table-wrap">
          <table role="treegrid">
            <thead>
              <tr>
                <th scope="col">{{ t('plugins.parameterNameColumn') }}</th>
                <th scope="col">{{ t('plugins.parameterValueColumn') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in visibleParameterRows"
                :key="row.key"
                :data-parameter-key="row.key"
                :class="{ selected: selectedRow?.key === row.key, readonly: !row.editable }"
                tabindex="0"
                :aria-selected="selectedRow?.key === row.key"
                :aria-level="row.depth + 1"
                :aria-expanded="row.hasChildren ? row.expanded : undefined"
                @click="selectParameter(row.key)"
                @dblclick="openParameterEditor(row.key)"
                @keydown="parameterRowKeydown($event, row, index)"
              >
                <td>
                  <div
                    class="parameter-name-cell"
                    :style="{ paddingInlineStart: `${row.depth * 18}px` }"
                  >
                    <el-button
                      v-if="row.hasChildren"
                      class="parameter-tree-toggle"
                      link
                      :aria-label="row.expanded
                        ? t('plugins.parameterCollapseGroup', { name: row.label })
                        : t('plugins.parameterExpandGroup', { name: row.label })"
                      :aria-expanded="row.expanded"
                      :disabled="Boolean(parameterQuery.trim())"
                      @click.stop="toggleParameterExpanded(row)"
                      @dblclick.stop
                    >
                      <el-icon :class="{ expanded: row.expanded }">
                        <ArrowRight />
                      </el-icon>
                    </el-button>
                    <span v-else class="parameter-tree-spacer" aria-hidden="true" />
                    <el-icon
                      v-if="row.hierarchyIssue"
                      class="parameter-hierarchy-warning"
                      :title="t('plugins.parameterHierarchyWarning')"
                      :aria-label="t('plugins.parameterHierarchyWarning')"
                      role="img"
                    >
                      <WarningFilled />
                    </el-icon>
                    <span>{{ row.label }}</span>
                    <el-tag
                      size="small"
                      type="info"
                      effect="plain"
                      class="parameter-key-tag"
                    >
                      {{ row.key }}
                    </el-tag>
                    <el-tag
                      v-if="!row.editable"
                      size="small"
                      type="warning"
                      effect="plain"
                      class="parameter-readonly-tag"
                    >
                      {{ t('plugins.parameterReadonly') }}
                    </el-tag>
                  </div>
                </td>
                <td
                  :class="{ numeric: row.field?.kind === 'number' }"
                  :title="row.fullValue"
                >
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
          <div v-if="!visibleParameterRows.length" class="parameter-empty compact">
            {{ t('plugins.parameterTreeNoMatch') }}
          </div>
        </div>
        <div v-else class="parameter-empty">{{ t('plugins.noParameters') }}</div>

        <div v-if="selectedRow" class="parameter-detail" aria-live="polite">
          <p v-if="selectedRow.description">{{ selectedRow.description }}</p>
          <p v-if="selectedRow.readonlyReason" class="parameter-readonly-message">
            {{ displayReadonlyReason(selectedRow) }}
          </p>
          <p
            v-if="selectedTreeNode?.issue"
            class="parameter-hierarchy-message"
            role="status"
          >
            {{
              selectedTreeNode.issue.kind === 'missing-parent'
                ? t('plugins.parameterMissingParent', {
                    name: selectedTreeNode.issue.parentKey,
                  })
                : t('plugins.parameterCircularParent', {
                    name: selectedTreeNode.issue.parentKey,
                  })
            }}
          </p>
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
.parameter-section-header {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 12px;
  padding: 6px 10px 6px 0;
  border-bottom: 1px solid var(--console-border, #e4dcce);
}
.parameter-section-header h3 {
  min-width: 110px;
  flex: 0 0 auto;
  border-bottom: 0;
}
.parameter-section-header :deep(.el-input) {
  max-width: 280px;
  margin-left: auto;
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
  height: 40px;
  box-sizing: border-box;
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
td.numeric {
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-variant-numeric: tabular-nums;
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
  height: 40px;
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
.parameter-tree-toggle,
.parameter-tree-spacer {
  width: 20px;
  height: 28px;
  flex: 0 0 20px;
}
.parameter-tree-toggle {
  padding: 0;
  color: var(--console-text-muted, #756b5e);
}
.parameter-tree-toggle :deep(.el-icon) {
  transition: transform 120ms ease;
}
.parameter-tree-toggle :deep(.el-icon.expanded) {
  transform: rotate(90deg);
}
.parameter-tree-toggle:disabled {
  opacity: 0.55;
}
.parameter-hierarchy-warning {
  flex: 0 0 auto;
  color: var(--console-warning, #a96814);
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
.parameter-readonly-tag {
  flex: 0 0 auto;
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
.parameter-empty {
  flex: 1;
  display: grid;
  min-height: 220px;
  place-items: center;
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
}
.parameter-empty.compact {
  min-height: 180px;
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
.parameter-readonly-message {
  color: var(--console-warning, #8a560f) !important;
}
.parameter-detail .parameter-hierarchy-message {
  margin-top: 6px;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--console-warning, #a96814) 34%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--console-warning, #a96814) 8%, transparent);
  color: var(--console-warning, #8a560f);
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
