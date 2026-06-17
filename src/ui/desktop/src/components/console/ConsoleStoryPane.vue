<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import { useProjectStore } from '../../stores/project';
import { useRouter } from 'vue-router';
import {
  commonEvents as commonEventsApi,
  maps as mapsApi,
  projectAssets,
  projectManagement,
  type EditorProjectCatalog,
  type ProjectManagedEntry,
  type ProjectOverview,
  type ProjectOverviewAudioBucket,
  type ProjectOverviewDbGroup,
  type ProjectOverviewDbPreview,
  type ProjectOverviewImageBucket,
  type ProjectOverviewMap,
  type ProjectOverviewMapEvent,
} from '../../api/client';
import { cloneDraft } from '../../utils/clone-draft';
import { findEditorMapEvent, type MvEditorEvent } from '../../composables/useEventEditor';
import { usePmEventEditor } from '../../composables/usePmEventEditor';
import EventEditorDialog from '../editor/EventEditorDialog.vue';
import StructuredFieldsEditor from './StructuredFieldsEditor.vue';
import CommonEventDetailEditor from './CommonEventDetailEditor.vue';
import DatabaseEntryDetailEditor from './DatabaseEntryDetailEditor.vue';
import MapEventCommandPreview from './MapEventCommandPreview.vue';
import ConsoleSearchInput from './ConsoleSearchInput.vue';

type PmDetail =
  | { kind: 'managed'; entry: ProjectManagedEntry }
  | { kind: 'audio'; category: string; name: string; url: string; fileName: string; relativePath: string; missing?: boolean }
  | { kind: 'image'; category: string; name: string; url: string; fileName: string; relativePath: string; missing?: boolean };

type ImageGridItem = {
  name: string;
  fileName: string;
  url: string;
  missing: boolean;
};

type DatabaseGridItem = {
  id: number;
  name: string;
  preview?: ProjectOverviewDbPreview;
  fileName: string;
  url: string;
  missing: boolean;
};

const projectStore = useProjectStore();
const router = useRouter();

const loading = ref(false);
const error = ref<string | null>(null);
const overview = ref<ProjectOverview | null>(null);

