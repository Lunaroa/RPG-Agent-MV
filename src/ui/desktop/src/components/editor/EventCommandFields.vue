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
    <p v-if="!visibleFields.length" class="no-fields">{{ t('cmdFields.noParams') }}</p>
    <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="loadImage" @commit="commitImageField" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EditorProjectCatalog, NamedCatalogEntry, ProjectAssetEntry } from '../../api/client';
import { useI18n } from '../../i18n';
import { commandDefinition, type CommandAssetKey, type CommandField, type CommandFieldVisibility } from '../../composables/eventCommandCatalog';
import { localizeCommandField } from '../../utils/eventCommandLocalization';
import type { MvCommand } from '../../composables/useEventEditor';
import ImageAssetPickerDialog from './ImageAssetPickerDialog.vue';

const props = defineProps<{ command: MvCommand; catalog: EditorProjectCatalog | null; loadImage: (url: string) => Promise<HTMLImageElement | null> }>();
const emit = defineEmits<{ change: [] }>();
const { language, t } = useI18n();
const definition = computed(() => commandDefinition(props.command.code));
const visibleFields = computed(() => (definition.value?.fields || [])
  .filter((field) => isFieldVisible(field) && !isPairedImageIndexField(field))
  .map((field) => localizeCommandField(field, language.value)));
const imagePicker = ref<InstanceType<typeof ImageAssetPickerDialog> | null>(null);
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
function imagePickerMode(field: CommandField): 'plain' | 'face' | 'character' {
  if (field.asset === 'faces') return 'face';
  if (field.asset === 'characters' && pairedImageIndexPath(field)) return 'character';
  return 'plain';
}
function pairedImageIndexPath(field: CommandField): CommandField['path'] | null {
  if (props.command.code === 322 && samePath(field.path, [1])) return [2];
  if (props.command.code === 322 && samePath(field.path, [3])) return [4];
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
.command-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
label { min-width: 0; display: grid; gap: 4px; color: var(--app-ink-soft); font-size: 12px; }
input:not([type="checkbox"]), select, textarea { min-width: 0; padding: 5px 6px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font-size: 13px; }
.asset-picker-button { min-width: 0; min-height: 30px; overflow: hidden; padding: 5px 8px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font-size: 13px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.asset-picker-button:hover { border-color: var(--app-accent); background: var(--app-accent-soft); }
textarea { grid-column: 1 / -1; font-family: var(--app-font-mono); resize: vertical; }
label:has(textarea) { grid-column: 1 / -1; }
input[type="checkbox"] { justify-self: start; }
.no-fields { grid-column: 1 / -1; margin: 0; color: var(--app-ink-muted); font-size: 12px; }
</style>
