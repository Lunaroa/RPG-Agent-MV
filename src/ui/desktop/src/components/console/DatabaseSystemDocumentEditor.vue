<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  EditorProjectCatalog,
  ProjectAssetEntry,
} from '../../api/client';
import type { RmmvDatabaseEntrySchema, RmmvDatabaseFieldSchema } from '@contract/types';
import { useI18n } from '../../i18n';
import {
  MENU_COMMAND_LABELS,
  SOUND_LABELS,
  databaseFieldLabel,
  localizeDatabaseLabel,
} from '../../utils/rmmvDatabaseLocalization';
import { cloneDraft } from '../../utils/clone-draft';
import { systemDocumentPageForField, SYSTEM_FIELDS_EDITED_ELSEWHERE } from '../../utils/databaseDocumentPages';
import ImageAssetPickerDialog from '../editor/ImageAssetPickerDialog.vue';
import ActorWalkingFrameThumb from '../editor/ActorWalkingFrameThumb.vue';
import StructuredFieldsEditor from './StructuredFieldsEditor.vue';

type DbRecord = Record<string, unknown>;
type SystemPage = 'System1' | 'System2';
type ImageAssetKind = keyof EditorProjectCatalog['assets'];
type ImagePickerMode = 'plain' | 'character';
type ImageSelection = { name: string; index: number };

const props = defineProps<{
  modelValue: unknown;
  page: SystemPage;
  catalog: EditorProjectCatalog | null;
  schema?: RmmvDatabaseEntrySchema;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();
const { language, t } = useI18n();

const imagePicker = ref<InstanceType<typeof ImageAssetPickerDialog> | null>(null);
let pendingImageCommit: ((selection: ImageSelection) => void) | null = null;

const record = computed<DbRecord>(() => (
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? props.modelValue as DbRecord
    : {}
));

const schemaPaths = computed(() => new Set((props.schema?.coreFields || []).map((field) => field.path)));

function hasField(path: string): boolean {
  if (schemaPaths.value.has(path)) return true;
  const prefix = `${path}.`;
  return [...schemaPaths.value].some((candidate) => candidate.startsWith(prefix));
}

function readPath(path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as DbRecord)[key]
      : undefined
  ), record.value);
}

function writePath(path: string, value: unknown): void {
  const keys = path.split('.');
  const next = cloneDraft(record.value);
  let target = next;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const child = target[key];
    target[key] = child && typeof child === 'object' && !Array.isArray(child)
      ? { ...(child as DbRecord) }
      : {};
    target = target[key] as DbRecord;
  }
  target[keys[keys.length - 1]] = value;
  emit('update:modelValue', next);
}

function objectValue(path: string): DbRecord {
  const value = readPath(path);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DbRecord : {};
}

function arrayValue(path: string): unknown[] {
  const value = readPath(path);
  return Array.isArray(value) ? value : [];
}

function numberValue(path: string, fallback = 0): number {
  const value = Number(readPath(path));
  return Number.isFinite(value) ? value : fallback;
}

function textValue(path: string): string {
  return String(readPath(path) ?? '');
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : cloneDraft(value);
}

function updateRecord(path: string, key: string, value: unknown): void {
  writePath(path, { ...objectValue(path), [key]: value });
}

function updateNestedRecord(path: string, child: string, key: string, value: unknown): void {
  const current = objectValue(path);
  const nested = current[child] && typeof current[child] === 'object' && !Array.isArray(current[child])
    ? current[child] as DbRecord
    : {};
  writePath(path, { ...current, [child]: { ...nested, [key]: value } });
}

function safeLoadImage(url: string): Promise<HTMLImageElement | null> {
  return props.loadImage ? props.loadImage(url) : Promise.resolve(null);
}

function openImagePicker(
  options: { asset: ImageAssetKind; mode?: ImagePickerMode; title: string; name: string; index?: number },
  commit: (selection: ImageSelection) => void,
): void {
  pendingImageCommit = commit;
  imagePicker.value?.open(options);
}

function commitImageSelection(selection: ImageSelection): void {
  pendingImageCommit?.(selection);
  pendingImageCommit = null;
}

function openSimpleImage(path: string, asset: ImageAssetKind): void {
  openImagePicker({
    asset,
    mode: 'plain',
    title: t('db.chooseField', { label: databaseFieldLabel(path, language.value) }),
    name: textValue(path),
  }, (selection) => writePath(path, selection.name));
}

function titleImageUrl(path: string, kind: 'titles1' | 'titles2'): string | null {
  const name = textValue(path);
  if (!name) return null;
  const asset = (props.catalog?.assets[kind] || []).find((entry) => entry.name === name);
  return asset?.url || null;
}

