<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import type {
  EditorProjectCatalog,
  NamedCatalogEntry,
  ProjectAssetEntry,
} from '../../api/client';
import type {
  RmmvDatabaseEntrySchema,
  RmmvDatabaseFieldKind,
  RmmvDatabaseFieldSchema,
} from '@contract/types';
import { useI18n } from '../../i18n';
import {
  animationFramesSummary,
  appendAnimationTiming,
  appendMzAnimationFlashTiming,
  appendMzAnimationSoundTiming,
  MV_ANIMATION_FLASH_SCOPES,
  MV_TROOP_PAGE_SPANS,
  appendStringListItem,
  alignTroopMembers,
  autoNameTroop,
  canRemoveStringListItem,
  cloneDatabaseEditorRecord,
  enemyActionConditionPercentage,
  isStandardEnemyActionConditionType,
  isMvStringListField,
  MV_TERMS_LIST_PATHS,
  normalizeAnimationTimings,
  normalizeMzAnimationFlashTimings,
  normalizeMzAnimationRotation,
  normalizeMzAnimationSoundTimings,
  normalizeEnemyAction,
  normalizeTroopPageConditions,
  normalizeTroopMembers,
  normalizeStringList,
  normalizeTermsArray,
  removeAnimationTiming as removeAnimationTimingValue,
  removeMzAnimationFlashTiming,
  removeMzAnimationSoundTiming,
  removeStringListItem,
  setAnimationTimingFlashColor,
  setAnimationTimingSeValue,
  setAnimationTimingValue,
  setMzAnimationFlashTimingColor,
  setMzAnimationFlashTimingValue,
  setMzAnimationRotationAxis,
  setMzAnimationSoundTimingFrame,
  setMzAnimationSoundTimingSeValue,
  setEnemyActionConditionParameter,
  setEnemyActionConditionType,
  setStringListItem,
  setTroopPageCondition,
  setTroopPageSpan,
  sortedTermsMessageKeys,
  standardBlankTroopPage,
  stringListHasReservedZero,
  troopPageConditionSummary,
} from '../../utils/rmmvDatabaseEditor';
import type { MvCommand } from '../../composables/useEventEditor';
import { eventCharacterFrame, type MvEventImage } from '../../composables/useMapRenderer';
import { mvFaceSourceRect } from '../../utils/rmmvFace';
import MvCommandListEditor from './MvCommandListEditor.vue';
import StructuredFieldsEditor from './StructuredFieldsEditor.vue';
import ImageAssetPickerDialog from '../editor/ImageAssetPickerDialog.vue';
import AnimationFrameCanvasEditor from './AnimationFrameCanvasEditor.vue';
import ClassParameterCurveEditor from './ClassParameterCurveEditor.vue';
import DatabaseEffectEditor from './DatabaseEffectEditor.vue';
import DatabaseTraitEditor from './DatabaseTraitEditor.vue';
import TilesetFlagCanvasEditor from './TilesetFlagCanvasEditor.vue';
import TroopFormationCanvas from './TroopFormationCanvas.vue';
import { enemyBattlerAssetKind } from '../../utils/rmmvBattleAssets.ts';
import {
  ANIMATION_POSITION_OPTIONS,
  DAMAGE_TYPE_OPTIONS,
  DROP_KIND_OPTIONS,
  HIT_TYPE_OPTIONS,
  ITEM_TYPE_OPTIONS,
  MENU_COMMAND_LABELS,
  OCCASION_OPTIONS,
  PARAM_OPTIONS,
  RMMV_BATTLE_SPAN_LABEL,
  RMMV_NONE_LABEL,
  SCOPE_OPTIONS,
  SOUND_LABELS,
  STATE_AUTO_REMOVE_OPTIONS,
  STATE_MOTION_OPTIONS,
  STATE_OVERLAY_OPTIONS,
  STATE_RESTRICTION_OPTIONS,
  TERM_LABELS,
  TILESET_MODE_OPTIONS,
  TILESET_NAME_LABELS,
  TONE_LABELS,
  TRIGGER_OPTIONS,
  databaseFieldLabel,
  databaseGroupLabel,
  databaseTermMessageLabel,
  localizeDatabaseLabel,
  localizeDatabaseOptions,
} from '../../utils/rmmvDatabaseLocalization';

type DbRecord = Record<string, unknown>;
type DbArrayRecord = Record<string, unknown>[];
type CatalogKey = Exclude<keyof EditorProjectCatalog, 'project' | 'engine' | 'tileSize' | 'screenWidth' | 'screenHeight' | 'faceSize' | 'iconSize' | 'assets' | 'battle'>;
type ImageAssetKind = keyof EditorProjectCatalog['assets'];
type ImagePickerMode = 'plain' | 'face' | 'character' | 'icon';
type ImageSelection = { name: string; index: number };

interface SelectOption {
  value: number;
  label: string;
}

const props = defineProps<{
  modelValue: unknown;
  group?: string;
  catalog: EditorProjectCatalog | null;
  schema?: RmmvDatabaseEntrySchema;
  focusField?: string;
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
  battleback1Name?: string;
  battleback2Name?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
  'update:battleback1Name': [value: string];
  'update:battleback2Name': [value: string];
  'requestBattleTest': [];
  'requestParticlePreview': [];
}>();
const { language, t } = useI18n();

const jsonErrors = reactive<Record<string, string>>({});
const facePreviewCanvas = ref<HTMLCanvasElement | null>(null);
const characterPreviewCanvas = ref<HTMLCanvasElement | null>(null);
const battlerPreviewCanvas = ref<HTMLCanvasElement | null>(null);
const enemyBattlerPreviewCanvas = ref<HTMLCanvasElement | null>(null);
const imagePicker = ref<InstanceType<typeof ImageAssetPickerDialog> | null>(null);
const selectedTroopMemberIndex = ref(0);
const enemyActionErrors = reactive<Record<number, string>>({});
const troopEditorError = ref('');
const troopPageClipboard = ref<DbRecord | null>(null);
const ACTOR_IMAGE_FIELD_PATHS = new Set(['faceName', 'faceIndex', 'characterName', 'characterIndex', 'battlerName']);
let pendingImageCommit: ((selection: ImageSelection) => void) | null = null;

const record = computed<DbRecord>(() => (
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? props.modelValue as DbRecord
    : {}
));
const MZ_ANIMATION_FIELDS = new Set([
  'displayType', 'effectName', 'scale', 'speed', 'flashTimings', 'soundTimings',
  'offsetX', 'offsetY', 'rotation', 'alignBottom',
]);
const MV_ANIMATION_FIELDS = new Set([
  'animation1Name', 'animation1Hue', 'animation2Name', 'animation2Hue', 'position', 'frames', 'timings',
]);
const PARTICLE_ROTATION_AXES = ['x', 'y', 'z'] as const;
const isMZParticleAnimation = computed(() => props.group === 'Animations'
  && props.catalog?.engine === 'rpg-maker-mz'
  && (Object.hasOwn(record.value, 'effectName') || Object.hasOwn(record.value, 'displayType')));
const projectScreenWidth = computed(() => Math.max(1, Number(props.catalog?.screenWidth) || 816));
const projectScreenHeight = computed(() => Math.max(1, Number(props.catalog?.screenHeight) || 624));

const groupLabel = computed(() => {
  const key = String(props.group || '');
  return key ? databaseGroupLabel(key, language.value) : String(props.group || t('db.title'));
});
const schemaFields = computed(() => {
  let fields = props.schema?.coreFields || [];
  if (props.group === 'Animations' && props.catalog?.engine === 'rpg-maker-mz') {
    fields = fields.filter((field) => isMZParticleAnimation.value
      ? !MV_ANIMATION_FIELDS.has(field.path)
      : !MZ_ANIMATION_FIELDS.has(field.path));
  }
  if (!props.focusField) return fields;
  return fields.filter((field) => field.path === props.focusField);
});
const references = computed(() => props.schema?.references || []);
const schemaDriven = computed(() => schemaFields.value.length > 0);
const localizedParamOptions = computed(() => localizedOptions(PARAM_OPTIONS));
const localizedMenuCommandLabels = computed(() => MENU_COMMAND_LABELS.map(localizedLabel));
const localizedToneLabels = computed(() => TONE_LABELS.map(localizedLabel));
const localizedSoundLabels = computed(() => SOUND_LABELS.map(localizedLabel));
const localizedTermLabels = computed<Record<string, string[]>>(() => Object.fromEntries(
  Object.entries(TERM_LABELS).map(([key, labels]) => [key, labels.map(localizedLabel)]),
));
const isActorImageEditor = computed(() => props.group === 'Actors' && schemaDriven.value);
const isEnemyEditor = computed(() => props.group === 'Enemies' || props.schema?.fileName === 'Enemies.json');
const enemyImageAsset = computed(() => enemyBattlerAssetKind(props.catalog?.battle.sideView === true));
const activeBattleback1Name = computed(() => props.battleback1Name ?? props.catalog?.battle.battleback1Name ?? '');
const activeBattleback2Name = computed(() => props.battleback2Name ?? props.catalog?.battle.battleback2Name ?? '');
const visibleSchemaFields = computed(() => (
  isActorImageEditor.value
    ? schemaFields.value.filter((field) => !ACTOR_IMAGE_FIELD_PATHS.has(field.path))
    : schemaFields.value
));
const ACTOR_RM_BASIC_PATHS = ['id', 'name', 'nickname', 'classId', 'initialLevel', 'maxLevel', 'profile'] as const;
const actorBasicFields = computed(() => schemaFields.value.filter((field) => (
  ACTOR_RM_BASIC_PATHS.includes(field.path as typeof ACTOR_RM_BASIC_PATHS[number])
)));
const actorNoteField = computed(() => schemaFields.value.find((field) => field.path === 'note'));
const actorEquipsField = computed(() => schemaFields.value.find((field) => field.path === 'equips'));
const actorTraitsField = computed(() => schemaFields.value.find((field) => field.path === 'traits'));
const actorProfileField = computed(() => schemaFields.value.find((field) => field.path === 'profile'));
const actorBasicScalarFields = computed(() => actorBasicFields.value.filter((field) => field.path !== 'profile'));
const actorImageSignature = computed(() => [
  props.group || '',
  props.catalog?.project || '',
  stringValue('faceName'),
  numberPathValue('faceIndex'),
  stringValue('characterName'),
  numberPathValue('characterIndex'),
  stringValue('battlerName'),
  props.catalog?.assets.faces.length || 0,
  props.catalog?.assets.characters.length || 0,
  props.catalog?.assets.svActors.length || 0,
].join('|'));
const enemyBattlerSignature = computed(() => [
  isEnemyEditor.value ? 'enemy' : '',
  props.catalog?.project || '',
  enemyImageAsset.value,
  stringValue('battlerName'),
  props.catalog?.assets[enemyImageAsset.value].length || 0,
].join('|'));

watch(actorImageSignature, () => {
  if (isActorImageEditor.value) void nextTick(paintActorImagePreviews);
}, { immediate: true });
watch(enemyBattlerSignature, () => {
  if (isEnemyEditor.value) void nextTick(paintEnemyBattlerPreview);
}, { immediate: true });
watch(() => props.catalog?.project, () => {
  troopPageClipboard.value = null;
  selectedTroopMemberIndex.value = 0;
  troopEditorError.value = '';
});

function fieldLabel(field: RmmvDatabaseFieldSchema): string {
  return databaseFieldLabel(field.path, language.value);
}

function sectionLabel(section: string): string {
  return databaseFieldLabel(section, language.value);
}


function localizedLabel(label: string): string {
  return localizeDatabaseLabel(label, language.value);
}

function localizedOptions(options: ReadonlyArray<SelectOption>): SelectOption[] {
  return localizeDatabaseOptions(options, language.value);
}

function fieldKind(field: RmmvDatabaseFieldSchema): RmmvDatabaseFieldKind {
  return (Array.isArray(field.kind) ? field.kind[0] : field.kind) || 'unknown';
}

function isComplex(field: RmmvDatabaseFieldSchema): boolean {
  const kind = fieldKind(field);
  return kind === 'array' || kind === 'object' || kind === 'unknown';
}

function inputType(field: RmmvDatabaseFieldSchema): string {
  const kind = fieldKind(field);
  return kind === 'integer' || kind === 'number' ? 'number' : 'text';
}

