<template>
  <div v-if="definition" class="command-fields">
    <label v-for="field in visibleFields" :key="field.label + field.path.join('.')">
      <span>{{ field.label }}</span>
      <input v-if="field.kind === 'text'" :value="displayValue(field)" @input="setField(field, inputValue($event))" />
      <textarea v-else-if="field.kind === 'multiline'" :value="displayValue(field)" rows="4" @input="setField(field, inputValue($event))" />
      <input v-else-if="field.kind === 'number'" :value="displayValue(field)" type="number" :min="field.min" :max="field.max" @input="setField(field, numberValue($event))" />
      <input v-else-if="field.kind === 'boolean'" :checked="Boolean(fieldValue(field))" type="checkbox" @change="setField(field, checkedValue($event))" />
      <select v-else-if="field.kind === 'select'" :value="displayValue(field)" @change="setField(field, optionValue(field, inputValue($event)))">
        <option v-for="[value, label] in field.options || []" :key="String(value)" :value="String(value)">{{ label }}</option>
      </select>
      <select v-else-if="field.kind === 'eventTarget'" :value="displayValue(field)" @change="setField(field, numberValue($event))">
        <option v-for="[value, label] in eventTargetOptions(field)" :key="value" :value="value">{{ label }}</option>
      </select>
      <select v-else-if="field.kind === 'database'" :value="displayValue(field)" @change="setField(field, numberValue($event))">
        <option v-for="entry in databaseOptions(field)" :key="entry.id" :value="entry.id">{{ String(entry.id).padStart(4, '0') }} {{ entry.name }}</option>
      </select>
      <button v-else-if="isImageAssetField(field)" type="button" class="asset-picker-button" @click="openImageField(field)">
        {{ displayValue(field) || t('imgPicker.none') }}
      </button>
      <select v-else-if="field.kind === 'asset'" :value="displayValue(field)" @change="setField(field, inputValue($event))">
        <option value="">{{ t('imgPicker.none') }}</option>
        <option v-for="asset in assetOptions(field)" :key="asset.fileName" :value="asset.name">{{ asset.name }}</option>
      </select>
    </label>
    <button v-if="coordinateMode" type="button" class="coordinate-picker-button" @click="openCoordinatePicker">
      {{ t(coordinateMode === 'screen' ? 'coordinate.chooseScreen' : 'coordinate.chooseMap') }}
      <span>{{ coordinateSummary }}</span>
    </button>
    <div v-if="command.code === 213" class="balloon-preview">
      <canvas ref="balloonCanvas" width="96" height="96" />
      <span>{{ balloonAssetAvailable ? t('balloon.previewProjectAsset') : t('balloon.assetMissing') }}</span>
    </div>
    <p v-if="!visibleFields.length" class="no-fields">{{ t('cmdFields.noParams') }}</p>
    <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="loadImage" @commit="commitImageField" />
    <CoordinatePickerDialog ref="coordinatePicker" :catalog="catalog" @commit="commitCoordinate" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { RpgMakerEngine } from '@contract/types';
import type { EditorProjectCatalog, NamedCatalogEntry, ProjectAssetEntry } from '../../api/client';
import type { EditorEventListItem } from './editorTypes';
import { useI18n } from '../../i18n';
import { commandDefinition, type CommandAssetKey, type CommandField, type CommandFieldVisibility } from '../../composables/eventCommandCatalog';
import { localizeCommandField } from '../../utils/eventCommandLocalization';
import type { MvCommand } from '../../composables/useEventEditor';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';
import CoordinatePickerDialog from './CoordinatePickerDialog.vue';

const props = defineProps<{
  command: MvCommand;
  engine: RpgMakerEngine;
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
  mapId?: number | null;
  currentEvents?: EditorEventListItem[];
}>();
const emit = defineEmits<{ change: [] }>();
const { language, t } = useI18n();
const definition = computed(() => commandDefinition(props.command.code, props.engine));
const visibleFields = computed(() => (definition.value?.fields || [])
  .filter((field) => isFieldVisible(field) && !isPairedImageIndexField(field))
  .map((field) => localizeCommandField(field, language.value)));
