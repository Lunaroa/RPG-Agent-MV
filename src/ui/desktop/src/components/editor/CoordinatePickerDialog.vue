<template>
  <teleport to="body">
    <div v-if="visible" class="coordinate-overlay editor-modal-overlay" :data-editor-dialog-layer="coordinateLayerZ" @mousedown.self="close">
      <section class="coordinate-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="coordinate-picker-title">
        <header class="editor-modal-header">
          <strong id="coordinate-picker-title" class="editor-modal-title">{{ title || t(mode === 'map' ? 'coordinate.mapTitle' : 'coordinate.screenTitle') }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="coordinate-controls">
          <label v-if="mode === 'map' && allowMapChange">
            <span>{{ t('coordinate.map') }}</span>
            <select v-model.number="mapId" @change="loadMap">
              <option v-for="map in mapOptions" :key="map.id" :value="map.id">{{ String(map.id).padStart(3, '0') }} · {{ map.name }}</option>
            </select>
          </label>
          <label><span>X</span><input v-model.number="x" type="number" :min="mode === 'map' ? 0 : SCREEN_COORDINATE_MIN" :max="mode === 'map' ? maxX : SCREEN_COORDINATE_MAX" @change="normalizeAndPaint" /></label>
          <label><span>Y</span><input v-model.number="y" type="number" :min="mode === 'map' ? 0 : SCREEN_COORDINATE_MIN" :max="mode === 'map' ? maxY : SCREEN_COORDINATE_MAX" @change="normalizeAndPaint" /></label>
          <span v-if="mode === 'map' && mapPayload" class="coordinate-size">{{ mapPayload.map.width }} × {{ mapPayload.map.height }}</span>
          <span v-else-if="mode === 'screen'" class="coordinate-size">{{ screenWidth }} × {{ screenHeight }}</span>
        </div>
        <div ref="stageRef" class="coordinate-stage" :class="{ loading, 'map-stage': mode === 'map', 'picture-stage': picturePreview && mode === 'screen' }">
          <canvas
            ref="canvasRef"
            :width="canvasWidth"
            :height="canvasHeight"
            :aria-label="t('coordinate.canvasLabel')"
            @pointerdown="onStagePointerDown"
            @pointermove="onStagePointerMove"
            @pointerup="onStagePointerUp"
            @pointercancel="onStagePointerUp"
            @click="pickCanvasCoordinate"
            @dblclick="commit"
          />
          <div v-if="loading" class="coordinate-status">{{ t('coordinate.loading') }}</div>
          <div v-else-if="error" class="coordinate-status error">{{ error }}</div>
          <div v-else-if="pictureError" class="coordinate-preview-warning">{{ pictureError }}</div>
        </div>
        <p class="coordinate-hint">{{ t(mode === 'map' ? 'coordinate.mapHint' : 'coordinate.screenHint') }}</p>
        <footer class="editor-modal-footer">
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" :disabled="loading || Boolean(error)" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { EditorProjectCatalog, MapPayload } from '../../api/client';
import { maps, resolveAssetUrl } from '../../api/client';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { drawMapContent, type MvMap } from '../../composables/useMapRenderer';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { loadImageElement } from '../../utils/imageLoading';
import {
  canvasClientDeltaToLogical,
  canvasClientToLogicalPoint,
  clampScreenCoordinate,
  SCREEN_COORDINATE_MAX,
  SCREEN_COORDINATE_MIN,
  screenPictureDrawState,
  type ScreenPicturePreview,
} from '../../utils/pictureCoordinatePreview';

type PickerMode = 'map' | 'screen';
interface CoordinateSelection { mapId: number; x: number; y: number }
interface OpenOptions extends Partial<CoordinateSelection> { mode?: PickerMode; allowMapChange?: boolean; title?: string; picture?: ScreenPicturePreview }

const props = defineProps<{ catalog: EditorProjectCatalog | null; zIndex?: number }>();
const emit = defineEmits<{ commit: [selection: CoordinateSelection] }>();
const { t } = useI18n();
const visible = ref(false);
const loading = ref(false);
const error = ref('');
const title = ref('');
const mode = ref<PickerMode>('map');
const allowMapChange = ref(true);
const mapId = ref(1);
const x = ref(0);
const y = ref(0);
const mapPayload = ref<MapPayload | null>(null);
const tilesetImages = ref<(HTMLImageElement | null)[]>([]);
const picturePreview = ref<ScreenPicturePreview | null>(null);
const pictureImage = ref<HTMLImageElement | null>(null);
const pictureError = ref('');
const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const coordinateLayerZ = computed(() => props.zIndex ?? LAYER_Z.subDialog);
// Full-map rendering: cap the backing canvas edge and downscale instead of cropping.
const MAX_CANVAS_EDGE = 4096;
let mapBaseCanvas: HTMLCanvasElement | null = null;
let screenGridCanvas: HTMLCanvasElement | null = null;
let screenGridKey = '';
let pictureLoadRequest = 0;

interface MapPanState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  moved: boolean;
}

