<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog route-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="move-route-title">
        <header class="editor-modal-header"><strong id="move-route-title" class="editor-modal-title">{{ t('moveRoute.title') }}</strong><button type="button" class="editor-modal-close" :aria-label="t('moveRoute.closeTitle')" :title="t('eventcmd.close')" @click="close">×</button></header>
        <div class="route-body">
          <aside class="route-side">
            <select v-if="targetOptions" v-model.number="target" class="route-target">
              <option v-for="[value, label] in targetOptions" :key="value" :value="value">{{ label }}</option>
            </select>
            <div class="route-list">
              <button v-for="(step, index) in steps" :key="index" type="button" :class="{ active: selected === index }" @click="selected = index" @dblclick="editStep(index)">◇{{ localizedMoveRouteCommandLabel(step) }}</button>
            </div>
            <div class="route-actions">
              <el-button size="small" :disabled="selected == null || selected <= 0" @click="move(-1)">{{ t('cmdList.moveUp') }}</el-button>
              <el-button size="small" :disabled="selected == null || selected >= steps.length - 1" @click="move(1)">{{ t('cmdList.moveDown') }}</el-button>
              <el-button size="small" type="danger" :disabled="selected == null" @click="remove">{{ t('cmdList.delete') }}</el-button>
            </div>
            <div class="route-options">
              <label><input v-model="draft.repeat" type="checkbox" /> {{ t('moveRoute.repeat') }}</label>
              <label><input v-model="draft.skippable" type="checkbox" /> {{ t('moveRoute.skipIfCannot') }}</label>
              <label><input v-model="draft.wait" type="checkbox" /> {{ t('moveRoute.waitForCompletion') }}</label>
            </div>
          </aside>
          <main class="route-commands">
            <strong class="route-commands-title">{{ t('moveRoute.commands') }}</strong>
            <div class="route-command-grid">
              <button v-for="[code, label] in localizedMoveRouteOperations" :key="code" type="button" class="editor-btn" @click="pickOperation(Number(code))">{{ label }}{{ PARAM_CODES.has(Number(code)) ? '…' : '' }}</button>
            </div>
            <section class="route-preview" :class="{ stopped: preview.stop }">
              <div class="route-preview-heading">
                <strong>{{ t('moveRoute.preview') }}</strong>
                <span>{{ previewStatus }}</span>
              </div>
              <svg viewBox="0 0 240 120" role="img" :aria-label="t('moveRoute.preview')">
                <defs>
                  <pattern id="route-preview-grid" width="12" height="12" patternUnits="userSpaceOnUse">
                    <path d="M 12 0 L 0 0 0 12" class="preview-grid-line" />
                  </pattern>
                </defs>
                <rect width="240" height="120" class="preview-grid" />
                <polyline v-if="previewGeometry.points.length > 1" :points="previewGeometry.polyline" class="preview-path" />
                <circle
                  v-for="(point, index) in previewGeometry.points"
                  :key="`${point.x}:${point.y}:${index}`"
                  :cx="point.x"
                  :cy="point.y"
                  :r="index === 0 || index === previewGeometry.points.length - 1 ? 4 : 2"
                  :class="index === 0 ? 'preview-start' : index === previewGeometry.points.length - 1 ? 'preview-end' : 'preview-point'"
                />
                <text :x="previewGeometry.end.x + 7" :y="previewGeometry.end.y + 4" class="preview-direction">{{ previewDirection }}</text>
              </svg>
              <p>{{ t('moveRoute.previewNote') }}</p>
            </section>
          </main>
        </div>
        <footer class="editor-modal-footer"><button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button><button type="button" class="editor-btn primary" @click="commit">{{ t('eventcmd.ok') }}</button></footer>
        <div v-if="paramStep" class="route-param-overlay" @mousedown.self="closeParamEditor">
          <section class="route-param-dialog" role="dialog" aria-modal="true">
            <header class="editor-modal-header"><strong class="editor-modal-title">{{ paramTitle }}</strong><button type="button" class="editor-modal-close" :title="t('eventcmd.close')" @click="closeParamEditor">×</button></header>
            <div class="route-params">
              <template v-if="paramStep.code === 14">
                <label>{{ t('moveRoute.hDistance') }}
                  <input type="number" :value="numberParam(0, 0)" @input="setParam(0, numberValue($event))" />
                </label>
                <label>{{ t('moveRoute.vDistance') }}
                  <input type="number" :value="numberParam(1, 0)" @input="setParam(1, numberValue($event))" />
                </label>
              </template>
              <label v-else-if="paramStep.code === 15">{{ t('moveRoute.waitFrames') }}
                <input type="number" min="1" :value="numberParam(0, 1)" @input="setParam(0, numberValue($event))" />
              </label>
              <label v-else-if="[27, 28].includes(paramStep.code)">{{ t('moveRoute.switchId') }}
                <input type="number" min="1" :value="numberParam(0, 1)" @input="setParam(0, numberValue($event))" />
              </label>
              <label v-else-if="paramStep.code === 29">{{ t('moveRoute.speed') }}
                <select :value="numberParam(0, 4)" @change="setParam(0, numberValue($event))">
                  <option v-for="[value, label] in localizedMoveSpeeds" :key="value" :value="Number(value)">{{ label }}</option>
                </select>
              </label>
              <label v-else-if="paramStep.code === 30">{{ t('moveRoute.frequency') }}
                <select :value="numberParam(0, 3)" @change="setParam(0, numberValue($event))">
                  <option v-for="[value, label] in localizedMoveFreqs" :key="value" :value="Number(value)">{{ label }}</option>
                </select>
              </label>
              <template v-else-if="paramStep.code === 41">
                <label>{{ t('moveRoute.charFile') }}
                  <input :value="stringParam(0)" @input="setParam(0, inputValue($event))" />
                </label>
                <label>{{ t('moveRoute.imageIndex') }}
                  <input type="number" min="0" :value="numberParam(1, 0)" @input="setParam(1, numberValue($event))" />
                </label>
              </template>
              <label v-else-if="paramStep.code === 42">{{ t('moveRoute.opacity') }}
                <input type="number" min="0" max="255" :value="numberParam(0, 255)" @input="setParam(0, numberValue($event))" />
              </label>
              <label v-else-if="paramStep.code === 43">{{ t('moveRoute.blendMode') }}
                <select :value="numberParam(0, 0)" @change="setParam(0, numberValue($event))">
                  <option v-for="[value, label] in BLEND_OPTIONS" :key="value" :value="value">{{ label }}</option>
                </select>
              </label>
              <template v-else-if="paramStep.code === 44">
                <label>{{ t('moveRoute.seName') }}
                  <input :value="seParam().name ? String(seParam().name) : ''" @input="setSeParam('name', inputValue($event))" />
                </label>
                <label>{{ t('moveRoute.volume') }}
                  <input type="number" min="0" max="100" :value="Number(seParam().volume ?? 90)" @input="setSeParam('volume', numberValue($event))" />
                </label>
                <label>{{ t('moveRoute.pitch') }}
                  <input type="number" min="50" max="150" :value="Number(seParam().pitch ?? 100)" @input="setSeParam('pitch', numberValue($event))" />
                </label>
                <label>{{ t('moveRoute.pan') }}
                  <input type="number" min="-100" max="100" :value="Number(seParam().pan ?? 0)" @input="setSeParam('pan', numberValue($event))" />
                </label>
              </template>
              <label v-else-if="paramStep.code === 45" class="route-param-wide">{{ t('moveRoute.script') }}
                <textarea :value="stringParam(0)" rows="4" @input="setParam(0, inputValue($event))" />
              </label>
            </div>
            <footer class="editor-modal-footer"><button type="button" class="editor-btn" @click="closeParamEditor">{{ t('eventcmd.cancel') }}</button><button type="button" class="editor-btn primary" @click="confirmParamStep">{{ t('eventcmd.ok') }}</button></footer>
          </section>
        </div>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import { clone, defaultMoveRoute, moveRouteCommandLabel, type MvMoveRoute } from '../../composables/useEventEditor';
