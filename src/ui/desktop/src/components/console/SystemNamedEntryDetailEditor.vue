<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: unknown;
  idLabel: string;
  nameLabel: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>();

const record = computed<Record<string, unknown>>(() =>
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? props.modelValue as Record<string, unknown>
    : {});

function updateName(event: Event): void {
  emit('update:modelValue', {
    ...record.value,
    name: (event.target as HTMLInputElement).value,
  });
}
</script>

<template>
  <div class="system-named-entry-editor">
    <label>
      <span>{{ idLabel }}</span>
      <input type="text" :value="String(record.id ?? '')" readonly />
    </label>
    <label>
      <span>{{ nameLabel }}</span>
      <input
        type="text"
        :value="String(record.name ?? '')"
        @input="updateName"
      />
    </label>
  </div>
</template>

<style scoped>
.system-named-entry-editor {
  display: grid;
  gap: 14px;
  padding: 16px;
}

label {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  color: var(--app-ink-soft);
  font-size: 12px;
}

input {
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-elevated);
  color: var(--app-ink);
  font: inherit;
}

input[readonly] {
  background: var(--app-bg-sunken);
  color: var(--app-ink-muted);
}

input:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 1px;
}
</style>
