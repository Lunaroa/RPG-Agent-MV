<template>
  <teleport to="body">
    <div v-if="visible" class="coordinate-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
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
          <label><span>X</span><input v-model.number="x" type="number" min="0" :max="maxX" @change="normalizeAndPaint" /></label>
          <label><span>Y</span><input v-model.number="y" type="number" min="0" :max="maxY" @change="normalizeAndPaint" /></label>
          <span v-if="mode === 'map' && mapPayload" class="coordinate-size">{{ mapPayload.map.width }} × {{ mapPayload.map.height }}</span>
          <span v-else-if="mode === 'screen'" class="coordinate-size">{{ screenWidth }} × {{ screenHeight }}</span>
        </div>
        <div ref="stageRef" class="coordinate-stage" :class="{ loading, 'map-stage': mode === 'map' }">
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

type PickerMode = 'map' | 'screen';
interface CoordinateSelection { mapId: number; x: number; y: number }
interface OpenOptions extends Partial<CoordinateSelection> { mode?: PickerMode; allowMapChange?: boolean; title?: string }

const props = defineProps<{ catalog: EditorProjectCatalog | null }>();
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
const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
// Full-map rendering: cap the backing canvas edge and downscale instead of cropping.
const MAX_CANVAS_EDGE = 4096;
let mapBaseCanvas: HTMLCanvasElement | null = null;

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

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

async function open(options: OpenOptions = {}) {
  mode.value = options.mode || 'map';
  allowMapChange.value = options.allowMapChange !== false;
  title.value = options.title || '';
  mapId.value = positiveMapId(options.mapId);
  x.value = finiteInteger(options.x, 0);
  y.value = finiteInteger(options.y, 0);
  error.value = '';
  visible.value = true;
  if (mode.value === 'map') await loadMap();
  else {
    normalizeSelection();
    await nextTick();
    paint();
  }
}

function close() { visible.value = false; }

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

function paintScreen(context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#171a1f';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#343a43';
  context.lineWidth = 1;
  const step = Math.max(32, Number(props.catalog?.tileSize) || 48);
  for (let px = step; px < width; px += step) { context.beginPath(); context.moveTo(px, 0); context.lineTo(px, height); context.stroke(); }
  for (let py = step; py < height; py += step) { context.beginPath(); context.moveTo(0, py); context.lineTo(width, py); context.stroke(); }
  context.strokeStyle = '#ffcc4d';
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(x.value - 10, y.value); context.lineTo(x.value + 10, y.value); context.stroke();
  context.beginPath(); context.moveTo(x.value, y.value - 10); context.lineTo(x.value, y.value + 10); context.stroke();
}

function pickCanvasCoordinate(event: MouseEvent) {
  // A drag-pan gesture must not change the selection when the button is released.
  if (panMoved) {
    panMoved = false;
    return;
  }
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
  const py = (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
  if (mode.value === 'screen') {
    x.value = clamp(Math.round(px), 0, maxX.value);
    y.value = clamp(Math.round(py), 0, maxY.value);
  } else {
    x.value = clamp(Math.floor(px / cellSize.value), 0, maxX.value);
    y.value = clamp(Math.floor(py / cellSize.value), 0, maxY.value);
  }
  paint();
}

// Drag panning for the map stage; short presses fall through to click selection.
const PAN_THRESHOLD = 4;
let panPointerId: number | null = null;
let panMoved = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

function onStagePointerDown(event: PointerEvent) {
  if (mode.value !== 'map' || event.button !== 0) return;
  const stage = stageRef.value;
  if (!stage) return;
  panPointerId = event.pointerId;
  panMoved = false;
  panStartX = event.clientX;
  panStartY = event.clientY;
  panScrollLeft = stage.scrollLeft;
  panScrollTop = stage.scrollTop;
  canvasRef.value?.setPointerCapture(event.pointerId);
}

function onStagePointerMove(event: PointerEvent) {
  if (panPointerId !== event.pointerId) return;
  const stage = stageRef.value;
  if (!stage) return;
  const dx = event.clientX - panStartX;
  const dy = event.clientY - panStartY;
  if (!panMoved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
  panMoved = true;
  stage.scrollLeft = panScrollLeft - dx;
  stage.scrollTop = panScrollTop - dy;
}

function onStagePointerUp(event: PointerEvent) {
  if (panPointerId !== event.pointerId) return;
  panPointerId = null;
  const canvas = canvasRef.value;
  if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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
.coordinate-overlay { z-index: 2500; }
.coordinate-dialog { width: min(760px, calc(100vw - 32px)); }
.coordinate-controls { display: grid; grid-template-columns:minmax(180px, 1fr) 92px 92px auto; align-items:end; gap:8px; padding:10px 12px; border-bottom:1px solid var(--app-border); }
.coordinate-controls label { display:grid; gap:4px; color:var(--app-ink-muted); font-size:11px; }
.coordinate-controls input,.coordinate-controls select { min-width:0; padding:5px 6px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-bg); color:var(--app-ink); }
.coordinate-size { align-self:center; color:var(--app-ink-muted); font:11px var(--app-font-mono); }
.coordinate-stage { position:relative; min-height:220px; max-height:min(62vh, 560px); display:grid; place-items:center; padding:12px; overflow:auto; background:var(--app-bg-sunken); }
.coordinate-stage canvas { display:block; max-width:100%; max-height:440px; border:1px solid var(--app-border-strong); background:#171a1f; cursor:crosshair; image-rendering:pixelated; }
/* Map mode scrolls the full-size map; drag pans, click selects. */
.coordinate-stage.map-stage { place-items:start; }
.coordinate-stage.map-stage canvas { max-width:none; max-height:none; touch-action:none; }
.coordinate-stage.loading canvas { opacity:.4; }
.coordinate-status { position:absolute; inset:0; display:grid; place-items:center; padding:20px; color:var(--app-ink-muted); background:color-mix(in srgb,var(--app-bg) 72%,transparent); text-align:center; }
.coordinate-status.error { color:var(--app-danger); }
.coordinate-hint { margin:0; padding:7px 12px; border-top:1px solid var(--app-border); color:var(--app-ink-muted); font-size:11px; }
@media (max-width:620px) { .coordinate-controls { grid-template-columns:1fr 72px 72px; }.coordinate-size { display:none; } }
</style>