import { eventEditorText } from '../../utils/eventEditorLocalization';
import { simulateMoveRoute } from '../../utils/moveRoutePreview';
const props = withDefaults(defineProps<{ previewX?: number; previewY?: number }>(), { previewX: 0, previewY: 0 });
const emit = defineEmits<{ commit: [route: MvMoveRoute, target: number | null]; cancel: [] }>();
const { language, t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
type MoveRouteStep = MvMoveRoute['list'][number];
// Movement commands that open the small parameter dialog before joining the list.
const PARAM_CODES = new Set([14, 15, 27, 28, 29, 30, 41, 42, 43, 44, 45]);
const visible = ref(false);
const draft = ref<MvMoveRoute>(defaultMoveRoute());
const selected = ref<number | null>(null);
// Merged Set Movement Route (205) mode: the target dropdown lives in this dialog.
const target = ref(0);
const targetOptions = ref<[number, string][] | null>(null);
const paramStep = ref<MoveRouteStep | null>(null);
const paramEditIndex = ref<number | null>(null);
let committing = false;
const steps = computed(() => draft.value.list);
const paramTitle = computed(() => paramStep.value ? eventEditorText(language.value).moveRouteLabels[paramStep.value.code] || '' : '');
const BLEND_OPTIONS = computed(() => eventEditorText(language.value).blendModes);
const localizedMoveSpeeds = computed(() => eventEditorText(language.value).moveSpeeds);
const localizedMoveFreqs = computed(() => eventEditorText(language.value).moveFrequencies);
const localizedMoveRouteOperations = computed(() => eventEditorText(language.value).moveRouteOperations);
const preview = computed(() => simulateMoveRoute(draft.value.list, { x: props.previewX, y: props.previewY }));
const previewGeometry = computed(() => buildPreviewGeometry(preview.value.points));
const previewDirection = computed(() => ({ 2: '↓', 4: '←', 6: '→', 8: '↑' }[preview.value.finalState.direction]));
const previewStatus = computed(() => {
  const stop = preview.value.stop;
  if (!stop) return t('moveRoute.previewComplete', {
    x: preview.value.finalState.x,
    y: preview.value.finalState.y,
    frames: preview.value.finalState.elapsedFrames,
  });
  return t(`moveRoute.previewStop.${stop.kind}`, { step: stop.stepIndex + 1, code: stop.code });
});

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  if (paramStep.value) { closeParamEditor(); return; }
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function open(route: MvMoveRoute, options?: { target?: number; targetOptions?: [number, string][] }) {
  draft.value = clone(route || defaultMoveRoute());
  draft.value.list = draft.value.list.filter((step) => step.code !== 0);
  selected.value = null;
  targetOptions.value = options?.targetOptions ?? null;
  target.value = options?.target ?? 0;
  paramStep.value = null;
  paramEditIndex.value = null;
  visible.value = true;
}
function close() {
  if (!visible.value) return;
  visible.value = false;
  paramStep.value = null;
  if (!committing) emit('cancel');
}
function pickOperation(code: number) {
  if (PARAM_CODES.has(code)) {
    paramStep.value = { code, parameters: defaultStepParameters(code) };
    paramEditIndex.value = null;
    return;
  }
  insertStep({ code, parameters: [] });
}
function insertStep(step: MoveRouteStep) {
  const at = selected.value == null ? draft.value.list.length : selected.value + 1;
  draft.value.list.splice(at, 0, step);
  selected.value = at;
}
function editStep(index: number) {
  const step = draft.value.list[index];
  if (!step || !PARAM_CODES.has(step.code)) return;
  paramStep.value = clone(step);
  paramEditIndex.value = index;
}
function confirmParamStep() {
  if (!paramStep.value) return;
  if (paramEditIndex.value == null) insertStep(clone(paramStep.value));
  else draft.value.list[paramEditIndex.value] = clone(paramStep.value);
  closeParamEditor();
}
function closeParamEditor() {
  paramStep.value = null;
  paramEditIndex.value = null;
}
function move(offset: number) {
  if (selected.value == null) return;
  const next = selected.value + offset;
  if (next < 0 || next >= draft.value.list.length) return;
  const [step] = draft.value.list.splice(selected.value, 1);
  draft.value.list.splice(next, 0, step);
  selected.value = next;
}
function remove() {
  if (selected.value == null) return;
  draft.value.list.splice(selected.value, 1);
  selected.value = draft.value.list.length ? Math.min(selected.value, draft.value.list.length - 1) : null;
}
function setParam(index: number, value: unknown) {
  if (!paramStep.value) return;
  paramStep.value.parameters[index] = value;
}
function numberParam(index: number, fallback = 0) {
  return Number(paramStep.value?.parameters[index] ?? fallback);
}
function stringParam(index: number, fallback = '') {
  return String(paramStep.value?.parameters[index] ?? fallback);
}
function seParam(): Record<string, unknown> {
  const value = paramStep.value?.parameters[0];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function setSeParam(key: string, value: unknown) {
  setParam(0, { name: '', volume: 90, pitch: 100, pan: 0, ...seParam(), [key]: value });
}
function inputValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}
function numberValue(event: Event) {
  return Number(inputValue(event));
}
function commit() {
  committing = true;
  emit('commit', { ...clone(draft.value), list: [...clone(draft.value.list), { code: 0, parameters: [] }] }, targetOptions.value ? target.value : null);
  visible.value = false;
  paramStep.value = null;
  committing = false;
}
function localizedMoveRouteCommandLabel(step: MoveRouteStep): string {
  return moveRouteCommandLabel(step, language.value);
}
function defaultStepParameters(code: number): unknown[] {
  if (code === 14) return [0, 0];
  if (code === 15) return [60];
  if (code === 27 || code === 28) return [1];
  if (code === 29) return [4];
  if (code === 30) return [3];
  if (code === 41) return ['', 0];
  if (code === 42) return [255];
  if (code === 43) return [0];
  if (code === 44) return [{ name: '', volume: 90, pitch: 100, pan: 0 }];
  if (code === 45) return [''];
  return [];
}

function buildPreviewGeometry(points: Array<{ x: number; y: number }>) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(24, 204 / Math.max(1, maxX - minX), 84 / Math.max(1, maxY - minY));
  const offsetX = 18 + (204 - (maxX - minX) * scale) / 2;
  const offsetY = 18 + (84 - (maxY - minY) * scale) / 2;
  const mapped = points.map((point) => ({ x: offsetX + (point.x - minX) * scale, y: offsetY + (point.y - minY) * scale }));
  const end = mapped[mapped.length - 1] || { x: 120, y: 60 };
  return { points: mapped, end, polyline: mapped.map((point) => `${point.x},${point.y}`).join(' ') };
}

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog { width: min(940px, 94vw); }
.route-body { min-height: 420px; display: grid; grid-template-columns: 250px 1fr; }
.route-side { min-width: 0; padding: 12px; display: flex; flex-direction: column; gap: 8px; border-right: 1px solid var(--app-border); color: var(--app-ink-muted); font-size: 12px; }
select, textarea, input { padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); }
.route-target { width: 100%; }
.route-list { flex: 1; min-height: 200px; overflow: auto; border: 1px solid var(--app-border); background: var(--app-bg); }
.route-list button { width: 100%; min-height: 26px; padding: 0 8px; border: 0; background: var(--app-bg); color: var(--app-ink); text-align: left; cursor: pointer; }
.route-list button:nth-child(even) { background: var(--app-bg-soft); }
.route-list button:hover { background: var(--app-bg-sunken); }
.route-list button.active { background: var(--app-accent); color: var(--app-accent-ink); }
.route-actions { display: flex; gap: 6px; }
.route-options { display: grid; gap: 4px; color: var(--app-ink); font-size: 13px; }
.route-commands { min-width: 0; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.route-commands-title { color: var(--app-ink); font-size: 13px; }
.route-command-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(15, minmax(0, auto)); grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 6px; }
.route-command-grid .editor-btn { min-width: 0; padding: 3px 6px; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.route-preview { margin-top: auto; padding: 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg-soft); }
.route-preview.stopped { border-color: var(--app-warn); }
.route-preview-heading { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 6px; color: var(--app-ink); font-size: 12px; }
.route-preview-heading span { color: var(--app-ink-muted); text-align: right; }
.route-preview svg { width: 100%; height: 96px; display: block; border: 1px solid var(--app-border); background: var(--app-bg); }
.preview-grid { fill: url(#route-preview-grid); }
.preview-grid-line { fill: none; stroke: var(--app-border); stroke-width: .5; }
.preview-path { fill: none; stroke: var(--app-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.preview-start { fill: var(--app-success); }
.preview-end { fill: var(--app-accent); }
.preview-point { fill: var(--app-ink-muted); }
.preview-direction { fill: var(--app-ink); font-size: 13px; font-weight: 700; }
.route-preview p { margin: 5px 0 0; color: var(--app-ink-muted); font-size: 11px; }
.route-param-overlay { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; border-radius: inherit; background: color-mix(in srgb, var(--app-ink) 22%, transparent); }
.route-param-dialog { width: min(380px, 90%); border: 1px solid var(--app-border-strong); border-radius: var(--app-radius); background: var(--app-bg); box-shadow: var(--app-shadow-lg, 0 12px 32px rgba(0, 0, 0, .25)); }
.route-params { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; color: var(--app-ink-muted); font-size: 12px; }
.route-params label { min-width: 0; display: grid; gap: 4px; margin: 0; }
.route-params textarea, .route-params .route-param-wide { grid-column: 1 / -1; }
@media (max-width: 720px) { .route-body { grid-template-columns: 1fr; } .route-side { border-right: 0; border-bottom: 1px solid var(--app-border); } }
</style>
