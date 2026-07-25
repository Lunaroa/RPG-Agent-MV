<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { useI18n } from '../../i18n';
import { normalizeAnimationFrames } from '../../utils/rmmvDatabaseEditor';
import { rotateHuePixelsLikeMv } from '../../utils/rmmvHue';

const CELL_SIZE = 192;
const PALETTE_COLUMNS = 5;
const FRAME_MS = 1000 / 15;

const props = defineProps<{
  frames: unknown;
  catalog: EditorProjectCatalog | null;
  animation1Name: string;
  animation1Hue: number;
  animation2Name: string;
  animation2Hue: number;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
}>();

const { t } = useI18n();
const width = computed(() => Math.max(1, Number(props.catalog?.screenWidth) || 816));
const height = computed(() => Math.max(1, Number(props.catalog?.screenHeight) || 624));
const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(false);
const frameIndex = ref(0);
const errors = ref<string[]>([]);
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const hueCache = new Map<string, HTMLCanvasElement>();
let renderVersion = 0;
let playTimer: ReturnType<typeof setInterval> | null = null;

const normalizedFrames = computed(() => normalizeAnimationFrames(props.frames));
const hasFrames = computed(() => normalizedFrames.value.length > 0);
const currentFrame = computed(() => normalizedFrames.value[frameIndex.value] || []);

watch(
  () => [
    props.frames,
    props.catalog?.project,
    props.animation1Name,
    props.animation1Hue,
    props.animation2Name,
    props.animation2Hue,
    width.value,
    height.value,
  ],
  () => {
    frameIndex.value = 0;
    stopPlayback();
    void renderCanvas();
  },
  { deep: true, immediate: true },
);

watch(frameIndex, () => {
  void renderCanvas();
});

onBeforeUnmount(() => {
  stopPlayback();
  renderVersion += 1;
});

function togglePlayback(): void {
  if (playing.value) {
    stopPlayback();
    return;
  }
  if (!hasFrames.value) return;
  playing.value = true;
  playTimer = setInterval(() => {
    const total = normalizedFrames.value.length;
    if (total <= 0) {
      stopPlayback();
      return;
    }
    frameIndex.value = (frameIndex.value + 1) % total;
  }, FRAME_MS);
}

function stopPlayback(): void {
  playing.value = false;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

async function renderCanvas(): Promise<void> {
  const version = ++renderVersion;
  await nextTick();
  const target = canvas.value;
  const context = target?.getContext('2d', { willReadFrequently: true });
  if (!target || !context) return;
  context.clearRect(0, 0, width.value, height.value);
  drawCanvasBackground(context);
  if (!hasFrames.value) {
    errors.value = [t('db.noAnimFrames')];
    return;
  }
  const nextErrors: string[] = [];
  const sheets = await Promise.all([
    loadSheet(0, nextErrors),
    loadSheet(1, nextErrors),
  ]);
  if (version !== renderVersion) return;
  for (const cell of currentFrame.value) {
    drawCell(context, cell, sheets);
  }
  errors.value = [...new Set(nextErrors)];
}

function drawCanvasBackground(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#171a1f';
  context.fillRect(0, 0, width.value, height.value);
  context.save();
  context.strokeStyle = 'rgba(157, 170, 184, .09)';
  context.lineWidth = 1;
  for (let x = 24; x < width.value; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height.value);
    context.stroke();
  }
  for (let y = 24; y < height.value; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width.value, y);
    context.stroke();
  }
  context.strokeStyle = 'rgba(245, 184, 75, .4)';
  context.beginPath();
  context.moveTo(width.value / 2, 0);
  context.lineTo(width.value / 2, height.value);
  context.moveTo(0, height.value / 2);
  context.lineTo(width.value, height.value / 2);
  context.stroke();
  context.restore();
}

