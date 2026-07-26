<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorProjectCatalog, NamedCatalogEntry } from '../../api/client';
import { useI18n } from '../../i18n';
import {
  PARAM_OPTIONS,
  SPARAM_OPTIONS,
  TRAIT_CODES,
  XPARAM_OPTIONS,
  localizeDatabaseOptions,
} from '../../utils/rmmvDatabaseLocalization';
import {
  createStandardMvTrait,
  isStandardMvTraitCode,
  mvTraitEditorValue,
  mvTraitNumericSpec,
  normalizeMvTrait,
  setMvTraitEditorValue,
  setStandardMvTraitCode,
  type MvSemanticReferences,
  type MvNumericEditorSpec,
  type MvTraitRecord,
} from '../../utils/rmmvDatabaseSemantics';
import { mvSemanticRawSummary, mvTraitContentSummary } from '../../utils/rmmvDatabaseSummaries';

type CatalogKey = Exclude<keyof EditorProjectCatalog, 'project' | 'engine' | 'tileSize' | 'screenWidth' | 'screenHeight' | 'assets' | 'battle'>;
type SelectOption = { value: number; label: string };

const props = defineProps<{
  modelValue: unknown[];
  catalog: EditorProjectCatalog | null;
  compact?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown[]];
}>();

const { language, t } = useI18n();
const localizedTraitCodes = computed(() => localizeDatabaseOptions(TRAIT_CODES, language.value));
const traits = computed(() => Array.isArray(props.modelValue) ? props.modelValue : []);
// Stock RM interaction: rows show "type | content", double-click opens the edit dialog.
const dialog = ref<{ index: number | null; draft: MvTraitRecord } | null>(null);
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

function localizedOptions(options: ReadonlyArray<SelectOption>): SelectOption[] {
  return localizeDatabaseOptions(options, language.value);
}

function traitTargetOptions(traitValue: unknown): SelectOption[] {
  const trait = normalizeMvTrait(traitValue);
  let options: SelectOption[] = [];
  switch (trait.code) {
    case 11:
    case 31:
      options = catalogOptions('elements');
      break;
    case 12:
    case 21:
      options = localizedOptions(PARAM_OPTIONS);
      break;
    case 13:
    case 14:
    case 32:
      options = catalogOptions('states');
      break;
    case 22:
      options = localizedOptions(XPARAM_OPTIONS);
      break;
    case 23:
      options = localizedOptions(SPARAM_OPTIONS);
      break;
    case 41:
    case 42:
      options = catalogOptions('skillTypes');
      break;
    case 43:
    case 44:
      options = catalogOptions('skills');
      break;
    case 51:
      options = catalogOptions('weaponTypes');
      break;
    case 52:
      options = catalogOptions('armorTypes');
      break;
    case 53:
    case 54:
      options = catalogOptions('equipTypes');
      break;
    case 55:
      options = [{ value: 1, label: t('db.traitDualWield') }];
      break;
    case 62:
      options = [
        { value: 0, label: t('db.traitAutoBattle') },
        { value: 1, label: t('db.traitGuard') },
        { value: 2, label: t('db.traitSubstitute') },
        { value: 3, label: t('db.traitPreserveTp') },
      ];
      break;
    case 63:
      options = [
        { value: 0, label: t('db.traitCollapseNormal') },
        { value: 1, label: t('db.traitCollapseBoss') },
        { value: 2, label: t('db.traitCollapseInstant') },
      ];
      break;
    case 64:
      options = [
        { value: 0, label: t('db.traitEncounterHalf') },
        { value: 1, label: t('db.traitEncounterNone') },
        { value: 2, label: t('db.traitCancelSurprise') },
        { value: 3, label: t('db.traitRaisePreemptive') },
        { value: 4, label: t('db.traitGoldDouble') },
        { value: 5, label: t('db.traitDropDouble') },
      ];
      break;
  }
  if (options.some((option) => option.value === trait.dataId)) return options;
  return [{ value: trait.dataId, label: t('db.missingReferenceId', { id: trait.dataId }) }, ...options];
}

function needsTarget(code: number): boolean {
  return ![33, 34, 61].includes(code);
}

function references(): MvSemanticReferences {
  return {
    elementId: catalogEntries('elements')[0]?.id,
    stateId: catalogEntries('states')[0]?.id,
    skillTypeId: catalogEntries('skillTypes')[0]?.id,
    skillId: catalogEntries('skills')[0]?.id,
    weaponTypeId: catalogEntries('weaponTypes')[0]?.id,
    armorTypeId: catalogEntries('armorTypes')[0]?.id,
    equipTypeId: catalogEntries('equipTypes')[0]?.id,
  };
}

function traitTypeLabel(traitValue: unknown): string {
  const trait = normalizeMvTrait(traitValue);
  if (!isStandardMvTraitCode(trait.code)) return t('db.pluginTraitCode', { code: trait.code });
  return localizedTraitCodes.value.find((option) => option.value === trait.code)?.label || String(trait.code);
}

