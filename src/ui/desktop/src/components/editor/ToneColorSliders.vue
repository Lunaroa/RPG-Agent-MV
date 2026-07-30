<template>
  <div class="tone-sliders">
    <div class="tone-main">
      <div class="tone-grid">
        <template v-for="(channel, index) in channels" :key="channel.label">
          <span class="tone-label">{{ channel.label }}</span>
          <el-slider
            size="small"
            :min="channel.min"
            :max="channel.max"
            :model-value="values[index] ?? 0"
            :show-tooltip="false"
            :disabled="disabled"
            @update:model-value="onSlide(index, $event)"
          />
          <input
            class="tone-value"
            type="number"
            :min="channel.min"
            :max="channel.max"
            :value="values[index] ?? 0"
            :disabled="disabled"
            @input="onInput(index, $event)"
          />
        </template>
      </div>
      <canvas v-if="preview !== 'none'" ref="previewRef" class="tone-preview" width="72" height="72" />
    </div>
    <div v-if="presets?.length" class="tone-presets">
      <button
        v-for="preset in presets"
        :key="preset.label"
        type="button"
        class="editor-btn"
        :disabled="disabled"
        @click="emit('apply', [...preset.values])"
      >
        {{ preset.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

export interface ToneChannel {
  label: string;
  min: number;
  max: number;
}

const props = withDefaults(defineProps<{
  channels: ToneChannel[];
  values: number[];
  presets?: { label: string; values: number[] }[];
  preview?: 'tone' | 'flash' | 'rgb' | 'none';
  disabled?: boolean;
}>(), { preview: 'none', disabled: false });

const emit = defineEmits<{
  change: [index: number, value: number];
  apply: [values: number[]];
}>();

const previewRef = ref<HTMLCanvasElement>();

function onSlide(index: number, value: number | number[]) {
  emit('change', index, Array.isArray(value) ? value[0] ?? 0 : value);
}

function onInput(index: number, event: Event) {
  const channel = props.channels[index];
  const raw = Number((event.target as HTMLInputElement).value) || 0;
  emit('change', index, Math.max(channel.min, Math.min(channel.max, raw)));
}

const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function paint() {
  const canvas = previewRef.value;
  if (!canvas || props.preview === 'none') return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  const [c0 = 0, c1 = 0, c2 = 0, c3 = 0] = props.values;

  if (props.preview === 'rgb') {
    context.fillStyle = `rgb(${clamp8(128 + c0)},${clamp8(128 + c1)},${clamp8(128 + c2)})`;
    context.fillRect(0, 0, width, height);
    return;
  }
  if (props.preview === 'flash') {
    context.fillStyle = '#26262b';
    context.fillRect(0, 0, width, height);
    context.fillStyle = `rgba(${clamp8(c0)},${clamp8(c1)},${clamp8(c2)},${clamp8(c3) / 255})`;
    context.fillRect(0, 0, width, height);
    return;
  }
  // Tone preview: rainbow base with the RM tone formula (gray desaturation + channel offsets).
  const gradient = context.createLinearGradient(0, 0, width, 0);
  ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'].forEach((color, index, list) => {
    gradient.addColorStop(index / (list.length - 1), color);
  });
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, 'rgba(255,255,255,0.9)');
  vertical.addColorStop(0.5, 'rgba(255,255,255,0)');
  vertical.addColorStop(1, 'rgba(0,0,0,0.9)');
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const grayRate = Math.max(0, Math.min(255, c3)) / 255;
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    const lum = (r + g + b) / 3;
    data[offset] = clamp8(r + (lum - r) * grayRate + c0);
    data[offset + 1] = clamp8(g + (lum - g) * grayRate + c1);
    data[offset + 2] = clamp8(b + (lum - b) * grayRate + c2);
  }
  context.putImageData(image, 0, 0);
}

watch(() => [...props.values, props.preview], paint);
onMounted(paint);
</script>

<style scoped>
.tone-sliders { width: 100%; display: grid; gap: 8px; }
.tone-main { display: flex; align-items: flex-start; gap: 14px; }
.tone-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 68px;
  align-items: center;
  column-gap: 10px;
  row-gap: 2px;
}
.tone-label { min-width: 34px; color: var(--app-ink-soft); font-size: 12px; }
.tone-value {
  padding: 4px 5px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
  font-size: 12px;
}
.tone-preview {
  flex: 0 0 auto;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
}
.tone-presets { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
