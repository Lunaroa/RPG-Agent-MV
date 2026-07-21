<template>
  <section class="runtime-preview" :class="{ dragging }" data-ui-id="map-runtime-preview">
    <div v-if="error" class="preview-state error" role="alert">
      <WarningFilled />
      <strong>{{ t('editor.preview.failed') }}</strong>
      <p class="error-summary">{{ error }}</p>
      <div class="error-actions">
        <button v-if="diagnostic" type="button" @click="detailsOpen = !detailsOpen">
          {{ detailsOpen ? t('editor.preview.hideDetails') : t('editor.preview.showDetails') }}
        </button>
        <button type="button" @click="$emit('retry')">{{ t('editor.preview.retry') }}</button>
      </div>
      <div v-if="diagnostic && detailsOpen" class="error-details">
        <dl>
          <template v-for="row in diagnosticRows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
        <div v-if="diagnostic.detail.resources?.length" class="diagnostic-section">
          <b>{{ t('editor.preview.diagnosticResources') }}</b>
          <ul>
            <li v-for="resource in diagnostic.detail.resources" :key="resource">{{ resource }}</li>
          </ul>
        </div>
        <div class="diagnostic-section">
          <b>{{ t('editor.preview.diagnosticMessage') }}</b>
          <pre>{{ diagnostic.detail.message }}</pre>
        </div>
        <div v-if="diagnostic.detail.runtimeOutput" class="diagnostic-section">
          <b>{{ t('editor.preview.diagnosticRuntimeOutput') }}</b>
          <pre>{{ diagnostic.detail.runtimeOutput }}</pre>
        </div>
        <button type="button" @click="$emit('copy-diagnostic')">{{ t('editor.preview.copyDiagnostic') }}</button>
      </div>
    </div>

    <div v-if="!error && !hasDisplayablePreview" class="preview-state preview-loading" aria-live="polite">
      <span class="preview-spinner" aria-hidden="true" />
      <strong>{{ statusLabel }}</strong>
      <p>{{ t('editor.preview.loadingHint') }}</p>
    </div>

    <div
      v-show="!error && Boolean(iframeUrl)"
      ref="viewportRef"
      class="runtime-viewport"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="stopDrag"
      @pointercancel="stopDrag"
      @auxclick.prevent
      @wheel.prevent="adjustScale"
    >
      <div class="runtime-map-layer" :style="layerStyle">
        <iframe
          v-if="iframeUrl"
          ref="iframeRef"
          class="runtime-map-frame"
          :src="iframeUrl"
          :title="t('editor.preview.frameAlt')"
          sandbox="allow-scripts allow-same-origin"
          tabindex="-1"
          @load="onIframeLoad"
        />
      </div>
    </div>

    <div v-if="hasDisplayablePreview" class="preview-scale" :aria-label="t('editor.preview.displayScale')">
      <button type="button" data-ui-id="preview-zoom-out" :title="t('editor.view.zoomOut')" @click="zoomOut">−</button>
      <button type="button" data-ui-id="preview-zoom-reset" :title="t('editor.preview.resetScale')" @click="resetView">{{ Math.round(displayScale * 100) }}%</button>
      <button type="button" data-ui-id="preview-zoom-in" :title="t('editor.view.zoomIn')" @click="zoomIn">+</button>
    </div>
    <span
      v-if="hasDisplayablePreview"
      class="preview-fps"
      data-ui-id="preview-actual-fps"
      :title="t('editor.preview.actualFps')"
    >FPS {{ actualFps ?? '--' }}</span>
    <span v-if="status === 'running'" class="runtime-badge"><i />{{ t('editor.preview.live') }}</span>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import type {
  MapPreviewRuntimeCommand,
  MapPreviewRuntimeEvent,
  MapPreviewStatus,
  MapPreviewViewRequest,
} from '@contract/types';
import { useI18n } from '../../i18n';
import type { MapPreviewDiagnostic } from '../../utils/mapPreviewDiagnostics';
import { clampPreviewPan, previewVisibleRegion } from '../../utils/mapPreviewViewport';

const props = defineProps<{
  status: MapPreviewStatus;
  iframeUrl?: string;
  operationId?: number;
  mapRevision?: string;
  mapPixelWidth?: number;
  mapPixelHeight?: number;
  actualFps?: number;
  runtimeCommand?: MapPreviewRuntimeCommand | null;
  presentationEpoch?: number;
  error?: string;
  diagnostic?: MapPreviewDiagnostic | null;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  'runtime-event': [event: MapPreviewRuntimeEvent];
  viewChanged: [view: MapPreviewViewRequest];
  'copy-diagnostic': [];
}>();

