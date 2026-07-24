<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { loadImageElement } from '../../utils/imageLoading';

const props = defineProps<{
  iconIndex?: number;
  catalog?: EditorProjectCatalog | null;
  /** Drawn icon edge length in CSS pixels. */
  size?: number;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const displaySize = computed(() => Math.max(12, Math.round(props.size ?? 28)));
const cssSize = computed(() => `${displaySize.value}px`);
let paintSerial = 0;

watch(
  () => [props.iconIndex, props.catalog, displaySize.value] as const,
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

  const iconIndex = Math.floor(Number(props.iconIndex));
  // Index 0 is the blank IconSet cell in RMMV.
  if (!Number.isFinite(iconIndex) || iconIndex <= 0) return;

  const asset = props.catalog?.assets.system.find((entry) => entry.name === 'IconSet');
  if (!asset?.url) return;

  const image = await loadImageElement(asset.url);
  if (!image || serial !== paintSerial) return;

  const nativeCell = Math.max(1, Math.round(props.catalog?.iconSize || 32));
  const col = iconIndex % 16;
  const row = Math.floor(iconIndex / 16);
  const sx = col * nativeCell;
  const sy = row * nativeCell;
  if (sx + nativeCell > image.naturalWidth || sy + nativeCell > image.naturalHeight) return;

  context.drawImage(image, sx, sy, nativeCell, nativeCell, 0, 0, size, size);
}
</script>

<template>
  <canvas
    ref="canvas"
    class="icon-set-thumb"
    :width="displaySize"
    :height="displaySize"
    aria-hidden="true"
  />
</template>

<style scoped>
.icon-set-thumb {
  display: block;
  flex: 0 0 auto;
  width: v-bind(cssSize);
  height: v-bind(cssSize);
  image-rendering: pixelated;
}
</style>