interface PictureDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  latestClientX: number;
  latestClientY: number;
  startX: number;
  startY: number;
  moved: boolean;
}

let mapPan: MapPanState | null = null;
let pictureDrag: PictureDragState | null = null;
let pictureDragFrame: number | null = null;
let suppressNextClick = false;

const mapOptions = computed(() => (props.catalog?.maps || []).filter((map) => Number(map.id) > 0));
const screenWidth = computed(() => Math.max(1, Number(props.catalog?.screenWidth) || 816));
const screenHeight = computed(() => Math.max(1, Number(props.catalog?.screenHeight) || 624));
const tileSize = computed(() => Math.max(1, Number(mapPayload.value?.tileSize || props.catalog?.tileSize) || 48));
const mapScale = computed(() => {
  const map = mapPayload.value?.map;
  if (!map) return 1;
  const fullWidth = map.width * tileSize.value;
  const fullHeight = map.height * tileSize.value;
  return Math.min(1, MAX_CANVAS_EDGE / Math.max(1, fullWidth), MAX_CANVAS_EDGE / Math.max(1, fullHeight));
});
const cellSize = computed(() => tileSize.value * mapScale.value);
const canvasWidth = computed(() => mode.value === 'screen'
  ? screenWidth.value
  : Math.max(1, Math.round((mapPayload.value?.map.width || 1) * cellSize.value)));
const canvasHeight = computed(() => mode.value === 'screen'
  ? screenHeight.value
  : Math.max(1, Math.round((mapPayload.value?.map.height || 1) * cellSize.value)));
const maxX = computed(() => mode.value === 'screen' ? screenWidth.value - 1 : Math.max(0, Number(mapPayload.value?.map.width || 1) - 1));
const maxY = computed(() => mode.value === 'screen' ? screenHeight.value - 1 : Math.max(0, Number(mapPayload.value?.map.height || 1) - 1));
const screenGridStep = computed(() => Math.max(32, Number(props.catalog?.tileSize) || 48));

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(coordinateLayerZ.value)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  cancelPointerInteraction();
  pictureLoadRequest += 1;
});

async function open(options: OpenOptions = {}) {
  cancelPointerInteraction();
  pictureLoadRequest += 1;
  mode.value = options.mode || 'map';
  allowMapChange.value = options.allowMapChange !== false;
  title.value = options.title || '';
  mapId.value = positiveMapId(options.mapId);
  x.value = finiteInteger(options.x, 0);
  y.value = finiteInteger(options.y, 0);
  picturePreview.value = options.picture || null;
  pictureImage.value = null;
  pictureError.value = '';
  error.value = '';
  visible.value = true;
  if (mode.value === 'map') await loadMap();
  else {
    normalizeSelection();
    await nextTick();
    paint();
    void loadScreenPicture();
  }
}

function close() {
  cancelPointerInteraction();
  pictureLoadRequest += 1;
  visible.value = false;
}