const { t } = useI18n();
const viewportRef = ref<HTMLElement>();
const iframeRef = ref<HTMLIFrameElement>();
const viewportWidth = ref(0);
const viewportHeight = ref(0);
const displayScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
const detailsOpen = ref(false);
const runtimeReady = ref(false);
let pointerId: number | null = null;
let lastPoint = { x: 0, y: 0 };
let resizeObserver: ResizeObserver | null = null;
let viewFrame = 0;

const mapWidth = computed(() => Math.max(1, Number(props.mapPixelWidth) || 1));
const mapHeight = computed(() => Math.max(1, Number(props.mapPixelHeight) || 1));
const fitScale = computed(() => {
  if (viewportWidth.value <= 0 || viewportHeight.value <= 0) return 1;
  return Math.min(
    1,
    Math.max(1, viewportWidth.value - 40) / mapWidth.value,
    Math.max(1, viewportHeight.value - 40) / mapHeight.value,
  );
});
const actualScale = computed(() => fitScale.value * displayScale.value);
const hasDisplayablePreview = computed(() => Boolean(
  props.iframeUrl
  && runtimeReady.value
  && ['running', 'resuming', 'suspended'].includes(props.status),
));
const layerStyle = computed(() => ({
  width: `${mapWidth.value}px`,
  height: `${mapHeight.value}px`,
  transform: `translate3d(calc(-50% + ${offsetX.value}px), calc(-50% + ${offsetY.value}px), 0) scale(${actualScale.value})`,
}));
const statusLabel = computed(() => {
  if (props.refreshing) return t('editor.preview.refreshing');
  if (props.status === 'preparing') return t('editor.preview.preparing');
  if (props.status === 'stopping') return t('editor.preview.stopping');
  if (props.status === 'suspending') return t('editor.preview.suspending');
  if (props.status === 'suspended') return t('editor.preview.suspended');
  if (props.status === 'resuming') return t('editor.preview.resuming');
  return t('editor.preview.starting');
});
const diagnosticRows = computed(() => {
  const diagnostic = props.diagnostic;
  if (!diagnostic) return [];
  const detail = diagnostic.detail;
  return [
    { label: t('editor.preview.diagnosticCode'), value: diagnostic.failureCode || t('editor.preview.diagnosticUnknown') },
    { label: t('editor.preview.diagnosticStage'), value: detail.stage },
    { label: t('editor.preview.diagnosticEngine'), value: diagnostic.engine },
    { label: t('editor.preview.diagnosticMapId'), value: String(diagnostic.mapId) },
    { label: t('editor.preview.diagnosticOperationId'), value: String(detail.operationId || diagnostic.operationId || '') },
    { label: t('editor.preview.diagnosticSourceMapId'), value: detail.sourceMapId ? String(detail.sourceMapId) : '' },
    { label: t('editor.preview.diagnosticTargetMapId'), value: detail.targetMapId ? String(detail.targetMapId) : '' },
    { label: t('editor.preview.diagnosticScene'), value: detail.scene || '' },
    { label: t('editor.preview.diagnosticTransferring'), value: booleanDiagnostic(detail.transferring) },
    { label: t('editor.preview.diagnosticResourcesReady'), value: booleanDiagnostic(detail.resourcesReady) },
  ].filter((row) => row.value !== '');
});

function setScale(value: number) {
  const maximum = Math.max(2, 4 / Math.max(.01, fitScale.value));
  displayScale.value = Math.max(.5, Math.min(maximum, Math.round(value * 100) / 100));
  clampOffsets();
}

function zoomIn() { setScale(displayScale.value * 1.25); }
function zoomOut() { setScale(displayScale.value / 1.25); }
function resetView() {
  displayScale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
}
function adjustScale(event: WheelEvent) {
  if (event.deltaY < 0) zoomIn();
  else zoomOut();
}