async function loadData() {
  if (!projectStore.currentProject) {
    overview.value = null;
    error.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    overview.value = await projectManagement.overview(projectStore.currentProject);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

const {
  eventDialogOpen,
  eventDraft,
  eventOverview,
  eventSaving,
  eventLoading,
  editorMapId,
  systemData,
  editorCatalog,
  tilesetImages,
  loadImage,
  ensureCatalog,
  openMapEventEditor,
  closeEventEditor,
  saveEvent,
  resetCatalog,
  bindEventDialogRef,
} = usePmEventEditor(() => projectStore.currentProject, () => loadData());
const selected = ref('总览');
const searchQuery = ref('');
const selectedDbGroup = ref('Actors');
const selectedAudioBucket = ref('bgm');
const selectedImageBucket = ref('pictures');
const pmSubPaneExpanded = ref(true);
const showUnnamed = ref(false);

const DB_GROUP_ORDER = [
  'Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors',
  'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents',
  'System', 'Types', 'Terms',
] as const;

const DOCUMENT_DATABASE_GROUPS = new Set(['System', 'Types', 'Terms']);
const AUDIO_BUCKET_ORDER = ['bgm', 'bgs', 'me', 'se'] as const;
const IMAGE_BUCKET_ORDER = [
  'animations', 'battlebacks1', 'battlebacks2', 'characters', 'enemies', 'faces', 'parallaxes',
  'pictures', 'sv_actors', 'sv_enemies', 'system', 'tilesets', 'titles1', 'titles2',
] as const;
const DB_PREVIEW_GROUPS = new Set([
  'Actors', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States',
  'Animations', 'Tilesets', 'System',
]);
const selectedMapId = ref<number | null>(null);
const selectedEventId = ref<number | null>(null);
const pmDetail = ref<PmDetail | null>(null);
const detailDraft = ref<unknown>(null);
const detailBusy = ref(false);
const detailError = ref('');
const detailEditable = computed(() => pmDetail.value?.kind === 'managed');
const eventPreviewBusy = ref(false);
const eventPreviewError = ref('');
const eventPreviewEvent = ref<MvEditorEvent | null>(null);
const eventPreviewSystemData = ref<{ switches: string[]; variables: string[] } | null>(null);
let eventPreviewRequest = 0;

watch(() => projectStore.currentProject, () => {
  selectedMapId.value = null;
  selectedEventId.value = null;
  selected.value = '总览';
  closeDetail();
  closeEventEditor();
  resetCatalog();
  if (projectStore.currentProject) void loadData();
});

onMounted(() => {
  if (projectStore.currentProject) void loadData();
});

watch(selected, (name) => {
  searchQuery.value = '';
  resetGroupVisibleLimits();
  if (name === '数据库') syncSelectedDbGroup();
  if (name === '音频') syncSelectedAudioBucket();
  if (name === '图片') syncSelectedImageBucket();
});

watch(searchQuery, () => {
  resetGroupVisibleLimits();
});

watch([selected, () => projectStore.currentProject], ([name]) => {
  if ((name === '图片' || name === '数据库') && projectStore.currentProject) void ensureCatalog();
});

watch([selectedMapId, selectedEventId, () => projectStore.currentProject, overview], ([mapId, eventId]) => {
  if (mapId && eventId) {
    void loadEventPreview(mapId, eventId);
  } else {
    resetEventPreview();
  }
});

const scan = computed(() => overview.value?.scan);
const assets = computed(() => overview.value?.assets);
const maps = computed(() => scan.value?.maps || []);
const switches = computed(() => scan.value?.switches || []);
const variables = computed(() => scan.value?.variables || []);
const commonEvents = computed(() => scan.value?.commonEvents || []);
const database = computed(() => scan.value?.database || {});

const audioTotal = computed(() => {
  if (!assets.value?.audio) return 0;
  return Object.values(assets.value.audio).reduce((sum, b) => sum + (b.count || 0), 0);
});

const imageTotal = computed(() => {
  if (!assets.value?.images) return 0;
  return Object.values(assets.value.images).reduce((sum, b) => sum + (b.count || 0), 0);
});

const dbTotal = computed(() => {
  if (!scan.value?.database) return 0;
  return Object.values(scan.value.database).reduce((sum, e) => sum + (e.count || 0), 0);
});

const totalEvents = computed(() => maps.value.reduce((sum, m) => sum + m.eventCount, 0));

const categories = computed(() => [
  { name: '总览', count: maps.value.length + switches.value.length + variables.value.length + commonEvents.value.length + audioTotal.value + imageTotal.value + dbTotal.value },
  { name: '地图与事件', count: maps.value.length },
  { name: '开关', count: switches.value.filter(s => s.name).length },
  { name: '变量', count: variables.value.filter(v => v.name).length },
  { name: '公共事件', count: commonEvents.value.filter(e => e.name).length },
  { name: '音频', count: audioTotal.value },
  { name: '图片', count: imageTotal.value },
  { name: '数据库', count: dbTotal.value },
]);

const selectedMap = computed(() => {
  if (!selectedMapId.value) return null;
  return maps.value.find(m => m.id === selectedMapId.value) || null;
});
const selectedMapEvents = computed(() => selectedMap.value?.events || []);
const selectedEvent = computed(() => selectedMapEvents.value.find(e => e.id === selectedEventId.value) || null);
const selectedCommonEventId = computed(() => (
  pmDetail.value?.kind === 'managed' && pmDetail.value.entry.kind === 'commonEvent'
    ? pmDetail.value.entry.id
    : null
));
function normalizedSearchQuery(): string {
  return searchQuery.value.trim().toLocaleLowerCase();
}

function matchesQuery(...parts: Array<string | number | null | undefined>): boolean {
  const query = normalizedSearchQuery();
  if (!query) return true;
  return parts.some((part) => String(part ?? '').toLocaleLowerCase().includes(query));
}

const pmSearchPlaceholder = computed(() => {
  switch (selected.value) {
    case '地图与事件':
      return '搜索地图、事件文本或 ID';
    case '开关':
    case '变量':
      return '搜索名称或 ID';
    case '公共事件':
      return '搜索公共事件名称、文本或 ID';
    case '音频':
      return '搜索音频名称';
    case '图片':
      return '搜索图片名称';
    case '数据库':
      return '搜索数据库条目';
    default:
      return '搜索';
  }
});

function mapEventMatchesQuery(event: ProjectOverviewMapEvent): boolean {
  return matchesQuery(event.name, event.id, `(${event.x}, ${event.y})`, event.x, event.y, event.note, event.searchText);
}

function mapMatchesQuery(map: ProjectOverviewMap): boolean {
  return matchesQuery(map.name, map.id) || map.events.some((event) => mapEventMatchesQuery(event));
}

const filteredMaps = computed(() => {
  const query = normalizedSearchQuery();
  if (!query) return maps.value;
  return maps.value.filter((map) => mapMatchesQuery(map));
});

const filteredMapEvents = computed(() => {
  const events = selectedMapEvents.value;
  const query = normalizedSearchQuery();
  if (!query) return events;
  return events.filter((event) => mapEventMatchesQuery(event));
});

const filteredSwitches = computed(() => {
  const base = showUnnamed.value ? switches.value : switches.value.filter((item) => item.name);
  const query = normalizedSearchQuery();
  if (!query) return base;
  return base.filter((item) => matchesQuery(item.id, item.name));
});
const filteredVariables = computed(() => {
  const base = showUnnamed.value ? variables.value : variables.value.filter((item) => item.name);
  const query = normalizedSearchQuery();
  if (!query) return base;
  return base.filter((item) => matchesQuery(item.id, item.name));
});
const filteredCommonEvents = computed(() => {
  const base = showUnnamed.value ? commonEvents.value : commonEvents.value.filter((item) => item.name);
  const query = normalizedSearchQuery();
  if (!query) return base;
  return base.filter((item) => matchesQuery(item.id, item.name, item.trigger, item.switchName, item.searchText));
});

const filteredAudio = computed(() => {
  const audio = assets.value?.audio || {};
  const query = normalizedSearchQuery();
  if (!query) return audio;
  const result: Record<string, ProjectOverviewAudioBucket> = {};
  for (const [key, bucket] of Object.entries(audio)) {
    const names = bucket.names.filter((name) => matchesQuery(name));
    if (names.length) {
      result[key] = { ...bucket, names, count: names.length };
    }
  }
  return result;
});

const filteredImages = computed(() => {
  const images = assets.value?.images || {};
  const query = normalizedSearchQuery();
  if (!query) return images;
  const result: Record<string, ProjectOverviewImageBucket> = {};
  for (const [key, bucket] of Object.entries(images)) {
    const names = bucket.names.filter((name) => matchesQuery(name));
    if (names.length) {
      result[key] = { ...bucket, names, count: names.length };
    }
  }
  return result;
});

const filteredDatabase = computed(() => {
  const db = database.value;
  const query = normalizedSearchQuery();
  if (!query) return db;
  const result: Record<string, ProjectOverviewDbGroup> = {};
  for (const [key, group] of Object.entries(db)) {
    const named = group.named.filter((entry) => matchesQuery(entry.id, entry.name, entry.preview?.name, entry.preview?.label));
    if (named.length) {
      result[key] = { ...group, named, count: named.length };
    }
  }
  return result;
});

const dbGroupOptions = computed(() =>
  DB_GROUP_ORDER.map((key) => {
    const group = database.value[key];
    const count = group?.named.length ?? group?.count ?? 0;
    return { key, label: dbLabel(key), count };
  }),
);

const audioBucketOptions = computed(() =>
  AUDIO_BUCKET_ORDER.map((key) => {
    const bucket = assets.value?.audio?.[key];
    const count = bucket?.names.length ?? bucket?.count ?? 0;
    return { key, label: key.toUpperCase(), count };
  }),
);

const imageBucketOptions = computed(() =>
  IMAGE_BUCKET_ORDER.map((key) => {
    const bucket = assets.value?.images?.[key];
    const count = bucket?.names.length ?? bucket?.count ?? 0;
    return { key, label: imageBucketLabel(key), count };
  }),
);

const activeDbGroup = computed((): ProjectOverviewDbGroup => {
  return filteredDatabase.value[selectedDbGroup.value] ?? { exists: false, count: 0, named: [] };
});

const activeAudioBucket = computed((): ProjectOverviewAudioBucket => {
  return filteredAudio.value[selectedAudioBucket.value] ?? {
    dir: '', exists: false, count: 0, names: [], files: [],
  };
});

const activeImageBucket = computed((): ProjectOverviewImageBucket => {
  return filteredImages.value[selectedImageBucket.value] ?? {
    dir: '', exists: false, count: 0, names: [], files: [],
  };
});

const visibleDbEntries = computed(() =>
  visibleGroupSlice('database', selectedDbGroup.value, activeDbGroup.value.named),
);

const activeDbUsesGrid = computed(() => DB_PREVIEW_GROUPS.has(selectedDbGroup.value));

const visibleDbGridItems = computed<DatabaseGridItem[]>(() => (
  visibleDbEntries.value.map((entry) => {
    const asset = entry.preview ? findDbPreviewAsset(entry.preview) : null;
    return {
      id: entry.id,
      name: entry.name,
      preview: entry.preview,
      fileName: asset?.fileName || '',
      url: asset?.url || '',
      missing: Boolean(entry.preview && !asset?.url),
    };
  })
));

const visibleAudioNames = computed(() =>
  visibleGroupSlice('audio', selectedAudioBucket.value, activeAudioBucket.value.names),
);

const visibleImageNames = computed(() =>
  visibleGroupSlice('image', selectedImageBucket.value, activeImageBucket.value.names),
);

const visibleImageGridItems = computed<ImageGridItem[]>(() => {
  const catalog = editorCatalog.value;
  const catalogKey = imageCatalogKey(selectedImageBucket.value);
  const catalogAssets = catalogKey ? catalog?.assets[catalogKey] ?? [] : [];
  return visibleImageNames.value.map((name) => {
    const fileName = resolveImageFileName(selectedImageBucket.value, name) || '';
    const thumbnail = catalogAssets.find((asset) => (
      asset.name === name || asset.fileName === fileName || asset.fileName.replace(/\.[^.]+$/, '') === name
    ));
    return {
      name,
      fileName,
      url: thumbnail?.url || '',
      missing: !fileName || !thumbnail?.url,
    };
  });
});

const activeImageKey = computed(() => {
  if (pmDetail.value?.kind !== 'image') return '';
  return `${pmDetail.value.category}:${pmDetail.value.name}`;
});

const activeDbKey = computed(() => {
  if (pmDetail.value?.kind !== 'managed' || pmDetail.value.entry.kind !== 'database') return '';
  return `${pmDetail.value.entry.group}:${pmDetail.value.entry.id}`;
});

const hasMoreDbEntries = computed(() =>
  hasMoreGroupItems('database', selectedDbGroup.value, activeDbGroup.value.named.length),
);

const remainingDbEntries = computed(() =>
  remainingGroupItems('database', selectedDbGroup.value, activeDbGroup.value.named.length),
);

const hasMoreAudioNames = computed(() =>
  hasMoreGroupItems('audio', selectedAudioBucket.value, activeAudioBucket.value.names.length),
);

const hasMoreImageNames = computed(() =>
  hasMoreGroupItems('image', selectedImageBucket.value, activeImageBucket.value.names.length),
);

const remainingAudioNames = computed(() =>
  remainingGroupItems('audio', selectedAudioBucket.value, activeAudioBucket.value.names.length),
);

const remainingImageNames = computed(() =>
  remainingGroupItems('image', selectedImageBucket.value, activeImageBucket.value.names.length),
);

const pmListHeaderTitle = computed(() => {
  if (selected.value === '数据库') return `数据库 · ${dbLabel(selectedDbGroup.value)}`;
  if (selected.value === '音频') return `音频 · ${selectedAudioBucket.value.toUpperCase()}`;
  if (selected.value === '图片') return `图片 · ${imageBucketLabel(selectedImageBucket.value)}`;
  return selected.value;
});

const GROUP_PAGE_SIZE = 60;
const groupVisibleLimits = ref<Record<string, number>>({});

type PmGroupTab = 'audio' | 'image' | 'database';

function groupLimitKey(tab: PmGroupTab, groupKey: string): string {
  return `${tab}:${groupKey}`;
}

function resetGroupVisibleLimits(): void {
  groupVisibleLimits.value = {};
}

function groupVisibleLimit(tab: PmGroupTab, groupKey: string): number {
  return groupVisibleLimits.value[groupLimitKey(tab, groupKey)] ?? GROUP_PAGE_SIZE;
}

function visibleGroupSlice<T>(tab: PmGroupTab, groupKey: string, items: T[]): T[] {
  return items.slice(0, groupVisibleLimit(tab, groupKey));
}

function hasMoreGroupItems(tab: PmGroupTab, groupKey: string, total: number): boolean {
  return total > groupVisibleLimit(tab, groupKey);
}

function remainingGroupItems(tab: PmGroupTab, groupKey: string, total: number): number {
  return Math.min(GROUP_PAGE_SIZE, total - groupVisibleLimit(tab, groupKey));
}

function showMoreGroupItems(tab: PmGroupTab, groupKey: string, total: number): void {
  const key = groupLimitKey(tab, groupKey);
  const current = groupVisibleLimits.value[key] ?? GROUP_PAGE_SIZE;
  groupVisibleLimits.value = {
    ...groupVisibleLimits.value,
    [key]: Math.min(current + GROUP_PAGE_SIZE, total),
  };
}

const dbLabels: Record<string, string> = {
  Actors: '角色', Classes: '职业', Skills: '技能', Items: '物品',
  Weapons: '武器', Armors: '防具', Enemies: '敌人', Troops: '敌群',
  States: '状态', Animations: '动画', Tilesets: '图块组', CommonEvents: '公共事件',
  System: '系统', Types: '类型', Terms: '用语',
};

const imageBucketLabels: Record<string, string> = {
  animations: '动画',
  battlebacks1: '战斗背景 1',
  battlebacks2: '战斗背景 2',
  characters: '行走图',
  enemies: '敌人',
  faces: '脸图',
  parallaxes: '远景',
  pictures: '图片',
  sv_actors: 'SV 角色',
  sv_enemies: 'SV 敌人',
  system: '系统',
  tilesets: '图块',
  titles1: '标题 1',
  titles2: '标题 2',
};

const managedKindLabels: Record<ProjectManagedEntry['kind'], string> = {
  switch: '开关',
  variable: '变量',
  commonEvent: '公共事件',
  database: '数据库',
};

function dbLabel(key: string): string {
  return dbLabels[key] || key;
}

function imageBucketLabel(key: string): string {
  return imageBucketLabels[key] || key;
}

function isCommonEventsGroup(group?: string): boolean {
  return group === 'CommonEvents';
}

function canCreateDatabaseGroup(key: string): boolean {
  return !DOCUMENT_DATABASE_GROUPS.has(key);
}

const canCreateSelectedDbGroup = computed(() => canCreateDatabaseGroup(selectedDbGroup.value));

function dbSummary(): string {
  if (!scan.value?.database) return '';
  return Object.keys(scan.value.database).map(k => dbLabel(k)).join(' / ');
}

function closeDetail() {
  pmDetail.value = null;
  detailDraft.value = null;
  detailError.value = '';
}

function syncSelectedDbGroup(): void {
  const options = dbGroupOptions.value;
  if (!options.length) return;
  const valid = options.some((option) => option.key === selectedDbGroup.value);
  if (!valid) {
    const withData = options.find((option) => option.count > 0);
    selectedDbGroup.value = withData?.key ?? options[0].key;
  }
}

function syncSelectedAudioBucket(): void {
  const options = audioBucketOptions.value;
  if (!options.length) return;
  const valid = options.some((option) => option.key === selectedAudioBucket.value);
  if (!valid) {
    const withData = options.find((option) => option.count > 0);
    selectedAudioBucket.value = withData?.key ?? options[0].key;
  }
}

function syncSelectedImageBucket(): void {
  const options = imageBucketOptions.value;
  if (!options.length) return;
  const valid = options.some((option) => option.key === selectedImageBucket.value);
  if (!valid) {
    const withData = options.find((option) => option.count > 0);
    selectedImageBucket.value = withData?.key ?? options[0].key;
  }
}

function selectDbGroup(key: string): void {
  if (selectedDbGroup.value === key) return;
  selectedDbGroup.value = key;
  closeDetail();
  resetGroupVisibleLimits();
}

function selectAudioBucket(key: string): void {
  if (selectedAudioBucket.value === key) return;
  selectedAudioBucket.value = key;
  closeDetail();
  resetGroupVisibleLimits();
}

function selectImageBucket(key: string): void {
  if (selectedImageBucket.value === key) return;
  selectedImageBucket.value = key;
  closeDetail();
  resetGroupVisibleLimits();
}

function selectCategory(name: string) {
  if (selected.value !== name) {
    closeDetail();
    selectedEventId.value = null;
  }
  selected.value = name;
  if (name !== '地图与事件') selectedMapId.value = null;
  if (name === '数据库') syncSelectedDbGroup();
  if (name === '音频') syncSelectedAudioBucket();
  if (name === '图片') syncSelectedImageBucket();
}

function selectMap(mapId: number) {
  selectedMapId.value = mapId;
  selectedEventId.value = null;
  closeDetail();
}

function clearDetailPanel() {
  closeDetail();
  selectedEventId.value = null;
}

function resetEventPreview() {
  eventPreviewRequest += 1;
  eventPreviewBusy.value = false;
  eventPreviewError.value = '';
  eventPreviewEvent.value = null;
  eventPreviewSystemData.value = null;
}

async function loadEventPreview(mapId: number, eventId: number) {
  const requestId = eventPreviewRequest + 1;
  eventPreviewRequest = requestId;
  eventPreviewBusy.value = true;
  eventPreviewError.value = '';
  eventPreviewEvent.value = null;
  eventPreviewSystemData.value = null;
  try {
    const payload = await mapsApi.get(mapId, projectStore.currentProject);
    if (requestId !== eventPreviewRequest) return;
    const event = findEditorMapEvent(payload.map.events, eventId);
    if (!event) throw new Error('事件不存在');
    eventPreviewEvent.value = event;
    eventPreviewSystemData.value = payload.system || null;
  } catch (loadError) {
    if (requestId !== eventPreviewRequest) return;
    eventPreviewError.value = (loadError as Error).message;
  } finally {
    if (requestId === eventPreviewRequest) eventPreviewBusy.value = false;
  }
}

async function openManaged(kind: ProjectManagedEntry['kind'], id: number, group?: string) {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  detailDraft.value = null;
  try {
    if (kind === 'commonEvent' || (kind === 'database' && isCommonEventsGroup(group))) {
      await ensureCatalog();
      const entry = await commonEventsApi.get(id, projectStore.currentProject);
      pmDetail.value = { kind: 'managed', entry };
      detailDraft.value = cloneDraft(entry.value);
      return;
    }
    const [entry] = await Promise.all([
      projectManagement.getEntry({ kind, id, group }, projectStore.currentProject),
      kind === 'database' ? ensureCatalog() : Promise.resolve(null),
    ]);
    pmDetail.value = { kind: 'managed', entry };
    detailDraft.value = cloneDraft(entry.value);
  } catch (loadError) {
    detailError.value = (loadError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function createDatabaseEntry(group: string) {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  detailDraft.value = null;
  try {
    const entry = await projectManagement.createEntry({ kind: 'database', group }, projectStore.currentProject);
    resetCatalog();
    await ensureCatalog();
    pmDetail.value = { kind: 'managed', entry };
    detailDraft.value = cloneDraft(entry.value);
    await loadData();
  } catch (createError) {
    detailError.value = (createError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function createSelectedDatabaseEntry() {
  if (isCommonEventsGroup(selectedDbGroup.value)) {
    await createCommonEvent('数据库');
    return;
  }
  await createDatabaseEntry(selectedDbGroup.value);
}

async function createCommonEvent(targetCategory = '公共事件') {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  detailDraft.value = null;
  try {
    await ensureCatalog();
    const result = await commonEventsApi.create({
      name: '新建公共事件',
      trigger: 0,
      switchId: 0,
      list: [{ code: 0, indent: 0, parameters: [] }],
    }, projectStore.currentProject);
    resetCatalog();
    await ensureCatalog();
    pmDetail.value = { kind: 'managed', entry: result.entry };
    detailDraft.value = cloneDraft(result.entry.value);
    selected.value = targetCategory;
    showUnnamed.value = true;
    await loadData();
  } catch (createError) {
    detailError.value = (createError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function duplicateCurrentCommonEvent() {
  if (selectedCommonEventId.value == null) return;
  detailBusy.value = true;
  detailError.value = '';
  try {
    await ensureCatalog();
    const result = await commonEventsApi.duplicate(selectedCommonEventId.value, {}, projectStore.currentProject);
    resetCatalog();
    await ensureCatalog();
    pmDetail.value = { kind: 'managed', entry: result.entry };
    detailDraft.value = cloneDraft(result.entry.value);
    selected.value = '公共事件';
    showUnnamed.value = true;
    await loadData();
  } catch (duplicateError) {
    detailError.value = (duplicateError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function deleteCurrentCommonEvent() {
  if (selectedCommonEventId.value == null) return;
  const id = selectedCommonEventId.value;
  if (!window.confirm(`删除公共事件 #${String(id).padStart(4, '0')}？`)) return;
  detailBusy.value = true;
  detailError.value = '';
  try {
    await commonEventsApi.remove(id, {}, projectStore.currentProject);
    resetCatalog();
    closeDetail();
    await loadData();
  } catch (deleteError) {
    detailError.value = (deleteError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

function selectMapEvent(eventId: number) {
  closeDetail();
  selectedEventId.value = eventId;
}

function openMapEvent(mapId: number, eventId: number) {
  selectMapEvent(eventId);
  void openMapEventEditor(mapId, eventId);
}

function resolveAudioFileName(bucketKey: string, name: string): string | null {
  const bucket = assets.value?.audio?.[bucketKey];
  if (!bucket) return null;
  const exact = bucket.files.find((file) => file === name || file.startsWith(`${name}.`));
  if (exact) return exact;
  return bucket.files.find((file) => file.replace(/\.[^.]+$/, '') === name) || null;
}

function resolveImageFileName(bucketKey: string, name: string): string | null {
  const bucket = assets.value?.images?.[bucketKey];
  if (!bucket) return null;
  const exact = bucket.files.find((file) => file === name || file.startsWith(`${name}.`));
  if (exact) return exact;
  return bucket.files.find((file) => file.replace(/\.[^.]+$/, '') === name) || null;
}

function imageDetailCategory(bucketKey: string): string {
  if (bucketKey === 'sv_actors') return 'svActors';
  if (bucketKey === 'sv_enemies') return 'svEnemies';
  return bucketKey;
}

function imageCatalogKey(bucketKey: string): keyof EditorProjectCatalog['assets'] | null {
  const key = imageDetailCategory(bucketKey) as keyof EditorProjectCatalog['assets'];
  return editorCatalog.value?.assets[key] ? key : null;
}

function findDbPreviewAsset(preview: ProjectOverviewDbPreview) {
  const entries = editorCatalog.value?.assets[preview.asset] ?? [];
  const name = preview.name || '';
  return entries.find((asset) => (
    asset.name === name
    || asset.fileName === name
    || asset.fileName.replace(/\.[^.]+$/, '') === name
  )) || null;
}

function dbPreviewSubtitle(item: DatabaseGridItem): string {
  const id = `#${String(item.id).padStart(4, '0')}`;
  if (!item.preview) return id;
  return item.preview.label ? `${id} · ${item.preview.label}` : id;
}

function dbPreviewUsesSprite(preview?: ProjectOverviewDbPreview): boolean {
  return Boolean(preview && ['face', 'character', 'svActor', 'icon'].includes(preview.kind));
}

function dbPreviewSpriteStyle(preview: ProjectOverviewDbPreview, url: string): Record<string, string> {
  const image = `url("${url.replace(/"/g, '\\"')}")`;
  if (preview.kind === 'icon') {
    const iconIndex = Math.max(0, Math.floor(Number(preview.iconIndex || 0)));
    const cell = 52;
    const col = iconIndex % 16;
    const row = Math.floor(iconIndex / 16);
    return {
      backgroundImage: image,
      backgroundSize: `${16 * cell}px auto`,
      backgroundPosition: `-${col * cell}px -${row * cell}px`,
    };
  }
  if (preview.kind === 'face') {
    const index = clampInt(preview.index, 0, 7);
    const cell = 76;
    return {
      backgroundImage: image,
      backgroundSize: `${4 * cell}px ${2 * cell}px`,
      backgroundPosition: `-${(index % 4) * cell}px -${Math.floor(index / 4) * cell}px`,
    };
  }
  if (preview.kind === 'character') {
    const big = isBigCharacterName(preview.name || '');
    const index = clampInt(preview.index, 0, 7);
    const cell = 58;
    const cols = big ? 3 : 12;
    const rows = big ? 4 : 8;
    const blockX = big ? 1 : (index % 4) * 3 + 1;
    const blockY = big ? 0 : Math.floor(index / 4) * 4;
    return {
      backgroundImage: image,
      backgroundSize: `${cols * cell}px ${rows * cell}px`,
      backgroundPosition: `-${blockX * cell}px -${blockY * cell}px`,
    };
  }
  const cell = 58;
  return {
    backgroundImage: image,
    backgroundSize: `${9 * cell}px ${6 * cell}px`,
    backgroundPosition: `-${cell}px 0`,
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function isBigCharacterName(name: string): boolean {
  const sign = String(name || '').match(/^[!$]+/);
  return Boolean(sign && sign[0].includes('$'));
}

function projectRelativeAssetPath(bucketDir: string, fileName: string): string {
  const root = normalizePath(assets.value?.projectRoot || '');
  const dir = normalizePath(bucketDir);
  const prefix = root ? `${root}/` : '';
  const relativeDir = prefix && dir.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? dir.slice(prefix.length)
    : dir.replace(/^.*?(?:www\/)?img\//, (match) => match.endsWith('www/img/') ? 'www/img/' : 'img/');
  return `${relativeDir}/${fileName}`.replace(/\/+/g, '/').replace(/^\/+/, '');
}

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

async function openAudioDetail(bucketKey: string, name: string) {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  detailDraft.value = null;
  try {
    const fileName = resolveAudioFileName(bucketKey, name);
    if (!fileName) {
      pmDetail.value = {
        kind: 'audio',
        category: bucketKey,
        name,
        url: '',
        fileName: '',
        relativePath: '',
        missing: true,
      };
      return;
    }
    const relativePath = `www/audio/${bucketKey}/${fileName}`;
    const asset = await projectAssets.detail({ scope: 'project', category: bucketKey, relativePath }, projectStore.currentProject);
    pmDetail.value = {
      kind: 'audio',
      category: bucketKey,
      name: asset.name,
      url: asset.url || '',
      fileName: asset.fileName,
      relativePath: asset.relativePath,
    };
  } catch (loadError) {
    detailError.value = (loadError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function openImageDetail(bucketKey: string, name: string) {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  detailDraft.value = null;
  try {
    const fileName = resolveImageFileName(bucketKey, name);
    const bucket = assets.value?.images?.[bucketKey];
    if (!fileName || !bucket) {
      pmDetail.value = {
        kind: 'image',
        category: bucketKey,
        name,
        url: '',
        fileName: '',
        relativePath: '',
        missing: true,
      };
      return;
    }
    const relativePath = projectRelativeAssetPath(bucket.dir, fileName);
    const asset = await projectAssets.detail({ scope: 'project', category: imageDetailCategory(bucketKey), relativePath }, projectStore.currentProject);
    pmDetail.value = {
      kind: 'image',
      category: bucketKey,
      name: asset.name,
      url: asset.url || '',
      fileName: asset.fileName,
      relativePath: asset.relativePath,
    };
  } catch (loadError) {
    detailError.value = (loadError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function saveDetail() {
  if (!pmDetail.value) return;
  detailBusy.value = true;
  detailError.value = '';
  try {
    if (pmDetail.value.kind === 'managed') {
      const entry = pmDetail.value.entry;
      if (entry.kind === 'commonEvent') {
        const updated = await commonEventsApi.update(entry.id, detailDraft.value, projectStore.currentProject);
        pmDetail.value = { kind: 'managed', entry: updated.entry };
        detailDraft.value = cloneDraft(updated.entry.value);
      } else {
        const updated = await projectManagement.updateEntry({
          kind: entry.kind,
          group: entry.group,
          id: entry.id,
          value: detailDraft.value,
        }, projectStore.currentProject);
        pmDetail.value = { kind: 'managed', entry: updated };
        detailDraft.value = cloneDraft(updated.value);
      }
      if (entry.kind === 'database' || entry.kind === 'commonEvent') resetCatalog();
    }
    await loadData();
  } catch (saveError) {
    detailError.value = (saveError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

function openMapInEditor(mapId: number, eventId?: number) {
  const query: Record<string, string> = { mapId: String(mapId) };
  if (eventId) query.eventId = String(eventId);
  void router.push({ path: '/workbench', query });
}

function detailTitle(): string {
  if (!pmDetail.value) return '';
  if (pmDetail.value.kind === 'managed') {
    const entry = pmDetail.value.entry;
    return `${entry.kind === 'database' ? dbLabel(String(entry.group || '')) : managedKindLabels[entry.kind]} · #${entry.id}`;
  }
  if (pmDetail.value.kind === 'image') return `${imageBucketLabel(pmDetail.value.category)} · ${pmDetail.value.name}`;
  return `${pmDetail.value.category.toUpperCase()} · ${pmDetail.value.name}`;
}
</script>

<template>
  <div class="console-subpage">
    <div v-if="!projectStore.currentProject" class="state">请先在控制台添加 RPG Maker MV 项目。</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="loading" class="state">正在加载项目概览…</div>
    <div v-else class="console-split pm-split">
      <!-- Sidebar -->
      <aside class="console-panel pm-categories">
        <div class="console-panel-title">项目管理</div>
        <div class="pm-sidebar">
          <button
            v-for="cat in categories"
            :key="cat.name"
            type="button"
            class="folder"
            :class="{ active: selected === cat.name }"
            @click="selectCategory(cat.name)"
          >
            <!-- Map icon -->
            <svg v-if="cat.name === '地图与事件'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
            <!-- Switch icon -->
            <svg v-else-if="cat.name === '开关'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M8 7h8M8 12h8m-8 5h8M5 7h.01M5 12h.01M5 17h.01" /></svg>
            <!-- Variable icon -->
            <svg v-else-if="cat.name === '变量'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
            <!-- Common event icon -->
            <svg v-else-if="cat.name === '公共事件'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <!-- Audio icon -->
            <svg v-else-if="cat.name === '音频'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <!-- Image icon -->
            <svg v-else-if="cat.name === '图片'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 5h16v14H4z" /><path d="M8 13l2.2-2.2a1 1 0 011.4 0L17 16" /><path d="M14 10h.01" /></svg>
            <!-- Database icon -->
            <svg v-else-if="cat.name === '数据库'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
            <!-- Grid icon (overview) -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
            <span>{{ cat.name }}</span>
            <b>{{ cat.count }}</b>
          </button>
        </div>
        <div v-if="selected === '数据库'" class="pm-sub-pane">
          <button type="button" class="pm-sub-pane-toggle" @click="pmSubPaneExpanded = !pmSubPaneExpanded">
            <el-icon :class="{ collapsed: !pmSubPaneExpanded }"><ArrowRight /></el-icon>
            <span>数据类型</span>
            <b>{{ activeDbGroup.named.length }}</b>
          </button>
          <div v-show="pmSubPaneExpanded" class="pm-sub-list">
            <button
              v-for="opt in dbGroupOptions"
              :key="opt.key"
              type="button"
              class="sub-category-button"
              :class="{ active: opt.key === selectedDbGroup }"
              @click="selectDbGroup(opt.key)"
            >
              <span>{{ opt.label }}</span>
              <b>{{ opt.count }}</b>
            </button>
          </div>
        </div>
        <div v-else-if="selected === '音频'" class="pm-sub-pane">
          <button type="button" class="pm-sub-pane-toggle" @click="pmSubPaneExpanded = !pmSubPaneExpanded">
            <el-icon :class="{ collapsed: !pmSubPaneExpanded }"><ArrowRight /></el-icon>
            <span>音频类型</span>
            <b>{{ activeAudioBucket.names.length }}</b>
          </button>
          <div v-show="pmSubPaneExpanded" class="pm-sub-list">
            <button
              v-for="opt in audioBucketOptions"
              :key="opt.key"
              type="button"
              class="sub-category-button"
              :class="{ active: opt.key === selectedAudioBucket }"
              @click="selectAudioBucket(opt.key)"
            >
              <span>{{ opt.label }}</span>
              <b>{{ opt.count }}</b>
            </button>
          </div>
        </div>
        <div v-else-if="selected === '图片'" class="pm-sub-pane">
          <button type="button" class="pm-sub-pane-toggle" @click="pmSubPaneExpanded = !pmSubPaneExpanded">
            <el-icon :class="{ collapsed: !pmSubPaneExpanded }"><ArrowRight /></el-icon>
            <span>图片类型</span>
            <b>{{ activeImageBucket.names.length }}</b>
          </button>
          <div v-show="pmSubPaneExpanded" class="pm-sub-list">
            <button
              v-for="opt in imageBucketOptions"
              :key="opt.key"
              type="button"
              class="sub-category-button"
              :class="{ active: opt.key === selectedImageBucket }"
              @click="selectImageBucket(opt.key)"
            >
              <span>{{ opt.label }}</span>
              <b>{{ opt.count }}</b>
            </button>
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="console-panel">
        <div v-if="selected === '总览'" class="console-panel-title"><span>{{ selected }}</span></div>
        <div v-else class="console-list-header">
          <span>{{ pmListHeaderTitle }}</span>
          <ConsoleSearchInput v-model="searchQuery" :placeholder="pmSearchPlaceholder" />
        </div>
        <div class="console-panel-scroll pm-content">

          <!-- ========== 总览 ========== -->
          <template v-if="selected === '总览'">
            <div class="overview-grid">
              <button type="button" class="asset-card clickable" @click="selectCategory('地图与事件')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                </span>
                <span><strong>地图与事件</strong><small>{{ maps.length }} 张地图 · {{ totalEvents }} 个事件</small></span>
                <em>地图总览</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('开关')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h8M8 12h8m-8 5h8M5 7h.01M5 12h.01M5 17h.01" /></svg>
                </span>
                <span><strong>开关</strong><small>{{ switches.filter(s => s.name).length }} 项</small></span>
                <em>命名开关</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('变量')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                </span>
                <span><strong>变量</strong><small>{{ variables.filter(v => v.name).length }} 项</small></span>
                <em>命名变量</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('公共事件')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </span>
                <span><strong>公共事件</strong><small>{{ commonEvents.filter(e => e.name).length }} 项</small></span>
                <em>命名公共事件</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('音频')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </span>
                <span><strong>音频</strong><small>{{ audioTotal }} 项</small></span>
                <em>BGM / BGS / ME / SE</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('图片')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z" /><path d="M8 13l2.2-2.2a1 1 0 011.4 0L17 16" /><path d="M14 10h.01" /></svg>
                </span>
                <span><strong>图片</strong><small>{{ imageTotal }} 项</small></span>
                <em>img/* 素材</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('数据库')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                </span>
                <span><strong>数据库</strong><small>{{ dbTotal }} 项 · {{ dbSummary() }}</small></span>
                <em>数据索引</em>
              </button>
            </div>
          </template>

          <!-- ========== 地图与事件 ========== -->
          <template v-else-if="selected === '地图与事件'">
            <div class="map-split">
              <div class="map-list">
                <button
                  v-for="m in filteredMaps"
                  :key="m.id"
                  type="button"
                  class="map-item"
                  :class="{ active: selectedMapId === m.id }"
                  @click="selectMap(m.id)"
                >
                  <span class="map-name">{{ m.name }}</span>
                  <span class="badge">{{ m.eventCount }}</span>
                </button>
                <div v-if="!filteredMaps.length" class="empty-hint">{{ maps.length ? '无匹配地图' : '无地图数据' }}</div>
              </div>
              <div class="event-detail">
                <div v-if="selectedMapId" class="map-toolbar">
                  <button type="button" class="link-button" @click="openMapInEditor(selectedMapId)">在地图编辑器打开</button>
                  <button
                    v-if="eventDialogOpen && editorMapId === selectedMapId && eventDraft?.id"
                    type="button"
                    class="link-button"
                    @click="openMapInEditor(selectedMapId, eventDraft!.id)"
                  >查看位置</button>
                </div>
                <template v-if="selectedMapId && filteredMapEvents.length">
                  <div class="event-row event-header">
                    <span class="ev-id">ID</span>
                    <span class="ev-name">名称</span>
                    <span class="ev-pos">坐标</span>
                    <span class="ev-pages">页数</span>
                  </div>
                  <button
                    v-for="e in filteredMapEvents"
                    :key="e.id"
                    type="button"
                    class="event-row"
                    :class="{ active: selectedEventId === e.id, loading: eventLoading && selectedEventId === e.id }"
                    @click="selectMapEvent(e.id)"
                    @dblclick.prevent="openMapEvent(selectedMapId!, e.id)"
                  >
                    <span class="ev-id">{{ String(e.id).padStart(3, '0') }}</span>
                    <span class="ev-name">{{ e.name || '(未命名)' }}</span>
                    <span class="ev-pos">({{ e.x }}, {{ e.y }})</span>
                    <span class="ev-pages">{{ e.pageCount }}</span>
                  </button>
                </template>
                <div v-else-if="selectedMapId" class="empty-hint">{{ selectedMapEvents.length ? '无匹配事件' : '该地图无事件' }}</div>
                <div v-else class="empty-hint">选择左侧地图查看事件详情</div>
              </div>
            </div>
          </template>

          <!-- ========== 开关 ========== -->
          <template v-else-if="selected === '开关'">
            <div class="list-toolbar">
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> 显示未命名项</label>
            </div>
            <div class="id-list">
              <button v-for="s in filteredSwitches" :key="s.id" type="button" class="id-row" @click="openManaged('switch', s.id)">
                <span class="row-id">{{ String(s.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ s.name || '(未命名)' }}</span>
              </button>
              <div v-if="!filteredSwitches.length" class="empty-hint">无匹配项</div>
            </div>
          </template>

          <!-- ========== 变量 ========== -->
          <template v-else-if="selected === '变量'">
            <div class="list-toolbar">
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> 显示未命名项</label>
            </div>
            <div class="id-list">
              <button v-for="v in filteredVariables" :key="v.id" type="button" class="id-row" @click="openManaged('variable', v.id)">
                <span class="row-id">{{ String(v.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ v.name || '(未命名)' }}</span>
              </button>
              <div v-if="!filteredVariables.length" class="empty-hint">无匹配项</div>
            </div>
          </template>

          <!-- ========== 公共事件 ========== -->
          <template v-else-if="selected === '公共事件'">
            <div class="list-toolbar">
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> 显示未命名项</label>
              <div class="toolbar-actions">
                <button type="button" @click="createCommonEvent()">新建</button>
                <button type="button" :disabled="selectedCommonEventId == null" @click="duplicateCurrentCommonEvent">复制</button>
                <button type="button" class="danger" :disabled="selectedCommonEventId == null" @click="deleteCurrentCommonEvent">删除</button>
              </div>
            </div>
            <div class="id-list">
              <button
                v-for="ce in filteredCommonEvents"
                :key="ce.id"
                type="button"
                class="id-row ce-row"
                @click="openManaged('commonEvent', ce.id)"
                @contextmenu.prevent="openManaged('commonEvent', ce.id)"
              >
                <span class="row-id">{{ String(ce.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ ce.name || '(未命名)' }}</span>
              </button>
              <div v-if="!filteredCommonEvents.length" class="empty-hint">无匹配项</div>
            </div>
          </template>

          <!-- ========== 音频 ========== -->
          <template v-else-if="selected === '音频'">
            <div class="id-list">
              <button
                v-for="n in visibleAudioNames"
                :key="n"
                type="button"
                class="id-row audio-row"
                @click="openAudioDetail(selectedAudioBucket, n)"
              >
                <span class="row-name">{{ n }}</span>
              </button>
              <button
                v-if="hasMoreAudioNames"
                type="button"
                class="load-more"
                @click="showMoreGroupItems('audio', selectedAudioBucket, activeAudioBucket.names.length)"
              >
                再显示 {{ remainingAudioNames }} 项
              </button>
              <div v-if="!visibleAudioNames.length" class="empty-hint">
                {{ assets?.audio?.[selectedAudioBucket] ? '无匹配音频' : '无音频数据' }}
              </div>
            </div>
          </template>

          <!-- ========== 图片 ========== -->
          <template v-else-if="selected === '图片'">
            <div class="image-grid">
              <button
                v-for="item in visibleImageGridItems"
                :key="item.name"
                type="button"
                class="image-grid-card"
                :class="{ active: activeImageKey === `${selectedImageBucket}:${item.name}`, missing: item.missing }"
                @click="openImageDetail(selectedImageBucket, item.name)"
              >
                <span class="image-grid-thumb">
                  <img v-if="item.url" :src="item.url" :alt="item.name" />
                  <span v-else class="image-grid-missing">无预览</span>
                </span>
                <span class="image-grid-meta">
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.fileName || '文件缺失' }}</small>
                </span>
              </button>
              <button
                v-if="hasMoreImageNames"
                type="button"
                class="load-more image-grid-more"
                @click="showMoreGroupItems('image', selectedImageBucket, activeImageBucket.names.length)"
              >
                再显示 {{ remainingImageNames }} 项
              </button>
              <div v-if="!visibleImageNames.length" class="empty-hint">
                {{ assets?.images?.[selectedImageBucket] ? '无匹配图片' : '无图片数据' }}
              </div>
            </div>
          </template>

          <!-- ========== 数据库 ========== -->
          <template v-else-if="selected === '数据库'">
            <div class="list-toolbar database-toolbar">
              <span>{{ dbLabel(selectedDbGroup) }} · {{ activeDbGroup.named.length }} 项</span>
              <button
                v-if="canCreateSelectedDbGroup"
                type="button"
                class="link-button"
                :disabled="detailBusy"
                @click="createSelectedDatabaseEntry"
              >
                新增
              </button>
            </div>
            <div v-if="activeDbUsesGrid" class="image-grid database-grid">
              <button
                v-for="entry in visibleDbGridItems"
                :key="entry.id"
                type="button"
                class="image-grid-card database-grid-card"
                :class="{ active: activeDbKey === `${selectedDbGroup}:${entry.id}`, missing: entry.missing || !entry.preview }"
                @click="openManaged('database', entry.id, selectedDbGroup)"
              >
                <span class="image-grid-thumb database-grid-thumb">
                  <span
                    v-if="entry.url && entry.preview && dbPreviewUsesSprite(entry.preview)"
                    class="db-preview-sprite"
                    :class="`kind-${entry.preview.kind}`"
                    :style="dbPreviewSpriteStyle(entry.preview, entry.url)"
                  />
                  <img v-else-if="entry.url" :src="entry.url" :alt="entry.name" />
                  <span v-else class="image-grid-missing">无预览</span>
                </span>
                <span class="image-grid-meta">
                  <strong>{{ entry.name }}</strong>
                  <small>{{ dbPreviewSubtitle(entry) }}</small>
                </span>
              </button>
              <button
                v-if="hasMoreDbEntries"
                type="button"
                class="load-more image-grid-more"
                @click="showMoreGroupItems('database', selectedDbGroup, activeDbGroup.named.length)"
              >
                再显示 {{ remainingDbEntries }} 项
              </button>
              <div v-if="!visibleDbEntries.length" class="empty-hint">
                {{ database[selectedDbGroup] ? '无匹配条目' : '无数据库数据' }}
              </div>
            </div>
            <div v-else class="id-list">
              <button
                v-for="entry in visibleDbEntries"
                :key="entry.id"
                type="button"
                class="id-row"
                @click="openManaged('database', entry.id, selectedDbGroup)"
              >
                <span class="row-id">{{ String(entry.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ entry.name }}</span>
              </button>
              <button
                v-if="hasMoreDbEntries"
                type="button"
                class="load-more"
                @click="showMoreGroupItems('database', selectedDbGroup, activeDbGroup.named.length)"
              >
                再显示 {{ remainingDbEntries }} 项
              </button>
              <div v-if="!visibleDbEntries.length" class="empty-hint">
                {{ database[selectedDbGroup] ? '无匹配条目' : '无数据库数据' }}
              </div>
            </div>
          </template>

        </div>
      </main>

      <aside class="console-panel pm-detail" aria-label="项目条目详情">
          <header>
            <div>
              <strong>项目条目详情</strong>
              <span v-if="pmDetail">{{ detailTitle() }}</span>
              <span v-else-if="selectedEvent">事件 · #{{ selectedEvent.id }}</span>
              <span v-else-if="selectedMap">地图 · #{{ selectedMap.id }}</span>
              <span v-else>选择条目后在这里修改</span>
            </div>
            <button v-if="pmDetail || detailError || selectedEvent" type="button" @click="clearDetailPanel">×</button>
          </header>
          <div v-if="detailBusy && !pmDetail" class="empty-hint">正在读取完整条目…</div>
          <div v-else-if="pmDetail?.kind === 'audio'" class="pm-detail-body audio-detail">
            <dl class="audio-facts">
              <dt>类型</dt><dd>{{ pmDetail.category.toUpperCase() }}</dd>
              <dt>文件名</dt><dd>{{ pmDetail.fileName || '—' }}</dd>
              <dt>路径</dt><dd>{{ pmDetail.relativePath || '—' }}</dd>
            </dl>
            <audio v-if="pmDetail.url" :src="pmDetail.url" controls />
            <div v-else class="empty-hint">工程内找不到该音频文件</div>
          </div>
          <div v-else-if="pmDetail?.kind === 'image'" class="pm-detail-body image-detail">
            <dl class="audio-facts">
              <dt>类型</dt><dd>{{ imageBucketLabel(pmDetail.category) }}</dd>
              <dt>文件名</dt><dd>{{ pmDetail.fileName || '—' }}</dd>
              <dt>路径</dt><dd>{{ pmDetail.relativePath || '—' }}</dd>
            </dl>
            <div v-if="pmDetail.url" class="image-preview-frame">
              <img :src="pmDetail.url" :alt="pmDetail.name" />
            </div>
            <div v-else class="empty-hint">工程内找不到该图片文件</div>
          </div>
          <div v-else-if="pmDetail?.kind === 'managed' && pmDetail.entry.kind === 'commonEvent'" class="pm-detail-body">
            <CommonEventDetailEditor v-model="detailDraft" :catalog="editorCatalog" :load-image="loadImage" />
          </div>
          <div v-else-if="pmDetail?.kind === 'managed' && pmDetail.entry.kind === 'database'" class="pm-detail-body">
            <DatabaseEntryDetailEditor v-model="detailDraft" :group="pmDetail.entry.group" :catalog="editorCatalog" :schema="pmDetail.entry.schema" :load-image="loadImage" />
          </div>
          <div v-else-if="pmDetail && detailEditable" class="pm-detail-body">
            <StructuredFieldsEditor v-model="detailDraft" label="条目字段" />
          </div>
          <div v-else-if="selectedEvent && selectedMapId" class="pm-detail-body event-inspector">
            <dl class="detail-facts">
              <dt>事件 ID</dt><dd>{{ String(selectedEvent.id).padStart(3, '0') }}</dd>
              <dt>名称</dt><dd>{{ selectedEvent.name || '(未命名)' }}</dd>
              <dt>地图</dt><dd>{{ selectedMap?.name || `Map${selectedMapId}` }}</dd>
              <dt>坐标</dt><dd>({{ selectedEvent.x }}, {{ selectedEvent.y }})</dd>
              <dt>页数</dt><dd>{{ selectedEvent.pageCount }}</dd>
            </dl>
            <div v-if="eventPreviewBusy" class="event-preview-state">正在读取执行内容…</div>
            <div v-else-if="eventPreviewError" class="detail-error event-preview-error">执行内容读取失败：{{ eventPreviewError }}</div>
            <MapEventCommandPreview
              v-else-if="eventPreviewEvent"
              :event="eventPreviewEvent"
              :system-data="eventPreviewSystemData"
            />
            <div v-else class="event-preview-state">暂无执行内容。</div>
            <div class="detail-actions">
              <button type="button" class="secondary-button" @click="openMapEvent(selectedMapId, selectedEvent.id)">打开事件编辑器</button>
              <button type="button" class="secondary-button" @click="openMapInEditor(selectedMapId, selectedEvent.id)">查看地图位置</button>
            </div>
          </div>
          <div v-else-if="selected === '地图与事件' && selectedMap" class="pm-detail-body event-inspector">
            <dl class="detail-facts">
              <dt>地图 ID</dt><dd>{{ String(selectedMap.id).padStart(3, '0') }}</dd>
              <dt>名称</dt><dd>{{ selectedMap.name }}</dd>
              <dt>事件数</dt><dd>{{ selectedMap.eventCount }}</dd>
            </dl>
            <div class="detail-actions">
              <button type="button" class="secondary-button" @click="openMapInEditor(selectedMap.id)">打开地图编辑器</button>
            </div>
            <p class="detail-note">选择中间事件列表中的条目，可在这里查看事件详情。</p>
          </div>
          <div v-else-if="detailError && !pmDetail" class="detail-error">{{ detailError }}</div>
          <div v-else class="detail-empty">从中间列表选择地图、事件、开关、变量、公共事件、数据库、音频或图片。</div>
          <div v-if="detailError && pmDetail" class="detail-error">{{ detailError }}</div>
          <footer v-if="pmDetail">
            <template v-if="pmDetail.kind === 'audio' || pmDetail.kind === 'image'">
              <span>仅预览工程内{{ pmDetail.kind === 'audio' ? '音频' : '图片' }}，不会修改文件。</span>
            </template>
            <template v-else>
              <span>保存后进入项目暂存，可统一应用或丢弃。</span>
              <button type="button" :disabled="detailBusy" @click="saveDetail">
                {{ detailBusy ? '保存中…' : '保存修改' }}
              </button>
            </template>
          </footer>
        </aside>
    </div>

    <EventEditorDialog
      :ref="bindEventDialogRef"
      :visible="eventDialogOpen"
      :draft="eventDraft"
      :saving="eventSaving"
      :map-id="editorMapId"
      :system-data="systemData"
      :catalog="editorCatalog"
      :tileset-images="tilesetImages"
      :load-image="loadImage"
      :overview="eventOverview"
      @close="closeEventEditor"
      @save="saveEvent"
    />
  </div>
</template>

<style scoped>
/* Layout */
.pm-split {
  grid-template-columns: 230px minmax(0, 1fr) 360px;
  padding: 14px 40px 34px;
  gap: 22px;
  overflow: hidden;
}

/* Sidebar folder buttons (same pattern as ConsoleAssetsPane) */
.pm-categories {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pm-sidebar { flex: 0 0 auto; min-height: 0; overflow: auto; padding: 4px; }
.pm-sub-pane {
  min-height: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  border-top: 1px solid var(--console-border,#e4dcce);
  overflow: hidden;
}
.pm-sub-pane-toggle {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--console-text-muted,#9a8e7e);
  font: inherit;
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;
}
.pm-sub-pane-toggle:hover { background: #f1e9db; color: var(--console-text-soft,#5a5247); }
.pm-sub-pane-toggle b { margin-left: auto; color: var(--console-text-faint,#b3a795); font-size: 10px; font-weight: 500; }
.pm-sub-pane-toggle .el-icon { width: 12px; transition: transform .15s ease; }
.pm-sub-pane-toggle .el-icon.collapsed { transform: rotate(0deg); }
.pm-sub-pane-toggle .el-icon:not(.collapsed) { transform: rotate(90deg); }
.pm-sub-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 6px 8px; }
.sub-category-button {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--console-text-soft,#5a5247);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.sub-category-button:hover,
.sub-category-button.active {
  background: var(--console-accent-soft,#f6e3d7);
  color: var(--console-accent,#be5630);
}
.sub-category-button.active { font-weight: 650; }
.sub-category-button b { margin-left: auto; color: var(--console-text-faint,#b3a795); font-size: 10px; }
.sub-category-button:focus-visible,
.pm-sub-pane-toggle:focus-visible { outline: none; box-shadow: var(--app-ring); }
.folder {
  width: 100%; height: 34px; display: flex; align-items: center; gap: 7px;
  padding: 0 10px; border: 1px solid transparent; border-radius: 9px;
  background: transparent; color: var(--console-text-soft,#5a5247); font: inherit; font-size: 12px; cursor: pointer;
}
.folder:hover, .folder.active { background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); }
.folder-icon { width: 13px; height: 13px; flex: 0 0 13px; }
.folder b { margin-left: auto; color: var(--console-text-faint,#b3a795); font-size: 10px; }

.pm-content { padding: 0; }

/* Overview card grid */
.overview-grid { padding: 12px; }
.asset-card {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  margin-bottom: 8px; padding: 13px 15px;
  border: 1px solid var(--console-border,#e4dcce); border-radius: 11px;
  background: var(--console-paper,#fffdfa);
  color: inherit;
  font: inherit;
  text-align: left;
}
.asset-card:hover { border-color: #d2a88c; background: #fbf1e9; }
.asset-card.clickable { cursor: pointer; }
.asset-card.clickable:focus-visible { outline: none; box-shadow: var(--app-ring); }
.map-toolbar { display: flex; gap: 12px; padding: 8px 10px 0; }
.link-button { border: 0; background: transparent; color: var(--console-accent,#be5630); font: inherit; font-size: 10.5px; cursor: pointer; }
.link-button:hover { text-decoration: underline; }
.audio-detail,
.image-detail { display: flex; flex-direction: column; gap: 12px; }
.audio-facts { display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 7px 10px; margin: 0; font-size: 10.5px; }
.audio-facts dt { color: var(--app-ink-muted); }
.audio-facts dd { margin: 0; word-break: break-word; }
.audio-detail audio { width: 100%; }
.image-preview-frame {
  min-height: 180px;
  display: grid;
  place-items: center;
  padding: 12px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 10px;
  background-color: #d7d0c5;
  background-image:
    linear-gradient(45deg, rgba(255,255,255,.45) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255,255,255,.45) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255,255,255,.45) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.45) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  overflow: auto;
}
.image-preview-frame img {
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
  image-rendering: pixelated;
}
.pm-detail>footer .secondary-button { margin-left: auto; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--app-bg); color: var(--app-ink); padding: 8px 12px; cursor: pointer; }
.pm-detail>footer .secondary-button + button { margin-left: 8px; }
.asset-thumb {
  width: 42px; height: 42px; display: grid; place-items: center; flex: 0 0 42px;
  border-radius: 12px; background: #f7e7dc; color: var(--console-accent,#be5630);
}
.asset-thumb svg { width: 20px; height: 20px; }
.asset-card span:nth-child(2) { min-width: 0; display: flex; flex: 1; flex-direction: column; }
.asset-card strong { font-size: 12px; }
.asset-card small, .asset-card em { color: var(--console-text-muted,#9a8e7e); font-size: 10px; font-style: normal; }

/* Map & events split */
.map-split {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 1px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--console-border,#e4dcce);
}
.map-list { min-height: 0; background: var(--console-paper,#fffdfa); overflow: auto; padding: 6px; }
.map-item {
  width: 100%; display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border: none; border-radius: var(--app-radius-sm);
  background: transparent; color: var(--console-text-soft,#5a5247); font: inherit; font-size: 11px;
  cursor: pointer; text-align: left;
}
.map-item:hover { background: #f1e9db; }
.map-item.active { background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); }
.map-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge {
  font-size: 10px; padding: 1px 6px; border-radius: var(--app-radius-pill);
  background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); font-weight: 600;
}
.event-detail { min-width: 0; min-height: 0; background: var(--console-paper,#fffdfa); padding: 8px; overflow: auto; }
.event-row {
  display: grid; grid-template-columns: 48px 1fr 80px 40px; gap: 8px;
  align-items: center; padding: 4px 6px; font-size: 11px; border-radius: var(--app-radius-sm);
}
.event-row:not(.event-header){width:100%;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.event-row:hover:not(.event-header) { background: #f1e9db; }
.event-row.active { background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); }
.event-row.loading { opacity: .65; cursor: wait; }
.event-header { font-weight: 650; color: var(--console-text-muted,#9a8e7e); font-size: 10px; border-bottom: 1px solid var(--console-border,#e4dcce); }
.ev-id { font-family: var(--app-font-mono); font-weight: 600; font-size: 10px; color: var(--console-accent,#be5630); }
.ev-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-pos, .ev-pages { color: var(--console-text-muted,#9a8e7e); font-size: 10px; font-family: var(--app-font-mono); }

/* List toolbar */
.list-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--console-border,#e4dcce); }
.database-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.database-toolbar .link-button:disabled { opacity: .55; cursor: wait; text-decoration: none; }
.toggle-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--console-text-soft,#5a5247); cursor: pointer;
}
.toggle-label input { accent-color: var(--app-accent); }
.toolbar-actions { display: flex; align-items: center; gap: 6px; }
.toolbar-actions button {
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 8px;
  background: var(--console-paper,#fffdfa);
  color: var(--console-text-soft,#5a5247);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.toolbar-actions button:hover:not(:disabled) { border-color: #d2a88c; color: var(--console-accent,#be5630); }
.toolbar-actions button:disabled { opacity: .45; cursor: not-allowed; }
.toolbar-actions button.danger:hover:not(:disabled) { border-color: var(--app-danger); color: var(--app-danger); }

/* ID-based list (switches / variables / common events) */
.id-list { padding: 4px 8px; }
.id-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; font-size: 11px; border-radius: var(--app-radius-sm);
}
.id-row{width:100%;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.id-row:hover { background: #f1e9db; }
.row-id { font-family: var(--app-font-mono); font-weight: 600; font-size: 10px; color: var(--console-accent,#be5630); min-width: 40px; }
.row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audio-row .row-name,
.image-row .row-name { flex: 1; min-width: 0; }
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
  padding: 12px;
  align-content: start;
}
.image-grid-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 10px;
  background: var(--console-paper,#fffdfa);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.image-grid-card:hover {
  border-color: #d2a88c;
  background: #fbf1e9;
}
.image-grid-card.active {
  border-color: var(--console-accent,#be5630);
  box-shadow: inset 0 0 0 1px var(--console-accent,#be5630);
}
.image-grid-card.missing { opacity: .72; }
.image-grid-card:focus-visible { outline: none; box-shadow: var(--app-ring); }
.image-grid-card.active:focus-visible {
  box-shadow: inset 0 0 0 1px var(--console-accent,#be5630), var(--app-ring);
}
.image-grid-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid #ded4c5;
  border-radius: 8px;
  background-color: #ddd5ca;
  background-image:
    linear-gradient(45deg, rgba(255,255,255,.55) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255,255,255,.55) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255,255,255,.55) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.55) 75%);
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
  background-size: 14px 14px;
}
.image-grid-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.image-grid-missing {
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.image-grid-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.image-grid-meta strong,
.image-grid-meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-grid-meta strong { font-size: 11.5px; font-weight: 650; }
.image-grid-meta small { color: var(--console-text-muted,#9a8e7e); font-size: 10px; }
.image-grid-more { grid-column: 1 / -1; }
.database-grid .empty-hint { grid-column: 1 / -1; }
.database-grid-thumb .db-preview-sprite {
  display: block;
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
.db-preview-sprite.kind-icon {
  width: 52px;
  height: 52px;
  border-radius: 8px;
}
.db-preview-sprite.kind-face {
  width: 76px;
  height: 76px;
}
.db-preview-sprite.kind-character,
.db-preview-sprite.kind-svActor {
  width: 58px;
  height: 58px;
}
.load-more {
  width: 100%;
  padding: 9px;
  border: 0;
  background: transparent;
  color: var(--console-accent,#be5630);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.load-more:hover { background: #fbf1e9; }
.pm-detail {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--console-paper,#fffdfa);
}
.pm-detail>header {
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-bottom: 1px solid var(--console-border,#e4dcce);
}
.pm-detail>header div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pm-detail>header strong {
  color: var(--console-text,#211d17);
  font-size: 13px;
  font-weight: 650;
}
.pm-detail>header span {
  overflow: hidden;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pm-detail>header button {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.pm-detail>header button:hover { color: var(--console-accent,#be5630); }
.pm-detail-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 14px;
}
.pm-detail>footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-top: 1px solid var(--console-border,#e4dcce);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.pm-detail>footer button {
  margin-left: auto;
  border: 0;
  border-radius: 9px;
  background: var(--console-accent,#be5630);
  color: white;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
}
.pm-detail>footer button:disabled { opacity: .6; cursor: wait; }
.detail-facts {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px 10px;
  margin: 0;
  font-size: 11px;
}
.detail-facts dt { color: var(--console-text-muted,#9a8e7e); }
.detail-facts dd { min-width: 0; margin: 0; color: var(--console-text-soft,#5a5247); word-break: break-word; }
.event-preview-state {
  display: grid;
  place-items: center;
  min-height: 96px;
  margin-top: 16px;
  border: 1px solid var(--console-border,#e4dcce);
  border-radius: 10px;
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
  text-align: center;
}
.event-preview-error {
  margin-top: 16px;
  border: 1px solid color-mix(in srgb, var(--app-danger) 38%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-danger) 8%, transparent);
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.secondary-button {
  min-height: 30px;
  border: 1px solid var(--console-border-strong,#ddd3c2);
  border-radius: 9px;
  background: var(--console-paper-soft,#faf5ec);
  color: var(--console-text-soft,#5a5247);
  padding: 0 10px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.secondary-button:hover {
  border-color: #d2a88c;
  color: var(--console-accent,#be5630);
}
.detail-note {
  margin: 14px 0 0;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 11px;
  line-height: 1.55;
}
.detail-empty {
  display: grid;
  place-items: center;
  flex: 1;
  min-height: 0;
  padding: 22px;
  color: var(--console-text-muted,#9a8e7e);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
.detail-error{padding:12px;color:var(--app-danger);font-size:11px}

@media (max-width: 1320px) {
  .pm-split {
    grid-template-columns: 210px minmax(0, 1fr) 320px;
    padding-inline: 28px;
    gap: 16px;
  }
  .map-split { grid-template-columns: 190px minmax(0, 1fr); }
}

/* States */
.state { display: grid; place-items: center; flex: 1; color: var(--app-ink-muted); }
.state.error { color: var(--app-danger); }
.empty-hint { color: var(--app-ink-muted); font-size: 12px; padding: 12px 0; text-align: center; }
</style>