async function loadScreenPicture() {
  const request = ++pictureLoadRequest;
  const preview = picturePreview.value;
  if (!preview) return;
  if (!preview.assetUrl) {
    // Move Picture (232) only carries a slot number; there is no asset to load.
    // Keep pictureImage null so paintScreen draws a placeholder target frame.
    pictureImage.value = null;
    pictureError.value = '';
    return;
  }
  try {
    const image = await loadImageElement(await resolveAssetUrl(preview.assetUrl));
    if (request !== pictureLoadRequest || !visible.value) return;
    pictureImage.value = image;
    pictureError.value = '';
    paint();
  } catch {
    if (request !== pictureLoadRequest || !visible.value) return;
    pictureImage.value = null;
    pictureError.value = t('coordinate.pictureUnavailable', { name: preview.assetName });
    paint();
  }
}

async function loadMap() {
  if (!props.catalog?.project) {
    error.value = t('coordinate.projectMissing');
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const payload = await maps.get(positiveMapId(mapId.value), props.catalog.project);
    mapPayload.value = payload;
    mapId.value = Number(payload.info.id);
    const urls = payload.tileset?.imageUrls || [];
    tilesetImages.value = await Promise.all(urls.map(async (url) => url ? loadImageElement(await resolveAssetUrl(url)) : null));
    normalizeSelection();
    await nextTick();
    buildMapBase();
    paint();
    scrollSelectionIntoView();
  } catch (cause) {
    mapPayload.value = null;
    tilesetImages.value = [];
    mapBaseCanvas = null;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function normalizeAndPaint() {
  normalizeSelection();
  void nextTick(() => {
    paint();
    scrollSelectionIntoView();
  });
}

function normalizeSelection() {
  if (mode.value === 'screen') {
    x.value = clampScreenCoordinate(finiteInteger(x.value, 0));
    y.value = clampScreenCoordinate(finiteInteger(y.value, 0));
    return;
  }
  x.value = clamp(finiteInteger(x.value, 0), 0, maxX.value);
  y.value = clamp(finiteInteger(y.value, 0), 0, maxY.value);
}

function paint() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  if (mode.value === 'screen') paintScreen(context, canvas.width, canvas.height);
  else paintMap(context);
}

// Render the whole map once into an offscreen canvas; selection repaints just blit it.
function buildMapBase() {
  const payload = mapPayload.value;
  if (!payload) {
    mapBaseCanvas = null;
    return;
  }
  const base = document.createElement('canvas');
  base.width = canvasWidth.value;
  base.height = canvasHeight.value;
  const context = base.getContext('2d');
  if (!context) {
    mapBaseCanvas = null;
    return;
  }
  context.imageSmoothingEnabled = false;
  context.save();
  context.scale(mapScale.value, mapScale.value);
  drawMapContent(context, payload.map as MvMap, {
    tilesetImages: tilesetImages.value,
    tilesetFlags: payload.tileset?.flags || [],
    tileSize: tileSize.value,
    showGrid: true,
  });
  context.restore();
  mapBaseCanvas = base;
}

function paintMap(context: CanvasRenderingContext2D) {
  if (!mapBaseCanvas) return;
  context.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
  context.drawImage(mapBaseCanvas, 0, 0);
  context.save();
  context.strokeStyle = '#ffcc4d';
  context.lineWidth = Math.max(2, cellSize.value / 16);
  context.strokeRect(x.value * cellSize.value + 1, y.value * cellSize.value + 1, cellSize.value - 2, cellSize.value - 2);
  context.restore();
}

function buildScreenGrid(width: number, height: number) {
  const key = `${width}:${height}:${screenGridStep.value}`;
  if (screenGridCanvas && screenGridKey === key) return;
  const base = document.createElement('canvas');
  base.width = width;
  base.height = height;
  const context = base.getContext('2d');
  if (!context) {
    screenGridCanvas = null;
    screenGridKey = '';
    return;
  }
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#171a1f';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#343a43';
  context.lineWidth = 1;
  const step = screenGridStep.value;
  for (let px = step; px < width; px += step) { context.beginPath(); context.moveTo(px, 0); context.lineTo(px, height); context.stroke(); }
  for (let py = step; py < height; py += step) { context.beginPath(); context.moveTo(0, py); context.lineTo(width, py); context.stroke(); }
  screenGridCanvas = base;
  screenGridKey = key;
}

function paintScreen(context: CanvasRenderingContext2D, width: number, height: number) {
  buildScreenGrid(width, height);
  context.clearRect(0, 0, width, height);
  if (screenGridCanvas) context.drawImage(screenGridCanvas, 0, 0);
  const realBounds = drawScreenPicture(context);
  // Always draw a dashed target frame at the chosen origin so the user can see
  // the placement range — overlaid on top of the real image when one resolves
  // (Move Picture 232 reusing a prior Show Picture 231 asset), or standing in
  // for the missing image (232 with no resolvable 231) using a nominal size.
  if (picturePreview.value) drawScreenPicturePlaceholder(context, realBounds);
  context.strokeStyle = '#ffcc4d';
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(x.value - 10, y.value); context.lineTo(x.value + 10, y.value); context.stroke();
  context.beginPath(); context.moveTo(x.value, y.value - 10); context.lineTo(x.value, y.value + 10); context.stroke();
}

function drawScreenPicturePlaceholder(context: CanvasRenderingContext2D, realBounds: { x: number; y: number; w: number; h: number } | null) {
  const preview = picturePreview.value;
  if (!preview) return;
  // When a real image was drawn, frame its actual rendered bounds so the dashed
  // outline matches what the user sees. Without a real image (232 with no
  // resolvable prior 231), fall back to a representative box scaled from a
  // 200x200 nominal picture anchored at the origin.
  const ox = realBounds ? realBounds.x : (preview.origin === 1 ? x.value - (200 * preview.scaleX / 100) / 2 : x.value);
  const oy = realBounds ? realBounds.y : (preview.origin === 1 ? y.value - (200 * preview.scaleY / 100) / 2 : y.value);
  const baseW = realBounds ? realBounds.w : 200 * (preview.scaleX / 100);
  const baseH = realBounds ? realBounds.h : 200 * (preview.scaleY / 100);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, preview.opacity / 255)) * 0.5;
  context.strokeStyle = '#ffcc4d';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.strokeRect(ox, oy, baseW, baseH);
  context.setLineDash([]);
  context.fillStyle = '#ffcc4d';
  context.font = '12px sans-serif';
  context.fillText(t('coordinate.picturePlaceholder', { name: preview.assetName }), ox + 6, oy + 16);
  context.restore();
}