function traitContent(traitValue: unknown): string {
  const trait = normalizeMvTrait(traitValue);
  if (!isStandardMvTraitCode(trait.code)) return mvSemanticRawSummary(trait.code, trait.dataId, [trait.value]);
  const targetLabel = needsTarget(trait.code)
    ? stripIdPrefix(traitTargetOptions(traitValue).find((option) => option.value === trait.dataId)?.label || String(trait.dataId))
    : '';
  return mvTraitContentSummary(traitValue, targetLabel);
}

// Selects keep the 0001-prefixed labels; the stock RM content column shows plain names.
function stripIdPrefix(label: string): string {
  return label.replace(/^\d{4} /, '');
}

function openEditor(index: number): void {
  const trait = normalizeMvTrait(traits.value[index]);
  if (!isStandardMvTraitCode(trait.code)) return;
  dialog.value = { index, draft: trait };
}

function openCreator(): void {
  dialog.value = { index: null, draft: createStandardMvTrait(21, references()) };
}

function changeDraftCode(code: number): void {
  if (!dialog.value || !isStandardMvTraitCode(code)) return;
  dialog.value.draft = setStandardMvTraitCode(dialog.value.draft, code, references());
}

function changeDraftTarget(dataId: number): void {
  if (!dialog.value) return;
  dialog.value.draft = { ...dialog.value.draft, dataId };
}

function changeDraftValue(amount: unknown): void {
  if (!dialog.value) return;
  dialog.value.draft = setMvTraitEditorValue(dialog.value.draft, amount);
}

function confirmDialog(): void {
  if (!dialog.value) return;
  const next = [...traits.value];
  if (dialog.value.index === null) next.push(dialog.value.draft);
  else next[dialog.value.index] = dialog.value.draft;
  emit('update:modelValue', next);
  dialog.value = null;
}

function removeTrait(index: number): void {
  emit('update:modelValue', traits.value.filter((_trait, traitIndex) => traitIndex !== index));
}

function draftNumericSpec(): MvNumericEditorSpec | null {
  return dialog.value ? mvTraitNumericSpec(dialog.value.draft.code) : null;
}

function numericLabel(code: number): string {
  const key: MvNumericEditorSpec['label'] = mvTraitNumericSpec(code)?.label || 'amount';
  return t(NUMERIC_LABEL_KEYS[key]);
}
</script>

<template>
  <div class="semantic-table" :class="{ compact }">
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
          v-for="(traitValue, index) in traits"
          :key="`trait-${index}`"
          :data-ui-id="`trait-row-${index}`"
          :class="{ plugin: !isStandardMvTraitCode(normalizeMvTrait(traitValue).code) }"
          :title="t('db.semanticRowHint')"
          @dblclick="openEditor(index)"
        >
          <td>{{ traitTypeLabel(traitValue) }}</td>
          <td>{{ traitContent(traitValue) }}</td>
          <td class="row-tools">
            <button type="button" class="row-remove" :aria-label="t('cmdList.delete')" @click.stop="removeTrait(index)">×</button>
          </td>
        </tr>
        <tr class="semantic-add-row" data-ui-id="trait-add-row" :title="t('db.semanticAddHint')" @dblclick="openCreator">
          <td colspan="3" />
        </tr>
      </tbody>
    </table>

    <el-dialog
      :model-value="Boolean(dialog)"
      :title="dialog ? traitTypeLabel(dialog.draft) : ''"
      width="min(420px, calc(100vw - 48px))"
      append-to-body
      :close-on-click-modal="false"
      @update:model-value="dialog = null"
    >
      <div v-if="dialog" class="semantic-dialog-body">
        <label>
          <span>{{ t('eventEditorDialog.type') }}</span>
          <select :value="dialog.draft.code" @change="changeDraftCode(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="option in localizedTraitCodes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="needsTarget(dialog.draft.code)">
          <span>{{ t('db.target') }}</span>
          <select :value="dialog.draft.dataId" @change="changeDraftTarget(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="option in traitTargetOptions(dialog.draft)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="draftNumericSpec()">
          <span>{{ numericLabel(dialog.draft.code) }}</span>
          <span class="numeric-input">
            <input
              type="number"
              :min="draftNumericSpec()!.minimum"
              :max="draftNumericSpec()!.maximum"
              :step="draftNumericSpec()!.step"
              :value="mvTraitEditorValue(dialog.draft)"
              @input="changeDraftValue(($event.target as HTMLInputElement).value)"
            />
            <b v-if="draftNumericSpec()!.kind === 'percent'">%</b>
          </span>
        </label>
      </div>
      <template #footer>
        <button type="button" @click="dialog = null">{{ t('eventcmd.cancel') }}</button>
        <button type="button" class="semantic-dialog-confirm" data-ui-id="trait-dialog-confirm" @click="confirmDialog">{{ t('eventcmd.ok') }}</button>
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
.numeric-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px; }
.numeric-input b { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 500; }
.semantic-dialog-confirm { border-color: var(--console-accent, #be5630); color: var(--console-accent, #be5630); }
</style>
