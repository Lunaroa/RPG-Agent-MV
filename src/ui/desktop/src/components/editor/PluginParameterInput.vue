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
      :rows="field.kind === 'multiline' ? 4 : 3"
      resize="vertical"
      spellcheck="false"
      @update:model-value="emitTextValue"
    />
    <el-input-number
      v-else-if="field.kind === 'number'"
      :model-value="numberModelValue"
      :min="field.min"
      :max="field.max"
      :precision="numberPrecision"
      :step="numberStep"
      controls-position="right"
      class="parameter-number-input"
      @update:model-value="emitNumberValue"
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
      class="select-param-select"
      popper-class="plugin-parameter-select-popper"
      @change="emitSelectValue"
    >
      <template #label="{ label, value }">
        <span class="select-option-line">
          <span>{{ selectOptionLabel(value, label) }}</span>
          <el-tag size="small" effect="plain" class="parameter-key-tag">{{ value }}</el-tag>
        </span>
      </template>
      <el-option
        v-for="option in selectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      >
        <span class="select-option-line">
          <span>{{ option.label }}</span>
          <el-tag size="small" effect="plain" class="parameter-key-tag">{{ option.value }}</el-tag>
        </span>
      </el-option>
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
    <div
      v-else-if="field.kind === 'database' && systemNamedEntryKind"
      class="system-named-input"
    >
      <el-input
        :model-value="systemNamedEntryLabel"
        readonly
        :aria-label="field.label || field.key"
        @click="openSystemNamedEntrySelector"
      />
      <el-button
        :aria-label="t('systemNamedEntry.browse')"
        @click="openSystemNamedEntrySelector"
      >
        …
      </el-button>
    </div>
    <div
      v-else-if="field.kind === 'database' && isTilesetDatabase"
      class="file-param-input"
    >
      <el-input
        :model-value="tilesetDisplayValue"
        readonly
        :aria-label="field.label || field.key"
        @click="openTilesetPicker"
      />
      <el-button
        :aria-label="t('pluginTilesetPicker.browse')"
        @click="openTilesetPicker"
      >
        …
      </el-button>
    </div>
    <el-select
      v-else-if="field.kind === 'database'"
      :model-value="stringValue"
      filterable
      class="database-param-select"
      :class="{ 'is-media-select': databaseOptionHasMedia }"
      :popper-class="databaseOptionHasMedia
        ? 'plugin-parameter-select-popper plugin-parameter-media-popper'
        : 'plugin-parameter-select-popper'"
      @change="emitSelectValue"
    >
      <el-option
        v-for="option in databaseSelectOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      >
        <div v-if="databaseOptionHasMedia" class="database-media-option">
          <ActorWalkingFrameThumb
            v-if="isActorDatabase"
            :character-name="actorGraphicForOption(option.value)?.characterName"
            :character-index="actorGraphicForOption(option.value)?.characterIndex"
            :catalog="catalog"
            :size="48"
          />
          <IconSetThumb
            v-else-if="databaseOptionIconIndex(option.value) != null"
            :icon-index="databaseOptionIconIndex(option.value)!"
            :catalog="catalog"
            :size="28"
          />
          <img
            v-else-if="databaseOptionImageUrl(option.value)"
            :src="databaseOptionImageUrl(option.value)!"
            alt=""
            class="database-option-thumb"
            draggable="false"
          />
          <span>{{ option.label }}</span>
        </div>
        <span v-else>{{ option.label }}</span>
      </el-option>
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
    <div
      v-else-if="field.kind === 'file'"
      class="file-param-input"
    >
      <el-input
        :model-value="fileDisplayValue"
        readonly
        :aria-label="field.label || field.key"
        @click="openFilePicker"
      />
      <el-button
        :aria-label="t('pluginFilePicker.browse')"
        @click="openFilePicker"
      >
        …
      </el-button>
    </div>
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
    <small v-if="fileResolutionError" class="reference-warning" role="status">
      {{ fileResolutionError }}
    </small>
    <small v-if="field.unsupportedReason" class="readonly-reason">
      {{ unsupportedReason }}
    </small>
    <CoordinatePickerDialog
      ref="coordinatePicker"
      :catalog="catalog || null"
      @commit="commitLocation"
    />
    <SystemNamedEntrySelectorDialog
      ref="systemNamedEntrySelector"
      :catalog="catalog || null"
      @commit="commitSystemNamedEntry"
      @catalog-changed="emit('catalog-changed')"
    />
    <PluginParameterFilePickerDialog
      ref="filePicker"
      :title="field.label || field.key"
      :directory="fileResolution.ok ? fileResolution.directory : normalizePluginFileDirectory(field.directory)"
      :media="fileResolution.ok ? fileResolution.media : 'other'"
      :assets="filePickerAssets"
      :folders="filePickerFolders"
      @commit="commitFileSelection"
    />
    <PluginParameterTilesetPickerDialog
      ref="tilesetPicker"
      :title="field.label || field.key"
      :catalog="catalog"
      @commit="commitTilesetSelection"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type {
  EditorActorCatalogEntry,
  EditorIconCatalogEntry,
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../../api/client';
import { projectAssets } from '../../api/client';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';
import {
  displaySystemNamedEntryName,
  formatSystemNamedEntryId,
} from '../../utils/systemNamedEntryRanges';
import {
  normalizePluginFileDirectory,
  resolvePluginParameterFileAssets,
  type PluginFileAssetResolution,
} from '../../utils/pluginParameterFileAssets';
import { resolvePluginParameterValueDecor } from '../../utils/pluginParameterValueDecor';
import {
  formatPluginTilesetDisplayLabel,
} from '../../utils/pluginParameterTilesetPicker';
import ActorWalkingFrameThumb from './ActorWalkingFrameThumb.vue';
import IconSetThumb from './IconSetThumb.vue';
import CoordinatePickerDialog from './CoordinatePickerDialog.vue';
import PluginParameterFilePickerDialog from './PluginParameterFilePickerDialog.vue';
import PluginParameterTilesetPickerDialog from './PluginParameterTilesetPickerDialog.vue';
import SystemNamedEntrySelectorDialog from './SystemNamedEntrySelectorDialog.vue';
import type { SystemNamedEntryKind } from './SystemNamedEntrySelectorDialog.vue';

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
const emit = defineEmits<{
  'update:modelValue': [value: unknown];
  'catalog-changed': [];
}>();
const { t } = useI18n();
const projectStore = useProjectStore();
const coordinatePicker = ref<InstanceType<typeof CoordinatePickerDialog> | null>(null);
const systemNamedEntrySelector = ref<InstanceType<typeof SystemNamedEntrySelectorDialog> | null>(null);
const filePicker = ref<InstanceType<typeof PluginParameterFilePickerDialog> | null>(null);
const tilesetPicker = ref<InstanceType<typeof PluginParameterTilesetPickerDialog> | null>(null);
const fileResolution = ref<PluginFileAssetResolution>({
  ok: false,
  reason: 'missing-directory',
  directory: '',
});
let fileResolutionSerial = 0;

const isReadonly = computed(() => props.field.editable === false);
const stringValue = computed(() => props.modelValue == null ? '' : String(props.modelValue));
const numberModelValue = computed<number | undefined>(() => {
  const text = String(props.modelValue ?? '').trim();
  if (!text) return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
});
const numberPrecision = computed<number | undefined>(() =>
  typeof props.field.decimals === 'number' ? props.field.decimals : undefined,
);
const numberStep = computed(() => {
  if (typeof props.field.decimals === 'number') {
    return props.field.decimals <= 0 ? 1 : 10 ** -props.field.decimals;
  }
  return 1;
});
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
const isActorDatabase = computed(() => props.field.databaseTable === 'Actors');
const isTilesetDatabase = computed(() => props.field.databaseTable === 'Tilesets');
const databaseOptionHasMedia = computed(() => {
  const table = props.field.databaseTable || '';
  return table === 'Actors'
    || table === 'Skills'
    || table === 'Items'
    || table === 'Weapons'
    || table === 'Armors'
    || table === 'States'
    || table === 'Enemies'
    || table === 'Animations';
});
const tilesetDisplayValue = computed(() =>
  formatPluginTilesetDisplayLabel(props.catalog, stringValue.value, t('pluginTilesetPicker.none')),
);
const actorOptionsById = computed(() => {
  const map = new Map<number, EditorActorCatalogEntry>();
  if (!isActorDatabase.value) return map;
  for (const entry of props.catalog?.actors || []) {
    map.set(entry.id, entry);
  }
  return map;
});
const iconOptionsById = computed(() => {
  const map = new Map<number, number>();
  const table = props.field.databaseTable || '';
  const list =
    table === 'Skills' ? props.catalog?.skills
      : table === 'Items' ? props.catalog?.items
        : table === 'Weapons' ? props.catalog?.weapons
          : table === 'Armors' ? props.catalog?.armors
            : table === 'States' ? props.catalog?.states
              : null;
  if (!list) return map;
  for (const entry of list as EditorIconCatalogEntry[]) {
    const iconIndex = Math.floor(Number(entry.iconIndex));
    if (Number.isFinite(iconIndex) && iconIndex > 0) map.set(entry.id, iconIndex);
  }
  return map;
});

function databaseOptionIconIndex(value: string): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return iconOptionsById.value.get(id) ?? null;
}

