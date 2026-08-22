<script setup lang="ts">
import { computed, isRef, nextTick, ref, watch, type Ref } from 'vue'
import type { UiDesignerNodeType, UiNode } from '@contract/ui-designer'
import { UI_DESIGNER_NODE_TYPES } from '@contract/ui-designer'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'
import { isDescendant } from '../models/tree'
import { resolveNodeActionPolicy, type UiNodeActionCommand, type UiNodeActionPolicy } from '../models/actions'

interface NodeTreeEntry {
  id: string
  label: string
  type: UiDesignerNodeType
  children?: NodeTreeEntry[]
}

const props = defineProps<{ designer: UiDesignerController }>()
const emit = defineEmits<{ activateNode: [nodeId: string] }>()
const designer = props.designer
const { t } = useUiDesignerI18n()
const search = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')
const anchorId = ref<string>()
interface TreeExpose {
  filter: (value: string) => void
  expandAll?: () => void
  collapseAll?: () => void
  setCurrentKey?: (key: string) => void
  getNode?: (key: string) => { expanded?: boolean; expand?: () => void; collapse?: () => void }
  $el?: HTMLElement
}
const treeRef = ref<TreeExpose>()
const unwrap = <T,>(value: T | Ref<T>): T => isRef(value) ? value.value : value
const document = computed(() => unwrap(designer.document))
const selectedIds = computed(() => unwrap(designer.selectedIds))
const actionError = computed(() => unwrap(designer.actionError))
const paletteFeedback = ref('')
const paletteNodeTypes = UI_DESIGNER_NODE_TYPES.filter((type) => type !== 'overlay')

