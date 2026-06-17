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
import {
  animationFramesSummary,
  appendAnimationFrame,
  appendAnimationFrameCell,
  appendAnimationTiming,
  MV_ANIMATION_BLEND_MODES,
  MV_ANIMATION_CELL_FIELDS,
  MV_ANIMATION_FLASH_SCOPES,
  MV_CLASS_PARAM_LEVELS,
  MV_TROOP_PAGE_SPANS,
  appendStringListItem,
  isMvStringListField,
  MV_TERMS_MESSAGE_LABELS,
  normalizeAnimationFrames,
  normalizeAnimationTimings,
  normalizeClassParamCurves,
  normalizeTroopPageConditions,
  normalizeStringList,
  removeAnimationFrameCell,
  removeStringListItem,
  setAnimationFrameCellValue,
  setAnimationTimingFlashColor,
  setAnimationTimingSeValue,
  setAnimationTimingValue,
  setClassParamCurveLevel,
  setStringListItem,
  setTroopPageCondition,
  setTroopPageSpan,
  sortedTermsMessageKeys,
  stringListHasReservedZero,
  troopPageConditionSummary,
} from '../../utils/rmmvDatabaseEditor';
import type { MvCommand } from '../../composables/useEventEditor';
import { eventCharacterFrame, type MvEventImage } from '../../composables/useMapRenderer';
import { mvFaceSourceRect } from '../../utils/rmmvFace';
import MvCommandListEditor from './MvCommandListEditor.vue';
import StructuredFieldsEditor from './StructuredFieldsEditor.vue';
import ImageAssetPickerDialog from '../editor/ImageAssetPickerDialog.vue';

type DbRecord = Record<string, unknown>;
type DbArrayRecord = Record<string, unknown>[];
type CatalogKey = Exclude<keyof EditorProjectCatalog, 'project' | 'assets'>;
type ImageAssetKind = keyof EditorProjectCatalog['assets'];
type ImagePickerMode = 'plain' | 'face' | 'character';
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
  loadImage?: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();

const GROUP_LABELS: Record<string, string> = {
  Actors: '角色',
  Classes: '职业',
  Skills: '技能',
  Items: '物品',
  Weapons: '武器',
  Armors: '防具',
  Enemies: '敌人',
  Troops: '敌群',
  States: '状态',
  Animations: '动画',
  Tilesets: '图块组',
  CommonEvents: '公共事件',
  System: '系统',
  Types: '类型',
  Terms: '用语',
};

const FIELD_LABELS: Record<string, string> = {
  id: '编号',
  name: '名称',
  gameTitle: '游戏标题',
  versionId: '版本 ID',
  editMapId: '编辑地图',
  classId: '职业',
  initialLevel: '初始等级',
  maxLevel: '最高等级',
  nickname: '昵称',
  profile: '简介',
  description: '说明',
  note: '备注',
  characterName: '行走图',
  characterIndex: '行走图索引',
  faceName: '脸图',
  faceIndex: '脸图索引',
  battlerName: '战斗图',
  battlerHue: '战斗图色相',
  iconIndex: '图标编号',
  price: '价格',
  animationId: '动画',
  stypeId: '技能类型',
  itypeId: '物品类型',
  wtypeId: '武器类型',
  atypeId: '防具类型',
  etypeId: '装备类型',
  mpCost: 'MP 消耗',
  tpCost: 'TP 消耗',
  tpGain: '获得 TP',
  scope: '作用范围',
  occasion: '可用场景',
  speed: '速度修正',
  successRate: '成功率',
  repeats: '连续次数',
  hitType: '命中类型',
  requiredWtypeId1: '必要武器 1',
  requiredWtypeId2: '必要武器 2',
  consumable: '消耗品',
  exp: '经验值',
  gold: '金币',
  restriction: '行动限制',
  priority: '优先级',
  motion: '动作',
  overlay: '叠加显示',
  autoRemovalTiming: '自动解除',
  minTurns: '最少回合',
  maxTurns: '最多回合',
  removeAtBattleEnd: '战斗结束解除',
  removeByRestriction: '行动限制解除',
  removeByDamage: '受伤解除',
  chanceByDamage: '受伤解除概率',
  removeByWalking: '步行解除',
  stepsToRemove: '解除步数',
  message1: '提示 1',
  message2: '提示 2',
  message3: '提示 3',
  message4: '提示 4',
  animation1Name: '动画图像 1',
  animation1Hue: '图像 1 色相',
  animation2Name: '动画图像 2',
  animation2Hue: '图像 2 色相',
  position: '显示位置',
  mode: '模式',
  trigger: '触发方式',
  switchId: '条件开关',
  testTroopId: '测试敌群',
  startMapId: '起始地图',
  startX: '起始 X',
  startY: '起始 Y',
  title1Name: '标题图 1',
  title2Name: '标题图 2',
  battleback1Name: '战斗背景 1',
  battleback2Name: '战斗背景 2',
  currencyUnit: '货币单位',
  locale: '语言',
  optDisplayTp: '显示 TP',
  optDrawTitle: '绘制标题',
  optExtraExp: '替补获得经验',
  optFloorDeath: '地形伤害死亡',
  optFollowers: '显示队列成员',
  optSideView: '侧视战斗',
  optSlipDeath: '中毒死亡',
  optTransparent: '透明开始',
  switches: '开关',
  variables: '变量',
  elements: '属性',
  skillTypes: '技能类型',
  weaponTypes: '武器类型',
  armorTypes: '防具类型',
  equipTypes: '装备类型',
  partyMembers: '初始队伍',
  testBattlers: '测试战斗成员',
  boat: '小船',
  ship: '大船',
  airship: '飞空艇',
  titleBgm: '标题 BGM',
  battleBgm: '战斗 BGM',
  victoryMe: '胜利 ME',
  defeatMe: '战败 ME',
  gameoverMe: '游戏结束 ME',
  sounds: '系统音效',
  terms: '用语',
  menuCommands: '菜单命令',
  windowTone: '窗口色调',
  damage: '伤害',
  effects: '使用效果',
  traits: '特性',
  params: '能力值',
  equips: '初始装备',
  expParams: '经验曲线',
  learnings: '习得技能',
  actions: '行动模式',
  dropItems: '掉落物',
  members: '敌群成员',
  pages: '战斗事件页',
  frames: '动画帧',
  timings: '动画时机',
  tilesetNames: '图块图片',
  flags: '图块标志',
  list: '执行内容',
  basic: '基础用语',
  commands: '命令用语',
  messages: '消息用语',
};

const PARAM_OPTIONS = [
  '最大 HP', '最大 MP', '攻击力', '防御力', '魔法力', '魔法防御', '敏捷', '幸运',
].map((label, value) => ({ value, label }));

const XPARAM_OPTIONS = [
  '命中率', '闪避率', '会心率', '会心闪避', '魔法闪避', '魔法反射', '反击率', 'HP 再生', 'MP 再生', 'TP 再生',
].map((label, value) => ({ value, label }));

const SPARAM_OPTIONS = [
  '被攻击率', '防御效果率', '恢复效果率', '药理知识', 'MP 消耗率', 'TP 充能率', '物理伤害率', '魔法伤害率', '地形伤害率', '经验获得率',
].map((label, value) => ({ value, label }));

