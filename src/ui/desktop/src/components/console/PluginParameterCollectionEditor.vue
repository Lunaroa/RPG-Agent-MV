<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowRight, WarningFilled } from '@element-plus/icons-vue';
import type {
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import { clipboard } from '../../api/client';
import { useI18n } from '../../i18n';
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
  isPluginParameterSchemaFieldEditable,
  replacePluginParameterChildValue,
  summarizePluginParameterValue,
  type PluginParameterChildTarget,
  type PluginParameterRow,
  type PluginParameterSummaryLabels,
} from './plugin-parameter-model';
import {
  buildPluginParameterTree,
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
const query = ref('');
const collectionTable = ref<HTMLElement | null>(null);
const selectedRowIds = ref<string[]>([]);
const activeRowId = ref('');
const rowIds = ref<string[]>([]);
const draggedIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);
const expandedStructKeys = ref<Set<string>>(new Set());
const activeStructKey = ref('');
let rowSerial = 0;

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
    expandedStructKeys.value = new Set();
    activeStructKey.value = '';
  },
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

function isBooleanEnabled(value: unknown): boolean {
  return value === true || ['true', 'on', '1'].includes(String(value).toLowerCase());
}

function updateStructBoolean(field: PluginParameterSchemaField, enabled: boolean): void {
  emit(
    'update:modelValue',
    replacePluginParameterChildValue(
      structSource(),
      { kind: 'struct', key: field.key },
      enabled ? 'true' : 'false',
    ),
  );
}