function readPath(path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = record.value;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function writePath(path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return;
  const next = cloneDatabaseEditorRecord(record.value);
  setRecordPath(next, segments, value);
  emit('update:modelValue', next);
}

function writePaths(updates: Array<{ path: string; value: unknown }>): void {
  const next = cloneDatabaseEditorRecord(record.value);
  for (const update of updates) {
    const segments = update.path.split('.').filter(Boolean);
    if (segments.length) setRecordPath(next, segments, update.value);
  }
  emit('update:modelValue', next);
}

function setRecordPath(target: DbRecord, segments: string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (!child || typeof child !== 'object' || Array.isArray(child)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function primitiveValue(field: RmmvDatabaseFieldSchema): string | number | boolean {
  const value = readPath(field.path);
  const kind = fieldKind(field);
  if (kind === 'boolean') return Boolean(value);
  if (kind === 'integer' || kind === 'number') return Number(value ?? 0);
  return String(value ?? '');
}

function updatePrimitive(field: RmmvDatabaseFieldSchema, raw: string | boolean): void {
  const kind = fieldKind(field);
  if (kind === 'boolean') {
    writePath(field.path, Boolean(raw));
    return;
  }
  if (kind === 'integer') {
    writePath(field.path, Number.parseInt(String(raw || '0'), 10));
    return;
  }
  if (kind === 'number') {
    writePath(field.path, Number(raw || 0));
    return;
  }
  writePath(field.path, String(raw));
}

function stringValue(path: string): string {
  return String(readPath(path) ?? '');
}

function numberPathValue(path: string, fallback = 0): number {
  const value = Number(readPath(path) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function jsonText(field: RmmvDatabaseFieldSchema): string {
  const value = readPath(field.path);
  if (value === undefined) return fieldKind(field) === 'array' ? '[]' : '{}';
  return JSON.stringify(value, null, 2);
}

function updateJson(field: RmmvDatabaseFieldSchema, raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    const kind = fieldKind(field);
    if (kind === 'array' && !Array.isArray(parsed)) throw new Error(t('db.mustBeJsonArray'));
    if (kind === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error(t('db.mustBeJsonObject'));
    }
    jsonErrors[field.path] = '';
    writePath(field.path, parsed);
  } catch (error) {
    jsonErrors[field.path] = (error as Error).message;
  }
}

function arrayValue(path: string): unknown[] {
  const value = readPath(path);
  return Array.isArray(value) ? value : [];
}

function objectValue(path: string): DbRecord {
  const value = readPath(path);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DbRecord : {};
}

function arrayRecords(path: string): DbArrayRecord {
  return arrayValue(path).map((entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as DbRecord : {}
  ));
}

function replaceArray(path: string, value: unknown[]): void {
  writePath(path, value);
}

function updateArrayObject(path: string, index: number, key: string, value: unknown): void {
  const next = arrayRecords(path);
  next[index] = { ...next[index], [key]: value };
  writePath(path, next);
}

function updateArrayNumber(path: string, index: number, value: number): void {
  const next = [...arrayValue(path)];
  next[index] = value;
  writePath(path, next);
}

function addArrayObject(path: string, value: DbRecord): void {
  replaceArray(path, [...arrayRecords(path), value]);
}

function removeArrayIndex(path: string, index: number): void {
  replaceArray(path, arrayValue(path).filter((_entry, entryIndex) => entryIndex !== index));
}

function stringListReserveZero(path: string): boolean {
  return stringListHasReservedZero(props.group, path);
}

function isStringListField(field: RmmvDatabaseFieldSchema): boolean {
  return isMvStringListField(props.group, field.path);
}

function stringListValue(path: string): string[] {
  return normalizeStringList(readPath(path), stringListReserveZero(path));
}

function stringListRowLabel(path: string, index: number): string {
  if (stringListReserveZero(path) && index === 0) return t('db.reservedSlot');
  return `#${String(index).padStart(4, '0')}`;
}

function updateStringListItem(path: string, index: number, value: string): void {
  writePath(path, setStringListItem(readPath(path), index, value, stringListReserveZero(path)));
}

function addStringListItem(path: string): void {
  writePath(path, appendStringListItem(readPath(path), stringListReserveZero(path)));
}

function removeStringListItemAt(path: string, index: number): void {
  if (!canRemoveStringListItem(readPath(path), index, stringListReserveZero(path))) return;
  writePath(path, removeStringListItem(readPath(path), index, stringListReserveZero(path)));
}

function canRemoveStringListItemAt(path: string, index: number): boolean {
  return canRemoveStringListItem(readPath(path), index, stringListReserveZero(path));
}

function isTermsArrayField(field: RmmvDatabaseFieldSchema): boolean {
  return props.group === 'Terms' && MV_TERMS_LIST_PATHS.has(field.path);
}

function isTypesListField(field: RmmvDatabaseFieldSchema): boolean {
  return props.group === 'Types' && isMvStringListField(props.group, field.path);
}

function termsArrayValue(path: string): string[] {
  return normalizeTermsArray(readPath(path), path);
}

function termsArrayCellLabel(path: string, index: number): string {
  return localizedTermLabels.value[path]?.[index] || t('sf.itemN', { n: index + 1 });
}

function termsArrayGridClass(path: string): string {
  return path === 'commands' ? 'rmmv-terms-grid--quad' : 'rmmv-terms-grid--pairs';
}

function isTermsMessagesField(field: RmmvDatabaseFieldSchema): boolean {
  return props.group === 'Terms' && field.path === 'messages';
}

function termsMessageEntries(path: string): { key: string; label: string; value: string }[] {
  const messages = objectValue(path);
  return sortedTermsMessageKeys(messages).map((key) => ({
    key,
    label: databaseTermMessageLabel(key, language.value),
    value: String(messages[key] ?? ''),
  }));
}

function updateObjectField(path: string, key: string, value: unknown): void {
  writePath(path, { ...objectValue(path), [key]: value });
}

function numberValue(entry: DbRecord, key: string, fallback = 0): number {
  const value = Number(entry[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function boolValue(entry: DbRecord, key: string): boolean {
  return Boolean(entry[key]);
}

function catalogEntries(key: CatalogKey): NamedCatalogEntry[] {
  const value = props.catalog?.[key];
  return Array.isArray(value)
    ? (value as NamedCatalogEntry[]).filter((entry) => Number.isInteger(entry.id))
    : [];
}

function asOptions(entries: NamedCatalogEntry[], emptyLabel?: string): SelectOption[] {
  const result = entries.map((entry) => ({
    value: entry.id,
    label: `${String(entry.id).padStart(4, '0')} ${entry.name}`,
  }));
  return emptyLabel ? [{ value: 0, label: localizedLabel(emptyLabel) }, ...result] : result;
}

function fixedOptions(options: SelectOption[], emptyLabel?: string): SelectOption[] {
  const localized = localizedOptions(options);
  return emptyLabel ? [{ value: 0, label: localizedLabel(emptyLabel) }, ...localized] : localized;
}

function primitiveOptions(field: RmmvDatabaseFieldSchema): SelectOption[] {
  switch (field.path) {
    case 'classId': return asOptions(catalogEntries('classes'));
    case 'animationId': return asOptions(catalogEntries('animations'), RMMV_NONE_LABEL);
    case 'stypeId': return asOptions(catalogEntries('skillTypes'));
    case 'itypeId': return localizedOptions(ITEM_TYPE_OPTIONS);
    case 'wtypeId':
    case 'requiredWtypeId1':
    case 'requiredWtypeId2':
      return asOptions(catalogEntries('weaponTypes'), RMMV_NONE_LABEL);
    case 'atypeId': return asOptions(catalogEntries('armorTypes'));
    case 'etypeId': return asOptions(catalogEntries('equipTypes'));
    case 'switchId': return asOptions(catalogEntries('switches'), RMMV_NONE_LABEL);
    case 'testTroopId': return asOptions(catalogEntries('troops'), RMMV_NONE_LABEL);
    case 'startMapId':
    case 'editMapId':
      return asOptions(catalogEntries('maps'), RMMV_NONE_LABEL);
    case 'scope': return localizedOptions(SCOPE_OPTIONS);
    case 'occasion': return localizedOptions(OCCASION_OPTIONS);
    case 'hitType': return localizedOptions(HIT_TYPE_OPTIONS);
    case 'trigger': return localizedOptions(TRIGGER_OPTIONS);
    case 'restriction': return localizedOptions(STATE_RESTRICTION_OPTIONS);
    case 'autoRemovalTiming': return localizedOptions(STATE_AUTO_REMOVE_OPTIONS);
    case 'motion': return localizedOptions(STATE_MOTION_OPTIONS);
    case 'overlay': return localizedOptions(STATE_OVERLAY_OPTIONS);
    case 'position': return localizedOptions(ANIMATION_POSITION_OPTIONS);
    case 'displayType': return isMZParticleAnimation.value ? [
      { value: 0, label: t('db.particleDisplayEach') },
      { value: 1, label: t('db.particleDisplayTargets') },
      { value: 2, label: t('db.particleDisplayScreen') },
    ] : [];
    case 'mode': return localizedOptions(TILESET_MODE_OPTIONS);
    default:
      return [];
  }
}

function hasPrimitiveOptions(field: RmmvDatabaseFieldSchema): boolean {
  return primitiveOptions(field).length > 0;
}

function actorProfile(actorId: number) {
  return props.catalog?.battle.actorProfiles.find((profile) => profile.actorId === actorId);
}

function currentActorId(): number {
  return props.group === 'Actors' ? numberPathValue('id') : 0;
}

function actorEquipSlotTypeIds(actorId: number): number[] {
  const profile = actorProfile(actorId);
  if (!profile) return [];
  if (props.group !== 'Actors' || actorId !== currentActorId()) return [...profile.equipSlotTypeIds];
  const actorDualWield = arrayRecords('traits').some((trait) => (
    numberValue(trait, 'code') === 55 && numberValue(trait, 'dataId') === 1
  ));
  const currentClassId = numberPathValue('classId', profile.classId);
  const currentClass = props.catalog?.battle.classProfiles.find((entry) => entry.classId === currentClassId);
  const classDualWield = currentClass?.dualWield ?? (currentClassId === profile.classId && profile.classDualWield);
  const dualWield = actorDualWield || classDualWield;
  const slots = catalogEntries('equipTypes').map((entry) => entry.id);
  if (dualWield && slots.length >= 2) slots[1] = 1;
  return slots;
}

function equipmentRowIndexes(path: string, actorId: number): number[] {
  const count = Math.max(arrayValue(path).length, actorEquipSlotTypeIds(actorId).length);
  return Array.from({ length: count }, (_entry, index) => index);
}

function equipmentOptions(slotIndex: number, actorId = currentActorId()): SelectOption[] {
  const slotTypeId = actorEquipSlotTypeIds(actorId)[slotIndex];
  if (slotTypeId === 1) {
    return fixedOptions([
      { value: 0, label: localizedLabel(RMMV_NONE_LABEL) },
      ...(props.catalog?.weapons || [])
        .filter((entry) => entry.etypeId === slotTypeId)
        .map((entry) => ({ value: entry.id, label: entry.name })),
    ]);
  }
  return fixedOptions([
    { value: 0, label: localizedLabel(RMMV_NONE_LABEL) },
    ...(props.catalog?.armors || [])
      .filter((entry) => entry.etypeId === slotTypeId)
      .map((entry) => ({ value: entry.id, label: entry.name })),
  ]);
}

function isStandardEquipmentSlot(slotIndex: number, actorId = currentActorId()): boolean {
  return slotIndex < actorEquipSlotTypeIds(actorId).length;
}

function equipmentSlotLabel(slotIndex: number, actorId = currentActorId()): string {
  const equipTypeId = actorEquipSlotTypeIds(actorId)[slotIndex];
  const equipType = catalogEntries('equipTypes').find((entry) => entry.id === equipTypeId);
  if (equipType) return `${slotIndex + 1}. ${equipType.name}`;
  return t('db.pluginEquipSlotN', { n: slotIndex + 1 });
}

function pluginEquipmentValue(path: string, slotIndex: number): string {
  return String(arrayValue(path)[slotIndex] ?? 0);
}

function dropTargetOptions(kind: number): SelectOption[] {
  if (kind === 1) return asOptions(catalogEntries('items'));
  if (kind === 2) return asOptions(catalogEntries('weapons'));
  if (kind === 3) return asOptions(catalogEntries('armors'));
  return [];
}

function enemyActionConditionOptions(): SelectOption[] {
  return [
    { value: 0, label: t('db.enemyCondition.always') },
    { value: 1, label: t('db.enemyCondition.turn') },
    { value: 2, label: t('db.enemyCondition.hp') },
    { value: 3, label: t('db.enemyCondition.mp') },
    { value: 4, label: t('db.enemyCondition.state') },
    { value: 5, label: t('db.enemyCondition.partyLevel') },
    { value: 6, label: t('db.enemyCondition.switch') },
  ];
}

function updateEnemyActionConditionType(index: number, conditionType: number): void {
  const next = arrayRecords('actions');
  try {
    next[index] = setEnemyActionConditionType(next[index], conditionType, {
      stateId: catalogEntries('states')[0]?.id,
      switchId: catalogEntries('switches')[0]?.id,
    });
    enemyActionErrors[index] = '';
    writePath('actions', next);
  } catch (error) {
    enemyActionErrors[index] = conditionType === 4
      ? t('db.enemyCondition.noStates')
      : conditionType === 6
        ? t('db.enemyCondition.noSwitches')
        : (error as Error).message;
  }
}

function updateEnemyActionConditionParameter(index: number, parameter: 1 | 2, value: unknown): void {
  const next = arrayRecords('actions');
  next[index] = setEnemyActionConditionParameter(next[index], parameter, value);
  enemyActionErrors[index] = '';
  writePath('actions', next);
}

function updateEnemyActionReference(index: number, value: number): void {
  const next = arrayRecords('actions');
  const action = normalizeEnemyAction(next[index]);
  next[index] = { ...action, conditionParam1: value };
  enemyActionErrors[index] = '';
  writePath('actions', next);
}

function updateEnemyActionRating(index: number, value: unknown): void {
  updateArrayObject('actions', index, 'rating', Math.min(9, Math.max(1, Math.trunc(Number(value) || 1))));
}

function enemyActionConditionType(action: DbRecord): number {
  return normalizeEnemyAction(action).conditionType;
}

function enemyActionPercentage(action: DbRecord, parameter: 1 | 2): number {
  return enemyActionConditionPercentage(action, parameter);
}

function enemyActionValidationMessage(action: DbRecord, index: number): string {
  if (enemyActionErrors[index]) return enemyActionErrors[index];
  const type = enemyActionConditionType(action);
  const rating = numberValue(action, 'rating', 5);
  if (!Number.isInteger(rating) || rating < 1 || rating > 9) return t('db.enemyCondition.ratingRange');
  if (type === 4 && !catalogEntries('states').length) return t('db.enemyCondition.noStates');
  if (type === 6 && !catalogEntries('switches').length) return t('db.enemyCondition.noSwitches');
  if ((type === 2 || type === 3) && numberValue(action, 'conditionParam1') > numberValue(action, 'conditionParam2')) {
    return t('db.enemyCondition.rangeOrder');
  }
  return '';
}

function addTestBattler(path: string): void {
  if (arrayRecords(path).length >= 4) return;
  const used = new Set(arrayRecords(path).map((entry) => numberValue(entry, 'actorId')));
  const actor = catalogEntries('actors').find((entry) => !used.has(entry.id)) || catalogEntries('actors')[0];
  if (!actor) return;
  const profile = actorProfile(actor.id);
  addArrayObject(path, {
    actorId: actor.id,
    level: Math.min(99, Math.max(1, profile?.initialLevel || 1)),
    equips: initialEquipmentForActor(actor.id),
  });
}

function updateTestBattlerActor(path: string, index: number, actorId: number): void {
  const next = arrayRecords(path);
  const profile = actorProfile(actorId);
  next[index] = {
    ...next[index],
    actorId,
    level: Math.min(99, Math.max(1, profile?.initialLevel || 1)),
    equips: initialEquipmentForActor(actorId),
  };
  writePath(path, next);
}

function initialEquipmentForActor(actorId: number): number[] {
  const profile = actorProfile(actorId);
  const equips = [...(profile?.initialEquips || [])];
  while (equips.length < actorEquipSlotTypeIds(actorId).length) equips.push(0);
  return equips;
}

function updateTestBattlerLevel(path: string, index: number, value: unknown): void {
  updateArrayObject(path, index, 'level', Math.min(99, Math.max(1, Math.trunc(Number(value) || 1))));
}

function updateTestBattlerEquip(path: string, battlerIndex: number, slotIndex: number, value: number): void {
  const next = arrayRecords(path);
  const battler = next[battlerIndex] || {};
  const equips = Array.isArray(battler.equips) ? [...battler.equips] : [];
  equips[slotIndex] = value;
  next[battlerIndex] = { ...battler, equips };
  writePath(path, next);
}

function testBattlerEquipRows(battler: DbRecord): number[] {
  const actorId = numberValue(battler, 'actorId');
  const equips = Array.isArray(battler.equips) ? battler.equips : [];
  return Array.from({ length: Math.max(equips.length, actorEquipSlotTypeIds(actorId).length) }, (_entry, index) => index);
}

function testBattlerEquipValue(battler: DbRecord, slotIndex: number): number {
  return Number((Array.isArray(battler.equips) ? battler.equips[slotIndex] : 0) || 0);
}

function updateDamage(key: string, value: unknown): void {
  writePath('damage', { ...objectValue('damage'), [key]: value });
}

function damageElementOptions(): SelectOption[] {
  return fixedOptions([
    { value: -1, label: t('db.normalAttack') },
    ...asOptions(catalogEntries('elements')),
  ]);
}

function commandCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function troopPageSummary(page: DbRecord, index: number): string {
  const active = localizedTroopPageConditionSummary(page.conditions);
  const span = localizedLabel(MV_TROOP_PAGE_SPANS.find((entry) => entry.value === numberValue(page, 'span'))?.label || RMMV_BATTLE_SPAN_LABEL);
  const conditions = active.length ? active.join(' / ') : t('commonEvent.none');
  return t('db.pageSummary', { index: index + 1, span, commands: commandCount(page.list), conditions });
}

function localizedTroopPageConditionSummary(value: unknown): string[] {
  return troopPageConditionSummary(value, language.value);
}

function framesSummary(path: string): string {
  return animationFramesSummary(readPath(path), language.value);
}

function animationFrameCount(path: string): number {
  const frames = readPath(path);
  return Array.isArray(frames) ? frames.length : 0;
}

function invalidArrayItemCount(path: string): number {
  return arrayValue(path).filter((entry) => !entry || typeof entry !== 'object').length;
}

function textValue(path: string, index: number): string {
  return String(arrayValue(path)[index] ?? '');
}

function updateArrayText(path: string, index: number, value: string): void {
  const next = [...arrayValue(path)];
  next[index] = value;
  writePath(path, next);
}

function appendArrayValue(path: string, value: unknown): void {
  writePath(path, [...arrayValue(path), value]);
}

function updateRecord(path: string, key: string, value: unknown): void {
  writePath(path, { ...objectValue(path), [key]: value });
}

function updateNestedRecord(path: string, childKey: string, key: string, value: unknown): void {
  const parent = objectValue(path);
  const child = parent[childKey] && typeof parent[childKey] === 'object' && !Array.isArray(parent[childKey])
    ? parent[childKey] as DbRecord
    : {};
  writePath(path, { ...parent, [childKey]: { ...child, [key]: value } });
}

function audioAssetOptions(kind: 'bgm' | 'bgs' | 'me' | 'se'): Array<{ value: string; label: string }> {
  const assets = props.catalog?.assets[kind] || [];
  return [
    { value: '', label: t('imgPicker.none') },
    ...assets.map((asset) => ({ value: asset.name, label: asset.name })),
  ];
}

async function loadCatalogImage(kind: ImageAssetKind, name: string): Promise<HTMLImageElement | null> {
  if (!name || !props.loadImage) return null;
  const asset = imageAssets(kind).find((entry) => entry.name === name);
  return asset ? props.loadImage(asset.url) : null;
}

function safeLoadImage(url: string): Promise<HTMLImageElement | null> {
  return props.loadImage ? props.loadImage(url) : Promise.resolve(null);
}

function imageAssets(kind: ImageAssetKind): ProjectAssetEntry[] {
  return props.catalog?.assets[kind] || [];
}

function imageValueLabel(name: string): string {
  return name || t('imgPicker.none');
}

function openImagePicker(options: { asset: ImageAssetKind; mode?: ImagePickerMode; title: string; name: string; index?: number }, commit: (selection: ImageSelection) => void): void {
  pendingImageCommit = commit;
  imagePicker.value?.open(options);
}

function commitImageSelection(selection: ImageSelection): void {
  pendingImageCommit?.(selection);
  pendingImageCommit = null;
}

function openActorFacePicker(): void {
  openImagePicker({ asset: 'faces', mode: 'face', title: t('db.chooseFace'), name: stringValue('faceName'), index: numberPathValue('faceIndex') }, (selection) => {
    writePaths([
      { path: 'faceName', value: selection.name },
      { path: 'faceIndex', value: selection.name ? selection.index : 0 },
    ]);
  });
}

function openActorCharacterPicker(): void {
  openImagePicker({ asset: 'characters', mode: 'character', title: t('db.chooseCharacter'), name: stringValue('characterName'), index: numberPathValue('characterIndex') }, (selection) => {
    writePaths([
      { path: 'characterName', value: selection.name },
      { path: 'characterIndex', value: selection.name ? selection.index : 0 },
    ]);
  });
}

function openActorBattlerPicker(): void {
  openSimpleImagePicker('battlerName', 'svActors', t('db.chooseSvBattler'));
}

function openEnemyBattlerPicker(path: string): void {
  openSimpleImagePicker(path, enemyImageAsset.value, t('db.chooseEnemyBattler'));
}

function openSimpleImagePicker(path: string, asset: ImageAssetKind, title: string): void {
  openImagePicker({ asset, mode: 'plain', title, name: String(readPath(path) || '') }, (selection) => {
    writePath(path, selection.name);
  });
}

function openArrayImagePicker(path: string, index: number, asset: ImageAssetKind, title: string): void {
  openImagePicker({ asset, mode: 'plain', title, name: textValue(path, index) }, (selection) => {
    updateArrayText(path, index, selection.name);
  });
}

function openRecordCharacterPicker(path: string): void {
  const current = objectValue(path);
  openImagePicker({
    asset: 'characters',
    mode: 'character',
    title: t('db.chooseImage', { label: fieldLabel({ path, kind: 'object' }) }),
    name: String(current.characterName || ''),
    index: numberValue(current, 'characterIndex'),
  }, (selection) => {
    writePaths([
      { path: `${path}.characterName`, value: selection.name },
      { path: `${path}.characterIndex`, value: selection.name ? selection.index : 0 },
    ]);
  });
}

function systemImageAssetForPath(path: string): ImageAssetKind | null {
  if (path === 'title1Name') return 'titles1';
  if (path === 'title2Name') return 'titles2';
  if (path === 'battleback1Name') return 'battlebacks1';
  if (path === 'battleback2Name') return 'battlebacks2';
  return null;
}

function openIconPicker(): void {
  openImagePicker(
    { asset: 'system', mode: 'icon', title: t('db.chooseIcon'), name: 'IconSet', index: numberPathValue('iconIndex') },
    (selection) => { writePath('iconIndex', selection.index); },
  );
}

const iconPreviewStyle = computed(() => {
  const idx = Math.max(0, Math.floor(numberPathValue('iconIndex')));
  if (idx === 0) return null;
  const iconSetAsset = imageAssets('system').find((a) => a.name === 'IconSet');
  if (!iconSetAsset) return null;
  const cell = 32;
  const col = idx % 16;
  const row = Math.floor(idx / 16);
  return {
    backgroundImage: `url("${iconSetAsset.url.replace(/"/g, '\\"')}")`,
    backgroundSize: `${16 * cell}px auto`,
    backgroundPosition: `-${col * cell}px -${row * cell}px`,
    imageRendering: 'pixelated' as const,
  };
});

function isEnemyBattlerField(field: RmmvDatabaseFieldSchema): boolean {
  return isEnemyEditor.value && field.path === 'battlerName';
}

function clearPreview(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#d7d0c5';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#eee9df';
  const size = 12;
  for (let y = 0; y < canvas.height; y += size) {
    for (let x = (y / size) % 2 ? 0 : size; x < canvas.width; x += size * 2) {
      context.fillRect(x, y, size, size);
    }
  }
  context.imageSmoothingEnabled = false;
  return context;
}

function drawCenteredImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: { sx: number; sy: number; sw: number; sh: number },
  maxScale = 1,
): void {
  const canvas = context.canvas;
  const scale = Math.min(maxScale, (canvas.width - 12) / source.sw, (canvas.height - 12) / source.sh);
  const dw = Math.max(1, Math.floor(source.sw * scale));
  const dh = Math.max(1, Math.floor(source.sh * scale));
  const dx = Math.floor((canvas.width - dw) / 2);
  const dy = Math.floor((canvas.height - dh) / 2);
  context.drawImage(image, source.sx, source.sy, source.sw, source.sh, dx, dy, dw, dh);
}

async function paintActorImagePreviews(): Promise<void> {
  await Promise.all([
    paintFacePreview(),
    paintCharacterPreview(),
    paintBattlerPreview(),
  ]);
}

async function paintFacePreview(): Promise<void> {
  const context = clearPreview(facePreviewCanvas.value);
  if (!context) return;
  const image = await loadCatalogImage('faces', stringValue('faceName'));
  if (!image) return;
  drawCenteredImage(context, image, mvFaceSourceRect(numberPathValue('faceIndex'), props.catalog?.faceSize));
}

async function paintCharacterPreview(): Promise<void> {
  const context = clearPreview(characterPreviewCanvas.value);
  if (!context) return;
  const characterName = stringValue('characterName');
  const image = await loadCatalogImage('characters', characterName);
  if (!image) return;
  const eventImage: MvEventImage = {
    tileId: 0,
    characterName,
    characterIndex: numberPathValue('characterIndex'),
    direction: 2,
    pattern: 1,
  };
  const frame = eventCharacterFrame(image, eventImage);
  if (!frame) return;
  drawCenteredImage(context, image, frame, 2);
}

async function paintBattlerPreview(): Promise<void> {
  const context = clearPreview(battlerPreviewCanvas.value);
  if (!context) return;
  const image = await loadCatalogImage('svActors', stringValue('battlerName'));
  if (!image) return;
  const sw = image.naturalWidth / 9;
  const sh = image.naturalHeight / 6;
  if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0) {
    drawCenteredImage(context, image, { sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight });
    return;
  }
  drawCenteredImage(context, image, { sx: sw, sy: 0, sw, sh }, 2);
}

async function paintEnemyBattlerPreview(): Promise<void> {
  const context = clearPreview(enemyBattlerPreviewCanvas.value);
  if (!context) return;
  const image = await loadCatalogImage(enemyImageAsset.value, stringValue('battlerName'));
  if (!image) return;
  drawCenteredImage(context, image, { sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight });
}

function audioKindForPath(path: string): 'bgm' | 'bgs' | 'me' | 'se' {
  if (path === 'victoryMe' || path === 'defeatMe' || path === 'gameoverMe') return 'me';
  return 'bgm';
}

function updateTermsArray(section: string, index: number, value: string): void {
  const terms = objectValue('terms');
  const next = Array.isArray(terms[section]) ? [...terms[section] as unknown[]] : [];
  next[index] = value;
  writePath('terms', { ...terms, [section]: next });
}

function updateTermMessage(key: string, value: string): void {
  const terms = objectValue('terms');
  const messages = terms.messages && typeof terms.messages === 'object' && !Array.isArray(terms.messages)
    ? terms.messages as DbRecord
    : {};
  writePath('terms', { ...terms, messages: { ...messages, [key]: value } });
}

function updateMessagesRecord(key: string, value: string): void {
  writePath('messages', { ...objectValue('messages'), [key]: value });
}

function troopPageConditions(page: DbRecord) {
  return normalizeTroopPageConditions(page.conditions);
}

function updateTroopPageSpan(index: number, value: number): void {
  const next = arrayRecords('pages');
  next[index] = setTroopPageSpan(next[index], value);
  writePath('pages', next);
}

function updateTroopPageCondition(index: number, key: Parameters<typeof setTroopPageCondition>[1], value: unknown): void {
  const next = arrayRecords('pages');
  next[index] = setTroopPageCondition(next[index], key, value);
  writePath('pages', next);
}

function updateTroopPageCommands(index: number, list: MvCommand[]): void {
  const next = arrayRecords('pages');
  next[index] = { ...next[index], list };
  writePath('pages', next);
}

function addTroopPage(): void {
  appendArrayValue('pages', standardBlankTroopPage());
}

function copyTroopPage(index: number): void {
  const page = arrayRecords('pages')[index];
  troopPageClipboard.value = page ? cloneDatabaseEditorRecord(page) : null;
}

function pasteTroopPage(index?: number): void {
  if (!troopPageClipboard.value) return;
  const next = arrayRecords('pages');
  const copy = cloneDatabaseEditorRecord(troopPageClipboard.value);
  if (index === undefined || index < 0 || index >= next.length) next.push(copy);
  else next[index] = copy;
  writePath('pages', next);
}

function clearTroopPage(index: number): void {
  const next = arrayRecords('pages');
  if (!next[index]) return;
  next[index] = standardBlankTroopPage();
  writePath('pages', next);
}

function addTroopMember(): void {
  const members = normalizeTroopMembers(readPath('members'));
  if (members.length >= 8) return;
  const enemyId = catalogEntries('enemies')[0]?.id;
  if (!enemyId) {
    troopEditorError.value = t('db.troopNoEnemies');
    return;
  }
  troopEditorError.value = '';
  selectedTroopMemberIndex.value = members.length;
  writePath('members', [...members, { enemyId, x: 408, y: 436, hidden: false }]);
}

function removeTroopMember(index: number): void {
  const members = normalizeTroopMembers(readPath('members')).filter((_entry, entryIndex) => entryIndex !== index);
  selectedTroopMemberIndex.value = Math.min(selectedTroopMemberIndex.value, Math.max(0, members.length - 1));
  writePath('members', members);
}

function clearTroopMembers(): void {
  selectedTroopMemberIndex.value = 0;
  writePath('members', []);
}

function alignCurrentTroop(): void {
  writePath('members', alignTroopMembers(readPath('members')));
}

function autoNameCurrentTroop(): void {
  try {
    writePath('name', autoNameTroop(readPath('members'), props.catalog?.enemies || []));
    troopEditorError.value = '';
  } catch {
    troopEditorError.value = t('db.troopAutoNameMissingReference');
  }
}

function updateTroopMembers(value: unknown[]): void {
  writePath('members', normalizeTroopMembers(value));
}

function updateTroopMember(index: number, key: 'enemyId' | 'x' | 'y' | 'hidden', value: unknown): void {
  const members = normalizeTroopMembers(readPath('members'));
  const current = members[index];
  if (!current) return;
  members[index] = {
    ...current,
    [key]: key === 'hidden'
      ? Boolean(value)
      : key === 'enemyId'
        ? Math.max(1, Math.trunc(Number(value) || 1))
        : Math.min(key === 'x' ? projectScreenWidth.value : projectScreenHeight.value, Math.max(0, Math.trunc(Number(value) || 0))),
  };
  writePath('members', members);
}

function troopEnemyIndexOptions(): SelectOption[] {
  const members = arrayRecords('members');
  if (!members.length) return [{ value: 0, label: t('db.enemySlot1') }];
  return members.map((member, index) => {
    const enemyId = numberValue(member, 'enemyId');
    const enemy = catalogEntries('enemies').find((entry) => entry.id === enemyId);
    return { value: index, label: `#${index + 1} ${enemy?.name || t('db.enemyN', { id: enemyId })}` };
  });
}

function animationTimings(path: string) {
  return normalizeAnimationTimings(readPath(path));
}

function addAnimationTiming(path: string): void {
  writePath(path, appendAnimationTiming(readPath(path)));
}

function removeAnimationTiming(path: string, index: number): void {
  writePath(path, removeAnimationTimingValue(readPath(path), index));
}

function updateAnimationTiming(path: string, index: number, key: Parameters<typeof setAnimationTimingValue>[2], value: unknown): void {
  writePath(path, setAnimationTimingValue(readPath(path), index, key, value));
}

function updateAnimationTimingSe(path: string, index: number, key: Parameters<typeof setAnimationTimingSeValue>[2], value: unknown): void {
  writePath(path, setAnimationTimingSeValue(readPath(path), index, key, value));
}

function updateAnimationTimingFlash(path: string, index: number, colorIndex: number, value: unknown): void {
  writePath(path, setAnimationTimingFlashColor(readPath(path), index, colorIndex, value));
}

function particleRotation() {
  return normalizeMzAnimationRotation(readPath('rotation'));
}

function updateParticleRotation(axis: 'x' | 'y' | 'z', value: unknown): void {
  writePath('rotation', setMzAnimationRotationAxis(readPath('rotation'), axis, value));
}

function particleFlashTimings(path: string) {
  return normalizeMzAnimationFlashTimings(readPath(path));
}

function addParticleFlashTiming(path: string): void {
  writePath(path, appendMzAnimationFlashTiming(readPath(path)));
}

function deleteParticleFlashTiming(path: string, index: number): void {
  writePath(path, removeMzAnimationFlashTiming(readPath(path), index));
}

function updateParticleFlashTiming(path: string, index: number, key: 'frame' | 'duration', value: unknown): void {
  writePath(path, setMzAnimationFlashTimingValue(readPath(path), index, key, value));
}

function updateParticleFlashColor(path: string, index: number, colorIndex: number, value: unknown): void {
  writePath(path, setMzAnimationFlashTimingColor(readPath(path), index, colorIndex, value));
}

function particleSoundTimings(path: string) {
  return normalizeMzAnimationSoundTimings(readPath(path));
}

function addParticleSoundTiming(path: string): void {
  writePath(path, appendMzAnimationSoundTiming(readPath(path)));
}

function deleteParticleSoundTiming(path: string, index: number): void {
  writePath(path, removeMzAnimationSoundTiming(readPath(path), index));
}

function updateParticleSoundFrame(path: string, index: number, value: unknown): void {
  writePath(path, setMzAnimationSoundTimingFrame(readPath(path), index, value));
}

function updateParticleSoundSe(
  path: string,
  index: number,
  key: 'name' | 'volume' | 'pitch' | 'pan',
  value: unknown,
): void {
  writePath(path, setMzAnimationSoundTimingSeValue(readPath(path), index, key, value));
}

function updateSound(index: number, key: string, value: unknown): void {
  updateArrayObject('sounds', index, key, value);
}
</script>

<template>
  <div class="db-editor db-editor--compact" :class="{ 'db-editor--actors-rm': isActorImageEditor }">
    <section v-if="schemaDriven && isActorImageEditor" class="editor-section actor-rm-section">
      <div class="actor-rm-grid">
        <div class="actor-rm-left">
          <div class="rm-panel">
            <div class="rm-panel-title">{{ t('commonEvent.basicSettings') }}</div>
            <div class="rm-rows">
              <label v-for="field in actorBasicScalarFields" :key="field.path" class="rm-row">
                <span>{{ fieldLabel(field) }}</span>
                <select
                  v-if="hasPrimitiveOptions(field)"
                  :value="Number(primitiveValue(field))"
                  :disabled="field.path === 'id'"
                  @change="updatePrimitive(field, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="option in primitiveOptions(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input
                  v-else
                  :type="inputType(field)"
                  :value="primitiveValue(field)"
                  :disabled="field.path === 'id'"
                  @input="updatePrimitive(field, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <label v-if="actorProfileField" class="rm-row rm-row-multiline">
                <span>{{ fieldLabel(actorProfileField) }}</span>
                <textarea
                  :value="String(primitiveValue(actorProfileField))"
                  rows="2"
                  @input="updatePrimitive(actorProfileField, ($event.target as HTMLTextAreaElement).value)"
                />
              </label>
            </div>
          </div>

          <div class="rm-panel">
            <div class="rm-panel-title">{{ t('db.images') }}</div>
            <div class="rm-image-row">
              <button type="button" class="rm-image-slot" @click="openActorFacePicker">
                <span>{{ t('db.faceGraphic') }}</span>
                <canvas ref="facePreviewCanvas" width="48" height="48" />
                <small>{{ imageValueLabel(stringValue('faceName')) }}</small>
              </button>
              <button type="button" class="rm-image-slot" @click="openActorCharacterPicker">
                <span>{{ t('db.characterSprite') }}</span>
                <canvas ref="characterPreviewCanvas" width="48" height="48" />
                <small>{{ imageValueLabel(stringValue('characterName')) }}</small>
              </button>
              <button type="button" class="rm-image-slot" @click="openActorBattlerPicker">
                <span>{{ t('db.svBattlerGraphic') }}</span>
                <canvas ref="battlerPreviewCanvas" width="64" height="48" />
                <small>{{ imageValueLabel(stringValue('battlerName')) }}</small>
              </button>
            </div>
          </div>

          <div v-if="actorEquipsField" class="rm-panel">
            <div class="rm-panel-head">
              <div class="rm-panel-title">{{ fieldLabel(actorEquipsField) }}</div>
            </div>
            <div v-if="!equipmentRowIndexes(actorEquipsField.path, currentActorId()).length" class="empty-note">{{ t('db.noEquipSlots') }}</div>
            <table v-else class="rm-equip-table">
              <tbody>
                <tr v-for="index in equipmentRowIndexes(actorEquipsField.path, currentActorId())" :key="`actor-equip-${index}`">
                  <th scope="row">{{ equipmentSlotLabel(index, currentActorId()) }}</th>
                  <td>
                    <select v-if="isStandardEquipmentSlot(index, currentActorId())" :value="Number(arrayValue(actorEquipsField.path)[index] || 0)" @change="updateArrayNumber(actorEquipsField.path, index, Number(($event.target as HTMLSelectElement).value))">
                      <option v-for="option in equipmentOptions(index, currentActorId())" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <span v-else class="plugin-slot-value">{{ pluginEquipmentValue(actorEquipsField.path, index) }}</span>
                  </td>
                  <td class="rm-equip-actions"><small v-if="!isStandardEquipmentSlot(index, currentActorId())">{{ t('db.pluginEquipSlotReadonly') }}</small></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="actorTraitsField" class="actor-rm-right">
          <div class="rm-panel rm-panel-fill">
            <div class="rm-panel-head">
              <div class="rm-panel-title">{{ fieldLabel(actorTraitsField) }}</div>
            </div>
            <DatabaseTraitEditor
              :model-value="arrayValue(actorTraitsField.path)"
              :catalog="catalog"
              compact
              @update:model-value="writePath(actorTraitsField.path, $event)"
            />
          </div>
        </div>
      </div>

      <label v-if="actorNoteField" class="rm-note">
        <span>{{ fieldLabel(actorNoteField) }}</span>
        <textarea
          :value="String(primitiveValue(actorNoteField))"
          rows="2"
          @input="updatePrimitive(actorNoteField, ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
    </section>

    <section v-else-if="schemaDriven" class="editor-section">
      <div class="section-title">
        <strong>{{ t('db.groupFields', { group: groupLabel }) }}</strong>
        <span>{{ schema?.fileName }} · {{ schema?.isArrayTable ? t('db.arrayTable') : t('db.documentTable') }}</span>
      </div>
      <section v-if="isActorImageEditor" class="actor-image-editor">
        <div class="complex-title">
          <span>{{ t('db.images') }}</span>
        </div>
        <div class="actor-image-grid">
          <article class="actor-image-card">
            <span>{{ t('db.faceGraphic') }}</span>
            <button type="button" class="image-picker-card" @click="openActorFacePicker">
              <canvas ref="facePreviewCanvas" width="96" height="96" />
              <small>{{ imageValueLabel(stringValue('faceName')) }}</small>
            </button>
          </article>
          <article class="actor-image-card">
            <span>{{ t('db.characterSprite') }}</span>
            <button type="button" class="image-picker-card" @click="openActorCharacterPicker">
              <canvas ref="characterPreviewCanvas" width="96" height="96" />
              <small>{{ imageValueLabel(stringValue('characterName')) }}</small>
            </button>
          </article>
          <article class="actor-image-card">
            <span>{{ t('db.svBattlerGraphic') }}</span>
            <button type="button" class="image-picker-card" @click="openActorBattlerPicker">
              <canvas ref="battlerPreviewCanvas" width="128" height="96" />
              <small>{{ imageValueLabel(stringValue('battlerName')) }}</small>
            </button>
          </article>
        </div>
      </section>
      <div class="field-grid">
        <template v-for="field in visibleSchemaFields" :key="field.path">
          <section v-if="isTermsArrayField(field)" class="field full complex-editor rmmv-terms-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
            </div>
            <div class="rmmv-terms-grid" :class="termsArrayGridClass(field.path)">
              <div
                v-for="(_entry, index) in termsArrayValue(field.path)"
                :key="`${field.path}-${index}`"
                class="rmmv-terms-cell"
              >
                <label>
                  <span>{{ termsArrayCellLabel(field.path, index) }}</span>
                  <input
                    :value="termsArrayValue(field.path)[index]"
                    @input="updateStringListItem(field.path, index, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
            </div>
          </section>

          <section v-else-if="isTypesListField(field)" class="field full complex-editor rmmv-type-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addStringListItem(field.path)">{{ t('cmdList.add') }}</button>
            </div>
            <small v-if="stringListReserveZero(field.path)">{{ t('db.slot0Reserved') }}</small>
            <div v-if="!stringListValue(field.path).length" class="empty-note">{{ t('db.noEntries') }}</div>
            <div class="rmmv-type-name-list">
              <div
                v-for="(entry, index) in stringListValue(field.path)"
                :key="`${field.path}-${index}`"
                class="rmmv-type-row"
              >
                <span class="rmmv-type-id">{{ stringListRowLabel(field.path, index) }}</span>
                <input
                  type="text"
                  class="rmmv-type-input"
                  :value="entry"
                  :disabled="stringListReserveZero(field.path) && index === 0"
                  @input="updateStringListItem(field.path, index, ($event.target as HTMLInputElement).value)"
                />
                <button
                  v-if="canRemoveStringListItemAt(field.path, index)"
                  type="button"
                  class="danger rmmv-type-delete"
                  @click="removeStringListItemAt(field.path, index)"
                >
                  {{ t('cmdList.delete') }}
                </button>
                <span v-else class="rmmv-type-delete-placeholder" aria-hidden="true" />
              </div>
            </div>
          </section>

          <section v-else-if="isStringListField(field)" class="field full complex-editor string-list-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addStringListItem(field.path)">{{ t('cmdList.add') }}</button>
            </div>
            <small v-if="stringListReserveZero(field.path)">{{ t('db.slot0Reserved') }}</small>
            <div v-if="!stringListValue(field.path).length" class="empty-note">{{ t('db.noEntries') }}</div>
            <div v-for="(entry, index) in stringListValue(field.path)" :key="`${field.path}-${index}`" class="complex-row string-list-row">
              <label>
                <span>{{ stringListRowLabel(field.path, index) }}</span>
                <input
                  :value="entry"
                  :disabled="stringListReserveZero(field.path) && index === 0"
                  @input="updateStringListItem(field.path, index, ($event.target as HTMLInputElement).value)"
                />
              </label>
              <button
                v-if="canRemoveStringListItemAt(field.path, index)"
                type="button"
                class="danger"
                @click="removeStringListItemAt(field.path, index)"
              >
                {{ t('cmdList.delete') }}
              </button>
              <span v-else class="rmmv-type-delete-placeholder" aria-hidden="true" />
            </div>
          </section>

          <section v-else-if="isTermsMessagesField(field)" class="field full complex-editor terms-message-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.messageTemplateCount', { count: termsMessageEntries(field.path).length }) }}</small>
            </div>
            <div v-if="!termsMessageEntries(field.path).length" class="empty-note">{{ t('db.noMessageTemplates') }}</div>
            <div v-else class="rmmv-terms-messages-scroll">
              <table class="rmmv-terms-messages-table">
                <thead>
                  <tr>
                    <th>{{ t('db.messageTypeCol') }}</th>
                    <th>{{ t('db.messageTextCol') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="message in termsMessageEntries(field.path)" :key="message.key">
                    <td class="rmmv-terms-messages-type">
                      <span>{{ message.label }}</span>
                      <small>{{ message.key }}</small>
                    </td>
                    <td>
                      <input
                        :value="message.value"
                        @input="updateObjectField(field.path, message.key, ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <details class="advanced-json">
              <summary>{{ t('db.advancedJson') }}</summary>
              <textarea :value="jsonText(field)" rows="7" spellcheck="false" @input="updateJson(field, ($event.target as HTMLTextAreaElement).value)" />
              <em v-if="jsonErrors[field.path]">{{ jsonErrors[field.path] }}</em>
            </details>
          </section>

          <section v-else-if="isEnemyBattlerField(field)" class="field full complex-editor image-field-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <button type="button" class="image-picker-card enemy-battler-card" @click="openEnemyBattlerPicker(field.path)">
              <canvas ref="enemyBattlerPreviewCanvas" width="180" height="140" />
              <small>{{ imageValueLabel(stringValue(field.path)) }}</small>
            </button>
          </section>

          <section v-else-if="field.path === 'traits'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <DatabaseTraitEditor
              :model-value="arrayValue(field.path)"
              :catalog="catalog"
              @update:model-value="writePath(field.path, $event)"
            />
          </section>

          <section v-else-if="field.path === 'effects'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <DatabaseEffectEditor
              :model-value="arrayValue(field.path)"
              :catalog="catalog"
              @update:model-value="writePath(field.path, $event)"
            />
          </section>

          <section v-else-if="field.path === 'equips'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
            </div>
            <div v-if="!equipmentRowIndexes(field.path, currentActorId()).length" class="empty-note">{{ t('db.noEquipSlots') }}</div>
            <div v-for="index in equipmentRowIndexes(field.path, currentActorId())" :key="`equip-${index}`" class="complex-row compact-row">
              <label>
                <span>{{ equipmentSlotLabel(index, currentActorId()) }}</span>
                <select v-if="isStandardEquipmentSlot(index, currentActorId())" :value="Number(arrayValue(field.path)[index] || 0)" @change="updateArrayNumber(field.path, index, Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in equipmentOptions(index, currentActorId())" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <span v-else class="plugin-slot-value">{{ pluginEquipmentValue(field.path, index) }} · {{ t('db.pluginEquipSlotReadonly') }}</span>
              </label>
            </div>
            <small>{{ t('db.fixedEquipSlotNote') }}</small>
          </section>

          <section v-else-if="field.path === 'learnings'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { level: 1, skillId: catalogEntries('skills')[0]?.id || 1, note: '' })">{{ t('cmdList.add') }}</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noLearnedSkills') }}</div>
            <div v-for="(learning, index) in arrayRecords(field.path)" :key="`learning-${index}`" class="complex-row learning-row">
              <label>
                <span>{{ t('db.level') }}</span>
                <input type="number" :value="numberValue(learning, 'level', 1)" @input="updateArrayObject(field.path, index, 'level', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label>
                <span>{{ t('db.skill') }}</span>
                <select :value="numberValue(learning, 'skillId')" @change="updateArrayObject(field.path, index, 'skillId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('skills'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">{{ t('cmdList.delete') }}</button>
            </div>
          </section>

          <section v-else-if="field.path === 'actions'" class="field full complex-editor stacked-complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { skillId: catalogEntries('skills')[0]?.id || 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 })">{{ t('cmdList.add') }}</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noActions') }}</div>
            <div v-for="(action, index) in arrayRecords(field.path)" :key="`action-${index}`" class="complex-row action-row semantic-action-row">
              <label>
                <span>{{ t('db.skill') }}</span>
                <select :value="numberValue(action, 'skillId')" @change="updateArrayObject(field.path, index, 'skillId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('skills'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>{{ t('db.conditionType') }}</span>
                <select
                  v-if="isStandardEnemyActionConditionType(enemyActionConditionType(action))"
                  :value="enemyActionConditionType(action)"
                  @change="updateEnemyActionConditionType(index, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="option in enemyActionConditionOptions()" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input v-else type="number" :value="enemyActionConditionType(action)" readonly />
              </label>
              <div v-if="isStandardEnemyActionConditionType(enemyActionConditionType(action))" class="action-condition-fields">
                <template v-if="enemyActionConditionType(action) === 1">
                  <label><span>{{ t('db.enemyCondition.turnA') }}</span><input type="number" min="0" :value="numberValue(action, 'conditionParam1')" @input="updateEnemyActionConditionParameter(index, 1, ($event.target as HTMLInputElement).value)" /></label>
                  <label><span>{{ t('db.enemyCondition.turnB') }}</span><input type="number" min="0" :value="numberValue(action, 'conditionParam2')" @input="updateEnemyActionConditionParameter(index, 2, ($event.target as HTMLInputElement).value)" /></label>
                </template>
                <template v-else-if="enemyActionConditionType(action) === 2 || enemyActionConditionType(action) === 3">
                  <label><span>{{ t('db.enemyCondition.minimum') }}</span><input type="number" min="0" max="100" :value="enemyActionPercentage(action, 1)" @input="updateEnemyActionConditionParameter(index, 1, ($event.target as HTMLInputElement).value)" /></label>
                  <label><span>{{ t('db.enemyCondition.maximum') }}</span><input type="number" min="0" max="100" :value="enemyActionPercentage(action, 2)" @input="updateEnemyActionConditionParameter(index, 2, ($event.target as HTMLInputElement).value)" /></label>
                </template>
                <label v-else-if="enemyActionConditionType(action) === 4">
                  <span>{{ t('db.enemyCondition.state') }}</span>
                  <select :value="numberValue(action, 'conditionParam1')" @change="updateEnemyActionReference(index, Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('states'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label v-else-if="enemyActionConditionType(action) === 5"><span>{{ t('db.enemyCondition.partyLevel') }}</span><input type="number" min="1" max="99" :value="numberValue(action, 'conditionParam1', 1)" @input="updateEnemyActionConditionParameter(index, 1, ($event.target as HTMLInputElement).value)" /></label>
                <label v-else-if="enemyActionConditionType(action) === 6">
                  <span>{{ t('db.enemyCondition.switch') }}</span>
                  <select :value="numberValue(action, 'conditionParam1')" @change="updateEnemyActionReference(index, Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('switches'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <span v-else class="action-always-note">{{ t('db.enemyCondition.noParameters') }}</span>
              </div>
              <div v-else class="plugin-condition-note">{{ t('db.enemyCondition.pluginReadonly', { code: enemyActionConditionType(action) }) }}</div>
              <label><span>{{ t('eventEditorDialog.priority') }}</span><input type="number" min="1" max="9" :value="numberValue(action, 'rating', 5)" @input="updateEnemyActionRating(index, ($event.target as HTMLInputElement).value)" /></label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">{{ t('cmdList.delete') }}</button>
              <em v-if="enemyActionValidationMessage(action, index)" class="action-condition-error">{{ enemyActionValidationMessage(action, index) }}</em>
            </div>
          </section>

          <section v-else-if="field.path === 'dropItems'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { kind: 1, dataId: catalogEntries('items')[0]?.id || 1, denominator: 1 })">{{ t('cmdList.add') }}</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noDrops') }}</div>
            <div v-for="(drop, index) in arrayRecords(field.path)" :key="`drop-${index}`" class="complex-row drop-row">
              <label>
                <span>{{ t('eventEditorDialog.type') }}</span>
                <select :value="numberValue(drop, 'kind')" @change="updateArrayObject(field.path, index, 'kind', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in localizedOptions(DROP_KIND_OPTIONS)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>{{ t('db.target') }}</span>
                <select
                  v-if="dropTargetOptions(numberValue(drop, 'kind')).length"
                  :value="numberValue(drop, 'dataId')"
                  @change="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="option in dropTargetOptions(numberValue(drop, 'kind'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input v-else type="number" :value="numberValue(drop, 'dataId')" @input="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label><span>{{ t('db.denominator') }}</span><input type="number" :value="numberValue(drop, 'denominator', 1)" @input="updateArrayObject(field.path, index, 'denominator', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">{{ t('cmdList.delete') }}</button>
            </div>
          </section>

          <section v-else-if="field.path === 'members'" class="field full complex-editor stacked-complex-editor troop-formation-editor">
            <div class="complex-title troop-formation-head">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.troopMemberLimit', { count: arrayRecords(field.path).length }) }}</small>
              <button type="button" :disabled="arrayRecords(field.path).length >= 8" @click="addTroopMember">{{ t('cmdList.add') }}</button>
              <button type="button" :disabled="!arrayRecords(field.path).length" @click="clearTroopMembers">{{ t('db.clearAll') }}</button>
              <button type="button" :disabled="!arrayRecords(field.path).length" @click="alignCurrentTroop">{{ t('db.alignTroop') }}</button>
              <button type="button" :disabled="!arrayRecords(field.path).length" @click="autoNameCurrentTroop">{{ t('db.autoNameTroop') }}</button>
              <button type="button" class="battle-test-button" data-ui-id="database-battle-test-open" :disabled="arrayRecords(field.path).length > 8" @click="emit('requestBattleTest')">{{ t('db.battleTest') }}</button>
            </div>
            <div class="battleback-controls">
              <label>
                <span>{{ t('db.battleback1') }}</span>
                <select :value="activeBattleback1Name" @change="emit('update:battleback1Name', ($event.target as HTMLSelectElement).value)">
                  <option value="">{{ t('imgPicker.none') }}</option>
                  <option v-for="asset in catalog?.assets.battlebacks1 || []" :key="asset.name" :value="asset.name">{{ asset.name }}</option>
                </select>
              </label>
              <label>
                <span>{{ t('db.battleback2') }}</span>
                <select :value="activeBattleback2Name" @change="emit('update:battleback2Name', ($event.target as HTMLSelectElement).value)">
                  <option value="">{{ t('imgPicker.none') }}</option>
                  <option v-for="asset in catalog?.assets.battlebacks2 || []" :key="asset.name" :value="asset.name">{{ asset.name }}</option>
                </select>
              </label>
            </div>
            <div class="troop-formation-layout">
              <TroopFormationCanvas
                :model-value="arrayValue(field.path)"
                :catalog="catalog"
                :battleback1-name="activeBattleback1Name"
                :battleback2-name="activeBattleback2Name"
                :selected-index="selectedTroopMemberIndex"
                :load-image="loadImage"
                @update:model-value="updateTroopMembers"
                @update:selected-index="selectedTroopMemberIndex = $event"
              />
              <div class="troop-member-list">
                <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noTroopMembers') }}</div>
                <button
                  v-for="(member, index) in arrayRecords(field.path)"
                  :key="`member-select-${index}`"
                  type="button"
                  class="troop-member-select"
                  :class="{ active: selectedTroopMemberIndex === index }"
                  @click="selectedTroopMemberIndex = index"
                >
                  <b>#{{ index + 1 }}</b>
                  <span>{{ catalog?.enemies.find((entry) => entry.id === numberValue(member, 'enemyId'))?.name || t('db.enemyN', { id: numberValue(member, 'enemyId') }) }}</span>
                  <small>{{ numberValue(member, 'x') }}, {{ numberValue(member, 'y') }}<template v-if="boolValue(member, 'hidden')"> · {{ t('db.hidden') }}</template></small>
                </button>
              </div>
            </div>
            <div v-if="arrayRecords(field.path)[selectedTroopMemberIndex]" class="complex-row member-row troop-selected-member">
              <label>
                <span>{{ t('db.enemy') }}</span>
                <select :value="numberValue(arrayRecords(field.path)[selectedTroopMemberIndex], 'enemyId')" @change="updateTroopMember(selectedTroopMemberIndex, 'enemyId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('enemies'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>X</span><input type="number" min="0" :max="projectScreenWidth" :value="numberValue(arrayRecords(field.path)[selectedTroopMemberIndex], 'x')" @input="updateTroopMember(selectedTroopMemberIndex, 'x', ($event.target as HTMLInputElement).value)" /></label>
              <label><span>Y</span><input type="number" min="0" :max="projectScreenHeight" :value="numberValue(arrayRecords(field.path)[selectedTroopMemberIndex], 'y')" @input="updateTroopMember(selectedTroopMemberIndex, 'y', ($event.target as HTMLInputElement).value)" /></label>
              <label class="inline-check"><input type="checkbox" :checked="boolValue(arrayRecords(field.path)[selectedTroopMemberIndex], 'hidden')" @change="updateTroopMember(selectedTroopMemberIndex, 'hidden', ($event.target as HTMLInputElement).checked)" /> {{ t('db.hidden') }}</label>
              <button type="button" class="danger" @click="removeTroopMember(selectedTroopMemberIndex)">{{ t('cmdList.delete') }}</button>
            </div>
            <em v-if="troopEditorError" class="action-condition-error">{{ troopEditorError }}</em>
          </section>

          <section v-else-if="field.path === 'damage'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.damageFormulaNote') }}</small>
            </div>
            <div class="complex-row damage-row">
              <label>
                <span>{{ t('eventEditorDialog.type') }}</span>
                <select :value="Number(objectValue(field.path).type || 0)" @change="updateDamage('type', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in localizedOptions(DAMAGE_TYPE_OPTIONS)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>{{ t('db.element') }}</span>
                <select :value="Number(objectValue(field.path).elementId ?? -1)" @change="updateDamage('elementId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in damageElementOptions()" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label class="wide"><span>{{ t('db.formula') }}</span><input :value="String(objectValue(field.path).formula || '')" @input="updateDamage('formula', ($event.target as HTMLInputElement).value)" /></label>
              <label><span>{{ t('db.variance') }}</span><input type="number" :value="Number(objectValue(field.path).variance || 0)" @input="updateDamage('variance', Number(($event.target as HTMLInputElement).value))" /></label>
              <label class="inline-check"><input type="checkbox" :checked="Boolean(objectValue(field.path).critical)" @change="updateDamage('critical', ($event.target as HTMLInputElement).checked)" /> {{ t('db.critical') }}</label>
            </div>
          </section>

          <section v-else-if="field.path === 'params' && group === 'Classes'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.paramCurveNote') }}</small>
            </div>
            <ClassParameterCurveEditor
              :model-value="readPath(field.path)"
              @update:model-value="writePath(field.path, $event)"
            />
          </section>

          <section v-else-if="field.path === 'params'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row param-row">
              <label v-for="param in localizedParamOptions" :key="param.value">
                <span>{{ param.label }}</span>
                <input type="number" :value="Number(arrayValue(field.path)[param.value] || 0)" @input="updateArrayNumber(field.path, param.value, Number(($event.target as HTMLInputElement).value))" />
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'expParams' || field.path === 'windowTone'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="appendArrayValue(field.path, 0)">{{ t('cmdList.add') }}</button>
            </div>
            <div class="complex-row param-row">
              <label v-for="(_item, index) in arrayValue(field.path)" :key="`${field.path}-${index}`">
                <span>{{ field.path === 'windowTone' ? (localizedToneLabels[index] || t('db.toneN', { n: index + 1 })) : t('db.paramN', { n: index + 1 }) }}</span>
                <input type="number" :value="Number(arrayValue(field.path)[index] || 0)" @input="updateArrayNumber(field.path, index, Number(($event.target as HTMLInputElement).value))" />
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'partyMembers'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="appendArrayValue(field.path, catalogEntries('actors')[0]?.id || 1)">{{ t('cmdList.add') }}</button>
            </div>
            <div v-if="!arrayValue(field.path).length" class="empty-note">{{ t('db.noPartyMembers') }}</div>
            <div v-for="(_member, index) in arrayValue(field.path)" :key="`party-${index}`" class="complex-row compact-row">
              <label>
                <span>{{ t('db.memberN', { n: index + 1 }) }}</span>
                <select :value="Number(arrayValue(field.path)[index] || 0)" @change="updateArrayNumber(field.path, index, Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('actors'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">{{ t('cmdList.delete') }}</button>
            </div>
          </section>

          <section v-else-if="field.path === 'testBattlers'" class="field full complex-editor stacked-complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.testBattlerLimit', { count: arrayRecords(field.path).length }) }}</small>
              <button type="button" :disabled="arrayRecords(field.path).length >= 4 || !catalogEntries('actors').length" @click="addTestBattler(field.path)">{{ t('cmdList.add') }}</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noTestBattlers') }}</div>
            <article v-for="(battler, index) in arrayRecords(field.path)" :key="`test-battler-${index}`" class="test-battler-card">
              <div class="complex-row test-battler-head">
                <label>
                  <span>{{ t('mapPreview.actor') }}</span>
                  <select :value="numberValue(battler, 'actorId')" @change="updateTestBattlerActor(field.path, index, Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('actors'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label><span>{{ t('db.level') }}</span><input type="number" min="1" max="99" :value="numberValue(battler, 'level', 1)" @input="updateTestBattlerLevel(field.path, index, ($event.target as HTMLInputElement).value)" /></label>
                <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">{{ t('cmdList.delete') }}</button>
              </div>
              <div class="test-battler-equips">
                <label v-for="slotIndex in testBattlerEquipRows(battler)" :key="`test-battler-${index}-equip-${slotIndex}`">
                  <span>{{ equipmentSlotLabel(slotIndex, numberValue(battler, 'actorId')) }}</span>
                  <select
                    v-if="isStandardEquipmentSlot(slotIndex, numberValue(battler, 'actorId'))"
                    :value="testBattlerEquipValue(battler, slotIndex)"
                    @change="updateTestBattlerEquip(field.path, index, slotIndex, Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option v-for="option in equipmentOptions(slotIndex, numberValue(battler, 'actorId'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                  <span v-else class="plugin-slot-value">{{ testBattlerEquipValue(battler, slotIndex) }} · {{ t('db.pluginEquipSlotReadonly') }}</span>
                </label>
              </div>
            </article>
          </section>

          <section v-else-if="field.path === 'menuCommands'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="check-grid">
              <label v-for="(label, index) in localizedMenuCommandLabels" :key="label" class="inline-check">
                <input type="checkbox" :checked="Boolean(arrayValue(field.path)[index])" @change="updateArrayNumber(field.path, index, ($event.target as HTMLInputElement).checked ? 1 : 0)" />
                {{ label }}
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'tilesetNames'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row param-row">
              <label v-for="(label, index) in TILESET_NAME_LABELS" :key="label">
                <span>{{ label }}</span>
                <button type="button" class="image-picker-inline" @click="openArrayImagePicker(field.path, index, 'tilesets', t('db.chooseTilesetImage', { label }))">
                  {{ imageValueLabel(textValue(field.path, index)) }}
                </button>
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'titleBgm' || field.path === 'battleBgm' || field.path === 'victoryMe' || field.path === 'defeatMe' || field.path === 'gameoverMe'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row audio-row">
              <label>
                <span>{{ t('plugins.file') }}</span>
                <select :value="String(objectValue(field.path).name || '')" @change="updateRecord(field.path, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions(audioKindForPath(field.path))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>{{ t('moveRoute.volume') }}</span><input type="number" :value="numberValue(objectValue(field.path), 'volume', 90)" @input="updateRecord(field.path, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pitch') }}</span><input type="number" :value="numberValue(objectValue(field.path), 'pitch', 100)" @input="updateRecord(field.path, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pan') }}</span><input type="number" :value="numberValue(objectValue(field.path), 'pan')" @input="updateRecord(field.path, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
          </section>

          <section v-else-if="field.path === 'boat' || field.path === 'ship' || field.path === 'airship'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row vehicle-row">
              <label>
                <span>{{ t('db.characterSprite') }}</span>
                <button type="button" class="image-picker-inline" @click="openRecordCharacterPicker(field.path)">
                  {{ imageValueLabel(String(objectValue(field.path).characterName || '')) }}
                </button>
              </label>
              <label>
                <span>{{ t('db.map') }}</span>
                <select :value="numberValue(objectValue(field.path), 'startMapId')" @change="updateRecord(field.path, 'startMapId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('maps'), RMMV_NONE_LABEL)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>X</span><input type="number" :value="numberValue(objectValue(field.path), 'startX')" @input="updateRecord(field.path, 'startX', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>Y</span><input type="number" :value="numberValue(objectValue(field.path), 'startY')" @input="updateRecord(field.path, 'startY', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>
                <span>BGM</span>
                <select :value="String((objectValue(field.path).bgm as DbRecord | undefined)?.name || '')" @change="updateNestedRecord(field.path, 'bgm', 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions('bgm')" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'sounds'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noSystemSounds') }}</div>
            <div v-for="(sound, index) in arrayRecords(field.path)" :key="`sound-${index}`" class="complex-row sound-row">
              <label>
                <span>{{ localizedSoundLabels[index] || `SE ${index + 1}` }}</span>
                <select :value="String(sound.name || '')" @change="updateSound(index, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions('se')" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>{{ t('moveRoute.volume') }}</span><input type="number" :value="numberValue(sound, 'volume', 90)" @input="updateSound(index, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pitch') }}</span><input type="number" :value="numberValue(sound, 'pitch', 100)" @input="updateSound(index, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pan') }}</span><input type="number" :value="numberValue(sound, 'pan')" @input="updateSound(index, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
          </section>

          <section v-else-if="field.path === 'terms'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div v-for="section in ['basic', 'params', 'commands']" :key="section" class="terms-section">
              <strong>{{ sectionLabel(section) }}</strong>
              <div class="complex-row param-row">
                <label v-for="(_item, index) in (Array.isArray(objectValue(field.path)[section]) ? objectValue(field.path)[section] as unknown[] : [])" :key="`${section}-${index}`">
                  <span>{{ localizedTermLabels[section]?.[index] || t('sf.itemN', { n: index + 1 }) }}</span>
                  <input :value="String(_item || '')" @input="updateTermsArray(section, index, ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
            </div>
            <div class="terms-section">
              <strong>{{ t('db.messages') }}</strong>
              <div class="complex-row param-row">
                <label v-for="(message, key) in objectValue('terms').messages as Record<string, unknown>" :key="String(key)">
                  <span>{{ String(key) }}</span>
                  <input :value="String(message || '')" @input="updateTermMessage(String(key), ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
            </div>
          </section>

          <section v-else-if="field.path === 'messages'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row param-row">
              <label v-for="(message, key) in objectValue(field.path)" :key="String(key)">
                <span>{{ String(key) }}</span>
                <input :value="String(message || '')" @input="updateMessagesRecord(String(key), ($event.target as HTMLInputElement).value)" />
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'flags'" class="field full complex-editor tileset-flags-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <TilesetFlagCanvasEditor
              :tileset-names="arrayValue('tilesetNames')"
              :flags="arrayValue(field.path)"
              :catalog="catalog"
              :load-image="loadImage"
              @update:flags="writePath(field.path, $event)"
            />
          </section>

          <label v-else-if="systemImageAssetForPath(field.path)" class="field">
            <span>{{ fieldLabel(field) }}</span>
            <button
              type="button"
              class="image-picker-inline"
              @click="openSimpleImagePicker(field.path, systemImageAssetForPath(field.path)!, t('db.chooseField', { label: fieldLabel(field) }))"
            >
              {{ imageValueLabel(String(primitiveValue(field))) }}
            </button>
          </label>

          <label v-else-if="field.path === 'animation1Name' || field.path === 'animation2Name'" class="field">
            <span>{{ fieldLabel(field) }}</span>
            <button type="button" class="image-picker-inline" @click="openSimpleImagePicker(field.path, 'animations', t('db.chooseField', { label: fieldLabel(field) }))">
              {{ imageValueLabel(String(primitiveValue(field))) }}
            </button>
          </label>

          <section v-else-if="field.path === 'pages'" class="field full complex-editor stacked-complex-editor troop-pages-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.pagesMalformed', { pages: arrayValue(field.path).length, malformed: invalidArrayItemCount(field.path) }) }}</small>
              <button type="button" @click="addTroopPage">{{ t('db.addPage') }}</button>
              <button v-if="troopPageClipboard && !arrayRecords(field.path).length" type="button" @click="pasteTroopPage()">{{ t('db.pastePage') }}</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">{{ t('db.noBattleEventPages') }}</div>
            <article v-for="(page, index) in arrayRecords(field.path)" :key="`troop-page-${index}`" class="troop-page-card">
              <div class="summary-row">{{ troopPageSummary(page, index) }}</div>
              <div class="complex-row troop-page-row">
                <label>
                  <span>Span</span>
                  <select :value="numberValue(page, 'span')" @change="updateTroopPageSpan(index, Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in localizedOptions(MV_TROOP_PAGE_SPANS)" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).turnEnding" @change="updateTroopPageCondition(index, 'turnEnding', ($event.target as HTMLInputElement).checked)" />
                  {{ t('db.turnEnd') }}
                </label>
                <div class="troop-page-actions">
                  <button type="button" @click="copyTroopPage(index)">{{ t('db.copyPage') }}</button>
                  <button type="button" :disabled="!troopPageClipboard" @click="pasteTroopPage(index)">{{ t('db.pastePage') }}</button>
                  <button type="button" @click="clearTroopPage(index)">{{ t('db.clearPage') }}</button>
                </div>
                <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">{{ t('db.deletePage') }}</button>
              </div>
              <div class="complex-row troop-condition-row">
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).turnValid" @change="updateTroopPageCondition(index, 'turnValid', ($event.target as HTMLInputElement).checked)" />
                  {{ t('db.turn') }}
                </label>
                <label><span>A</span><input type="number" :value="troopPageConditions(page).turnA" @input="updateTroopPageCondition(index, 'turnA', Number(($event.target as HTMLInputElement).value))" /></label>
                <label><span>B</span><input type="number" :value="troopPageConditions(page).turnB" @input="updateTroopPageCondition(index, 'turnB', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).enemyValid" @change="updateTroopPageCondition(index, 'enemyValid', ($event.target as HTMLInputElement).checked)" />
                  {{ t('db.enemyHp') }}
                </label>
                <label>
                  <span>{{ t('db.enemy') }}</span>
                  <select :value="troopPageConditions(page).enemyIndex" @change="updateTroopPageCondition(index, 'enemyIndex', Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in troopEnemyIndexOptions()" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label><span>HP %</span><input type="number" min="0" max="100" :value="troopPageConditions(page).enemyHp" @input="updateTroopPageCondition(index, 'enemyHp', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).actorValid" @change="updateTroopPageCondition(index, 'actorValid', ($event.target as HTMLInputElement).checked)" />
                  {{ t('db.actorHp') }}
                </label>
                <label>
                  <span>{{ t('mapPreview.actor') }}</span>
                  <select :value="troopPageConditions(page).actorId" @change="updateTroopPageCondition(index, 'actorId', Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('actors'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label><span>HP %</span><input type="number" min="0" max="100" :value="troopPageConditions(page).actorHp" @input="updateTroopPageCondition(index, 'actorHp', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).switchValid" @change="updateTroopPageCondition(index, 'switchValid', ($event.target as HTMLInputElement).checked)" />
                  {{ t('mapPreview.switch') }}
                </label>
                <label>
                  <span>{{ t('mapPreview.switch') }}</span>
                  <select :value="troopPageConditions(page).switchId" @change="updateTroopPageCondition(index, 'switchId', Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('switches'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
              </div>
              <div class="troop-command-list">
                <strong>{{ t('commonEvent.contents') }}</strong>
                <MvCommandListEditor
                  :model-value="page.list"
                  :catalog="catalog"
                  :load-image="loadImage"
                  :empty-text="t('db.emptyBattleCommands')"
                  @update:model-value="updateTroopPageCommands(index, $event)"
                />
              </div>
            </article>
          </section>

          <section v-else-if="field.path === 'frames'" class="field full complex-editor readonly-summary">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.framesMalformed', { summary: framesSummary(field.path), malformed: invalidArrayItemCount(field.path) }) }}</small>
            </div>
            <AnimationFrameCanvasEditor
              :model-value="readPath(field.path)"
              :catalog="catalog"
              :animation1-name="stringValue('animation1Name')"
              :animation1-hue="numberPathValue('animation1Hue')"
              :animation2-name="stringValue('animation2Name')"
              :animation2-hue="numberPathValue('animation2Hue')"
              :load-image="loadImage"
              @update:model-value="writePath(field.path, $event)"
            />
          </section>

          <section v-else-if="field.path === 'timings'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.timingCount', { count: animationTimings(field.path).length }) }}</small>
              <button type="button" @click="addAnimationTiming(field.path)">{{ t('db.addTiming') }}</button>
            </div>
            <div v-if="!animationTimings(field.path).length" class="empty-note">{{ t('db.noTimings') }}</div>
            <div v-for="(timing, index) in animationTimings(field.path)" :key="`timing-${index}`" class="complex-row timing-row">
              <label><span>{{ t('db.frame') }}</span><input type="number" min="0" :max="Math.max(0, animationFrameCount('frames') - 1)" :value="timing.frame" @input="updateAnimationTiming(field.path, index, 'frame', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>
                <span>SE</span>
                <select :value="timing.se.name" @change="updateAnimationTimingSe(field.path, index, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions('se')" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>{{ t('moveRoute.volume') }}</span><input type="number" min="0" max="100" :value="timing.se.volume" @input="updateAnimationTimingSe(field.path, index, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pitch') }}</span><input type="number" min="50" max="150" :value="timing.se.pitch" @input="updateAnimationTimingSe(field.path, index, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pan') }}</span><input type="number" min="-100" max="100" :value="timing.se.pan" @input="updateAnimationTimingSe(field.path, index, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>
                <span>Flash</span>
                <select :value="timing.flashScope" @change="updateAnimationTiming(field.path, index, 'flashScope', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in localizedOptions(MV_ANIMATION_FLASH_SCOPES)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label v-for="(label, colorIndex) in ['R','G','B','A']" :key="`flash-${index}-${label}`">
                <span>{{ label }}</span>
                <input type="number" min="0" max="255" :value="timing.flashColor[colorIndex]" @input="updateAnimationTimingFlash(field.path, index, colorIndex, Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label><span>{{ t('db.duration') }}</span><input type="number" min="1" max="200" :value="timing.flashDuration" @input="updateAnimationTiming(field.path, index, 'flashDuration', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="removeAnimationTiming(field.path, index)">{{ t('cmdList.delete') }}</button>
            </div>
            </section>

          <section v-else-if="field.path === 'rotation' && isMZParticleAnimation" class="field full complex-editor particle-rotation-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.particleRotationHint') }}</small>
            </div>
            <div class="complex-row particle-rotation-row">
              <label v-for="axis in PARTICLE_ROTATION_AXES" :key="`particle-rotation-${axis}`">
                <span>{{ axis.toUpperCase() }}</span>
                <input
                  type="number"
                  min="-360"
                  max="360"
                  :value="particleRotation()[axis]"
                  @input="updateParticleRotation(axis, Number(($event.target as HTMLInputElement).value))"
                />
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'flashTimings' && isMZParticleAnimation" class="field full complex-editor particle-timing-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.timingCount', { count: particleFlashTimings(field.path).length }) }}</small>
              <button type="button" @click="addParticleFlashTiming(field.path)">{{ t('db.addTiming') }}</button>
            </div>
            <div v-if="!particleFlashTimings(field.path).length" class="empty-note">{{ t('db.noTimings') }}</div>
            <div
              v-for="(timing, index) in particleFlashTimings(field.path)"
              :key="`particle-flash-${index}`"
              class="complex-row particle-flash-row"
            >
              <label><span>{{ t('db.frame') }}</span><input type="number" min="0" max="99999" :value="timing.frame" @input="updateParticleFlashTiming(field.path, index, 'frame', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('db.duration') }}</span><input type="number" min="1" max="99999" :value="timing.duration" @input="updateParticleFlashTiming(field.path, index, 'duration', Number(($event.target as HTMLInputElement).value))" /></label>
              <label v-for="(label, colorIndex) in ['R', 'G', 'B', 'A']" :key="`particle-flash-${index}-${label}`">
                <span>{{ label }}</span>
                <input type="number" min="0" max="255" :value="timing.color[colorIndex]" @input="updateParticleFlashColor(field.path, index, colorIndex, Number(($event.target as HTMLInputElement).value))" />
              </label>
              <button type="button" class="danger" @click="deleteParticleFlashTiming(field.path, index)">{{ t('cmdList.delete') }}</button>
            </div>
          </section>

          <section v-else-if="field.path === 'soundTimings' && isMZParticleAnimation" class="field full complex-editor particle-timing-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ t('db.timingCount', { count: particleSoundTimings(field.path).length }) }}</small>
              <button type="button" @click="addParticleSoundTiming(field.path)">{{ t('db.addTiming') }}</button>
            </div>
            <div v-if="!particleSoundTimings(field.path).length" class="empty-note">{{ t('db.noTimings') }}</div>
            <div
              v-for="(timing, index) in particleSoundTimings(field.path)"
              :key="`particle-sound-${index}`"
              class="complex-row particle-sound-row"
            >
              <label><span>{{ t('db.frame') }}</span><input type="number" min="0" max="99999" :value="timing.frame" @input="updateParticleSoundFrame(field.path, index, Number(($event.target as HTMLInputElement).value))" /></label>
              <label>
                <span>SE</span>
                <select :value="timing.se.name" @change="updateParticleSoundSe(field.path, index, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions('se')" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>{{ t('moveRoute.volume') }}</span><input type="number" min="0" max="100" :value="timing.se.volume" @input="updateParticleSoundSe(field.path, index, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pitch') }}</span><input type="number" min="50" max="150" :value="timing.se.pitch" @input="updateParticleSoundSe(field.path, index, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>{{ t('moveRoute.pan') }}</span><input type="number" min="-100" max="100" :value="timing.se.pan" @input="updateParticleSoundSe(field.path, index, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="deleteParticleSoundTiming(field.path, index)">{{ t('cmdList.delete') }}</button>
            </div>
          </section>

          <label v-else-if="field.path === 'iconIndex'" class="field">
            <span>{{ fieldLabel(field) }}</span>
            <button type="button" class="image-picker-inline icon-pick-btn" @click="openIconPicker">
              <span v-if="iconPreviewStyle" class="icon-preview-sprite" :style="iconPreviewStyle" />
              <span v-else class="icon-preview-none">0</span>
              <span class="icon-index-label">#{{ numberPathValue('iconIndex') }}</span>
            </button>
          </label>

          <section v-else-if="field.path === 'effectName'" class="field particle-effect-field">
            <span>{{ fieldLabel(field) }}</span>
            <div class="particle-effect-controls">
              <select :value="stringValue(field.path)" @change="writePath(field.path, ($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('imgPicker.none') }}</option>
                <option v-for="asset in catalog?.assets.effects || []" :key="asset.fileName" :value="asset.name">{{ asset.name }}</option>
              </select>
              <button
                type="button"
                data-ui-id="database-particle-preview"
                :disabled="!stringValue(field.path)"
                @click="emit('requestParticlePreview')"
              >{{ t('db.previewParticle') }}</button>
            </div>
          </section>

          <label v-else-if="!isComplex(field) && fieldKind(field) !== 'boolean'" class="field" :class="{ full: field.path === 'note' || field.path === 'profile' || field.path === 'description' }">
            <span>{{ fieldLabel(field) }}</span>
            <textarea
              v-if="field.path === 'note' || field.path === 'profile' || field.path === 'description'"
              :value="String(primitiveValue(field))"
              rows="3"
              @input="updatePrimitive(field, ($event.target as HTMLTextAreaElement).value)"
            />
            <select
              v-else-if="hasPrimitiveOptions(field)"
              :value="Number(primitiveValue(field))"
              :disabled="field.path === 'id'"
              @change="updatePrimitive(field, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in primitiveOptions(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <input
              v-else
              :type="inputType(field)"
              :value="primitiveValue(field)"
              :disabled="field.path === 'id'"
              @input="updatePrimitive(field, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label v-else-if="fieldKind(field) === 'boolean'" class="check-field">
            <input
              type="checkbox"
              :checked="Boolean(primitiveValue(field))"
              @change="updatePrimitive(field, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ fieldLabel(field) }}</span>
          </label>
          <label v-else class="field full json-field">
            <span>{{ fieldLabel(field) }}</span>
            <textarea
              :value="jsonText(field)"
              rows="7"
              spellcheck="false"
              @input="updateJson(field, ($event.target as HTMLTextAreaElement).value)"
            />
            <small v-if="field.note">{{ field.note }}</small>
            <em v-if="jsonErrors[field.path]">{{ jsonErrors[field.path] }}</em>
          </label>
        </template>
      </div>
    </section>

    <section v-if="references.length" class="editor-section">
      <div class="section-title">
        <strong>{{ t('db.references') }}</strong>
        <span>{{ t('db.referenceCount', { count: references.length }) }}</span>
      </div>
      <div class="reference-list">
        <div v-for="ref in references" :key="`${ref.path}:${ref.target}`" class="reference-row">
          <span>{{ sectionLabel(ref.path) }}</span>
          <b>{{ ref.target }}</b>
          <small v-if="ref.note">{{ ref.note }}</small>
        </div>
      </div>
    </section>

    <section v-if="!schemaDriven" class="editor-section">
      <div class="section-title"><strong>{{ t('db.groupFields', { group: groupLabel }) }}</strong></div>
      <StructuredFieldsEditor :model-value="modelValue" :label="t('sf.field')" @update:model-value="$emit('update:modelValue', $event)" />
    </section>
    <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="safeLoadImage" @commit="commitImageSelection" />
  </div>
</template>

<style scoped>
.db-editor {
  container-type: inline-size;
  display: grid;
  gap: 6px;
}
.db-editor--compact {
  gap: 6px;
}
.db-editor--compact .editor-section {
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 6px;
  background: var(--console-paper,#fffdfa);
}
.db-editor--compact .section-title { font-size: 10px; }
.db-editor--compact .section-title strong { font-size: 11px; }
.db-editor--compact .field {
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 4px 6px;
}
.db-editor--compact .field.rm-row-multiline,
.db-editor--compact .field.full:not(.complex-editor) {
  align-items: start;
}
.db-editor--compact input:not([type="checkbox"]),
.db-editor--compact select,
.db-editor--compact textarea {
  padding: 3px 6px;
  font-size: 11px;
  border-radius: 4px;
}
.db-editor--compact textarea { min-height: 44px; line-height: 1.35; }
.db-editor--compact button {
  padding: 3px 8px;
  font-size: 10px;
  border-radius: 4px;
}
.db-editor--compact .complex-editor {
  gap: 4px;
  padding: 6px;
  border-radius: 6px;
}
.db-editor--compact .complex-row {
  gap: 4px;
  padding: 4px;
  border-radius: 4px;
}
.db-editor--compact .complex-title { gap: 6px; font-size: 10px; }
.db-editor--actors-rm .editor-section.actor-rm-section {
  padding: 4px;
  gap: 4px;
  border: 0;
  background: transparent;
}
.actor-rm-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 4px;
  align-items: stretch;
  min-height: 0;
}
.actor-rm-left,
.actor-rm-right {
  min-width: 0;
  display: grid;
  gap: 4px;
  align-content: start;
}
.actor-rm-right {
  min-height: 0;
}
.rm-panel {
  display: grid;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 4px;
  background: var(--console-paper-soft,#faf5ec);
}
.rm-panel-fill {
  min-height: 0;
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
}
.rm-panel-title {
  color: var(--console-text-soft,#5a5247);
  font-size: 10px;
  font-weight: 700;
}
.rm-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.rm-rows { display: grid; gap: 3px; }
.rm-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 4px 6px;
  align-items: center;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.rm-row-multiline { align-items: start; }
.rm-row>span { line-height: 1.2; }
.rm-image-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.rm-image-slot {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 4px;
  background: var(--console-paper,#fffdfa);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 9px;
  cursor: pointer;
}
.rm-image-slot:hover { border-color: var(--console-accent,#be5630); }
.rm-image-slot>span { font-weight: 650; color: var(--console-text-soft,#5a5247); }
.rm-image-slot canvas {
  width: 100%;
  max-width: 64px;
  height: auto;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 3px;
  background: #d7d0c5;
  image-rendering: pixelated;
}
.rm-image-slot small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-equip-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.rm-equip-table th,
.rm-equip-table td {
  padding: 2px 3px;
  border-top: 1px solid var(--console-border,#e4dcce);
  vertical-align: middle;
}
.rm-equip-table th {
  width: 58px;
  color: var(--console-text-muted,#9a8e7e);
  font-weight: 600;
  text-align: left;
}
.rm-equip-table select { width: 100%; }
.rm-equip-actions { width: 22px; text-align: right; }
.rm-trait-list {
  min-height: 0;
  max-height: 320px;
  display: grid;
  gap: 3px;
  overflow: auto;
}
.rm-trait-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) 44px 22px;
  gap: 2px;
  align-items: center;
}
.rm-mini-button {
  padding: 2px 6px;
  font-size: 9px;
  white-space: nowrap;
}
.rm-icon-button {
  width: 22px;
  height: 22px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
}
.rm-icon-button.danger { color: var(--app-danger,#b42318); }
.rm-note {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 4px 6px;
  align-items: start;
  padding: 4px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 4px;
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.editor-section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 8px;
  background: var(--console-paper-soft,#faf5ec);
}
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.section-title strong { color: var(--console-text,#211d17); font-size: 12px; }
.actor-image-editor {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 8px;
  background: var(--console-paper,#fffdfa);
}
.actor-image-grid {
  display: grid;
  grid-template-columns: repeat(3,minmax(0,1fr));
  gap: 8px;
}
.actor-image-card {
  min-width: 0;
  display: grid;
  gap: 7px;
  align-content: start;
  padding: 8px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 7px;
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
}
.actor-image-card>span {
  color: var(--console-text-soft,#5a5247);
  font-weight: 700;
}
.actor-image-card canvas {
  max-width: 100%;
  height: auto;
  justify-self: center;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: #d7d0c5;
  image-rendering: pixelated;
}
.actor-image-card label {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.image-picker-card {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--console-text-muted,#9a8e7e);
}
.image-picker-card canvas {
  max-width: 100%;
  height: auto;
  justify-self: center;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: #d7d0c5;
  image-rendering: pixelated;
}
.image-picker-card:hover canvas {
  border-color: var(--console-accent,#be5630);
}
.image-picker-card small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-picker-inline {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-pick-btn { display: inline-flex; align-items: center; gap: 6px; }
.icon-preview-sprite { flex-shrink: 0; width: 32px; height: 32px; image-rendering: pixelated; }
.icon-preview-none { width: 32px; height: 32px; display: grid; place-items: center; background: var(--app-bg-sunken, #f5f3ef); color: var(--app-text-muted, #888); font-size: 11px; border-radius: 4px; }
.icon-index-label { font-variant-numeric: tabular-nums; }
.image-field-editor {
  align-content: start;
}
.field-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; }
.field { min-width: 0; display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: center; gap: 4px 6px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.field.full { grid-column: 1 / -1; }
.field:has(textarea) { align-items: start; }
.field:has(textarea)>span { padding-top: 4px; }
.check-field { display: flex; align-items: center; gap: 7px; color: var(--console-text-soft,#5a5247); font-size: 11px; }
input:not([type="checkbox"]),select,textarea {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 4px;
  background: var(--console-paper,#fffdfa);
  color: var(--console-text,#211d17);
  padding: 3px 6px;
  font: inherit;
  font-size: 11px;
}
button {
  width: fit-content;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: var(--console-paper,#fffdfa);
  color: var(--console-text-soft,#5a5247);
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
}
button.danger { color: var(--app-danger,#b42318); }
button:disabled { cursor: not-allowed; opacity: .55; }
input:disabled { color: var(--console-text-muted,#9a8e7e); opacity: .7; }
textarea { resize: vertical; line-height: 1.45; }
.json-field textarea { font-family: var(--app-font-mono); font-size: 11px; }
.advanced-json {
  border: 1px dashed var(--console-border,#e4dcce);
  border-radius: 7px;
  padding: 8px;
  background: var(--console-paper-soft,#faf5ec);
}
.advanced-json summary {
  color: var(--console-text-soft,#5a5247);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}
.advanced-json textarea { width: 100%; margin-top: 8px; font-family: var(--app-font-mono); font-size: 11px; }
.advanced-json em { color: var(--app-danger); font-style: normal; font-size: 11px; }
.json-field small,
.complex-editor small { color: var(--console-text-muted,#9a8e7e); line-height: 1.4; }
.json-field em { color: var(--app-danger); font-style: normal; font-size: 11px; }
.reference-list { display: grid; gap: 6px; }
.reference-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 6px 10px;
  padding: 8px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 7px;
  background: var(--console-paper,#fffdfa);
  font-size: 11px;
}
.reference-row span { color: var(--console-text-muted,#9a8e7e); }
.reference-row b { color: var(--console-text-soft,#5a5247); font-weight: 650; }
.reference-row small { grid-column: 1 / -1; color: var(--console-text-muted,#9a8e7e); line-height: 1.4; }
.complex-editor {
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 6px;
  background: var(--console-paper,#fffdfa);
}
.complex-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  color: var(--console-text-soft,#5a5247);
  font-weight: 700;
}
.complex-title>span,
.complex-title>small { min-width: 0; }
.complex-title>button { margin-left: auto; flex: 0 0 auto; }
.complex-row {
  display: grid;
  grid-template-columns: repeat(4,minmax(0,1fr)) auto;
  gap: 4px;
  align-items: end;
  padding: 4px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 4px;
  background: var(--console-paper-soft,#faf5ec);
}
.complex-row label { min-width: 0; display: grid; gap: 4px; }
.complex-row label span { color: var(--console-text-muted,#9a8e7e); overflow-wrap: normal; }
.complex-row>button.danger { justify-self: end; white-space: nowrap; }
.compact-row { grid-template-columns: minmax(0,1fr) auto; }
.string-list-row,
.terms-message-row { grid-template-columns: minmax(0,1fr) auto; }
.terms-message-row { padding: 6px 8px; }
.terms-message-row label span small { margin-left: 6px; font-weight: 500; color: var(--console-text-muted,#9a8e7e); }
.learning-row { grid-template-columns: 120px minmax(0,1fr) auto; }
.member-row { grid-template-columns: minmax(0,1.4fr) 90px 90px 110px auto; }
.semantic-action-row { grid-template-columns: minmax(120px,1fr) minmax(130px,.8fr) minmax(220px,1.6fr) 90px auto; }
.action-condition-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  min-width: 0;
}
.action-condition-fields label { display: grid; gap: 4px; min-width: 0; }
.action-condition-fields label span { color: var(--console-text-muted,#9a8e7e); }
.action-always-note,
.plugin-condition-note,
.plugin-slot-value {
  align-self: center;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
}
.action-condition-error {
  grid-column: 1 / -1;
  color: var(--el-color-danger);
  font-size: 11px;
  font-style: normal;
}
.troop-formation-head .battle-test-button {
  margin-left: auto;
  border-color: var(--app-accent,#9a6a2f);
}
.field.full.complex-editor.stacked-complex-editor {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.battleback-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.battleback-controls label,
.test-battler-equips label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
}
.troop-formation-layout {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(150px, 1fr);
  gap: 8px;
  align-items: start;
}
.troop-member-list {
  display: grid;
  gap: 4px;
  max-height: 430px;
  overflow: auto;
}
.troop-member-select {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 7px;
  width: 100%;
  padding: 7px 8px;
  text-align: left;
  background: var(--console-paper-soft,#faf5ec);
}
.troop-member-select b { grid-row: 1 / 3; align-self: center; }
.troop-member-select span,
.troop-member-select small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.troop-member-select small { color: var(--console-text-muted,#9a8e7e); }
.troop-member-select.active {
  border-color: var(--app-accent,#9a6a2f);
  box-shadow: inset 3px 0 var(--app-accent,#9a6a2f);
}
.troop-selected-member { margin-top: 2px; }
.test-battler-card {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 5px;
  background: var(--console-paper-soft,#faf5ec);
}
.test-battler-head { grid-template-columns: minmax(0, 1fr) 100px auto; }
.test-battler-equips {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.drop-row { grid-template-columns: 120px minmax(0,1fr) 100px auto; }
.damage-row { grid-template-columns: 100px 160px minmax(0,1fr) 100px 110px; }
.param-row { grid-template-columns: repeat(4,minmax(0,1fr)); align-items: start; }
.audio-row { grid-template-columns: minmax(0,1.4fr) 90px 90px 90px; }
.vehicle-row { grid-template-columns: minmax(0,1.4fr) 90px minmax(0,1.2fr) 70px 70px minmax(0,1.2fr); }
.sound-row { grid-template-columns: minmax(0,1.4fr) 78px 78px 78px; }
.wide { grid-column: span 1; }
.inline-check {
  min-width: 0;
  display: flex !important;
  align-items: center;
  gap: 6px !important;
  color: var(--console-text-soft,#5a5247);
  white-space: normal;
}
.inline-check input { flex: 0 0 auto; }
.empty-note,
.summary-row {
  padding: 8px;
  border: 1px dashed var(--console-border,#e4dcce);
  border-radius: 7px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
}
.readonly-summary .json-field {
  margin-top: 4px;
}
.troop-page-card,
.animation-frame-editor {
  display: grid;
  gap: 8px;
}
.troop-page-row { grid-template-columns: 150px minmax(100px,.5fr) minmax(0,1fr) auto; }
.troop-page-actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: end; }
.troop-condition-row { grid-template-columns: repeat(6,minmax(0,1fr)); }
.troop-command-list {
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--console-border,#e4dcce);
  border-radius: 7px;
  background: var(--console-paper-soft,#faf5ec);
}
.troop-command-list>strong {
  color: var(--console-text-soft,#5a5247);
  font-size: 11px;
}
.command-summary-list {
  display: grid;
  gap: 4px;
  padding-top: 8px;
}
.command-summary-list code {
  display: block;
  color: var(--console-text-soft,#5a5247);
  font: 11px/1.45 var(--app-font-mono);
}
.animation-frame-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.animation-frame-list button {
  width: 34px;
  height: 28px;
  padding: 0;
}
.animation-frame-list button.active {
  border-color: var(--app-accent,#9a6a2f);
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text,#211d17);
  font-weight: 700;
}
.animation-cell-row { grid-template-columns: repeat(8,minmax(64px,1fr)) auto; }
.timing-row { grid-template-columns: 70px minmax(0,1.3fr) repeat(3,76px) 100px repeat(4,62px) 70px auto; }
.particle-rotation-row { grid-template-columns: repeat(3, minmax(90px, 1fr)); }
.particle-flash-row { grid-template-columns: repeat(2, minmax(84px, .8fr)) repeat(4, minmax(58px, .55fr)) auto; }
.particle-sound-row { grid-template-columns: 84px minmax(130px, 1.4fr) repeat(3, minmax(76px, .8fr)) auto; }
.particle-effect-controls {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}
.particle-effect-controls select { min-width: 0; }
.check-grid {
  display: grid;
  grid-template-columns: repeat(3,minmax(0,1fr));
  gap: 8px 12px;
}
.terms-section { display: grid; gap: 6px; }
.terms-section strong { color: var(--console-text-soft,#5a5247); font-size: 11px; }
.rmmv-terms-grid {
  display: grid;
  gap: 6px 10px;
}
.rmmv-terms-grid--pairs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rmmv-terms-grid--quad { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.rmmv-terms-cell label {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.rmmv-terms-cell label span {
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
  line-height: 1.3;
}
.rmmv-terms-cell input {
  width: 100%;
  box-sizing: border-box;
  min-height: 24px;
  color: var(--console-text, #211d17);
  background: var(--console-paper, #fffdfa);
}
.rmmv-terms-messages-scroll {
  max-height: min(52vh, 520px);
  overflow: auto;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 6px;
  background: var(--console-paper,#fffdfa);
}
.rmmv-terms-messages-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.rmmv-terms-messages-table th,
.rmmv-terms-messages-table td {
  border-bottom: 1px solid var(--console-border,#e4dcce);
  padding: 5px 8px;
  vertical-align: middle;
}
.rmmv-terms-messages-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text-soft,#5a5247);
  font-weight: 650;
  text-align: left;
}
.rmmv-terms-messages-type {
  width: 38%;
  min-width: 120px;
  color: var(--console-text-soft,#5a5247);
}
.rmmv-terms-messages-type small {
  display: block;
  margin-top: 2px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
  font-weight: 500;
}
.rmmv-terms-messages-table td input {
  width: 100%;
  box-sizing: border-box;
  min-height: 24px;
  color: var(--console-text, #211d17);
  background: var(--console-paper, #fffdfa);
}
.field.full.complex-editor.rmmv-type-editor,
.field.full.complex-editor.rmmv-terms-editor,
.field.full.complex-editor.terms-message-editor,
.field.full.complex-editor.tileset-flags-editor {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}
.rmmv-type-name-list {
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 6px;
  overflow: hidden;
  background: var(--console-paper,#fffdfa);
}
.rmmv-type-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--console-border,#e4dcce);
}
.rmmv-type-row:last-child { border-bottom: 0; }
.rmmv-type-id {
  font-family: var(--app-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--console-accent,#be5630);
}
.rmmv-type-input {
  width: 100%;
  min-width: 0;
  min-height: 24px;
  box-sizing: border-box;
  color: var(--console-text, #211d17);
  background: var(--console-paper, #fffdfa);
}
.rmmv-type-delete {
  padding: 3px 8px;
  font-size: 10px;
}
.rmmv-type-delete-placeholder {
  width: 44px;
  flex-shrink: 0;
}
.class-param-table {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 8px;
  background: var(--console-paper,#fffdfa);
}
.class-param-row {
  display: grid;
  grid-template-columns: 92px repeat(99, 56px);
  width: max-content;
  min-width: 100%;
}
.class-param-row>span,
.class-param-row>b {
  min-height: 30px;
  display: flex;
  align-items: center;
  padding: 0 7px;
  border-right: 1px solid var(--console-border,#e4dcce);
  border-bottom: 1px solid var(--console-border,#e4dcce);
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.class-param-row>b {
  justify-content: center;
  font-weight: 650;
}
.class-param-row input {
  border-width: 0 0 1px 1px;
  border-radius: 0;
  padding: 4px;
  text-align: right;
  font-size: 10px;
}
@media (max-width: 1460px) {
  .field-grid { grid-template-columns: 1fr; }
  .complex-row,
  .semantic-action-row,
  .member-row,
  .drop-row,
  .damage-row,
  .param-row,
  .audio-row,
  .vehicle-row,
  .sound-row,
  .troop-page-row,
  .troop-condition-row,
  .animation-cell-row,
  .timing-row { grid-template-columns: 1fr; }
  .troop-formation-layout { grid-template-columns: minmax(0, 1fr); }
  .check-grid { grid-template-columns: 1fr; }
}
@container (max-width: 640px) {
  .troop-formation-layout { grid-template-columns: minmax(0, 1fr); }
  .actor-rm-grid { grid-template-columns: 1fr; }
  .rm-image-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rm-trait-list { max-height: none; }
  .editor-section { padding: 6px; }
  .section-title,
  .complex-title {
    align-items: flex-start;
  }
  .complex-title>small {
    flex: 1 1 100%;
    order: 3;
  }
  .rmmv-terms-grid--pairs { grid-template-columns: 1fr; }
  .rmmv-terms-grid--quad { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field-grid,
  .actor-image-grid,
  .reference-row,
  .complex-row,
  .compact-row,
  .string-list-row,
  .terms-message-row,
  .learning-row,
  .member-row,
  .drop-row,
  .damage-row,
  .param-row,
  .audio-row,
  .vehicle-row,
  .sound-row,
  .troop-page-row,
  .troop-condition-row,
  .animation-cell-row,
  .timing-row,
  .check-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .battleback-controls,
  .test-battler-equips,
  .action-condition-fields { grid-template-columns: minmax(0, 1fr); }
  .complex-row {
    align-items: stretch;
    padding: 10px;
  }
  .complex-row>button.danger {
    justify-self: end;
  }
  .inline-check {
    min-height: 31px;
  }
  .troop-command-list,
  .class-param-table {
    max-width: 100%;
  }
}
</style>
