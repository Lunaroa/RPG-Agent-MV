<script setup lang="ts">
import { nextTick, ref, watch, type CSSProperties } from 'vue'
import type { UiDesignerDocument, UiNode } from '@contract/ui-designer'
import type { UiDesignerRendererNodeBounds } from '@contract/ui-designer-renderer-bridge'
import { nodeRect, resizeCursor, type UiResizeHandle } from '../models/geometry'

const props = defineProps<{
  node: UiNode
  document: UiDesignerDocument
  nodeIndex: ReadonlyMap<string, UiNode>
  selectedIds: string[]
  hoveredNodeId?: string
  previewing: boolean
  /** The current container edit frame is a boundary, not an editable node. */
  interactionDisabled?: boolean
  originX: number
  originY: number
  ancestorIds?: string[]
  draftPositions?: Record<string, { x: number; y: number }>
  draftRects?: Record<string, { x: number; y: number; width: number; height: number }>
  draftRotations?: Record<string, number>
  rendererBounds?: Record<string, UiDesignerRendererNodeBounds>
  inlineEditingNodeId?: string
  inlineEditingValue?: string
}>()
const emit = defineEmits<{ pointerdown: [payload: { event: PointerEvent; node: UiNode }]; select: [payload: { event: MouseEvent; node: UiNode }]; contextmenu: [payload: { event: MouseEvent; node: UiNode }]; activate: [payload: { node: UiNode }]; handlepointerdown: [payload: { event: PointerEvent; node: UiNode; handle: string }]; updateInlineText: [value: string]; commitInlineText: []; cancelInlineText: [] }>()
const resizeHandles: UiResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const inlineInput = ref<HTMLInputElement | HTMLTextAreaElement>()

const byId = (id: string) => props.nodeIndex.get(id)
const rect = () => nodeRect(props.node)
const currentRect = () => props.draftRects?.[props.node.id] ?? props.rendererBounds?.[props.node.id] ?? rect()
const localStyle = (): CSSProperties => {
  const rendered = props.rendererBounds?.[props.node.id]
  const value = currentRect()
  const draft = props.draftPositions?.[props.node.id]
  const left = draft ? draft.x - value.width * props.node.props.anchorX : value.x
  const top = draft ? draft.y - value.height * props.node.props.anchorY : value.y
  return {
    left: `${left - props.originX}px`,
    top: `${top - props.originY}px`,
    width: `${value.width}px`,
    height: `${value.height}px`,
    zIndex: props.node.props.zIndex,
    visibility: rendered && !rendered.visible ? 'hidden' : undefined,
    transform: `rotate(${props.draftRotations?.[props.node.id] ?? rendered?.rotation ?? props.node.props.rotate}deg)`,
    transformOrigin: `${props.node.props.anchorX * 100}% ${props.node.props.anchorY * 100}%`,
    pointerEvents: props.interactionDisabled || (props.previewing && rendered?.interactive === false) ? 'none' : 'auto',
  }
}
const selected = () => props.selectedIds.includes(props.node.id)
const ancestorIds = () => [...(props.ancestorIds ?? []), props.node.id]
const canRenderChild = (id: string) => !ancestorIds().includes(id)
const forwardPointer = (payload: { event: PointerEvent; node: UiNode }) => emit('pointerdown', payload)
const forwardSelect = (payload: { event: MouseEvent; node: UiNode }) => emit('select', payload)
const forwardContextMenu = (payload: { event: MouseEvent; node: UiNode }) => emit('contextmenu', payload)
const forwardActivate = (payload: { node: UiNode }) => emit('activate', payload)
const forwardHandle = (payload: { event: PointerEvent; node: UiNode; handle: string }) => emit('handlepointerdown', payload)
const handleStyle = (handle: UiResizeHandle): CSSProperties => ({ cursor: resizeCursor(handle, props.draftRotations?.[props.node.id] ?? props.node.props.rotate) })
const updateInlineText = (event: Event) => emit('updateInlineText', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
const handleInlineKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('cancelInlineText')
  } else if (event.key === 'Enter' && (props.node.type === 'button' || event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    event.stopPropagation()
    emit('commitInlineText')
  }
}
watch(() => props.inlineEditingNodeId === props.node.id, (active) => {
  if (active) void nextTick(() => { inlineInput.value?.focus(); inlineInput.value?.select() })
}, { flush: 'post', immediate: true })
</script>

