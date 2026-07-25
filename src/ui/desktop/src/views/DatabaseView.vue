<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useProjectStore } from '../stores/project';
import { useRoute, useRouter } from 'vue-router';
import {
  commonEvents as commonEventsApi,
  maps as mapsApi,
  projectManagement,
  workspaceSurfaces,
  playtest,
  type InteractiveBattleTestBattler,
  type InteractiveParticleAnimationPreview,
  type ProjectManagedEntry,
  type ProjectOverview,
  type ProjectOverviewDbGroup,
  type ProjectOverviewDbPreview,
  type ProjectOverviewReadIssue,
} from '../api/client';
import { cloneDraft } from '../utils/clone-draft';
import { createDraftHistory } from '../utils/draft-history';
import { useWorkbenchUiStore } from '../stores/workbenchUi';
import { usePmEventEditor } from '../composables/usePmEventEditor';
import StructuredFieldsEditor from '../components/console/StructuredFieldsEditor.vue';
import CommonEventDetailEditor from '../components/console/CommonEventDetailEditor.vue';
import DatabaseEntryDetailEditor from '../components/console/DatabaseEntryDetailEditor.vue';
import BattleTestSetupDialog from '../components/console/BattleTestSetupDialog.vue';
import StagedEntryInspection from '../components/console/StagedEntryInspection.vue';
import ConsoleSearchInput from '../components/console/ConsoleSearchInput.vue';
import { useI18n } from '../i18n';
import { formatUserFacingErrorMessage } from '../utils/user-facing-error';
import {
  MANAGED_KIND_LABELS,
  newCommonEventName,
  DATABASE_CATEGORY_LABELS,
  type DatabaseCategoryId,
} from '../utils/consoleStoryLocalization';
import { databaseFieldLabel, databaseGroupLabel } from '../utils/rmmvDatabaseLocalization';
import { parseProjectStagingSummary, type ProjectStagingSummary } from '../utils/projectStaging';
import { LatestAsyncCoordinator } from '../utils/latestAsyncCoordinator';
import { normalizeDatabaseSection } from '../utils/projectManagementRoute';

type PmDetail = { kind: 'managed'; entry: ProjectManagedEntry };

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
  if (!projectStore.currentProject || stagingBusy.value || surfaceWriteLocked.value) return;
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
  if (pmDetail.value?.kind !== 'managed' || !projectStore.currentProject || detailBusy.value || surfaceWriteLocked.value) return;
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
  editorCatalog,
  loadImage,
  ensureCatalog,
  resetCatalog,
} = usePmEventEditor(() => projectStore.currentProject, () => loadData());

const selected = ref<DatabaseCategoryId>('database');
const searchQuery = ref('');
const selectedDbGroup = ref('Actors');
const selectedDbSubField = ref('');
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
const DB_PREVIEW_GROUPS = new Set([
  'Actors', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States',
  'Animations', 'Tilesets', 'System',
]);

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
  selected.value = normalizeDatabaseSection(route.query.section);
  if (selected.value === 'commonEvents') {
    selected.value = 'database';
    selectedDbGroup.value = 'CommonEvents';
  }
  closeDetail();
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

onActivated(() => {
  setProjectManagementActive(true);
});

onDeactivated(() => {
  setProjectManagementActive(false);
});

setProjectManagementActive(true);

function setProjectManagementActive(active: boolean): void {
  if (surfaceActive === active) return;
  surfaceActive = active;
  activationSequence += 1;
  if (!active) {
    validating.value = false;
    return;
  }
  const routeSection = normalizeDatabaseSection(route.query.section);
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
  if (surfaceActive && route.path === '/database' && route.query.section !== name) {
    void router.replace({
      path: '/database',
      query: { section: name },
    });
  }
});

watch(searchQuery, () => {
  resetGroupVisibleLimits();
});

watch([selected, () => projectStore.currentProject], ([name]) => {
  if (name === 'database' && projectStore.currentProject) void ensureCatalog();
});