function openVehicleImage(path: 'boat' | 'ship' | 'airship'): void {
  const current = objectValue(path);
  openImagePicker({
    asset: 'characters',
    mode: 'character',
    title: t('db.document.system.vehicleImageTitle', { vehicle: vehicleLabel(path) }),
    name: String(current.characterName || ''),
    index: Number(current.characterIndex || 0),
  }, (selection) => {
    writePath(path, {
      ...current,
      characterName: selection.name,
      characterIndex: selection.name ? selection.index : 0,
    });
  });
}

function audioOptions(kind: 'bgm' | 'me' | 'se'): Array<{ value: string; label: string }> {
  const assets = props.catalog?.assets[kind] || [];
  return [
    { value: '', label: t('imgPicker.none') },
    ...assets.map((asset: ProjectAssetEntry) => ({ value: asset.name, label: asset.name })),
  ];
}

const vehicles = ['boat', 'ship', 'airship'] as const;

function vehicleLabel(path: typeof vehicles[number]): string {
  if (path === 'boat') return t('db.document.system.vehicle.boat');
  if (path === 'ship') return t('db.document.system.vehicle.ship');
  return t('db.document.system.vehicle.airship');
}

function vehicleObject(path: typeof vehicles[number]): DbRecord {
  return objectValue(path);
}

function mapOptions(): Array<{ value: number; label: string }> {
  return [
    { value: 0, label: t('imgPicker.none') },
    ...(props.catalog?.maps || []).map((entry) => ({ value: entry.id, label: `${String(entry.id).padStart(3, '0')} ${entry.name}` })),
  ];
}

function actorOptions(): Array<{ value: number; label: string }> {
  return (props.catalog?.actors || []).map((entry) => ({ value: entry.id, label: `${String(entry.id).padStart(4, '0')} ${entry.name}` }));
}

function updatePartyMember(index: number, actorId: number): void {
  const next = arrayValue('partyMembers').map((entry) => Number(entry || 0));
  next[index] = actorId;
  writePath('partyMembers', next);
}

function addPartyMember(): void {
  const first = actorOptions()[0]?.value;
  if (!first) return;
  writePath('partyMembers', [...arrayValue('partyMembers'), first]);
}

function removePartyMember(index: number): void {
  writePath('partyMembers', arrayValue('partyMembers').filter((_entry, itemIndex) => itemIndex !== index));
}

const optionPaths = computed(() => [
  'optTransparent',
  'optFollowers',
  'optSlipDeath',
  'optFloorDeath',
  'optDisplayTp',
  'optExtraExp',
  'optAutosave',
  'optKeyItemsNumber',
  'optSplashScreen',
  'optMessageSkip',
].filter(hasField));

const audioRows = computed(() => {
  const rows: Array<{ key: string; label: string; kind: 'bgm' | 'me'; object: DbRecord; vehicle?: typeof vehicles[number] }> = [];
  const direct = [
    ['titleBgm', 'bgm'],
    ['battleBgm', 'bgm'],
    ['victoryMe', 'me'],
    ['defeatMe', 'me'],
    ['gameoverMe', 'me'],
  ] as const;
  for (const [path, kind] of direct) {
    if (hasField(path)) rows.push({ key: path, label: databaseFieldLabel(path, language.value), kind, object: objectValue(path) });
  }
  for (const vehicle of vehicles) {
    if (!hasField(vehicle)) continue;
    const bgm = vehicleObject(vehicle).bgm;
    rows.push({
      key: `${vehicle}.bgm`,
      label: vehicleLabel(vehicle),
      kind: 'bgm',
      object: bgm && typeof bgm === 'object' && !Array.isArray(bgm) ? bgm as DbRecord : {},
      vehicle,
    });
  }
  return rows;
});

function updateAudio(row: (typeof audioRows.value)[number], key: string, value: unknown): void {
  if (row.vehicle) updateNestedRecord(row.vehicle, 'bgm', key, value);
  else updateRecord(row.key, key, value);
}

const soundLabels = computed(() => SOUND_LABELS.map((label) => localizeDatabaseLabel(label, language.value)));
const menuLabels = computed(() => MENU_COMMAND_LABELS.map((label) => localizeDatabaseLabel(label, language.value)));

function updateSound(index: number, key: string, value: unknown): void {
  const sounds = arrayValue('sounds').map((entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...(entry as DbRecord) } : {}
  ));
  sounds[index] = { ...(sounds[index] || {}), [key]: value };
  writePath('sounds', sounds);
}

function updateBooleanArray(path: string, index: number, checked: boolean): void {
  const next = [...arrayValue(path)];
  while (next.length <= index) next.push(false);
  next[index] = checked;
  writePath(path, next);
}

