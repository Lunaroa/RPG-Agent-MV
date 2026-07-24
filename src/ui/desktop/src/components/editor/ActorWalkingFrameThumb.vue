<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { eventCharacterFrame } from '../../composables/useMapRenderer';
import { loadImageElement } from '../../utils/imageLoading';

const props = defineProps<{
  characterName?: string;
  characterIndex?: number;
  catalog?: EditorProjectCatalog | null;
  size?: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const displaySize = computed(() => Math.max(16, Math.round(props.size ?? 36)));
const cssSize = computed(() => `${displaySize.value}px`);
let paintSerial = 0;

watch(
  () => [props.characterName, props.characterIndex, props.catalog, displaySize.value] as const,
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
  const size = displaySize.value;
  target.width = size;
  target.height = size;
  const context = target.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = false;

  const characterName = String(props.characterName || '').trim();
  if (!characterName) return;
  const asset = props.catalog?.assets.characters.find((entry) => entry.name === characterName);
  if (!asset?.url) return;

  const image = await loadImageElement(asset.url);
  if (!image || serial !== paintSerial) return;
  const frame = eventCharacterFrame(image, {
    tileId: 0,
    characterName,
    characterIndex: Number.isInteger(props.characterIndex) ? Number(props.characterIndex) : 0,
    direction: 2,
    pattern: 1,
  });
  if (!frame || serial !== paintSerial) return;

  const scale = Math.min(size / frame.sw, size / frame.sh);
  const drawWidth = Math.max(1, Math.floor(frame.sw * scale));
  const drawHeight = Math.max(1, Math.floor(frame.sh * scale));
  context.drawImage(
    image,
    frame.sx,
    frame.sy,
    frame.sw,
    frame.sh,
    Math.floor((size - drawWidth) / 2),
    Math.floor((size - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
}
</script>

<template>
  <canvas
    ref="canvas"
    class="actor-walking-frame-thumb"
    :width="displaySize"
    :height="displaySize"
    aria-hidden="true"
  />
</template>

<style scoped>
.actor-walking-frame-thumb {
  display: block;
  flex: 0 0 auto;
  width: v-bind(cssSize);
  height: v-bind(cssSize);
  border-radius: 4px;
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 70%, transparent);
  image-rendering: pixelated;
}
</style>
