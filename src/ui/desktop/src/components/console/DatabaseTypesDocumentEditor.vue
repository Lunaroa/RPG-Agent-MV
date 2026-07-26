<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { useI18n } from '../../i18n';
import { databaseFieldLabel } from '../../utils/rmmvDatabaseLocalization';
import {
  clampTypeListSelection,
  normalizeTypeListCapacity,
  typeListRemovedEntries,
} from '../../utils/databaseDocumentPages';

type TypeField = 'elements' | 'skillTypes' | 'weaponTypes' | 'armorTypes' | 'equipTypes';
type DbRecord = Record<string, unknown>;

const props = defineProps<{ modelValue: unknown }>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { language, t } = useI18n();

const TYPE_FIELDS: TypeField[] = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'];
const selectedIds = reactive<Record<TypeField, number>>({
  elements: 1,
  skillTypes: 1,
  weaponTypes: 1,
  armorTypes: 1,
  equipTypes: 1,
});

const record = computed<DbRecord>(() => (
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? props.modelValue as DbRecord
    : {}
));

function listValue(field: TypeField): string[] {
  const source = record.value[field];
  const list = Array.isArray(source) ? source.map((entry) => String(entry ?? '')) : [''];
  if (!list.length) list.push('');
  list[0] = '';
  return list;
}

function capacity(field: TypeField): number {
  return Math.max(1, listValue(field).length - 1);
}

function entries(field: TypeField): Array<{ id: number; name: string }> {
  const list = listValue(field);
  return Array.from({ length: Math.max(1, list.length - 1) }, (_entry, index) => ({
    id: index + 1,
    name: list[index + 1] || '',
  }));
}

function fieldLabel(field: TypeField): string {
  return databaseFieldLabel(field, language.value);
}

function updateField(field: TypeField, value: string[]): void {
  emit('update:modelValue', { ...record.value, [field]: value });
}

function updateSelectedName(field: TypeField, value: string): void {
  const list = listValue(field);
  const id = clampTypeListSelection(list, selectedIds[field]);
  while (list.length <= id) list.push('');
  list[id] = value;
  updateField(field, list);
}

function selectRow(field: TypeField, id: number): void {
  selectedIds[field] = clampTypeListSelection(listValue(field), id);
}

function onListKeydown(field: TypeField, event: KeyboardEvent): void {
  const current = clampTypeListSelection(listValue(field), selectedIds[field]);
  let next = current;
  if (event.key === 'ArrowUp') next = current - 1;
  else if (event.key === 'ArrowDown') next = current + 1;
  else if (event.key === 'Home') next = 1;
  else if (event.key === 'End') next = capacity(field);
  else return;
  event.preventDefault();
  selectRow(field, next);
}

async function changeMaximum(field: TypeField): Promise<void> {
  const current = capacity(field);
  try {
    const answer = await ElMessageBox.prompt(
      t('db.document.types.maximumPrompt', { current }),
      t('db.document.types.maximumTitle', { type: fieldLabel(field) }),
      {
        confirmButtonText: t('db.document.types.maximumConfirm'),
        cancelButtonText: t('eventcmd.cancel'),
        inputValue: String(current),
        inputPattern: /^(?:[1-9]\d{0,2}|[1-4]\d{3}|5000)$/,
        inputErrorMessage: t('db.document.types.maximumInvalid'),
      },
    );
    const maximum = Number(answer.value);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5000 || maximum === current) return;

    const removed = typeListRemovedEntries(listValue(field), maximum);
    if (removed.length) {
      const namedCount = removed.filter((entry) => entry.name.trim()).length;
      const preview = removed
        .slice(0, 8)
        .map((entry) => `${String(entry.id).padStart(4, '0')} ${entry.name || t('story.unnamed')}`)
        .join('\n');
      await ElMessageBox.confirm(
        t('db.document.types.shrinkConfirm', {
          count: removed.length,
          namedCount,
          entries: preview,
        }),
        t('db.document.types.shrinkTitle'),
        {
          type: 'warning',
          confirmButtonText: t('db.document.types.shrinkContinue'),
          cancelButtonText: t('eventcmd.cancel'),
        },
      );
    }

    const next = normalizeTypeListCapacity(listValue(field), maximum);
    updateField(field, next);
    selectedIds[field] = clampTypeListSelection(next, selectedIds[field]);
  } catch {
    // Element Plus rejects prompts and confirmations when the user cancels.
  }
}

