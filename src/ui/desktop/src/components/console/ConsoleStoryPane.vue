<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useProjectStore } from '../../stores/project';
import { useRoute, useRouter } from 'vue-router';
import {
  commonEvents as commonEventsApi,
  maps as mapsApi,
  projectAssets,
  projectManagement,
  workspaceSurfaces,
  playtest,
  type InteractiveBattleTestBattler,
  type InteractiveParticleAnimationPreview,
  type EditorProjectCatalog,
  type ManagedAssetDetail,
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
import { createDraftHistory } from '../../utils/draft-history';
import { useWorkbenchUiStore } from '../../stores/workbenchUi';
import { findEditorMapEvent, type MvEditorEvent } from '../../composables/useEventEditor';
import { usePmEventEditor } from '../../composables/usePmEventEditor';
import EventEditorDialog from '../editor/EventEditorDialog.vue';
import StructuredFieldsEditor from './StructuredFieldsEditor.vue';
import CommonEventDetailEditor from './CommonEventDetailEditor.vue';
import DatabaseEntryDetailEditor from './DatabaseEntryDetailEditor.vue';
import BattleTestSetupDialog from './BattleTestSetupDialog.vue';
import StagedEntryInspection from './StagedEntryInspection.vue';
import MapEventCommandPreview from './MapEventCommandPreview.vue';
import ConsoleSearchInput from './ConsoleSearchInput.vue';
import { useI18n } from '../../i18n';
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error';
import {
  IMAGE_BUCKET_LABELS,
  MANAGED_KIND_LABELS,
  newCommonEventName,
  STORY_CATEGORY_LABELS,
  type StoryCategoryId,
} from '../../utils/consoleStoryLocalization';
import { databaseFieldLabel, databaseGroupLabel } from '../../utils/rmmvDatabaseLocalization';
import { parseProjectStagingSummary, type ProjectStagingSummary } from '../../utils/projectStaging';
import { LatestAsyncCoordinator } from '../../utils/latestAsyncCoordinator';
import { normalizeProjectManagementSection } from '../../utils/projectManagementRoute';

type PmDetail =
  | { kind: 'managed'; entry: ProjectManagedEntry }
  | { kind: 'audio'; category: string; name: string; url: string; fileName: string; relativePath: string; missing?: boolean; staged?: boolean; references?: ManagedAssetDetail['references']; size?: number }
  | { kind: 'image'; category: string; name: string; url: string; fileName: string; relativePath: string; missing?: boolean; staged?: boolean; references?: ManagedAssetDetail['references']; size?: number };

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
const workbenchUi = useWorkbenchUiStore();
const route = useRoute();
const router = useRouter();
const { language, t } = useI18n();
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

const stagingDirty = ref(false);
const stagingBusy = ref(false);

function isProjectStagingDirty(status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  return Boolean((status as { staged?: boolean }).staged);
}

async function confirmAgentOperations(summary: ProjectStagingSummary): Promise<boolean> {
  if (!summary.operations.length) return true;
  const operations = summary.operations
    .map((operation) => t('story.agentOperationSummary', {
      operationId: operation.operationId,
      count: operation.files.length,
    }))
    .join('\n');
  try {
    await ElMessageBox.confirm(
      t('story.applyAgentOperationsConfirm', { operations }),
      t('story.applyAgentOperationsTitle'),
      { type: 'warning' },
    );
    return true;
  } catch {
    return false;
  }
}

async function refreshStagingStatus() {
  if (!projectStore.currentProject) {
    stagingDirty.value = false;
    workbenchUi.sbStagingDirty = false;
    return;
  }
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject);
    stagingDirty.value = isProjectStagingDirty(status);
    workbenchUi.sbStagingDirty = stagingDirty.value;
  } catch {
    /* staging status does not block project management */
  }
}

async function applyProjectStaging() {
  if (!projectStore.currentProject || stagingBusy.value || surfaceWriteLocked.value) return;
  stagingBusy.value = true;
  detailError.value = '';
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject);
    const summary = parseProjectStagingSummary(status);
    if (!await confirmAgentOperations(summary)) return;
    const result = await mapsApi.applyProjectStaging(
      projectStore.currentProject,
      summary.operations.map((operation) => operation.operationId),
    ) as { canceled?: boolean };
    if (result?.canceled) return;
    await refreshStagingStatus();
    await loadData();
  } catch (applyError) {
    detailError.value = (applyError as Error).message;
  } finally {
    stagingBusy.value = false;
  }
}

async function discardProjectStaging() {
  if (!projectStore.currentProject || stagingBusy.value) return;
  stagingBusy.value = true;
  detailError.value = '';
  try {
    await mapsApi.discardProjectStaging(projectStore.currentProject);
    pmDetail.value = null;
    resetDetailDraft(null);
    await refreshStagingStatus();
    await loadData();
  } catch (discardError) {
    detailError.value = (discardError as Error).message;
  } finally {
    stagingBusy.value = false;
  }
}

