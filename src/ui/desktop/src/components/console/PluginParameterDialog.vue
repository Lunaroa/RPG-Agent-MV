<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { TableInstance } from 'element-plus';
import { ArrowRight, WarningFilled } from '@element-plus/icons-vue';
import {
  type EditorProjectCatalog,
  type ManagedPluginEntry,
  type PluginParameterSchemaField,
} from '../../api/client';
import { useI18n } from '../../i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  normalizePluginParameterMainColumns,
} from '../../utils/pluginParameterTableColumns';
import { formatPluginParameterTypeLabel, pluginParameterTypeLabelIsList, pluginParameterTypeStructParts, stripPluginParameterTypeListBrackets } from '../../utils/pluginParameterTypeLabel';
import {
  buildPluginParameterPayload,
  buildPluginParameterRows,
  clonePluginParameterValue,
  createPluginParameterForm,
  isBooleanParameterEnabled,
  isTaggedPluginParameterValue,
  pluginParameterPayloadsEqual,
  resolvePluginParameterSelectPresentation,
  type PluginParameterRow,
  type PluginParameterSummaryLabels,
} from './plugin-parameter-model';
import {
  buildPluginParameterTree,
  collectPluginParameterExpandableKeys,
  flattenPluginParameterTree,
  type VisiblePluginParameterTreeRow,
} from './plugin-parameter-tree-model';
import PluginParameterValueDialog from './PluginParameterValueDialog.vue';
import PluginParameterValueDecor from '../editor/PluginParameterValueDecor.vue';

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
  'catalog-changed': [];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const parameterForm = ref<Record<string, unknown>>({});
const baselinePayload = ref<Record<string, unknown>>({});
const selectedParameterKey = ref('');
const valueDialogOpen = ref(false);
const editingField = ref<PluginParameterSchemaField | null>(null);
const parameterTable = ref<HTMLElement | null>(null);
const parameterElTable = ref<TableInstance | null>(null);
const parameterQuery = ref('');
const expandedParameterKeys = ref<Set<string>>(new Set());

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const mainColumnWidths = computed(() =>
  normalizePluginParameterMainColumns(
    workspaceStore.settings.layout?.pluginParameterMainColumns,
  ),
);
const valueColumnWidth = computed(() => mainColumnWidths.value.value);
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
  () => selectedParameterKey.value,
  (key) => {
    const row = visibleParameterRows.value.find((item) => item.key === key);
    if (row) parameterElTable.value?.setCurrentRow(row);
  },
);

watch(
  () => parameterQuery.value,
  () => {
    if (!selectedParameterKey.value) return;
    if (!visibleParameterRows.value.some((row) => row.key === selectedParameterKey.value)) {
      selectedParameterKey.value = visibleParameterRows.value[0]?.key || '';
    }
  },
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
  if (!plugin) {
    expandedParameterKeys.value = new Set();
    parameterForm.value = {};
    baselinePayload.value = {};
    selectedParameterKey.value = '';
    return;
  }
  parameterForm.value = createPluginParameterForm(plugin);
  baselinePayload.value = clonePluginParameterValue(
    buildPluginParameterPayload(plugin, parameterForm.value),
  );
  expandedParameterKeys.value = collectPluginParameterExpandableKeys(
    buildPluginParameterTree(
      buildPluginParameterRows(
        plugin,
        parameterForm.value,
        props.catalog,
        summaryLabels.value,
        t('plugins.parameterReadonlyReason'),
      ),
    ),
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

function parameterTypeLabel(row: Pick<PluginParameterRow, 'field'>): string {
  return formatPluginParameterTypeLabel(row.field?.rawType, row.field?.kind, t);
}

function parameterTypeDisplay(row: Pick<PluginParameterRow, 'field'>): {
  isList: boolean;
  struct: { keyword: string; name: string } | null;
  text: string;
} {
  const full = parameterTypeLabel(row);
  const isList = pluginParameterTypeLabelIsList(full);
  const text = isList ? stripPluginParameterTypeListBrackets(full) : full;
  return {
    isList,
    struct: pluginParameterTypeStructParts(text),
    text,
  };
}

function selectPresentation(row: Pick<PluginParameterRow, 'field'> & { key?: string }): ReturnType<typeof resolvePluginParameterSelectPresentation> {
  if (!row.field || row.field.kind !== 'select') return null;
  const value = row.key != null ? parameterForm.value[row.key] : undefined;
  return resolvePluginParameterSelectPresentation(row.field, value);
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

function onParameterTableKeydown(event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('button, input, textarea, .el-switch, .el-select')) return;
  const index = visibleParameterRows.value.findIndex(
    (row) => row.key === selectedParameterKey.value,
  );
  if (index < 0) return;
  const row = visibleParameterRows.value[index];
  if (!row) return;
  parameterRowKeydown(event, row, index);
}

function parameterRowClassName({ row }: { row: VisiblePluginParameterTreeRow }): string {
  return [
    selectedParameterKey.value === row.key ? 'is-selected-parameter' : '',
    row.editable ? '' : 'is-readonly-parameter',
  ].filter(Boolean).join(' ');
}

function onMainHeaderDragEnd(
  newWidth: number,
  _oldWidth: number,
  column: { columnKey?: string; property?: string },
): void {
  const key = column.columnKey || column.property;
  if (key !== 'name' && key !== 'type' && key !== 'value') return;
  workspaceStore.patchLayout({
    pluginParameterMainColumns: normalizePluginParameterMainColumns({
      ...mainColumnWidths.value,
      [key]: newWidth,
    }),
  });
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
    const row = visibleParameterRows.value.find((item) => item.key === key);
    if (row) parameterElTable.value?.setCurrentRow(row);
    parameterTable.value
      ?.querySelector('.el-table__body tr.current-row')
      ?.scrollIntoView({ block: 'nearest' });
  });
}