function databaseOptionImageUrl(value: string): string | null {
  if (isActorDatabase.value || databaseOptionIconIndex(value) != null) return null;
  const field = props.field;
  if (field.kind !== 'database') return null;
  const decor = resolvePluginParameterValueDecor(field, Number(value), props.catalog);
  return decor.media?.kind === 'image' ? decor.media.url : null;
}
const systemNamedEntryKind = computed<SystemNamedEntryKind | null>(() => {
  if (props.field.databaseTable === 'System.switches') return 'switch';
  if (props.field.databaseTable === 'System.variables') return 'variable';
  return null;
});
const systemNamedEntryLabel = computed(() => {
  const id = Number(stringValue.value);
  if (!Number.isInteger(id) || id <= 0) return t('systemNamedEntry.none');
  const entry = databaseOptions.value.find((item) => item.id === id);
  const name = displaySystemNamedEntryName(id, entry?.name || '');
  return name
    ? `${formatSystemNamedEntryId(id)} · ${name}`
    : formatSystemNamedEntryId(id);
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

function actorGraphicForOption(value: string): EditorActorCatalogEntry | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return actorOptionsById.value.get(id) || null;
}
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

watch(
  () => [
    props.field.kind,
    props.field.directory,
    props.catalog,
    projectStore.currentProject,
  ] as const,
  () => {
    void refreshFileResolution();
  },
  { immediate: true },
);

async function refreshFileResolution(): Promise<void> {
  const serial = ++fileResolutionSerial;
  if (props.field.kind !== 'file') {
    fileResolution.value = { ok: false, reason: 'missing-directory', directory: '' };
    return;
  }
  const project = projectStore.currentProject;
  const resolved = await resolvePluginParameterFileAssets(
    props.catalog,
    props.field.directory,
    (relativeDirectory, { recursive }) => {
      if (!project) {
        return Promise.reject(new Error('missing-project'));
      }
      return projectAssets.listRelativeDirectory(relativeDirectory, project, recursive);
    },
  );
  if (serial !== fileResolutionSerial) return;
  fileResolution.value = resolved;
}

const filePickerAssets = computed(() => {
  if (!fileResolution.value.ok) return [];
  const assets = fileResolution.value.assets;
  const current = stringValue.value.trim();
  if (!current || assets.some((asset) => asset.name === current)) return assets;
  return [{ name: current, fileName: current, url: '' }, ...assets];
});
const filePickerFolders = computed(() =>
  fileResolution.value.ok ? fileResolution.value.folders : [],
);
const fileDisplayValue = computed(() =>
  stringValue.value || t('pluginFilePicker.none'),
);
const fileResolutionError = computed(() => {
  if (props.field.kind !== 'file' || isReadonly.value) return '';
  if (fileResolution.value.ok) return '';
  if (fileResolution.value.reason === 'missing-directory') {
    return t('pluginFilePicker.missingDirectory');
  }
  if (fileResolution.value.reason === 'missing-catalog') {
    return t('pluginFilePicker.missingCatalog');
  }
  if (fileResolution.value.reason === 'invalid-directory') {
    return t('pluginFilePicker.invalidDirectory', {
      directory: fileResolution.value.directory,
    });
  }
  return t('pluginFilePicker.directoryNotFound', {
    directory: fileResolution.value.directory,
  });
});
const referenceWarning = computed(() => {
  const current = stringValue.value;
  if (props.field.kind === 'database' && isMissingCurrent(databaseSelectOptions.value, current)) {
    return t('plugins.parameterReferenceMissing', { value: current });
  }
  if (props.field.kind === 'map' && isMissingCurrent(mapSelectOptions.value, current)) {
    return t('plugins.parameterMapMissing', { value: current });
  }
  if (
    props.field.kind === 'file'
    && fileResolution.value.ok
    && current
    && !fileResolution.value.assets.some((asset) => asset.name === current)
  ) {
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

function emitNumberValue(value: number | undefined | null): void {
  if (value === undefined || value === null || Number.isNaN(value)) {
    emitValue('');
    return;
  }
  emitValue(String(value));
}

function emitSelectValue(value: unknown): void {
  emitValue(value == null ? '' : String(value));
}

function selectOptionLabel(value: unknown, fallbackLabel: unknown): string {
  const match = selectOptions.value.find((option) => option.value === String(value ?? ''));
  return match?.label || String(fallbackLabel ?? value ?? '');
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

async function openFilePicker(): Promise<void> {
  if (isReadonly.value) return;
  await refreshFileResolution();
  if (!fileResolution.value.ok) {
    ElMessage.error(fileResolutionError.value || t('pluginFilePicker.missingDirectory'));
    return;
  }
  filePicker.value?.open(stringValue.value);
}

function commitFileSelection(value: string): void {
  emitValue(value);
}

function openTilesetPicker(): void {
  if (isReadonly.value) return;
  tilesetPicker.value?.open(stringValue.value);
}

function commitTilesetSelection(id: number): void {
  emitValue(String(id));
}

function openSystemNamedEntrySelector(): void {
  const kind = systemNamedEntryKind.value;
  if (!kind) return;
  systemNamedEntrySelector.value?.open({
    kind,
    selectedId: Number(stringValue.value) || 0,
    allowNone: true,
  });
}

function commitSystemNamedEntry(selection: { kind: SystemNamedEntryKind; id: number }): void {
  emitValue(String(selection.id));
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
.plugin-param-input :deep(.el-input),
.plugin-param-input :deep(.el-input-number),
.plugin-param-input :deep(.parameter-number-input) {
  width: 100%;
}
.select-option-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.select-option-line > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-key-tag {
  flex: 0 0 auto;
  font-weight: 400;
  color: var(--console-accent, #be5630);
  background: color-mix(in srgb, var(--console-accent, #be5630) 10%, transparent);
  border-color: color-mix(in srgb, var(--console-accent, #be5630) 32%, transparent);
  animation: none;
  transition: none;
}
.parameter-key-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
  color: var(--console-accent, #be5630);
}
.select-param-select :deep(.el-select__selected-item) {
  font-weight: 400;
}
.location-input {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 78px 78px;
  gap: 8px;
}
.system-named-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 8px;
  align-items: center;
}
.system-named-input :deep(.el-input) {
  cursor: pointer;
}
.system-named-input :deep(.el-input__wrapper) {
  cursor: pointer;
}
.file-param-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  gap: 8px;
  align-items: center;
}
.file-param-input :deep(.el-input) {
  cursor: pointer;
}
.file-param-input :deep(.el-input__wrapper) {
  cursor: pointer;
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
.actor-option,
.database-media-option {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.actor-option > span,
.database-media-option > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.database-option-thumb {
  flex: 0 0 auto;
  width: auto;
  height: 28px;
  max-width: 48px;
  object-fit: contain;
  border-radius: 4px;
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 70%, transparent);
}
</style>

<style>
.plugin-parameter-actor-popper .el-select-dropdown__item,
.plugin-parameter-media-popper .el-select-dropdown__item {
  height: auto;
  min-height: 56px;
  padding-top: 4px;
  padding-bottom: 4px;
  line-height: 1.3;
}
.plugin-parameter-media-popper .el-select-dropdown__item {
  min-height: 40px;
}
.plugin-parameter-select-popper .el-select-dropdown__item.is-selected {
  font-weight: 400;
  color: var(--console-accent, #be5630);
}
.plugin-parameter-select-popper .parameter-key-tag {
  flex: 0 0 auto;
  font-weight: 400;
  color: var(--console-accent, #be5630);
  background: color-mix(in srgb, var(--console-accent, #be5630) 10%, transparent);
  border-color: color-mix(in srgb, var(--console-accent, #be5630) 32%, transparent);
}
.plugin-parameter-select-popper .parameter-key-tag .el-tag__content {
  font-weight: 400;
  color: var(--console-accent, #be5630);
}
.plugin-parameter-select-popper .select-option-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
