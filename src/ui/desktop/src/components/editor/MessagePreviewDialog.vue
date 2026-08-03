<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog message-preview-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="message-preview-title">
        <header class="editor-modal-header">
          <strong id="message-preview-title" class="editor-modal-title">{{ t('eventcmd.previewTitle') }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="message-preview-body">
          <p v-if="skinMissing" class="message-preview-error">{{ t('eventcmd.previewNoSkin') }}</p>
          <canvas ref="canvasRef" class="message-preview-canvas" :width="screenWidth" :height="screenHeight" />
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
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type { EditorProjectCatalog } from '../../api/client';
import { mvFaceSourceRect, normalizeFaceSize } from '../../utils/rmmvFace';

interface MessagePreviewPayload {
  faceName: string;
  faceIndex: number;
  background: number;
  positionType: number;
  name: string;
  lines: string[];
}

const props = defineProps<{
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
}>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const skinMissing = ref(false);
const canvasRef = ref<HTMLCanvasElement>();
const payload = ref<MessagePreviewPayload | null>(null);

const screenWidth = computed(() => Math.max(1, Number(props.catalog?.screenWidth) || 816));
const screenHeight = computed(() => Math.max(1, Number(props.catalog?.screenHeight) || 624));
const uiAreaWidth = computed(() => Math.max(1, Number(props.catalog?.uiAreaWidth) || screenWidth.value));
const uiAreaHeight = computed(() => Math.max(1, Number(props.catalog?.uiAreaHeight) || screenHeight.value));
const faceSize = computed(() => normalizeFaceSize(props.catalog?.faceSize));

// RM message window metrics: 18px padding, 36px line height, up to 4 lines.
const WINDOW_PADDING = 18;
const LINE_HEIGHT = 36;
const MESSAGE_LINES = 4;
const WINDOW_HEIGHT = WINDOW_PADDING * 2 + LINE_HEIGHT * MESSAGE_LINES;
// RM speaker name box: one line plus padding, sitting on top of the window.
const NAME_BOX_HEIGHT = WINDOW_PADDING * 2 + LINE_HEIGHT;

function open(next: MessagePreviewPayload) {
  payload.value = next;
  skinMissing.value = false;
  visible.value = true;
  void nextTick(() => void paint());
}

function close() {
  visible.value = false;
}

async function paint() {
  const canvas = canvasRef.value;
  const data = payload.value;
  if (!canvas || !data) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = screenWidth.value;
  const height = screenHeight.value;
  const areaW = uiAreaWidth.value;
  const areaH = uiAreaHeight.value;
  const areaX = Math.round((width - areaW) / 2);
  const areaY = Math.round((height - areaH) / 2);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;

  // Dark stand-in for the running game screen behind the message window.
  context.fillStyle = '#26262b';
  context.fillRect(0, 0, width, height);

  // Subtle UI area boundary.
  if (areaW < width || areaH < height) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    context.lineWidth = 1;
    context.strokeRect(areaX + 0.5, areaY + 0.5, areaW - 1, areaH - 1);
  }

  const windowY = areaY + (data.positionType === 0
    ? 0
    : data.positionType === 1
      ? Math.round((areaH - WINDOW_HEIGHT) / 2)
      : areaH - WINDOW_HEIGHT);

  const speakerName = (data.name || '').trim();
  let skin: HTMLImageElement | null = null;
  if (data.background === 0) {
    skin = await loadWindowSkin();
    // Missing skin is surfaced via the banner; never substitute another window style.
    skinMissing.value = !skin;
  }

  context.font = '28px sans-serif';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';

  // Speaker name box: left-aligned above the message window, mirroring its
  // background; when the window sits at the top edge RM flips it below.
  if (speakerName) {
    const nameWidth = Math.ceil(context.measureText(speakerName).width) + WINDOW_PADDING * 2;
    const nameY = data.positionType === 0
      ? windowY + WINDOW_HEIGHT
      : windowY - NAME_BOX_HEIGHT;
    if (data.background === 0) {
      if (skin) drawWindowSkin(context, skin, areaX, nameY, nameWidth, NAME_BOX_HEIGHT);
    } else if (data.background === 1) {
      drawDimWindow(context, areaX, nameY, nameWidth, NAME_BOX_HEIGHT);
    }
    context.fillText(speakerName, areaX + WINDOW_PADDING, nameY + NAME_BOX_HEIGHT / 2);
  }

  if (data.background === 0) {
    if (skin) drawWindowSkin(context, skin, areaX, windowY, areaW, WINDOW_HEIGHT);
  } else if (data.background === 1) {
    drawDimWindow(context, areaX, windowY, areaW, WINDOW_HEIGHT);
  }

  if (data.faceName) await drawFace(context, data.faceName, data.faceIndex, windowY, areaX);

  const textX = areaX + WINDOW_PADDING + (data.faceName ? faceSize.value + 24 : 0);
  data.lines.slice(0, MESSAGE_LINES).forEach((line, index) => {
    context.fillText(line, textX, windowY + WINDOW_PADDING + index * LINE_HEIGHT + LINE_HEIGHT / 2, areaW - WINDOW_PADDING - (data.faceName ? faceSize.value + 24 : 0) - WINDOW_PADDING);
  });
}