watch(
  () => props.modelValue,
  () => {
    for (const field of TYPE_FIELDS) {
      selectedIds[field] = clampTypeListSelection(listValue(field), selectedIds[field]);
    }
  },
  { deep: true },
);
</script>

<template>
  <section class="rm-document rm-types-document" :aria-label="t('db.document.types.pageLabel')">
    <div class="rm-types-grid">
      <section v-for="field in TYPE_FIELDS" :key="field" class="rm-document-panel rm-type-panel">
        <h3>{{ fieldLabel(field) }}</h3>
        <div
          class="rm-type-list"
          role="listbox"
          :aria-label="fieldLabel(field)"
          :aria-activedescendant="`rm-type-${field}-${selectedIds[field]}`"
          tabindex="0"
          @keydown="onListKeydown(field, $event)"
        >
          <button
            v-for="entry in entries(field)"
            :id="`rm-type-${field}-${entry.id}`"
            :key="entry.id"
            type="button"
            role="option"
            class="rm-type-option"
            :class="{ active: selectedIds[field] === entry.id }"
            :aria-selected="selectedIds[field] === entry.id"
            @click="selectRow(field, entry.id)"
          >
            <span class="rm-type-selection" aria-hidden="true">{{ selectedIds[field] === entry.id ? '›' : '' }}</span>
            <span class="rm-type-option-id">{{ String(entry.id).padStart(2, '0') }}</span>
            <span class="rm-type-option-name">{{ entry.name || t('story.unnamed') }}</span>
          </button>
        </div>
        <label class="rm-type-current">
          <span>{{ t('db.document.types.selectedName') }}</span>
          <input
            type="text"
            :value="listValue(field)[selectedIds[field]] || ''"
            @input="updateSelectedName(field, ($event.target as HTMLInputElement).value)"
          />
        </label>
        <button type="button" class="rm-type-maximum" @click="changeMaximum(field)">
          {{ t('db.document.types.changeMaximum', { maximum: capacity(field) }) }}
        </button>
      </section>
    </div>
  </section>
</template>

<style scoped>
.rm-document {
  min-width: 0;
  color: var(--console-text, #211d17);
}
.rm-types-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}
.rm-document-panel {
  min-width: 0;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 5px;
  background: var(--console-paper-soft, #faf5ec);
  overflow: hidden;
}
.rm-document-panel h3 {
  margin: 0;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.25;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  background: var(--console-paper, #fffdfa);
}
.rm-type-panel {
  display: grid;
  grid-template-rows: auto minmax(240px, 1fr) auto auto;
  min-height: min(68vh, 720px);
}
.rm-type-list {
  min-height: 0;
  overflow-y: auto;
  background: var(--console-paper, #fffdfa);
  outline: none;
}
.rm-type-list:focus-visible {
  box-shadow: inset 0 0 0 2px var(--app-accent, #be5630);
}
.rm-type-option {
  width: 100%;
  min-height: 27px;
  display: grid;
  grid-template-columns: 10px 30px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--console-border, #e4dcce) 72%, transparent);
  border-radius: 0;
  background: var(--console-paper, #fffdfa);
  color: inherit;
  text-align: left;
}
.rm-type-option:nth-child(even) {
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 76%, var(--console-paper, #fffdfa));
}
.rm-type-option:hover {
  background: color-mix(in srgb, var(--app-accent-soft, #f6e3d7) 65%, var(--console-paper, #fffdfa));
}
.rm-type-option.active {
  background: var(--app-accent-soft, #f6e3d7);
  color: var(--app-accent-strong, #9d3f20);
  font-weight: 650;
}
.rm-type-selection {
  font-size: 15px;
  line-height: 1;
}
.rm-type-option-id {
  font: 11px/1.2 var(--app-font-mono);
  font-variant-numeric: tabular-nums;
}
.rm-type-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-type-current {
  display: grid;
  gap: 3px;
  padding: 6px;
  border-top: 1px solid var(--console-border, #e4dcce);
  background: var(--console-paper, #fffdfa);
  font-size: 11px;
}
.rm-type-current input {
  width: 100%;
  min-width: 0;
  min-height: 28px;
  box-sizing: border-box;
}
.rm-type-maximum {
  min-height: 30px;
  margin: 0 6px 6px;
  white-space: normal;
}
@container (max-width: 820px) {
  .rm-types-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 480px) {
  .rm-types-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
