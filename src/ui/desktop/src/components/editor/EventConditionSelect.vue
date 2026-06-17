<template>
  <label class="row">
    <input :checked="valid" type="checkbox" @change="onValidChange" />
    <span>{{ label }}</span>
    <select :value="valid ? value : ''" :disabled="!valid" @change="onValueChange">
      <option value="" disabled>...</option>
      <option v-for="entry in options" :key="entry.id" :value="entry.id">
        {{ entry.id.toString().padStart(4, '0') }} {{ entry.name }}
      </option>
    </select>
    <slot />
  </label>
</template>

<script setup lang="ts">
import type { NamedCatalogEntry } from '../../api/client';

defineProps<{ valid: boolean; value: number; label: string; options: NamedCatalogEntry[] }>();

const emit = defineEmits<{ 'update:valid':[value:boolean];'update:value':[value:number];change:[] }>();

function onValidChange(event: Event) {
  emit('update:valid', (event.target as HTMLInputElement).checked);
  emit('change');
}

function onValueChange(event: Event) {
  emit('update:value', Number((event.target as HTMLSelectElement).value));
  emit('change');
}
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
  color: var(--app-ink);
  font-size: 11px;
}

.row span {
  flex: 0 0 34px;
}

.row select {
  min-width: 0;
  flex: 1;
  height: 22px;
  padding: 0 3px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: 11px;
}
</style>
