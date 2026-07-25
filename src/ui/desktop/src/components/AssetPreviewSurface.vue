<template>
  <main
    class="preview-surface"
    :class="{ 'is-panning': isPanning || spaceHeld }"
    @wheel.prevent="onPreviewWheel"
    @pointerdown="onPreviewPointerDown"
    @pointermove="onPreviewPointerMove"
    @pointerup="onPreviewPointerUp"
    @pointercancel="onPreviewPointerUp"
    @auxclick.prevent
  >
    <div class="preview-scroll" ref="previewScrollEl">
      <div
        v-if="media === 'image' && displayName && previewUrl"
        class="image-zoom-space"
        :style="{
          width: `${Math.ceil(imageNaturalWidth * previewZoom)}px`,
          height: `${Math.ceil(imageNaturalHeight * previewZoom)}px`,
          transform: `translate(${previewPanX}px, ${previewPanY}px)`,
        }"
      >
        <img
          :src="previewUrl"
          :alt="displayName"
          :style="{ transform: `scale(${previewZoom})`, transformOrigin: '0 0' }"
          draggable="false"
          @load="onImageLoad"
          @error="onPreviewImageError"
        />
      </div>
      <PluginFileAudioPreview
        v-else-if="media === 'audio' && previewUrl"
        ref="audioPreviewRef"
        :key="previewUrl"
        :src="previewUrl"
      />
      <video
        v-else-if="media === 'movie' && previewUrl"
        :key="previewUrl"
        class="movie-preview"
        :src="previewUrl"
        controls
        preload="metadata"
      />
      <AssetFontPreview
        v-else-if="media === 'font' && previewUrl"
        :key="previewUrl"
        :src="previewUrl"
        :display-name="displayName"
        :sample-text="labels.fontSample"
        :load-failed-label="labels.fontLoadFailed || labels.previewFailed"
      />
      <AssetEffectInfoPreview
        v-else-if="media === 'effect' && info"
        :display-name="displayName"
        :info="info"
      />
      <p v-else-if="displayName" class="plain-preview">
        {{ previewFailed ? labels.previewFailed : displayName }}
      </p>
      <p v-else class="plain-preview">
        {{ labels.none }}
      </p>
    </div>
    <div
      v-if="media === 'image' && displayName && previewUrl"
      class="picker-zoom"
      :aria-label="labels.previewZoom"
    >
      <button type="button" :title="labels.zoomOut" @click="zoomOut">−</button>
      <button type="button" :title="labels.resetZoom" @click="resetZoom">
        {{ Math.round(previewZoom * 100) }}%
      </button>
      <button type="button" :title="labels.zoomIn" @click="zoomIn">+</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import PluginFileAudioPreview from './editor/PluginFileAudioPreview.vue';
import AssetFontPreview from './AssetFontPreview.vue';
import AssetEffectInfoPreview from './AssetEffectInfoPreview.vue';
import type {
  AssetPreviewItem,
  AssetPreviewMediaKind,
  AssetPreviewSurfaceLabels,
} from '../utils/assetPreview';

const props = defineProps<{
  media: AssetPreviewMediaKind;
  previewUrl: string;
  displayName: string;
  previewFailed: boolean;
  /** Caller tracks Space; meaning differs per media kind outside this surface. */
  spaceHeld: boolean;
  labels: AssetPreviewSurfaceLabels;
  info?: AssetPreviewItem['info'];
}>();

const emit = defineEmits<{
  'image-error': [];
}>();

const previewScrollEl = ref<HTMLElement | null>(null);
const previewZoom = ref(1);
const previewPanX = ref(0);
const previewPanY = ref(0);
const imageNaturalWidth = ref(320);
const imageNaturalHeight = ref(240);
const isPanning = ref(false);
const audioPreviewRef = ref<{ restartFromBeginning: () => void } | null>(null);
let panPointerId: number | null = null;
let panOriginX = 0;
let panOriginY = 0;
let panStartX = 0;
let panStartY = 0;
const PREVIEW_ZOOM_MIN = 0.25;
const PREVIEW_ZOOM_MAX = 4;

