<script setup lang="ts">
import { computed, isRef, nextTick, ref, watch, type Ref } from 'vue'
import type { UiDesignerNodeType, UiNode } from '@contract/ui-designer'
import { UI_DESIGNER_NODE_TYPES } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { isDescendant } from '../models/tree'

interface NodeTreeEntry {
  id: string
  label: string
  type: UiDesignerNodeType
  children?: NodeTreeEntry[]
}

const props = defineProps<{ designer: UiDesignerController }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const search = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')
const anchorId = ref<string>()
const treeRef = ref<{ filter: (value: string) => void; expandAll?: () => void; collapseAll?: () => void }>()
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const document = computed(() => unwrap(designer.document))
const selectedIds = computed(() => unwrap(designer.selectedIds))
const selectedNode = computed(() => unwrap(designer.selectedNode))
const actionError = computed(() => unwrap(designer.actionError))

const labels: Record<UiDesignerNodeType, UiDesignerMessageKey> = {
  container: 'nodeContainer', sprite: 'nodeSprite', nineSlice: 'nodeNineSlice', frameAnimation: 'nodeFrameAnimation', button: 'nodeButton', text: 'nodeText', progressBar: 'nodeProgressBar', overlay: 'nodeOverlay', video: 'nodeVideo', particle: 'nodeParticle',
}

const labelFor = (type: UiDesignerNodeType) => t(labels[type])
const nodeLabel = (node: UiNode) => `${node.name} · ${labelFor(node.type)}`
const flattenedEntries = computed(() => {
  const result: NodeTreeEntry[] = []
  const visit = (entries: NodeTreeEntry[]) => entries.forEach((entry) => { result.push(entry); if (entry.children) visit(entry.children) })
  visit(treeData.value)
  return result
})

const treeData = computed<NodeTreeEntry[]>(() => {
  const byId = new Map(document.value.nodes.map((node) => [node.id, node]))
  const build = (node: UiNode): NodeTreeEntry => ({
    id: node.id,
    label: nodeLabel(node),
    type: node.type,
    children: node.children.map((id) => byId.get(id)).filter((child): child is UiNode => Boolean(child)).map(build),
  })
  return document.value.nodes.filter((node) => node.parentId === null).map(build)
})

watch(search, (value) => {
  void nextTick(() => treeRef.value?.filter(value))
})

