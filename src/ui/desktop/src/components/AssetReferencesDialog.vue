<script setup lang="ts">
import type { ManagedAssetRef } from '@contract/types'

export interface AssetReferencesDialogLabels {
  title: string
  empty: string
  loadFailed: string
  loading: string
  close: string
}

defineProps<{
  visible: boolean
  assetName: string
  references: ManagedAssetRef[]
  loading: boolean
  failed: boolean
  labels: AssetReferencesDialogLabels
}>()

const emit = defineEmits<{ close: [] }>()

function onVisibleUpdate(next: boolean) {
  if (!next) emit('close')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="`${labels.title} — ${assetName}`"
    width="560px"
    class="asset-references-dialog"
    data-ui-id="asset-references-dialog"
    @update:model-value="onVisibleUpdate"
    @close="emit('close')"
  >
    <div v-if="loading" class="asset-references-state">{{ labels.loading }}</div>
    <div v-else-if="failed" class="asset-references-state">{{ labels.loadFailed }}</div>
    <div v-else-if="references.length === 0" class="asset-references-state">{{ labels.empty }}</div>
    <ul v-else class="asset-references-list" data-ui-id="asset-references-list">
      <li v-for="(reference, index) in references" :key="`${reference.file}:${reference.path}:${index}`">
        <span class="asset-references-file">{{ reference.file }}</span>
        <span class="asset-references-path">{{ reference.path }}</span>
      </li>
    </ul>
  </el-dialog>
</template>

<style scoped>
.asset-references-state {
  padding: 18px 4px;
  color: var(--app-ink-muted);
  font-size: 13px;
  text-align: center;
}

.asset-references-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.asset-references-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--app-border);
}

.asset-references-list li:last-child {
  border-bottom: none;
}

.asset-references-file {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-ink);
  overflow-wrap: anywhere;
}

.asset-references-path {
  font-size: 11px;
  color: var(--app-ink-muted);
  font-family: var(--app-font-mono, monospace);
  overflow-wrap: anywhere;
}
</style>