function updateNumberArray(path: string, index: number, value: number): void {
  const next = [...arrayValue(path)];
  while (next.length <= index) next.push(0);
  next[index] = value;
  writePath(path, next);
}

function battleSystemLabel(value: number): string {
  if (value === 0) return t('db.document.system.battleSystem.0');
  if (value === 1) return t('db.document.system.battleSystem.1');
  return t('db.document.system.battleSystem.2');
}

const titleCommandWindowFields = computed(() => Object.keys(objectValue('titleCommandWindow')));

function updateTitleCommandWindowField(key: string, raw: string): void {
  const current = objectValue('titleCommandWindow')[key];
  updateRecord('titleCommandWindow', key, typeof current === 'number' ? Number(raw) : raw);
}

const magicSkillIds = computed(() => new Set(arrayValue('magicSkills').map((entry) => Number(entry)).filter((id) => id > 0)));

function toggleMagicSkill(id: number, checked: boolean): void {
  const next = new Set(magicSkillIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  writePath('magicSkills', [...next].sort((a, b) => a - b));
}

function attackMotion(index: number): DbRecord {
  const value = arrayValue('attackMotions')[index];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DbRecord : {};
}

function updateAttackMotion(index: number, key: 'type' | 'weaponImageId', value: number): void {
  const next = arrayValue('attackMotions').map((entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...(entry as DbRecord) } : {}
  ));
  while (next.length <= index) next.push({ type: 0, weaponImageId: 0 });
  next[index] = { ...(next[index] as DbRecord), [key]: value };
  writePath('attackMotions', next);
}

const attackMotionRows = computed(() => [
  { id: 0, name: t('db.document.system.unarmed') },
  ...(props.catalog?.weaponTypes || [])
    .filter((entry) => entry.id > 0)
    .map((entry) => ({ id: entry.id, name: entry.name })),
]);

const advancedFields = computed<RmmvDatabaseFieldSchema[]>(() => (
  (props.schema?.coreFields || []).filter((field) => field.path.startsWith('advanced.'))
));

function advancedInputType(field: RmmvDatabaseFieldSchema): 'number' | 'text' {
  return field.kind === 'integer' || field.kind === 'number' ? 'number' : 'text';
}

function updateAdvanced(field: RmmvDatabaseFieldSchema, raw: string): void {
  writePath(field.path, advancedInputType(field) === 'number' ? Number(raw) : raw);
}

const SYSTEM_1_HANDLED = new Set([
  'gameTitle', 'currencyUnit', 'partyMembers', 'windowTone',
  'boat', 'ship', 'airship', 'startMapId', 'startX', 'startY',
  'title1Name', 'title2Name', 'optDrawTitle', 'titleCommandWindow',
  'optSideView', 'battleSystem',
  'optTransparent', 'optFollowers', 'optSlipDeath', 'optFloorDeath',
  'optDisplayTp', 'optExtraExp', 'optAutosave', 'optKeyItemsNumber',
  'optSplashScreen', 'optMessageSkip', 'titleBgm', 'battleBgm',
  'victoryMe', 'defeatMe', 'gameoverMe', 'sounds',
  // Non-RM-native editor metadata — hide from the "extra fields" catch-all.
  'locale', 'versionId', 'editMapId',
]);

const SYSTEM_2_HANDLED = new Set([
  'tileSize', 'faceSize', 'iconSize', 'menuCommands', 'itemCategories',
  'magicSkills', 'attackMotions', 'advanced',
]);

const extraRoots = computed(() => {
  const roots = new Set<string>();
  for (const field of props.schema?.coreFields || []) {
    const root = field.path.split('.')[0];
    if (root === 'id') continue;
    if (SYSTEM_FIELDS_EDITED_ELSEWHERE.has(root)) continue;
    if (systemDocumentPageForField(field.path) !== props.page) continue;
    const handled = props.page === 'System1' ? SYSTEM_1_HANDLED : SYSTEM_2_HANDLED;
    if (!handled.has(root)) roots.add(root);
  }
  return [...roots];
});

const extraRecord = computed<DbRecord>(() => Object.fromEntries(
  extraRoots.value.map((root) => [root, cloneValue(record.value[root])]),
));

function updateExtraRecord(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const next = cloneDraft(record.value);
  for (const root of extraRoots.value) next[root] = cloneValue((value as DbRecord)[root]);
  emit('update:modelValue', next);
}
</script>