function drawCell(
  context: CanvasRenderingContext2D,
  cell: number[],
  sheets: Array<HTMLImageElement | HTMLCanvasElement | null>,
): void {
  const pattern = cell[0];
  if (pattern < 0 || pattern > 199) return;
  const localPattern = pattern % 100;
  const sheet = sheets[Math.floor(pattern / 100)];
  if (!sheet) return;
  const scale = cell[3] / 100;
  const sourceX = (localPattern % PALETTE_COLUMNS) * CELL_SIZE;
  const sourceY = Math.floor(localPattern / PALETTE_COLUMNS) * CELL_SIZE;
  context.save();
  context.translate(width.value / 2 + cell[1], height.value / 2 + cell[2]);
  context.rotate(cell[4] * Math.PI / 180);
  context.scale(cell[5] ? -scale : scale, scale);
  context.globalAlpha = cell[6] / 255;
  context.globalCompositeOperation = blendOperation(cell[7]);
  context.drawImage(
    sheet,
    sourceX,
    sourceY,
    CELL_SIZE,
    CELL_SIZE,
    -CELL_SIZE / 2,
    -CELL_SIZE / 2,
    CELL_SIZE,
    CELL_SIZE,
  );
  context.restore();
}

function blendOperation(mode: number): GlobalCompositeOperation {
  if (mode === 1) return 'lighter';
  if (mode === 2) return 'multiply';
  if (mode === 3) return 'screen';
  return 'source-over';
}

async function loadSheet(
  index: 0 | 1,
  nextErrors: string[],
): Promise<HTMLImageElement | HTMLCanvasElement | null> {
  const name = index === 0 ? props.animation1Name : props.animation2Name;
  const hue = index === 0 ? props.animation1Hue : props.animation2Hue;
  const isNeeded = currentFrame.value.some(
    (cell) => cell[0] >= index * 100 && cell[0] < (index + 1) * 100,
  );
  if (!name) {
    if (isNeeded) nextErrors.push(t('db.animationSheetUnassigned', { sheet: index + 1 }));
    return null;
  }
  const asset = props.catalog?.assets.animations.find((entry) => entry.name === name);
  if (!asset) {
    nextErrors.push(t('db.animationSheetMissing', { name }));
    return null;
  }
  const image = await load(asset.url);
  if (!image) {
    nextErrors.push(t('db.animationSheetMissing', { name }));
    return null;
  }
  const normalizedHue = ((Math.trunc(hue) % 360) + 360) % 360;
  if (!normalizedHue) return image;
  const key = `${asset.url}|${normalizedHue}`;
  const cached = hueCache.get(key);
  if (cached) return cached;
  const tinted = document.createElement('canvas');
  tinted.width = image.width;
  tinted.height = image.height;
  const context = tinted.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  rotateHuePixelsLikeMv(imageData.data, normalizedHue);
  context.putImageData(imageData, 0, 0);
  hueCache.set(key, tinted);
  return tinted;
}

function load(url: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const result = props.loadImage(url).catch(() => null);
  imageCache.set(url, result);
  return result;
}
</script>

<template>
  <div class="animation-frame-preview" data-ui-id="plugin-animation-frame-preview">
    <div class="toolbar">
      <el-button
        size="small"
        :disabled="!hasFrames"
        @click="togglePlayback"
      >
        {{ playing ? t('pluginFilePicker.audioPause') : t('pluginFilePicker.audioPlay') }}
      </el-button>
      <span class="frame-counter">
        {{ hasFrames ? `${frameIndex + 1} / ${normalizedFrames.length}` : '0 / 0' }}
      </span>
    </div>
    <canvas
      ref="canvas"
      class="preview-canvas"
      :width="width"
      :height="height"
      :aria-label="t('plugins.parameterTypeAnimation')"
    />
    <p
      v-for="(message, index) in errors"
      :key="`anim-error-${index}`"
      class="preview-error"
      role="alert"
    >
      {{ message }}
    </p>
  </div>
</template>

<style scoped>
.animation-frame-preview {
  display: grid;
  gap: 8px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.frame-counter {
  font-size: 12px;
  color: var(--console-text-muted, #756b5e);
}
.preview-canvas {
  width: 100%;
  max-height: 280px;
  border-radius: 6px;
  background: #171a1f;
  object-fit: contain;
}
.preview-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--el-color-danger) 38%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-color-danger) 8%, transparent);
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.5;
}
</style>
