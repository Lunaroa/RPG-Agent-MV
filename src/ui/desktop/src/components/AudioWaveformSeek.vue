<template>
  <div
    ref="host"
    class="audio-waveform-seek"
    :class="{ 'is-disabled': disabled }"
    role="slider"
    tabindex="0"
    :aria-label="ariaLabel"
    :aria-disabled="disabled"
    aria-valuemin="0"
    :aria-valuemax="finiteDuration"
    :aria-valuenow="finiteCurrentTime"
    :aria-valuetext="timeText"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeydown"
  >
    <canvas ref="canvas" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  formatPluginAudioClock,
  pluginAudioProgressRatio,
  seekTimeFromWaveformPointer,
} from '../utils/pluginFileAudioPreview';

const props = withDefaults(defineProps<{
  peaks: number[];
  currentTime: number;
  duration: number;
  disabled?: boolean;
  ariaLabel: string;
}>(), {
  disabled: false,
});

const emit = defineEmits<{ seek: [seconds: number] }>();
const host = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const draggingPointerId = ref<number | null>(null);
let resizeObserver: ResizeObserver | null = null;

const finiteDuration = computed(() =>
  Number.isFinite(props.duration) && props.duration > 0 ? props.duration : 0);
const finiteCurrentTime = computed(() =>
  Math.min(finiteDuration.value, Math.max(0, Number.isFinite(props.currentTime) ? props.currentTime : 0)));
const timeText = computed(() =>
  `${formatPluginAudioClock(finiteCurrentTime.value)} / ${formatPluginAudioClock(finiteDuration.value)}`);

function draw(): void {
  const target = canvas.value;
  if (!target) return;
  const width = Math.max(1, target.clientWidth || 480);
  const height = Math.max(1, target.clientHeight || 48);
  const dpr = window.devicePixelRatio || 1;
  target.width = Math.round(width * dpr);
  target.height = Math.round(height * dpr);
  const context = target.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#d7dee5';
  context.fillRect(0, 0, width, height);

  const middle = height / 2;
  const progressX = width * pluginAudioProgressRatio(finiteCurrentTime.value, finiteDuration.value);
  if (props.peaks.length === 0) {
    context.strokeStyle = '#9aa3ad';
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(width, middle);
    context.stroke();
  } else {
    const barWidth = width / props.peaks.length;
    props.peaks.forEach((peak, index) => {
      const barHeight = Math.max(2, Math.max(0, peak) * (height - 8));
      const x = index * barWidth;
      context.fillStyle = x + barWidth * 0.5 <= progressX ? '#2a3138' : '#8a939e';
      context.fillRect(
        x + barWidth * 0.15,
        middle - barHeight / 2,
        Math.max(1, barWidth * 0.7),
        barHeight,
      );
    });
  }

  context.strokeStyle = '#c45c26';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(progressX, 0);
  context.lineTo(progressX, height);
  context.stroke();
}

function seekAt(clientX: number): void {
  if (props.disabled || finiteDuration.value <= 0) return;
  const rect = host.value?.getBoundingClientRect();
  if (!rect) return;
  emit('seek', seekTimeFromWaveformPointer(clientX, rect.left, rect.width, finiteDuration.value));
}

function onPointerDown(event: PointerEvent): void {
  if (props.disabled) return;
  draggingPointerId.value = event.pointerId;
  host.value?.setPointerCapture(event.pointerId);
  seekAt(event.clientX);
}

function onPointerMove(event: PointerEvent): void {
  if (draggingPointerId.value !== event.pointerId) return;
  seekAt(event.clientX);
}

function onPointerUp(event: PointerEvent): void {
  if (draggingPointerId.value !== event.pointerId) return;
  draggingPointerId.value = null;
  if (host.value?.hasPointerCapture(event.pointerId)) host.value.releasePointerCapture(event.pointerId);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled || finiteDuration.value <= 0) return;
  const step = event.shiftKey ? 10 : 1;
  let next: number | null = null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = finiteCurrentTime.value - step;
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = finiteCurrentTime.value + step;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = finiteDuration.value;
  if (next === null) return;
  event.preventDefault();
  emit('seek', Math.min(finiteDuration.value, Math.max(0, next)));
}

watch(
  () => [props.peaks, props.currentTime, props.duration] as const,
  draw,
  { deep: true },
);

onMounted(() => {
  draw();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(draw);
    if (host.value) resizeObserver.observe(host.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.audio-waveform-seek {
  display: block;
  width: 100%;
  height: 48px;
  overflow: hidden;
  border: 1px solid #c9d0d7;
  border-radius: var(--app-radius-sm, 6px);
  background: #d7dee5;
  cursor: pointer;
  touch-action: none;
}

.audio-waveform-seek.is-disabled {
  cursor: default;
  opacity: 0.7;
}

.audio-waveform-seek:focus-visible {
  outline: 2px solid var(--app-accent, #c45c26);
  outline-offset: 1px;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
