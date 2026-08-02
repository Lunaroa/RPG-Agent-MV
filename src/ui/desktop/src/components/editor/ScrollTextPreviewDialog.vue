<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog scroll-preview-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="scroll-preview-title">
        <header class="editor-modal-header">
          <strong id="scroll-preview-title" class="editor-modal-title">{{ t('eventcmd.previewTitle') }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="scroll-preview-body">
          <canvas ref="canvasRef" class="scroll-preview-canvas" :width="screenWidth" :height="screenHeight" />
        </div>
        <footer class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.close') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { EditorProjectCatalog } from '../../api/client';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';

interface ScrollTextPreviewPayload {
  lines: string[];
  speed: number;
}

const props = defineProps<{
  catalog: EditorProjectCatalog | null;
}>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const canvasRef = ref<HTMLCanvasElement>();
const payload = ref<ScrollTextPreviewPayload | null>(null);

const screenWidth = computed(() => Math.max(1, Number(props.catalog?.screenWidth) || 816));
const screenHeight = computed(() => Math.max(1, Number(props.catalog?.screenHeight) || 624));
const uiAreaWidth = computed(() => Math.max(1, Number(props.catalog?.uiAreaWidth) || screenWidth.value));
const uiAreaHeight = computed(() => Math.max(1, Number(props.catalog?.uiAreaHeight) || screenHeight.value));

// RM scroll text metrics: 18px side padding, 36px line height, speed/2 px per 60fps frame.
const SIDE_PADDING = 18;
const LINE_HEIGHT = 36;
const FRAME_MS = 1000 / 60;

let animationHandle = 0;
let scrollOffset = 0;
let lastTimestamp = 0;

function open(next: ScrollTextPreviewPayload) {
  payload.value = next;
  visible.value = true;
  void nextTick(startAnimation);
}

function close() {
  stopAnimation();
  visible.value = false;
}

function startAnimation() {
  stopAnimation();
  scrollOffset = 0;
  lastTimestamp = 0;
  animationHandle = window.requestAnimationFrame(step);
}

function stopAnimation() {
  if (animationHandle) window.cancelAnimationFrame(animationHandle);
  animationHandle = 0;
}

function step(timestamp: number) {
  animationHandle = 0;
  const data = payload.value;
  const canvas = canvasRef.value;
  if (!visible.value || !data || !canvas) return;
  if (lastTimestamp) {
    const speed = Math.max(1, data.speed) / 2;
    scrollOffset += ((timestamp - lastTimestamp) / FRAME_MS) * speed;
  }
  lastTimestamp = timestamp;
  const totalHeight = data.lines.length * LINE_HEIGHT;
  // Loop the playback once the whole text has scrolled past the top edge.
  if (scrollOffset > totalHeight + uiAreaHeight.value) scrollOffset = 0;
  paint(canvas, data, scrollOffset);
  animationHandle = window.requestAnimationFrame(step);
}

function paint(canvas: HTMLCanvasElement, data: ScrollTextPreviewPayload, offset: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = screenWidth.value;
  const height = screenHeight.value;
  const areaW = uiAreaWidth.value;
  const areaH = uiAreaHeight.value;
  const areaX = Math.round((width - areaW) / 2);
  const areaY = Math.round((height - areaH) / 2);

  // Dark stand-in for the running game screen behind the scrolling text.
  context.fillStyle = '#26262b';
  context.fillRect(0, 0, width, height);

  // Subtle UI area boundary.
  if (areaW < width || areaH < height) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    context.lineWidth = 1;
    context.strokeRect(areaX + 0.5, areaY + 0.5, areaW - 1, areaH - 1);
  }

  context.save();
  context.beginPath();
  context.rect(areaX, areaY, areaW, areaH);
  context.clip();

  context.font = '28px sans-serif';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  const topY = areaY + areaH - offset;
  data.lines.forEach((line, index) => {
    const lineY = topY + index * LINE_HEIGHT + LINE_HEIGHT / 2;
    if (lineY < areaY - LINE_HEIGHT || lineY > areaY + areaH + LINE_HEIGHT) return;
    context.fillText(line, areaX + SIDE_PADDING, lineY, areaW - SIDE_PADDING * 2);
  });
  context.restore();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => {
  stopAnimation();
  window.removeEventListener('keydown', onKeyDown);
});

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.scroll-preview-dialog { width: min(680px, calc(100vw - 32px)); }
.scroll-preview-body { padding: 12px; }
.scroll-preview-canvas {
  display: block;
  width: 100%;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
}
</style>
