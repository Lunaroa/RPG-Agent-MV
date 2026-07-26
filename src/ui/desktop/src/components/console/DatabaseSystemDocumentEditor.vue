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
import { systemDocumentPageForField } from '../../utils/databaseDocumentPages';
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
            <label v-if="hasField('gameTitle')"><span>{{ databaseFieldLabel('gameTitle', language) }}</span><input :value="textValue('gameTitle')" @input="writePath('gameTitle', ($event.target as HTMLInputElement).value)" /></label>
            <label v-if="hasField('currencyUnit')"><span>{{ databaseFieldLabel('currencyUnit', language) }}</span><input :value="textValue('currencyUnit')" @input="writePath('currencyUnit', ($event.target as HTMLInputElement).value)" /></label>
          </div>
        </section>

        <section v-if="hasField('partyMembers')" class="rm-document-panel">
          <div class="rm-panel-heading"><h3>{{ t('db.panelStartingParty') }}</h3><button type="button" :disabled="!actorOptions().length" @click="addPartyMember">{{ t('cmdList.add') }}</button></div>
          <div class="rm-party-list">
            <div v-for="(actorId, index) in arrayValue('partyMembers')" :key="`party-${index}`" class="rm-party-row">
              <span>{{ t('db.document.system.partyMember', { n: index + 1 }) }}</span>
              <select :value="Number(actorId)" @change="updatePartyMember(index, Number(($event.target as HTMLSelectElement).value))">
                <option v-for="option in actorOptions()" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <button type="button" class="danger" @click="removePartyMember(index)">{{ t('cmdList.delete') }}</button>
            </div>
          </div>
        </section>

        <section v-if="hasField('windowTone')" class="rm-document-panel">
          <h3>{{ databaseFieldLabel('windowTone', language) }}</h3>
          <div class="rm-tone-grid">
            <label v-for="(label, index) in ['R', 'G', 'B', 'Gray']" :key="label">
              <span>{{ label }}</span>
              <input type="number" min="-255" max="255" :value="Number(arrayValue('windowTone')[index] || 0)" @input="updateNumberArray('windowTone', index, Number(($event.target as HTMLInputElement).value))" />
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
              <select :value="numberValue('startMapId')" @change="writePath('startMapId', Number(($event.target as HTMLSelectElement).value))"><option v-for="option in mapOptions()" :key="option.value" :value="option.value">{{ option.label }}</option></select>
              <input type="number" aria-label="X" :value="numberValue('startX')" @input="writePath('startX', Number(($event.target as HTMLInputElement).value))" />
              <input type="number" aria-label="Y" :value="numberValue('startY')" @input="writePath('startY', Number(($event.target as HTMLInputElement).value))" />
            </div>
            <div v-for="vehicle in vehicles" v-show="hasField(vehicle)" :key="`position-${vehicle}`" class="rm-position-row">
              <strong>{{ vehicleLabel(vehicle) }}</strong>
              <select :value="Number(vehicleObject(vehicle).startMapId || 0)" @change="updateRecord(vehicle, 'startMapId', Number(($event.target as HTMLSelectElement).value))"><option v-for="option in mapOptions()" :key="option.value" :value="option.value">{{ option.label }}</option></select>
              <input type="number" aria-label="X" :value="Number(vehicleObject(vehicle).startX || 0)" @input="updateRecord(vehicle, 'startX', Number(($event.target as HTMLInputElement).value))" />
              <input type="number" aria-label="Y" :value="Number(vehicleObject(vehicle).startY || 0)" @input="updateRecord(vehicle, 'startY', Number(($event.target as HTMLInputElement).value))" />
            </div>
          </div>
        </section>
      </div>

      <div class="rm-system-column">
        <section class="rm-document-panel">
          <h3>{{ t('db.panelTitleScreen') }}</h3>
          <div class="rm-compact-fields rm-compact-fields--two">
            <label v-if="hasField('title1Name')"><span>{{ databaseFieldLabel('title1Name', language) }}</span><button type="button" @click="openSimpleImage('title1Name', 'titles1')">{{ textValue('title1Name') || t('imgPicker.none') }}</button></label>
            <label v-if="hasField('title2Name')"><span>{{ databaseFieldLabel('title2Name', language) }}</span><button type="button" @click="openSimpleImage('title2Name', 'titles2')">{{ textValue('title2Name') || t('imgPicker.none') }}</button></label>
          </div>
          <label v-if="hasField('optDrawTitle')" class="rm-check"><input type="checkbox" :checked="Boolean(readPath('optDrawTitle'))" @change="writePath('optDrawTitle', ($event.target as HTMLInputElement).checked)" />{{ databaseFieldLabel('optDrawTitle', language) }}</label>
          <div v-if="hasField('titleCommandWindow')" class="rm-inline-object">
            <strong>{{ databaseFieldLabel('titleCommandWindow', language) }}</strong>
            <label v-for="key in titleCommandWindowFields" :key="key">
              <span>{{ databaseFieldLabel(`titleCommandWindow.${key}`, language) }}</span>
              <input
                :type="typeof objectValue('titleCommandWindow')[key] === 'number' ? 'number' : 'text'"
                :value="String(objectValue('titleCommandWindow')[key] ?? '')"
                @input="updateTitleCommandWindowField(key, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>

        <section class="rm-document-panel">
          <h3>{{ t('db.panelBattleScreen') }}</h3>
          <label v-if="hasField('optSideView')" class="rm-check"><input type="checkbox" :checked="Boolean(readPath('optSideView'))" @change="writePath('optSideView', ($event.target as HTMLInputElement).checked)" />{{ databaseFieldLabel('optSideView', language) }}</label>
        </section>

        <section v-if="hasField('battleSystem')" class="rm-document-panel">
          <h3>{{ t('db.document.system.battleSystem') }}</h3>
          <div class="rm-radio-list">
            <label v-for="option in [0, 1, 2]" :key="option"><input type="radio" name="system-battle-system" :value="option" :checked="numberValue('battleSystem') === option" @change="writePath('battleSystem', option)" />{{ battleSystemLabel(option) }}</label>
          </div>
        </section>

        <section v-if="optionPaths.length" class="rm-document-panel">
          <h3>{{ t('db.panelOptions') }}</h3>
          <div class="rm-check-grid">
            <label v-for="path in optionPaths" :key="path" class="rm-check"><input type="checkbox" :checked="Boolean(readPath(path))" @change="writePath(path, ($event.target as HTMLInputElement).checked)" />{{ databaseFieldLabel(path, language) }}</label>
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
                  <td><select :value="String(row.object.name || '')" @change="updateAudio(row, 'name', ($event.target as HTMLSelectElement).value)"><option v-for="option in audioOptions(row.kind)" :key="option.value" :value="option.value">{{ option.label }}</option></select></td>
                  <td><input type="number" :value="Number(row.object.volume ?? 90)" @input="updateAudio(row, 'volume', Number(($event.target as HTMLInputElement).value))" /></td>
                  <td><input type="number" :value="Number(row.object.pitch ?? 100)" @input="updateAudio(row, 'pitch', Number(($event.target as HTMLInputElement).value))" /></td>
                  <td><input type="number" :value="Number(row.object.pan ?? 0)" @input="updateAudio(row, 'pan', Number(($event.target as HTMLInputElement).value))" /></td>
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
                  <td><select :value="String((sound as DbRecord).name || '')" @change="updateSound(index, 'name', ($event.target as HTMLSelectElement).value)"><option v-for="option in audioOptions('se')" :key="option.value" :value="option.value">{{ option.label }}</option></select></td>
                  <td><input type="number" :value="Number((sound as DbRecord).volume ?? 90)" @input="updateSound(index, 'volume', Number(($event.target as HTMLInputElement).value))" /></td>
                  <td><input type="number" :value="Number((sound as DbRecord).pitch ?? 100)" @input="updateSound(index, 'pitch', Number(($event.target as HTMLInputElement).value))" /></td>
                  <td><input type="number" :value="Number((sound as DbRecord).pan ?? 0)" @input="updateSound(index, 'pan', Number(($event.target as HTMLInputElement).value))" /></td>
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
            <label v-for="size in [48, 32, 24, 16]" :key="size"><input type="radio" name="system-tile-size" :value="size" :checked="numberValue('tileSize') === size" @change="writePath('tileSize', size)" />{{ size }}×{{ size }}</label>
          </div>
        </section>

        <div class="rm-system-two-small-grid">
          <section v-if="hasField('menuCommands')" class="rm-document-panel">
            <h3>{{ databaseFieldLabel('menuCommands', language) }}</h3>
            <div class="rm-check-grid">
              <label v-for="(label, index) in menuLabels" :key="label" class="rm-check"><input type="checkbox" :checked="Boolean(arrayValue('menuCommands')[index])" @change="updateBooleanArray('menuCommands', index, ($event.target as HTMLInputElement).checked)" />{{ label }}</label>
            </div>
          </section>

          <section v-if="hasField('itemCategories')" class="rm-document-panel">
            <h3>{{ databaseFieldLabel('itemCategories', language) }}</h3>
            <div class="rm-check-grid">
              <label v-for="(label, index) in [t('db.document.system.item'), t('db.document.system.weapon'), t('db.document.system.armor'), t('db.document.system.keyItem')]" :key="label" class="rm-check"><input type="checkbox" :checked="Boolean(arrayValue('itemCategories')[index])" @change="updateBooleanArray('itemCategories', index, ($event.target as HTMLInputElement).checked)" />{{ label }}</label>
            </div>
          </section>

          <section v-if="hasField('magicSkills')" class="rm-document-panel">
            <h3>{{ databaseFieldLabel('magicSkills', language) }}</h3>
            <div class="rm-magic-list">
              <label v-for="entry in catalog?.skillTypes || []" :key="entry.id" class="rm-check"><input type="checkbox" :checked="magicSkillIds.has(entry.id)" @change="toggleMagicSkill(entry.id, ($event.target as HTMLInputElement).checked)" />{{ entry.name }}</label>
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
                  <td><select :value="Number(attackMotion(entry.id).type || 0)" @change="updateAttackMotion(entry.id, 'type', Number(($event.target as HTMLSelectElement).value))"><option :value="0">{{ t('db.document.system.motion.thrust') }}</option><option :value="1">{{ t('db.document.system.motion.swing') }}</option><option :value="2">{{ t('db.document.system.motion.missile') }}</option></select></td>
                  <td><input type="number" min="0" :value="Number(attackMotion(entry.id).weaponImageId || 0)" @input="updateAttackMotion(entry.id, 'weaponImageId', Number(($event.target as HTMLInputElement).value))" /></td>
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
                  <td><input :type="advancedInputType(field)" :value="String(readPath(field.path) ?? '')" @input="updateAdvanced(field, ($event.target as HTMLInputElement).value)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section v-if="hasField('faceSize') || hasField('iconSize')" class="rm-document-panel">
          <h3>{{ t('db.document.system.assetSizes') }}</h3>
          <div class="rm-compact-fields rm-compact-fields--two">
            <label v-if="hasField('faceSize')"><span>{{ databaseFieldLabel('faceSize', language) }}</span><input type="number" min="1" :value="numberValue('faceSize')" @input="writePath('faceSize', Number(($event.target as HTMLInputElement).value))" /></label>
            <label v-if="hasField('iconSize')"><span>{{ databaseFieldLabel('iconSize', language) }}</span><input type="number" min="1" :value="numberValue('iconSize')" @input="writePath('iconSize', Number(($event.target as HTMLInputElement).value))" /></label>
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
