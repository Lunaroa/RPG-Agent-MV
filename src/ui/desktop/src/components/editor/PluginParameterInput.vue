<template>
  <div class="plugin-param-input" :class="{ readonly: isReadonly }">
    <el-input
      v-if="isReadonly"
      :model-value="displayReadonlyValue"
      type="textarea"
      :rows="2"
      readonly
      resize="vertical"
      spellcheck="false"
    />
    <el-input
      v-else-if="field.kind === 'multiline' || field.kind === 'json'"
      :model-value="stringValue"
      type="textarea"
      :rows="field.kind === 'multiline' ? 7 : 4"
      resize="vertical"
      spellcheck="false"
      @update:model-value="emitTextValue"
    />
    <el-input
      v-else-if="field.kind === 'number'"
      :model-value="stringValue"
      inputmode="decimal"
      spellcheck="false"
      @update:model-value="emitTextValue"
    />
    <el-switch
      v-else-if="field.kind === 'boolean'"
      :model-value="booleanValue"
      :active-text="booleanLabel(true)"
      :inactive-text="booleanLabel(false)"
      @change="emitValue(Boolean($event) ? 'true' : 'false')"
    />
    <el-select
      v-else-if="field.kind === 'select'"
      :model-value="stringValue"
      @change="emitSelectValue"
    >
      <el-option
        v-for="option in selectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <el-select
      v-else-if="field.kind === 'combo'"
      :model-value="stringValue"
      filterable
      allow-create
      default-first-option
      @change="emitSelectValue"
    >
      <el-option
        v-for="option in selectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <el-select
      v-else-if="field.kind === 'database'"
      :model-value="stringValue"
      filterable
      @change="emitSelectValue"
    >
      <el-option
        v-for="option in databaseSelectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <el-select
      v-else-if="field.kind === 'map'"
      :model-value="stringValue"
      filterable
      @change="emitSelectValue"
    >
      <el-option
        v-for="option in mapSelectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <el-select
      v-else-if="field.kind === 'file'"
      :model-value="stringValue"
      filterable
      clearable
      @change="emitSelectValue"
    >
      <el-option
        v-for="option in fileSelectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <div v-else-if="field.kind === 'location'" class="location-input">
      <el-select
        :model-value="String(locationValue.mapId)"
        filterable
        :aria-label="t('plugins.parameterLocationMap')"
        @change="setLocationPart('mapId', String($event))"
      >
        <el-option
          v-for="option in locationMapOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-input
        :model-value="String(locationValue.x)"
        inputmode="numeric"
        aria-label="X"
        @update:model-value="setLocationPart('x', String($event))"
      />
      <el-input
        :model-value="String(locationValue.y)"
        inputmode="numeric"
        aria-label="Y"
        @update:model-value="setLocationPart('y', String($event))"
      />
      <el-button class="location-picker" @click="openLocationPicker">
        {{ t('coordinate.chooseMap') }}
      </el-button>
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
        <el-button
          :aria-label="t('cmdList.delete')"
          @click="removeArrayValue(index)"
        >
          ×
        </el-button>
      </div>
      <el-button class="array-add" @click="addArrayValue">
        {{ t('plugins.addItem') }}
      </el-button>
    </div>
    <el-input
      v-else
      :model-value="stringValue"
      @update:model-value="emitTextValue"
    />

    <small v-if="referenceWarning" class="reference-warning" role="status">
      {{ referenceWarning }}
    </small>
    <small v-if="field.unsupportedReason" class="readonly-reason">
      {{ unsupportedReason }}
    </small>
    <CoordinatePickerDialog
      ref="coordinatePicker"
      :catalog="catalog || null"
      @commit="commitLocation"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorProjectCatalog, PluginParameterSchemaField } from '../../api/client';
import { useI18n } from '../../i18n';
import CoordinatePickerDialog from './CoordinatePickerDialog.vue';

interface SelectOption {
  value: string;
  label: string;
}

