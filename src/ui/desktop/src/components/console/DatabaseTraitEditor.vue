<script setup lang="ts">
import { computed } from 'vue';
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

function addTrait(): void {
  emit('update:modelValue', [...traits.value, createStandardMvTrait(21, references())]);
}

function replaceTrait(index: number, trait: MvTraitRecord): void {
  const next = [...traits.value];
  next[index] = trait;
  emit('update:modelValue', next);
}

function changeTraitCode(index: number, value: unknown, code: number): void {
  if (!isStandardMvTraitCode(code)) return;
  replaceTrait(index, setStandardMvTraitCode(value, code, references()));
}

function changeTraitTarget(index: number, value: unknown, dataId: number): void {
  replaceTrait(index, { ...normalizeMvTrait(value), dataId });
}

function changeTraitValue(index: number, value: unknown, amount: unknown): void {
  replaceTrait(index, setMvTraitEditorValue(value, amount));
}

function removeTrait(index: number): void {
  emit('update:modelValue', traits.value.filter((_trait, traitIndex) => traitIndex !== index));
}

function numericLabel(code: number): string {
  const key: MvNumericEditorSpec['label'] = mvTraitNumericSpec(code)?.label || 'amount';
  return t(NUMERIC_LABEL_KEYS[key]);
}
</script>

<template>
  <div class="semantic-list" :class="{ compact }">
    <div class="semantic-list-head">
      <span>{{ t('db.traitCount', { count: traits.length }) }}</span>
      <button type="button" @click="addTrait">{{ t('cmdList.add') }}</button>
    </div>
    <div v-if="!traits.length" class="semantic-empty">{{ t('db.noTraits') }}</div>
    <div
      v-for="(traitValue, index) in traits"
      :key="`trait-${index}`"
      class="semantic-row"
      :class="{ plugin: !isStandardMvTraitCode(normalizeMvTrait(traitValue).code) }"
    >
      <template v-if="isStandardMvTraitCode(normalizeMvTrait(traitValue).code)">
        <label>
          <span>{{ t('eventEditorDialog.type') }}</span>
          <select
            :value="normalizeMvTrait(traitValue).code"
            @change="changeTraitCode(index, traitValue, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="option in localizedTraitCodes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="needsTarget(normalizeMvTrait(traitValue).code)">
          <span>{{ t('db.target') }}</span>
          <select
            :value="normalizeMvTrait(traitValue).dataId"
            @change="changeTraitTarget(index, traitValue, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="option in traitTargetOptions(traitValue)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="mvTraitNumericSpec(normalizeMvTrait(traitValue).code)">
          <span>{{ numericLabel(normalizeMvTrait(traitValue).code) }}</span>
          <span class="numeric-input">
            <input
              type="number"
              :min="mvTraitNumericSpec(normalizeMvTrait(traitValue).code)!.minimum"
              :max="mvTraitNumericSpec(normalizeMvTrait(traitValue).code)!.maximum"
              :step="mvTraitNumericSpec(normalizeMvTrait(traitValue).code)!.step"
              :value="mvTraitEditorValue(traitValue)"
              @input="changeTraitValue(index, traitValue, ($event.target as HTMLInputElement).value)"
            />
            <b v-if="mvTraitNumericSpec(normalizeMvTrait(traitValue).code)!.kind === 'percent'">%</b>
          </span>
        </label>
        <span v-else class="semantic-fixed">{{ t('db.semanticFixedValue') }}</span>
        <button type="button" class="danger" @click="removeTrait(index)">{{ t('cmdList.delete') }}</button>
      </template>
      <template v-else>
        <div class="plugin-summary">
          <strong>{{ t('db.pluginTraitCode', { code: normalizeMvTrait(traitValue).code }) }}</strong>
          <span>{{ t('db.pluginSemanticReadonly') }}</span>
          <code>dataId {{ normalizeMvTrait(traitValue).dataId }} · value {{ normalizeMvTrait(traitValue).value }}</code>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.semantic-list { display: grid; gap: 7px; min-width: 0; }
.semantic-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.semantic-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; align-items: end; padding: 8px; border: 1px solid var(--console-border, #e4dcce); border-radius: 5px; background: var(--console-paper-soft, #faf5ec); }
.semantic-row label { display: grid; gap: 3px; min-width: 0; }
.semantic-row label > span:first-child { color: var(--el-text-color-secondary); font-size: 11px; }
.semantic-row select, .semantic-row input { width: 100%; min-width: 0; }
.numeric-input { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px; }
.numeric-input b { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 500; }
.semantic-fixed { align-self: center; color: var(--el-text-color-placeholder); font-size: 11px; }
.semantic-empty { padding: 10px 0; color: var(--el-text-color-placeholder); font-size: 12px; }
.semantic-row.plugin { grid-template-columns: 1fr; border-style: dashed; }
.plugin-summary { display: grid; gap: 3px; }
.plugin-summary strong { font-size: 12px; }
.plugin-summary span, .plugin-summary code { color: var(--el-text-color-secondary); font-size: 11px; }
.compact .semantic-row { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 6px; }
button.danger { color: var(--el-color-danger); }
.semantic-row > button { justify-self: end; }
</style>