const labels: Record<UiDesignerNodeType, UiDesignerMessageKey> = {
  container: 'nodeContainer', list: 'nodeList', sprite: 'nodeSprite', nineSlice: 'nodeNineSlice', frameAnimation: 'nodeFrameAnimation', button: 'nodeButton', text: 'nodeText', progressBar: 'nodeProgressBar', overlay: 'nodeOverlay', video: 'nodeVideo', particle: 'nodeParticle',
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

const flattenTreeIds = (entries: NodeTreeEntry[], result: string[] = []) => {
  for (const entry of entries) {
    result.push(entry.id)
    if (entry.children) flattenTreeIds(entry.children, result)
  }
  return result
}

const expandedKeys = ref<string[]>([])
const rememberExpanded = (entry: NodeTreeEntry) => {
  if (!expandedKeys.value.includes(entry.id)) expandedKeys.value = [...expandedKeys.value, entry.id]
}
const rememberCollapsed = (entry: NodeTreeEntry) => {
  expandedKeys.value = expandedKeys.value.filter((id) => id !== entry.id)
}
const getExpandedKeys = () => {
  const ids = flattenTreeIds(treeData.value)
  const observed = ids.filter((id) => treeRef.value?.getNode?.(id)?.expanded)
  return observed.length ? observed : [...expandedKeys.value]
}
const setExpandedKeys = (ids: readonly string[]) => {
  const desired = new Set(ids)
  const available = flattenTreeIds(treeData.value)
  for (const id of available) {
    const node = treeRef.value?.getNode?.(id)
    if (desired.has(id)) node?.expand?.()
    else node?.collapse?.()
  }
  expandedKeys.value = available.filter((id) => desired.has(id))
}

defineExpose({ getExpandedKeys, setExpandedKeys })

watch(search, (value) => {
  void nextTick(() => treeRef.value?.filter(value))
})

const revealPrimarySelection = async () => {
  const primaryId = selectedIds.value[0]
  if (!primaryId) return
  const ancestors: string[] = []
  const seen = new Set<string>()
  let current = document.value.nodes.find((node) => node.id === primaryId)
  while (current?.parentId) {
    if (seen.has(current.parentId)) return
    seen.add(current.parentId)
    ancestors.unshift(current.parentId)
    current = document.value.nodes.find((node) => node.id === current?.parentId)
  }
  await nextTick()
  for (const id of ancestors) treeRef.value?.getNode?.(id)?.expand?.()
  treeRef.value?.setCurrentKey?.(primaryId)
  await nextTick()
  const findRow = () => [...(treeRef.value?.$el?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find((element) => element.dataset.key === primaryId)
  let row = findRow()
  if (!row && search.value) {
    search.value = ''
    await nextTick()
    treeRef.value?.filter('')
    await nextTick()
    row = findRow()
  }
  row?.scrollIntoView({ block: 'nearest' })
}

watch(selectedIds, () => { void revealPrimarySelection() }, { immediate: true })

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
  const primary = document.value.nodes.find((node) => node.id === selectedIds.value[0])
  const parentId = primary?.type === 'container' || primary?.type === 'list' ? primary.id : primary?.parentId ?? 'node_root'
  paletteFeedback.value = designer.addNode(type, parentId) ? `✓ ${labelFor(type)}` : ''
}

const toggleLock = (id: string) => {
  const node = document.value.nodes.find((candidate) => candidate.id === id)
  if (node) designer.setNodeLocked(id, !node.locked)
}
const toggleVisibility = (id: string) => {
  const node = document.value.nodes.find((candidate) => candidate.id === id)
  if (node) designer.updateNodeProperty(id, 'visible', !node.props.visible)
}

const nodePolicy = (id: string) => designer.getNodeActionPolicy(id) as UiNodeActionPolicy

const startRename = (entry: NodeTreeEntry) => {
  if (!nodePolicy(entry.id).allowed.rename) return false
  editingId.value = entry.id
  editingName.value = document.value.nodes.find((node) => node.id === entry.id)?.name ?? entry.label
  return true
}
const finishRename = () => {
  if (editingId.value) designer.renameNode(editingId.value, editingName.value)
  editingId.value = null
}

const contextCommand = (command: string, id: string) => {
  if (command === 'expandAll') { treeRef.value?.expandAll?.(); return }
  if (command === 'collapseAll') { treeRef.value?.collapseAll?.(); return }
  const policy = designer.selectNodeActionTarget(id) as UiNodeActionPolicy
  if (command === 'rename') {
    if (policy.allowed.rename) startRename({ id, label: '', type: document.value.nodes.find((node) => node.id === id)?.type ?? 'container' })
    return
  }
  designer.executeNodeAction(command as UiNodeActionCommand, id)
}

const normalizeDropPosition = (type: string) => type === 'before' || type === 'prev' ? 'before' : type === 'after' || type === 'next' ? 'after' : type === 'inner' ? 'inner' : undefined
const allowDrop = (draggingNode: { data?: NodeTreeEntry }, dropNode: { data?: NodeTreeEntry }, type: string) => {
  const dragging = draggingNode?.data?.id ? document.value.nodes.find((node) => node.id === draggingNode.data?.id) : undefined
  const drop = dropNode?.data?.id ? document.value.nodes.find((node) => node.id === dropNode.data?.id) : undefined
  if (!dragging || !drop || dragging.id === 'node_root') return false
  if (!resolveNodeActionPolicy(document.value, [dragging.id], dragging.id, false).canReparent) return false
  const position = normalizeDropPosition(type)
  if (!position || position === 'inner' && drop.type !== 'container' && drop.type !== 'list') return false
  if (drop.id === dragging.id || isDescendant(document.value, dragging.id, drop.id)) return false
  if (position === 'inner' && !resolveNodeActionPolicy(document.value, [drop.id], drop.id, false).allowed.addChild) return false
  if (position !== 'inner' && (drop.id === 'node_root' || drop.locked)) return false
  if (position !== 'inner' && drop.parentId !== null && !resolveNodeActionPolicy(document.value, [drop.parentId], drop.parentId, false).allowed.addChild) return false
  return true
}

const handleDrop = (draggingNode: { data: NodeTreeEntry }, dropNode: { data: NodeTreeEntry }, dropType: string) => {
  if (!draggingNode?.data?.id) return
  const position = normalizeDropPosition(dropType) ?? 'inner'
  designer.reparent(draggingNode.data.id, dropNode?.data?.id ?? null, position as 'before' | 'after' | 'inner')
}
const handleKeydown = (event: KeyboardEvent) => {
  if ((event.target as HTMLElement | null)?.matches?.('input,textarea,select,[contenteditable="true"],.CodeMirror,button')) return
  if (event.key === 'Delete') { event.preventDefault(); if (selectedIds.value[0]) designer.executeNodeAction('delete', selectedIds.value[0]) }
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
  else if (event.key.toLowerCase() === 'x' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (selectedIds.value[0]) designer.executeNodeAction('cut', selectedIds.value[0]) }
  else if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); designer.paste() }
}
</script>