const imagePicker = ref<InstanceType<typeof ImageAssetPickerDialog> | null>(null);
const coordinatePicker = ref<InstanceType<typeof CoordinatePickerDialog> | null>(null);
const balloonCanvas = ref<HTMLCanvasElement | null>(null);
const balloonImage = ref<HTMLImageElement | null>(null);
const balloonAssetAvailable = ref(false);
let balloonFrame = 0;
let balloonTimer: ReturnType<typeof setInterval> | null = null;
const pendingImageField = ref<CommandField | null>(null);
const imageAssetKinds = new Set<CommandAssetKey>([
  'characters',
  'faces',
  'svActors',
  'enemies',
  'svEnemies',
  'tilesets',
  'animations',
  'pictures',
  'parallaxes',
  'battlebacks1',
  'battlebacks2',
  'system',
  'titles1',
  'titles2',
]);
const coordinateMode = computed<'map' | 'screen' | null>(() => {
  const parameters = props.command.parameters;
  if (props.command.code === 201 && Number(parameters[0]) === 0) return 'map';
  if (props.command.code === 202 && Number(parameters[1]) === 0) return 'map';
  if (props.command.code === 203 && Number(parameters[1]) === 0) return 'map';
  if (props.command.code === 285 && Number(parameters[2]) === 0) return 'map';
  if ((props.command.code === 231 || props.command.code === 232) && Number(parameters[3]) === 0) return 'screen';
  return null;
});
const coordinateSummary = computed(() => {
  const spec = coordinateParameterSpec();
  if (!spec) return '';
  const map = spec.mode === 'map' ? `${String(spec.mapId).padStart(3, '0')} · ` : '';
  return `${map}(${spec.x}, ${spec.y})`;
});
watch([
  () => props.command.code,
  () => Number(props.command.parameters[1]),
  () => props.catalog?.assets.system,
], () => { void loadBalloonPreview(); }, { immediate: true });
onMounted(() => {
  balloonTimer = setInterval(() => {
    if (props.command.code !== 213 || !balloonImage.value) return;
    balloonFrame = (balloonFrame + 1) % 8;
    paintBalloonPreview();
  }, 120);
});
onUnmounted(() => { if (balloonTimer) clearInterval(balloonTimer); });

