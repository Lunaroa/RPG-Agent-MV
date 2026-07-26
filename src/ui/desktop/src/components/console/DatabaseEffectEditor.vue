<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorProjectCatalog, NamedCatalogEntry } from '../../api/client';
import { useI18n } from '../../i18n';
import {
  EFFECT_CODES,
  PARAM_OPTIONS,
  localizeDatabaseOptions,
} from '../../utils/rmmvDatabaseLocalization';
import {
  createStandardMvEffect,
  isStandardMvEffectCode,
  mvEffectEditorValue,
  mvEffectNumericSpecs,
  normalizeMvEffect,
  setMvEffectEditorValue,
  setStandardMvEffectCode,
  type MvEffectRecord,
  type MvNumericEditorSpec,
  type MvSemanticReferences,
} from '../../utils/rmmvDatabaseSemantics';
import { mvEffectContentSummary, mvSemanticRawSummary } from '../../utils/rmmvDatabaseSummaries';

type CatalogKey = Exclude<keyof EditorProjectCatalog, 'project' | 'engine' | 'tileSize' | 'screenWidth' | 'screenHeight' | 'assets' | 'battle'>;
type SelectOption = { value: number; label: string };

const props = defineProps<{
  modelValue: unknown[];
  catalog: EditorProjectCatalog | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown[]];
}>();

const { language, t } = useI18n();
const localizedEffectCodes = computed(() => localizeDatabaseOptions(EFFECT_CODES, language.value));
const effects = computed(() => Array.isArray(props.modelValue) ? props.modelValue : []);
// Stock RM interaction: rows show "type | content", double-click opens the edit dialog.
const dialog = ref<{ index: number | null; draft: MvEffectRecord } | null>(null);
const NUMERIC_LABEL_KEYS = {
  rate: 'db.semantic.rate',
  amount: 'db.semantic.amount',
  flat: 'db.semantic.flat',
  turns: 'db.semantic.turns',
  probability: 'db.semantic.probability',
  speed: 'db.semantic.speed',
  times: 'db.semantic.times',
} as const;

function catalogEntries(key: CatalogKey): NamedCatalogEntry[] {
  const entries = props.catalog?.[key];
  return Array.isArray(entries)
    ? (entries as NamedCatalogEntry[]).filter((entry) => Number.isInteger(entry.id) && entry.id > 0)
    : [];
}

function catalogOptions(key: CatalogKey): SelectOption[] {
  return catalogEntries(key).map((entry) => ({
    value: entry.id,
    label: `${String(entry.id).padStart(4, '0')} ${entry.name}`,
  }));
}

function references(): MvSemanticReferences {
  return {
    stateId: catalogEntries('states')[0]?.id,
    skillId: catalogEntries('skills')[0]?.id,
    commonEventId: catalogEntries('commonEvents')[0]?.id,
  };
}

function targetOptions(effectValue: unknown): SelectOption[] {
  const effect = normalizeMvEffect(effectValue);
  let options: SelectOption[] = [];
  if (effect.code === 21) {
    options = [{ value: 0, label: t('db.effectNormalAttackState') }, ...catalogOptions('states')];
  } else if (effect.code === 22) {
    options = catalogOptions('states');
  } else if ([31, 32, 33, 34, 42].includes(effect.code)) {
    options = localizeDatabaseOptions(PARAM_OPTIONS, language.value);
  } else if (effect.code === 43) {
    options = catalogOptions('skills');
  } else if (effect.code === 44) {
    options = catalogOptions('commonEvents');
  }
  if (options.some((option) => option.value === effect.dataId)) return options;
  return [{ value: effect.dataId, label: t('db.missingReferenceId', { id: effect.dataId }) }, ...options];
}

function needsTarget(code: number): boolean {
  return [21, 22, 31, 32, 33, 34, 42, 43, 44].includes(code);
}

function effectTypeLabel(effectValue: unknown): string {
  const effect = normalizeMvEffect(effectValue);
  if (!isStandardMvEffectCode(effect.code)) return t('db.pluginEffectCode', { code: effect.code });
  return localizedEffectCodes.value.find((option) => option.value === effect.code)?.label || String(effect.code);
}

function effectContent(effectValue: unknown): string {
  const effect = normalizeMvEffect(effectValue);
  if (!isStandardMvEffectCode(effect.code)) {
    return mvSemanticRawSummary(effect.code, effect.dataId, [effect.value1, effect.value2]);
  }
  const targetLabel = needsTarget(effect.code)
    ? stripIdPrefix(targetOptions(effectValue).find((option) => option.value === effect.dataId)?.label || String(effect.dataId))
    : '';
  return mvEffectContentSummary(effectValue, targetLabel, language.value);
}

// Selects keep the 0001-prefixed labels; the stock RM content column shows plain names.
function stripIdPrefix(label: string): string {
  return label.replace(/^\d{4} /, '');
}

function openEditor(index: number): void {
  const effect = normalizeMvEffect(effects.value[index]);
  if (!isStandardMvEffectCode(effect.code)) return;
  dialog.value = { index, draft: effect };
}

function openCreator(): void {
  dialog.value = { index: null, draft: createStandardMvEffect(11, references()) };
}

function changeDraftCode(code: number): void {
  if (!dialog.value || !isStandardMvEffectCode(code)) return;
  dialog.value.draft = setStandardMvEffectCode(dialog.value.draft, code, references());
}

function changeDraftTarget(dataId: number): void {
  if (!dialog.value) return;
  dialog.value.draft = { ...dialog.value.draft, dataId };
}