const scan = computed(() => overview.value?.scan);
const switches = computed(() => scan.value?.switches || []);
const variables = computed(() => scan.value?.variables || []);
const commonEvents = computed(() => scan.value?.commonEvents || []);
const database = computed(() => scan.value?.database || {});
const readIssues = computed(() => overview.value?.readIssues || []);
const foundationalReadIssues = computed(() => readIssues.value.filter((issue) => issue.scope === 'project'));

function databaseReadIssue(group: string): ProjectOverviewReadIssue | null {
  return readIssues.value.find((issue) => issue.scope === 'database' && issue.databaseGroup === group) || null;
}

function formatReadIssue(issue: ProjectOverviewReadIssue): string {
  return `${issue.relativePath} · ${issue.message}`;
}

function databaseReadIssueText(group: string): string {
  const issue = databaseReadIssue(group);
  return issue ? formatReadIssue(issue) : '';
}

const selectedDatabaseReadIssue = computed(() => databaseReadIssue(selectedDbGroup.value));
const commonEventsReadIssue = computed(() => databaseReadIssue('CommonEvents'));

const dbTotal = computed(() => {
  if (!scan.value?.database) return 0;
  return Object.values(scan.value.database).reduce((sum, e) => sum + (e.count || 0), 0);
});

const categories = computed(() => [
  { id: 'switches' as const, count: switches.value.filter(s => s.name).length },
  { id: 'variables' as const, count: variables.value.filter(v => v.name).length },
  { id: 'database' as const, count: dbTotal.value },
]);

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
    case 'switches':
    case 'variables':
      return t('story.searchNameOrId');
    case 'database':
      return isCommonEventsGroup(selectedDbGroup.value)
        ? t('story.searchCommonEvent')
        : t('story.searchDatabase');
    default:
      return t('story.search');
  }
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
    return { key, label: dbLabel(key), count: group?.readState && group.readState !== 'ready' ? '!' : count, readState: group?.readState ?? 'missing' };
  }),
);

const activeDbGroup = computed((): ProjectOverviewDbGroup => {
  return filteredDatabase.value[selectedDbGroup.value] ?? { exists: false, readState: 'missing', count: 0, named: [] };
});