<template>
  <section class="node-panel" data-ui-id="ui-designer-node-panel" data-testid="ui-designer-node-panel" tabindex="0" @keydown="handleKeydown">
    <div class="panel-heading">
      <span>{{ t('nodeTree') }}</span>
      <el-button size="small" text :disabled="!selectedIds[0] || !nodePolicy(selectedIds[0]).allowed.duplicate" @click="designer.duplicateSelected()">{{ t('duplicateNode') }}</el-button>
    </div>
    <el-input v-model="search" size="small" clearable :placeholder="t('searchNodes')" />
    <el-tree
      ref="treeRef"
      class="node-tree"
      :data="treeData"
      node-key="id"
      draggable
      highlight-current
      :current-node-key="selectedIds[0]"
      default-expand-all
      :allow-drop="allowDrop"
      :filter-node-method="(value: string, data: NodeTreeEntry) => !value || data.label.toLocaleLowerCase().includes(value.toLocaleLowerCase())"
      @node-expand="rememberExpanded"
      @node-collapse="rememberCollapsed"
      @node-click="handleNodeClick"
      @node-drop="handleDrop"
    >
      <template #default="{ data }">
        <el-dropdown trigger="contextmenu" @command="(command: string) => contextCommand(command, data.id)">
        <span class="node-tree-entry" :class="{ selected: selectedIds.includes(data.id), locked: document.nodes.find((node) => node.id === data.id)?.locked }" :data-node-id="data.id" :data-ui-id="`ui-designer-tree-row-${data.id}`" @mouseenter="designer.setHoveredNode(data.id)" @mouseleave="designer.setHoveredNode(undefined)" @contextmenu="designer.selectNodeActionTarget(data.id)" @dblclick.stop="emit('activateNode', data.id)">
          <span class="node-kind">{{ labelFor(data.type) }}</span>
          <el-input v-if="editingId === data.id" v-model="editingName" size="small" :placeholder="t('nodeNamePlaceholder')" @keyup.enter="finishRename" @blur="finishRename" />
          <span v-else class="node-name">{{ data.label.split(' · ')[0] }}</span>
          <span class="node-row-actions">
            <el-button size="small" text @click.stop="toggleVisibility(data.id)">{{ document.nodes.find((node) => node.id === data.id)?.props.visible ? '👁' : '◌' }}</el-button>
            <el-button size="small" text @click.stop="toggleLock(data.id)">{{ document.nodes.find((node) => node.id === data.id)?.locked ? '🔒' : '🔓' }}</el-button>
            <el-button size="small" text type="danger" :disabled="!nodePolicy(data.id).allowed.delete" :data-ui-id="`ui-designer-tree-delete-${data.id}`" @click.stop="designer.executeNodeAction('delete', data.id)">×</el-button>
          </span>
        </span>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="copy" :disabled="!nodePolicy(data.id).allowed.copy" :data-ui-id="`ui-designer-tree-command-${data.id}-copy`">{{ t('copyAction') }}</el-dropdown-item><el-dropdown-item command="cut" :disabled="!nodePolicy(data.id).allowed.cut" :data-ui-id="`ui-designer-tree-command-${data.id}-cut`">{{ t('cutAction') }}</el-dropdown-item><el-dropdown-item command="paste" :disabled="!nodePolicy(data.id).allowed.paste" :data-ui-id="`ui-designer-tree-command-${data.id}-paste`">{{ t('pasteAction') }}</el-dropdown-item><el-dropdown-item command="addChild" :disabled="!nodePolicy(data.id).allowed.addChild" :data-ui-id="`ui-designer-tree-command-${data.id}-addChild`">{{ t('addChild') }}</el-dropdown-item><el-dropdown-item command="rename" :disabled="!nodePolicy(data.id).allowed.rename" :data-ui-id="`ui-designer-tree-command-${data.id}-rename`">{{ t('renameNode') }}</el-dropdown-item><el-dropdown-item command="duplicate" :disabled="!nodePolicy(data.id).allowed.duplicate" :data-ui-id="`ui-designer-tree-command-${data.id}-duplicate`">{{ t('duplicateNode') }}</el-dropdown-item><el-dropdown-item command="group" :disabled="!nodePolicy(data.id).allowed.group" :data-ui-id="`ui-designer-tree-command-${data.id}-group`">{{ t('group') }}</el-dropdown-item><el-dropdown-item command="sameType" :disabled="!nodePolicy(data.id).allowed.sameType" :data-ui-id="`ui-designer-tree-command-${data.id}-sameType`">{{ t('selectSameType') }}</el-dropdown-item><el-dropdown-item command="moveUp" :disabled="!nodePolicy(data.id).allowed.moveUp" :data-ui-id="`ui-designer-tree-command-${data.id}-moveUp`">{{ t('moveUp') }}</el-dropdown-item><el-dropdown-item command="moveDown" :disabled="!nodePolicy(data.id).allowed.moveDown" :data-ui-id="`ui-designer-tree-command-${data.id}-moveDown`">{{ t('moveDown') }}</el-dropdown-item><el-dropdown-item command="moveTop" :disabled="!nodePolicy(data.id).allowed.moveTop" :data-ui-id="`ui-designer-tree-command-${data.id}-moveTop`">{{ t('moveTop') }}</el-dropdown-item><el-dropdown-item command="moveBottom" :disabled="!nodePolicy(data.id).allowed.moveBottom" :data-ui-id="`ui-designer-tree-command-${data.id}-moveBottom`">{{ t('moveBottom') }}</el-dropdown-item><el-dropdown-item command="expandAll">{{ t('expandAll') }}</el-dropdown-item><el-dropdown-item command="collapseAll">{{ t('collapseAll') }}</el-dropdown-item><el-dropdown-item command="toggleVisibility" :disabled="!nodePolicy(data.id).allowed.toggleVisibility" :data-ui-id="`ui-designer-tree-command-${data.id}-toggleVisibility`">{{ document.nodes.find((node) => node.id === data.id)?.props.visible ? t('hideNode') : t('showNode') }}</el-dropdown-item><el-dropdown-item command="toggleLock" :disabled="!nodePolicy(data.id).allowed.toggleLock" :data-ui-id="`ui-designer-tree-command-${data.id}-toggleLock`">{{ document.nodes.find((node) => node.id === data.id)?.locked ? t('unlockNode') : t('lockNode') }}</el-dropdown-item><el-dropdown-item divided command="delete" :disabled="!nodePolicy(data.id).allowed.delete" :data-ui-id="`ui-designer-tree-command-${data.id}-delete`">{{ t('deleteNode') }}</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
      </template>
    </el-tree>

    <div class="panel-heading type-heading">
      <span>{{ t('nodeTypes') }}</span>
      <span class="palette-feedback" aria-live="polite">{{ paletteFeedback }}</span>
    </div>
    <div class="node-types" data-ui-id="ui-designer-node-palette" data-testid="ui-designer-node-palette">
      <el-button v-for="type in paletteNodeTypes" :key="type" :data-ui-id="`ui-designer-palette-${type}`" :data-testid="`ui-designer-palette-${type}`" :aria-label="labelFor(type)" size="small" plain draggable="true" @dragstart="(event: DragEvent) => event.dataTransfer?.setData('text/ui-node-type', type)" @click="addNode(type)">
        {{ labelFor(type) }}
      </el-button>
    </div>

    <div class="node-actions">
      <el-button size="small" :disabled="!selectedIds[0] || !nodePolicy(selectedIds[0]).allowed.group" @click="designer.group()">{{ t('group') }}</el-button>
      <el-button size="small" type="danger" plain :disabled="!selectedIds[0] || !nodePolicy(selectedIds[0]).allowed.delete" @click="selectedIds[0] && designer.executeNodeAction('delete', selectedIds[0])">{{ t('deleteNode') }}</el-button>
    </div>
    <div v-if="actionError" class="panel-error"><span>{{ t('operationError') }}</span><details class="status-detail"><summary>{{ t('technicalDetails') }}</summary><span>{{ actionError }}</span></details></div>
  </section>
