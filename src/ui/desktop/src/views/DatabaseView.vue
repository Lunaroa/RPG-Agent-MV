<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import { useProjectStore } from '../stores/project';
import { useRoute, useRouter } from 'vue-router';
import {
  commonEvents as commonEventsApi,
  maps as mapsApi,
  projectManagement,
  workspaceSurfaces,
  playtest,
  type InteractiveBattleTestBattler,
  type ProjectManagedEntry,
  type ProjectOverview,
  type ProjectOverviewDbGroup,
  type ProjectOverviewReadIssue,
} from '../api/client';
import { cloneDraft } from '../utils/clone-draft';
import { createDraftHistory } from '../utils/draft-history';
import { useWorkbenchUiStore } from '../stores/workbenchUi';
import { usePmEventEditor } from '../composables/usePmEventEditor';
import StructuredFieldsEditor from '../components/console/StructuredFieldsEditor.vue';
import CommonEventDetailEditor from '../components/console/CommonEventDetailEditor.vue';
import DatabaseEntryDetailEditor from '../components/console/DatabaseEntryDetailEditor.vue';
import SystemNamedEntryDetailEditor from '../components/console/SystemNamedEntryDetailEditor.vue';
import BattleTestSetupDialog from '../components/console/BattleTestSetupDialog.vue';
import StagedEntryInspection from '../components/console/StagedEntryInspection.vue';
import ConsoleSearchInput from '../components/console/ConsoleSearchInput.vue';
import { useI18n } from '../i18n';
import { formatUserFacingErrorMessage } from '../utils/user-facing-error';
import {
  DATABASE_CATEGORY_LABELS,
  MANAGED_KIND_LABELS,
  newCommonEventName,
} from '../utils/consoleStoryLocalization';
import { databaseGroupLabel } from '../utils/rmmvDatabaseLocalization';
import { parseProjectStagingSummary, type ProjectStagingSummary } from '../utils/projectStaging';
import { LatestAsyncCoordinator } from '../utils/latestAsyncCoordinator';
import { normalizeDatabaseSection } from '../utils/projectManagementRoute';
import {
  DATABASE_DOCUMENT_PAGES,
  databaseDocumentPageKey,
  databaseDocumentStorageGroup,
  isDatabaseDocumentPage,
  isSharedSystemDocumentPage,
} from '../utils/databaseDocumentPages';

type PmDetail = { kind: 'managed'; entry: ProjectManagedEntry };

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
    resetCatalog();
    await ensureCatalog();
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

// Variable/switch selector edits (rename, capacity) must refetch the shared catalog.
function reloadEditorCatalog() {
  resetCatalog();
  void ensureCatalog();
}

const searchQuery = ref('');
const selectedDbGroup = ref('Actors');
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
  'Switches', 'Variables',
  ...DATABASE_DOCUMENT_PAGES,
] as const;

const DOCUMENT_DATABASE_GROUPS = new Set<string>(DATABASE_DOCUMENT_PAGES);
const documentDatabasePage = computed(() => databaseDocumentPageKey(selectedDbGroup.value));
const isDocumentDatabaseGroup = computed(() => Boolean(documentDatabasePage.value));

function storageGroupForUiGroup(group: string): string {
  return isDatabaseDocumentPage(group) ? databaseDocumentStorageGroup(group) : group;
}

const pmDetail = ref<PmDetail | null>(null);
const detailDraft = ref<unknown>(null);
const detailBusy = ref(false);
const detailError = ref('');
const battleTestDialogVisible = ref(false);
const battleTestBusy = ref(false);
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
  selectedDbGroup.value = dbGroupForSection(normalizeDatabaseSection(route.query.section));
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
  selectDbGroup(dbGroupForSection(normalizeDatabaseSection(route.query.section)), false);
  applyRouteDatabaseFocus();
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

watch(searchQuery, () => {
  resetGroupVisibleLimits();
});

watch(() => projectStore.currentProject, (project) => {
  if (project) void ensureCatalog();
});

const scan = computed(() => overview.value?.scan);
const switches = computed(() => scan.value?.switches || []);
const variables = computed(() => scan.value?.variables || []);
const commonEvents = computed(() => scan.value?.commonEvents || []);
const database = computed(() => scan.value?.database || {});
const readIssues = computed(() => overview.value?.readIssues || []);