function updateArrayBoolean(index: number, enabled: boolean, key?: string): void {
  const next = entries.value.map((entry) => clonePluginParameterValue(entry));
  const current = next[index];
  if (key && isRecord(current)) {
    next[index] = {
      ...current,
      [key]: enabled ? 'true' : 'false',
    };
  } else {
    next[index] = enabled ? 'true' : 'false';
  }
  emit('update:modelValue', next);
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

function updateStructRowBoolean(row: PluginParameterRow, enabled: boolean): void {
  if (row.field) updateStructBoolean(row.field, enabled);
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
  if (event.target !== event.currentTarget) return;
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

function focusStructRow(key: string): void {
  activeStructKey.value = key;
  void nextTick(() => {
    collectionTable.value
      ?.querySelector<HTMLElement>(`[data-struct-parameter-key="${CSS.escape(key)}"]`)
      ?.focus();
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

function deleteOne(index: number): void {
  const removedId = rowIds.value[index];
  rowIds.value.splice(index, 1);
  selectedRowIds.value = selectedRowIds.value.filter((id) => id !== removedId);
  emit('update:modelValue', removePluginParameterArrayItems(entries.value, [index]));
}

function startDrag(event: DragEvent, index: number): void {
  if (sortingLocked.value) {
    event.preventDefault();
    return;
  }
  draggedIndex.value = index;
  dropIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function dragOver(event: DragEvent, index: number): void {
  if (sortingLocked.value || draggedIndex.value === null) return;
  event.preventDefault();
  const row = event.currentTarget as HTMLElement;
  dropIndex.value = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2
    ? index + 1
    : index;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function finishDrop(event: DragEvent): void {
  event.preventDefault();
  const from = draggedIndex.value;
  const rawTarget = dropIndex.value;
  if (from === null || rawTarget === null) return clearDrag();
  const to = Math.max(0, Math.min(entries.value.length - 1, rawTarget > from ? rawTarget - 1 : rawTarget));
  moveItem(from, to);
  clearDrag();
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
  if (event.target !== event.currentTarget) return;
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
  activeRowId.value = target.id;
  collectionTable.value
    ?.querySelector<HTMLElement>(`[data-parameter-row-id="${target.id}"]`)
    ?.focus();
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

      <div ref="collectionTable" class="collection-table-wrap">
        <table
          class="array-table"
          :style="{ minWidth: `${Math.max(680, 172 + Math.max(columns.length, 1) * 170)}px` }"
        >
          <thead>
            <tr>
              <th class="select-column">
                <el-checkbox
                  :model-value="allVisibleSelected"
                  :indeterminate="someVisibleSelected"
                  :aria-label="t('plugins.parameterSelectVisible')"
                  @change="toggleVisibleSelection(Boolean($event))"
                />
              </th>
              <th class="drag-column">
                <span class="visually-hidden">{{ t('plugins.parameterOrderColumn') }}</span>
              </th>
              <template v-if="columns.length">
                <th v-for="column in columns" :key="column.key" scope="col">
                  <span>{{ column.label }}</span>
                  <small>{{ column.key }}</small>
                </th>
              </template>
              <th v-else scope="col">{{ t('plugins.parameterValueColumn') }}</th>
              <th class="actions-column" scope="col">
                {{ t('plugins.parameterActionsColumn') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, visibleIndex) in visibleRows"
              :key="row.id"
              :data-parameter-row-id="row.id"
              :class="{
                active: activeRowId === row.id,
                'drop-before': dropIndex === row.index,
                'drop-after': row.index === entries.length - 1 && dropIndex === entries.length,
              }"
              tabindex="0"
              @click="activeRowId = row.id"
              @dblclick="editArrayItem(row.index)"
              @keydown="rowKeydown($event, visibleIndex, row.index)"
              @dragover="dragOver($event, row.index)"
              @drop="finishDrop"
            >
              <td class="select-column" @click.stop @dblclick.stop>
                <el-checkbox
                  :model-value="selectedRowIds.includes(row.id)"
                  :aria-label="t('plugins.parameterSelectItem', { index: row.index + 1 })"
                  @change="toggleRowSelection(row.id, Boolean($event))"
                />
              </td>
              <td class="drag-column" @dblclick.stop>
                <span
                  class="drag-handle"
                  :class="{ locked: sortingLocked }"
                  :draggable="!sortingLocked"
                  :title="sortingLocked
                    ? t('plugins.parameterClearSearchToReorder')
                    : t('plugins.parameterDragToReorder')"
                  :aria-label="t('plugins.parameterDragToReorder')"
                  @dragstart.stop="startDrag($event, row.index)"
                  @dragend="clearDrag"
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
              </td>
              <template v-if="columns.length">
                <td
                  v-for="column in columns"
                  :key="column.key"
                  :class="{
                    numeric: column.field.kind === 'number',
                    compound: column.field.kind === 'struct' || column.field.kind === 'array',
                  }"
                  :title="cellSummary(row.value, column.field)"
                >
                  <el-checkbox
                    v-if="
                      column.field.kind === 'boolean'
                      && isPluginParameterSchemaFieldEditable(column.field)
                    "
                    :model-value="isBooleanEnabled(cellValue(row.value, column.field))"
                    :aria-label="column.label"
                    @click.stop
                    @dblclick.stop
                    @change="updateArrayBoolean(row.index, Boolean($event), column.key)"
                  />
                  <span v-else>{{ cellSummary(row.value, column.field) }}</span>
                </td>
              </template>
              <td v-else :title="arrayItem ? valueSummary(arrayItem, row.value) : ''">
                <el-checkbox
                  v-if="
                    arrayItem?.kind === 'boolean'
                    && isPluginParameterSchemaFieldEditable(arrayItem)
                  "
                  :model-value="isBooleanEnabled(row.value)"
                  :aria-label="t('plugins.parameterArrayItem', { index: row.index + 1 })"
                  @click.stop
                  @dblclick.stop
                  @change="updateArrayBoolean(row.index, Boolean($event))"
                />
                <span v-else>
                  {{ arrayItem ? valueSummary(arrayItem, row.value) : '' }}
                </span>
              </td>
              <td class="collection-actions" @dblclick.stop>
                <el-button
                  v-if="arrayItem && isPluginParameterSchemaFieldEditable(arrayItem)"
                  link
                  type="primary"
                  @click.stop="editArrayItem(row.index)"
                >
                  {{ t('plugins.editParameter') }}
                </el-button>
                <el-button
                  link
                  type="danger"
                  @click.stop="deleteOne(row.index)"
                >
                  {{ t('cmdList.delete') }}
                </el-button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!visibleRows.length" class="collection-empty">
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
      <div ref="collectionTable" class="collection-table-wrap struct-table-wrap">
      <table class="struct-table" role="treegrid">
        <thead>
          <tr>
            <th scope="col">{{ t('plugins.parameterNameColumn') }}</th>
            <th scope="col">{{ t('plugins.parameterValueColumn') }}</th>
            <th class="actions-column" scope="col">
              {{ t('plugins.parameterActionsColumn') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in visibleStructRows"
            :key="row.key"
            :data-struct-parameter-key="row.key"
            :class="{ active: activeStructKey === row.key }"
            tabindex="0"
            :aria-level="row.depth + 1"
            :aria-expanded="row.hasChildren ? row.expanded : undefined"
            @click="activeStructKey = row.key"
            @dblclick="editStructRow(row)"
            @keydown="structRowKeydown($event, row, index)"
          >
            <td>
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
                <el-tag size="small" type="info" effect="plain">{{ row.key }}</el-tag>
              </div>
            </td>
            <td
              :class="{ numeric: row.field?.kind === 'number' }"
              :title="row.fullValue"
            >
              <el-checkbox
                v-if="
                  row.field?.kind === 'boolean'
                  && row.editable
                "
                :model-value="isBooleanEnabled(structSource()[row.key])"
                :aria-label="row.label"
                @click.stop
                @dblclick.stop
                @change="updateStructRowBoolean(row, Boolean($event))"
              />
              <span v-else>{{ row.summary }}</span>
            </td>
            <td class="collection-actions" @dblclick.stop>
              <el-button
                v-if="row.editable"
                link
                type="primary"
                @click.stop="editStructRow(row)"
              >
                {{ t('plugins.editParameter') }}
              </el-button>
              <span v-else>{{ t('plugins.parameterReadonly') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!visibleStructRows.length" class="collection-empty">
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
  overflow: auto;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 8px;
  background: var(--console-paper, #fffdfa);
}
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  color: var(--console-text, #312d28);
  font-size: 12px;
}
th,
td {
  height: 40px;
  box-sizing: border-box;
  padding: 0 10px;
  overflow: hidden;
  border-right: 1px solid var(--console-border, #e4dcce);
  border-bottom: 1px solid var(--console-border, #e4dcce);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
th {
  position: sticky;
  z-index: 3;
  top: 0;
  height: 38px;
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-soft, #5a5247);
  font-size: 11px;
  font-weight: 600;
}
th small {
  display: block;
  overflow: hidden;
  color: var(--console-text-muted, #756b5e);
  font-weight: 400;
  text-overflow: ellipsis;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover,
tbody tr.active {
  background: var(--console-accent-soft, #f8e9df);
}
tbody tr:focus-visible {
  outline: 2px solid var(--console-accent, #be5630);
  outline-offset: -2px;
}
tbody tr.drop-before td {
  border-top: 2px solid var(--console-accent, #be5630);
}
tbody tr.drop-after td {
  border-bottom: 2px solid var(--console-accent, #be5630);
}
.select-column,
.drag-column {
  width: 42px;
  padding: 0;
  text-align: center;
}
.drag-handle {
  width: 32px;
  height: 36px;
  display: inline-grid;
  cursor: grab;
  place-items: center;
}
.drag-handle:active {
  cursor: grabbing;
}
.drag-handle.locked {
  cursor: not-allowed;
  opacity: 0.45;
}
.drag-handle svg {
  width: 12px;
  height: 18px;
  fill: currentColor;
  color: var(--console-text-muted, #756b5e);
}
.actions-column,
.collection-actions {
  position: sticky;
  z-index: 2;
  right: 0;
  width: 126px;
  border-right: 0;
  background: var(--console-paper, #fffdfa);
  box-shadow: -8px 0 10px -10px rgb(65 48 34 / 52%);
  text-align: right;
}
th.actions-column {
  z-index: 4;
  background: var(--console-paper-soft, #faf5ec);
}
tbody tr:hover .collection-actions,
tbody tr.active .collection-actions {
  background: var(--console-accent-soft, #f8e9df);
}
td.numeric {
  color: var(--console-text, #312d28);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-variant-numeric: tabular-nums;
}
td.compound {
  color: var(--console-accent, #be5630);
}
.struct-table th:first-child,
.struct-table td:first-child {
  width: 42%;
}
.struct-name-cell {
  min-width: 0;
  display: flex;
  height: 39px;
  align-items: center;
  gap: 8px;
}
.struct-name-cell > span:not(.parameter-tree-spacer) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.struct-table :deep(.el-tag) {
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
