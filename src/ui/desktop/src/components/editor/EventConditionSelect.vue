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
  gap: 6px;
  min-height: 26px;
  margin-bottom: 4px;
  color: var(--app-ink);
  font-size: 12px;
}

.row span {
  flex: 0 0 68px;
  line-height: 1.25;
}

.row select {
  min-width: 0;
  flex: 1;
  height: 26px;
  padding: 0 3px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: 12px;
}
</style>
