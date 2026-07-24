<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { TableInstance } from 'element-plus';
import { ArrowRight, WarningFilled } from '@element-plus/icons-vue';
import type {
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import { clipboard } from '../../api/client';
import { useI18n } from '../../i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  normalizePluginParameterCollectionColumns,
  normalizePluginParameterMainColumns,
} from '../../utils/pluginParameterTableColumns';
import {
  formatPluginParameterTypeLabel,
  pluginParameterTypeLabelIsList,
  pluginParameterTypeStructParts,
  stripPluginParameterTypeListBrackets,
} from '../../utils/pluginParameterTypeLabel';
import PluginParameterValueDecor from '../editor/PluginParameterValueDecor.vue';
import {
  buildPluginParameterCollectionColumns,
  buildPluginParameterCollectionRows,
  buildSelectedPluginParameterRawArray,
  filterPluginParameterCollectionRows,
  movePluginParameterArrayItem,
  removePluginParameterArrayItems,
} from './plugin-parameter-collection-model';
import {
  clonePluginParameterValue,
  isBooleanParameterEnabled,
  isPluginParameterSchemaFieldEditable,
  isTaggedPluginParameterValue,
  resolvePluginParameterSelectPresentation,
  summarizePluginParameterValue,
  type PluginParameterChildTarget,
  type PluginParameterRow,
  type PluginParameterSummaryLabels,
} from './plugin-parameter-model';
import {
  buildPluginParameterTree,
  collectPluginParameterExpandableKeys,
  flattenPluginParameterTree,
  type VisiblePluginParameterTreeRow,
} from './plugin-parameter-tree-model';

const props = defineProps<{
  field: PluginParameterSchemaField;
  modelValue: unknown;
  catalog: EditorProjectCatalog | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
  edit: [payload: {
    field: PluginParameterSchemaField;
    value: unknown;
    target: PluginParameterChildTarget;
    label: string;
  }];
  add: [];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const collectionTable = ref<HTMLElement | null>(null);
const structElTable = ref<TableInstance | null>(null);
const arrayElTable = ref<TableInstance | null>(null);
const selectedRowIds = ref<string[]>([]);
const activeRowId = ref('');
const rowIds = ref<string[]>([]);
const draggedIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);
const expandedStructKeys = ref<Set<string>>(new Set());
const activeStructKey = ref('');
let rowSerial = 0;
let pointerDragId: number | null = null;

const mainColumnWidths = computed(() =>
  normalizePluginParameterMainColumns(
    workspaceStore.settings.layout?.pluginParameterMainColumns,
  ),
);
const valueColumnWidth = computed(() => mainColumnWidths.value.value);
const collectionColumnWidths = computed(() =>
  normalizePluginParameterCollectionColumns(
    workspaceStore.settings.layout?.pluginParameterCollectionColumns,
  ),
);
const summaryLabels = computed<PluginParameterSummaryLabels>(() => ({
  enabled: t('plugins.parameterEnabled'),
  disabled: t('plugins.parameterDisabled'),
  empty: t('plugins.parameterEmptyValue'),
  itemCount: (count: number) => t('plugins.parameterItemCount', { count }),
  structuredValue: t('plugins.parameterStructuredValue'),
  location: (map: string, x: number, y: number) =>
    t('plugins.parameterLocationValue', { map, x, y }),
}));
const isArray = computed(() => props.field.kind === 'array');
const entries = computed<unknown[]>(() =>
  isArray.value && Array.isArray(props.modelValue) ? props.modelValue : [],
);
const columns = computed(() => buildPluginParameterCollectionColumns(props.field));
const sourceRows = computed(() =>
  buildPluginParameterCollectionRows(
    props.field,
    entries.value,
    props.catalog,
    summaryLabels.value,
  ).map((row) => ({
    ...row,
    id: rowIds.value[row.index] || `pending:${row.index}`,
  })),
);
const visibleRows = computed(() =>
  filterPluginParameterCollectionRows(sourceRows.value, query.value),
);
const structFields = computed(() =>
  props.field.kind === 'struct' ? props.field.fields || [] : [],
);
const structRows = computed<PluginParameterRow[]>(() =>
  structFields.value.map((field) => {
    const value = structSource()[field.key];
    const editable = isPluginParameterSchemaFieldEditable(field);
    return {
      key: field.key,
      label: field.label || field.key,
      description: field.description || '',
      field,
      editable,
      readonlyReason: editable
        ? ''
        : field.unsupportedReason || t('plugins.parameterReadonlyReason'),
      summary: valueSummary(field, value),
      fullValue: displayValue(value),
    };
  }),
);
const structTree = computed(() => buildPluginParameterTree(structRows.value));
const visibleStructRows = computed(() =>
  flattenPluginParameterTree(structTree.value, expandedStructKeys.value, query.value),
);
const activeStructRow = computed(() =>
  structRows.value.find((row) => row.key === activeStructKey.value)
  || visibleStructRows.value[0]
  || null,
);
const activeStructNode = computed(() =>
  activeStructKey.value
    ? structTree.value.nodes.get(activeStructKey.value) || null
    : null,
);
const selectedIndexes = computed(() => {
  const selected = new Set(selectedRowIds.value);
  return sourceRows.value
    .filter((row) => selected.has(row.id))
    .map((row) => row.index);
});
const allVisibleSelected = computed(() =>
  visibleRows.value.length > 0
  && visibleRows.value.every((row) => selectedRowIds.value.includes(row.id)),
);
const someVisibleSelected = computed(() =>
  !allVisibleSelected.value
  && visibleRows.value.some((row) => selectedRowIds.value.includes(row.id)),
);
const sortingLocked = computed(() => Boolean(query.value.trim()));
const arrayItem = computed(() =>
  props.field.kind === 'array' ? props.field.item : undefined,
);
const query = ref('');

