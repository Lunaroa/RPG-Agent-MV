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
        <div class="coordinate-stage" :class="{ loading }">
          <canvas
            ref="canvasRef"
            :width="canvasWidth"
            :height="canvasHeight"
            :aria-label="t('coordinate.canvasLabel')"
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
const VIEW_COLUMNS = 15;
const VIEW_ROWS = 9;

const mapOptions = computed(() => (props.catalog?.maps || []).filter((map) => Number(map.id) > 0));
const screenWidth = computed(() => Math.max(1, Number(props.catalog?.screenWidth) || 816));
const screenHeight = computed(() => Math.max(1, Number(props.catalog?.screenHeight) || 624));
const tileSize = computed(() => Math.max(1, Number(mapPayload.value?.tileSize || props.catalog?.tileSize) || 48));
const viewport = computed(() => {
  const map = mapPayload.value?.map;
  if (!map) return { left: 0, top: 0, width: 1, height: 1 };
  const width = Math.min(VIEW_COLUMNS, map.width);
  const height = Math.min(VIEW_ROWS, map.height);
  return {
    left: clamp(x.value - Math.floor(width / 2), 0, Math.max(0, map.width - width)),
    top: clamp(y.value - Math.floor(height / 2), 0, Math.max(0, map.height - height)),
    width,
    height,
  };
});
const canvasWidth = computed(() => mode.value === 'screen' ? screenWidth.value : viewport.value.width * tileSize.value);
const canvasHeight = computed(() => mode.value === 'screen' ? screenHeight.value : viewport.value.height * tileSize.value);
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
    paint();
  } catch (cause) {
    mapPayload.value = null;
    tilesetImages.value = [];
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function normalizeAndPaint() {
  normalizeSelection();
  void nextTick(paint);
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

function paintMap(context: CanvasRenderingContext2D) {
  const payload = mapPayload.value;
  if (!payload) return;
  const cropped = cropMap(payload.map as MvMap, viewport.value);
  drawMapContent(context, cropped, {
    tilesetImages: tilesetImages.value,
    tilesetFlags: payload.tileset?.flags || [],
    tileSize: tileSize.value,
    showGrid: true,
  });
  const localX = x.value - viewport.value.left;
  const localY = y.value - viewport.value.top;
  context.save();
  context.strokeStyle = '#ffcc4d';
  context.lineWidth = Math.max(2, tileSize.value / 16);
  context.strokeRect(localX * tileSize.value + 1, localY * tileSize.value + 1, tileSize.value - 2, tileSize.value - 2);
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
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
  const py = (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
  if (mode.value === 'screen') {
    x.value = clamp(Math.round(px), 0, maxX.value);
    y.value = clamp(Math.round(py), 0, maxY.value);
  } else {
    x.value = clamp(viewport.value.left + Math.floor(px / tileSize.value), 0, maxX.value);
    y.value = clamp(viewport.value.top + Math.floor(py / tileSize.value), 0, maxY.value);
  }
  paint();
}

function commit() {
  if (loading.value || error.value) return;
  emit('commit', { mapId: mapId.value, x: x.value, y: y.value });
  close();
}

function cropMap(map: MvMap, view: { left: number; top: number; width: number; height: number }): MvMap {
  const layerSize = map.width * map.height;
  const layerCount = Math.max(1, Math.floor(map.data.length / Math.max(1, layerSize)));
  const data: number[] = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    for (let localY = 0; localY < view.height; localY += 1) {
      for (let localX = 0; localX < view.width; localX += 1) {
        const source = layer * layerSize + (view.top + localY) * map.width + view.left + localX;
        data.push(Number(map.data[source]) || 0);
      }
    }
  }
  const events = (map.events || []).map((event) => {
    if (!event || event.x < view.left || event.y < view.top || event.x >= view.left + view.width || event.y >= view.top + view.height) return null;
    return { ...event, x: event.x - view.left, y: event.y - view.top };
  });
  return { ...map, width: view.width, height: view.height, data, events };
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
.coordinate-stage { position:relative; min-height:220px; display:grid; place-items:center; padding:12px; overflow:auto; background:var(--app-bg-sunken); }
.coordinate-stage canvas { display:block; max-width:100%; max-height:440px; border:1px solid var(--app-border-strong); background:#171a1f; cursor:crosshair; image-rendering:pixelated; }
.coordinate-stage.loading canvas { opacity:.4; }
.coordinate-status { position:absolute; inset:0; display:grid; place-items:center; padding:20px; color:var(--app-ink-muted); background:color-mix(in srgb,var(--app-bg) 72%,transparent); text-align:center; }
.coordinate-status.error { color:var(--app-danger); }
.coordinate-hint { margin:0; padding:7px 12px; border-top:1px solid var(--app-border); color:var(--app-ink-muted); font-size:11px; }
@media (max-width:620px) { .coordinate-controls { grid-template-columns:1fr 72px 72px; }.coordinate-size { display:none; } }
</style>