function startDrag(event: PointerEvent) {
  if ((event.button !== 0 && event.button !== 1) || pointerId !== null) return;
  event.preventDefault();
  pointerId = event.pointerId;
  lastPoint = { x: event.clientX, y: event.clientY };
  dragging.value = true;
  viewportRef.value?.setPointerCapture(event.pointerId);
}
function moveDrag(event: PointerEvent) {
  if (pointerId !== event.pointerId) return;
  offsetX.value += event.clientX - lastPoint.x;
  offsetY.value += event.clientY - lastPoint.y;
  clampOffsets();
  lastPoint = { x: event.clientX, y: event.clientY };
}
function stopDrag(event: PointerEvent) {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  dragging.value = false;
  if (viewportRef.value?.hasPointerCapture(event.pointerId)) viewportRef.value.releasePointerCapture(event.pointerId);
}
function clampOffsets() {
  const clamped = clampPreviewPan({
    x: offsetX.value,
    y: offsetY.value,
    viewportWidth: viewportWidth.value,
    viewportHeight: viewportHeight.value,
    renderedWidth: mapWidth.value * actualScale.value,
    renderedHeight: mapHeight.value * actualScale.value,
  });
  offsetX.value = clamped.x;
  offsetY.value = clamped.y;
}

function queueViewUpdate() {
  if (viewFrame) cancelAnimationFrame(viewFrame);
  viewFrame = requestAnimationFrame(() => {
    viewFrame = 0;
    const viewport = viewportRef.value;
    if (!viewport) return;
    const view = previewVisibleRegion({
      x: offsetX.value,
      y: offsetY.value,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      mapWidth: mapWidth.value,
      mapHeight: mapHeight.value,
      scale: actualScale.value,
    });
    if (view) emit('viewChanged', view);
  });
}

function updateViewportSize() {
  viewportWidth.value = viewportRef.value?.clientWidth || 0;
  viewportHeight.value = viewportRef.value?.clientHeight || 0;
  clampOffsets();
  queueViewUpdate();
}

function onIframeLoad() {
  runtimeReady.value = false;
  sendRuntimeCommand(props.runtimeCommand);
}

function sendRuntimeCommand(command: MapPreviewRuntimeCommand | null | undefined) {
  if (!command || !iframeRef.value?.contentWindow) return;
  iframeRef.value.contentWindow.postMessage(command, '*');
}

function onRuntimeMessage(event: MessageEvent) {
  if (!iframeRef.value?.contentWindow || event.source !== iframeRef.value.contentWindow) return;
  if (!isRuntimeEvent(event.data)) return;
  if (!matchesIframeOrigin(event.origin)) return;
  if (event.data.phase === 'ready') runtimeReady.value = true;
  if (event.data.phase === 'loading-map') runtimeReady.value = false;
  emit('runtime-event', event.data);
}

function isRuntimeEvent(value: unknown): value is MapPreviewRuntimeEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<MapPreviewRuntimeEvent>;
  return event.kind === 'rpg-agent-map-preview'
    && typeof event.sessionId === 'string'
    && typeof event.channelToken === 'string'
    && Number.isInteger(event.operationId)
    && Number.isInteger(event.mapId)
    && typeof event.mapRevision === 'string'
    && ['ready', 'loading-map', 'suspended', 'state', 'fps', 'error'].includes(String(event.phase));
}

function matchesIframeOrigin(origin: string): boolean {
  if (origin === 'null') return true;
  try { return origin === new URL(props.iframeUrl || '').origin; } catch { return false; }
}

function booleanDiagnostic(value: boolean | undefined): string {
  if (value === undefined) return '';
  return value ? t('editor.preview.diagnosticYes') : t('editor.preview.diagnosticNo');
}

watch(
  () => [props.iframeUrl, props.operationId, props.mapRevision, props.presentationEpoch],
  () => { runtimeReady.value = false; },
);
watch(() => props.runtimeCommand, sendRuntimeCommand, { deep: false });
watch(() => [props.error, props.diagnostic], () => { detailsOpen.value = false; });
watch(() => [mapWidth.value, mapHeight.value, viewportWidth.value, viewportHeight.value, displayScale.value, offsetX.value, offsetY.value], queueViewUpdate);
watch(() => [mapWidth.value, mapHeight.value, viewportWidth.value, viewportHeight.value], clampOffsets);
watch(viewportRef, (next, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (next) {
    resizeObserver?.observe(next);
    updateViewportSize();
  }
});

onMounted(() => {
  window.addEventListener('message', onRuntimeMessage);
  resizeObserver = new ResizeObserver(updateViewportSize);
  if (viewportRef.value) resizeObserver.observe(viewportRef.value);
  nextTick(updateViewportSize);
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onRuntimeMessage);
  resizeObserver?.disconnect();
  if (viewFrame) cancelAnimationFrame(viewFrame);
});
</script>