watch(
  () => entries.value.length,
  (length) => {
    while (rowIds.value.length < length) rowIds.value.push(createRowId());
    if (rowIds.value.length > length) rowIds.value.splice(length);
    selectedRowIds.value = selectedRowIds.value.filter((id) => rowIds.value.includes(id));
    if (activeRowId.value && !rowIds.value.includes(activeRowId.value)) {
      activeRowId.value = rowIds.value[0] || '';
    }
  },
  { immediate: true },
);

watch(query, () => {
  selectedRowIds.value = [];
});

watch(
  () => props.field.key,
  () => {
    query.value = '';
    activeStructKey.value = '';
    nextTick(() => {
      expandedStructKeys.value = collectPluginParameterExpandableKeys(structTree.value);
    });
  },
  { immediate: true },
);

watch(
  () => visibleStructRows.value.map((row) => row.key).join('\u0000'),
  () => {
    if (!visibleStructRows.value.some((row) => row.key === activeStructKey.value)) {
      activeStructKey.value = visibleStructRows.value[0]?.key || '';
    }
  },
  { immediate: true },
);

watch(
  () => activeStructKey.value,
  (key) => {
    const row = visibleStructRows.value.find((item) => item.key === key);
    if (row) structElTable.value?.setCurrentRow(row);
  },
);

watch(
  () => activeRowId.value,
  (id) => {
    const row = visibleRows.value.find((item) => item.id === id);
    if (row) arrayElTable.value?.setCurrentRow(row);
  },
);

onBeforeUnmount(() => {
  clearPointerDragListeners();
  clearDrag();
});

function collectionColumnWidth(key: string, fallback?: number): number | undefined {
  const width = collectionColumnWidths.value[key];
  return width ?? fallback;
}

function createRowId(): string {
  rowSerial += 1;
  return `parameter-row-${rowSerial}`;
}

function structSource(): Record<string, unknown> {
  return isRecord(props.modelValue) ? props.modelValue : {};
}

function cellValue(rowValue: unknown, column: PluginParameterSchemaField): unknown {
  return isRecord(rowValue) ? rowValue[column.key] : undefined;
}

function cellSummary(rowValue: unknown, column: PluginParameterSchemaField): string {
  return summarizePluginParameterValue(
    column,
    cellValue(rowValue, column),
    props.catalog,
    summaryLabels.value,
  );
}

function valueSummary(field: PluginParameterSchemaField, value: unknown): string {
  return summarizePluginParameterValue(field, value, props.catalog, summaryLabels.value);
}

function displayStructReadonlyReason(row: PluginParameterRow): string {
  return String(row.field?.rawType || '').trim().toLowerCase() === 'image'
    ? t('plugins.parameterImageTypeUnsupported')
    : t('plugins.parameterReadonlyReason');
}

function structTypeLabel(row: Pick<PluginParameterRow, 'field'>): string {
  return formatPluginParameterTypeLabel(row.field?.rawType, row.field?.kind, t);
}