const select = (entry: NodeTreeEntry, event: MouseEvent) => {
  if (event.shiftKey && anchorId.value) {
    const start = flattenedEntries.value.findIndex((item) => item.id === anchorId.value)
    const end = flattenedEntries.value.findIndex((item) => item.id === entry.id)
    if (start >= 0 && end >= 0) {
      const [from, to] = start < end ? [start, end] : [end, start]
      designer.selectNodes(flattenedEntries.value.slice(from, to + 1).map((item) => item.id))
      return
    }
  }
  designer.selectNodes([entry.id], event.metaKey || event.ctrlKey)
  anchorId.value = entry.id
}
// Element Plus emits node-click(data, node, component, event); the fourth
// argument is the actual pointer event needed for Ctrl/Shift range selection.
const handleNodeClick = (entry: NodeTreeEntry, _node: unknown, _component: unknown, event?: MouseEvent) => {
  select(entry, event ?? ({ shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent))
}

const addNode = (type: UiDesignerNodeType) => {
  designer.addNode(type)
}

const toggleLock = (id: string) => {
  const node = document.value.nodes.find((candidate) => candidate.id === id)
  if (node) designer.setNodeLocked(id, !node.locked)
}
const toggleVisibility = (id: string) => {
  const node = document.value.nodes.find((candidate) => candidate.id === id)
  if (node) designer.updateNodeProperty(id, 'visible', !node.props.visible)
}

const nodeFor = (id: string) => document.value.nodes.find((node) => node.id === id)
const siblingIds = (id: string) => {
  const node = nodeFor(id)
  if (!node) return []
  if (node.parentId === null) return document.value.zOrder
  return nodeFor(node.parentId)?.children ?? []
}
const canMoveStep = (id: string, direction: 'up' | 'down') => {
  const node = nodeFor(id)
  if (!node || id === 'node_root' || node.locked) return false
  const siblings = siblingIds(id)
  const index = siblings.indexOf(id)
  return index >= 0 && (direction === 'up' ? index > 0 : index < siblings.length - 1)
}
const canMoveToEdge = (id: string, edge: 'top' | 'bottom') => {
  const node = nodeFor(id)
  if (!node || id === 'node_root' || node.locked) return false
  const siblings = siblingIds(id)
  const index = siblings.indexOf(id)
  return index >= 0 && (edge === 'top' ? index < siblings.length - 1 : index > 0)
}

const startRename = (entry: NodeTreeEntry) => {
  editingId.value = entry.id
  editingName.value = document.value.nodes.find((node) => node.id === entry.id)?.name ?? entry.label
}
const finishRename = () => {
  if (editingId.value) designer.renameNode(editingId.value, editingName.value)
  editingId.value = null
}

const contextCommand = (command: string, id: string) => {
  if (command === 'expandAll') { treeRef.value?.expandAll?.(); return }
  if (command === 'collapseAll') { treeRef.value?.collapseAll?.(); return }
  designer.selectNodes([id])
  if (command === 'copy') designer.copy()
  else if (command === 'cut') { designer.copy(); designer.removeSelected() }
  else if (command === 'paste') designer.paste()
  else if (command === 'rename') startRename({ id, label: '', type: document.value.nodes.find((node) => node.id === id)?.type ?? 'container' })
  else if (command === 'toggleVisibility') toggleVisibility(id)
  else if (command === 'toggleLock') toggleLock(id)
  else if (command === 'duplicate') designer.duplicateSelected()
  else if (command === 'group') designer.group()
  else if (command === 'addChild') designer.addNode('text', id)
  else if (command === 'moveUp' && canMoveStep(id, 'up')) designer.moveStep(id, 'up')
  else if (command === 'moveDown' && canMoveStep(id, 'down')) designer.moveStep(id, 'down')
  else if (command === 'moveTop' && canMoveToEdge(id, 'top')) designer.moveToEdge(id, 'top')
  else if (command === 'moveBottom' && canMoveToEdge(id, 'bottom')) designer.moveToEdge(id, 'bottom')
  else if (command === 'sameType') {
    const type = document.value.nodes.find((node) => node.id === id)?.type
    if (type) designer.selectNodes(document.value.nodes.filter((node) => node.type === type).map((node) => node.id))
  }
  else if (command === 'delete' && id !== 'node_root') designer.removeSelected()
}

const normalizeDropPosition = (type: string) => type === 'prev' ? 'before' : type === 'next' ? 'after' : type === 'inner' ? 'inner' : undefined
const allowDrop = (draggingNode: { data?: NodeTreeEntry }, dropNode: { data?: NodeTreeEntry }, type: string) => {
  const dragging = draggingNode?.data?.id ? document.value.nodes.find((node) => node.id === draggingNode.data?.id) : undefined
  const drop = dropNode?.data?.id ? document.value.nodes.find((node) => node.id === dropNode.data?.id) : undefined
  if (!dragging || !drop || dragging.id === 'node_root') return false
  const position = normalizeDropPosition(type)
  if (!position || position === 'inner' && drop.type !== 'container') return false
  if (drop.id === dragging.id || isDescendant(document.value, dragging.id, drop.id)) return false
  return !dragging.locked
}

const handleDrop = (draggingNode: { data: NodeTreeEntry }, dropNode: { data: NodeTreeEntry }, dropType: string) => {
  if (!draggingNode?.data?.id) return
  const position = normalizeDropPosition(dropType) ?? 'inner'
  designer.reparent(draggingNode.data.id, dropNode?.data?.id ?? null, position as 'before' | 'after' | 'inner')
}
const handleKeydown = (event: KeyboardEvent) => {
  if ((event.target as HTMLElement | null)?.matches?.('input,textarea,select,[contenteditable="true"],.CodeMirror,button')) return
  if (event.key === 'Delete') { event.preventDefault(); designer.removeSelected() }
  else if (event.key === 'F2' && selectedIds.value.length) { event.preventDefault(); startRename({ id: selectedIds.value[0], label: '', type: document.value.nodes.find((node) => node.id === selectedIds.value[0])?.type ?? 'container' }) }
  else if (event.key === 'Enter' && selectedIds.value.length) { event.preventDefault(); designer.selectNodes([selectedIds.value[0]]) }
  else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && flattenedEntries.value.length) {
    event.preventDefault()
    const current = flattenedEntries.value.findIndex((entry) => entry.id === selectedIds.value[0])
    const next = Math.max(0, Math.min(flattenedEntries.value.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)))
    const id = flattenedEntries.value[next]?.id
    if (id) { designer.selectNodes([id]); anchorId.value = id }
  }
  else if (event.key.toLowerCase() === 'c' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); designer.copy() }
  else if (event.key.toLowerCase() === 'x' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); designer.copy(); designer.removeSelected() }
  else if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); designer.paste() }
}
</script>

