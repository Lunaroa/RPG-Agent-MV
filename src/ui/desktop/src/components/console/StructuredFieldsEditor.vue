<script setup lang="ts">
defineOptions({ name: 'StructuredFieldsEditor' });
const props = withDefaults(defineProps<{ modelValue: unknown; label?: string; depth?: number }>(), { label: '', depth: 0 });
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();

const LABELS: Record<string, string> = {
  id: '编号',
  name: '名称',
  note: '备注',
  description: '说明',
  list: '执行内容',
  trigger: '触发方式',
  switchId: '条件开关',
  switches: '开关',
  variables: '变量',
  traits: '特性',
  effects: '使用效果',
  params: '能力值',
  equips: '装备',
  damage: '伤害',
  formula: '公式',
  scope: '作用范围',
  occasion: '可用场景',
  iconIndex: '图标编号',
  price: '价格',
  classId: '职业',
  initialLevel: '初始等级',
  maxLevel: '最高等级',
  characterName: '行走图',
  characterIndex: '行走图索引',
  faceName: '脸图',
  faceIndex: '脸图索引',
  battlerName: '战斗图',
  nickname: '昵称',
  profile: '简介',
  code: '类型',
  dataId: '对象编号',
  value: '数值',
  value1: '数值 1',
  value2: '数值 2',
  parameters: '参数',
};

function updateChild(key: string | number, value: unknown) {
  if (Array.isArray(props.modelValue)) {
    const next = [...props.modelValue]; next[Number(key)] = value; emit('update:modelValue', next);
  } else {
    emit('update:modelValue', { ...(props.modelValue as Record<string, unknown>), [key]: value });
  }
}
function primitive(value: unknown): boolean { return value == null || ['string', 'number', 'boolean'].includes(typeof value); }
function displayLabel(label: string): string {
  if (/^\d+$/.test(label)) return `第 ${Number(label) + 1} 项`;
  return LABELS[label] || label || '字段';
}
function containerLabel(): string {
  const label = displayLabel(props.label);
  if (Array.isArray(props.modelValue)) return `${label} · ${props.modelValue.length} 项`;
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