function structTypeDisplay(row: Pick<PluginParameterRow, 'field'>): {
  isList: boolean;
  struct: { keyword: string; name: string } | null;
  text: string;
} {
  const full = structTypeLabel(row);
  const isList = pluginParameterTypeLabelIsList(full);
  const text = isList ? stripPluginParameterTypeListBrackets(full) : full;
  return {
    isList,
    struct: pluginParameterTypeStructParts(text),
    text,
  };
}

function selectPresentationFor(
  field: PluginParameterSchemaField | null | undefined,
  value: unknown,
): ReturnType<typeof resolvePluginParameterSelectPresentation> {
  return resolvePluginParameterSelectPresentation(field, value);
}

function editStructField(field: PluginParameterSchemaField): void {
  if (!isPluginParameterSchemaFieldEditable(field)) return;
  emit('edit', {
    field,
    value: structSource()[field.key],
    target: { kind: 'struct', key: field.key },
    label: field.label || field.key,
  });
}

function editStructRow(row: PluginParameterRow): void {
  if (row.field) editStructField(row.field);
}

function toggleStructExpanded(row: VisiblePluginParameterTreeRow): void {
  if (!row.hasChildren || query.value.trim()) return;
  activeStructKey.value = row.key;
  setStructExpanded(row.key, !row.expanded);
}

function setStructExpanded(key: string, expanded: boolean): void {
  const next = new Set(expandedStructKeys.value);
  if (expanded) next.add(key);
  else next.delete(key);
  expandedStructKeys.value = next;
}

function structRowKeydown(
  event: KeyboardEvent,
  row: VisiblePluginParameterTreeRow,
  index: number,
): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    activeStructKey.value = row.key;
    editStructRow(row);
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    activeStructKey.value = row.key;
    if (row.hasChildren && !row.expanded && !query.value.trim()) {
      setStructExpanded(row.key, true);
      return;
    }
    if (row.childKeys[0]) focusStructRow(row.childKeys[0]);
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    activeStructKey.value = row.key;
    if (row.hasChildren && row.expanded && !query.value.trim()) {
      setStructExpanded(row.key, false);
      return;
    }
    if (row.parentKey) focusStructRow(row.parentKey);
    return;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const next = visibleStructRows.value[Math.max(
    0,
    Math.min(visibleStructRows.value.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)),
  )];
  if (next) focusStructRow(next.key);
}

function onStructTableKeydown(event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('button, input, textarea, .el-switch, .el-select')) return;
  const index = visibleStructRows.value.findIndex(
    (row) => row.key === activeStructKey.value,
  );
  if (index < 0) return;
  const row = visibleStructRows.value[index];
  if (!row) return;
  structRowKeydown(event, row, index);
}