async function revertCurrentStagedEntry() {
  if (pmDetail.value?.kind !== 'managed' || !projectStore.currentProject || detailBusy.value) return;
  const current = pmDetail.value.entry;
  detailBusy.value = true;
  detailError.value = '';
  try {
    const result = await projectManagement.revertEntry({
      kind: current.kind,
      group: current.group,
      id: current.id,
    }, projectStore.currentProject);
    if (result.entry) {
      pmDetail.value = { kind: 'managed', entry: result.entry };
      resetDetailDraft(cloneDraft(result.entry.value));
    } else {
      closeDetail();
    }
    if (current.kind === 'database' || current.kind === 'commonEvent') {
      resetCatalog();
      await ensureCatalog();
    }
    await loadData();
    await refreshStagingStatus();
  } catch (revertError) {
    detailError.value = (revertError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}


function formatErrorText(errorValue: unknown): string {
  return formatUserFacingErrorMessage(errorValue, 'general', language.value);
}

const loading = ref(false);
const validating = ref(false);
const refreshing = ref(false);
const error = ref<string | null>(null);
const overview = ref<ProjectOverview | null>(null);
const overviewCoordinator = new LatestAsyncCoordinator<{ project: string }>();
let surfaceActive = false;
let surfaceVersion = '';
let activationSequence = 0;
const draftConflict = ref(false);

const surfaceInteractionLocked = computed(() => refreshing.value || Boolean(error.value && overview.value));
const surfaceWriteLocked = computed(() => surfaceInteractionLocked.value || draftConflict.value);

async function loadData(startVersion?: string) {
  const project = projectStore.currentProject;
  if (!project) {
    overviewCoordinator.invalidate({ project: '' });
    overview.value = null;
    error.value = null;
    loading.value = false;
    return;
  }
  const token = overviewCoordinator.begin({ project });
  const preserveOverview = Boolean(overview.value);
  loading.value = !preserveOverview;
  refreshing.value = preserveOverview;
  validating.value = false;
  error.value = null;
  try {
    const version = startVersion || (await workspaceSurfaces.validate({ surface: 'projectManagement' }, project)).version;
    const nextOverview = await projectManagement.overview(project);
    if (!overviewCoordinator.isCurrent(token) || projectStore.currentProject !== project) return;
    const settled = await workspaceSurfaces.validate({
      surface: 'projectManagement',
      loadedVersion: version,
    }, project);
    if (!settled.unchanged) throw new Error(t('story.workspaceChangedDuringLoad'));
    surfaceVersion = settled.version;
    await refreshStagingStatus();
    if (!overviewCoordinator.isCurrent(token) || projectStore.currentProject !== project) return;
    overview.value = nextOverview;
  } catch (e) {
    if (!overviewCoordinator.isCurrent(token) || projectStore.currentProject !== project) return;
    error.value = (e as Error).message;
  } finally {
    if (overviewCoordinator.isCurrent(token)) {
      loading.value = false;
      refreshing.value = false;
      validating.value = false;
    }
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
const selected = ref<StoryCategoryId>('overview');
const searchQuery = ref('');
const selectedDbGroup = ref('Actors');
const selectedDbSubField = ref('');
const selectedAudioBucket = ref('bgm');
const selectedImageBucket = ref('pictures');
const pmSubPaneExpanded = ref(true);
const showUnnamed = ref(false);

const dbContextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  entryId: number;
} | null>(null);

let dbClipboard: { group: string; value: Record<string, unknown> } | null = null;

const DB_GROUP_ORDER = [
  'Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors',
  'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents',
  'System', 'Types', 'Terms',
] as const;

const DOCUMENT_DATABASE_GROUPS = new Set(['System', 'Types', 'Terms']);
const TYPES_SUBFIELD_ORDER = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'] as const;
const TERMS_SUBFIELD_ORDER = ['basic', 'params', 'commands', 'messages'] as const;
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
const battleTestDialogVisible = ref(false);
const battleTestBusy = ref(false);
const particlePreviewBusy = ref(false);
const temporaryBattleback1Name = ref('');
const temporaryBattleback2Name = ref('');
let battleContextProject = '';
const detailEditable = computed(() => pmDetail.value?.kind === 'managed');
const draftHistory = createDraftHistory<unknown>(null);
const draftUndoCount = ref(0);
const draftRedoCount = ref(0);
let activeDraftMergeKey: string | null = null;
let activeDraftTextControl: HTMLInputElement | HTMLTextAreaElement | null = null;
let draftFocusSequence = 0;
const supportsDraftHistory = computed(() => (
  pmDetail.value?.kind === 'managed'
  && (pmDetail.value.entry.kind === 'database' || pmDetail.value.entry.kind === 'commonEvent')
));
const canUndoDraft = computed(() => supportsDraftHistory.value && draftUndoCount.value > 0);
const canRedoDraft = computed(() => supportsDraftHistory.value && draftRedoCount.value > 0);
const hasUnsavedDraft = computed(() => {
  void detailDraft.value;
  return supportsDraftHistory.value && draftHistory.dirty;
});
const canRevertCurrentStagedEntry = computed(() => (
  pmDetail.value?.kind === 'managed'
  && Boolean(pmDetail.value.entry.inspection?.changed)
  && !pmDetail.value.entry.inspection?.operationId
));
const currentTroopName = computed(() => {
  const entry = pmDetail.value?.kind === 'managed' ? pmDetail.value.entry : null;
  if (!entry || entry.group !== 'Troops') return '';
  const draft = detailDraft.value && typeof detailDraft.value === 'object' && !Array.isArray(detailDraft.value)
    ? detailDraft.value as Record<string, unknown>
    : {};
  return String(draft.name || `#${entry.id}`);
});
const eventPreviewBusy = ref(false);
const eventPreviewError = ref('');
const eventPreviewEvent = ref<MvEditorEvent | null>(null);
const eventPreviewSystemData = ref<{ switches: string[]; variables: string[] } | null>(null);
let eventPreviewRequest = 0;

function syncDraftHistoryCounts(): void {
  draftUndoCount.value = draftHistory.undoCount;
  draftRedoCount.value = draftHistory.redoCount;
}

function resetDetailDraft(value: unknown): void {
  activeDraftMergeKey = null;
  activeDraftTextControl = null;
  draftConflict.value = false;
  detailDraft.value = draftHistory.reset(value);
  syncDraftHistoryCounts();
}

function updateDetailDraft(value: unknown): void {
  if (!supportsDraftHistory.value) {
    detailDraft.value = value;
    return;
  }
  const mergeKey = activeDraftTextControl && document.activeElement === activeDraftTextControl
    ? activeDraftMergeKey
    : null;
  detailDraft.value = draftHistory.record(value, mergeKey);
  syncDraftHistoryCounts();
}

function undoDetailDraft(): void {
  if (!canUndoDraft.value) return;
  activeDraftMergeKey = null;
  const previous = draftHistory.undo();
  if (previous !== null) detailDraft.value = previous;
  syncDraftHistoryCounts();
  restartFocusedDraftEdit();
}

function redoDetailDraft(): void {
  if (!canRedoDraft.value) return;
  activeDraftMergeKey = null;
  const next = draftHistory.redo();
  if (next !== null) detailDraft.value = next;
  syncDraftHistoryCounts();
  restartFocusedDraftEdit();
}

function beginDraftFocusEdit(event: FocusEvent): void {
  activeDraftTextControl = isContinuousTextControl(event.target) ? event.target : null;
  activeDraftMergeKey = activeDraftTextControl ? `text:${++draftFocusSequence}` : null;
}

function endDraftFocusEdit(event: FocusEvent): void {
  if (event.target !== activeDraftTextControl) return;
  activeDraftMergeKey = null;
  activeDraftTextControl = null;
}

function isContinuousTextControl(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  if (target instanceof HTMLTextAreaElement) return !target.disabled && !target.readOnly;
  return target instanceof HTMLInputElement
    && !target.disabled
    && !target.readOnly
    && ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type || 'text');
}

function restartFocusedDraftEdit(): void {
  const focused = document.activeElement;
  activeDraftTextControl = isContinuousTextControl(focused) ? focused : null;
  activeDraftMergeKey = activeDraftTextControl ? `text:${++draftFocusSequence}` : null;
}

function handleDraftHistoryShortcut(event: KeyboardEvent): void {
  if (!supportsDraftHistory.value || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
  const key = event.key.toLocaleLowerCase();
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoDetailDraft();
    else undoDetailDraft();
    return;
  }
  if (key === 'y') {
    event.preventDefault();
    redoDetailDraft();
  }
}

watch(() => projectStore.currentProject, (project) => {
  activationSequence += 1;
  overviewCoordinator.invalidate({ project });
  selectedMapId.value = null;
  selectedEventId.value = null;
  selected.value = normalizeProjectManagementSection(route.query.section);
  closeDetail();
  closeEventEditor();
  resetCatalog();
  stagingDirty.value = false;
  battleTestDialogVisible.value = false;
  temporaryBattleback1Name.value = '';
  temporaryBattleback2Name.value = '';
  battleContextProject = '';
  surfaceVersion = '';
  overview.value = null;
  error.value = null;
  loading.value = false;
  validating.value = false;
  refreshing.value = false;
  draftConflict.value = false;
  if (project && surfaceActive) void activateProjectManagement();
  else workbenchUi.sbStagingDirty = false;
});

watch(editorCatalog, (catalog) => {
  if (!catalog || catalog.project === battleContextProject) return;
  battleContextProject = catalog.project;
  temporaryBattleback1Name.value = catalog.battle.battleback1Name;
  temporaryBattleback2Name.value = catalog.battle.battleback2Name;
});

watch(() => props.active, (active) => {
  setProjectManagementActive(active);
}, { immediate: true });

onActivated(() => {
  setProjectManagementActive(props.active);
});

onDeactivated(() => {
  setProjectManagementActive(false);
});

function setProjectManagementActive(active: boolean): void {
  if (surfaceActive === active) return;
  surfaceActive = active;
  activationSequence += 1;
  if (!active) {
    validating.value = false;
    return;
  }
  const routeSection = normalizeProjectManagementSection(route.query.section);
  if (selected.value !== routeSection) selectCategory(routeSection);
  void activateProjectManagement();
}

async function activateProjectManagement(): Promise<void> {
  const project = projectStore.currentProject;
  if (!project || !surfaceActive) return;
  const sequence = ++activationSequence;
  const hasCachedOverview = Boolean(overview.value);
  loading.value = !hasCachedOverview;
  validating.value = hasCachedOverview;
  error.value = null;
  try {
    const validation = await workspaceSurfaces.validate({
      surface: 'projectManagement',
      loadedVersion: surfaceVersion || undefined,
    }, project);
    if (!surfaceActive || projectStore.currentProject !== project || sequence !== activationSequence) return;
    if (overview.value && validation.unchanged) {
      surfaceVersion = validation.version;
      loading.value = false;
      validating.value = false;
      return;
    }
    if (hasUnsavedDraft.value) {
      draftConflict.value = true;
      detailError.value = t('story.workspaceDraftConflict');
    }
    await loadData(validation.version);
  } catch (activationError) {
    if (!surfaceActive || projectStore.currentProject !== project || sequence !== activationSequence) return;
    error.value = (activationError as Error).message;
    loading.value = false;
    validating.value = false;
  }
}

watch(selected, (name) => {
  searchQuery.value = '';
  resetGroupVisibleLimits();
  if (name === 'database') syncSelectedDbGroup();
  if (name === 'audio') syncSelectedAudioBucket();
  if (name === 'images') syncSelectedImageBucket();
  if (surfaceActive && route.path === '/console' && route.query.section !== name) {
    void router.replace({
      path: route.path,
      query: { ...route.query, page: 'story', section: name },
    });
  }
});

watch(searchQuery, () => {
  resetGroupVisibleLimits();
});

watch([selected, () => projectStore.currentProject], ([name]) => {
  if ((name === 'images' || name === 'database') && projectStore.currentProject) void ensureCatalog();
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
  { id: 'overview' as const, count: maps.value.length + switches.value.length + variables.value.length + commonEvents.value.length + audioTotal.value + imageTotal.value + dbTotal.value },
  { id: 'maps' as const, count: maps.value.length },
  { id: 'switches' as const, count: switches.value.filter(s => s.name).length },
  { id: 'variables' as const, count: variables.value.filter(v => v.name).length },
  { id: 'commonEvents' as const, count: commonEvents.value.filter(e => e.name).length },
  { id: 'audio' as const, count: audioTotal.value },
  { id: 'images' as const, count: imageTotal.value },
  { id: 'database' as const, count: dbTotal.value },
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
    case 'maps':
      return t('story.searchMaps');
    case 'switches':
    case 'variables':
      return t('story.searchNameOrId');
    case 'commonEvents':
      return t('story.searchCommonEvent');
    case 'audio':
      return t('story.searchAudio');
    case 'images':
      return t('story.searchImage');
    case 'database':
      return t('story.searchDatabase');
    default:
      return t('story.search');
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
  const result: Record<string, ProjectOverviewDbGroup> = {};
  for (const [key, group] of Object.entries(db)) {
    let named = showUnnamed.value ? group.named : group.named.filter((entry) => entry.name);
    if (query) {
      named = named.filter((entry) => matchesQuery(entry.id, entry.name, entry.preview?.name, entry.preview?.label));
    }
    if (named.length) {
      result[key] = { ...group, named, count: named.length };
    }
  }
  return query ? result : Object.fromEntries(
    Object.entries(db).map(([key, group]) => {
      const named = showUnnamed.value ? group.named : group.named.filter((entry) => entry.name);
      return [key, { ...group, named, count: named.length }];
    }),
  );
});

const dbGroupOptions = computed(() =>
  DB_GROUP_ORDER.map((key) => {
    const group = database.value[key];
    const count = isDocumentSubFieldGroup(key)
      ? dbSubFieldOrder(key).length
      : (group?.named.length ?? group?.count ?? 0);
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

const selectedDbGroupMetadata = computed((): ProjectOverviewDbGroup => {
  return database.value[selectedDbGroup.value] ?? { exists: false, count: 0, named: [] };
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
  const entry = pmDetail.value.entry;
  if (isDocumentSubFieldGroup(String(entry.group)) && selectedDbSubField.value) {
    return `${entry.group}:${entry.id}:${selectedDbSubField.value}`;
  }
  return `${entry.group}:${entry.id}`;
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
  if (selected.value === 'database') return `${categoryLabel('database')} · ${dbLabel(selectedDbGroup.value)}`;
  if (selected.value === 'audio') return `${categoryLabel('audio')} · ${selectedAudioBucket.value.toUpperCase()}`;
  if (selected.value === 'images') return `${categoryLabel('images')} · ${imageBucketLabel(selectedImageBucket.value)}`;
  return categoryLabel(selected.value);
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

function categoryLabel(id: StoryCategoryId): string {
  return STORY_CATEGORY_LABELS[id]?.[language.value] ?? id;
}

function dbLabel(key: string): string {
  return databaseGroupLabel(key, language.value);
}

function imageBucketLabel(key: string): string {
  return IMAGE_BUCKET_LABELS[key]?.[language.value] ?? key;
}

function managedKindLabel(kind: ProjectManagedEntry['kind']): string {
  return MANAGED_KIND_LABELS[kind][language.value];
}

function itemCountLabel(count: number): string {
  return t('story.itemCount', { count });
}

function mapEventSummary(mapCount: number, eventCount: number): string {
  return t('story.mapEventCount', { maps: mapCount, events: eventCount });
}

function unnamedLabel(): string {
  return t('story.unnamed');
}

function showMoreLabel(count: number): string {
  return t('story.showMore', { count });
}

function isCommonEventsGroup(group?: string): boolean {
  return group === 'CommonEvents';
}

function canCreateDatabaseGroup(key: string): boolean {
  return !DOCUMENT_DATABASE_GROUPS.has(key);
}

function isDocumentSubFieldGroup(group: string): boolean {
  return group === 'Types' || group === 'Terms';
}

function dbSubFieldOrder(group: string): readonly string[] {
  if (group === 'Types') return TYPES_SUBFIELD_ORDER;
  if (group === 'Terms') return TERMS_SUBFIELD_ORDER;
  return [];
}

function dbFieldLabel(path: string): string {
  return databaseFieldLabel(path, language.value);
}

function dbSubFieldItemCount(path: string): string {
  const draft = detailDraft.value;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return '—';
  const value = (draft as Record<string, unknown>)[path];
  if (path === 'messages' && value && typeof value === 'object' && !Array.isArray(value)) {
    return String(Object.keys(value as Record<string, unknown>).length);
  }
  if (Array.isArray(value)) {
    return String(value.filter((item) => item != null && item !== '').length);
  }
  return '—';
}

function isDocumentSubFieldDetailLoaded(): boolean {
  return pmDetail.value?.kind === 'managed'
    && pmDetail.value.entry.kind === 'database'
    && pmDetail.value.entry.group === selectedDbGroup.value
    && pmDetail.value.entry.id === 0;
}

async function openDocumentSubFieldGroup(group: string): Promise<void> {
  const fields = dbSubFieldOrder(group);
  if (!fields.length) return;
  selectedDbSubField.value = fields[0];
  await openManaged('database', 0, group);
}

function selectDbSubField(path: string): void {
  if (selectedDbSubField.value === path && isDocumentSubFieldDetailLoaded()) return;
  selectedDbSubField.value = path;
  if (!isDocumentSubFieldDetailLoaded()) {
    void openManaged('database', 0, selectedDbGroup.value);
  }
}

const canCreateSelectedDbGroup = computed(() => canCreateDatabaseGroup(selectedDbGroup.value));
const selectedDbCapacity = computed(() => (
  selectedDbGroupMetadata.value.capacity
  ?? selectedDbGroupMetadata.value.named.reduce((highest, entry) => Math.max(highest, entry.id), 0)
));
const selectedDbMaximumLimit = computed(() => selectedDbGroupMetadata.value.maxEntries ?? null);
const canResizeSelectedDbGroup = computed(() => selectedDbMaximumLimit.value !== null);

function dbSummary(): string {
  if (!scan.value?.database) return '';
  return Object.keys(scan.value.database).map(k => dbLabel(k)).join(' / ');
}

function closeDetail() {
  pmDetail.value = null;
  resetDetailDraft(null);
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
  const sameGroup = selectedDbGroup.value === key;
  if (sameGroup && !isDocumentSubFieldGroup(key)) return;
  selectedDbGroup.value = key;
  resetGroupVisibleLimits();
  if (isDocumentSubFieldGroup(key)) {
    if (!sameGroup) closeDetail();
    void openDocumentSubFieldGroup(key);
    return;
  }
  selectedDbSubField.value = '';
  if (!sameGroup) closeDetail();
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

function selectCategory(id: StoryCategoryId) {
  if (selected.value !== id) {
    closeDetail();
    selectedEventId.value = null;
  }
  selected.value = id;
  if (id !== 'maps') selectedMapId.value = null;
  if (id === 'database') syncSelectedDbGroup();
  if (id === 'audio') syncSelectedAudioBucket();
  if (id === 'images') syncSelectedImageBucket();
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
    if (!event) throw new Error(t('story.eventNotExists'));
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
  resetDetailDraft(null);
  try {
    if (kind === 'commonEvent' || (kind === 'database' && isCommonEventsGroup(group))) {
      await ensureCatalog();
      const entry = await projectManagement.getEntry({ kind: 'commonEvent', id }, projectStore.currentProject);
      pmDetail.value = { kind: 'managed', entry };
      resetDetailDraft(cloneDraft(entry.value));
      return;
    }
    const [entry] = await Promise.all([
      projectManagement.getEntry({ kind, id, group }, projectStore.currentProject),
      kind === 'database' ? ensureCatalog() : Promise.resolve(null),
    ]);
    pmDetail.value = { kind: 'managed', entry };
    resetDetailDraft(cloneDraft(entry.value));
  } catch (loadError) {
    detailError.value = (loadError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

function openDbContextMenu(event: MouseEvent, entryId: number) {
  event.preventDefault();
  event.stopPropagation();
  dbContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    entryId,
  };
}

function closeDbContextMenu() {
  dbContextMenu.value = null;
}

async function copyDbEntry(id: number) {
  closeDbContextMenu();
  try {
    const entry = await projectManagement.getEntry(
      { kind: 'database', group: selectedDbGroup.value, id },
      projectStore.currentProject,
    );
    const { id: _stripId, ...rest } = entry.value as Record<string, unknown>;
    dbClipboard = { group: selectedDbGroup.value, value: rest };
  } catch (copyError) {
    detailError.value = (copyError as Error).message;
  }
}

function canPasteDbEntry(): boolean {
  return Boolean(dbClipboard && dbClipboard.group === selectedDbGroup.value);
}

async function pasteDbEntry(id: number) {
  closeDbContextMenu();
  if (!dbClipboard || dbClipboard.group !== selectedDbGroup.value) return;
  detailBusy.value = true;
  detailError.value = '';
  try {
    const merged = { ...dbClipboard.value, id };
    const updated = await projectManagement.updateEntry({
      kind: 'database',
      group: selectedDbGroup.value,
      id,
      value: merged,
    }, projectStore.currentProject);
    pmDetail.value = { kind: 'managed', entry: updated };
    resetDetailDraft(cloneDraft(updated.value));
    resetCatalog();
    await loadData();
    await refreshStagingStatus();
  } catch (pasteError) {
    detailError.value = (pasteError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function clearDbEntry(id: number) {
  closeDbContextMenu();
  detailBusy.value = true;
  detailError.value = '';
  try {
    await projectManagement.resetEntry(
      { kind: 'database', group: selectedDbGroup.value, id },
      projectStore.currentProject,
    );
    pmDetail.value = null;
    resetDetailDraft(null);
    resetCatalog();
    await loadData();
    await refreshStagingStatus();
  } catch (clearError) {
    detailError.value = (clearError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function createDatabaseEntry(group: string) {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  resetDetailDraft(null);
  try {
    const entry = await projectManagement.createEntry({ kind: 'database', group }, projectStore.currentProject);
    resetCatalog();
    await ensureCatalog();
    pmDetail.value = { kind: 'managed', entry };
    resetDetailDraft(cloneDraft(entry.value));
    showUnnamed.value = true;
    await loadData();
  } catch (createError) {
    detailError.value = (createError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function createSelectedDatabaseEntry() {
  if (isCommonEventsGroup(selectedDbGroup.value)) {
    await createCommonEvent('database');
    return;
  }
  await createDatabaseEntry(selectedDbGroup.value);
}

async function changeSelectedDatabaseMaximum() {
  const group = selectedDbGroup.value;
  const limit = selectedDbMaximumLimit.value;
  if (!limit || !projectStore.currentProject || detailBusy.value || stagingBusy.value) return;
  try {
    const answer = await ElMessageBox.prompt(
      t('story.databaseMaximumPrompt', { current: selectedDbCapacity.value, limit }),
      t('story.databaseMaximumTitle', { group: dbLabel(group) }),
      {
        inputValue: String(selectedDbCapacity.value || 1),
        inputType: 'number',
        confirmButtonText: t('story.databaseMaximumConfirm'),
        inputValidator: (value) => {
          const maximum = Number(value);
          return Number.isInteger(maximum) && maximum >= 1 && maximum <= limit
            ? true
            : t('story.databaseMaximumInvalid', { limit });
        },
      },
    );
    const maximum = Number(answer.value);
    if (maximum === selectedDbCapacity.value) return;
    detailBusy.value = true;
    detailError.value = '';
    await projectManagement.resizeDatabase({ kind: 'database', group, maximum }, projectStore.currentProject);
    resetCatalog();
    await ensureCatalog();
    await loadData();
    await refreshStagingStatus();
    ElMessage.success(t('story.databaseMaximumChanged', { maximum }));
  } catch (changeError) {
    if (changeError === 'cancel' || changeError === 'close') return;
    if (changeError && typeof changeError === 'object' && 'action' in changeError) return;
    detailError.value = (changeError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function createCommonEvent(targetCategory: StoryCategoryId = 'commonEvents') {
  selectedEventId.value = null;
  detailBusy.value = true;
  detailError.value = '';
  pmDetail.value = null;
  resetDetailDraft(null);
  try {
    await ensureCatalog();
    const result = await commonEventsApi.create({
      name: newCommonEventName(language.value),
      trigger: 0,
      switchId: 0,
      list: [{ code: 0, indent: 0, parameters: [] }],
    }, projectStore.currentProject);
    resetCatalog();
    await ensureCatalog();
    const entry = await projectManagement.getEntry({ kind: 'commonEvent', id: result.entry.id }, projectStore.currentProject);
    pmDetail.value = { kind: 'managed', entry };
    resetDetailDraft(cloneDraft(entry.value));
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
    const entry = await projectManagement.getEntry({ kind: 'commonEvent', id: result.entry.id }, projectStore.currentProject);
    pmDetail.value = { kind: 'managed', entry };
    resetDetailDraft(cloneDraft(entry.value));
    selected.value = 'commonEvents';
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
  if (!window.confirm(t('story.deleteCommonEventConfirm', { id: String(id).padStart(4, '0') }))) return;
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
  resetDetailDraft(null);
  try {
    const fileName = resolveAudioFileName(bucketKey, name);
    const bucket = assets.value?.audio?.[bucketKey];
    if (!fileName || !bucket) {
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
    const relativePath = projectRelativeAssetPath(bucket.dir, fileName);
    const asset = await projectAssets.detail({ scope: 'project', category: bucketKey, relativePath }, projectStore.currentProject);
    setAssetDetail('audio', bucketKey, asset);
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
  resetDetailDraft(null);
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
    setAssetDetail('image', bucketKey, asset);
  } catch (loadError) {
    detailError.value = (loadError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

function setAssetDetail(kind: 'audio' | 'image', bucketKey: string, asset: ManagedAssetDetail) {
  pmDetail.value = {
    kind,
    category: bucketKey,
    name: asset.name,
    url: asset.url || '',
    fileName: asset.fileName,
    relativePath: asset.relativePath,
    staged: asset.staged,
    references: asset.references,
    size: asset.size,
  };
}

function currentAssetDetail() {
  const detail = pmDetail.value;
  return detail?.kind === 'audio' || detail?.kind === 'image' ? detail : null;
}

function currentAssetTarget() {
  const detail = currentAssetDetail();
  if (!detail || detail.missing || !detail.relativePath) return null;
  return {
    scope: 'project',
    category: detail.kind === 'image' ? imageDetailCategory(detail.category) : detail.category,
    relativePath: detail.relativePath,
  };
}

function localFileParts(filePath: string): { fileName: string; name: string } {
  const fileName = String(filePath || '').split(/[\\/]/).pop() || '';
  return { fileName, name: fileName.replace(/\.[^.]+$/, '') };
}

async function importCurrentAssetCategory() {
  if (!projectStore.currentProject || detailBusy.value || !['audio', 'images'].includes(selected.value)) return;
  const kind = selected.value === 'audio' ? 'audio' : 'image';
  const bucketKey = kind === 'audio' ? selectedAudioBucket.value : selectedImageBucket.value;
  const category = kind === 'image' ? imageDetailCategory(bucketKey) : bucketKey;
  detailBusy.value = true;
  detailError.value = '';
  try {
    const sourceFile = await projectAssets.selectImportFile(category);
    if (!sourceFile) return;
    const { name } = localFileParts(sourceFile);
    const bucketNames = kind === 'audio'
      ? assets.value?.audio?.[bucketKey]?.names || []
      : assets.value?.images?.[bucketKey]?.names || [];
    const overwrite = bucketNames.includes(name);
    if (overwrite) {
      try {
        await ElMessageBox.confirm(
          t('story.assetOverwriteConfirm', { name }),
          t('story.assetOverwriteTitle'),
          { type: 'warning' },
        );
      } catch {
        return;
      }
    }
    const asset = await projectAssets.importLocalFile({ category, sourceFile, overwrite }, projectStore.currentProject);
    resetCatalog();
    if (kind === 'image') await ensureCatalog();
    await loadData();
    setAssetDetail(kind, bucketKey, asset);
  } catch (importError) {
    detailError.value = (importError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function renameCurrentAsset() {
  const detail = currentAssetDetail();
  const target = currentAssetTarget();
  if (!detail || !target || !projectStore.currentProject || detailBusy.value) return;
  let nextName = '';
  try {
    const response = await ElMessageBox.prompt(
      t('story.assetRenamePrompt', { count: detail.references?.length || 0 }),
      t('story.assetRenameTitle'),
      { inputValue: detail.name, inputPattern: /^[^<>:"/\\|?*\u0000-\u001f]+$/, inputErrorMessage: t('story.assetNameInvalid') },
    );
    nextName = String(response.value || '').trim();
  } catch {
    return;
  }
  detailBusy.value = true;
  detailError.value = '';
  try {
    const safety = await projectAssets.checkRenameSafety(target, nextName, projectStore.currentProject);
    if (!safety.ok) throw new Error(safety.blockers.join('\n'));
    try {
      await ElMessageBox.confirm(
        t('story.assetRenameConfirm', { count: safety.references.length }),
        t('story.assetRenameTitle'),
        { type: 'warning' },
      );
    } catch {
      return;
    }
    const renamed = await projectAssets.rename(target, nextName, projectStore.currentProject);
    resetCatalog();
    if (detail.kind === 'image') await ensureCatalog();
    await loadData();
    setAssetDetail(detail.kind, detail.category, renamed);
  } catch (renameError) {
    detailError.value = (renameError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function deleteCurrentAsset() {
  const detail = currentAssetDetail();
  const target = currentAssetTarget();
  if (!detail || !target || !projectStore.currentProject || detailBusy.value) return;
  detailBusy.value = true;
  detailError.value = '';
  try {
    const safety = await projectAssets.checkDeleteSafety(target, projectStore.currentProject);
    if (!safety.ok) throw new Error(safety.blockers.join('\n'));
    try {
      await ElMessageBox.confirm(
        t('story.assetDeleteConfirm', { name: detail.name }),
        t('story.assetDeleteTitle'),
        { type: 'warning' },
      );
    } catch {
      return;
    }
    await projectAssets.remove(target, projectStore.currentProject);
    resetCatalog();
    closeDetail();
    await loadData();
  } catch (deleteError) {
    detailError.value = (deleteError as Error).message;
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
        await commonEventsApi.update(entry.id, detailDraft.value, projectStore.currentProject);
        const updated = await projectManagement.getEntry({ kind: 'commonEvent', id: entry.id }, projectStore.currentProject);
        pmDetail.value = { kind: 'managed', entry: updated };
        resetDetailDraft(cloneDraft(updated.value));
      } else {
        const updated = await projectManagement.updateEntry({
          kind: entry.kind,
          group: entry.group,
          id: entry.id,
          value: detailDraft.value,
        }, projectStore.currentProject);
        pmDetail.value = { kind: 'managed', entry: updated };
        resetDetailDraft(cloneDraft(updated.value));
      }
      if (entry.kind === 'database' || entry.kind === 'commonEvent') {
        resetCatalog();
        await ensureCatalog();
      }
    }
    await loadData();
    await refreshStagingStatus();
  } catch (saveError) {
    detailError.value = (saveError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function openBattleTestSetup(): Promise<void> {
  const entry = pmDetail.value?.kind === 'managed' ? pmDetail.value.entry : null;
  if (!entry || entry.kind !== 'database' || entry.group !== 'Troops') return;
  if (hasUnsavedDraft.value) {
    ElMessage.warning(t('battleTest.unsavedDraft'));
    return;
  }
  const troop = detailDraft.value && typeof detailDraft.value === 'object' && !Array.isArray(detailDraft.value)
    ? detailDraft.value as Record<string, unknown>
    : {};
  if (Array.isArray(troop.members) && troop.members.length > 8) {
    ElMessage.error(t('battleTest.tooManyMembers'));
    return;
  }
  await ensureCatalog();
  battleTestDialogVisible.value = true;
}

async function startBattleTest(configuration: {
  battlers: InteractiveBattleTestBattler[];
  battleback1Name: string;
  battleback2Name: string;
}): Promise<void> {
  const entry = pmDetail.value?.kind === 'managed' ? pmDetail.value.entry : null;
  const project = projectStore.currentProject;
  if (!entry || entry.kind !== 'database' || entry.group !== 'Troops' || !project || battleTestBusy.value) return;
  if (hasUnsavedDraft.value) {
    battleTestDialogVisible.value = false;
    ElMessage.warning(t('battleTest.unsavedDraft'));
    return;
  }
  battleTestBusy.value = true;
  try {
    const result = await playtest.start({
      mode: 'battle_test',
      project,
      troopId: entry.id,
      battlers: configuration.battlers,
      battleback1Name: configuration.battleback1Name,
      battleback2Name: configuration.battleback2Name,
    });
    if (result.error || !result.run || result.run.status === 'failed' || result.run.status === 'stop_failed') {
      throw new Error(result.run?.error || result.error || t('topbar.playtest.launchFailed'));
    }
    temporaryBattleback1Name.value = configuration.battleback1Name;
    temporaryBattleback2Name.value = configuration.battleback2Name;
    battleTestDialogVisible.value = false;
    ElMessage.success(t('battleTest.started'));
  } catch (error) {
    ElMessage.error(t('battleTest.failed', { message: (error as Error).message }));
  } finally {
    battleTestBusy.value = false;
  }
}

async function startParticlePreview(): Promise<void> {
  const entry = pmDetail.value?.kind === 'managed' ? pmDetail.value.entry : null;
  const project = projectStore.currentProject;
  if (!entry || entry.kind !== 'database' || entry.group !== 'Animations' || !project || particlePreviewBusy.value) return;
  if (editorCatalog.value?.engine !== 'rpg-maker-mz') {
    ElMessage.error(t('db.particlePreviewMZOnly'));
    return;
  }
  if (!detailDraft.value || typeof detailDraft.value !== 'object' || Array.isArray(detailDraft.value)) {
    ElMessage.error(t('db.particlePreviewInvalid'));
    return;
  }
  particlePreviewBusy.value = true;
  try {
    const result = await playtest.start({
      mode: 'particle_preview',
      project,
      animationPreview: cloneDraft(detailDraft.value) as unknown as InteractiveParticleAnimationPreview,
    });
    if (result.error || !result.run || result.run.status === 'failed' || result.run.status === 'stop_failed') {
      throw new Error(result.run?.error || result.error || t('topbar.playtest.launchFailed'));
    }
    ElMessage.success(t('db.particlePreviewStarted'));
  } catch (error) {
    ElMessage.error(t('db.particlePreviewFailed', { message: (error as Error).message }));
  } finally {
    particlePreviewBusy.value = false;
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
    if (entry.kind === 'database' && isDocumentSubFieldGroup(String(entry.group || '')) && selectedDbSubField.value) {
      return `${dbLabel(String(entry.group || ''))} · ${dbFieldLabel(selectedDbSubField.value)}`;
    }
    return `${entry.kind === 'database' ? dbLabel(String(entry.group || '')) : managedKindLabel(entry.kind)} · #${entry.id}`;
  }
  if (pmDetail.value.kind === 'image') return `${imageBucketLabel(pmDetail.value.category)} · ${pmDetail.value.name}`;
  return `${pmDetail.value.category.toUpperCase()} · ${pmDetail.value.name}`;
}
</script>

<template>
  <div class="console-subpage" :aria-busy="validating || refreshing">
    <div v-if="!projectStore.currentProject" class="state">{{ t('story.addProjectFirst') }}</div>
    <div v-else-if="error && !overview" class="state error">{{ formatErrorText(error) }}</div>
    <div v-else-if="loading && !overview" class="state">{{ t('story.loadingOverview') }}</div>
    <div v-if="overview && (refreshing || error)" class="workspace-refresh-state" :class="{ error }" :role="error ? 'alert' : 'status'">
      <template v-if="error">
        <span>{{ formatErrorText(error) }}</span>
        <button type="button" class="secondary-button" @click="loadData()">{{ t('story.retryOverview') }}</button>
      </template>
      <span v-else>{{ t('story.loadingOverview') }}</span>
    </div>
    <div
      v-if="overview"
      class="console-split pm-split"
      :inert="surfaceInteractionLocked"
      :aria-disabled="surfaceInteractionLocked"
    >
      <!-- Sidebar -->
      <aside class="console-panel pm-categories">
        <div class="console-panel-title">{{ t('story.projectMgmt') }}</div>
        <div class="pm-sidebar">
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            :data-ui-id="`story-category-${cat.id}`"
            class="folder"
            :class="{ active: selected === cat.id }"
            @click="selectCategory(cat.id)"
          >
            <!-- Map icon -->
            <svg v-if="cat.id === 'maps'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
            <!-- Switch icon -->
            <svg v-else-if="cat.id === 'switches'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M8 7h8M8 12h8m-8 5h8M5 7h.01M5 12h.01M5 17h.01" /></svg>
            <!-- Variable icon -->
            <svg v-else-if="cat.id === 'variables'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
            <!-- Common event icon -->
            <svg v-else-if="cat.id === 'commonEvents'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <!-- Audio icon -->
            <svg v-else-if="cat.id === 'audio'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <!-- Image icon -->
            <svg v-else-if="cat.id === 'images'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 5h16v14H4z" /><path d="M8 13l2.2-2.2a1 1 0 011.4 0L17 16" /><path d="M14 10h.01" /></svg>
            <!-- Database icon -->
            <svg v-else-if="cat.id === 'database'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
            <!-- Grid icon (overview) -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
            <span>{{ categoryLabel(cat.id) }}</span>
            <b>{{ cat.count }}</b>
          </button>
        </div>
        <div v-if="selected === 'database'" class="pm-sub-pane">
          <button type="button" class="pm-sub-pane-toggle" @click="pmSubPaneExpanded = !pmSubPaneExpanded">
            <el-icon :class="{ collapsed: !pmSubPaneExpanded }"><ArrowRight /></el-icon>
            <span>{{ t('story.dataType') }}</span>
            <b>{{ isDocumentSubFieldGroup(selectedDbGroup) ? dbSubFieldOrder(selectedDbGroup).length : activeDbGroup.named.length }}</b>
          </button>
          <div v-show="pmSubPaneExpanded" class="pm-sub-list">
            <button
              v-for="opt in dbGroupOptions"
              :key="opt.key"
              type="button"
              :data-ui-id="`story-database-group-${opt.key}`"
              class="sub-category-button"
              :class="{ active: opt.key === selectedDbGroup }"
              @click="selectDbGroup(opt.key)"
            >
              <span>{{ opt.label }}</span>
              <b>{{ opt.count }}</b>
            </button>
          </div>
        </div>
        <div v-else-if="selected === 'audio'" class="pm-sub-pane">
          <button type="button" class="pm-sub-pane-toggle" @click="pmSubPaneExpanded = !pmSubPaneExpanded">
            <el-icon :class="{ collapsed: !pmSubPaneExpanded }"><ArrowRight /></el-icon>
            <span>{{ t('story.audioType') }}</span>
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
        <div v-else-if="selected === 'images'" class="pm-sub-pane">
          <button type="button" class="pm-sub-pane-toggle" @click="pmSubPaneExpanded = !pmSubPaneExpanded">
            <el-icon :class="{ collapsed: !pmSubPaneExpanded }"><ArrowRight /></el-icon>
            <span>{{ t('story.imageType') }}</span>
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
        <div v-if="selected === 'overview'" class="console-panel-title"><span>{{ categoryLabel(selected) }}</span></div>
        <div v-else class="console-list-header">
          <span>{{ pmListHeaderTitle }}</span>
          <ConsoleSearchInput v-model="searchQuery" :placeholder="pmSearchPlaceholder" />
        </div>
        <div class="console-panel-scroll pm-content">

          <!-- ========== Overview ========== -->
          <template v-if="selected === 'overview'">
            <div class="overview-grid">
              <button type="button" class="asset-card clickable" @click="selectCategory('maps')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                </span>
                <span><strong>{{ categoryLabel('maps') }}</strong><small>{{ mapEventSummary(maps.length, totalEvents) }}</small></span>
                <em>{{ t('story.mapOverview') }}</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('switches')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7h8M8 12h8m-8 5h8M5 7h.01M5 12h.01M5 17h.01" /></svg>
                </span>
                <span><strong>{{ categoryLabel('switches') }}</strong><small>{{ itemCountLabel(switches.filter(s => s.name).length) }}</small></span>
                <em>{{ t('story.namedSwitches') }}</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('variables')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                </span>
                <span><strong>{{ categoryLabel('variables') }}</strong><small>{{ itemCountLabel(variables.filter(v => v.name).length) }}</small></span>
                <em>{{ t('story.namedVariables') }}</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('commonEvents')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </span>
                <span><strong>{{ categoryLabel('commonEvents') }}</strong><small>{{ itemCountLabel(commonEvents.filter(e => e.name).length) }}</small></span>
                <em>{{ t('story.namedCommonEvents') }}</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('audio')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </span>
                <span><strong>{{ categoryLabel('audio') }}</strong><small>{{ itemCountLabel(audioTotal) }}</small></span>
                <em>BGM / BGS / ME / SE</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('images')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z" /><path d="M8 13l2.2-2.2a1 1 0 011.4 0L17 16" /><path d="M14 10h.01" /></svg>
                </span>
                <span><strong>{{ categoryLabel('images') }}</strong><small>{{ itemCountLabel(imageTotal) }}</small></span>
                <em>{{ t('story.imgAssets') }}</em>
              </button>

              <button type="button" class="asset-card clickable" @click="selectCategory('database')">
                <span class="asset-thumb">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                </span>
                <span><strong>{{ categoryLabel('database') }}</strong><small>{{ itemCountLabel(dbTotal) }} · {{ dbSummary() }}</small></span>
                <em>{{ t('story.dataIndex') }}</em>
              </button>
            </div>
          </template>

          <!-- ========== Maps and events ========== -->
          <template v-else-if="selected === 'maps'">
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
                <div v-if="!filteredMaps.length" class="empty-hint">{{ maps.length ? t('story.noMatchMaps') : t('story.noMapData') }}</div>
              </div>
              <div class="event-detail">
                <div v-if="selectedMapId" class="map-toolbar">
                  <button type="button" class="link-button" @click="openMapInEditor(selectedMapId)">{{ t('story.openInMapEditor') }}</button>
                  <button
                    v-if="eventDialogOpen && editorMapId === selectedMapId && eventDraft?.id"
                    type="button"
                    class="link-button"
                    @click="openMapInEditor(selectedMapId, eventDraft!.id)"
                  >{{ t('story.viewLocation') }}</button>
                </div>
                <template v-if="selectedMapId && filteredMapEvents.length">
                  <div class="event-row event-header">
                    <span class="ev-id">ID</span>
                    <span class="ev-name">{{ t('commonEvent.name') }}</span>
                    <span class="ev-pos">{{ t('story.position') }}</span>
                    <span class="ev-pages">{{ t('story.pages') }}</span>
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
                    <span class="ev-name">{{ e.name || unnamedLabel() }}</span>
                    <span class="ev-pos">({{ e.x }}, {{ e.y }})</span>
                    <span class="ev-pages">{{ e.pageCount }}</span>
                  </button>
                </template>
                <div v-else-if="selectedMapId" class="empty-hint">{{ selectedMapEvents.length ? t('story.noMatchEvents') : t('story.noEventsOnMap') }}</div>
                <div v-else class="empty-hint">{{ t('story.selectMapHint') }}</div>
              </div>
            </div>
          </template>

          <!-- ========== Switches ========== -->
          <template v-else-if="selected === 'switches'">
            <div class="list-toolbar">
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> {{ t('story.showUnnamed') }}</label>
            </div>
            <div class="id-list">
              <button v-for="s in filteredSwitches" :key="s.id" type="button" class="id-row" @click="openManaged('switch', s.id)">
                <span class="row-id">{{ String(s.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ s.name || unnamedLabel() }}</span>
              </button>
              <div v-if="!filteredSwitches.length" class="empty-hint">{{ t('story.noMatchItems') }}</div>
            </div>
          </template>

          <!-- ========== Variables ========== -->
          <template v-else-if="selected === 'variables'">
            <div class="list-toolbar">
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> {{ t('story.showUnnamed') }}</label>
            </div>
            <div class="id-list">
              <button v-for="v in filteredVariables" :key="v.id" type="button" class="id-row" @click="openManaged('variable', v.id)">
                <span class="row-id">{{ String(v.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ v.name || unnamedLabel() }}</span>
              </button>
              <div v-if="!filteredVariables.length" class="empty-hint">{{ t('story.noMatchItems') }}</div>
            </div>
          </template>

          <!-- ========== Common events ========== -->
          <template v-else-if="selected === 'commonEvents'">
            <div class="list-toolbar">
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> {{ t('story.showUnnamed') }}</label>
              <div class="toolbar-actions">
                <button type="button" @click="createCommonEvent()">{{ t('story.new') }}</button>
                <button type="button" :disabled="selectedCommonEventId == null" @click="duplicateCurrentCommonEvent">{{ t('story.duplicate') }}</button>
                <button type="button" class="danger" :disabled="selectedCommonEventId == null" @click="deleteCurrentCommonEvent">{{ t('cmdList.delete') }}</button>
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
                <span class="row-name">{{ ce.name || unnamedLabel() }}</span>
              </button>
              <div v-if="!filteredCommonEvents.length" class="empty-hint">{{ t('story.noMatchItems') }}</div>
            </div>
          </template>

          <!-- ========== Audio ========== -->
          <template v-else-if="selected === 'audio'">
            <div class="list-toolbar asset-toolbar">
              <span>{{ selectedAudioBucket.toUpperCase() }}</span>
              <button type="button" :disabled="detailBusy || stagingBusy" @click="importCurrentAssetCategory">{{ t('story.assetImport') }}</button>
            </div>
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
                {{ showMoreLabel(remainingAudioNames) }}
              </button>
              <div v-if="!visibleAudioNames.length" class="empty-hint">
                {{ assets?.audio?.[selectedAudioBucket] ? t('story.noMatchAudio') : t('story.noAudioData') }}
              </div>
            </div>
          </template>

          <!-- ========== Images ========== -->
          <template v-else-if="selected === 'images'">
            <div class="list-toolbar asset-toolbar">
              <span>{{ imageBucketLabel(selectedImageBucket) }}</span>
              <button type="button" :disabled="detailBusy || stagingBusy" @click="importCurrentAssetCategory">{{ t('story.assetImport') }}</button>
            </div>
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
                  <span v-else class="image-grid-missing">{{ t('story.noPreview') }}</span>
                </span>
                <span class="image-grid-meta">
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.fileName || t('story.fileMissing') }}</small>
                </span>
              </button>
              <button
                v-if="hasMoreImageNames"
                type="button"
                class="load-more image-grid-more"
                @click="showMoreGroupItems('image', selectedImageBucket, activeImageBucket.names.length)"
              >
                {{ showMoreLabel(remainingImageNames) }}
              </button>
              <div v-if="!visibleImageNames.length" class="empty-hint">
                {{ assets?.images?.[selectedImageBucket] ? t('story.noMatchImages') : t('story.noImageData') }}
              </div>
            </div>
          </template>

          <!-- ========== Database ========== -->
          <template v-else-if="selected === 'database'">
            <div class="list-toolbar database-toolbar">
              <span>{{ dbLabel(selectedDbGroup) }} · {{ itemCountLabel(isDocumentSubFieldGroup(selectedDbGroup) ? dbSubFieldOrder(selectedDbGroup).length : activeDbGroup.named.length) }}</span>
              <template v-if="!isDocumentSubFieldGroup(selectedDbGroup)">
                <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> {{ t('story.showUnnamed') }}</label>
                <button
                  v-if="canCreateSelectedDbGroup"
                  type="button"
                  class="link-button"
                  :disabled="detailBusy || stagingBusy"
                  @click="createSelectedDatabaseEntry"
                >
                  {{ t('story.addNew') }}
                </button>
                <button
                  v-if="canResizeSelectedDbGroup"
                  type="button"
                  class="link-button"
                  :disabled="detailBusy || stagingBusy"
                  @click="changeSelectedDatabaseMaximum"
                >
                  {{ t('story.databaseMaximum', { maximum: selectedDbCapacity }) }}
                </button>
              </template>
            </div>
            <div v-if="isDocumentSubFieldGroup(selectedDbGroup)" class="id-list db-subfield-list">
              <button
                v-for="path in dbSubFieldOrder(selectedDbGroup)"
                :key="path"
                type="button"
                class="id-row db-subfield-row"
                :class="{ active: activeDbKey === `${selectedDbGroup}:0:${path}` }"
                @click="selectDbSubField(path)"
              >
                <span class="row-name">{{ dbFieldLabel(path) }}</span>
                <span class="row-meta">{{ dbSubFieldItemCount(path) }}</span>
              </button>
              <div v-if="!pmDetail && !detailBusy" class="empty-hint">{{ t('story.selectDbSubFieldHint') }}</div>
            </div>
            <div v-else-if="activeDbUsesGrid" class="image-grid database-grid">
              <button
                v-for="entry in visibleDbGridItems"
                :key="entry.id"
                type="button"
                :data-ui-id="`story-database-entry-${selectedDbGroup}-${entry.id}`"
                class="image-grid-card database-grid-card"
                :class="{ active: activeDbKey === `${selectedDbGroup}:${entry.id}`, missing: entry.missing || !entry.preview }"
                @click="openManaged('database', entry.id, selectedDbGroup)"
                @contextmenu.prevent="openDbContextMenu($event, entry.id)"
              >
                <span class="image-grid-thumb database-grid-thumb">
                  <span
                    v-if="entry.url && entry.preview && dbPreviewUsesSprite(entry.preview)"
                    class="db-preview-sprite"
                    :class="`kind-${entry.preview.kind}`"
                    :style="dbPreviewSpriteStyle(entry.preview, entry.url)"
                  />
                  <img v-else-if="entry.url" :src="entry.url" :alt="entry.name" />
                  <span v-else class="image-grid-missing">{{ t('story.noPreview') }}</span>
                </span>
                <span class="image-grid-meta">
                  <strong>{{ entry.name || unnamedLabel() }}</strong>
                  <small>{{ dbPreviewSubtitle(entry) }}</small>
                </span>
              </button>
              <button
                v-if="hasMoreDbEntries"
                type="button"
                class="load-more image-grid-more"
                @click="showMoreGroupItems('database', selectedDbGroup, activeDbGroup.named.length)"
              >
                {{ showMoreLabel(remainingDbEntries) }}
              </button>
              <div v-if="!visibleDbEntries.length" class="empty-hint">
                {{ database[selectedDbGroup] ? t('story.noMatchEntries') : t('story.noDatabaseData') }}
              </div>
            </div>
            <div v-else class="id-list">
              <button
                v-for="entry in visibleDbEntries"
                :key="entry.id"
                type="button"
                :data-ui-id="`story-database-entry-${selectedDbGroup}-${entry.id}`"
                class="id-row"
                @click="openManaged('database', entry.id, selectedDbGroup)"
                @contextmenu.prevent="openDbContextMenu($event, entry.id)"
              >
                <span class="row-id">{{ String(entry.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ entry.name || unnamedLabel() }}</span>
              </button>
              <button
                v-if="hasMoreDbEntries"
                type="button"
                class="load-more"
                @click="showMoreGroupItems('database', selectedDbGroup, activeDbGroup.named.length)"
              >
                {{ showMoreLabel(remainingDbEntries) }}
              </button>
              <div v-if="!visibleDbEntries.length" class="empty-hint">
                {{ database[selectedDbGroup] ? t('story.noMatchEntries') : t('story.noDatabaseData') }}
              </div>
            </div>
          </template>

        </div>
      </main>

      <aside class="console-panel pm-detail" :aria-label="t('story.entryDetails')">
          <header>
            <div>
              <strong>{{ t('story.entryDetails') }}</strong>
              <span v-if="pmDetail">{{ detailTitle() }}</span>
              <span v-else-if="selectedEvent">{{ t('story.event') }} · #{{ selectedEvent.id }}</span>
              <span v-else-if="selectedMap">{{ t('story.map') }} · #{{ selectedMap.id }}</span>
              <span v-else>{{ t('story.selectEntryHint') }}</span>
            </div>
            <button v-if="pmDetail || detailError || selectedEvent" type="button" @click="clearDetailPanel">×</button>
          </header>
          <div v-if="detailBusy && !pmDetail" class="empty-hint">{{ t('story.loadingEntry') }}</div>
          <div v-else-if="pmDetail?.kind === 'audio'" class="pm-detail-body audio-detail">
            <dl class="audio-facts">
              <dt>{{ t('eventEditorDialog.type') }}</dt><dd>{{ pmDetail.category.toUpperCase() }}</dd>
              <dt>{{ t('story.fileName') }}</dt><dd>{{ pmDetail.fileName || '—' }}</dd>
              <dt>{{ t('story.path') }}</dt><dd>{{ pmDetail.relativePath || '—' }}</dd>
              <dt>{{ t('story.assetReferences') }}</dt><dd>{{ pmDetail.references?.length || 0 }}</dd>
              <dt>{{ t('story.assetState') }}</dt><dd>{{ pmDetail.staged ? t('story.assetStaged') : t('story.assetSource') }}</dd>
            </dl>
            <audio v-if="pmDetail.url" :src="pmDetail.url" controls />
            <div v-else class="empty-hint">{{ t('story.audioNotFound') }}</div>
            <div v-if="pmDetail.references?.length" class="asset-reference-list">
              <span v-for="reference in pmDetail.references" :key="`${reference.file}:${reference.path}`">{{ reference.file }} · {{ reference.path }}</span>
            </div>
          </div>
          <div v-else-if="pmDetail?.kind === 'image'" class="pm-detail-body image-detail">
            <dl class="audio-facts">
              <dt>{{ t('eventEditorDialog.type') }}</dt><dd>{{ imageBucketLabel(pmDetail.category) }}</dd>
              <dt>{{ t('story.fileName') }}</dt><dd>{{ pmDetail.fileName || '—' }}</dd>
              <dt>{{ t('story.path') }}</dt><dd>{{ pmDetail.relativePath || '—' }}</dd>
              <dt>{{ t('story.assetReferences') }}</dt><dd>{{ pmDetail.references?.length || 0 }}</dd>
              <dt>{{ t('story.assetState') }}</dt><dd>{{ pmDetail.staged ? t('story.assetStaged') : t('story.assetSource') }}</dd>
            </dl>
            <div v-if="pmDetail.url" class="image-preview-frame">
              <img :src="pmDetail.url" :alt="pmDetail.name" />
            </div>
            <div v-else class="empty-hint">{{ t('story.imageNotFound') }}</div>
            <div v-if="pmDetail.references?.length" class="asset-reference-list">
              <span v-for="reference in pmDetail.references" :key="`${reference.file}:${reference.path}`">{{ reference.file }} · {{ reference.path }}</span>
            </div>
          </div>
          <div
            v-else-if="pmDetail?.kind === 'managed' && pmDetail.entry.kind === 'commonEvent'"
            class="pm-detail-body"
            @focusin="beginDraftFocusEdit"
            @focusout="endDraftFocusEdit"
            @keydown="handleDraftHistoryShortcut"
          >
            <StagedEntryInspection :inspection="pmDetail.entry.inspection" />
            <CommonEventDetailEditor
              :model-value="detailDraft"
              :catalog="editorCatalog"
              :load-image="loadImage"
              @update:model-value="updateDetailDraft"
            />
          </div>
          <div
            v-else-if="pmDetail?.kind === 'managed' && pmDetail.entry.kind === 'database'"
            class="pm-detail-body"
            @focusin="beginDraftFocusEdit"
            @focusout="endDraftFocusEdit"
            @keydown="handleDraftHistoryShortcut"
          >
            <StagedEntryInspection :inspection="pmDetail.entry.inspection" />
            <DatabaseEntryDetailEditor
              :model-value="detailDraft"
              :group="pmDetail.entry.group"
              :catalog="editorCatalog"
              :schema="pmDetail.entry.schema"
              :focus-field="pmDetail.entry.group && isDocumentSubFieldGroup(pmDetail.entry.group) ? selectedDbSubField : undefined"
              :load-image="loadImage"
              :battleback1-name="temporaryBattleback1Name"
              :battleback2-name="temporaryBattleback2Name"
              @update:model-value="updateDetailDraft"
              @update:battleback1-name="temporaryBattleback1Name = $event"
              @update:battleback2-name="temporaryBattleback2Name = $event"
              @request-battle-test="openBattleTestSetup"
              @request-particle-preview="startParticlePreview"
            />
          </div>
          <div v-else-if="pmDetail && detailEditable" class="pm-detail-body">
            <StructuredFieldsEditor v-model="detailDraft" :label="t('story.entryFields')" />
          </div>
          <div v-else-if="selectedEvent && selectedMapId" class="pm-detail-body event-inspector">
            <dl class="detail-facts">
              <dt>{{ t('story.eventId') }}</dt><dd>{{ String(selectedEvent.id).padStart(3, '0') }}</dd>
              <dt>{{ t('commonEvent.name') }}</dt><dd>{{ selectedEvent.name || unnamedLabel() }}</dd>
              <dt>{{ t('story.map') }}</dt><dd>{{ selectedMap?.name || `Map${selectedMapId}` }}</dd>
              <dt>{{ t('story.position') }}</dt><dd>({{ selectedEvent.x }}, {{ selectedEvent.y }})</dd>
              <dt>{{ t('story.pages') }}</dt><dd>{{ selectedEvent.pageCount }}</dd>
            </dl>
            <div v-if="eventPreviewBusy" class="event-preview-state">{{ t('story.loadingEventContents') }}</div>
            <div v-else-if="eventPreviewError" class="detail-error event-preview-error">{{ t('story.eventContentsLoadFailed') }}{{ formatErrorText(eventPreviewError) }}</div>
            <MapEventCommandPreview
              v-else-if="eventPreviewEvent"
              :event="eventPreviewEvent"
              :system-data="eventPreviewSystemData"
            />
            <div v-else class="event-preview-state">{{ t('story.noEventContents') }}</div>
            <div class="detail-actions">
              <button type="button" class="secondary-button" @click="openMapEvent(selectedMapId, selectedEvent.id)">{{ t('story.openEventEditor') }}</button>
              <button type="button" class="secondary-button" @click="openMapInEditor(selectedMapId, selectedEvent.id)">{{ t('story.viewMapLocation') }}</button>
            </div>
          </div>
          <div v-else-if="selected === 'maps' && selectedMap" class="pm-detail-body event-inspector">
            <dl class="detail-facts">
              <dt>{{ t('story.mapId') }}</dt><dd>{{ String(selectedMap.id).padStart(3, '0') }}</dd>
              <dt>{{ t('commonEvent.name') }}</dt><dd>{{ selectedMap.name }}</dd>
              <dt>{{ t('story.eventCount') }}</dt><dd>{{ selectedMap.eventCount }}</dd>
            </dl>
            <div class="detail-actions">
              <button type="button" class="secondary-button" @click="openMapInEditor(selectedMap.id)">{{ t('story.openMapEditor') }}</button>
            </div>
            <p class="detail-note">{{ t('story.selectMiddleHint') }}</p>
          </div>
          <div v-else-if="detailError && !pmDetail" class="detail-error">{{ formatErrorText(detailError) }}</div>
          <div v-else class="detail-empty">{{ t('story.selectFromMiddle') }}</div>
          <div v-if="detailError && pmDetail" class="detail-error">{{ formatErrorText(detailError) }}</div>
          <footer v-if="pmDetail">
            <template v-if="pmDetail.kind === 'audio' || pmDetail.kind === 'image'">
              <span>{{ t('story.assetLifecycleNote') }}</span>
              <div class="pm-detail-footer-actions">
                <button type="button" class="secondary-button" :disabled="detailBusy || stagingBusy || pmDetail.missing" @click="renameCurrentAsset">{{ t('story.assetRename') }}</button>
                <button type="button" class="secondary-button danger" :disabled="detailBusy || stagingBusy || pmDetail.missing" @click="deleteCurrentAsset">{{ t('cmdList.delete') }}</button>
                <button v-if="stagingDirty" type="button" class="secondary-button" :disabled="detailBusy || stagingBusy" @click="discardProjectStaging">{{ t('editor.toolbar.discard') }}</button>
                <button v-if="stagingDirty" type="button" class="secondary-button staging-apply-button" :disabled="detailBusy || stagingBusy" @click="applyProjectStaging">{{ t('editor.toolbar.applyStaging') }}</button>
              </div>
            </template>
            <template v-else>
              <span>{{ t('story.saveStagingNote') }}</span>
              <div class="pm-detail-footer-actions">
                <button
                  v-if="supportsDraftHistory"
                  type="button"
                  class="secondary-button"
                  data-ui-id="story-draft-undo"
                  :disabled="detailBusy || stagingBusy || !canUndoDraft"
                  @click="undoDetailDraft"
                >
                  {{ t('editor.toolbar.undo') }}
                </button>
                <button
                  v-if="supportsDraftHistory"
                  type="button"
                  class="secondary-button"
                  data-ui-id="story-draft-redo"
                  :disabled="detailBusy || stagingBusy || !canRedoDraft"
                  @click="redoDetailDraft"
                >
                  {{ t('editor.toolbar.redo') }}
                </button>
                <button
                  v-if="canRevertCurrentStagedEntry"
                  type="button"
                  class="secondary-button"
                  :disabled="detailBusy || stagingBusy"
                  @click="revertCurrentStagedEntry"
                >
                  {{ t('story.revertStagedEntry') }}
                </button>
                <button
                  v-if="stagingDirty"
                  type="button"
                  class="secondary-button"
                  :disabled="detailBusy || stagingBusy"
                  @click="discardProjectStaging"
                >
                  {{ t('editor.toolbar.discard') }}
                </button>
                <button
                  v-if="stagingDirty"
                  type="button"
                  class="secondary-button staging-apply-button"
                  :disabled="detailBusy || stagingBusy"
                  @click="applyProjectStaging"
                >
                  {{ t('editor.toolbar.applyStaging') }}
                </button>
                <button type="button" :disabled="detailBusy || stagingBusy" @click="saveDetail">
                  {{ detailBusy ? t('ui.saving') : t('story.saveChanges') }}
                </button>
              </div>
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

    <BattleTestSetupDialog
      :visible="battleTestDialogVisible"
      :busy="battleTestBusy"
      :catalog="editorCatalog"
      :troop-name="currentTroopName"
      :battleback1-name="temporaryBattleback1Name"
      :battleback2-name="temporaryBattleback2Name"
      @close="battleTestDialogVisible = false"
      @start="startBattleTest"
    />

    <teleport to="body">
      <div
        v-if="dbContextMenu?.visible"
        class="ctx-mask"
        @click="closeDbContextMenu"
        @contextmenu.prevent="closeDbContextMenu"
      >
        <ul
          class="ctx-menu"
          :style="{ left: dbContextMenu.x + 'px', top: dbContextMenu.y + 'px' }"
        >
          <li @click="copyDbEntry(dbContextMenu.entryId)">{{ t('editor.ctx.copy') }}</li>
          <li
            :class="{ disabled: !canPasteDbEntry() }"
.console-subpage { position: relative; }
.workspace-refresh-state {
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 38px;
  margin: 0 40px 8px;
  padding: 7px 12px;
  border: 1px solid var(--app-border);
  border-radius: 7px;
  background: var(--app-bg);
  color: var(--app-ink-muted);
  font-size: 12px;
}
.workspace-refresh-state.error { color: var(--app-danger); }
            @click="pasteDbEntry(dbContextMenu.entryId)"
          >{{ t('editor.ctx.paste') }}</li>
          <li class="ctx-sep"></li>
          <li class="ctx-danger" @click="clearDbEntry(dbContextMenu.entryId)">{{ t('db.clearEntry') }}</li>
        </ul>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
/* Layout */
.pm-split {
  grid-template-columns: 230px minmax(0, 1fr) minmax(380px, 420px);
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
.asset-reference-list { display: grid; gap: 4px; padding: 9px; border-radius: 9px; background: var(--console-paper-soft,#faf5ec); color: var(--console-text-muted,#9a8e7e); font: 9.5px/1.45 var(--app-font-mono); overflow-wrap: anywhere; }
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
.asset-toolbar { color: var(--console-text-muted,#9a8e7e); font-size: 11px; }
.asset-toolbar button { min-height: 26px; padding: 0 9px; border: 1px solid var(--console-border-strong,#ddd3c2); border-radius: 8px; background: var(--console-paper,#fffdfa); color: var(--console-accent,#be5630); font: inherit; cursor: pointer; }
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
.id-row.active { background: var(--console-accent-soft,#f6e3d7); color: var(--console-accent,#be5630); }
.row-id { font-family: var(--app-font-mono); font-weight: 600; font-size: 10px; color: var(--console-accent,#be5630); min-width: 40px; }
.row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta { font-size: 10px; color: var(--console-muted,#8a7f72); min-width: 24px; text-align: right; }
.db-subfield-row { justify-content: space-between; }
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
  height: 40px;
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  padding: 0 10px;
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
  font-size: 9px;
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
  padding: 8px;
}
.pm-detail>footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--console-border,#e4dcce);
  color: var(--console-text-muted,#9a8e7e);
  font-size: 10px;
}
.pm-detail>footer>span {
  flex: 1 1 100%;
  min-width: 0;
}
.pm-detail-footer-actions {
  display: flex;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 8px;
  margin-left: auto;
}
.pm-detail-footer-actions button {
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: 0;
  border: 0;
  border-radius: 9px;
  background: var(--console-accent,#be5630);
  color: white;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
}
.pm-detail-footer-actions button:disabled { opacity: .6; cursor: wait; }
.pm-detail-footer-actions .secondary-button {
  border: 1px solid var(--console-border-strong, #ddd3c2);
  border-radius: 9px;
  background: var(--console-paper, #fffdfa);
  color: var(--console-text-soft, #5a5247);
  padding: 8px 12px;
}
.pm-detail-footer-actions .staging-apply-button {
  border-color: var(--console-accent, #be5630);
  color: var(--console-accent, #be5630);
}
.pm-detail-footer-actions .danger { border-color: color-mix(in srgb, var(--app-danger) 35%, var(--console-border-strong,#ddd3c2)); color: var(--app-danger); }
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
    grid-template-columns: 210px minmax(0, 1fr) minmax(340px, 380px);
    padding-inline: 28px;
    gap: 16px;
  }
  .map-split { grid-template-columns: 190px minmax(0, 1fr); }
}

/* States */
.state { display: grid; place-items: center; flex: 1; color: var(--app-ink-muted); }
.state.error { color: var(--app-danger); }
.empty-hint { color: var(--app-ink-muted); font-size: 12px; padding: 12px 0; text-align: center; }

/* Context menu */
.ctx-mask { position: fixed; inset: 0; z-index: 9999; }
.ctx-menu { position: fixed; min-width: 184px; margin: 0; padding: 4px 0; border: 1px solid var(--app-border); border-radius: var(--app-radius-md); background: var(--el-bg-color-overlay); box-shadow: var(--app-shadow-overlay); color: var(--app-ink); font-size: 13px; list-style: none; }
.ctx-menu li { padding: 6px 14px; cursor: pointer; white-space: nowrap; }
.ctx-menu li:hover { background: var(--app-bg-sunken); }
.ctx-menu li.disabled { color: var(--app-ink-muted); pointer-events: none; opacity: .58; }
.ctx-menu li.ctx-danger { color: var(--el-color-danger); }
.ctx-menu li.ctx-sep { height: 0; margin: 4px 0; padding: 0; border-top: 1px solid var(--app-border); }
</style>
