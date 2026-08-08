<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'
import type { UiDesignerDocument, UiFrameAnimationNode, UiNode, UiFillMode } from '@contract/ui-designer'
import { nodeRect } from '../models/geometry'
import type { UiDesignerController } from '../composables/useUiDesigner'
import { useUiDesignerI18n, type UiDesignerMessageKey } from '../i18n'

const props = defineProps<{
  node: UiNode
  document: UiDesignerDocument
  designer: UiDesignerController
  selectedIds: string[]
  hoveredNodeId?: string
  previewing: boolean
  previewCondition?: 'all-on' | 'all-off'
  /** The current container edit frame is a boundary, not an editable node. */
  interactionDisabled?: boolean
  originX: number
  originY: number
  ancestorIds?: string[]
  draftPositions?: Record<string, { x: number; y: number }>
  draftRects?: Record<string, { x: number; y: number; width: number; height: number }>
  draftRotations?: Record<string, number>
  resourceUrl: (path: string) => string | undefined
}>()
const { t } = useUiDesignerI18n()
const emit = defineEmits<{ pointerdown: [payload: { event: PointerEvent; node: UiNode }]; select: [payload: { event: MouseEvent; node: UiNode }]; enter: [payload: { node: UiNode }]; handlepointerdown: [payload: { event: PointerEvent; node: UiNode; handle: string }] }>()
const frameIndex = ref(0)
let frameTimer: ReturnType<typeof setTimeout> | undefined

const byId = (id: string) => props.document.nodes.find((node) => node.id === id)
const rect = () => nodeRect(props.node)
const localStyle = (): CSSProperties => {
  const value = props.draftRects?.[props.node.id] ?? rect()
  const draft = props.draftPositions?.[props.node.id]
  const conditionHidden = props.previewing && props.previewCondition === 'all-off' && props.node.condition.type !== 'none'
  const left = draft ? draft.x - value.width * props.node.props.anchorX : value.x
  const top = draft ? draft.y - value.height * props.node.props.anchorY : value.y
  return {
    left: `${left - props.originX}px`,
    top: `${top - props.originY}px`,
    width: `${value.width}px`,
    height: `${value.height}px`,
    zIndex: props.node.props.zIndex,
    opacity: conditionHidden || !props.node.props.visible ? 0 : props.node.props.opacity / 255,
    transform: `rotate(${props.draftRotations?.[props.node.id] ?? props.node.props.rotate}deg)`,
    transformOrigin: `${props.node.props.anchorX * 100}% ${props.node.props.anchorY * 100}%`,
    pointerEvents: props.previewing || props.node.locked || props.interactionDisabled ? 'none' : 'auto',
    animation: props.previewing && props.node.enterAnim.type !== 'none' ? `ui-designer-${props.node.enterAnim.type} ${Math.max(0, props.node.enterAnim.duration)}ms ${props.node.enterAnim.easing} both` : undefined,
  }
}
const imageFit = (fillMode: UiFillMode): CSSProperties['objectFit'] => fillMode === 'stretch' ? 'fill' : fillMode === 'tile' ? 'cover' : fillMode
const asset = (path: string) => props.resourceUrl(path)
const resourcePath = () => {
  if (props.node.type === 'sprite' || props.node.type === 'nineSlice' || props.node.type === 'video') return props.node.props.path
  if (props.node.type === 'frameAnimation') return currentFramePath()
  if (props.node.type === 'particle') return props.node.props.imagePath
  if (props.node.type === 'progressBar') return props.node.props.fillImage || props.node.props.trackImage
  return ''
}
const missingResourceLabel = (): UiDesignerMessageKey => props.node.type === 'video' ? 'missingVideoResource' : 'missingImageResource'
const selected = () => props.selectedIds.includes(props.node.id)
const displayText = () => props.node.type === 'text' || props.node.type === 'button' ? props.node.props.content : props.node.name
const ancestorIds = () => [...(props.ancestorIds ?? []), props.node.id]
const canRenderChild = (id: string) => !ancestorIds().includes(id)
const forwardPointer = (payload: { event: PointerEvent; node: UiNode }) => emit('pointerdown', payload)
const forwardSelect = (payload: { event: MouseEvent; node: UiNode }) => emit('select', payload)
const forwardEnter = (payload: { node: UiNode }) => emit('enter', payload)
const forwardHandle = (payload: { event: PointerEvent; node: UiNode; handle: string }) => emit('handlepointerdown', payload)
const frameNode = (): UiFrameAnimationNode | undefined => props.node.type === 'frameAnimation' ? props.node : undefined
const currentFrame = () => { const node = frameNode(); return node ? node.props.frames[frameIndex.value] ?? node.props.frames[0] : undefined }
const currentFramePath = () => currentFrame()?.path ?? ''
const clearFrameTimer = () => { if (frameTimer) clearTimeout(frameTimer); frameTimer = undefined }
const tickFrame = () => {
  clearFrameTimer()
  const node = frameNode()
  if (!props.previewing || !node || node.props.frames.length < 2) return
  const frame = node.props.frames[frameIndex.value]
  frameTimer = setTimeout(() => {
    if (frameIndex.value >= node.props.frames.length - 1) {
      if (node.props.loop) frameIndex.value = node.props.initialFrame % node.props.frames.length
      else return
    } else frameIndex.value += 1
    tickFrame()
  }, Math.max(16, frame.duration || node.props.defaultFrameDuration) / Math.max(0.1, node.props.speed))
}
watch(() => props.previewing, (active) => { if (active) { frameIndex.value = Math.max(0, props.node.type === 'frameAnimation' ? props.node.props.initialFrame : 0); tickFrame() } else clearFrameTimer() })
onMounted(() => { if (props.previewing) tickFrame() })
onBeforeUnmount(clearFrameTimer)
</script>