const TRAIT_CODES: SelectOption[] = [
  { value: 11, label: '属性有效度' },
  { value: 12, label: '弱化有效度' },
  { value: 13, label: '状态有效度' },
  { value: 14, label: '状态免疫' },
  { value: 21, label: '普通能力值' },
  { value: 22, label: '追加能力值' },
  { value: 23, label: '特殊能力值' },
  { value: 31, label: '攻击属性' },
  { value: 32, label: '攻击状态' },
  { value: 33, label: '攻击速度补正' },
  { value: 34, label: '攻击次数追加' },
  { value: 41, label: '添加技能类型' },
  { value: 42, label: '封印技能类型' },
  { value: 43, label: '添加技能' },
  { value: 44, label: '封印技能' },
  { value: 51, label: '装备武器类型' },
  { value: 52, label: '装备防具类型' },
  { value: 53, label: '固定装备' },
  { value: 54, label: '封印装备' },
  { value: 55, label: '装备槽类型' },
  { value: 61, label: '追加行动次数' },
  { value: 62, label: '特殊标志' },
  { value: 63, label: '消失效果' },
  { value: 64, label: '队伍能力' },
];

const EFFECT_CODES: SelectOption[] = [
  { value: 11, label: '恢复 HP' },
  { value: 12, label: '恢复 MP' },
  { value: 13, label: '获得 TP' },
  { value: 21, label: '附加状态' },
  { value: 22, label: '解除状态' },
  { value: 31, label: '强化能力值' },
  { value: 32, label: '弱化能力值' },
  { value: 33, label: '解除强化' },
  { value: 34, label: '解除弱化' },
  { value: 41, label: '特殊效果' },
  { value: 42, label: '成长' },
  { value: 43, label: '习得技能' },
  { value: 44, label: '公共事件' },
];

const ITEM_TYPE_OPTIONS: SelectOption[] = [
  { value: 1, label: '普通物品' },
  { value: 2, label: '关键物品' },
  { value: 3, label: '隐藏物品 A' },
  { value: 4, label: '隐藏物品 B' },
];

const DROP_KIND_OPTIONS: SelectOption[] = [
  { value: 0, label: '无' },
  { value: 1, label: '物品' },
  { value: 2, label: '武器' },
  { value: 3, label: '防具' },
];

const FLAG_BITS: SelectOption[] = [
  { value: 0x01, label: '下阻塞' },
  { value: 0x02, label: '左阻塞' },
  { value: 0x04, label: '右阻塞' },
  { value: 0x08, label: '上阻塞' },
  { value: 0x10, label: '星标' },
  { value: 0x20, label: '梯子' },
  { value: 0x40, label: '草丛' },
  { value: 0x80, label: '柜台' },
  { value: 0x100, label: '伤害地形' },
];

const DAMAGE_TYPE_OPTIONS: SelectOption[] = [
  { value: 0, label: '无' },
  { value: 1, label: 'HP 伤害' },
  { value: 2, label: 'MP 伤害' },
  { value: 3, label: 'HP 恢复' },
  { value: 4, label: 'MP 恢复' },
  { value: 5, label: 'HP 吸收' },
  { value: 6, label: 'MP 吸收' },
];

const SCOPE_OPTIONS: SelectOption[] = [
  { value: 0, label: '无' },
  { value: 1, label: '敌单体' },
  { value: 2, label: '敌全体' },
  { value: 3, label: '敌随机 1 次' },
  { value: 4, label: '敌随机 2 次' },
  { value: 5, label: '敌随机 3 次' },
  { value: 6, label: '敌随机 4 次' },
  { value: 7, label: '我方单体' },
  { value: 8, label: '我方全体' },
  { value: 9, label: '我方单体（战斗不能）' },
  { value: 10, label: '我方全体（战斗不能）' },
  { value: 11, label: '使用者' },
];

const OCCASION_OPTIONS: SelectOption[] = [
  { value: 0, label: '总是' },
  { value: 1, label: '仅战斗' },
  { value: 2, label: '仅菜单' },
  { value: 3, label: '不可使用' },
];

const HIT_TYPE_OPTIONS: SelectOption[] = [
  { value: 0, label: '必中' },
  { value: 1, label: '物理攻击' },
  { value: 2, label: '魔法攻击' },
];

const TRIGGER_OPTIONS: SelectOption[] = [
  { value: 0, label: '无' },
  { value: 1, label: '自动执行' },
  { value: 2, label: '并行处理' },
];

const STATE_RESTRICTION_OPTIONS: SelectOption[] = [
  { value: 0, label: '无' },
  { value: 1, label: '攻击敌人' },
  { value: 2, label: '攻击任意目标' },
  { value: 3, label: '攻击同伴' },
  { value: 4, label: '不能行动' },
];

const STATE_AUTO_REMOVE_OPTIONS: SelectOption[] = [
  { value: 0, label: '无' },
  { value: 1, label: '行动结束' },
  { value: 2, label: '回合结束' },
];

const STATE_MOTION_OPTIONS: SelectOption[] = [
  { value: 0, label: '普通' },
  { value: 1, label: '异常' },
  { value: 2, label: '睡眠' },
  { value: 3, label: '死亡' },
];

const ANIMATION_POSITION_OPTIONS: SelectOption[] = [
  { value: 0, label: '头部' },
  { value: 1, label: '中央' },
  { value: 2, label: '脚下' },
  { value: 3, label: '画面' },
];

const TILESET_MODE_OPTIONS: SelectOption[] = [
  { value: 0, label: 'VX Ace 兼容' },
  { value: 1, label: 'MV 标准' },
];

const TILESET_NAME_LABELS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];
const MENU_COMMAND_LABELS = ['物品', '技能', '装备', '状态', '整队', '保存'];
const TONE_LABELS = ['红', '绿', '蓝', '灰'];
const SOUND_LABELS = [
  '光标', '确定', '取消', '蜂鸣', '装备', '保存', '读取', '战斗开始',
  '逃跑', '敌人攻击', '敌人受伤', '敌人消失', 'Boss 消失 1', 'Boss 消失 2',
  '角色受伤', '角色倒下', '恢复', '未命中', '闪避', '魔法闪避',
  '魔法反射', '商店', '使用物品', '使用技能',
];
const TERM_LABELS: Record<string, string[]> = {
  basic: ['等级', '等级缩写', 'HP', 'HP 缩写', 'MP', 'MP 缩写', 'TP', 'TP 缩写', '经验值', '经验值缩写'],
  params: ['最大 HP', '最大 MP', '攻击', '防御', '魔法攻击', '魔法防御', '敏捷', '幸运', '命中', '回避'],
  commands: [
    '战斗', '逃跑', '攻击', '防御', '物品', '技能', '装备', '状态', '整队', '保存', '游戏结束', '选项',
    '武器', '防具', '贵重物品', '装备', '最强装备', '全部卸下', '新的游戏', '继续', '标题画面', '取消', '购买', '卖出',
  ],
};

