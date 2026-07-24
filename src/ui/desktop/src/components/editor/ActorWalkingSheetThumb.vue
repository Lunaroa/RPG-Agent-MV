<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { loadImageElement } from '../../utils/imageLoading';

const props = defineProps<{
  characterName?: string;
  catalog?: EditorProjectCatalog | null;
  maxHeight?: number;
  maxWidth?: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const maxHeightPx = computed(() => Math.max(48, Math.round(props.maxHeight ?? 160)));
const maxWidthPx = computed(() => Math.max(48, Math.round(props.maxWidth ?? maxHeightPx.value)));
let paintSerial = 0;

watch(
  () => [props.characterName, props.catalog, maxHeightPx.value, maxWidthPx.value] as const,
  () => {
    void paint();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  paintSerial += 1;
});

async function paint(): Promise<void> {
  const serial = ++paintSerial;
  await nextTick();
  const target = canvas.value;
  if (!target) return;
  const context = target.getContext('2d');
  if (!context) return;

  const maxHeight = maxHeightPx.value;
  const maxWidth = maxWidthPx.value;
  const characterName = String(props.characterName || '').trim();
  if (!characterName) {
    target.width = Math.min(maxWidth, maxHeight);
    target.height = Math.min(maxWidth, maxHeight);
    context.clearRect(0, 0, target.width, target.height);
    return;
  }

  const asset = props.catalog?.assets.characters.find((entry) => entry.name === characterName);
  if (!asset?.url) {
    target.width = Math.min(maxWidth, maxHeight);
    target.height = Math.min(maxWidth, maxHeight);
    context.clearRect(0, 0, target.width, target.height);
    return;
  }

  const image = await loadImageElement(asset.url);
  if (!image || serial !== paintSerial) return;

  const scale = Math.min(
    1,
    maxWidth / Math.max(1, image.naturalWidth),
    maxHeight / Math.max(1, image.naturalHeight),
  );
  const drawWidth = Math.max(1, Math.floor(image.naturalWidth * scale));
  const drawHeight = Math.max(1, Math.floor(image.naturalHeight * scale));
  target.width = drawWidth;
  target.height = drawHeight;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, drawWidth, drawHeight);
  context.drawImage(image, 0, 0, drawWidth, drawHeight);
}
</script>

<template>
  <canvas
    ref="canvas"
    class="actor-walking-sheet-thumb"
    :style="{ maxWidth: `${maxWidthPx}px`, maxHeight: `${maxHeightPx}px` }"
    aria-hidden="true"
  />
</template>

<style scoped>
.actor-walking-sheet-thumb {
  display: block;
  max-width: 100%;
  margin: 0 auto;
  border-radius: 6px;
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 70%, transparent);
  image-rendering: pixelated;
}
</style>