<template>
  <section class="rm-document rm-system-document" :class="`is-${page.toLowerCase()}`">
    <div v-if="page === 'System1'" class="rm-system-one-grid">
      <div class="rm-system-column">
        <section class="rm-document-panel">
          <h3>{{ t('db.document.system.gameTitle') }}</h3>
          <div class="rm-compact-fields rm-compact-fields--two">
            <label v-if="hasField('gameTitle')"><span>{{ databaseFieldLabel('gameTitle', language) }}</span><el-input size="small" :model-value="textValue('gameTitle')" @update:model-value="writePath('gameTitle', $event)" /></label>
            <label v-if="hasField('currencyUnit')"><span>{{ databaseFieldLabel('currencyUnit', language) }}</span><el-input size="small" :model-value="textValue('currencyUnit')" @update:model-value="writePath('currencyUnit', $event)" /></label>
          </div>
        </section>

        <section v-if="hasField('partyMembers')" class="rm-document-panel">
          <div class="rm-panel-heading"><h3>{{ t('db.panelStartingParty') }}</h3><el-button size="small" :disabled="!actorOptions().length" @click="addPartyMember">{{ t('cmdList.add') }}</el-button></div>
          <div class="rm-party-list">
            <div v-for="(actorId, index) in arrayValue('partyMembers')" :key="`party-${index}`" class="rm-party-row">
              <span>{{ t('db.document.system.partyMember', { n: index + 1 }) }}</span>
              <el-select size="small" :model-value="Number(actorId)" @change="updatePartyMember(index, Number($event))">
                <el-option v-for="option in actorOptions()" :key="option.value" :value="option.value" :label="option.label" />
              </el-select>
              <el-button size="small" type="danger" plain @click="removePartyMember(index)">{{ t('cmdList.delete') }}</el-button>
            </div>
          </div>
        </section>

        <section v-if="hasField('windowTone')" class="rm-document-panel">
          <h3>{{ databaseFieldLabel('windowTone', language) }}</h3>
          <div class="rm-tone-grid">
            <label v-for="(label, index) in ['R', 'G', 'B', 'Gray']" :key="label">
              <span>{{ label }}</span>
              <el-input-number size="small" :controls="false" :min="-255" :max="255" :model-value="Number(arrayValue('windowTone')[index] || 0)" @change="updateNumberArray('windowTone', index, Number($event ?? 0))" />
            </label>
          </div>
        </section>

        <section v-if="vehicles.some(hasField)" class="rm-document-panel">
          <h3>{{ t('db.document.system.vehicleImages') }}</h3>
          <div class="rm-vehicle-images">
            <button v-for="vehicle in vehicles" v-show="hasField(vehicle)" :key="vehicle" type="button" class="rm-vehicle-image" @click="openVehicleImage(vehicle)">
              <span>{{ vehicleLabel(vehicle) }}</span>
              <ActorWalkingFrameThumb :character-name="String(vehicleObject(vehicle).characterName || '')" :character-index="Number(vehicleObject(vehicle).characterIndex || 0)" :catalog="catalog" :size="54" />
              <small>{{ String(vehicleObject(vehicle).characterName || t('imgPicker.none')) }}</small>
            </button>
          </div>
        </section>

        <section class="rm-document-panel">
          <h3>{{ t('db.panelStartPosition') }}</h3>
          <div class="rm-position-table">
            <div v-if="hasField('startMapId')" class="rm-position-row">
              <strong>{{ t('db.document.system.player') }}</strong>
              <el-select size="small" :model-value="numberValue('startMapId')" @change="writePath('startMapId', Number($event))"><el-option v-for="option in mapOptions()" :key="option.value" :value="option.value" :label="option.label" /></el-select>
              <el-input-number size="small" :controls="false" aria-label="X" :model-value="numberValue('startX')" @change="writePath('startX', Number($event ?? 0))" />
              <el-input-number size="small" :controls="false" aria-label="Y" :model-value="numberValue('startY')" @change="writePath('startY', Number($event ?? 0))" />
            </div>
            <div v-for="vehicle in vehicles" v-show="hasField(vehicle)" :key="`position-${vehicle}`" class="rm-position-row">
              <strong>{{ vehicleLabel(vehicle) }}</strong>
              <el-select size="small" :model-value="Number(vehicleObject(vehicle).startMapId || 0)" @change="updateRecord(vehicle, 'startMapId', Number($event))"><el-option v-for="option in mapOptions()" :key="option.value" :value="option.value" :label="option.label" /></el-select>
              <el-input-number size="small" :controls="false" aria-label="X" :model-value="Number(vehicleObject(vehicle).startX || 0)" @change="updateRecord(vehicle, 'startX', Number($event ?? 0))" />
              <el-input-number size="small" :controls="false" aria-label="Y" :model-value="Number(vehicleObject(vehicle).startY || 0)" @change="updateRecord(vehicle, 'startY', Number($event ?? 0))" />
            </div>
          </div>
        </section>
      </div>

      <div class="rm-system-column">
        <section class="rm-document-panel">
          <h3>{{ t('db.panelTitleScreen') }}</h3>
          <div class="rm-compact-fields rm-compact-fields--two">
            <label v-if="hasField('title1Name')"><span>{{ databaseFieldLabel('title1Name', language) }}</span>
              <button type="button" class="rm-title-image" @click="openSimpleImage('title1Name', 'titles1')">
                <span class="rm-title-preview"><img v-if="titleImageUrl('title1Name', 'titles1')" :src="titleImageUrl('title1Name', 'titles1')!" :alt="textValue('title1Name')" /></span>
                <small>{{ textValue('title1Name') || t('imgPicker.none') }}</small>
              </button>
            </label>
            <label v-if="hasField('title2Name')"><span>{{ databaseFieldLabel('title2Name', language) }}</span>
              <button type="button" class="rm-title-image" @click="openSimpleImage('title2Name', 'titles2')">
                <span class="rm-title-preview"><img v-if="titleImageUrl('title2Name', 'titles2')" :src="titleImageUrl('title2Name', 'titles2')!" :alt="textValue('title2Name')" /></span>
                <small>{{ textValue('title2Name') || t('imgPicker.none') }}</small>
              </button>
            </label>
          </div>
          <el-checkbox v-if="hasField('optDrawTitle')" class="rm-check" :model-value="Boolean(readPath('optDrawTitle'))" @change="writePath('optDrawTitle', Boolean($event))">{{ databaseFieldLabel('optDrawTitle', language) }}</el-checkbox>
          <div v-if="hasField('titleCommandWindow')" class="rm-inline-object">
            <strong>{{ databaseFieldLabel('titleCommandWindow', language) }}</strong>
            <label v-for="key in titleCommandWindowFields" :key="key">
              <span>{{ databaseFieldLabel(`titleCommandWindow.${key}`, language) }}</span>
              <el-input-number
                v-if="typeof objectValue('titleCommandWindow')[key] === 'number'"
                size="small"
                :controls="false"
                :model-value="Number(objectValue('titleCommandWindow')[key] ?? 0)"
                @change="updateTitleCommandWindowField(key, String($event ?? ''))"
              />
              <el-input
                v-else
                size="small"
                :model-value="String(objectValue('titleCommandWindow')[key] ?? '')"
                @update:model-value="updateTitleCommandWindowField(key, $event)"
              />
            </label>
          </div>
        </section>

        <section class="rm-document-panel">
          <h3>{{ t('db.panelBattleScreen') }}</h3>
          <el-checkbox v-if="hasField('optSideView')" class="rm-check" :model-value="Boolean(readPath('optSideView'))" @change="writePath('optSideView', Boolean($event))">{{ databaseFieldLabel('optSideView', language) }}</el-checkbox>
        </section>

        <section v-if="hasField('battleSystem')" class="rm-document-panel">
          <h3>{{ t('db.document.system.battleSystem') }}</h3>
          <div class="rm-radio-list">
            <el-radio-group :model-value="numberValue('battleSystem')" @change="writePath('battleSystem', Number($event))">
              <el-radio v-for="option in [0, 1, 2]" :key="option" :value="option">{{ battleSystemLabel(option) }}</el-radio>
            </el-radio-group>
          </div>
        </section>

        <section v-if="optionPaths.length" class="rm-document-panel">
          <h3>{{ t('db.panelOptions') }}</h3>
          <div class="rm-check-grid">
            <el-checkbox v-for="path in optionPaths" :key="path" class="rm-check" :model-value="Boolean(readPath(path))" @change="writePath(path, Boolean($event))">{{ databaseFieldLabel(path, language) }}</el-checkbox>
          </div>
        </section>
      </div>

      <div class="rm-system-column">
        <section v-if="audioRows.length" class="rm-document-panel rm-table-panel">
          <h3>{{ t('db.panelMusic') }}</h3>
          <div class="rm-table-scroll">
            <table class="rm-settings-table">
              <thead><tr><th>{{ t('db.document.system.audioType') }}</th><th>{{ t('plugins.file') }}</th><th>{{ t('moveRoute.volume') }}</th><th>{{ t('moveRoute.pitch') }}</th><th>{{ t('moveRoute.pan') }}</th></tr></thead>
              <tbody>
                <tr v-for="row in audioRows" :key="row.key">
                  <th scope="row">{{ row.label }}</th>
                  <td><el-select size="small" :model-value="String(row.object.name || '')" @change="updateAudio(row, 'name', String($event))"><el-option v-for="option in audioOptions(row.kind)" :key="option.value" :value="option.value" :label="option.label" /></el-select></td>
                  <td><el-input-number size="small" :controls="false" :model-value="Number(row.object.volume ?? 90)" @change="updateAudio(row, 'volume', Number($event ?? 0))" /></td>
                  <td><el-input-number size="small" :controls="false" :model-value="Number(row.object.pitch ?? 100)" @change="updateAudio(row, 'pitch', Number($event ?? 0))" /></td>
                  <td><el-input-number size="small" :controls="false" :model-value="Number(row.object.pan ?? 0)" @change="updateAudio(row, 'pan', Number($event ?? 0))" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="hasField('sounds')" class="rm-document-panel rm-table-panel rm-sound-panel">
          <h3>{{ databaseFieldLabel('sounds', language) }}</h3>
          <div class="rm-table-scroll">
            <table class="rm-settings-table">
              <thead><tr><th>{{ t('db.document.system.audioType') }}</th><th>{{ t('plugins.file') }}</th><th>{{ t('moveRoute.volume') }}</th><th>{{ t('moveRoute.pitch') }}</th><th>{{ t('moveRoute.pan') }}</th></tr></thead>
              <tbody>
                <tr v-for="(sound, index) in arrayValue('sounds')" :key="`sound-${index}`">
                  <th scope="row">{{ soundLabels[index] || `SE ${index + 1}` }}</th>
                  <td><el-select size="small" :model-value="String((sound as DbRecord).name || '')" @change="updateSound(index, 'name', String($event))"><el-option v-for="option in audioOptions('se')" :key="option.value" :value="option.value" :label="option.label" /></el-select></td>
                  <td><el-input-number size="small" :controls="false" :model-value="Number((sound as DbRecord).volume ?? 90)" @change="updateSound(index, 'volume', Number($event ?? 0))" /></td>
                  <td><el-input-number size="small" :controls="false" :model-value="Number((sound as DbRecord).pitch ?? 100)" @change="updateSound(index, 'pitch', Number($event ?? 0))" /></td>
                  <td><el-input-number size="small" :controls="false" :model-value="Number((sound as DbRecord).pan ?? 0)" @change="updateSound(index, 'pan', Number($event ?? 0))" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>

    <div v-else class="rm-system-two-grid">
      <div class="rm-system-column">
        <section v-if="hasField('tileSize')" class="rm-document-panel">
          <h3>{{ databaseFieldLabel('tileSize', language) }}</h3>
          <div class="rm-tile-size-options">
            <el-radio-group :model-value="numberValue('tileSize')" @change="writePath('tileSize', Number($event))">
              <el-radio v-for="size in [48, 32, 24, 16]" :key="size" :value="size">{{ size }}×{{ size }}</el-radio>
            </el-radio-group>
          </div>
        </section>

        <div class="rm-system-two-small-grid">
          <section v-if="hasField('menuCommands')" class="rm-document-panel">
            <h3>{{ databaseFieldLabel('menuCommands', language) }}</h3>
            <div class="rm-check-grid">
              <el-checkbox
                v-for="(label, index) in menuLabels"
                :key="label"
                class="rm-check"
                :model-value="Boolean(arrayValue('menuCommands')[index])"
                @change="updateBooleanArray('menuCommands', index, Boolean($event))"
              >{{ label }}</el-checkbox>
            </div>
          </section>

          <section v-if="hasField('itemCategories')" class="rm-document-panel">
            <h3>{{ databaseFieldLabel('itemCategories', language) }}</h3>
            <div class="rm-check-grid">
              <el-checkbox
                v-for="(label, index) in [t('db.document.system.item'), t('db.document.system.weapon'), t('db.document.system.armor'), t('db.document.system.keyItem')]"
                :key="label"
                class="rm-check"
                :model-value="Boolean(arrayValue('itemCategories')[index])"
                @change="updateBooleanArray('itemCategories', index, Boolean($event))"
              >{{ label }}</el-checkbox>
            </div>
          </section>

          <section v-if="hasField('magicSkills')" class="rm-document-panel">
            <h3>{{ databaseFieldLabel('magicSkills', language) }}</h3>
            <div class="rm-magic-list">
              <el-checkbox
                v-for="entry in catalog?.skillTypes || []"
                :key="entry.id"
                class="rm-check"
                :model-value="magicSkillIds.has(entry.id)"
                @change="toggleMagicSkill(entry.id, Boolean($event))"
              >{{ entry.name }}</el-checkbox>
            </div>
          </section>
        </div>

        <section v-if="hasField('attackMotions')" class="rm-document-panel rm-table-panel">
          <h3>{{ databaseFieldLabel('attackMotions', language) }}</h3>
          <div class="rm-table-scroll">
            <table class="rm-settings-table">
              <thead><tr><th>{{ t('db.document.system.weaponType') }}</th><th>{{ t('db.document.system.motion') }}</th><th>{{ t('db.document.system.weaponImage') }}</th></tr></thead>
              <tbody>
                <tr v-for="entry in attackMotionRows" :key="entry.id">
                  <th scope="row">{{ entry.name }}</th>
                  <td>
                    <el-select size="small" :model-value="Number(attackMotion(entry.id).type || 0)" @change="updateAttackMotion(entry.id, 'type', Number($event))">
                      <el-option :value="0" :label="t('db.document.system.motion.thrust')" />
                      <el-option :value="1" :label="t('db.document.system.motion.swing')" />
                      <el-option :value="2" :label="t('db.document.system.motion.missile')" />
                    </el-select>
                  </td>
                  <td><el-input-number size="small" :controls="false" :min="0" :model-value="Number(attackMotion(entry.id).weaponImageId || 0)" @change="updateAttackMotion(entry.id, 'weaponImageId', Number($event ?? 0))" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="rm-system-column">
        <section v-if="advancedFields.length" class="rm-document-panel rm-table-panel rm-advanced-panel">
          <h3>{{ t('db.document.system.advanced') }}</h3>
          <div class="rm-table-scroll">
            <table class="rm-settings-table">
              <thead><tr><th>{{ t('db.document.system.settingName') }}</th><th>{{ t('db.document.system.settingValue') }}</th></tr></thead>
              <tbody>
                <tr v-for="field in advancedFields" :key="field.path">
                  <th scope="row">{{ databaseFieldLabel(field.path, language) }}</th>
                  <td>
                    <el-input-number
                      v-if="advancedInputType(field) === 'number'"
                      size="small"
                      :controls="false"
                      :model-value="Number(readPath(field.path) ?? 0)"
                      @change="updateAdvanced(field, String($event ?? ''))"
                    />
                    <el-input
                      v-else
                      size="small"
                      :model-value="String(readPath(field.path) ?? '')"
                      @update:model-value="updateAdvanced(field, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section v-if="hasField('faceSize') || hasField('iconSize')" class="rm-document-panel">
          <h3>{{ t('db.document.system.assetSizes') }}</h3>
          <div class="rm-compact-fields rm-compact-fields--two">
            <label v-if="hasField('faceSize')"><span>{{ databaseFieldLabel('faceSize', language) }}</span><el-input-number size="small" :controls="false" :min="1" :model-value="numberValue('faceSize')" @change="writePath('faceSize', Number($event ?? 1))" /></label>
            <label v-if="hasField('iconSize')"><span>{{ databaseFieldLabel('iconSize', language) }}</span><el-input-number size="small" :controls="false" :min="1" :model-value="numberValue('iconSize')" @change="writePath('iconSize', Number($event ?? 1))" /></label>
          </div>
        </section>
      </div>
    </div>

    <section v-if="extraRoots.length" class="rm-document-panel rm-extra-panel">
      <h3>{{ t('db.panelOtherFields') }}</h3>
      <StructuredFieldsEditor :model-value="extraRecord" :label="t('db.panelOtherFields')" @update:model-value="updateExtraRecord" />
    </section>

    <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="safeLoadImage" @commit="commitImageSelection" />
  </section>