function structRowClassName({ row }: { row: VisiblePluginParameterTreeRow }): string {
  return [
    activeStructKey.value === row.key ? 'is-selected-parameter' : '',
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

function onCollectionHeaderDragEnd(
  newWidth: number,
  _oldWidth: number,
  column: { columnKey?: string; property?: string },
): void {
  const key = column.columnKey || column.property;
  if (!key) return;
  workspaceStore.patchLayout({
    pluginParameterCollectionColumns: normalizePluginParameterCollectionColumns({
      ...collectionColumnWidths.value,
      [key]: newWidth,
    }),
  });
}

function focusStructRow(key: string): void {
  activeStructKey.value = key;
  void nextTick(() => {
    const row = visibleStructRows.value.find((item) => item.key === key);
    if (row) structElTable.value?.setCurrentRow(row);
    collectionTable.value
      ?.querySelector('.struct-el-table .el-table__body tr.current-row')
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function editArrayItem(index: number): void {
  if (!arrayItem.value || !isPluginParameterSchemaFieldEditable(arrayItem.value)) return;
  emit('edit', {
    field: arrayItem.value,
    value: entries.value[index],
    target: { kind: 'array', index },
    label: t('plugins.parameterArrayItem', { index: index + 1 }),
  });
}

function toggleRowSelection(id: string, selected: boolean): void {
  const next = new Set(selectedRowIds.value);
  selected ? next.add(id) : next.delete(id);
  selectedRowIds.value = [...next];
}

function toggleVisibleSelection(selected: boolean): void {
  const next = new Set(selectedRowIds.value);
  for (const row of visibleRows.value) {
    selected ? next.add(row.id) : next.delete(row.id);
  }
  selectedRowIds.value = [...next];
}

function clearSelection(): void {
  selectedRowIds.value = [];
}

async function copySelection(): Promise<void> {
  if (!selectedIndexes.value.length) return;
  const copied = buildSelectedPluginParameterRawArray(
    props.field,
    entries.value,
    selectedIndexes.value,
  );
  if (copied.overLimit) {
    ElMessage.error(t('plugins.parameterCopyTooLarge'));
    return;
  }
  try {
    await clipboard.writeText(copied.text);
    ElMessage.success(t('plugins.parameterCopySuccess', {
      count: selectedIndexes.value.length,
    }));
  } catch {
    ElMessage.error(t('plugins.parameterCopyFailed'));
  }
}

async function deleteSelection(): Promise<void> {
  if (!selectedIndexes.value.length) return;
  try {
    await ElMessageBox.confirm(
      t('plugins.parameterBatchDeleteConfirm', {
        count: selectedIndexes.value.length,
      }),
      t('plugins.parameterBatchDeleteTitle'),
      {
        type: 'warning',
        confirmButtonText: t('cmdList.delete'),
        cancelButtonText: t('editor.mapProperties.cancel'),
      },
    );
  } catch {
    return;
  }
  const removedIds = new Set(selectedRowIds.value);
  rowIds.value = rowIds.value.filter((id) => !removedIds.has(id));
  emit(
    'update:modelValue',
    removePluginParameterArrayItems(entries.value, selectedIndexes.value),
  );
  selectedRowIds.value = [];
}

function startPointerDrag(event: PointerEvent, index: number): void {
  if (sortingLocked.value || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget as HTMLElement | null;
  if (!handle) return;
  pointerDragId = event.pointerId;
  handle.setPointerCapture(event.pointerId);
  draggedIndex.value = index;
  dropIndex.value = index;
  window.addEventListener('pointermove', onPointerDragMove);
  window.addEventListener('pointerup', onPointerDragEnd);
  window.addEventListener('pointercancel', onPointerDragEnd);
}

function onPointerDragMove(event: PointerEvent): void {
  if (pointerDragId !== event.pointerId || draggedIndex.value === null) return;
  const index = resolveArrayRowIndexFromPoint(event.clientX, event.clientY);
  if (index === null) return;
  const rowEl = document.elementFromPoint(event.clientX, event.clientY)
    ?.closest?.('tr.el-table__row') as HTMLElement | null;
  if (!rowEl) return;
  dropIndex.value = event.clientY >= rowEl.getBoundingClientRect().top + rowEl.offsetHeight / 2
    ? index + 1
    : index;
}

function onPointerDragEnd(event: PointerEvent): void {
  if (pointerDragId !== null && event.pointerId !== pointerDragId) return;
  const from = draggedIndex.value;
  const rawTarget = dropIndex.value;
  clearPointerDragListeners();
  if (from === null || rawTarget === null) {
    clearDrag();
    return;
  }
  const to = Math.max(0, Math.min(entries.value.length - 1, rawTarget > from ? rawTarget - 1 : rawTarget));
  moveItem(from, to);
  clearDrag();
}

function clearPointerDragListeners(): void {
  window.removeEventListener('pointermove', onPointerDragMove);
  window.removeEventListener('pointerup', onPointerDragEnd);
  window.removeEventListener('pointercancel', onPointerDragEnd);
  pointerDragId = null;
}

function resolveArrayRowIndexFromPoint(clientX: number, clientY: number): number | null {
  const hit = document.elementFromPoint(clientX, clientY);
  const rowEl = hit?.closest?.('tr.el-table__row') as HTMLElement | null;
  if (!rowEl || !collectionTable.value?.contains(rowEl)) return null;
  const rowKey = rowEl.getAttribute('data-row-key');
  if (rowKey) {
    const byKey = visibleRows.value.find((item) => item.id === rowKey);
    if (byKey) return byKey.index;
  }
  const bodyRows = [...(rowEl.parentElement?.querySelectorAll('tr.el-table__row') || [])];
  const visualIndex = bodyRows.indexOf(rowEl);
  if (visualIndex < 0) return null;
  return visibleRows.value[visualIndex]?.index ?? null;
}

function clearDrag(): void {
  draggedIndex.value = null;
  dropIndex.value = null;
}

function moveItem(from: number, to: number): void {
  if (sortingLocked.value || from === to) return;
  emit('update:modelValue', movePluginParameterArrayItem(entries.value, from, to));
  rowIds.value = movePluginParameterArrayItem(rowIds.value, from, to) as string[];
  activeRowId.value = rowIds.value[to] || '';
}

function rowKeydown(event: KeyboardEvent, visibleIndex: number, sourceIndex: number): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    editArrayItem(sourceIndex);
    return;
  }
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    if (sortingLocked.value) {
      ElMessage.info(t('plugins.parameterClearSearchToReorder'));
      return;
    }
    moveItem(
      sourceIndex,
      Math.max(0, Math.min(entries.value.length - 1, sourceIndex + (event.key === 'ArrowUp' ? -1 : 1))),
    );
    return;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const target = visibleRows.value[Math.max(
    0,
    Math.min(visibleRows.value.length - 1, visibleIndex + (event.key === 'ArrowUp' ? -1 : 1)),
  )];
  if (!target) return;
  focusArrayRow(target.id);
}

function onArrayTableKeydown(event: KeyboardEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('button, input, textarea, .el-switch, .el-select, .el-checkbox')) return;
  const visibleIndex = visibleRows.value.findIndex((row) => row.id === activeRowId.value);
  if (visibleIndex < 0) return;
  const row = visibleRows.value[visibleIndex];
  if (!row) return;
  rowKeydown(event, visibleIndex, row.index);
}

function arrayRowClassName({ row }: { row: { id: string; index: number } }): string {
  return [
    activeRowId.value === row.id ? 'is-selected-array-row' : '',
    dropIndex.value === row.index ? 'drop-before' : '',
    row.index === entries.value.length - 1 && dropIndex.value === entries.value.length
      ? 'drop-after'
      : '',
  ].filter(Boolean).join(' ');
}

function focusArrayRow(id: string): void {
  activeRowId.value = id;
  void nextTick(() => {
    const row = visibleRows.value.find((item) => item.id === id);
    if (row) arrayElTable.value?.setCurrentRow(row);
    collectionTable.value
      ?.querySelector('.array-el-table .el-table__body tr.current-row')
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
</script>

<template>
  <section class="parameter-collection-editor">
    <template v-if="isArray">
      <div class="array-toolbar">
        <el-input
          v-model="query"
          clearable
          :placeholder="t('plugins.parameterSearchPlaceholder')"
          :aria-label="t('plugins.parameterSearchPlaceholder')"
        />
        <span class="selection-count" aria-live="polite">
          {{ t('plugins.parameterSelectedCount', { count: selectedRowIds.length }) }}
        </span>
        <el-button
          :disabled="!selectedRowIds.length"
          @click="copySelection"
        >
          {{ t('plugins.parameterCopySelected') }}
        </el-button>
        <el-button
          type="danger"
          plain
          :disabled="!selectedRowIds.length"
          @click="deleteSelection"
        >
          {{ t('plugins.parameterDeleteSelected') }}
        </el-button>
        <el-button
          v-if="arrayItem && isPluginParameterSchemaFieldEditable(arrayItem)"
          type="primary"
          @click="$emit('add')"
        >
          {{ t('plugins.addItem') }}
        </el-button>
      </div>
      <p v-if="sortingLocked" class="sorting-hint" role="status">
        {{ t('plugins.parameterClearSearchToReorder') }}
      </p>

      <div
        ref="collectionTable"
        class="collection-table-wrap"
        tabindex="0"
        @keydown="onArrayTableKeydown"
      >
        <el-table
          v-if="visibleRows.length"
          ref="arrayElTable"
          :data="visibleRows"
          border
          row-key="id"
          highlight-current-row
          class="parameter-el-table array-el-table"
          :row-class-name="arrayRowClassName"
          @row-click="(row) => activeRowId = row.id"
          @row-dblclick="(row) => editArrayItem(row.index)"
          @header-dragend="onCollectionHeaderDragEnd"
        >
          <el-table-column
            column-key="select"
            :width="collectionColumnWidth('select', 42)"
            resizable
            class-name="select-column"
          >
            <template #header>
              <el-checkbox
                :model-value="allVisibleSelected"
                :indeterminate="someVisibleSelected"
                :aria-label="t('plugins.parameterSelectVisible')"
                @change="toggleVisibleSelection(Boolean($event))"
              />
            </template>
            <template #default="{ row }">
              <el-checkbox
                :model-value="selectedRowIds.includes(row.id)"
                :aria-label="t('plugins.parameterSelectItem', { index: row.index + 1 })"
                @click.stop
                @dblclick.stop
                @change="toggleRowSelection(row.id, Boolean($event))"
              />
            </template>
          </el-table-column>
          <el-table-column
            column-key="order"
            :width="collectionColumnWidth('order', 42)"
            resizable
            class-name="drag-column"
          >
            <template #header>
              <span class="visually-hidden">{{ t('plugins.parameterOrderColumn') }}</span>
            </template>
            <template #default="{ row }">
              <span
                class="drag-handle"
                :class="{ locked: sortingLocked, dragging: draggedIndex === row.index }"
                :title="sortingLocked
                  ? t('plugins.parameterClearSearchToReorder')
                  : t('plugins.parameterDragToReorder')"
                :aria-label="t('plugins.parameterDragToReorder')"
                @pointerdown="startPointerDrag($event, row.index)"
                @dblclick.stop
              >
                <svg viewBox="0 0 12 18" aria-hidden="true">
                  <circle cx="3" cy="4" r="1.5" />
                  <circle cx="9" cy="4" r="1.5" />
                  <circle cx="3" cy="9" r="1.5" />
                  <circle cx="9" cy="9" r="1.5" />
                  <circle cx="3" cy="14" r="1.5" />
                  <circle cx="9" cy="14" r="1.5" />
                </svg>
              </span>
            </template>
          </el-table-column>
          <template v-if="columns.length">
            <el-table-column
              v-for="column in columns"
              :key="column.key"
              :column-key="column.key"
              :width="collectionColumnWidth(column.key)"
              :min-width="collectionColumnWidth(column.key) ? undefined : 120"
              resizable
              :class-name="[
                column.field.kind === 'number' ? 'numeric' : '',
                column.field.kind === 'struct' || column.field.kind === 'array' ? 'compound' : '',
              ].filter(Boolean).join(' ')"
            >
              <template #header>
                <span>{{ column.label }}</span>
                <small>{{ column.key }}</small>
              </template>
              <template #default="{ row }">
                <div
                  class="parameter-value-cell"
                  :title="cellSummary(row.value, column.field)"
                >
                  <el-switch
                    v-if="column.field.kind === 'boolean'"
                    :model-value="isBooleanParameterEnabled(cellValue(row.value, column.field))"
                    disabled
                    class="parameter-boolean-switch"
                    :aria-label="column.label"
                    @click.stop
                    @dblclick.stop
                  />
                  <template v-else-if="column.field.kind === 'select' && selectPresentationFor(column.field, cellValue(row.value, column.field))">
                    <span class="parameter-select-value">
                      <span>{{ selectPresentationFor(column.field, cellValue(row.value, column.field))!.label }}</span>
                      <el-tag size="small" effect="plain" class="parameter-key-tag">
                        {{ selectPresentationFor(column.field, cellValue(row.value, column.field))!.value }}
                      </el-tag>
                    </span>
                  </template>
                  <template v-else>
                    <PluginParameterValueDecor
                      :field="column.field"
                      :value="cellValue(row.value, column.field)"
                      :catalog="catalog"
                    />
                    <el-tag
                      v-if="isTaggedPluginParameterValue(column.field)"
                      size="small"
                      effect="plain"
                      class="parameter-value-tag"
                    >
                      {{ cellSummary(row.value, column.field) }}
                    </el-tag>
                    <span v-else>{{ cellSummary(row.value, column.field) }}</span>
                  </template>
                </div>
              </template>
            </el-table-column>
          </template>
          <el-table-column
            v-else
            column-key="value"
            :label="t('plugins.parameterValueColumn')"
            :width="collectionColumnWidth('value')"
            :min-width="collectionColumnWidth('value') ? undefined : 160"
            resizable
            class-name="parameter-value-column"
          >
            <template #default="{ row }">
              <div
                class="parameter-value-cell"
                :title="arrayItem ? valueSummary(arrayItem, row.value) : ''"
              >
                <el-switch
                  v-if="arrayItem?.kind === 'boolean'"
                  :model-value="isBooleanParameterEnabled(row.value)"
                  disabled
                  class="parameter-boolean-switch"
                  :aria-label="t('plugins.parameterArrayItem', { index: row.index + 1 })"
                  @click.stop
                  @dblclick.stop
                />
                <template v-else-if="arrayItem?.kind === 'select' && selectPresentationFor(arrayItem, row.value)">
                  <span class="parameter-select-value">
                    <span>{{ selectPresentationFor(arrayItem, row.value)!.label }}</span>
                    <el-tag size="small" effect="plain" class="parameter-key-tag">
                      {{ selectPresentationFor(arrayItem, row.value)!.value }}
                    </el-tag>
                  </span>
                </template>
                <template v-else-if="arrayItem">
                  <PluginParameterValueDecor
                    :field="arrayItem"
                    :value="row.value"
                    :catalog="catalog"
                  />
                  <el-tag
                    v-if="isTaggedPluginParameterValue(arrayItem)"
                    size="small"
                    effect="plain"
                    class="parameter-value-tag"
                  >
                    {{ valueSummary(arrayItem, row.value) }}
                  </el-tag>
                  <span v-else>{{ valueSummary(arrayItem, row.value) }}</span>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="collection-empty">
          {{ entries.length ? t('plugins.noMatch') : t('plugins.arrayEmpty') }}
        </div>
      </div>
      <el-button
        v-if="selectedRowIds.length"
        class="clear-selection"
        link
        @click="clearSelection"
      >
        {{ t('plugins.parameterClearSelection') }}
      </el-button>
    </template>

    <template v-else>
      <div class="array-toolbar struct-toolbar">
        <el-input
          v-model="query"
          clearable
          :placeholder="t('plugins.parameterTreeSearchPlaceholder')"
          :aria-label="t('plugins.parameterTreeSearchPlaceholder')"
        />
      </div>
      <div
        ref="collectionTable"
        class="collection-table-wrap struct-table-wrap"
        tabindex="0"
        @keydown="onStructTableKeydown"
      >
        <el-table
          v-if="visibleStructRows.length"
          ref="structElTable"
          :data="visibleStructRows"
          border
          row-key="key"
          highlight-current-row
          class="parameter-el-table struct-el-table"
          :row-class-name="structRowClassName"
          @row-click="(row: VisiblePluginParameterTreeRow) => activeStructKey = row.key"
          @row-dblclick="(row: VisiblePluginParameterTreeRow) => editStructRow(row)"
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
                class="struct-name-cell"
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
                  :disabled="Boolean(query.trim())"
                  @click.stop="toggleStructExpanded(row)"
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
                <el-tag size="small" effect="plain" class="parameter-key-tag">{{ row.key }}</el-tag>
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
                :title="structTypeLabel(row)"
              >
                <el-tag
                  v-if="structTypeDisplay(row).isList"
                  size="small"
                  effect="plain"
                  class="parameter-list-tag"
                >
                  {{ t('plugins.parameterTypeListTag') }}
                </el-tag>
                <template v-if="structTypeDisplay(row).struct">
                  <el-tag
                    size="small"
                    effect="plain"
                    class="parameter-struct-tag"
                  >
                    {{ structTypeDisplay(row).struct!.keyword }}
                  </el-tag>
                  <span>{{ structTypeDisplay(row).struct!.name }}</span>
                </template>
                <span v-else>{{ structTypeDisplay(row).text }}</span>
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
                  :model-value="isBooleanParameterEnabled(structSource()[row.key])"
                  disabled
                  class="parameter-boolean-switch"
                  :aria-label="row.label"
                  @click.stop
                  @dblclick.stop
                />
                <span
                  v-else-if="row.field?.kind === 'select' && selectPresentationFor(row.field, structSource()[row.key])"
                  class="parameter-select-value"
                >
                  <span>{{ selectPresentationFor(row.field, structSource()[row.key])!.label }}</span>
                  <el-tag size="small" effect="plain" class="parameter-key-tag">
                    {{ selectPresentationFor(row.field, structSource()[row.key])!.value }}
                  </el-tag>
                </span>
                <template v-else>
                  <PluginParameterValueDecor
                    v-if="row.field"
                    :field="row.field"
                    :value="structSource()[row.key]"
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
        </el-table>
        <div v-else class="collection-empty">
          {{ structFields.length ? t('plugins.parameterTreeNoMatch') : t('plugins.noParameters') }}
        </div>
      </div>
      <div v-if="activeStructRow" class="struct-parameter-detail" aria-live="polite">
        <p v-if="activeStructRow.description">{{ activeStructRow.description }}</p>
        <p v-if="activeStructRow.readonlyReason" class="parameter-readonly-message">
          {{ displayStructReadonlyReason(activeStructRow) }}
        </p>
        <p v-if="activeStructNode?.issue" class="parameter-hierarchy-message" role="status">
          {{
            activeStructNode.issue.kind === 'missing-parent'
              ? t('plugins.parameterMissingParent', { name: activeStructNode.issue.parentKey })
              : t('plugins.parameterCircularParent', { name: activeStructNode.issue.parentKey })
          }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.parameter-collection-editor {
  min-height: 0;
  display: grid;
  gap: 8px;
}
.array-toolbar {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.array-toolbar :deep(.el-input) {
  min-width: 180px;
  flex: 1 1 260px;
}
.selection-count {
  flex: 0 0 auto;
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
  white-space: nowrap;
}
.sorting-hint {
  margin: 0;
  color: var(--console-warning, #a96814);
  font-size: 12px;
}
.collection-table-wrap {
  min-height: 0;
  max-height: 50vh;
  overflow: hidden;
  outline: none;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 8px;
  background: var(--console-paper, #fffdfa);
}
.collection-table-wrap:focus-visible {
  box-shadow: inset 0 0 0 2px var(--console-accent, #be5630);
}
.parameter-el-table {
  --el-table-border-color: var(--console-border, #e4dcce);
  --el-table-header-bg-color: var(--console-paper-soft, #faf5ec);
  --el-table-row-hover-bg-color: var(--console-accent-soft, #f8e9df);
  --el-table-current-row-bg-color: var(--console-accent-soft, #f8e9df);
  width: 100%;
  font-size: 12px;
  background: transparent;
}
.parameter-el-table :deep(.el-table__header th.el-table__cell) {
  color: var(--console-text-soft, #5a5247);
  font-size: 11px;
  font-weight: 600;
}
.parameter-el-table :deep(.el-table__header th small) {
  display: block;
  overflow: hidden;
  color: var(--console-text-muted, #756b5e);
  font-weight: 400;
  text-overflow: ellipsis;
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
.parameter-el-table :deep(.select-column .cell),
.parameter-el-table :deep(.drag-column .cell) {
  display: flex;
  justify-content: center;
  padding-inline: 0;
}
.parameter-el-table :deep(.el-table__row.drop-before td) {
  border-top: 2px solid var(--console-accent, #be5630);
}
.parameter-el-table :deep(.el-table__row.drop-after td) {
  border-bottom: 2px solid var(--console-accent, #be5630);
}
.drag-handle {
  width: 32px;
  height: 36px;
  display: inline-grid;
  cursor: grab;
  place-items: center;
  touch-action: none;
  user-select: none;
}
.drag-handle:active,
.drag-handle.dragging {
  cursor: grabbing;
}
.drag-handle.locked {
  cursor: not-allowed;
  opacity: 0.45;
  pointer-events: none;
}
.drag-handle svg {
  width: 12px;
  height: 18px;
  fill: currentColor;
  color: var(--console-text-muted, #756b5e);
  pointer-events: none;
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
.parameter-key-tag {
  min-width: 0;
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
.parameter-el-table :deep(td.numeric .cell) {
  color: var(--console-text, #312d28);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-variant-numeric: tabular-nums;
}
.parameter-el-table :deep(td.compound .cell) {
  color: var(--console-accent, #be5630);
}
.struct-name-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.struct-name-cell > span:not(.parameter-tree-spacer) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.struct-name-cell :deep(.el-tag) {
  max-width: 44%;
  overflow: hidden;
  animation: none;
  transition: none;
}
.struct-toolbar :deep(.el-input) {
  max-width: 320px;
}
.parameter-tree-toggle,
.parameter-tree-spacer {
  width: 20px;
  height: 30px;
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
.parameter-hierarchy-warning {
  flex: 0 0 auto;
  color: var(--console-warning, #a96814);
}
.struct-parameter-detail {
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 8px;
  background: var(--console-paper-soft, #faf5ec);
}
.struct-parameter-detail p {
  margin: 0;
  color: var(--console-text-muted, #756b5e);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.struct-parameter-detail .parameter-hierarchy-message {
  margin-top: 5px;
  color: var(--console-warning, #8a560f);
}
.struct-parameter-detail .parameter-readonly-message {
  color: var(--console-warning, #8a560f);
}
.collection-empty {
  min-height: 140px;
  display: grid;
  place-items: center;
  color: var(--console-text-muted, #756b5e);
}
.clear-selection {
  justify-self: start;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
@media (max-width: 760px) {
  .array-toolbar {
    align-items: stretch;
    flex-wrap: wrap;
  }
  .array-toolbar :deep(.el-input) {
    flex-basis: 100%;
  }
}
</style>