function drawScreenPicture(context: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } | null {
  const preview = picturePreview.value;
  const image = pictureImage.value;
  if (!preview || !image) return null;
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const state = screenPictureDrawState(preview, iw, ih);
  context.save();
  context.globalAlpha = state.alpha;
  context.globalCompositeOperation = state.operation;
  context.translate(x.value, y.value);
  context.scale(state.scaleX, state.scaleY);
  context.drawImage(image, state.originX, state.originY);
  context.restore();
  // Bounds of the drawn image in screen-canvas space (post-scale, pre-alpha).
  return {
    x: x.value + state.originX * state.scaleX,
    y: y.value + state.originY * state.scaleY,
    w: iw * state.scaleX,
    h: ih * state.scaleY,
  };
}

function pickCanvasCoordinate(event: MouseEvent) {
  // A drag gesture must not change the selection when the button is released.
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const point = canvasClientToLogicalPoint(
    event.clientX,
    event.clientY,
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    canvas.width,
    canvas.height,
  );
  if (mode.value === 'screen') {
    x.value = clampScreenCoordinate(Math.round(point.x));
    y.value = clampScreenCoordinate(Math.round(point.y));
  } else {
    x.value = clamp(Math.floor(point.x / cellSize.value), 0, maxX.value);
    y.value = clamp(Math.floor(point.y / cellSize.value), 0, maxY.value);
  }
  paint();
}