/** Single owner of the identity transform (zoom 1, pan origin). */
function resetPreviewTransform(): void {
  previewZoom.value = 1;
  previewPanX.value = 0;
  previewPanY.value = 0;
}

watch(
  () => [props.previewUrl, props.displayName] as const,
  () => {
    resetPreviewTransform();
  },
);

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  imageNaturalWidth.value = Math.max(1, image.naturalWidth || 320);
  imageNaturalHeight.value = Math.max(1, image.naturalHeight || 240);
  fitPreviewToView();
}

function onPreviewImageError() {
  emit('image-error');
}

/** Fit whole image in the preview pane (min scale), never crop. */
function fitPreviewToView() {
  const scroll = previewScrollEl.value;
  const pad = 32;
  const availW = Math.max(1, (scroll?.clientWidth || 480) - pad);
  const availH = Math.max(1, (scroll?.clientHeight || 360) - pad);
  const scale = Math.min(
    1,
    availW / Math.max(1, imageNaturalWidth.value),
    availH / Math.max(1, imageNaturalHeight.value),
  );
  previewZoom.value = clampPreviewZoom(scale);
  previewPanX.value = 0;
  previewPanY.value = 0;
}

function clampPreviewZoom(value: number): number {
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value * 100) / 100));
}
function zoomIn() { previewZoom.value = clampPreviewZoom(previewZoom.value * 1.25); }
function zoomOut() { previewZoom.value = clampPreviewZoom(previewZoom.value / 1.25); }
function resetZoom() {
  resetPreviewTransform();
}
function onPreviewWheel(event: WheelEvent) {
  if (props.media !== 'image') return;
  if (event.deltaY < 0) zoomIn();
  else zoomOut();
}
function onPreviewPointerDown(event: PointerEvent) {
  if (props.media !== 'image' || !props.displayName) return;
  const middle = event.button === 1;
  const spaceDrag = event.button === 0 && props.spaceHeld;
  if (!middle && !spaceDrag) return;
  event.preventDefault();
  isPanning.value = true;
  panPointerId = event.pointerId;
  panOriginX = event.clientX;
  panOriginY = event.clientY;
  panStartX = previewPanX.value;
  panStartY = previewPanY.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function onPreviewPointerMove(event: PointerEvent) {
  if (!isPanning.value || panPointerId !== event.pointerId) return;
  previewPanX.value = panStartX + (event.clientX - panOriginX);
  previewPanY.value = panStartY + (event.clientY - panOriginY);
}
function onPreviewPointerUp(event: PointerEvent) {
  if (panPointerId !== event.pointerId) return;
  isPanning.value = false;
  panPointerId = null;
}

function restartFromBeginning(): void {
  audioPreviewRef.value?.restartFromBeginning();
}

function resetView(): void {
  resetPreviewTransform();
}

defineExpose({ restartFromBeginning, resetView });
</script>

<style scoped>
.preview-surface {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: #aeb9c3;
  touch-action: none;
}
.preview-surface.is-panning,
.preview-surface.is-panning * {
  cursor: grab;
}
.preview-surface.is-panning:active,
.preview-surface.is-panning:active * {
  cursor: grabbing;
}
.preview-scroll {
  height: 100%;
  overflow: auto;
  display: grid;
  place-items: center;
}
.image-zoom-space { position: relative; flex: 0 0 auto; }
.image-zoom-space img {
  display: block;
  image-rendering: pixelated;
}
.movie-preview {
  width: min(100%, 520px);
  margin: 24px;
}
.plain-preview {
  margin: 0;
  padding: 24px;
  color: #2a3138;
  font-size: 13px;
  text-align: center;
}
.picker-zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(20, 24, 29, .18);
}
.picker-zoom button {
  height: 26px;
  min-width: 28px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #3a414b;
  font: 600 11px var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  cursor: pointer;
}
.picker-zoom button:hover { background: #eef1f4; }
.picker-zoom button:focus-visible {
  outline: 2px solid var(--app-accent, #c45c26);
  outline-offset: 1px;
}
</style>
