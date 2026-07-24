<template>
  <template v-for="node in nodes" :key="node.id">
    <template v-if="node.kind === 'folder'">
      <button
        type="button"
        class="tree-row folder-row"
        :class="{ current: currentPath === node.id }"
        :style="{ paddingLeft: `${8 + depth * 14}px` }"
        :data-list-nav-id="`folder:${node.id}`"
        :aria-expanded="expandedIds.has(node.id)"
        @click="emit('activate-folder', node.id)"
      >
        <span class="tree-caret" aria-hidden="true">{{ expandedIds.has(node.id) ? '▾' : '▸' }}</span>
        <Folder class="tree-icon folder-icon" aria-hidden="true" />
        <span class="tree-label">{{ node.label }}</span>
      </button>
      <PluginFileTreeNodes
        v-if="expandedIds.has(node.id)"
        :nodes="node.children"
        :depth="depth + 1"
        :expanded-ids="expandedIds"
        :selected-name="selectedName"
        :current-path="currentPath"
        @activate-folder="emit('activate-folder', $event)"
        @select-file="emit('select-file', $event)"
        @confirm-file="emit('confirm-file', $event)"
      />
    </template>
    <button
      v-else
      type="button"
      class="tree-row file-row"
      :class="{ active: selectedName === node.id }"
      :style="{ paddingLeft: `${24 + depth * 14}px` }"
      :data-list-nav-id="`file:${node.id}`"
      :title="node.asset.name"
      @click="emit('select-file', node.asset.name)"
      @dblclick.prevent="emit('confirm-file', node.asset.name)"
    >
      <span class="tree-label">{{ node.label }}</span>
    </button>
  </template>
</template>

<script setup lang="ts">
import { Folder } from '@element-plus/icons-vue';
import type { PluginFileTreeNode } from '../../utils/pluginParameterFileBrowser';
import PluginFileTreeNodes from './PluginFileTreeNodes.vue';

defineProps<{
  nodes: PluginFileTreeNode[];
  depth: number;
  expandedIds: Set<string>;
  selectedName: string;
  currentPath: string;
}>();

const emit = defineEmits<{
  'activate-folder': [folderId: string];
  'select-file': [name: string];
  'confirm-file': [name: string];
}>();
</script>

<style scoped>
.tree-row {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border: 0;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
  color: var(--app-ink);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 11px;
}
.tree-row:hover { background: var(--app-bg-sunken); }
.tree-row.active,
.tree-row.current {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  font-weight: 600;
}
.tree-caret {
  width: 12px;
  flex: 0 0 12px;
  color: var(--app-ink-muted);
  font-size: 10px;
  text-align: center;
}
.tree-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
}
.folder-icon { color: #c9a227; }
.tree-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