const jsonErrors = reactive<Record<string, string>>({});
const selectedFlagTileId = ref(0);
const selectedAnimationFrameIndex = ref(0);
const facePreviewCanvas = ref<HTMLCanvasElement | null>(null);
const characterPreviewCanvas = ref<HTMLCanvasElement | null>(null);
const battlerPreviewCanvas = ref<HTMLCanvasElement | null>(null);
const enemyBattlerPreviewCanvas = ref<HTMLCanvasElement | null>(null);
const imagePicker = ref<InstanceType<typeof ImageAssetPickerDialog> | null>(null);
const ACTOR_IMAGE_FIELD_PATHS = new Set(['faceName', 'faceIndex', 'characterName', 'characterIndex', 'battlerName']);
let pendingImageCommit: ((selection: ImageSelection) => void) | null = null;

const record = computed<DbRecord>(() => (
  props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue)
    ? props.modelValue as DbRecord
    : {}
));

const groupLabel = computed(() => GROUP_LABELS[String(props.group || '')] || String(props.group || '数据库'));
const schemaFields = computed(() => props.schema?.coreFields || []);
const references = computed(() => props.schema?.references || []);
const schemaDriven = computed(() => schemaFields.value.length > 0);
const isActorImageEditor = computed(() => props.group === 'Actors' && schemaDriven.value);
const isEnemyEditor = computed(() => props.group === 'Enemies' || props.schema?.fileName === 'Enemies.json');
const visibleSchemaFields = computed(() => (
  isActorImageEditor.value
    ? schemaFields.value.filter((field) => !ACTOR_IMAGE_FIELD_PATHS.has(field.path))
    : schemaFields.value
));
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
  stringValue('battlerName'),
  props.catalog?.assets.enemies.length || 0,
].join('|'));

watch(actorImageSignature, () => {
  if (isActorImageEditor.value) void nextTick(paintActorImagePreviews);
}, { immediate: true });
watch(enemyBattlerSignature, () => {
  if (isEnemyEditor.value) void nextTick(paintEnemyBattlerPreview);
}, { immediate: true });

function fieldLabel(field: RmmvDatabaseFieldSchema): string {
  return FIELD_LABELS[field.path] || field.path;
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
  const next = structuredClone(record.value);
  setRecordPath(next, segments, value);
  emit('update:modelValue', next);
}