async function loadWindowSkin(): Promise<HTMLImageElement | null> {
  const asset = (props.catalog?.assets.system || []).find((entry) => entry.name === 'Window');
  if (!asset) return null;
  return props.loadImage(asset.url);
}

// RM window skin layout: (0,0,96,96) background, (0,96,96,96) tone tile, (96,0,96,96) frame.
function drawWindowSkin(context: CanvasRenderingContext2D, skin: HTMLImageElement, x: number, y: number, w: number, h: number) {
  context.save();
  context.globalAlpha = 0.75;
  context.drawImage(skin, 0, 0, 96, 96, x + 2, y + 2, w - 4, h - 4);
  const pattern = buildTonePattern(context, skin);
  if (pattern) {
    context.fillStyle = pattern;
    context.fillRect(x + 2, y + 2, w - 4, h - 4);
  }
  context.restore();
  drawWindowFrame(context, skin, x, y, w, h);
}

function buildTonePattern(context: CanvasRenderingContext2D, skin: HTMLImageElement): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = 96;
  tile.height = 96;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return null;
  tileContext.drawImage(skin, 0, 96, 96, 96, 0, 0, 96, 96);
  return context.createPattern(tile, 'repeat');
}

function drawWindowFrame(context: CanvasRenderingContext2D, skin: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const sx = 96;
  const corner = 24;
  const edge = 96 - corner * 2;
  // Corners
  context.drawImage(skin, sx, 0, corner, corner, x, y, corner, corner);
  context.drawImage(skin, sx + 96 - corner, 0, corner, corner, x + w - corner, y, corner, corner);
  context.drawImage(skin, sx, 96 - corner, corner, corner, x, y + h - corner, corner, corner);
  context.drawImage(skin, sx + 96 - corner, 96 - corner, corner, corner, x + w - corner, y + h - corner, corner, corner);
  // Edges
  context.drawImage(skin, sx + corner, 0, edge, corner, x + corner, y, w - corner * 2, corner);
  context.drawImage(skin, sx + corner, 96 - corner, edge, corner, x + corner, y + h - corner, w - corner * 2, corner);
  context.drawImage(skin, sx, corner, corner, edge, x, y + corner, corner, h - corner * 2);
  context.drawImage(skin, sx + 96 - corner, corner, corner, edge, x + w - corner, y + corner, corner, h - corner * 2);
}

function drawDimWindow(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const fade = 8;
  const gradient = context.createLinearGradient(0, y, 0, y + h);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(fade / h, 'rgba(0, 0, 0, 0.6)');
  gradient.addColorStop(1 - fade / h, 'rgba(0, 0, 0, 0.6)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.save();
  context.fillStyle = gradient;
  context.fillRect(x, y, w, h);
  context.restore();
}

async function drawFace(context: CanvasRenderingContext2D, faceName: string, faceIndex: number, windowY: number, areaX: number) {
  const asset = (props.catalog?.assets.faces || []).find((entry) => entry.name === faceName);
  if (!asset) return;
  const image = await props.loadImage(asset.url);
  if (!image) return;
  const source = mvFaceSourceRect(faceIndex, faceSize.value);
  context.drawImage(image, source.sx, source.sy, source.sw, source.sh, areaX + WINDOW_PADDING, windowY + WINDOW_PADDING, faceSize.value, faceSize.value);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.message-preview-dialog { width: min(680px, calc(100vw - 32px)); }
.message-preview-body { padding: 12px; }
.message-preview-error {
  margin: 0 0 8px;
  padding: 7px 10px;
  border-radius: var(--app-radius-sm);
  background: var(--app-warn-soft);
  color: var(--app-warn);
  font-size: 12px;
  line-height: 1.45;
}
.message-preview-canvas {
  display: block;
  width: 100%;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-sm);
}
</style>