const selectedDbGroupMetadata = computed((): ProjectOverviewDbGroup => {
  return database.value[selectedDbGroup.value] ?? { exists: false, readState: 'missing', count: 0, named: [] };
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

const pmListHeaderTitle = computed(() => {
  if (selected.value === 'database') return `${categoryLabel('database')} · ${dbLabel(selectedDbGroup.value)}`;
  return categoryLabel(selected.value);
});

const GROUP_PAGE_SIZE = 60;
const groupVisibleLimits = ref<Record<string, number>>({});

type PmGroupTab = 'database';

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

function categoryLabel(id: DatabaseCategoryId): string {
  if (id === 'commonEvents') return MANAGED_KIND_LABELS.commonEvent[language.value];
  return DATABASE_CATEGORY_LABELS[id]?.[language.value] ?? id;
}

function dbLabel(key: string): string {
  return databaseGroupLabel(key, language.value);
}

function managedKindLabel(kind: ProjectManagedEntry['kind']): string {
  return MANAGED_KIND_LABELS[kind][language.value];
}

function itemCountLabel(count: number): string {
  return t('story.itemCount', { count });
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

const canCreateSelectedDbGroup = computed(() => selectedDbGroupMetadata.value.readState === 'ready' && canCreateDatabaseGroup(selectedDbGroup.value));
const selectedDbCapacity = computed(() => (
  selectedDbGroupMetadata.value.capacity
  ?? selectedDbGroupMetadata.value.named.reduce((highest, entry) => Math.max(highest, entry.id), 0)
));
const selectedDbMaximumLimit = computed(() => selectedDbGroupMetadata.value.maxEntries ?? null);
const canResizeSelectedDbGroup = computed(() => selectedDbGroupMetadata.value.readState === 'ready' && selectedDbMaximumLimit.value !== null);

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
    const withData = options.find((option) => typeof option.count === 'number' && option.count > 0);
    selectedDbGroup.value = withData?.key ?? options[0].key;
  }
}

function selectDbGroup(key: string): void {
  const sameGroup = selectedDbGroup.value === key;
  if (sameGroup && !isDocumentSubFieldGroup(key)) return;
  selectedDbGroup.value = key;
  resetGroupVisibleLimits();
  if (database.value[key]?.readState !== 'ready') {
    selectedDbSubField.value = '';
    if (!sameGroup) closeDetail();
    return;
  }
  if (isDocumentSubFieldGroup(key)) {
    if (!sameGroup) closeDetail();
    void openDocumentSubFieldGroup(key);
    return;
  }
  selectedDbSubField.value = '';
  if (!sameGroup) closeDetail();
}

function selectCategory(id: DatabaseCategoryId) {
  if (selected.value !== id) {
    closeDetail();
  }
  selected.value = id;
  if (id === 'database') syncSelectedDbGroup();
}

watch(() => route.query.section, (section) => {
  if (!surfaceActive || route.path !== '/database') return;
  const next = normalizeDatabaseSection(section);
  if (next === 'commonEvents') {
    selectCategory('database');
    selectedDbGroup.value = 'CommonEvents';
    if (section !== 'database') {
      void router.replace({ path: '/database', query: { section: 'database' } });
    }
    return;
  }
  if (selected.value !== next) selectCategory(next);
  if (section !== next) {
    void router.replace({
      path: '/database',
      query: { section: next },
    });
  }
}, { immediate: true });

function clearDetailPanel() {
  closeDetail();
}

async function openManaged(kind: ProjectManagedEntry['kind'], id: number, group?: string) {
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
  if (surfaceWriteLocked.value || !dbClipboard || dbClipboard.group !== selectedDbGroup.value) return;
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
  if (surfaceWriteLocked.value) return;
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
  if (surfaceWriteLocked.value) return;
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
  if (!limit || !projectStore.currentProject || detailBusy.value || stagingBusy.value || surfaceWriteLocked.value) return;
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

async function createCommonEvent(_targetCategory: DatabaseCategoryId = 'database') {
  if (surfaceWriteLocked.value) return;
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
    selected.value = 'database';
    selectedDbGroup.value = 'CommonEvents';
    showUnnamed.value = true;
    await loadData();
  } catch (createError) {
    detailError.value = (createError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function duplicateCurrentCommonEvent() {
  if (selectedCommonEventId.value == null || surfaceWriteLocked.value) return;
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
    selected.value = 'database';
    selectedDbGroup.value = 'CommonEvents';
    showUnnamed.value = true;
    await loadData();
  } catch (duplicateError) {
    detailError.value = (duplicateError as Error).message;
  } finally {
    detailBusy.value = false;
  }
}

async function deleteCurrentCommonEvent() {
  if (selectedCommonEventId.value == null || surfaceWriteLocked.value) return;
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

async function saveDetail() {
  if (!pmDetail.value || surfaceWriteLocked.value) return;
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
  if (surfaceWriteLocked.value) return;
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
  if (surfaceWriteLocked.value) return;
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
  if (surfaceWriteLocked.value) return;
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

function detailTitle(): string {
  if (!pmDetail.value) return '';
  const entry = pmDetail.value.entry;
  if (entry.kind === 'database' && isDocumentSubFieldGroup(String(entry.group || '')) && selectedDbSubField.value) {
    return `${dbLabel(String(entry.group || ''))} · ${dbFieldLabel(selectedDbSubField.value)}`;
  }
  return `${entry.kind === 'database' ? dbLabel(String(entry.group || '')) : managedKindLabel(entry.kind)} · #${entry.id}`;
}
</script>

<template>
  <div class="database-page console-subpage" data-ui-id="database-page" :aria-busy="validating || refreshing">
    <div v-if="!projectStore.currentProject" class="state">{{ t('story.addProjectFirst') }}</div>
    <div v-else-if="error && !overview" class="state error" role="alert">
      <span>{{ formatErrorText(error) }}</span>
      <button type="button" class="secondary-button" @click="loadData()">{{ t('story.retryOverview') }}</button>
    </div>
    <div v-else-if="loading && !overview" class="state" role="status">{{ t('story.loadingOverview') }}</div>
    <template v-else-if="overview">
    <div v-if="refreshing || error" class="workspace-refresh-state" :class="{ error }" :role="error ? 'alert' : 'status'">
      <template v-if="error">
        <span>{{ formatErrorText(error) }}</span>
        <button type="button" class="secondary-button" @click="loadData()">{{ t('story.retryOverview') }}</button>
      </template>
      <span v-else>{{ t('story.loadingOverview') }}</span>
    </div>
    <div v-if="readIssues.length" class="read-issue-summary" :role="foundationalReadIssues.length ? 'alert' : 'status'">
      <span>{{ t('story.readIssues', { count: readIssues.length }) }}</span>
      <template v-if="foundationalReadIssues.length">
        <span v-for="issue in foundationalReadIssues" :key="`${issue.relativePath}:${issue.code}`">{{ formatReadIssue(issue) }}</span>
        <button type="button" class="secondary-button" @click="loadData()">{{ t('story.retryOverview') }}</button>
      </template>
    </div>
    <div
      class="console-split pm-split"
      :class="{ 'write-locked': surfaceInteractionLocked }"
      :inert="surfaceInteractionLocked"
      :aria-disabled="surfaceInteractionLocked"
    >
      <!-- Sidebar -->
      <aside class="console-panel pm-categories">
        <div class="console-panel-title">{{ t('app.nav.database') }}</div>
        <div class="pm-sidebar">
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            :data-ui-id="`database-category-${cat.id}`"
            class="folder"
            :class="{ active: selected === cat.id }"
            @click="selectCategory(cat.id)"
          >
            <svg v-if="cat.id === 'switches'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M8 7h8M8 12h8m-8 5h8M5 7h.01M5 12h.01M5 17h.01" /></svg>
            <svg v-else-if="cat.id === 'variables'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
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
              :data-ui-id="`database-group-${opt.key}`"
              class="sub-category-button"
              :class="{ active: opt.key === selectedDbGroup, error: opt.readState !== 'ready' }"
              :title="opt.readState === 'ready' ? undefined : databaseReadIssueText(opt.key)"
              @click="selectDbGroup(opt.key)"
            >
              <span>{{ opt.label }}</span>
              <b>{{ opt.count }}</b>
            </button>
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="console-panel">
        <div class="console-list-header">
          <span>{{ pmListHeaderTitle }}</span>
          <ConsoleSearchInput v-model="searchQuery" :placeholder="pmSearchPlaceholder" />
        </div>
        <div class="console-panel-scroll pm-content">

          <!-- ========== Switches ========== -->
          <template v-if="selected === 'switches'">
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

          <!-- ========== Database ========== -->
          <template v-else-if="selected === 'database'">
            <template v-if="isCommonEventsGroup(selectedDbGroup)">
              <div class="list-toolbar">
                <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> {{ t('story.showUnnamed') }}</label>
                <div class="toolbar-actions">
                  <button type="button" :disabled="Boolean(commonEventsReadIssue)" @click="createCommonEvent()">{{ t('story.new') }}</button>
                  <button type="button" :disabled="selectedCommonEventId == null" @click="duplicateCurrentCommonEvent">{{ t('story.duplicate') }}</button>
                  <button type="button" class="danger" :disabled="selectedCommonEventId == null" @click="deleteCurrentCommonEvent">{{ t('cmdList.delete') }}</button>
                </div>
              </div>
              <div v-if="commonEventsReadIssue" class="read-issue-detail" role="alert">
                <strong>{{ t('story.databaseReadFailed') }}</strong>
                <span>{{ formatReadIssue(commonEventsReadIssue) }}</span>
              </div>
              <div v-else class="id-list">
                <button
                  v-for="ce in filteredCommonEvents"
                  :key="ce.id"
                  type="button"
                  class="id-row ce-row"
                  :class="{ active: selectedCommonEventId === ce.id }"
                  @click="openManaged('commonEvent', ce.id)"
                  @contextmenu.prevent="openManaged('commonEvent', ce.id)"
                >
                  <span class="row-id">{{ String(ce.id).padStart(4, '0') }}</span>
                  <span class="row-name">{{ ce.name || unnamedLabel() }}</span>
                </button>
                <div v-if="!filteredCommonEvents.length" class="empty-hint">{{ t('story.noMatchItems') }}</div>
              </div>
            </template>
            <template v-else>
            <div class="list-toolbar database-toolbar">
              <span>{{ dbLabel(selectedDbGroup) }} · {{ selectedDatabaseReadIssue ? t('story.databaseReadFailed') : itemCountLabel(isDocumentSubFieldGroup(selectedDbGroup) ? dbSubFieldOrder(selectedDbGroup).length : activeDbGroup.named.length) }}</span>
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
            <div v-if="selectedDatabaseReadIssue" class="read-issue-detail" role="alert">
              <strong>{{ t('story.databaseReadFailed') }}</strong>
              <span>{{ formatReadIssue(selectedDatabaseReadIssue) }}</span>
            </div>
            <div v-else-if="isDocumentSubFieldGroup(selectedDbGroup)" class="id-list db-subfield-list">
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
                :data-ui-id="`database-entry-${selectedDbGroup}-${entry.id}`"
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
                :data-ui-id="`database-entry-${selectedDbGroup}-${entry.id}`"
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
          </template>

        </div>
      </main>

      <aside class="console-panel pm-detail" :aria-label="t('story.entryDetails')">
          <header>
            <div>
              <strong>{{ t('story.entryDetails') }}</strong>
              <span v-if="pmDetail">{{ detailTitle() }}</span>
              <span v-else>{{ t('story.selectEntryHint') }}</span>
            </div>
            <button v-if="pmDetail || detailError" type="button" @click="clearDetailPanel">×</button>
          </header>
          <div v-if="detailBusy && !pmDetail" class="empty-hint">{{ t('story.loadingEntry') }}</div>
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
          <div v-else-if="detailError && !pmDetail" class="detail-error">{{ formatErrorText(detailError) }}</div>
          <div v-else class="detail-empty">{{ t('story.selectEntryHint') }}</div>
          <div v-if="detailError && pmDetail" class="detail-error">{{ formatErrorText(detailError) }}</div>
          <footer v-if="pmDetail">
              <span>{{ t('story.saveStagingNote') }}</span>
              <div class="pm-detail-footer-actions">
                <button
                  v-if="supportsDraftHistory"
                  type="button"
                  class="secondary-button"
                  data-ui-id="database-draft-undo"
                  :disabled="detailBusy || stagingBusy || !canUndoDraft"
                  @click="undoDetailDraft"
                >
                  {{ t('editor.toolbar.undo') }}
                </button>
                <button
                  v-if="supportsDraftHistory"
                  type="button"
                  class="secondary-button"
                  data-ui-id="database-draft-redo"
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
          </footer>
      </aside>
    </div>
    </template>

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
.console-subpage { position: relative; }
.workspace-refresh-state {
  z-index: 5;
  display: flex;
  flex: 0 0 auto;
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
.write-locked { opacity: .72; }
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
.read-issue-summary{display:flex;align-items:center;gap:10px;flex:0 0 auto;margin:0 0 8px;padding:8px 12px;border:1px solid color-mix(in srgb,var(--app-danger) 35%,var(--app-border));border-radius:6px;background:color-mix(in srgb,var(--app-danger) 7%,var(--app-bg));color:var(--app-danger);font-size:11px;overflow-wrap:anywhere}
.read-issue-detail{display:grid;gap:6px;margin:12px;padding:12px;border:1px solid color-mix(in srgb,var(--app-danger) 35%,var(--app-border));border-radius:6px;background:color-mix(in srgb,var(--app-danger) 7%,var(--app-bg));color:var(--app-danger);font-size:11px;overflow-wrap:anywhere}
.map-item.error,.sub-category-button.error{color:var(--app-danger)}

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
.state.error { gap: 12px; color: var(--app-danger); }
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
