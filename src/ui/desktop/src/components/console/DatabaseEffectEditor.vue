<script setup lang="ts">
import { computed } from 'vue';
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

type CatalogKey = Exclude<keyof EditorProjectCatalog, 'project' | 'assets' | 'battle'>;
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

function addEffect(): void {
  emit('update:modelValue', [...effects.value, createStandardMvEffect(11, references())]);
}

function replaceEffect(index: number, effect: MvEffectRecord): void {
  const next = [...effects.value];
  next[index] = effect;
  emit('update:modelValue', next);
}

function changeEffectCode(index: number, value: unknown, code: number): void {
  if (!isStandardMvEffectCode(code)) return;
  replaceEffect(index, setStandardMvEffectCode(value, code, references()));
}

function changeTarget(index: number, value: unknown, dataId: number): void {
  replaceEffect(index, { ...normalizeMvEffect(value), dataId });
}

function changeNumeric(index: number, value: unknown, field: 'value1' | 'value2', amount: unknown): void {
  replaceEffect(index, setMvEffectEditorValue(value, field, amount));
}

function removeEffect(index: number): void {
  emit('update:modelValue', effects.value.filter((_effect, effectIndex) => effectIndex !== index));
}

function numericLabel(label: MvNumericEditorSpec['label']): string {
  return t(NUMERIC_LABEL_KEYS[label]);
}
</script>

<template>
  <div class="semantic-list">
    <div class="semantic-list-head">
      <span>{{ t('db.effectCount', { count: effects.length }) }}</span>
      <button type="button" @click="addEffect">{{ t('cmdList.add') }}</button>
    </div>
    <div v-if="!effects.length" class="semantic-empty">{{ t('db.noEffects') }}</div>
    <div
      v-for="(effectValue, index) in effects"
      :key="`effect-${index}`"
      class="semantic-row"
      :class="{ plugin: !isStandardMvEffectCode(normalizeMvEffect(effectValue).code) }"
    >
      <template v-if="isStandardMvEffectCode(normalizeMvEffect(effectValue).code)">
        <label>
          <span>{{ t('eventEditorDialog.type') }}</span>
          <select
            :value="normalizeMvEffect(effectValue).code"
            @change="changeEffectCode(index, effectValue, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="option in localizedEffectCodes" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label v-if="needsTarget(normalizeMvEffect(effectValue).code)">
          <span>{{ t('db.target') }}</span>
          <select
            :value="normalizeMvEffect(effectValue).dataId"
            @change="changeTarget(index, effectValue, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="option in targetOptions(effectValue)" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <span v-else-if="normalizeMvEffect(effectValue).code === 41" class="semantic-fixed">{{ t('db.effectEscape') }}</span>
        <label v-for="spec in mvEffectNumericSpecs(normalizeMvEffect(effectValue).code)" :key="spec.field">
          <span>{{ numericLabel(spec.label) }}</span>
          <span class="numeric-input">
            <input
              type="number"
              :min="spec.minimum"
              :max="spec.maximum"
              :step="spec.step"
              :value="mvEffectEditorValue(effectValue, spec.field)"
              @input="changeNumeric(index, effectValue, spec.field, ($event.target as HTMLInputElement).value)"
            />
            <b v-if="spec.kind === 'percent'">%</b>
          </span>
        </label>
        <button type="button" class="danger" @click="removeEffect(index)">{{ t('cmdList.delete') }}</button>
      </template>
      <template v-else>
        <div class="plugin-summary">
          <strong>{{ t('db.pluginEffectCode', { code: normalizeMvEffect(effectValue).code }) }}</strong>
          <span>{{ t('db.pluginSemanticReadonly') }}</span>
          <code>dataId {{ normalizeMvEffect(effectValue).dataId }} · value1 {{ normalizeMvEffect(effectValue).value1 }} · value2 {{ normalizeMvEffect(effectValue).value2 }}</code>
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
.semantic-fixed { align-self: center; color: var(--el-text-color-secondary); font-size: 12px; }
.semantic-empty { padding: 10px 0; color: var(--el-text-color-placeholder); font-size: 12px; }
.semantic-row.plugin { grid-template-columns: 1fr; border-style: dashed; }
.plugin-summary { display: grid; gap: 3px; }
.plugin-summary strong { font-size: 12px; }
.plugin-summary span, .plugin-summary code { color: var(--el-text-color-secondary); font-size: 11px; }
button.danger { color: var(--el-color-danger); }
.semantic-row > button { justify-self: end; }
</style>