function databaseReadIssue(group: string): ProjectOverviewReadIssue | null {
  return readIssues.value.find((issue) => issue.scope === 'database' && issue.databaseGroup === group) || null;
}

function formatReadIssue(issue: ProjectOverviewReadIssue): string {
  return `${issue.relativePath} · ${issue.message}`;
}

/** Floating bottom-right toast for read failures; lists the affected files instead of pinning a top bar. */
let lastReadIssueSignature = '';
watch(readIssues, (issues) => {
  const signature = issues.map((issue) => `${issue.relativePath}:${issue.code}`).join('|');
  if (!issues.length || signature === lastReadIssueSignature) {
    if (!issues.length) lastReadIssueSignature = '';
    return;
  }
  lastReadIssueSignature = signature;
  ElNotification({
    type: 'error',
    title: t('story.readIssues', { count: issues.length }),
    message: issues.map((issue) => formatReadIssue(issue)).join('\n'),
    duration: 0,
    position: 'bottom-right',
    customClass: 'read-issue-notification',
  });
});

function databaseReadIssueText(group: string): string {
  const issue = databaseReadIssue(storageGroupForUiGroup(group));
  return issue ? formatReadIssue(issue) : '';
}

const selectedDatabaseReadIssue = computed(() =>
  databaseReadIssue(isSystemNamedGroup(selectedDbGroup.value)
    ? 'System'
    : storageGroupForUiGroup(selectedDbGroup.value)));
const commonEventsReadIssue = computed(() => databaseReadIssue('CommonEvents'));

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

const pmSearchPlaceholder = computed(() => (
  isCommonEventsGroup(selectedDbGroup.value)
    ? t('story.searchCommonEvent')
    : t('story.searchDatabase')
));

const filteredCommonEvents = computed(() => {
  const base = showUnnamed.value ? commonEvents.value : commonEvents.value.filter((item) => item.name);
  const query = normalizedSearchQuery();
  if (!query) return base;
  return base.filter((item) => matchesQuery(item.id, item.name, item.trigger, item.switchName, item.searchText));
});

const activeSystemNamedEntries = computed(() => (
  selectedDbGroup.value === 'Switches' ? switches.value : variables.value
));

const filteredSystemNamedEntries = computed(() => {
  const base = showUnnamed.value
    ? activeSystemNamedEntries.value
    : activeSystemNamedEntries.value.filter((entry) => entry.name);
  return base.filter((entry) => matchesQuery(entry.id, entry.name));
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
    if (key === 'Switches' || key === 'Variables') {
      const entries = key === 'Switches' ? switches.value : variables.value;
      const systemState = database.value.System?.readState ?? 'missing';
      return {
        key,
        label: dbLabel(key),
        count: systemState !== 'ready' ? '!' : entries.length,
        readState: systemState,
      };
    }
    const storageGroup = storageGroupForUiGroup(key);
    const group = database.value[storageGroup];
    const count = group?.named.length ?? group?.count ?? 0;
    return {
      key,
      label: dbLabel(key),
      count: isDatabaseDocumentPage(key) ? null : (group?.readState && group.readState !== 'ready' ? '!' : count),
      readState: group?.readState ?? 'missing',
    };
  }),
);

const activeDbGroup = computed((): ProjectOverviewDbGroup => {
  return filteredDatabase.value[storageGroupForUiGroup(selectedDbGroup.value)]
    ?? { exists: false, readState: 'missing', count: 0, named: [] };
});

const selectedDbGroupMetadata = computed((): ProjectOverviewDbGroup => {
  if (isSystemNamedGroup(selectedDbGroup.value)) {
    const system = database.value.System;
    return {
      exists: system?.exists ?? false,
      readState: system?.readState ?? 'missing',
      count: activeSystemNamedEntries.value.length,
      capacity: activeSystemNamedEntries.value.reduce((highest, entry) => Math.max(highest, entry.id), 0),
      maxEntries: 5000,
      named: activeSystemNamedEntries.value,
    };
  }
  return database.value[storageGroupForUiGroup(selectedDbGroup.value)]
    ?? { exists: false, readState: 'missing', count: 0, named: [] };
});

const visibleDbEntries = computed(() =>
  visibleGroupSlice('database', selectedDbGroup.value, activeDbGroup.value.named),
);

const visibleSystemNamedEntries = computed(() =>
  visibleGroupSlice('database', selectedDbGroup.value, filteredSystemNamedEntries.value));