function changeDraftValue(field: 'value1' | 'value2', amount: unknown): void {
  if (!dialog.value) return;
  dialog.value.draft = setMvEffectEditorValue(dialog.value.draft, field, amount);
}

function confirmDialog(): void {
  if (!dialog.value) return;
  const next = [...effects.value];
  if (dialog.value.index === null) next.push(dialog.value.draft);
  else next[dialog.value.index] = dialog.value.draft;
  emit('update:modelValue', next);
  dialog.value = null;
}

function removeEffect(index: number): void {
  emit('update:modelValue', effects.value.filter((_effect, effectIndex) => effectIndex !== index));
}

function numericLabel(label: MvNumericEditorSpec['label']): string {
  return t(NUMERIC_LABEL_KEYS[label]);
}
</script>

<template>
  <div class="semantic-table">
    <table>
      <thead>
        <tr>
          <th>{{ t('eventEditorDialog.type') }}</th>
          <th>{{ t('db.semanticContent') }}</th>
          <th class="row-tools" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(effectValue, index) in effects"
          :key="`effect-${index}`"
          :data-ui-id="`effect-row-${index}`"
          :class="{ plugin: !isStandardMvEffectCode(normalizeMvEffect(effectValue).code) }"
          :title="t('db.semanticRowHint')"
          @dblclick="openEditor(index)"
        >
          <td>{{ effectTypeLabel(effectValue) }}</td>
          <td>{{ effectContent(effectValue) }}</td>
          <td class="row-tools">
            <button type="button" class="row-remove" :aria-label="t('cmdList.delete')" @click.stop="removeEffect(index)">×</button>
          </td>
        </tr>
        <tr class="semantic-add-row" data-ui-id="effect-add-row" :title="t('db.semanticAddHint')" @dblclick="openCreator">
          <td colspan="3" />
        </tr>
      </tbody>
    </table>

    <el-dialog
      :model-value="Boolean(dialog)"
      :title="dialog ? effectTypeLabel(dialog.draft) : ''"
      width="min(420px, calc(100vw - 48px))"
      append-to-body
      :close-on-click-modal="false"
      @update:model-value="dialog = null"
    >
      <div v-if="dialog" class="semantic-dialog-body">
        <label>
          <span>{{ t('eventEditorDialog.type') }}</span>
          <select :value="dialog.draft.code" @change="changeDraftCode(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="option in localizedEffectCodes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="needsTarget(dialog.draft.code)">
          <span>{{ t('db.target') }}</span>
          <select :value="dialog.draft.dataId" @change="changeDraftTarget(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="option in targetOptions(dialog.draft)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <span v-else-if="dialog.draft.code === 41" class="semantic-fixed">{{ t('db.effectEscape') }}</span>
        <label v-for="spec in mvEffectNumericSpecs(dialog.draft.code)" :key="spec.field">
          <span>{{ numericLabel(spec.label) }}</span>
          <span class="numeric-input">
            <input
              type="number"
              :min="spec.minimum"
              :max="spec.maximum"
              :step="spec.step"
              :value="mvEffectEditorValue(dialog.draft, spec.field)"
              @input="changeDraftValue(spec.field, ($event.target as HTMLInputElement).value)"
            />
            <b v-if="spec.kind === 'percent'">%</b>
          </span>
        </label>
      </div>
      <template #footer>
        <button type="button" @click="dialog = null">{{ t('eventcmd.cancel') }}</button>
        <button type="button" class="semantic-dialog-confirm" data-ui-id="effect-dialog-confirm" @click="confirmDialog">{{ t('eventcmd.ok') }}</button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.semantic-table { min-width: 0; }
.semantic-table table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--console-border, #e4dcce);
  background: var(--console-paper, #fffdfa);
  font-size: 11px;
  table-layout: fixed;
}
.semantic-table th {
  padding: 2px 6px;
  border-bottom: 1px solid var(--console-border-strong, #ddd3c2);
  background: var(--console-paper-soft, #faf5ec);
  color: var(--console-text-muted, #9a8e7e);
  font-weight: 650;
  text-align: left;
}
.semantic-table th:first-child { width: 38%; }
.semantic-table td {
  padding: 2px 6px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  color: var(--console-text-soft, #5a5247);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.semantic-table tbody tr { cursor: default; user-select: none; }
.semantic-table tbody tr:hover td { background: var(--console-paper-soft, #faf5ec); }
.row-tools { width: 22px; padding: 0; text-align: center; }
.row-remove {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--console-text-muted, #9a8e7e);
  font-size: 12px;
  line-height: 1;
  visibility: hidden;
  cursor: pointer;
}
.semantic-table tbody tr:hover .row-remove { visibility: visible; }
.row-remove:hover { color: var(--el-color-danger); }
.semantic-add-row td { height: 20px; }
tr.plugin td { color: var(--console-text-muted, #9a8e7e); font-style: italic; }
.semantic-dialog-body { display: grid; gap: 8px; }
.semantic-dialog-body label { display: grid; gap: 3px; min-width: 0; }
.semantic-dialog-body label > span:first-child { color: var(--el-text-color-secondary); font-size: 11px; }
.semantic-fixed { color: var(--el-text-color-secondary); font-size: 12px; }
.numeric-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px; }
.numeric-input b { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 500; }
.semantic-dialog-confirm { border-color: var(--console-accent, #be5630); color: var(--console-accent, #be5630); }
</style>
