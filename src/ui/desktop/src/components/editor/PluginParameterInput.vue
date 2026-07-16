<template>
  <div class="plugin-param-input" :class="{ readonly: isReadonly }">
    <textarea
      v-if="isReadonly"
      :value="displayReadonlyValue"
      rows="2"
      readonly
      spellcheck="false"
    />
    <textarea
      v-else-if="field.kind === 'multiline' || field.kind === 'json'"
      :value="stringValue"
      :rows="field.kind === 'multiline' ? 4 : 3"
      spellcheck="false"
      @input="emitValue(inputValue($event))"
    />
    <input
      v-else-if="field.kind === 'number'"
      :value="stringValue"
      type="number"
      :min="field.min"
      :max="field.max"
      :step="numberStep"
      @input="emitValue(inputValue($event))"
    />
    <label v-else-if="field.kind === 'boolean'" class="boolean-input">
      <input :checked="booleanValue" type="checkbox" @change="emitValue(($event.target as HTMLInputElement).checked ? 'true' : 'false')" />
      <span>{{ booleanValue ? booleanLabel(true) : booleanLabel(false) }}</span>
    </label>
    <select v-else-if="field.kind === 'select'" :value="stringValue" @change="emitValue(inputValue($event))">
      <option v-for="option in field.options || []" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
    </select>
    <template v-else-if="field.kind === 'combo'">
      <input :value="stringValue" type="text" :list="comboListId" @input="emitValue(inputValue($event))" />
      <datalist :id="comboListId">
        <option v-for="option in field.options || []" :key="String(option.value)" :value="String(option.value)">{{ option.label }}</option>
      </datalist>
    </template>
    <select v-else-if="field.kind === 'database' && databaseOptions.length" :value="stringValue" @change="emitValue(inputValue($event))">
      <option value="0">0</option>
      <option v-for="option in databaseOptions" :key="option.id" :value="String(option.id)">{{ option.id }} · {{ option.name }}</option>
    </select>
    <select v-else-if="field.kind === 'map' && catalog?.maps?.length" :value="stringValue" @change="emitValue(inputValue($event))">
      <option value="0">0</option>
      <option v-for="map in catalog.maps" :key="map.id" :value="String(map.id)">{{ map.id }} · {{ map.name }}</option>
    </select>
    <select v-else-if="field.kind === 'file' && fileOptions.length" :value="stringValue" @change="emitValue(inputValue($event))">
      <option value=""></option>
      <option v-for="option in fileOptions" :key="option" :value="option">{{ option }}</option>
    </select>
    <div v-else-if="field.kind === 'location'" class="location-input">
      <select :value="String(locationValue.mapId)" @change="setLocationPart('mapId', inputValue($event))">
        <option value="0">0</option>
        <option v-for="map in catalog?.maps || []" :key="map.id" :value="String(map.id)">{{ map.id }} · {{ map.name }}</option>
      </select>
      <input :value="String(locationValue.x)" type="number" min="0" aria-label="x" @input="setLocationPart('x', inputValue($event))" />
      <input :value="String(locationValue.y)" type="number" min="0" aria-label="y" @input="setLocationPart('y', inputValue($event))" />
      <button type="button" class="location-picker" @click="openLocationPicker">{{ t('coordinate.chooseMap') }}</button>
    </div>
    <div v-else-if="field.kind === 'struct'" class="compound-input">
      <label v-for="child in field.fields || []" :key="child.key" class="compound-field">
        <span>{{ child.label || child.key }}</span>
        <PluginParameterInput
          :field="child"
          :model-value="structValue[child.key]"
          :catalog="catalog"
          @update:model-value="setStructValue(child.key, $event)"
        />
      </label>
    </div>
    <div v-else-if="field.kind === 'array'" class="array-input">
      <div v-for="(item, index) in arrayValue" :key="index" class="array-item">
        <span class="array-index">{{ index + 1 }}</span>
        <PluginParameterInput
          v-if="field.item"
          :field="field.item"
          :model-value="item"
          :catalog="catalog"
          @update:model-value="setArrayValue(index, $event)"
        />
        <button type="button" :aria-label="t('cmdList.delete')" @click="removeArrayValue(index)">×</button>
      </div>
      <button type="button" class="array-add" @click="addArrayValue">{{ t('plugins.addItem') }}</button>
    </div>
    <input v-else :value="stringValue" type="text" @input="emitValue(inputValue($event))" />
    <small v-if="field.unsupportedReason" class="readonly-reason">{{ field.unsupportedReason }}</small>
    <CoordinatePickerDialog ref="coordinatePicker" :catalog="catalog || null" @commit="commitLocation" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import type { EditorProjectCatalog, PluginParameterSchemaField } from '../../api/client';
import { useI18n } from '../../i18n';
import CoordinatePickerDialog from './CoordinatePickerDialog.vue';