const activeDbKey = computed(() => {
  if (pmDetail.value?.kind !== 'managed' || pmDetail.value.entry.kind !== 'database') return '';
  const entry = pmDetail.value.entry;
  return `${entry.group}:${entry.id}`;
});

const hasMoreDbEntries = computed(() =>
  hasMoreGroupItems('database', selectedDbGroup.value, activeDbGroup.value.named.length),
);

const hasMoreSystemNamedEntries = computed(() =>
  hasMoreGroupItems('database', selectedDbGroup.value, filteredSystemNamedEntries.value.length));

const remainingSystemNamedEntries = computed(() =>
  remainingGroupItems('database', selectedDbGroup.value, filteredSystemNamedEntries.value.length));

const remainingDbEntries = computed(() =>
  remainingGroupItems('database', selectedDbGroup.value, activeDbGroup.value.named.length),
);

const pmListHeaderTitle = computed(() => dbLabel(selectedDbGroup.value));

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

function dbLabel(key: string): string {
  if (key === 'Switches') return DATABASE_CATEGORY_LABELS.switches[language.value];
  if (key === 'Variables') return DATABASE_CATEGORY_LABELS.variables[language.value];
  if (key === 'System1') return t('db.document.system1');
  if (key === 'System2') return t('db.document.system2');
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

function isSystemNamedGroup(group?: string): boolean {
  return group === 'Switches' || group === 'Variables';
}

function systemNamedKind(group = selectedDbGroup.value): 'switch' | 'variable' {
  return group === 'Switches' ? 'switch' : 'variable';
}

function dbGroupForSection(section: ReturnType<typeof normalizeDatabaseSection>): string {
  if (section === 'commonEvents') return 'CommonEvents';
  if (section === 'switches') return 'Switches';
  if (section === 'variables') return 'Variables';
  return 'Actors';
}

function sectionForDbGroup(group: string): ReturnType<typeof normalizeDatabaseSection> {
  if (group === 'CommonEvents') return 'commonEvents';
  if (group === 'Switches') return 'switches';
  if (group === 'Variables') return 'variables';
  return 'database';
}

function canCreateDatabaseGroup(key: string): boolean {
  return !DOCUMENT_DATABASE_GROUPS.has(key) && !isSystemNamedGroup(key);
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

function selectDbGroup(key: string, syncRoute = true): void {
  const sameGroup = selectedDbGroup.value === key;
  if (sameGroup) {
    if (
      DOCUMENT_DATABASE_GROUPS.has(key)
      && !pmDetail.value
      && !detailBusy.value
      && database.value[storageGroupForUiGroup(key)]?.readState === 'ready'
    ) {
      const storageGroup = storageGroupForUiGroup(key);
      const first = database.value[storageGroup]?.named[0];
      if (first) void openManaged('database', first.id, storageGroup);
    }
    return;
  }
  const previousGroup = selectedDbGroup.value;
  const preserveSharedSystemDraft = isSharedSystemDocumentPage(previousGroup)
    && isSharedSystemDocumentPage(key)
    && pmDetail.value?.kind === 'managed'
    && pmDetail.value.entry.kind === 'database'
    && pmDetail.value.entry.group === 'System';
  selectedDbGroup.value = key;
  if (syncRoute && route.path === '/database') {
    const section = sectionForDbGroup(key);
    if (route.query.section !== section) {
      void router.replace({ path: '/database', query: { ...route.query, section } });
    }
  }
  resetGroupVisibleLimits();
  if (preserveSharedSystemDraft) return;
  closeDetail();
  if (isSystemNamedGroup(key)) return;
  const storageGroup = storageGroupForUiGroup(key);
  if (database.value[storageGroup]?.readState !== 'ready') return;
  // System 1/System 2/Types/Terms are single-document pages: open their shared
  // storage document directly instead of asking for an entry selection.
  // Switching between System 1 and System 2 above preserves the same draft.
  // the stock RM editor tabs instead of asking for a sub-field first.
  if (DOCUMENT_DATABASE_GROUPS.has(key)) {
    const first = database.value[storageGroup]?.named[0];
    if (first) void openManaged('database', first.id, storageGroup);
  }
}

watch(() => route.query.section, (section) => {
  if (!surfaceActive || route.path !== '/database') return;
  const normalized = normalizeDatabaseSection(section);
  selectDbGroup(dbGroupForSection(normalized), false);
  if (section !== normalized) {
    void router.replace({ path: '/database', query: { ...route.query, section: normalized } });
  }
}, { immediate: true });

/** One-shot deep link (global search hits): select the group, open the entry, then strip the params. */
function applyRouteDatabaseFocus(): void {
  if (!surfaceActive || route.path !== '/database') return;
  const group = typeof route.query.group === 'string' ? route.query.group : '';
  const id = Number(route.query.id);
  if (!group || !Number.isInteger(id) || id <= 0) return;
  selectDbGroup(group, false);
  if (isSystemNamedGroup(group)) void openManaged(systemNamedKind(group), id);
  else if (isCommonEventsGroup(group)) void openManaged('commonEvent', id);
  else void openManaged('database', id, group);
  const { group: _group, id: _id, ...rest } = route.query;
  void router.replace({ path: '/database', query: { ...rest, section: sectionForDbGroup(group) } });
}

watch(() => [route.query.group, route.query.id], () => applyRouteDatabaseFocus());

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
    await createCommonEvent();
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
    const kind = isSystemNamedGroup(group) ? systemNamedKind(group) : 'database';
    await projectManagement.resizeDatabase({
      kind,
      group: kind === 'database' ? group : undefined,
      maximum,
    }, projectStore.currentProject);
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

async function createCommonEvent() {
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
      resetCatalog();
      await ensureCatalog();
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

function detailTitle(): string {
  if (!pmDetail.value) return '';
  if (documentDatabasePage.value) return dbLabel(documentDatabasePage.value);
  const entry = pmDetail.value.entry;
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
    <div
      class="console-split pm-split"
      :class="{
        'write-locked': surfaceInteractionLocked,
        'is-document-group': isDocumentDatabaseGroup,
      }"
      :inert="surfaceInteractionLocked"
      :aria-disabled="surfaceInteractionLocked"
    >
      <!-- Sidebar: flat data-type list, stock RM tab order -->
      <aside class="console-panel pm-categories">
        <div class="console-panel-title">{{ t('app.nav.database') }}</div>
        <div class="pm-sidebar">
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
            <b v-if="opt.count !== null">{{ opt.count }}</b>
          </button>
        </div>
      </aside>

      <!-- Entry list -->
      <main v-if="!isDocumentDatabaseGroup" class="console-panel pm-entry-list">
        <div class="console-list-header">
          <span>{{ pmListHeaderTitle }}</span>
        </div>
        <div class="pm-list-search">
          <ConsoleSearchInput v-model="searchQuery" :placeholder="pmSearchPlaceholder" />
        </div>
        <div class="console-panel-scroll pm-content">

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
          <template v-else-if="isSystemNamedGroup(selectedDbGroup)">
            <div class="list-toolbar database-toolbar">
              <span>{{ itemCountLabel(filteredSystemNamedEntries.length) }}</span>
              <label class="toggle-label"><input type="checkbox" v-model="showUnnamed" /> {{ t('story.showUnnamed') }}</label>
              <button
                type="button"
                class="link-button"
                :disabled="detailBusy || stagingBusy || Boolean(selectedDatabaseReadIssue)"
                @click="changeSelectedDatabaseMaximum"
              >
                {{ t('story.databaseMaximum', { maximum: selectedDbCapacity }) }}
              </button>
            </div>
            <div v-if="selectedDatabaseReadIssue" class="read-issue-detail" role="alert">
              <strong>{{ t('story.databaseReadFailed') }}</strong>
              <span>{{ formatReadIssue(selectedDatabaseReadIssue) }}</span>
            </div>
            <div v-else class="id-list">
              <button
                v-for="entry in visibleSystemNamedEntries"
                :key="entry.id"
                type="button"
                :data-ui-id="`database-entry-${selectedDbGroup}-${entry.id}`"
                class="id-row"
                :class="{ active: pmDetail?.kind === 'managed'
                  && pmDetail.entry.kind === systemNamedKind()
                  && pmDetail.entry.id === entry.id }"
                @click="openManaged(systemNamedKind(), entry.id)"
              >
                <span class="row-id">{{ String(entry.id).padStart(4, '0') }}</span>
                <span class="row-name">{{ entry.name || unnamedLabel() }}</span>
              </button>
              <button
                v-if="hasMoreSystemNamedEntries"
                type="button"
                class="load-more"
                @click="showMoreGroupItems('database', selectedDbGroup, filteredSystemNamedEntries.length)"
              >
                {{ showMoreLabel(remainingSystemNamedEntries) }}
              </button>
              <div v-if="!visibleSystemNamedEntries.length" class="empty-hint">
                {{ t('story.noMatchEntries') }}
              </div>
            </div>
          </template>
          <template v-else>
            <div class="list-toolbar database-toolbar">
              <span>{{ selectedDatabaseReadIssue ? t('story.databaseReadFailed') : itemCountLabel(activeDbGroup.named.length) }}</span>
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
            </div>
            <div v-if="selectedDatabaseReadIssue" class="read-issue-detail" role="alert">
              <strong>{{ t('story.databaseReadFailed') }}</strong>
              <span>{{ formatReadIssue(selectedDatabaseReadIssue) }}</span>
            </div>
            <div v-else class="id-list">
              <button
                v-for="entry in visibleDbEntries"
                :key="entry.id"
                type="button"
                :data-ui-id="`database-entry-${selectedDbGroup}-${entry.id}`"
                class="id-row"
                :class="{ active: activeDbKey === `${selectedDbGroup}:${entry.id}` }"
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
              <span v-else>{{ t('story.selectEntryHint') }}</span>
            </div>
            <button
              v-if="(pmDetail || detailError) && !isDocumentDatabaseGroup"
              type="button"
              @click="clearDetailPanel"
            >×</button>
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
              @catalog-changed="reloadEditorCatalog"
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
              :document-page="documentDatabasePage || undefined"
              :catalog="editorCatalog"
              :schema="pmDetail.entry.schema"
              :load-image="loadImage"
              :battleback1-name="temporaryBattleback1Name"
              :battleback2-name="temporaryBattleback2Name"
              @update:model-value="updateDetailDraft"
              @update:battleback1-name="temporaryBattleback1Name = $event"
              @update:battleback2-name="temporaryBattleback2Name = $event"
              @request-battle-test="openBattleTestSetup"
              @catalog-changed="reloadEditorCatalog"
            />
          </div>
          <div
            v-else-if="pmDetail?.kind === 'managed'
              && (pmDetail.entry.kind === 'switch' || pmDetail.entry.kind === 'variable')"
            class="pm-detail-body"
          >
            <StagedEntryInspection :inspection="pmDetail.entry.inspection" />
            <SystemNamedEntryDetailEditor
              :model-value="detailDraft"
              :id-label="t('story.systemNamedId')"
              :name-label="t('story.systemNamedName')"
              @update:model-value="updateDetailDraft"
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
/* Stock RM proportions: narrow type tabs, entry list wide enough for id + name, wide editor. */
.pm-split {
  grid-template-columns: 172px 300px minmax(0, 1fr);
  padding: 14px 40px 34px;
  gap: 22px;
  overflow: hidden;
}
.pm-split.is-document-group {
  grid-template-columns: 172px minmax(0, 1fr);
}

/* Sidebar data-type list */
.pm-categories {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pm-sidebar { flex: 1; min-height: 0; overflow: auto; padding: 4px 6px 8px; }
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
.sub-category-button:focus-visible { outline: none; box-shadow: var(--app-ring); }

.pm-entry-list { min-height: 0; }
.pm-list-search {
  flex: 0 0 auto;
  padding: 8px 10px;
  border-bottom: 1px solid var(--console-border,#e4dcce);
}
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
.database-toolbar { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 6px 10px; color: var(--console-text-muted,#9a8e7e); font-size: 11px; white-space: nowrap; }
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
.audio-row .row-name,
.image-row .row-name { flex: 1; min-width: 0; }
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
.read-issue-detail{display:grid;gap:6px;margin:12px;padding:12px;border:1px solid color-mix(in srgb,var(--app-danger) 35%,var(--app-border));border-radius:6px;background:color-mix(in srgb,var(--app-danger) 7%,var(--app-bg));color:var(--app-danger);font-size:11px;overflow-wrap:anywhere}
.map-item.error,.sub-category-button.error{color:var(--app-danger)}

@media (max-width: 1320px) {
  .pm-split {
    grid-template-columns: 150px 260px minmax(0, 1fr);
    padding-inline: 28px;
    gap: 16px;
  }
  .pm-split.is-document-group {
    grid-template-columns: 150px minmax(0, 1fr);
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