<template>
  <div
    class="canvas-node"
    :class="[`node-${node.type}`, { selected: selected(), hovered: props.hoveredNodeId === node.id, locked: node.locked, 'interaction-disabled': props.interactionDisabled, clipped: node.type === 'container' && node.props.clip }]"
    :style="localStyle()"
    :data-node-id="node.id"
    :data-ui-id="`ui-designer-canvas-node-${node.id}`"
    @pointerdown.stop="emit('pointerdown', { event: $event, node })"
    @click.stop="emit('select', { event: $event, node })"
    @contextmenu.stop.prevent="emit('contextmenu', { event: $event, node })"
    @dblclick.stop="!props.interactionDisabled && !node.locked && emit('activate', { node })"
  >
    <template v-for="childId in node.children" :key="childId">
      <UiCanvasNode
        v-if="byId(childId) && canRenderChild(childId)"
        :node="byId(childId)!"
        :document="document"
        :node-index="nodeIndex"
        :selected-ids="selectedIds"
        :hovered-node-id="hoveredNodeId"
        :previewing="previewing"
        :interaction-disabled="false"
        :origin-x="currentRect().x"
        :origin-y="currentRect().y"
        :ancestor-ids="ancestorIds()"
        :draft-positions="draftPositions"
        :draft-rects="draftRects"
        :draft-rotations="draftRotations"
        :renderer-bounds="rendererBounds"
        :inline-editing-node-id="inlineEditingNodeId"
        :inline-editing-value="inlineEditingValue"
        @pointerdown="forwardPointer"
        @select="forwardSelect"
        @contextmenu="forwardContextMenu"
        @activate="forwardActivate"
        @handlepointerdown="forwardHandle"
        @update-inline-text="emit('updateInlineText', $event)"
        @commit-inline-text="emit('commitInlineText')"
        @cancel-inline-text="emit('cancelInlineText')"
      />
    </template>
    <textarea v-if="inlineEditingNodeId === node.id && node.type === 'text'" ref="inlineInput" class="canvas-inline-editor canvas-inline-editor-text" :value="inlineEditingValue ?? ''" :aria-label="node.name" :data-ui-id="`ui-designer-inline-text-${node.id}`" @input="updateInlineText" @pointerdown.stop @click.stop @dblclick.stop @keydown="handleInlineKeydown" @blur="emit('commitInlineText')" />
    <input v-else-if="inlineEditingNodeId === node.id && node.type === 'button'" ref="inlineInput" class="canvas-inline-editor canvas-inline-editor-button" type="text" :value="inlineEditingValue ?? ''" :aria-label="node.name" :data-ui-id="`ui-designer-inline-button-${node.id}`" @input="updateInlineText" @pointerdown.stop @click.stop @dblclick.stop @keydown="handleInlineKeydown" @blur="emit('commitInlineText')" />
    <div v-if="selected() && !previewing && !node.locked && !props.interactionDisabled && inlineEditingNodeId !== node.id" class="selection-handles" aria-hidden="true">
      <i v-for="position in resizeHandles" :key="position" :class="`handle-${position}`" :style="handleStyle(position)" :data-ui-id="`ui-designer-resize-${node.id}-${position}`" @pointerdown.stop="emit('handlepointerdown', { event: $event, node, handle: position })" />
      <i class="handle-rotate" :data-ui-id="`ui-designer-rotate-${node.id}`" @pointerdown.stop="emit('handlepointerdown', { event: $event, node, handle: 'rotate' })" />
    </div>
    <span class="node-label">{{ node.name }}</span>
  </div>
</template>

<style scoped>
.canvas-node { position: absolute; box-sizing: border-box; border: 1px dashed #ffffff40; color: #fff; cursor: move; }
.canvas-node.locked { cursor: not-allowed; opacity: .72; }
.canvas-node.interaction-disabled { cursor: default; border-style: solid; border-color: #ffffff24; }
.canvas-node:hover, .canvas-node.selected { border-color: var(--app-accent); }
.canvas-node.hovered { outline: 2px solid var(--el-color-warning); outline-offset: 1px; }
.canvas-node.clipped { overflow: hidden; }
.node-label { position: absolute; left: 2px; top: -16px; max-width: 150px; color: #d7dae2; font-size: 10px; white-space: nowrap; pointer-events: none; }
.canvas-inline-editor { position: absolute; inset: 0; z-index: 5; box-sizing: border-box; width: 100%; min-width: 48px; height: 100%; min-height: 28px; margin: 0; border: 1px solid var(--app-accent); border-radius: 3px; outline: 0; background: #10131ef2; color: #fff; font: inherit; cursor: text; }
.canvas-inline-editor-text { padding: 6px; resize: none; }
.canvas-inline-editor-button { padding: 0 8px; text-align: center; }
.selection-handles i { position: absolute; z-index: 3; width: 16px; height: 16px; border: 0; background: transparent; touch-action: none; }
.selection-handles i::after { position: absolute; left: 4px; top: 4px; width: 6px; height: 6px; border: 1px solid #12141b; border-radius: 1px; background: var(--app-accent); content: ''; }
.handle-nw { left: -8px; top: -8px; }.handle-ne { right: -8px; top: -8px; }.handle-sw { left: -8px; bottom: -8px; }.handle-se { right: -8px; bottom: -8px; }
.handle-n { left: calc(50% - 8px); top: -8px; }.handle-e { right: -8px; top: calc(50% - 8px); }.handle-s { left: calc(50% - 8px); bottom: -8px; }.handle-w { left: -8px; top: calc(50% - 8px); }.handle-rotate { left: calc(50% - 8px); top: -26px; cursor: alias; }.handle-rotate::after { border-radius: 50%; background: var(--el-color-warning); }
</style>