function writePaths(updates: Array<{ path: string; value: unknown }>): void {
  const next = structuredClone(record.value);
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
    if (kind === 'array' && !Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    if (kind === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new Error('必须是 JSON 对象');
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
  if (stringListReserveZero(path) && index === 0) return '0000 保留位';
  return `#${String(index).padStart(4, '0')}`;
}

function updateStringListItem(path: string, index: number, value: string): void {
  writePath(path, setStringListItem(readPath(path), index, value, stringListReserveZero(path)));
}

function addStringListItem(path: string): void {
  writePath(path, appendStringListItem(readPath(path), stringListReserveZero(path)));
}

function removeStringListItemAt(path: string, index: number): void {
  writePath(path, removeStringListItem(readPath(path), index, stringListReserveZero(path)));
}

function isTermsMessagesField(field: RmmvDatabaseFieldSchema): boolean {
  return props.group === 'Terms' && field.path === 'messages';
}

function termsMessageEntries(path: string): { key: string; label: string; value: string }[] {
  const messages = objectValue(path);
  return sortedTermsMessageKeys(messages).map((key) => ({
    key,
    label: MV_TERMS_MESSAGE_LABELS[key] || key,
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
  return emptyLabel ? [{ value: 0, label: emptyLabel }, ...result] : result;
}

function fixedOptions(options: SelectOption[], emptyLabel?: string): SelectOption[] {
  return emptyLabel ? [{ value: 0, label: emptyLabel }, ...options] : options;
}

function primitiveOptions(field: RmmvDatabaseFieldSchema): SelectOption[] {
  switch (field.path) {
    case 'classId': return asOptions(catalogEntries('classes'));
    case 'animationId': return asOptions(catalogEntries('animations'), '无');
    case 'stypeId': return asOptions(catalogEntries('skillTypes'));
    case 'itypeId': return ITEM_TYPE_OPTIONS;
    case 'wtypeId':
    case 'requiredWtypeId1':
    case 'requiredWtypeId2':
      return asOptions(catalogEntries('weaponTypes'), '无');
    case 'atypeId': return asOptions(catalogEntries('armorTypes'));
    case 'etypeId': return asOptions(catalogEntries('equipTypes'));
    case 'switchId': return asOptions(catalogEntries('switches'), '无');
    case 'testTroopId': return asOptions(catalogEntries('troops'), '无');
    case 'startMapId':
    case 'editMapId':
      return asOptions(catalogEntries('maps'), '无');
    case 'scope': return SCOPE_OPTIONS;
    case 'occasion': return OCCASION_OPTIONS;
    case 'hitType': return HIT_TYPE_OPTIONS;
    case 'trigger': return TRIGGER_OPTIONS;
    case 'restriction': return STATE_RESTRICTION_OPTIONS;
    case 'autoRemovalTiming': return STATE_AUTO_REMOVE_OPTIONS;
    case 'motion': return STATE_MOTION_OPTIONS;
    case 'position': return ANIMATION_POSITION_OPTIONS;
    case 'mode': return TILESET_MODE_OPTIONS;
    default:
      return [];
  }
}

function hasPrimitiveOptions(field: RmmvDatabaseFieldSchema): boolean {
  return primitiveOptions(field).length > 0;
}

function traitTargetOptions(code: number): SelectOption[] {
  switch (code) {
    case 11:
    case 31:
      return asOptions(catalogEntries('elements'));
    case 13:
    case 14:
    case 32:
      return asOptions(catalogEntries('states'));
    case 21:
      return PARAM_OPTIONS;
    case 22:
      return XPARAM_OPTIONS;
    case 23:
      return SPARAM_OPTIONS;
    case 41:
    case 42:
      return asOptions(catalogEntries('skillTypes'));
    case 43:
    case 44:
      return asOptions(catalogEntries('skills'));
    case 51:
      return asOptions(catalogEntries('weaponTypes'));
    case 52:
      return asOptions(catalogEntries('armorTypes'));
    case 53:
    case 54:
      return asOptions(catalogEntries('equipTypes'));
    default:
      return [];
  }
}

function effectTargetOptions(code: number): SelectOption[] {
  switch (code) {
    case 21:
    case 22:
      return asOptions(catalogEntries('states'));
    case 31:
    case 32:
    case 33:
    case 34:
    case 42:
      return PARAM_OPTIONS;
    case 43:
      return asOptions(catalogEntries('skills'));
    case 44:
      return asOptions(catalogEntries('commonEvents'));
    default:
      return [];
  }
}

function equipmentOptions(slotIndex: number): SelectOption[] {
  return slotIndex === 0
    ? asOptions(catalogEntries('weapons'), '无')
    : asOptions(catalogEntries('armors'), '无');
}

function equipmentSlotLabel(slotIndex: number): string {
  const equipType = catalogEntries('equipTypes').find((entry) => entry.id === slotIndex + 1);
  return equipType ? `${slotIndex + 1}. ${equipType.name}` : `装备槽 ${slotIndex + 1}`;
}

function dropTargetOptions(kind: number): SelectOption[] {
  if (kind === 1) return asOptions(catalogEntries('items'));
  if (kind === 2) return asOptions(catalogEntries('weapons'));
  if (kind === 3) return asOptions(catalogEntries('armors'));
  return [];
}

function updateDamage(key: string, value: unknown): void {
  writePath('damage', { ...objectValue('damage'), [key]: value });
}

function damageElementOptions(): SelectOption[] {
  return fixedOptions([
    { value: -1, label: '普通攻击属性' },
    ...asOptions(catalogEntries('elements')),
  ]);
}

function flagsValue(path: string): number[] {
  return arrayValue(path).map((entry) => Number(entry || 0));
}

function currentFlag(path: string): number {
  return flagsValue(path)[selectedFlagTileId.value] || 0;
}

function setFlagValue(path: string, tileId: number, flag: number): void {
  const next = flagsValue(path);
  next[tileId] = Math.max(0, Number.isFinite(flag) ? Math.trunc(flag) : 0);
  writePath(path, next);
}

function updateCurrentFlag(path: string, raw: string): void {
  setFlagValue(path, selectedFlagTileId.value, Number.parseInt(raw || '0', 10));
}

function toggleFlagBit(path: string, bit: number, checked: boolean): void {
  const flag = currentFlag(path);
  setFlagValue(path, selectedFlagTileId.value, checked ? flag | bit : flag & ~bit);
}

function flagSummary(path: string): string {
  const flags = flagsValue(path);
  const nonZero = flags.filter((value) => value !== 0).length;
  return `${flags.length} 个 tile flag，${nonZero} 个非零`;
}

function commandCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function troopPageSummary(page: DbRecord, index: number): string {
  const active = troopPageConditionSummary(page.conditions);
  const span = MV_TROOP_PAGE_SPANS.find((entry) => entry.value === numberValue(page, 'span'))?.label || '战斗';
  return `第 ${index + 1} 页 · ${span} · ${commandCount(page.list)} 条指令 · 条件 ${active.length ? active.join(' / ') : '无'}`;
}

function framesSummary(path: string): string {
  return animationFramesSummary(readPath(path));
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
    { value: '', label: '(无)' },
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
  return name || '(无)';
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
  openImagePicker({ asset: 'faces', mode: 'face', title: '选择脸图', name: stringValue('faceName'), index: numberPathValue('faceIndex') }, (selection) => {
    writePaths([
      { path: 'faceName', value: selection.name },
      { path: 'faceIndex', value: selection.name ? selection.index : 0 },
    ]);
  });
}

function openActorCharacterPicker(): void {
  openImagePicker({ asset: 'characters', mode: 'character', title: '选择行走图', name: stringValue('characterName'), index: numberPathValue('characterIndex') }, (selection) => {
    writePaths([
      { path: 'characterName', value: selection.name },
      { path: 'characterIndex', value: selection.name ? selection.index : 0 },
    ]);
  });
}

function openActorBattlerPicker(): void {
  openSimpleImagePicker('battlerName', 'svActors', '选择 SV 战斗图');
}

function openEnemyBattlerPicker(path: string): void {
  openSimpleImagePicker(path, 'enemies', '选择敌人战斗图');
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
    title: `选择${fieldLabel({ path, kind: 'object' })}图像`,
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
  drawCenteredImage(context, image, mvFaceSourceRect(numberPathValue('faceIndex')));
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
  const image = await loadCatalogImage('enemies', stringValue('battlerName'));
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

function classParamValue(paramIndex: number, level: number): number {
  return normalizeClassParamCurves(readPath('params'))[paramIndex]?.[level] ?? 0;
}

function updateClassParam(paramIndex: number, level: number, value: number): void {
  writePath('params', setClassParamCurveLevel(readPath('params'), paramIndex, level, value));
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
  appendArrayValue('pages', {
    conditions: normalizeTroopPageConditions({}),
    list: [{ code: 0, indent: 0, parameters: [] }],
    span: 0,
  });
}

function troopEnemyIndexOptions(): SelectOption[] {
  const members = arrayRecords('members');
  if (!members.length) return [{ value: 0, label: '#1 敌人槽' }];
  return members.map((member, index) => {
    const enemyId = numberValue(member, 'enemyId');
    const enemy = catalogEntries('enemies').find((entry) => entry.id === enemyId);
    return { value: index, label: `#${index + 1} ${enemy?.name || `敌人 ${enemyId}`}` };
  });
}

function animationFrames(path: string): number[][][] {
  return normalizeAnimationFrames(readPath(path));
}

function selectedAnimationFrame(path: string): number[][] {
  const frames = animationFrames(path);
  const index = Math.min(Math.max(selectedAnimationFrameIndex.value, 0), Math.max(0, frames.length - 1));
  return frames[index] || [];
}

function selectAnimationFrame(index: number): void {
  selectedAnimationFrameIndex.value = Math.max(0, index);
}

function addAnimationFrame(path: string): void {
  const next = appendAnimationFrame(readPath(path));
  writePath(path, next);
  selectedAnimationFrameIndex.value = Math.max(0, next.length - 1);
}

function addAnimationFrameCell(path: string): void {
  writePath(path, appendAnimationFrameCell(readPath(path), selectedAnimationFrameIndex.value));
}

function updateAnimationFrameCell(path: string, cellIndex: number, fieldIndex: number, value: number): void {
  writePath(path, setAnimationFrameCellValue(readPath(path), selectedAnimationFrameIndex.value, cellIndex, fieldIndex, value));
}

function deleteAnimationFrameCell(path: string, cellIndex: number): void {
  writePath(path, removeAnimationFrameCell(readPath(path), selectedAnimationFrameIndex.value, cellIndex));
}

function animationTimings(path: string) {
  return normalizeAnimationTimings(readPath(path));
}

function addAnimationTiming(path: string): void {
  writePath(path, appendAnimationTiming(readPath(path)));
}

function removeAnimationTiming(path: string, index: number): void {
  writePath(path, animationTimings(path).filter((_timing, timingIndex) => timingIndex !== index));
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

function updateSound(index: number, key: string, value: unknown): void {
  updateArrayObject('sounds', index, key, value);
}
</script>

<template>
  <div class="db-editor">
    <section v-if="schemaDriven" class="editor-section">
      <div class="section-title">
        <strong>{{ groupLabel }}字段</strong>
        <span>{{ schema?.fileName }} · {{ schema?.isArrayTable ? '数组表' : '文档表' }}</span>
      </div>
      <section v-if="isActorImageEditor" class="actor-image-editor">
        <div class="complex-title">
          <span>图像</span>
        </div>
        <div class="actor-image-grid">
          <article class="actor-image-card">
            <span>脸图</span>
            <button type="button" class="image-picker-card" @click="openActorFacePicker">
              <canvas ref="facePreviewCanvas" width="96" height="96" />
              <small>{{ imageValueLabel(stringValue('faceName')) }}</small>
            </button>
          </article>
          <article class="actor-image-card">
            <span>行走图</span>
            <button type="button" class="image-picker-card" @click="openActorCharacterPicker">
              <canvas ref="characterPreviewCanvas" width="96" height="96" />
              <small>{{ imageValueLabel(stringValue('characterName')) }}</small>
            </button>
          </article>
          <article class="actor-image-card">
            <span>SV 战斗图</span>
            <button type="button" class="image-picker-card" @click="openActorBattlerPicker">
              <canvas ref="battlerPreviewCanvas" width="128" height="96" />
              <small>{{ imageValueLabel(stringValue('battlerName')) }}</small>
            </button>
          </article>
        </div>
      </section>
      <div class="field-grid">
        <template v-for="field in visibleSchemaFields" :key="field.path">
          <section v-if="isStringListField(field)" class="field full complex-editor string-list-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addStringListItem(field.path)">添加</button>
            </div>
            <small v-if="stringListReserveZero(field.path)">RPG Maker MV 的 0 号槽为空保留位，界面禁止编辑和删除。</small>
            <div v-if="!stringListValue(field.path).length" class="empty-note">暂无条目。</div>
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
                type="button"
                class="danger"
                :disabled="stringListReserveZero(field.path) && index === 0"
                @click="removeStringListItemAt(field.path, index)"
              >
                删除
              </button>
            </div>
          </section>

          <section v-else-if="isTermsMessagesField(field)" class="field full complex-editor terms-message-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ termsMessageEntries(field.path).length }} 条消息模板</small>
            </div>
            <div v-if="!termsMessageEntries(field.path).length" class="empty-note">暂无消息模板。</div>
            <div v-for="message in termsMessageEntries(field.path)" :key="message.key" class="complex-row terms-message-row">
              <label>
                <span>{{ message.label }} <small>{{ message.key }}</small></span>
                <input :value="message.value" @input="updateObjectField(field.path, message.key, ($event.target as HTMLInputElement).value)" />
              </label>
            </div>
            <details class="advanced-json">
              <summary>高级 JSON（新增或删除非标准 message key 时使用）</summary>
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
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { code: 21, dataId: 0, value: 1 })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无特性。</div>
            <div v-for="(trait, index) in arrayRecords(field.path)" :key="`trait-${index}`" class="complex-row trait-row">
              <label>
                <span>类型</span>
                <select :value="numberValue(trait, 'code', 21)" @change="updateArrayObject(field.path, index, 'code', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in TRAIT_CODES" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>对象</span>
                <select
                  v-if="traitTargetOptions(numberValue(trait, 'code', 21)).length"
                  :value="numberValue(trait, 'dataId')"
                  @change="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="option in traitTargetOptions(numberValue(trait, 'code', 21))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input
                  v-else
                  type="number"
                  :value="numberValue(trait, 'dataId')"
                  @input="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLInputElement).value))"
                />
              </label>
              <label>
                <span>值</span>
                <input type="number" step="0.01" :value="numberValue(trait, 'value', 1)" @input="updateArrayObject(field.path, index, 'value', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'effects'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { code: 11, dataId: 0, value1: 0, value2: 0 })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无使用效果。</div>
            <div v-for="(effect, index) in arrayRecords(field.path)" :key="`effect-${index}`" class="complex-row effect-row">
              <label>
                <span>类型</span>
                <select :value="numberValue(effect, 'code', 11)" @change="updateArrayObject(field.path, index, 'code', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in EFFECT_CODES" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>对象</span>
                <select
                  v-if="effectTargetOptions(numberValue(effect, 'code', 11)).length"
                  :value="numberValue(effect, 'dataId')"
                  @change="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="option in effectTargetOptions(numberValue(effect, 'code', 11))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input
                  v-else
                  type="number"
                  :value="numberValue(effect, 'dataId')"
                  @input="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLInputElement).value))"
                />
              </label>
              <label>
                <span>值 1</span>
                <input type="number" step="0.01" :value="numberValue(effect, 'value1')" @input="updateArrayObject(field.path, index, 'value1', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label>
                <span>值 2</span>
                <input type="number" step="0.01" :value="numberValue(effect, 'value2')" @input="updateArrayObject(field.path, index, 'value2', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'equips'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="replaceArray(field.path, [...arrayValue(field.path), 0])">添加槽位</button>
            </div>
            <div v-if="!arrayValue(field.path).length" class="empty-note">暂无初始装备槽。</div>
            <div v-for="(_equip, index) in arrayValue(field.path)" :key="`equip-${index}`" class="complex-row compact-row">
              <label>
                <span>{{ equipmentSlotLabel(index) }}</span>
                <select :value="Number(arrayValue(field.path)[index] || 0)" @change="updateArrayNumber(field.path, index, Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in equipmentOptions(index)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
            <small>槽位名称来自当前项目 System.equipTypes；第 1 槽按武器，其余槽按防具选择。</small>
          </section>

          <section v-else-if="field.path === 'learnings'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { level: 1, skillId: catalogEntries('skills')[0]?.id || 1, note: '' })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无习得技能。</div>
            <div v-for="(learning, index) in arrayRecords(field.path)" :key="`learning-${index}`" class="complex-row learning-row">
              <label>
                <span>等级</span>
                <input type="number" :value="numberValue(learning, 'level', 1)" @input="updateArrayObject(field.path, index, 'level', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label>
                <span>技能</span>
                <select :value="numberValue(learning, 'skillId')" @change="updateArrayObject(field.path, index, 'skillId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('skills'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'actions'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { skillId: catalogEntries('skills')[0]?.id || 1, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无行动模式。</div>
            <div v-for="(action, index) in arrayRecords(field.path)" :key="`action-${index}`" class="complex-row action-row">
              <label>
                <span>技能</span>
                <select :value="numberValue(action, 'skillId')" @change="updateArrayObject(field.path, index, 'skillId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('skills'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>条件类型</span><input type="number" :value="numberValue(action, 'conditionType')" @input="updateArrayObject(field.path, index, 'conditionType', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>条件 1</span><input type="number" :value="numberValue(action, 'conditionParam1')" @input="updateArrayObject(field.path, index, 'conditionParam1', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>条件 2</span><input type="number" :value="numberValue(action, 'conditionParam2')" @input="updateArrayObject(field.path, index, 'conditionParam2', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>优先级</span><input type="number" :value="numberValue(action, 'rating', 5)" @input="updateArrayObject(field.path, index, 'rating', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'dropItems'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { kind: 1, dataId: catalogEntries('items')[0]?.id || 1, denominator: 1 })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无掉落物。</div>
            <div v-for="(drop, index) in arrayRecords(field.path)" :key="`drop-${index}`" class="complex-row drop-row">
              <label>
                <span>类型</span>
                <select :value="numberValue(drop, 'kind')" @change="updateArrayObject(field.path, index, 'kind', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in DROP_KIND_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>对象</span>
                <select
                  v-if="dropTargetOptions(numberValue(drop, 'kind')).length"
                  :value="numberValue(drop, 'dataId')"
                  @change="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="option in dropTargetOptions(numberValue(drop, 'kind'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input v-else type="number" :value="numberValue(drop, 'dataId')" @input="updateArrayObject(field.path, index, 'dataId', Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label><span>分母</span><input type="number" :value="numberValue(drop, 'denominator', 1)" @input="updateArrayObject(field.path, index, 'denominator', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'members'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { enemyId: catalogEntries('enemies')[0]?.id || 1, x: 0, y: 0, hidden: false })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无敌群成员。</div>
            <div v-for="(member, index) in arrayRecords(field.path)" :key="`member-${index}`" class="complex-row member-row">
              <label>
                <span>敌人</span>
                <select :value="numberValue(member, 'enemyId')" @change="updateArrayObject(field.path, index, 'enemyId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('enemies'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>X</span><input type="number" :value="numberValue(member, 'x')" @input="updateArrayObject(field.path, index, 'x', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>Y</span><input type="number" :value="numberValue(member, 'y')" @input="updateArrayObject(field.path, index, 'y', Number(($event.target as HTMLInputElement).value))" /></label>
              <label class="inline-check"><input type="checkbox" :checked="boolValue(member, 'hidden')" @change="updateArrayObject(field.path, index, 'hidden', ($event.target as HTMLInputElement).checked)" /> 隐藏</label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'damage'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>伤害公式仍保留文本表达，属性来自当前项目 System.elements。</small>
            </div>
            <div class="complex-row damage-row">
              <label>
                <span>类型</span>
                <select :value="Number(objectValue(field.path).type || 0)" @change="updateDamage('type', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in DAMAGE_TYPE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label>
                <span>属性</span>
                <select :value="Number(objectValue(field.path).elementId ?? -1)" @change="updateDamage('elementId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in damageElementOptions()" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label class="wide"><span>公式</span><input :value="String(objectValue(field.path).formula || '')" @input="updateDamage('formula', ($event.target as HTMLInputElement).value)" /></label>
              <label><span>方差</span><input type="number" :value="Number(objectValue(field.path).variance || 0)" @input="updateDamage('variance', Number(($event.target as HTMLInputElement).value))" /></label>
              <label class="inline-check"><input type="checkbox" :checked="Boolean(objectValue(field.path).critical)" @change="updateDamage('critical', ($event.target as HTMLInputElement).checked)" /> 会心</label>
            </div>
          </section>

          <section v-else-if="field.path === 'params' && group === 'Classes'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>按 MV 八项能力曲线编辑 Lv1-Lv99。</small>
            </div>
            <div class="class-param-table">
              <div class="class-param-row class-param-head">
                <span>能力</span>
                <b v-for="level in MV_CLASS_PARAM_LEVELS" :key="level">Lv{{ level }}</b>
              </div>
              <div v-for="(param, paramIndex) in PARAM_OPTIONS" :key="param.value" class="class-param-row">
                <span>{{ param.label }}</span>
                <input
                  v-for="level in MV_CLASS_PARAM_LEVELS"
                  :key="level"
                  type="number"
                  :value="classParamValue(paramIndex, level)"
                  @input="updateClassParam(paramIndex, level, Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>
          </section>

          <section v-else-if="field.path === 'params'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row param-row">
              <label v-for="param in PARAM_OPTIONS" :key="param.value">
                <span>{{ param.label }}</span>
                <input type="number" :value="Number(arrayValue(field.path)[param.value] || 0)" @input="updateArrayNumber(field.path, param.value, Number(($event.target as HTMLInputElement).value))" />
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'expParams' || field.path === 'windowTone'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="appendArrayValue(field.path, 0)">添加</button>
            </div>
            <div class="complex-row param-row">
              <label v-for="(_item, index) in arrayValue(field.path)" :key="`${field.path}-${index}`">
                <span>{{ field.path === 'windowTone' ? (TONE_LABELS[index] || `色调 ${index + 1}`) : `参数 ${index + 1}` }}</span>
                <input type="number" :value="Number(arrayValue(field.path)[index] || 0)" @input="updateArrayNumber(field.path, index, Number(($event.target as HTMLInputElement).value))" />
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'partyMembers'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="appendArrayValue(field.path, catalogEntries('actors')[0]?.id || 1)">添加</button>
            </div>
            <div v-if="!arrayValue(field.path).length" class="empty-note">暂无初始队伍成员。</div>
            <div v-for="(_member, index) in arrayValue(field.path)" :key="`party-${index}`" class="complex-row compact-row">
              <label>
                <span>队员 {{ index + 1 }}</span>
                <select :value="Number(arrayValue(field.path)[index] || 0)" @change="updateArrayNumber(field.path, index, Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('actors'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'testBattlers'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <button type="button" @click="addArrayObject(field.path, { actorId: catalogEntries('actors')[0]?.id || 1, level: 1, equips: [0, 0, 0, 0, 0] })">添加</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无测试战斗成员。</div>
            <div v-for="(battler, index) in arrayRecords(field.path)" :key="`test-battler-${index}`" class="complex-row learning-row">
              <label>
                <span>角色</span>
                <select :value="numberValue(battler, 'actorId')" @change="updateArrayObject(field.path, index, 'actorId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('actors'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>等级</span><input type="number" :value="numberValue(battler, 'level', 1)" @input="updateArrayObject(field.path, index, 'level', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除</button>
            </div>
          </section>

          <section v-else-if="field.path === 'menuCommands'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="check-grid">
              <label v-for="(label, index) in MENU_COMMAND_LABELS" :key="label" class="inline-check">
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
                <button type="button" class="image-picker-inline" @click="openArrayImagePicker(field.path, index, 'tilesets', `选择图块图片 ${label}`)">
                  {{ imageValueLabel(textValue(field.path, index)) }}
                </button>
              </label>
            </div>
          </section>

          <section v-else-if="field.path === 'titleBgm' || field.path === 'battleBgm' || field.path === 'victoryMe' || field.path === 'defeatMe' || field.path === 'gameoverMe'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row audio-row">
              <label>
                <span>文件</span>
                <select :value="String(objectValue(field.path).name || '')" @change="updateRecord(field.path, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions(audioKindForPath(field.path))" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>音量</span><input type="number" :value="numberValue(objectValue(field.path), 'volume', 90)" @input="updateRecord(field.path, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>音调</span><input type="number" :value="numberValue(objectValue(field.path), 'pitch', 100)" @input="updateRecord(field.path, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>声像</span><input type="number" :value="numberValue(objectValue(field.path), 'pan')" @input="updateRecord(field.path, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
          </section>

          <section v-else-if="field.path === 'boat' || field.path === 'ship' || field.path === 'airship'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div class="complex-row vehicle-row">
              <label>
                <span>行走图</span>
                <button type="button" class="image-picker-inline" @click="openRecordCharacterPicker(field.path)">
                  {{ imageValueLabel(String(objectValue(field.path).characterName || '')) }}
                </button>
              </label>
              <label>
                <span>地图</span>
                <select :value="numberValue(objectValue(field.path), 'startMapId')" @change="updateRecord(field.path, 'startMapId', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in asOptions(catalogEntries('maps'), '无')" :key="option.value" :value="option.value">{{ option.label }}</option>
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
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无系统音效。</div>
            <div v-for="(sound, index) in arrayRecords(field.path)" :key="`sound-${index}`" class="complex-row sound-row">
              <label>
                <span>{{ SOUND_LABELS[index] || `SE ${index + 1}` }}</span>
                <select :value="String(sound.name || '')" @change="updateSound(index, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions('se')" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>音量</span><input type="number" :value="numberValue(sound, 'volume', 90)" @input="updateSound(index, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>音调</span><input type="number" :value="numberValue(sound, 'pitch', 100)" @input="updateSound(index, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>声像</span><input type="number" :value="numberValue(sound, 'pan')" @input="updateSound(index, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
          </section>

          <section v-else-if="field.path === 'terms'" class="field full complex-editor">
            <div class="complex-title"><span>{{ fieldLabel(field) }}</span></div>
            <div v-for="section in ['basic', 'params', 'commands']" :key="section" class="terms-section">
              <strong>{{ FIELD_LABELS[section] || section }}</strong>
              <div class="complex-row param-row">
                <label v-for="(_item, index) in (Array.isArray(objectValue(field.path)[section]) ? objectValue(field.path)[section] as unknown[] : [])" :key="`${section}-${index}`">
                  <span>{{ TERM_LABELS[section]?.[index] || `第 ${index + 1} 项` }}</span>
                  <input :value="String(_item || '')" @input="updateTermsArray(section, index, ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
            </div>
            <div class="terms-section">
              <strong>消息</strong>
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

          <section v-else-if="field.path === 'flags'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ flagSummary(field.path) }}</small>
            </div>
            <div class="flag-editor">
              <label>
                <span>Tile ID</span>
                <input type="number" min="0" :value="selectedFlagTileId" @input="selectedFlagTileId = Math.max(0, Number(($event.target as HTMLInputElement).value || 0))" />
              </label>
              <label>
                <span>Flag 值</span>
                <input type="number" :value="currentFlag(field.path)" @input="updateCurrentFlag(field.path, ($event.target as HTMLInputElement).value)" />
              </label>
              <div class="flag-bits">
                <label v-for="bit in FLAG_BITS" :key="bit.value" class="inline-check">
                  <input
                    type="checkbox"
                    :checked="Boolean(currentFlag(field.path) & bit.value)"
                    @change="toggleFlagBit(field.path, bit.value, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ bit.label }}
                </label>
              </div>
            </div>
          </section>

          <label v-else-if="systemImageAssetForPath(field.path)" class="field">
            <span>{{ fieldLabel(field) }}</span>
            <button
              type="button"
              class="image-picker-inline"
              @click="openSimpleImagePicker(field.path, systemImageAssetForPath(field.path)!, `选择${fieldLabel(field)}`)"
            >
              {{ imageValueLabel(String(primitiveValue(field))) }}
            </button>
          </label>

          <label v-else-if="field.path === 'animation1Name' || field.path === 'animation2Name'" class="field">
            <span>{{ fieldLabel(field) }}</span>
            <button type="button" class="image-picker-inline" @click="openSimpleImagePicker(field.path, 'animations', `选择${fieldLabel(field)}`)">
              {{ imageValueLabel(String(primitiveValue(field))) }}
            </button>
          </label>

          <section v-else-if="field.path === 'pages'" class="field full complex-editor troop-pages-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ arrayValue(field.path).length }} 页 · {{ invalidArrayItemCount(field.path) }} 个结构异常项</small>
              <button type="button" @click="addTroopPage">添加页</button>
            </div>
            <div v-if="!arrayRecords(field.path).length" class="empty-note">暂无战斗事件页。</div>
            <article v-for="(page, index) in arrayRecords(field.path)" :key="`troop-page-${index}`" class="troop-page-card">
              <div class="summary-row">{{ troopPageSummary(page, index) }}</div>
              <div class="complex-row troop-page-row">
                <label>
                  <span>Span</span>
                  <select :value="numberValue(page, 'span')" @change="updateTroopPageSpan(index, Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in MV_TROOP_PAGE_SPANS" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).turnEnding" @change="updateTroopPageCondition(index, 'turnEnding', ($event.target as HTMLInputElement).checked)" />
                  回合结束
                </label>
                <button type="button" class="danger" @click="removeArrayIndex(field.path, index)">删除页</button>
              </div>
              <div class="complex-row troop-condition-row">
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).turnValid" @change="updateTroopPageCondition(index, 'turnValid', ($event.target as HTMLInputElement).checked)" />
                  回合
                </label>
                <label><span>A</span><input type="number" :value="troopPageConditions(page).turnA" @input="updateTroopPageCondition(index, 'turnA', Number(($event.target as HTMLInputElement).value))" /></label>
                <label><span>B</span><input type="number" :value="troopPageConditions(page).turnB" @input="updateTroopPageCondition(index, 'turnB', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).enemyValid" @change="updateTroopPageCondition(index, 'enemyValid', ($event.target as HTMLInputElement).checked)" />
                  敌人 HP
                </label>
                <label>
                  <span>敌人</span>
                  <select :value="troopPageConditions(page).enemyIndex" @change="updateTroopPageCondition(index, 'enemyIndex', Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in troopEnemyIndexOptions()" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label><span>HP %</span><input type="number" min="0" max="100" :value="troopPageConditions(page).enemyHp" @input="updateTroopPageCondition(index, 'enemyHp', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).actorValid" @change="updateTroopPageCondition(index, 'actorValid', ($event.target as HTMLInputElement).checked)" />
                  角色 HP
                </label>
                <label>
                  <span>角色</span>
                  <select :value="troopPageConditions(page).actorId" @change="updateTroopPageCondition(index, 'actorId', Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('actors'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
                <label><span>HP %</span><input type="number" min="0" max="100" :value="troopPageConditions(page).actorHp" @input="updateTroopPageCondition(index, 'actorHp', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="inline-check">
                  <input type="checkbox" :checked="troopPageConditions(page).switchValid" @change="updateTroopPageCondition(index, 'switchValid', ($event.target as HTMLInputElement).checked)" />
                  开关
                </label>
                <label>
                  <span>开关</span>
                  <select :value="troopPageConditions(page).switchId" @change="updateTroopPageCondition(index, 'switchId', Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="option in asOptions(catalogEntries('switches'))" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </label>
              </div>
              <div class="troop-command-list">
                <strong>执行内容</strong>
                <MvCommandListEditor
                  :model-value="page.list"
                  :catalog="catalog"
                  :load-image="loadImage"
                  empty-text="暂无战斗事件指令。点击“添加”创建执行内容。"
                  @update:model-value="updateTroopPageCommands(index, $event)"
                />
              </div>
            </article>
          </section>

          <section v-else-if="field.path === 'frames'" class="field full complex-editor readonly-summary">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ framesSummary(field.path) }} · {{ invalidArrayItemCount(field.path) }} 个结构异常项</small>
              <button type="button" @click="addAnimationFrame(field.path)">添加帧</button>
            </div>
            <div v-if="!animationFrames(field.path).length" class="empty-note">暂无动画帧。</div>
            <div v-else class="animation-frame-editor">
              <div class="animation-frame-list">
                <button
                  v-for="(_frame, index) in animationFrames(field.path)"
                  :key="`frame-${index}`"
                  type="button"
                  :class="{ active: selectedAnimationFrameIndex === index }"
                  @click="selectAnimationFrame(index)"
                >
                  {{ index + 1 }}
                </button>
              </div>
              <div class="complex-title">
                <span>第 {{ selectedAnimationFrameIndex + 1 }} 帧 cell</span>
                <button type="button" @click="addAnimationFrameCell(field.path)">添加 cell</button>
              </div>
              <div v-if="!selectedAnimationFrame(field.path).length" class="empty-note">当前帧没有 cell。</div>
              <div v-for="(cell, cellIndex) in selectedAnimationFrame(field.path)" :key="`cell-${cellIndex}`" class="complex-row animation-cell-row">
                <label v-for="(cellField, fieldIndex) in MV_ANIMATION_CELL_FIELDS" :key="cellField.key">
                  <span>{{ cellField.label }}</span>
                  <select
                    v-if="cellField.key === 'blendMode'"
                    :value="cell[fieldIndex]"
                    @change="updateAnimationFrameCell(field.path, cellIndex, fieldIndex, Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option v-for="option in MV_ANIMATION_BLEND_MODES" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                  <select
                    v-else-if="cellField.key === 'mirror'"
                    :value="cell[fieldIndex]"
                    @change="updateAnimationFrameCell(field.path, cellIndex, fieldIndex, Number(($event.target as HTMLSelectElement).value))"
                  >
                    <option :value="0">否</option>
                    <option :value="1">是</option>
                  </select>
                  <input
                    v-else
                    type="number"
                    :value="cell[fieldIndex]"
                    @input="updateAnimationFrameCell(field.path, cellIndex, fieldIndex, Number(($event.target as HTMLInputElement).value))"
                  />
                </label>
                <button type="button" class="danger" @click="deleteAnimationFrameCell(field.path, cellIndex)">删除</button>
              </div>
            </div>
          </section>

          <section v-else-if="field.path === 'timings'" class="field full complex-editor">
            <div class="complex-title">
              <span>{{ fieldLabel(field) }}</span>
              <small>{{ animationTimings(field.path).length }} 条 timing</small>
              <button type="button" @click="addAnimationTiming(field.path)">添加 timing</button>
            </div>
            <div v-if="!animationTimings(field.path).length" class="empty-note">暂无动画时机。</div>
            <div v-for="(timing, index) in animationTimings(field.path)" :key="`timing-${index}`" class="complex-row timing-row">
              <label><span>帧</span><input type="number" :value="timing.frame" @input="updateAnimationTiming(field.path, index, 'frame', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>
                <span>SE</span>
                <select :value="timing.se.name" @change="updateAnimationTimingSe(field.path, index, 'name', ($event.target as HTMLSelectElement).value)">
                  <option v-for="option in audioAssetOptions('se')" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label><span>音量</span><input type="number" :value="timing.se.volume" @input="updateAnimationTimingSe(field.path, index, 'volume', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>音调</span><input type="number" :value="timing.se.pitch" @input="updateAnimationTimingSe(field.path, index, 'pitch', Number(($event.target as HTMLInputElement).value))" /></label>
              <label><span>声像</span><input type="number" :value="timing.se.pan" @input="updateAnimationTimingSe(field.path, index, 'pan', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>
                <span>Flash</span>
                <select :value="timing.flashScope" @change="updateAnimationTiming(field.path, index, 'flashScope', Number(($event.target as HTMLSelectElement).value))">
                  <option v-for="option in MV_ANIMATION_FLASH_SCOPES" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <label v-for="(label, colorIndex) in ['R','G','B','A']" :key="`flash-${index}-${label}`">
                <span>{{ label }}</span>
                <input type="number" min="0" max="255" :value="timing.flashColor[colorIndex]" @input="updateAnimationTimingFlash(field.path, index, colorIndex, Number(($event.target as HTMLInputElement).value))" />
              </label>
              <label><span>持续</span><input type="number" :value="timing.flashDuration" @input="updateAnimationTiming(field.path, index, 'flashDuration', Number(($event.target as HTMLInputElement).value))" /></label>
              <button type="button" class="danger" @click="removeAnimationTiming(field.path, index)">删除</button>
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
        <strong>引用关系</strong>
        <span>{{ references.length }} 项</span>
      </div>
      <div class="reference-list">
        <div v-for="ref in references" :key="`${ref.path}:${ref.target}`" class="reference-row">
          <span>{{ FIELD_LABELS[ref.path] || ref.path }}</span>
          <b>{{ ref.target }}</b>
          <small v-if="ref.note">{{ ref.note }}</small>
        </div>
      </div>
    </section>

    <section v-if="!schemaDriven" class="editor-section">
      <div class="section-title"><strong>{{ groupLabel }}字段</strong></div>
      <StructuredFieldsEditor :model-value="modelValue" label="字段" @update:model-value="$emit('update:modelValue', $event)" />
    </section>
    <ImageAssetPickerDialog ref="imagePicker" :catalog="catalog" :load-image="safeLoadImage" @commit="commitImageSelection" />
  </div>
</template>

<style scoped>
.db-editor {
  container-type: inline-size;
  display: grid;
  gap: 12px;
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
.image-field-editor {
  align-content: start;
}
.field-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.field { min-width: 0; display: grid; gap: 4px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.field.full { grid-column: 1 / -1; }
.check-field { display: flex; align-items: center; gap: 7px; color: var(--console-text-soft,#5a5247); font-size: 11px; }
input:not([type="checkbox"]),select,textarea {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 7px;
  background: var(--console-paper,#fffdfa);
  color: var(--console-text,#211d17);
  padding: 7px 9px;
  font: inherit;
  font-size: 12px;
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
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 8px;
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
  gap: 8px;
  align-items: end;
  padding: 8px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 7px;
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
.flag-editor {
  display: grid;
  grid-template-columns: 120px 140px minmax(0,1fr);
  gap: 8px;
  align-items: end;
}
.flag-editor label { display: grid; gap: 4px; }
.flag-bits {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 7px 9px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 7px;
  background: var(--console-paper-soft,#faf5ec);
}
.readonly-summary .json-field {
  margin-top: 4px;
}
.troop-page-card,
.animation-frame-editor {
  display: grid;
  gap: 8px;
}
.troop-page-row { grid-template-columns: 160px minmax(0,1fr) auto; }
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
.check-grid {
  display: grid;
  grid-template-columns: repeat(3,minmax(0,1fr));
  gap: 8px 12px;
}
.terms-section { display: grid; gap: 6px; }
.terms-section strong { color: var(--console-text-soft,#5a5247); font-size: 11px; }
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
  .flag-editor { grid-template-columns: 1fr; }
  .check-grid { grid-template-columns: 1fr; }
}
@container (max-width: 640px) {
  .editor-section { padding: 10px; }
  .section-title,
  .complex-title {
    align-items: flex-start;
  }
  .complex-title>small {
    flex: 1 1 100%;
    order: 3;
  }
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
  .flag-editor,
  .check-grid {
    grid-template-columns: minmax(0, 1fr);
  }
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
