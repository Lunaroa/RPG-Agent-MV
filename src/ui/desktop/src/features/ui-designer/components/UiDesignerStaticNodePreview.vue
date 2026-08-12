<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import type { UiNode } from '@contract/ui-designer'
import { useUiDesignerI18n } from '../i18n'

const props = defineProps<{
  node: UiNode
  resourcePreviewUrls: Record<string, string>
}>()
const { t } = useUiDesignerI18n()

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
const videoUrl = computed(() => props.node.type === 'video' ? resourceUrl(props.node.props.path) : '')
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

const particleDots = computed(() => {
  if (props.node.type !== 'particle') return []
  const count = Math.max(1, Math.min(12, props.node.props.maxParticles))
  const image = resourceUrl(props.node.props.imagePath)
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count
    const radius = props.node.props.emissionArea === 'point' ? 12 + (index % 3) * 5 : 26 + (index % 4) * 7
    const size = Math.max(4, Math.min(24, 8 * props.node.props.startScale))
    return {
      id: index,
      style: {
        left: `calc(50% + ${Math.cos(angle) * radius}% - ${size / 2}px)`,
        top: `calc(50% + ${Math.sin(angle) * radius}% - ${size / 2}px)`,
        width: `${size}px`,
        height: `${size}px`,
        opacity: Math.max(0, Math.min(1, props.node.props.startOpacity / 255)),
        backgroundColor: props.node.props.startColor,
        backgroundImage: image ? `url(${JSON.stringify(image)})` : undefined,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'contain',
        borderRadius: props.node.props.shape === 'circle' ? '50%' : undefined,
        clipPath: props.node.props.shape === 'star' ? 'polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 94%,50% 72%,21% 94%,32% 57%,2% 35%,39% 35%)' : undefined,
        filter: props.node.props.glow > 0 ? `drop-shadow(0 0 ${Math.min(12, props.node.props.glow)}px ${props.node.props.startColor})` : undefined,
      } satisfies CSSProperties,
    }
  })
})
</script>

<template>
  <div class="static-node-preview" :style="[imageStyle, overlayStyle, { opacity: Math.max(0, Math.min(1, node.props.opacity / 255)) }]" aria-hidden="true">
    <span v-if="node.type === 'text' || node.type === 'button'" class="static-node-text" :style="textStyle">{{ node.props.content }}</span>
    <span v-else-if="node.type === 'progressBar'" class="static-progress-track" :style="progressTrackStyle"><i :style="progressFillStyle" /></span>
    <video v-else-if="node.type === 'video' && videoUrl" class="static-video" :src="videoUrl" :poster="imageUrl || undefined" muted playsinline preload="metadata" />
    <span v-else-if="node.type === 'video'" class="static-media-placeholder">{{ t('chooseVideoResource') }}</span>
    <span v-else-if="node.type === 'particle'" class="static-particle-field"><i v-for="dot in particleDots" :key="dot.id" :style="dot.style" /></span>
  </div>
</template>

<style scoped>
.static-node-preview { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }
.static-node-text { display: flex; width: 100%; height: 100%; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.2; }
.static-progress-track { position: absolute; inset: 0; overflow: hidden; }
.static-video { width: 100%; height: 100%; object-fit: contain; }
.static-media-placeholder { display: grid; width: 100%; height: 100%; place-items: center; border: 1px dashed #ffffff36; color: #ffffff8c; font-size: 12px; }
.static-particle-field { position: absolute; inset: 0; overflow: hidden; }
.static-particle-field i { position: absolute; display: block; }
</style>