defineOptions({ name: 'PluginParameterInput' });
const props = defineProps<{
  field: PluginParameterSchemaField;
  modelValue: unknown;
  catalog?: EditorProjectCatalog | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { t } = useI18n();
const coordinatePicker = ref<InstanceType<typeof CoordinatePickerDialog> | null>(null);

const isReadonly = computed(() => props.field.editable === false);
const stringValue = computed(() => props.modelValue == null ? '' : String(props.modelValue));
const displayReadonlyValue = computed(() => typeof props.modelValue === 'string'
  ? props.modelValue
  : JSON.stringify(props.modelValue ?? '', null, 2));
const booleanValue = computed(() => isBooleanEnabled(props.modelValue));
const structValue = computed<Record<string, unknown>>(() => {
  const value = parseStructuredValue(props.modelValue);
  return isRecord(value) ? value : {};
});
const arrayValue = computed<unknown[]>(() => {
  const value = parseStructuredValue(props.modelValue);
  return Array.isArray(value) ? value : [];
});
const locationValue = computed<{ mapId: number | string; x: number | string; y: number | string }>(() => {
  const value = parseStructuredValue(props.modelValue);
  return isRecord(value)
    ? {
        mapId: scalarValue(value.mapId, 0),
        x: scalarValue(value.x, 0),
        y: scalarValue(value.y, 0),
      }
    : { mapId: 0, x: 0, y: 0 };
});
const selectOptions = computed<SelectOption[]>(() =>
  (props.field.options || []).map((option) => ({
    value: String(option.value),
    label: option.label,
  })),
);
const databaseOptions = computed(() => {
  const keyByTable: Record<string, keyof EditorProjectCatalog> = {
    Actors: 'actors',
    Classes: 'classes',
    Skills: 'skills',
    Items: 'items',
    Weapons: 'weapons',
    Armors: 'armors',
    Enemies: 'enemies',
    Troops: 'troops',
    States: 'states',
    Animations: 'animations',
    Tilesets: 'tilesets',
    CommonEvents: 'commonEvents',
    'System.switches': 'switches',
    'System.variables': 'variables',
  };
  const key = keyByTable[props.field.databaseTable || ''];
  const values = key && props.catalog?.[key];
  return Array.isArray(values)
    ? values.filter((entry): entry is { id: number; name: string } =>
        Boolean(entry && typeof entry === 'object' && 'id' in entry && 'name' in entry))
    : [];
});
const databaseSelectOptions = computed<SelectOption[]>(() =>
  withMissingCurrent(
    [
      { value: '0', label: '0' },
      ...databaseOptions.value.map((entry) => ({
        value: String(entry.id),
        label: `${entry.id} · ${entry.name}`,
      })),
    ],
    stringValue.value,
  ),
);
const mapSelectOptions = computed<SelectOption[]>(() =>
  withMissingCurrent(
    [
      { value: '0', label: '0' },
      ...(props.catalog?.maps || []).map((map) => ({
        value: String(map.id),
        label: `${map.id} · ${map.name}`,
      })),
    ],
    stringValue.value,
  ),
);
const locationMapOptions = computed<SelectOption[]>(() =>
  withMissingCurrent(
    [
      { value: '0', label: '0' },
      ...(props.catalog?.maps || []).map((map) => ({
        value: String(map.id),
        label: `${map.id} · ${map.name}`,
      })),
    ],
    String(locationValue.value.mapId),
  ),
);
const fileOptions = computed(() => {
  const normalized = normalizeDirectory(props.field.directory);
  const keyByDirectory: Record<string, keyof EditorProjectCatalog['assets']> = {
    'img/animations': 'animations',
    'img/battlebacks1': 'battlebacks1',
    'img/battlebacks2': 'battlebacks2',
    'img/characters': 'characters',
    'img/enemies': 'enemies',
    'img/faces': 'faces',
    'img/parallaxes': 'parallaxes',
    'img/pictures': 'pictures',
    'img/sv_actors': 'svActors',
    'img/sv_enemies': 'svEnemies',
    'img/system': 'system',
    'img/tilesets': 'tilesets',
    'img/titles1': 'titles1',
    'img/titles2': 'titles2',
    'audio/bgm': 'bgm',
    'audio/bgs': 'bgs',
    'audio/me': 'me',
    'audio/se': 'se',
    effects: 'effects',
    movies: 'movies',
  };
  const key = keyByDirectory[normalized];
  const entries = key && props.catalog?.assets[key] ? props.catalog.assets[key] : [];
  return [...new Set(entries.map((asset) => stripExtension(asset.name || asset.fileName)))];
});
const fileSelectOptions = computed<SelectOption[]>(() =>
  withMissingCurrent(
    [
      { value: '', label: t('plugins.parameterEmptyValue') },
      ...fileOptions.value.map((value) => ({ value, label: value })),
    ],
    stringValue.value,
  ),
);
const referenceWarning = computed(() => {
  const current = stringValue.value;
  if (props.field.kind === 'database' && isMissingCurrent(databaseSelectOptions.value, current)) {
    return t('plugins.parameterReferenceMissing', { value: current });
  }
  if (props.field.kind === 'map' && isMissingCurrent(mapSelectOptions.value, current)) {
    return t('plugins.parameterMapMissing', { value: current });
  }
  if (props.field.kind === 'file' && isMissingCurrent(fileSelectOptions.value, current)) {
    return t('plugins.parameterFileMissing', { value: current });
  }
  if (
    props.field.kind === 'location'
    && isMissingCurrent(locationMapOptions.value, String(locationValue.value.mapId))
  ) {
    return t('plugins.parameterMapMissing', { value: locationValue.value.mapId });
  }
  return '';
});
const unsupportedReason = computed(() =>
  String(props.field.rawType || '').trim().toLowerCase() === 'image'
    ? t('plugins.parameterImageTypeUnsupported')
    : props.field.unsupportedReason,
);

function emitValue(value: unknown): void {
  emit('update:modelValue', value);
}

function emitTextValue(value: string): void {
  emitValue(value);
}

function emitSelectValue(value: unknown): void {
  emitValue(value == null ? '' : String(value));
}

function booleanLabel(value: boolean): string {
  const option = props.field.options?.find((entry) =>
    isBooleanEnabled(entry.value) === value);
  return option?.label || (value
    ? t('plugins.parameterEnabled')
    : t('plugins.parameterDisabled'));
}

function setStructValue(key: string, value: unknown): void {
  emitValue({ ...structValue.value, [key]: value });
}

function setArrayValue(index: number, value: unknown): void {
  const next = [...arrayValue.value];
  next[index] = value;
  emitValue(next);
}

function removeArrayValue(index: number): void {
  emitValue(arrayValue.value.filter((_, itemIndex) => itemIndex !== index));
}

function addArrayValue(): void {
  emitValue([...arrayValue.value, defaultValue(props.field.item)]);
}

function setLocationPart(key: 'mapId' | 'x' | 'y', value: string): void {
  emitValue({ ...locationValue.value, [key]: value });
}

function openLocationPicker(): void {
  coordinatePicker.value?.open({
    mode: 'map',
    allowMapChange: true,
    mapId: Number(locationValue.value.mapId) || 0,
    x: Number(locationValue.value.x) || 0,
    y: Number(locationValue.value.y) || 0,
  });
}

function commitLocation(selection: { mapId: number; x: number; y: number }): void {
  emitValue(selection);
}

function defaultValue(field?: PluginParameterSchemaField): unknown {
  if (!field) return '';
  if (field.kind === 'struct') {
    return Object.fromEntries((field.fields || []).map((child) => [
      child.key,
      defaultValue(child),
    ]));
  }
  if (field.kind === 'array') return [];
  if (field.kind === 'location') return { mapId: 0, x: 0, y: 0 };
  if (field.kind === 'boolean') return field.defaultValue ?? 'false';
  return field.defaultValue ?? '';
}

function withMissingCurrent(options: SelectOption[], current: string): SelectOption[] {
  if (!current || options.some((option) => option.value === current)) return options;
  return [
    {
      value: current,
      label: t('plugins.parameterMissingCurrentValue', { value: current }),
    },
    ...options,
  ];
}

function isMissingCurrent(options: SelectOption[], current: string): boolean {
  if (!current || current === '0') return false;
  return options[0]?.value === current
    && options[0]?.label === t('plugins.parameterMissingCurrentValue', { value: current });
}

function normalizeDirectory(value: unknown): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function stripExtension(value: string): string {
  return String(value || '').replace(/\.[^.\\/]+$/, '');
}

function scalarValue(value: unknown, fallback: number): string | number {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function isBooleanEnabled(value: unknown): boolean {
  return value === true || ['true', 'on', '1'].includes(String(value).toLowerCase());
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
</script>

<style scoped>
.plugin-param-input {
  min-width: 0;
  display: grid;
  gap: 7px;
}
.plugin-param-input :deep(.el-select),
.plugin-param-input :deep(.el-input) {
  width: 100%;
}
.location-input {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 78px 78px;
  gap: 8px;
}
.location-picker {
  grid-column: 1 / -1;
  justify-self: start;
}
.compound-input {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-soft);
}
.compound-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.compound-field > span {
  overflow: hidden;
  color: var(--app-ink-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.array-input {
  display: grid;
  gap: 7px;
}
.array-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 32px;
  align-items: start;
  gap: 7px;
  padding: 7px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-soft);
}
.array-index {
  padding-top: 7px;
  color: var(--app-ink-muted);
  font: 11px var(--app-font-mono);
}
.array-add {
  justify-self: start;
}
.readonly :deep(textarea) {
  cursor: text;
}
.reference-warning,
.readonly-reason {
  font-size: 11px;
  line-height: 1.45;
}
.reference-warning {
  color: var(--console-warning, #8a560f);
}
.readonly-reason {
  color: var(--app-warn);
}
</style>