</template>

<style scoped>
.node-panel { display: flex; box-sizing: border-box; flex-direction: column; gap: 8px; width: 100%; min-width: 0; max-width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; min-width: 0; color: var(--app-ink-soft); font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.node-tree { flex: 1; width: 100%; min-width: 0; min-height: 150px; overflow-x: hidden; overflow-y: auto; background: transparent; --el-tree-node-hover-bg-color: color-mix(in srgb, var(--app-accent) 14%, transparent); --el-tree-text-color: var(--app-ink); }
.node-tree :deep(.el-tree-node), .node-tree :deep(.el-tree-node__children), .node-tree :deep(.el-tree-node__content) { width: 100%; min-width: 0; max-width: 100%; }
.node-tree :deep(.el-tree-node__content) { box-sizing: border-box; overflow: hidden; }
.node-tree :deep(.el-dropdown) { display: block; flex: 1 1 auto; width: auto; min-width: 0; overflow: hidden; }
.node-tree-entry { display: flex; box-sizing: border-box; align-items: center; gap: 7px; width: 100%; min-width: 0; max-width: 100%; min-height: 28px; overflow: hidden; font-size: 12px; }.node-tree-entry.locked { color: var(--app-ink-soft); }.node-row-actions { display: inline-flex; flex: 0 1 72px; max-width: 72px; justify-content: flex-end; margin-left: auto; overflow: hidden; visibility: hidden; opacity: 0; pointer-events: none; }.node-tree-entry:hover .node-row-actions, .node-tree-entry:focus-within .node-row-actions, .node-tree-entry.selected .node-row-actions { visibility: visible; opacity: 1; pointer-events: auto; }.node-row-actions .el-button { flex: 0 0 auto; padding: 1px 3px; }
.status-detail { color: var(--app-ink-soft); font-size: 10px; }
.node-kind { color: var(--app-ink-soft); font-size: 10px; }
.node-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; width: 100%; min-width: 0; max-height: 220px; overflow-x: hidden; overflow-y: auto; }
.node-types .el-button { box-sizing: border-box; width: 100%; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; }
.type-heading { margin-top: 4px; }
.palette-feedback { min-width: 0; max-width: 50%; margin-left: 8px; overflow: hidden; color: var(--el-color-success); font-size: 10px; font-weight: 500; letter-spacing: 0; text-align: right; text-overflow: ellipsis; text-transform: none; white-space: nowrap; }
.node-actions { display: flex; gap: 6px; width: 100%; min-width: 0; padding-top: 5px; border-top: 1px solid var(--app-border); }
.node-actions .el-button { margin: 0; flex: 1; }
.panel-error { margin: 0; color: var(--el-color-danger); font-size: 11px; line-height: 1.4; }
</style>
