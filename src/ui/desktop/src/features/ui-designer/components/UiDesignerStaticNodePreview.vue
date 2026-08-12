<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import type { UiNode } from '@contract/ui-designer'

const props = defineProps<{
  node: UiNode
  resourcePreviewUrls: Record<string, string>
}>()

const normalizeResourcePath = (value: string) => value
  .replace(/\\/g, '/')
  .replace(/^\.\//, '')
  .replace(/^www\//i, '')
  .split('/')
  .map((segment) => {
    try { return decodeURIComponent(segment) } catch { return segment }
  })
  .join('/')

const resourceUrl = (value: string) => props.resourcePreviewUrls[normalizeResourcePath(value)] ?? ''

const imageSource = computed(() => {
  const node = props.node
  if (node.type === 'container') return { path: node.props.backgroundPath, fillMode: node.props.backgroundFillMode, repeatMode: node.props.backgroundRepeatMode }
  if (node.type === 'sprite') return { path: node.props.path, fillMode: node.props.fillMode, repeatMode: node.props.repeatMode }
  if (node.type === 'nineSlice') return { path: node.props.path, fillMode: 'stretch' as const, repeatMode: 'none' as const }
  if (node.type === 'frameAnimation') {
    const frame = node.props.frames[node.props.initialFrame] ?? node.props.frames[0]
    return { path: frame?.path ?? '', fillMode: node.props.fillMode, repeatMode: 'none' as const }
  }
  if (node.type === 'button') return { path: node.props.imageStates.normal, fillMode: 'stretch' as const, repeatMode: 'none' as const }
  if (node.type === 'video') return { path: node.props.posterPath, fillMode: 'contain' as const, repeatMode: 'none' as const }
  return { path: '', fillMode: 'stretch' as const, repeatMode: 'none' as const }
})

const imageUrl = computed(() => resourceUrl(imageSource.value.path))
const imageStyle = computed<CSSProperties>(() => {
  if (!imageUrl.value) return {}
  if (props.node.type === 'nineSlice') return {
    boxSizing: 'border-box',
    borderStyle: 'solid',
    borderWidth: `${props.node.props.borderTop}px ${props.node.props.borderRight}px ${props.node.props.borderBottom}px ${props.node.props.borderLeft}px`,
    borderImageSource: `url(${JSON.stringify(imageUrl.value)})`,
    borderImageSlice: `${props.node.props.borderTop} ${props.node.props.borderRight} ${props.node.props.borderBottom} ${props.node.props.borderLeft} fill`,
  }
  const tiled = imageSource.value.repeatMode !== 'none'
  const repeat = imageSource.value.repeatMode === 'horizontal'
    ? 'repeat-x'
    : imageSource.value.repeatMode === 'vertical'
      ? 'repeat-y'
      : imageSource.value.repeatMode === 'both'
        ? 'repeat'
        : 'no-repeat'
  return {
    backgroundImage: `url(${JSON.stringify(imageUrl.value)})`,
    backgroundPosition: 'center',
    backgroundRepeat: repeat,
    backgroundSize: tiled
      ? 'auto'
      : imageSource.value.fillMode === 'cover'
        ? 'cover'
        : imageSource.value.fillMode === 'contain'
          ? 'contain'
          : '100% 100%',
  }
})

const textStyle = computed<CSSProperties>(() => {
  const node = props.node
  if (node.type !== 'text' && node.type !== 'button') return {}
  const vertical = node.props.verticalAlign === 'bottom' ? 'flex-end' : node.props.verticalAlign === 'middle' ? 'center' : 'flex-start'
  const horizontal = node.props.align === 'right' ? 'flex-end' : node.props.align === 'center' ? 'center' : 'flex-start'
  return {
    alignItems: vertical,
    justifyContent: horizontal,
    boxSizing: 'border-box',
    padding: `${node.props.padding.top}px ${node.props.padding.right}px ${node.props.padding.bottom}px ${node.props.padding.left}px`,
    color: node.props.textColor,
    backgroundColor: node.type === 'button' && imageUrl.value ? 'transparent' : node.props.backgroundColor,
    border: node.type === 'button' ? `${node.props.borderWidth}px solid ${node.props.borderColor}` : undefined,
    borderRadius: node.type === 'button' ? `${node.props.borderRadius}px` : undefined,
    fontSize: `${node.props.fontSize}px`,
    fontStyle: node.props.italic ? 'italic' : 'normal',
    fontWeight: node.props.fontWeight,
    letterSpacing: `${node.props.letterSpacing}px`,
    textAlign: node.props.align,
    textShadow: `${node.props.shadowOffsetX}px ${node.props.shadowOffsetY}px ${node.props.shadowBlur}px ${node.props.shadowColor}`,
    WebkitTextStroke: node.props.strokeWidth > 0 ? `${node.props.strokeWidth}px ${node.props.strokeColor}` : undefined,
  }
})

const overlayStyle = computed<CSSProperties>(() => {
  if (props.node.type === 'overlay') return { backgroundColor: props.node.props.fillColor }
  return {}
})

const progressTrackStyle = computed<CSSProperties>(() => {
  if (props.node.type !== 'progressBar') return {}
  const image = resourceUrl(props.node.props.trackImage)
  return {
    backgroundColor: props.node.props.trackColor,
    backgroundImage: image ? `url(${JSON.stringify(image)})` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%',
    borderRadius: `${props.node.props.trackRadius}px`,
  }
})

const progressFillStyle = computed<CSSProperties>(() => {
  if (props.node.type !== 'progressBar') return {}
  const ratio = Math.max(0, Math.min(1, props.node.props.currentValue / Math.max(1, props.node.props.maxValue)))
  const vertical = props.node.props.fillDirection === 'bottomToTop' || props.node.props.fillDirection === 'topToBottom'
  const image = resourceUrl(props.node.props.fillImage)
  return {
    position: 'absolute',
    left: props.node.props.fillDirection === 'rightToLeft' ? `${(1 - ratio) * 100}%` : 0,
    right: props.node.props.fillDirection === 'leftToRight' ? `${(1 - ratio) * 100}%` : 0,
    top: props.node.props.fillDirection === 'bottomToTop' ? `${(1 - ratio) * 100}%` : 0,
    bottom: props.node.props.fillDirection === 'topToBottom' ? `${(1 - ratio) * 100}%` : 0,
    width: vertical ? '100%' : undefined,
    height: vertical ? undefined : '100%',
    backgroundColor: props.node.props.fillColor,
    backgroundImage: image ? `url(${JSON.stringify(image)})` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%',
    borderRadius: `${props.node.props.fillRadius}px`,
  }
})
</script>

<template>
  <div class="static-node-preview" :style="[imageStyle, overlayStyle, { opacity: Math.max(0, Math.min(1, node.props.opacity / 255)) }]" aria-hidden="true">
    <span v-if="node.type === 'text' || node.type === 'button'" class="static-node-text" :style="textStyle">{{ node.props.content }}</span>
    <span v-else-if="node.type === 'progressBar'" class="static-progress-track" :style="progressTrackStyle"><i :style="progressFillStyle" /></span>
  </div>
</template>

<style scoped>
.static-node-preview { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }
.static-node-text { display: flex; width: 100%; height: 100%; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.2; }
.static-progress-track { position: absolute; inset: 0; overflow: hidden; }
</style>