</template>

<style scoped>
.rm-document {
  min-width: 0;
  color: var(--console-text, #211d17);
}
.rm-system-one-grid {
  display: grid;
  grid-template-columns: minmax(0, .92fr) minmax(0, .82fr) minmax(0, 1.12fr);
  gap: 6px;
  align-items: start;
}
.rm-system-two-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, .85fr);
  gap: 6px;
  align-items: start;
}
.rm-system-column {
  min-width: 0;
  display: grid;
  gap: 6px;
  align-content: start;
}
.rm-document-panel {
  min-width: 0;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 5px;
  background: var(--console-paper-soft, #faf5ec);
  overflow: hidden;
}
.rm-document-panel > h3,
.rm-panel-heading {
  min-height: 28px;
  box-sizing: border-box;
  margin: 0;
  padding: 5px 7px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  background: var(--console-paper, #fffdfa);
  font-size: 12px;
  line-height: 1.35;
}
.rm-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rm-panel-heading h3 {
  margin: 0;
  font-size: 12px;
}
.rm-panel-heading button {
  min-height: 24px;
  padding: 2px 7px;
}
.rm-compact-fields {
  display: grid;
  gap: 5px;
  padding: 7px;
}
.rm-compact-fields--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.rm-compact-fields label,
.rm-party-row,
.rm-position-row {
  min-width: 0;
}
.rm-compact-fields label {
  display: grid;
  gap: 2px;
  font-size: 11px;
}
.rm-compact-fields input,
.rm-compact-fields button,
.rm-compact-fields select {
  width: 100%;
  min-width: 0;
  min-height: 27px;
  box-sizing: border-box;
}
.rm-inline-object {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 5px;
  padding: 7px;
  border-top: 1px solid var(--console-border, #e4dcce);
  font-size: 10px;
}
.rm-inline-object > strong {
  align-self: center;
  font-size: 11px;
}
.rm-inline-object label {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.rm-inline-object input {
  width: 100%;
  min-width: 0;
  min-height: 25px;
  box-sizing: border-box;
}
.rm-party-list {
  display: grid;
}
.rm-party-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 3px 6px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  font-size: 11px;
}
.rm-party-row:last-child { border-bottom: 0; }
.rm-party-row button { min-height: 24px; padding: 2px 6px; }
.rm-tone-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
  padding: 7px;
}
.rm-tone-grid label { display: grid; gap: 2px; font-size: 10px; }
.rm-tone-grid input { width: 100%; min-width: 0; box-sizing: border-box; }
.rm-vehicle-images {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  padding: 7px;
}
.rm-vehicle-image {
  min-width: 0;
  min-height: 100px;
  display: grid;
  place-items: center;
  gap: 3px;
  padding: 5px;
  overflow: hidden;
}
.rm-vehicle-image small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-title-image {
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 5px;
}
/* Small title-screen preview; the checker marks transparent regions like the asset library. */
.rm-title-preview {
  width: 96px;
  height: 72px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 4px;
  background-color: #f5efe6;
  background-image:
    linear-gradient(45deg, #ded6c8 25%, transparent 25%),
    linear-gradient(-45deg, #ded6c8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ded6c8 75%),
    linear-gradient(-45deg, transparent 75%, #ded6c8 75%);
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
}
.rm-title-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.rm-title-image small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-position-table {
  display: grid;
}
.rm-position-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) 48px 48px;
  gap: 4px;
  align-items: center;
  min-height: 30px;
  padding: 3px 6px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  font-size: 11px;
}
.rm-position-row:last-child { border-bottom: 0; }
.rm-position-row select,
.rm-position-row input { width: 100%; min-width: 0; box-sizing: border-box; }
.rm-check {
  min-height: 27px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  font-size: 11px;
}
.rm-check input { flex: 0 0 auto; }
.rm-check-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
}
.rm-radio-list,
.rm-tile-size-options {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 14px;
  padding: 7px;
}
.rm-radio-list label,
.rm-tile-size-options label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}
.rm-table-scroll {
  min-width: 0;
  overflow: auto;
  background: var(--console-paper, #fffdfa);
}
.rm-settings-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10px;
}
.rm-settings-table th,
.rm-settings-table td {
  min-width: 0;
  height: 28px;
  padding: 2px 4px;
  border-bottom: 1px solid var(--console-border, #e4dcce);
  text-align: left;
}
.rm-settings-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--console-paper-soft, #faf5ec);
}
.rm-settings-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--console-paper-soft, #faf5ec) 78%, var(--console-paper, #fffdfa));
}
.rm-settings-table tbody th {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-settings-table input,
.rm-settings-table select {
  width: 100%;
  min-width: 0;
  min-height: 23px;
  box-sizing: border-box;
  padding: 2px 4px;
  font-size: 10px;
}
.rm-settings-table th:first-child { width: 21%; }
/* Element Plus controls inside compact tables/fields fill their cell. */
.rm-settings-table .el-select,
.rm-settings-table .el-input-number,
.rm-settings-table .el-input,
.rm-compact-fields .el-input-number,
.rm-compact-fields .el-input,
.rm-party-row .el-select,
.rm-position-row .el-select,
.rm-position-row .el-input-number,
.rm-tone-grid .el-input-number,
.rm-inline-object .el-input,
.rm-inline-object .el-input-number {
  width: 100%;
}
.rm-check-grid .rm-check.el-checkbox,
.rm-magic-list .rm-check.el-checkbox {
  height: auto;
  min-height: 24px;
  margin-right: 0;
}
.rm-sound-panel .rm-table-scroll { max-height: min(48vh, 560px); }
.rm-system-two-small-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.rm-magic-list {
  min-height: 76px;
  max-height: 160px;
  overflow-y: auto;
  background: var(--console-paper, #fffdfa);
}
.rm-advanced-panel .rm-settings-table th:first-child { width: 48%; }
.rm-extra-panel { margin-top: 6px; }
@container (max-width: 900px) {
  .rm-system-one-grid,
  .rm-system-two-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width: 560px) {
  .rm-compact-fields--two,
  .rm-system-two-small-grid,
  .rm-check-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