<template>
  <div
    class="canvas-node"
    :class="[`node-${node.type}`, { selected: selected(), hovered: props.hoveredNodeId === node.id, locked: node.locked, 'interaction-disabled': props.interactionDisabled, clipped: node.type === 'container' && node.props.clip }]"
    :style="localStyle()"
    :data-node-id="node.id"
    @pointerdown.stop="emit('pointerdown', { event: $event, node })"
    @click.stop="emit('select', { event: $event, node })"
    @dblclick.stop="node.type === 'container' && emit('enter', { node })"
  >
      <div class="node-content" :style="{ backgroundColor: node.type === 'overlay' ? node.props.fillColor : node.type === 'button' ? node.props.backgroundColor : node.type === 'text' ? node.props.backgroundColor : undefined }">
      <img v-if="node.type === 'sprite' && asset(node.props.path)" class="asset-image" :src="asset(node.props.path)" :alt="node.name" :style="{ objectFit: imageFit(node.props.fillMode) }" />
      <img v-else-if="node.type === 'nineSlice' && asset(node.props.path)" class="asset-image nine-slice-image" :src="asset(node.props.path)" :alt="node.name" :style="{ borderWidth: `${node.props.borderTop}px ${node.props.borderRight}px ${node.props.borderBottom}px ${node.props.borderLeft}px`, borderImage: `url(${asset(node.props.path)}) 30 fill stretch` }" />
      <img v-else-if="node.type === 'frameAnimation' && currentFramePath() && asset(currentFramePath())" class="asset-image" :src="asset(currentFramePath())" :alt="node.name" />
      <video v-else-if="node.type === 'video' && asset(node.props.path)" class="asset-video" :src="asset(node.props.path)" :autoplay="node.props.autoplay && previewing" :loop="node.props.loop" :muted="node.props.muted" :poster="asset(node.props.posterPath)" />
      <div v-else-if="node.type === 'progressBar'" class="progress-track" :style="{ backgroundColor: node.props.trackColor, borderRadius: `${node.props.trackRadius}px` }"><span :style="{ width: `${Math.max(0, Math.min(1, node.props.currentValue / Math.max(node.props.maxValue, 1))) * 100}%`, backgroundColor: node.props.fillColor, borderRadius: `${node.props.fillRadius}px` }" /></div>
      <div v-else-if="node.type === 'particle'" class="particle-preview" :style="{ backgroundColor: node.props.startColor, boxShadow: `0 0 ${node.props.glow}px ${node.props.startColor}`, animationDuration: `${Math.max(100, node.props.lifetime)}ms`, opacity: node.props.startOpacity / 255, transform: `scale(${Math.max(0.1, node.props.startScale)})` }">✦</div>
      <span v-else class="node-text">{{ displayText() }}</span>
      <span v-if="resourcePath() && !asset(resourcePath())" class="missing-asset" :title="t(missingResourceLabel())">?</span>
      <template v-for="childId in node.children" :key="childId">
        <UiCanvasNode
          v-if="byId(childId) && canRenderChild(childId)"
          :node="byId(childId)!"
          :document="document"
          :designer="designer"
          :selected-ids="selectedIds"
          :hovered-node-id="hoveredNodeId"
          :previewing="previewing"
          :preview-condition="previewCondition"
          :interaction-disabled="false"
          :origin-x="rect().x"
          :origin-y="rect().y"
          :ancestor-ids="ancestorIds()"
          :draft-positions="draftPositions"
          :draft-rects="draftRects"
          :draft-rotations="draftRotations"
          :resource-url="resourceUrl"
          @pointerdown="forwardPointer"
          @select="forwardSelect"
          @enter="forwardEnter"
          @handlepointerdown="forwardHandle"
        />
      </template>
    </div>
    <div v-if="selected() && !previewing && !node.locked && !props.interactionDisabled" class="selection-handles" aria-hidden="true">
      <i v-for="position in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="position" :class="`handle-${position}`" @pointerdown.stop="emit('handlepointerdown', { event: $event, node, handle: position })" />
      <i class="handle-rotate" @pointerdown.stop="emit('handlepointerdown', { event: $event, node, handle: 'rotate' })" />
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
.node-content { position: absolute; inset: 0; display: grid; place-items: center; overflow: visible; color: #fff; background: #ffffff10; font-size: 11px; text-align: center; pointer-events: none; }
.node-container > .node-content { background: #73daca14; }
.node-text { max-width: 100%; padding: 4px; overflow: hidden; white-space: pre-wrap; }
.asset-image { max-width: 100%; max-height: 100%; width: 100%; height: 100%; }
.nine-slice-image { object-fit: fill; border-style: solid; border-color: transparent; border-image: inherit; }
.asset-video { width: 100%; height: 100%; object-fit: contain; }
.progress-track { width: 90%; height: 35%; overflow: hidden; border-radius: 4px; }
.progress-track span { display: block; height: 100%; }
.particle-preview { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; }
.node-button:hover { filter: brightness(1.15); }.node-button:active { transform: scale(.96); }
.missing-asset { position: absolute; inset: 4px; display: grid; place-items: center; border: 2px dashed var(--el-color-danger); color: var(--el-color-danger); font-size: 22px; font-weight: 700; pointer-events: none; }
.node-particle .particle-preview { animation: particle-pulse 900ms ease-in-out infinite alternate; }
@keyframes particle-pulse { from { transform: translate(-8px, 5px) scale(.7) rotate(0deg); opacity: .35; } to { transform: translate(8px, -5px) scale(1.2) rotate(180deg); opacity: 1; } }
@keyframes ui-designer-fadeIn { from { opacity: 0; } to { opacity: 1; } } @keyframes ui-designer-fadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes ui-designer-slideFromTop { from { transform: translateY(-18px); } to { transform: translateY(0); } } @keyframes ui-designer-slideFromBottom { from { transform: translateY(18px); } to { transform: translateY(0); } } @keyframes ui-designer-slideFromLeft { from { transform: translateX(-18px); } to { transform: translateX(0); } } @keyframes ui-designer-slideFromRight { from { transform: translateX(18px); } to { transform: translateX(0); } } @keyframes ui-designer-scaleIn { from { transform: scale(.85); } to { transform: scale(1); } } @keyframes ui-designer-scaleOut { from { transform: scale(1); } to { transform: scale(.85); } }
.node-label { position: absolute; left: 2px; top: -16px; max-width: 150px; color: #d7dae2; font-size: 10px; white-space: nowrap; pointer-events: none; }
.selection-handles i { position: absolute; width: 6px; height: 6px; border: 1px solid #12141b; border-radius: 1px; background: var(--app-accent); }
.handle-nw { left: -4px; top: -4px; }.handle-ne { right: -4px; top: -4px; }.handle-sw { left: -4px; bottom: -4px; }.handle-se { right: -4px; bottom: -4px; }
.handle-n { left: calc(50% - 3px); top: -4px; }.handle-e { right: -4px; top: calc(50% - 3px); }.handle-s { left: calc(50% - 3px); bottom: -4px; }.handle-w { left: -4px; top: calc(50% - 3px); }.handle-rotate { left: calc(50% - 4px); top: -22px; width: 8px; height: 8px; border-radius: 50%; background: var(--el-color-warning); cursor: alias; }
</style>
