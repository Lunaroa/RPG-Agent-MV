<template>
  <div v-if="open && items.length" class="slash-popover" data-ui-id="slash-popover">
    <button
      v-for="(item, index) in items"
      :key="item.name"
      type="button"
      class="slash-item"
      :class="{ active: index === activeIndex }"
      @mousedown.prevent
      @click="emit('select', item.name)"
    >
      <span class="slash-name">/{{ item.name }}</span>
      <span class="slash-desc">{{ t(item.descriptionKey) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SlashCommandListItem } from '../api/client'
import { useI18n } from '../i18n'

defineProps<{
  open: boolean
  items: SlashCommandListItem[]
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [name: string]
}>()

const { t } = useI18n()
</script>

<style scoped>
.slash-popover {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: var(--radius-md);
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  z-index: 20;
}

.slash-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.slash-item.active,
.slash-item:hover {
  background: var(--el-fill-color-light);
}

.slash-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 13px;
  white-space: nowrap;
}

.slash-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