function fieldValue(field: CommandField) {
  let value: unknown = props.command.parameters;
  for (const part of field.path) value = value != null ? (value as Record<string | number, unknown>)[part] : undefined;
  return value ?? '';
}
function displayValue(field: CommandField) { return String(fieldValue(field)); }
function isFieldVisible(field: CommandField) {
  const conditions = Array.isArray(field.visibleWhen) ? field.visibleWhen : field.visibleWhen ? [field.visibleWhen] : [];
  return conditions.every(matchesVisibility);
}
function matchesVisibility(condition: CommandFieldVisibility) {
  const actual = fieldValue({ label: '', path: condition.path, kind: 'text' });
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals];
  return expected.some((value) => value === actual || String(value) === String(actual));
}
function setPath(path: CommandField['path'], value: unknown) {
  let target: unknown[] | Record<string, unknown> = props.command.parameters;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index], next = path[index + 1];
    const record = target as Record<string | number, unknown>;
    if (record[part] == null || typeof record[part] !== 'object') record[part] = typeof next === 'number' ? [] : {};
    target = record[part] as unknown[] | Record<string, unknown>;
  }
  (target as Record<string | number, unknown>)[path[path.length - 1]] = value;
}
function setField(field: CommandField, value: unknown) {
  setPath(field.path, value);
  emit('change');
}
function optionValue(field: CommandField, value: string) {
  return field.options?.find(([entry]) => String(entry) === value)?.[0] ?? value;
}
function eventTargetOptions(field: CommandField): [number, string][] {
  const config = field.eventTarget;
  if (!config) throw new Error(`Event target field is missing its target policy: ${field.label}`);
  const options: [number, string][] = [];
  if (config.allowThisEvent) options.push([0, t('cmdFields.thisEvent')]);
  if (config.allowPlayer) options.push([-1, t('cmdFields.player')]);
  if (config.allowMapEvents) {
    const seen = new Set<number>();
    for (const event of [...(props.currentEvents || [])].sort((left, right) => left.id - right.id)) {
      if (!Number.isInteger(event.id) || event.id <= 0 || seen.has(event.id)) continue;
      seen.add(event.id);
      options.push([event.id, t('cmdFields.mapEvent', { id: String(event.id).padStart(3, '0'), name: event.name })]);
    }
  }
  const current = Number(fieldValue(field));
  if (Number.isFinite(current) && !options.some(([value]) => value === current)) {
    const label = current > 0
      ? t(props.currentEvents ? 'cmdFields.missingEvent' : 'cmdFields.eventReference', { id: String(current).padStart(3, '0') })
      : t('cmdFields.unavailableTarget', { id: String(current) });
    options.unshift([current, label]);
  }
  return options;
}
function databaseOptions(field: CommandField): NamedCatalogEntry[] {
  if (!field.catalog || !props.catalog) return [];
  return (props.catalog[field.catalog] || []) as NamedCatalogEntry[];
}
function assetOptions(field: CommandField): ProjectAssetEntry[] {
  return field.asset && props.catalog ? props.catalog.assets[field.asset] || [] : [];
}
function isImageAssetField(field: CommandField): boolean {
  return field.kind === 'asset' && Boolean(field.asset && imageAssetKinds.has(field.asset));
}
function openImageField(field: CommandField): void {
  if (!field.asset || !isImageAssetField(field)) return;
  pendingImageField.value = field;
  const indexPath = pairedImageIndexPath(field);
  imagePicker.value?.open({
    asset: field.asset,
    mode: imagePickerMode(field),
    title: t('cmdFields.chooseField', { field: String(field.label) }),
    name: String(fieldValue(field) || ''),
    index: indexPath ? Number(fieldValue({ label: '', path: indexPath, kind: 'number' })) : 0,
  });
}
function commitImageField(selection: { name: string; index: number }): void {
  const field = pendingImageField.value;
  if (!field) return;
  setPath(field.path, selection.name);
  const indexPath = pairedImageIndexPath(field);
  if (indexPath) setPath(indexPath, selection.name ? selection.index : 0);
  pendingImageField.value = null;
  emit('change');
}
function openCoordinatePicker(): void {
  const spec = coordinateParameterSpec();
  if (!spec) return;
  coordinatePicker.value?.open({
    mode: spec.mode,
    mapId: spec.mapId,
    x: spec.x,
    y: spec.y,
    allowMapChange: spec.allowMapChange,
  });
}
function commitCoordinate(selection: { mapId: number; x: number; y: number }): void {
  if (props.command.code === 201) {
    setPath([1], selection.mapId); setPath([2], selection.x); setPath([3], selection.y);
  } else if (props.command.code === 202) {
    setPath([2], selection.mapId); setPath([3], selection.x); setPath([4], selection.y);
  } else if (props.command.code === 203) {
    setPath([2], selection.x); setPath([3], selection.y);
  } else if (props.command.code === 285) {
    setPath([3], selection.x); setPath([4], selection.y);
  } else if (props.command.code === 231 || props.command.code === 232) {
    setPath([4], selection.x); setPath([5], selection.y);
  }
  emit('change');
}
function coordinateParameterSpec(): { mode: 'map' | 'screen'; mapId: number; x: number; y: number; allowMapChange: boolean } | null {
  const p = props.command.parameters;
  if (props.command.code === 201 && Number(p[0]) === 0) return { mode: 'map', mapId: Number(p[1]) || Number(props.mapId) || 1, x: Number(p[2]) || 0, y: Number(p[3]) || 0, allowMapChange: true };
  if (props.command.code === 202 && Number(p[1]) === 0) return { mode: 'map', mapId: Number(p[2]) || Number(props.mapId) || 1, x: Number(p[3]) || 0, y: Number(p[4]) || 0, allowMapChange: true };
  if (props.command.code === 203 && Number(p[1]) === 0) return { mode: 'map', mapId: Number(props.mapId) || 1, x: Number(p[2]) || 0, y: Number(p[3]) || 0, allowMapChange: false };
  if (props.command.code === 285 && Number(p[2]) === 0) return { mode: 'map', mapId: Number(props.mapId) || 1, x: Number(p[3]) || 0, y: Number(p[4]) || 0, allowMapChange: false };
  if ((props.command.code === 231 || props.command.code === 232) && Number(p[3]) === 0) return { mode: 'screen', mapId: Number(props.mapId) || 1, x: Number(p[4]) || 0, y: Number(p[5]) || 0, allowMapChange: false };
  return null;
}
async function loadBalloonPreview(): Promise<void> {
  if (props.command.code !== 213) return;
  const asset = props.catalog?.assets.system.find((entry) => {
    const name = (entry.name || entry.fileName).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').toLowerCase();
    return name === 'balloon';
  });
  balloonImage.value = asset ? await props.loadImage(asset.url) : null;
  balloonAssetAvailable.value = Boolean(balloonImage.value);
  balloonFrame = 0;
  await nextTick();
  paintBalloonPreview();
}
function paintBalloonPreview(): void {
  const canvas = balloonCanvas.value;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#171a1f';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const image = balloonImage.value;
  if (!image) {
    context.fillStyle = '#9aa2ad';
    context.font = '11px sans-serif';
    context.textAlign = 'center';
    context.fillText('Balloon.png', canvas.width / 2, canvas.height / 2);
    return;
  }
  const cellSize = Math.floor(image.naturalWidth / 8);
  const balloonId = Math.max(1, Math.trunc(Number(props.command.parameters[1]) || 1));
  const sourceY = (balloonId - 1) * cellSize;
  if (cellSize <= 0 || sourceY + cellSize > image.naturalHeight) return;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, balloonFrame * cellSize, sourceY, cellSize, cellSize, 0, 0, canvas.width, canvas.height);
}
function imagePickerMode(field: CommandField): 'plain' | 'face' | 'character' {
  if (field.asset === 'faces') return 'face';
  if (field.asset === 'characters' && pairedImageIndexPath(field)) return 'character';
  return 'plain';
}
function pairedImageIndexPath(field: CommandField): CommandField['path'] | null {
  if (props.command.code === 322 && (samePath(field.path, [1]) || samePath(field.path, [3]))) {
    return [Number(field.path[0]) + 1];
  }
  if (props.command.code === 323 && samePath(field.path, [1])) return [2];
  return null;
}
function isPairedImageIndexField(field: CommandField): boolean {
  if (props.command.code === 322 && (samePath(field.path, [2]) || samePath(field.path, [4]))) return true;
  if (props.command.code === 323 && samePath(field.path, [2])) return true;
  return false;
}
function samePath(left: CommandField['path'], right: CommandField['path']): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
function inputValue(event: Event) { return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value; }
function numberValue(event: Event) { return Number(inputValue(event)); }
function checkedValue(event: Event) { return (event.target as HTMLInputElement).checked; }
</script>

