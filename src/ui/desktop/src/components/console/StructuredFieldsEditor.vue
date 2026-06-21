<script setup lang="ts">
import { useI18n } from '../../i18n';
import { databaseFieldLabel } from '../../utils/rmmvDatabaseLocalization';

defineOptions({ name: 'StructuredFieldsEditor' });
const props = withDefaults(defineProps<{ modelValue: unknown; label?: string; depth?: number }>(), { label: '', depth: 0 });
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { language, t } = useI18n();

function updateChild(key: string | number, value: unknown) {
  if (Array.isArray(props.modelValue)) {
    const next = [...props.modelValue]; next[Number(key)] = value; emit('update:modelValue', next);
  } else {
    emit('update:modelValue', { ...(props.modelValue as Record<string, unknown>), [key]: value });
  }
}
function primitive(value: unknown): boolean { return value == null || ['string', 'number', 'boolean'].includes(typeof value); }
function displayLabel(label: string): string {
  if (/^\d+$/.test(label)) return t('sf.itemN', { n: Number(label) + 1 });
  return label ? databaseFieldLabel(label, language.value) : t('sf.field');
}
function containerLabel(): string {
  const label = displayLabel(props.label);
  if (Array.isArray(props.modelValue)) return t('sf.labelItems', { label: String(label), count: props.modelValue.length });
  return label;
}
function updatePrimitive(value: unknown, raw: string | boolean) {
  if (typeof value === 'boolean') emit('update:modelValue', Boolean(raw));
  else if (typeof value === 'number') emit('update:modelValue', Number(raw));
  else emit('update:modelValue', String(raw));
}
</script>

<template>
  <label v-if="primitive(modelValue)" class="field">
    <span>{{ displayLabel(label) }}</span>
    <input v-if="typeof modelValue === 'boolean'" type="checkbox" :checked="modelValue" @change="updatePrimitive(modelValue, ($event.target as HTMLInputElement).checked)">
    <input v-else-if="typeof modelValue === 'number'" type="number" :value="modelValue" :disabled="label === 'id'" @input="updatePrimitive(modelValue, ($event.target as HTMLInputElement).value)">
    <textarea v-else-if="String(modelValue ?? '').length > 90" :value="String(modelValue ?? '')" @input="updatePrimitive(modelValue, ($event.target as HTMLTextAreaElement).value)"></textarea>
    <input v-else :value="String(modelValue ?? '')" @input="updatePrimitive(modelValue, ($event.target as HTMLInputElement).value)">
  </label>
  <details v-else class="object" :open="depth < 2">
    <summary>{{ containerLabel() }}</summary>
    <div class="children">
      <StructuredFieldsEditor
        v-for="(value, key) in (modelValue as any)"
        :key="String(key)"
        :model-value="value"
        :label="String(key)"
        :depth="depth + 1"
        @update:model-value="updateChild(key, $event)"
      />
    </div>
  </details>
</template>

<style scoped>
.field{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:start;padding:5px 0;font-size:11px}.field>span{padding-top:7px;color:var(--app-ink-muted);word-break:break-all}.field input:not([type=checkbox]),.field textarea{width:100%;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg);padding:6px 8px;color:var(--app-ink);font:11px var(--app-font-mono)}.field textarea{min-height:70px;resize:vertical}.field input:disabled{opacity:.6}.object{margin:5px 0;border:1px solid var(--app-border);border-radius:var(--app-radius-md);overflow:hidden}.object>summary{padding:7px 9px;background:var(--app-bg-soft);color:var(--app-ink-soft);font-size:11px;font-weight:700;cursor:pointer}.children{padding:5px 10px 9px}
</style>