<style scoped>
.runtime-preview{position:relative;min-width:0;min-height:0;flex:1;display:grid;place-items:center;overflow:hidden;border:1px solid #252a31;border-radius:10px;background:#12161b;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:24px 24px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.02),inset 0 18px 60px rgba(0,0,0,.32)}
.runtime-viewport{position:relative;width:100%;height:100%;overflow:hidden;cursor:grab;touch-action:none;user-select:none}.dragging .runtime-viewport{cursor:grabbing}.runtime-map-layer{position:absolute;left:50%;top:50%;transform-origin:center;will-change:transform;filter:drop-shadow(0 12px 30px rgba(0,0,0,.48));pointer-events:none;background:#000}.runtime-map-frame{display:block;width:100%;height:100%;border:0;background:#000;pointer-events:none}
.preview-state{max-width:420px;padding:26px;display:grid;justify-items:center;gap:8px;color:#d7dde5;text-align:center;z-index:3}.preview-loading{position:absolute;inset:0;box-sizing:border-box;max-width:none;align-content:center;background:#12161b;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:24px 24px}.preview-state.error{width:min(680px,calc(100% - 48px));max-width:680px}.preview-state strong{font-size:14px}.preview-state p{margin:0;color:#8f99a7;font-size:12px;line-height:1.6}.preview-state.error :deep(svg){width:24px;color:#ef8f78}.preview-state button{min-height:30px;padding:0 12px;border:1px solid #48515d;border-radius:4px;background:#20262d;color:#edf2f7;font:inherit;font-size:12px;cursor:pointer}.preview-state button:hover{background:#2a323b}.preview-state button:focus-visible{outline:2px solid var(--app-accent);outline-offset:2px}.error-actions{display:flex;gap:8px}.error-details{box-sizing:border-box;width:100%;max-height:min(52vh,520px);padding:14px;overflow:auto;border:1px solid #343b45;border-radius:6px;background:#0d1116;color:#cbd3dd;text-align:left}.error-details dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;margin:0 0 12px;font-size:11px}.error-details dt{color:#7f8a98}.error-details dd{min-width:0;margin:0;overflow-wrap:anywhere;font-family:var(--app-font-mono)}.diagnostic-section{display:grid;gap:6px;margin-top:12px}.diagnostic-section b{color:#9aa6b4;font-size:11px}.diagnostic-section ul{margin:0;padding-left:20px;font:11px/1.55 var(--app-font-mono);overflow-wrap:anywhere}.diagnostic-section pre{max-height:180px;margin:0;padding:10px;overflow:auto;border-radius:4px;background:#080b0f;color:#cbd3dd;font:11px/1.5 var(--app-font-mono);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.error-details>button{margin-top:12px}.preview-spinner{width:20px;height:20px;border:2px solid #3a424d;border-top-color:#d7dde5;border-radius:50%;animation:preview-spin .8s linear infinite}@keyframes preview-spin{to{transform:rotate(360deg)}}
.runtime-badge{position:absolute;right:12px;top:12px;display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid rgba(117,203,151,.28);border-radius:4px;background:rgba(20,28,25,.84);color:#bce7cd;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;backdrop-filter:blur(8px)}.runtime-badge i{width:6px;height:6px;border-radius:50%;background:#72d399;box-shadow:0 0 8px rgba(114,211,153,.7)}
.preview-fps{position:absolute;left:12px;top:12px;padding:5px 8px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(16,20,25,.84);color:#d4dbe4;font:700 10px var(--app-font-mono);letter-spacing:.04em;pointer-events:none;backdrop-filter:blur(8px)}
.preview-scale{position:absolute;left:12px;bottom:12px;display:flex;gap:2px;padding:3px;border:1px solid rgba(255,255,255,.08);border-radius:5px;background:rgba(20,24,29,.86);backdrop-filter:blur(8px)}.preview-scale button{height:26px;min-width:30px;padding:0 7px;border:0;border-radius:3px;background:transparent;color:#b7c0cb;font:600 11px var(--app-font-mono);cursor:pointer}.preview-scale button:hover{background:#303741;color:#fff}.preview-scale button:focus-visible{outline:2px solid var(--app-accent);outline-offset:1px}
</style>