<style scoped>
.command-fields { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
label { min-width: 0; display: grid; gap: 4px; color: var(--app-ink-soft); font-size: 12px; }
input:not([type="checkbox"]), select, textarea { min-width: 0; padding: 5px 6px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font-size: 13px; }
.asset-picker-button { min-width: 0; min-height: 30px; overflow: hidden; padding: 5px 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font-size: 13px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.asset-picker-button:hover { border-color: var(--app-accent); background: var(--app-accent-soft); }
textarea { grid-column: 1 / -1; font-family: var(--app-font-mono); resize: vertical; }
label:has(textarea) { grid-column: 1 / -1; }
input[type="checkbox"] { justify-self: start; }
.no-fields { grid-column: 1 / -1; margin: 0; color: var(--app-ink-muted); font-size: 12px; }
.coordinate-picker-button { grid-column:1 / -1; min-height:30px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:5px 8px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-bg-soft); color:var(--app-ink); cursor:pointer; }
.coordinate-picker-button:hover { border-color:var(--app-accent); background:var(--app-accent-soft); }
.coordinate-picker-button span { color:var(--app-ink-muted); font:11px var(--app-font-mono); }
.balloon-preview { grid-column:1 / -1; display:flex; align-items:center; gap:10px; color:var(--app-ink-muted); font-size:11px; }
.balloon-preview canvas { width:72px; height:72px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); image-rendering:pixelated; background:#171a1f; }
</style>