defineOptions({ name: 'PluginParameterInput' });
const props = defineProps<{
  field: PluginParameterSchemaField;
  modelValue: unknown;
  catalog?: EditorProjectCatalog | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { t } = useI18n();
const coordinatePicker = ref<InstanceType<typeof CoordinatePickerDialog> | null>(null);
const comboListId = `plugin-combo-${useId().replace(/[^a-z0-9_-]/gi, '-')}`;

const isReadonly = computed(() => props.field.editable === false);
const stringValue = computed(() => props.modelValue == null ? '' : String(props.modelValue));
const displayReadonlyValue = computed(() => typeof props.modelValue === 'string'
  ? props.modelValue
  : JSON.stringify(props.modelValue ?? '', null, 2));
const booleanValue = computed(() => props.modelValue === true || ['true', 'on', '1'].includes(String(props.modelValue).toLowerCase()));
const numberStep = computed(() => props.field.decimals == null ? '1' : String(10 ** -Math.max(0, props.field.decimals)));
const structValue = computed<Record<string, unknown>>(() => {
  const value = parseStructuredValue(props.modelValue);
  return isRecord(value) ? value : {};
});
const arrayValue = computed<unknown[]>(() => {
  const value = parseStructuredValue(props.modelValue);
  return Array.isArray(value) ? value : [];
});
const locationValue = computed<{ mapId: number; x: number; y: number }>(() => {
  const value = parseStructuredValue(props.modelValue);
  return isRecord(value)
    ? { mapId: Number(value.mapId) || 0, x: Number(value.x) || 0, y: Number(value.y) || 0 }
    : { mapId: 0, x: 0, y: 0 };
});
const databaseOptions = computed(() => {
  const keyByTable: Record<string, keyof EditorProjectCatalog> = {
    Actors: 'actors', Classes: 'classes', Skills: 'skills', Items: 'items', Weapons: 'weapons', Armors: 'armors',
    Enemies: 'enemies', Troops: 'troops', States: 'states', Animations: 'animations', Tilesets: 'tilesets',
    CommonEvents: 'commonEvents', 'System.switches': 'switches', 'System.variables': 'variables',
  };
  const key = keyByTable[props.field.databaseTable || ''];
  const values = key && props.catalog?.[key];
  return Array.isArray(values)
    ? values.filter((entry): entry is { id: number; name: string } => Boolean(entry && typeof entry === 'object' && 'id' in entry && 'name' in entry))
    : [];
});
const fileOptions = computed(() => {
  const normalized = String(props.field.directory || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '').toLowerCase();
  const keyByDirectory: Record<string, keyof EditorProjectCatalog['assets']> = {
    'img/animations': 'animations', 'img/battlebacks1': 'battlebacks1', 'img/battlebacks2': 'battlebacks2',
    'img/characters': 'characters', 'img/enemies': 'enemies', 'img/faces': 'faces', 'img/parallaxes': 'parallaxes',
    'img/pictures': 'pictures', 'img/sv_actors': 'svActors', 'img/sv_enemies': 'svEnemies', 'img/system': 'system',
    'img/tilesets': 'tilesets', 'img/titles1': 'titles1', 'img/titles2': 'titles2', 'audio/bgm': 'bgm',
    'audio/bgs': 'bgs', 'audio/me': 'me', 'audio/se': 'se', effects: 'effects', movies: 'movies',
  };
  const key = keyByDirectory[normalized];
  return key && props.catalog?.assets[key] ? props.catalog.assets[key].map((asset) => asset.name) : [];
});

function emitValue(value: unknown) { emit('update:modelValue', value); }
function inputValue(event: Event) { return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value; }
function booleanLabel(value: boolean) {
  const option = props.field.options?.find((entry) => String(entry.value) === String(value));
  return option?.label || String(value);
}
function setStructValue(key: string, value: unknown) { emitValue({ ...structValue.value, [key]: value }); }
function setArrayValue(index: number, value: unknown) {
  const next = [...arrayValue.value];
  next[index] = value;
  emitValue(next);
}
function removeArrayValue(index: number) { emitValue(arrayValue.value.filter((_, itemIndex) => itemIndex !== index)); }
function addArrayValue() { emitValue([...arrayValue.value, defaultValue(props.field.item)]); }
function setLocationPart(key: 'mapId' | 'x' | 'y', value: string) { emitValue({ ...locationValue.value, [key]: value }); }
function openLocationPicker() {
  coordinatePicker.value?.open({ mode: 'map', allowMapChange: true, ...locationValue.value });
}
function commitLocation(selection: { mapId: number; x: number; y: number }) { emitValue(selection); }
function defaultValue(field?: PluginParameterSchemaField): unknown {
  if (!field) return '';
  if (field.kind === 'struct') return Object.fromEntries((field.fields || []).map((child) => [child.key, defaultValue(child)]));
  if (field.kind === 'array') return [];
  if (field.kind === 'location') return { mapId: 0, x: 0, y: 0 };
  if (field.kind === 'boolean') return field.defaultValue ?? 'false';
  return field.defaultValue ?? '';
}
function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
</script>

<style scoped>
.plugin-param-input{min-width:0;display:grid;gap:5px}.plugin-param-input>input:not([type=checkbox]),.plugin-param-input>select,.plugin-param-input>textarea{width:100%;min-width:0;box-sizing:border-box}.boolean-input{display:flex;align-items:center;gap:6px}.location-input{display:grid;grid-template-columns:minmax(110px,1fr) 64px 64px;gap:5px}.location-picker{grid-column:1 / -1;padding:4px 7px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft);color:var(--app-ink);cursor:pointer}.location-picker:hover{border-color:var(--app-accent);background:var(--app-accent-soft)}.compound-input{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:7px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}.compound-field{min-width:0;display:grid;gap:3px}.compound-field>span{overflow:hidden;color:var(--app-ink-muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.array-input{display:grid;gap:6px}.array-item{display:grid;grid-template-columns:20px minmax(0,1fr) 24px;align-items:start;gap:5px;padding:5px;border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg-soft)}.array-index{padding-top:6px;color:var(--app-ink-muted);font:10px var(--app-font-mono)}.array-item>button,.array-add{border:1px solid var(--app-border);border-radius:var(--app-radius-sm);background:var(--app-bg);color:var(--app-ink-soft);cursor:pointer}.array-item>button{width:24px;height:24px}.array-add{justify-self:start;padding:4px 8px}.readonly textarea{opacity:.7;cursor:not-allowed}.readonly-reason{color:var(--app-warn);font-size:10px;line-height:1.35}
</style>