async function focusInitialParameter(): Promise<void> {
  await nextTick();
  parameterTable.value?.focus({ preventScroll: true });
  const row = visibleParameterRows.value.find(
    (item) => item.key === selectedParameterKey.value,
  ) || visibleParameterRows.value[0];
  if (row) parameterElTable.value?.setCurrentRow(row);
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="plugin-parameter-dialog"
    data-ui-id="plugin-parameter-dialog"
    :title="t('plugins.parameterDialogTitle', { name: plugin?.name || '' })"
    width="min(1160px, calc(100vw - 48px))"
    top="3vh"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    :before-close="confirmClose"
    @opened="focusInitialParameter"
    @closed="emit('closed')"
  >
    <div v-if="plugin" class="parameter-dialog-body">
      <el-input
        v-if="parameterRows.length"
        v-model="parameterQuery"
        class="parameter-search"
        clearable
        size="small"
        :placeholder="t('plugins.parameterTreeSearchPlaceholder')"
        :aria-label="t('plugins.parameterTreeSearchPlaceholder')"
      />
      <section class="plugin-parameters">
        <div
          v-if="parameterRows.length"
          ref="parameterTable"
          class="parameter-table-wrap"
          tabindex="0"
          @keydown="onParameterTableKeydown"
        >
          <el-table
            v-if="visibleParameterRows.length"
            ref="parameterElTable"
            :data="visibleParameterRows"
            border
            height="100%"
            row-key="key"
            highlight-current-row
            class="parameter-el-table"
            :row-class-name="parameterRowClassName"
            @row-click="(row: VisiblePluginParameterTreeRow) => selectParameter(row.key)"
            @row-dblclick="(row: VisiblePluginParameterTreeRow) => openParameterEditor(row.key)"
            @header-dragend="onMainHeaderDragEnd"
          >
            <el-table-column
              column-key="name"
              :label="t('plugins.parameterNameColumn')"
              :width="mainColumnWidths.name"
              resizable
            >
              <template #default="{ row }">
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
              </template>
            </el-table-column>
            <el-table-column
              column-key="type"
              :label="t('plugins.parameterTypeColumn')"
              :width="mainColumnWidths.type"
              resizable
              class-name="parameter-type-cell"
            >
              <template #default="{ row }">
                <div
                  class="parameter-type-text"
                  :title="parameterTypeLabel(row)"
                >
                  <el-tag
                    v-if="parameterTypeDisplay(row).isList"
                    size="small"
                    effect="plain"
                    class="parameter-list-tag"
                  >
                    {{ t('plugins.parameterTypeListTag') }}
                  </el-tag>
                  <template v-if="parameterTypeDisplay(row).struct">
                    <el-tag
                      size="small"
                      effect="plain"
                      class="parameter-struct-tag"
                    >
                      {{ parameterTypeDisplay(row).struct!.keyword }}
                    </el-tag>
                    <span>{{ parameterTypeDisplay(row).struct!.name }}</span>
                  </template>
                  <span v-else>{{ parameterTypeDisplay(row).text }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              column-key="value"
              :label="t('plugins.parameterValueColumn')"
              :width="valueColumnWidth"
              :min-width="valueColumnWidth ? undefined : 160"
              resizable
              class-name="parameter-value-column"
            >
              <template #default="{ row }">
                <div
                  class="parameter-value-cell"
                  :class="{ numeric: row.field?.kind === 'number' }"
                  :title="row.field?.kind === 'boolean' ? undefined : row.fullValue"
                >
                  <el-switch
                    v-if="row.field?.kind === 'boolean'"
                    :model-value="isBooleanParameterEnabled(
                      row.editable ? parameterForm[row.key] : row.fullValue,
                    )"
                    disabled
                    class="parameter-boolean-switch"
                    :aria-label="row.label"
                    @click.stop
                    @dblclick.stop
                  />
                  <span
                    v-else-if="row.field?.kind === 'select' && selectPresentation(row)"
                    class="parameter-select-value"
                  >
                    <span>{{ selectPresentation(row)!.label }}</span>
                    <el-tag
                      size="small"
                      effect="plain"
                      class="parameter-key-tag"
                    >
                      {{ selectPresentation(row)!.value }}
                    </el-tag>
                  </span>
                  <template v-else>
                    <PluginParameterValueDecor
                      v-if="row.field"
                      :field="row.field"
                      :value="parameterForm[row.key]"
                      :catalog="catalog"
                    />
                    <el-tag
                      v-if="isTaggedPluginParameterValue(row.field)"
                      size="small"
                      effect="plain"
                      class="parameter-value-tag"
                    >
                      {{ row.summary }}
                    </el-tag>
                    <span v-else>{{ row.summary }}</span>
                  </template>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="parameter-empty compact">
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
    @catalog-changed="emit('catalog-changed')"
  />
</template>

<style scoped>
:global(.plugin-parameter-dialog) {
  display: flex;
  height: min(860px, 94vh);
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
  flex: 1 1 auto;
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
  display: flex;
  width: 100%;
  max-width: 100%;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  overflow-x: hidden;
}
.parameter-search {
  flex: 0 0 auto;
  max-width: 360px;
  margin-left: auto;
}
.plugin-parameters {
  min-height: 0;
  display: flex;
  width: 100%;
  max-width: 100%;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 10px;
  background: var(--console-paper, #fffdfa);
}
.parameter-table-wrap {
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  outline: none;
}
.parameter-table-wrap:focus-visible {
  box-shadow: inset 0 0 0 2px var(--console-accent, #be5630);
}
.parameter-el-table {
  --el-table-border-color: var(--console-border, #e4dcce);
  --el-table-header-bg-color: var(--console-paper-soft, #faf5ec);
  --el-table-row-hover-bg-color: var(--console-accent-soft, #f8e9df);
  --el-table-current-row-bg-color: var(--console-accent-soft, #f8e9df);
  height: 100%;
  font-size: 12px;
  background: transparent;
}
.parameter-el-table :deep(.el-table__header th.el-table__cell) {
  color: var(--console-text-soft, #5a5247);
  font-size: 11px;
  font-weight: 600;
}
.parameter-el-table :deep(.el-table__body td.el-table__cell) {
  padding: 4px 0;
}
.parameter-el-table :deep(.el-table__body td.el-table__cell .cell) {
  line-height: 22px;
}
.parameter-el-table :deep(.el-table__row) {
  cursor: pointer;
}
.parameter-el-table :deep(.el-table__row.is-readonly-parameter) {
  color: var(--console-text-muted, #756b5e);
}
.parameter-el-table :deep(.parameter-type-cell .cell) {
  color: var(--console-text-soft, #5a5247);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-size: 11px;
}
.parameter-type-text {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.parameter-type-text > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-list-tag {
  flex: 0 0 auto;
  animation: none;
  transition: none;
}
.parameter-struct-tag {
  flex: 0 0 auto;
  color: #2563eb;
  border-color: color-mix(in srgb, #2563eb 35%, var(--console-border, #e4dcce));
  background: color-mix(in srgb, #2563eb 10%, var(--console-paper, #fffdfa));
  animation: none;
  transition: none;
}
.parameter-value-tag {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
  color: var(--console-accent, #be5630);
  background: color-mix(in srgb, var(--console-accent, #be5630) 10%, transparent);
  border-color: color-mix(in srgb, var(--console-accent, #be5630) 32%, transparent);
  animation: none;
  transition: none;
}
.parameter-value-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
  color: var(--console-accent, #be5630);
}
.parameter-select-value {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.parameter-select-value > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-el-table :deep(.el-table__body tr:hover > td.parameter-value-column),
.parameter-el-table :deep(.el-table__body tr.current-row > td.parameter-value-column) {
  background: color-mix(
    in srgb,
    var(--console-accent-soft, #f8e9df) 72%,
    var(--console-paper-soft, #faf5ec)
  );
}
.parameter-name-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.parameter-tree-toggle,
.parameter-tree-spacer {
  width: 18px;
  height: 22px;
  flex: 0 0 18px;
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
  font-weight: 400;
  color: var(--console-accent, #be5630);
  background: color-mix(in srgb, var(--console-accent, #be5630) 10%, transparent);
  border-color: color-mix(in srgb, var(--console-accent, #be5630) 32%, transparent);
  animation: none;
  transition: none;
}
.parameter-key-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
  color: var(--console-accent, #be5630);
}
.parameter-boolean-switch {
  flex: 0 0 auto;
  height: 20px;
}
.parameter-boolean-switch.is-disabled {
  opacity: 1;
}
.parameter-readonly-tag {
  flex: 0 0 auto;
  animation: none;
  transition: none;
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
.parameter-empty {
  flex: 1;
  display: grid;
  min-height: 160px;
  place-items: center;
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
}
.parameter-empty.compact {
  min-height: 120px;
}
.parameter-detail {
  flex: 0 0 auto;
  min-height: 56px;
  padding: 8px 10px;
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
@media (max-width: 980px) {
  :global(.plugin-parameter-dialog .el-dialog__body) {
    overflow: auto;
  }
  .parameter-search {
    max-width: none;
    margin-left: 0;
  }
  .plugin-parameters {
    min-height: 420px;
  }
}
</style>