// Drag panning for the map stage; short presses fall through to click selection.
const PAN_THRESHOLD = 4;

function onStagePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const canvas = canvasRef.value;
  if (!canvas) return;
  suppressNextClick = false;
  if (mode.value === 'map') {
    const stage = stageRef.value;
    if (!stage) return;
    mapPan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      moved: false,
    };
    captureCanvasPointer(event.pointerId);
    return;
  }
  // Only Show Picture (code 231) supplies a picture preview. Screen-only
  // coordinate pickers, including code 232, keep click positioning without
  // gaining a drag gesture.
  if (!picturePreview.value) return;
  pictureDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    latestClientX: event.clientX,
    latestClientY: event.clientY,
    startX: x.value,
    startY: y.value,
    moved: false,
  };
  captureCanvasPointer(event.pointerId);
}

function onStagePointerMove(event: PointerEvent) {
  if (mapPan?.pointerId === event.pointerId) {
    const stage = stageRef.value;
    if (!stage) return;
    const dx = event.clientX - mapPan.startX;
    const dy = event.clientY - mapPan.startY;
    if (!mapPan.moved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
    mapPan.moved = true;
    stage.scrollLeft = mapPan.scrollLeft - dx;
    stage.scrollTop = mapPan.scrollTop - dy;
    return;
  }
  if (pictureDrag?.pointerId !== event.pointerId) return;
  // Pointermove only records the newest input. Coordinate mutation and canvas
  // drawing happen once in the scheduled frame below.
  pictureDrag.latestClientX = event.clientX;
  pictureDrag.latestClientY = event.clientY;
  pictureDrag.moved = pictureDrag.moved
    || event.clientX !== pictureDrag.startClientX
    || event.clientY !== pictureDrag.startClientY;
  schedulePictureDragFrame();
}

function onStagePointerUp(event: PointerEvent) {
  if (mapPan?.pointerId === event.pointerId) {
    suppressNextClick = mapPan.moved;
    releaseCanvasPointer(event.pointerId);
    mapPan = null;
    return;
  }
  if (pictureDrag?.pointerId !== event.pointerId) return;
  const drag = pictureDrag;
  flushPendingPictureDrag();
  suppressNextClick = drag.moved;
  releaseCanvasPointer(event.pointerId);
  pictureDrag = null;
}

function schedulePictureDragFrame() {
  if (pictureDragFrame !== null) return;
  pictureDragFrame = requestAnimationFrame(flushPictureDrag);
}

function flushPendingPictureDrag() {
  if (pictureDragFrame !== null) {
    cancelAnimationFrame(pictureDragFrame);
    pictureDragFrame = null;
  }
  flushPictureDrag();
}

function flushPictureDrag() {
  pictureDragFrame = null;
  const drag = pictureDrag;
  const canvas = canvasRef.value;
  if (!drag || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const delta = canvasClientDeltaToLogical(
    drag.latestClientX - drag.startClientX,
    drag.latestClientY - drag.startClientY,
    { width: rect.width, height: rect.height },
    canvas.width,
    canvas.height,
  );
  const nextX = clampScreenCoordinate(Math.round(drag.startX + delta.x));
  const nextY = clampScreenCoordinate(Math.round(drag.startY + delta.y));
  if (nextX === x.value && nextY === y.value) return;
  x.value = nextX;
  y.value = nextY;
  paint();
}

function releaseCanvasPointer(pointerId: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  try {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {
    // The pointer may already have been cancelled by the host window.
  }
}

function captureCanvasPointer(pointerId: number) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // Synthetic accessibility/test input is not registered as an active OS
    // pointer. Real pointer input still uses capture; the local handlers remain
    // usable when capture is unavailable.
  }
}

function cancelPointerInteraction() {
  if (pictureDragFrame !== null) {
    cancelAnimationFrame(pictureDragFrame);
    pictureDragFrame = null;
  }
  const pointerIds = [mapPan?.pointerId, pictureDrag?.pointerId].filter((id): id is number => id != null);
  for (const pointerId of pointerIds) releaseCanvasPointer(pointerId);
  mapPan = null;
  pictureDrag = null;
  suppressNextClick = false;
}

function scrollSelectionIntoView() {
  if (mode.value !== 'map') return;
  const stage = stageRef.value;
  if (!stage) return;
  const centerX = (x.value + 0.5) * cellSize.value;
  const centerY = (y.value + 0.5) * cellSize.value;
  stage.scrollLeft = centerX - stage.clientWidth / 2;
  stage.scrollTop = centerY - stage.clientHeight / 2;
}

function commit() {
  if (loading.value || error.value) return;
  emit('commit', { mapId: mapId.value, x: x.value, y: y.value });
  close();
}

function positiveMapId(value: unknown): number {
  const id = finiteInteger(value, 0);
  if (id > 0) return id;
  return Number(mapOptions.value[0]?.id) || 1;
}
function finiteInteger(value: unknown, fallback: number): number { const number = Number(value); return Number.isFinite(number) ? Math.trunc(number) : fallback; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

defineExpose({ open });
</script>

<style scoped>
.coordinate-overlay { z-index: v-bind(coordinateLayerZ); }
.coordinate-dialog { width: min(760px, calc(100vw - 32px)); }
.coordinate-controls { display: grid; grid-template-columns:minmax(180px, 1fr) 92px 92px auto; align-items:end; gap:8px; padding:10px 12px; border-bottom:1px solid var(--app-border); }
.coordinate-controls label { display:grid; gap:4px; color:var(--app-ink-muted); font-size:11px; }
.coordinate-controls input,.coordinate-controls select { min-width:0; padding:5px 6px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-bg); color:var(--app-ink); }
.coordinate-size { align-self:center; color:var(--app-ink-muted); font:11px var(--app-font-mono); }
.coordinate-stage { position:relative; min-height:220px; max-height:min(62vh, 560px); display:grid; place-items:center; padding:12px; overflow:auto; background:var(--app-bg-sunken); }
.coordinate-stage canvas { display:block; max-width:100%; border:1px solid var(--app-border-strong); background:#171a1f; cursor:crosshair; image-rendering:pixelated; }
/* Map mode scrolls the full-size map; drag pans, click selects. */
.coordinate-stage.map-stage { place-items:start; }
.coordinate-stage.map-stage canvas { max-width:none; max-height:none; touch-action:none; }
/* Show Picture screen mode drags the picture anchor; code 232 has no picture-stage class. */
.coordinate-stage.picture-stage canvas { touch-action:none; cursor:grab; }
.coordinate-stage.picture-stage canvas:active { cursor:grabbing; }
.coordinate-stage.loading canvas { opacity:.4; }
.coordinate-status { position:absolute; inset:0; display:grid; place-items:center; padding:20px; color:var(--app-ink-muted); background:color-mix(in srgb,var(--app-bg) 72%,transparent); text-align:center; }
.coordinate-status.error { color:var(--app-danger); }
.coordinate-preview-warning { position:absolute; left:20px; top:20px; max-width:calc(100% - 40px); padding:6px 8px; border:1px solid color-mix(in srgb,var(--app-warn) 48%,var(--app-border)); border-radius:var(--app-radius-sm); background:color-mix(in srgb,var(--app-bg-elevated) 88%,transparent); color:var(--app-warn); font-size:11px; pointer-events:none; }
.coordinate-hint { margin:0; padding:7px 12px; border-top:1px solid var(--app-border); color:var(--app-ink-muted); font-size:11px; }
@media (max-width:620px) { .coordinate-controls { grid-template-columns:1fr 72px 72px; }.coordinate-size { display:none; } }
</style>