<template>
  <section class="node-panel" tabindex="0" @keydown="handleKeydown">
    <div class="panel-heading">
      <span>{{ t('nodeTree') }}</span>
      <el-button size="small" text :disabled="!selectedNode" @click="designer.duplicateSelected()">{{ t('duplicateNode') }}</el-button>
    </div>
    <el-input v-model="search" size="small" clearable :placeholder="t('searchNodes')" />
    <el-tree
      ref="treeRef"
      class="node-tree"
      :data="treeData"
      node-key="id"
      draggable
      highlight-current
      default-expand-all
      :allow-drop="allowDrop"
      :filter-node-method="(value: string, data: NodeTreeEntry) => !value || data.label.toLocaleLowerCase().includes(value.toLocaleLowerCase())"
      @node-click="handleNodeClick"
      @node-drop="handleDrop"
    >
      <template #default="{ data }">
        <el-dropdown trigger="contextmenu" @command="(command: string) => contextCommand(command, data.id)">
        <span class="node-tree-entry" :class="{ selected: selectedIds.includes(data.id), locked: document.nodes.find((node) => node.id === data.id)?.locked }" @mouseenter="designer.setHoveredNode(data.id)" @mouseleave="designer.setHoveredNode(undefined)" @dblclick.stop="startRename(data)">
          <span class="node-kind">{{ labelFor(data.type) }}</span>
          <el-input v-if="editingId === data.id" v-model="editingName" size="small" :placeholder="t('nodeNamePlaceholder')" @keyup.enter="finishRename" @blur="finishRename" />
          <span v-else class="node-name">{{ data.label.split(' · ')[0] }}</span>
          <span class="node-row-actions">
            <el-button size="small" text @click.stop="toggleVisibility(data.id)">{{ document.nodes.find((node) => node.id === data.id)?.props.visible ? '👁' : '◌' }}</el-button>
            <el-button size="small" text @click.stop="toggleLock(data.id)">{{ document.nodes.find((node) => node.id === data.id)?.locked ? '🔒' : '🔓' }}</el-button>
            <el-button size="small" text type="danger" :disabled="data.id === 'node_root'" @click.stop="designer.selectNodes([data.id]); designer.removeSelected()">×</el-button>
          </span>
        </span>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="copy">{{ t('copyAction') }}</el-dropdown-item><el-dropdown-item command="cut" :disabled="data.id === 'node_root' || document.nodes.find((node) => node.id === data.id)?.locked">{{ t('cutAction') }}</el-dropdown-item><el-dropdown-item command="paste" :disabled="document.nodes.find((node) => node.id === data.id)?.type !== 'container'">{{ t('pasteAction') }}</el-dropdown-item><el-dropdown-item command="addChild" :disabled="document.nodes.find((node) => node.id === data.id)?.type !== 'container'">{{ t('addChild') }}</el-dropdown-item><el-dropdown-item command="rename">{{ t('renameNode') }}</el-dropdown-item><el-dropdown-item command="duplicate">{{ t('duplicateNode') }}</el-dropdown-item><el-dropdown-item command="group" :disabled="selectedIds.length < 2">{{ t('group') }}</el-dropdown-item><el-dropdown-item command="sameType">{{ t('selectSameType') }}</el-dropdown-item><el-dropdown-item command="moveUp" :disabled="!canMoveStep(data.id, 'up')">{{ t('moveUp') }}</el-dropdown-item><el-dropdown-item command="moveDown" :disabled="!canMoveStep(data.id, 'down')">{{ t('moveDown') }}</el-dropdown-item><el-dropdown-item command="moveTop" :disabled="!canMoveToEdge(data.id, 'top')">{{ t('moveTop') }}</el-dropdown-item><el-dropdown-item command="moveBottom" :disabled="!canMoveToEdge(data.id, 'bottom')">{{ t('moveBottom') }}</el-dropdown-item><el-dropdown-item command="expandAll">{{ t('expandAll') }}</el-dropdown-item><el-dropdown-item command="collapseAll">{{ t('collapseAll') }}</el-dropdown-item><el-dropdown-item command="toggleVisibility">{{ document.nodes.find((node) => node.id === data.id)?.props.visible ? t('hideNode') : t('showNode') }}</el-dropdown-item><el-dropdown-item command="toggleLock">{{ document.nodes.find((node) => node.id === data.id)?.locked ? t('unlockNode') : t('lockNode') }}</el-dropdown-item><el-dropdown-item divided command="delete" :disabled="data.id === 'node_root' || document.nodes.find((node) => node.id === data.id)?.locked">{{ t('deleteNode') }}</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
      </template>
    </el-tree>

    <div class="panel-heading type-heading">
      <span>{{ t('nodeTypes') }}</span>
    </div>
    <div class="node-types">
      <el-button v-for="type in UI_DESIGNER_NODE_TYPES" :key="type" size="small" plain draggable="true" @dragstart="(event: DragEvent) => event.dataTransfer?.setData('text/ui-node-type', type)" @click="addNode(type)">
        {{ labelFor(type) }}
      </el-button>
    </div>

    <div class="node-actions">
      <el-button size="small" :disabled="selectedIds.length === 0" @click="designer.group()">{{ t('group') }}</el-button>
      <el-button size="small" type="danger" plain :disabled="selectedIds.length === 0" @click="designer.removeSelected()">{{ t('deleteNode') }}</el-button>
    </div>
    <p v-if="actionError" class="panel-error"><span>{{ t('operationError') }}</span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ actionError }}</span></details></p>
  </section>
</template>

<style scoped>
.node-panel { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.node-tree { flex: 1; min-height: 150px; overflow: auto; background: transparent; --el-tree-node-hover-bg-color: color-mix(in srgb, var(--app-accent) 14%, transparent); --el-tree-text-color: var(--app-ink); }
.node-tree :deep(.el-dropdown) { display: block; width: 100%; }
.node-tree-entry { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; font-size: 12px; }.node-tree-entry.locked { color: var(--app-ink-soft); }.node-row-actions { display: none; margin-left: auto; }.node-tree-entry:hover .node-row-actions { display: inline-flex; }.node-row-actions .el-button { padding: 1px 3px; }
.status-detail { color: var(--app-ink-soft); font-size: 10px; }
.node-kind { color: var(--app-ink-soft); font-size: 10px; }
.node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; max-height: 220px; overflow: auto; }
.node-types .el-button { margin: 0; overflow: hidden; text-overflow: ellipsis; }
.type-heading { margin-top: 4px; }
.node-actions { display: flex; gap: 6px; padding-top: 5px; border-top: 1px solid var(--app-border); }
.node-actions .el-button { margin: 0; flex: 1; }
.panel-error { margin: 0; color: var(--el-color-danger); font-size: 11px; line-height: 1.4; }
</style>
