<script setup lang="ts">
import { ElImageViewer, ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import {
  ArrowDown,
  CaretBottom,
  CaretTop,
  Check,
  CopyDocument,
  Document,
  Headset,
  Film,
  MagicStick,
  Picture,
  Refresh,
  Sort,
  Star,
  StarFilled,
  Upload,
  View,
} from '@element-plus/icons-vue'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue'
import type { ElTree } from 'element-plus'
import type {
  ManagedAssetRef,
  ProjectAssetAnnotation,
  ProjectAssetBrowseEntry,
  ProjectAssetCategoryTreeNode,
  ProjectAssetCopyBatchResult,
  ProjectAssetCopyItemResult,
  ProjectAssetDeleteBatchResult,
  ProjectAssetDeleteItemResult,
  ProjectAssetDeleteTargetInput,
  ProjectAssetImportBatchResult,
  ProjectAssetImportItemResult,
  ProjectAssetMoveBatchResult,
  ProjectAssetMoveItemResult,
  ProjectAssetMutationSafetyCheck,
} from '@contract/types'
import {
  clipboard,
  maps as mapsApi,
  playtest,
  projectAssets,
  type ManagedAssetDetail,
} from '../api/client'
import AssetPreviewDialog from '../components/AssetPreviewDialog.vue'
import AssetFontPreview from '../components/AssetFontPreview.vue'
import AssetGridFontThumb from '../components/AssetGridFontThumb.vue'
import AssetGridVideoThumb from '../components/AssetGridVideoThumb.vue'
import AssetReferencesDialog from '../components/AssetReferencesDialog.vue'
import ProjectAssetsAudioBar, { type AssetsAudioBarItem } from '../components/ProjectAssetsAudioBar.vue'
import PluginFileFolderThumb from '../components/editor/PluginFileFolderThumb.vue'
import ConsoleSearchInput from '../components/console/ConsoleSearchInput.vue'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useWorkbenchUiStore } from '../stores/workbenchUi'
import type {
  AssetPreviewDialogLabels,
  AssetPreviewItem,
  AssetPreviewSurfaceLabels,
} from '../utils/assetPreview'
import { LatestAsyncCoordinator } from '../utils/latestAsyncCoordinator'
import {
  isProjectAssetGroupCategory,
  isProjectAssetImageCategory,
  projectAssetCanPreview,
  projectAssetCategoryLabel,
  projectAssetMediaKind,
} from '../utils/projectAssetLocalization'
import {
  parseProjectAssetBrowserNodeId,
  PROJECT_ASSET_PICTURES_CATEGORY_ID,
} from '@contract/project-asset-browser-nodes'
import { computeProjectAssetGridWindow } from '../utils/projectAssetGridWindow'
import {
  getCachedProjectAssetAudioDuration,
  loadProjectAssetAudioDuration,
} from '../utils/projectAssetAudioDurations'
import { formatPluginAudioClock } from '../utils/pluginFileAudioPreview'
import { planProjectAssetDeleteConfirmation } from '../utils/projectAssetDeleteFlow'
import {
  isProjectAssetUserPictureSubfolder,
  normalizeProjectAssetFolderLeafName,
} from '../utils/projectAssetFolderPolicy'
import {
  formatProjectAssetBytes,
  formatProjectAssetModified,
  formatProjectAssetTypeName,
} from '../utils/projectAssetListFormatting'
import { buildProjectAssetPathCrumbs } from '../utils/projectAssetPathCrumbs'
import {
  nextProjectAssetHeaderSort,
  sortProjectAssetEntries,
  type ProjectAssetSortDir,
  type ProjectAssetSortKey,
  type ProjectAssetSortKeySetting,
} from '../utils/projectAssetSorting'
import {
  clampProjectAssetThumbSize,
  clampProjectAssetPreviewPanelWidth,
  loadProjectAssetPreviewPanelWidth,
  loadProjectAssetSortPreference,
  loadProjectAssetThumbSize,
  loadProjectAssetViewMode,
  saveProjectAssetSortPreference,
  saveProjectAssetThumbSize,
  saveProjectAssetPreviewPanelWidth,
  saveProjectAssetViewMode,
  PROJECT_ASSET_PREVIEW_PANEL_WIDTH_MIN,
  PROJECT_ASSET_PREVIEW_PANEL_WIDTH_MAX,
  type ProjectAssetViewMode,
} from '../config/projectAssetsViewPrefs'
import {
  applyOverwriteBatchDecision,
  assertImportBatchResultShape,
  formatImportResultMessage,
  planDroppedImportItems,
  type ImportOverwriteCandidate,
} from '../utils/projectAssetImportFlow'
import {
  clearProjectAssetFavorites,
  getProjectAssetFavorites,
} from '../utils/projectAssetFavorites'
import {
  clearProjectAssetSelection,
  emptyProjectAssetSelection,
  normalizeContentRect,
  pruneProjectAssetSelection,
  selectAllProjectAssets,
  selectProjectAssetExclusive,
  selectProjectAssetRange,
  selectProjectAssetsByMarquee,
  toggleProjectAssetSelection,
  viewportPointToContentPoint,
  type ProjectAssetSelectionState,
} from '../utils/projectAssetSelection'
import { selectProjectAssetThumbnailBucket } from '../utils/projectAssetThumbnailBucket'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'
import { buildProjectAssetEffectPreview } from '../utils/projectAssetEffectPreview'

/**
 * Explorer-like grid metrics. cellWidth hugs the square thumbnail;
 * cellHeight adds a two-line name band. Rendering and marquee share these values.
 * Sizes include padding + 1px border (border-box on the cell).
 */
const CELL_GAP = 16
const CELL_PAD = 8
const CELL_BORDER = 1
const CELL_INNER_GAP = 6
const NAME_LINE_HEIGHT = 13
const NAME_LINES = 2
const OVERSCAN_ROWS = 2
const GRID_INSET = 12
const THUMB_ARM_BATCH = 6

type TreeNodeView = {
  id: string
  label: string
  entryCount: number
  children?: TreeNodeView[]
}

type FolderGridItem = {
  kind: 'folder'
  id: string
  label: string
  entryCount: number
}

type FileGridItem = {
  kind: 'file'
  entry: ProjectAssetBrowseEntry
}

type GridItem = FolderGridItem | FileGridItem

const projectStore = useProjectStore()
const workbenchUi = useWorkbenchUiStore()
const { language, t } = useI18n()

const treeRef = ref<InstanceType<typeof ElTree> | null>(null)
const gridHost = ref<HTMLElement | null>(null)

const treeNodes = ref<ProjectAssetCategoryTreeNode[]>([])
const treeError = ref('')
const treeLoading = ref(false)

const selectedCategoryId = ref('')
const categoryEntries = ref<ProjectAssetBrowseEntry[]>([])
const categoryDirectory = ref('')
const categoryError = ref('')
const categoryLoading = ref(false)

const favorites = ref<Set<string>>(new Set())

/** Full annotation rows (note + favorite) keyed by target id, loaded with favorites. */
const annotationIndex = ref<Map<string, ProjectAssetAnnotation>>(new Map())

/** Frontend-only virtual tree node aggregating favorited files and folders. */
const FAVORITES_NODE_ID = '__favorites__'

const isFavoritesSelection = computed(() => selectedCategoryId.value === FAVORITES_NODE_ID)

/**
 * Entry ids embed their base category (`pictures:ui/foo`). The favorites view
 * mixes categories in one grid, so per-entry gates must not use selectedCategoryId.
 */
function entryCategoryId(entry: ProjectAssetBrowseEntry): string {
  const sep = entry.id.indexOf(':')
  return sep > 0 ? entry.id.slice(0, sep) : selectedCategoryId.value
}

/** Browser nodes that must be listed to resolve the favorited file ids. */
function favoriteListingNodes(ids: ReadonlySet<string>): string[] {
  const nodes = new Set<string>()
  for (const id of ids) {
    const sep = id.indexOf(':')
    if (sep <= 0) continue // folder favorites carry the node id itself
    const category = id.slice(0, sep)
    const name = id.slice(sep + 1)
    const slash = name.lastIndexOf('/')
    nodes.add(slash > 0 ? `${category}/${name.slice(0, slash)}` : category)
  }
  return [...nodes]
}

async function refreshFavorites(): Promise<void> {
  const project = projectStore.currentProject
  if (!project) return
  try {
    await migrateLegacyFavoritesToDb(project)
    const list = await projectAssets.listAnnotations(project)
    if (projectStore.currentProject !== project) return
    const index = new Map<string, ProjectAssetAnnotation>()
    const favoriteIds = new Set<string>()
    for (const item of list) {
      index.set(item.targetId, item)
      // Map favorites share the table but belong to the editor map tree, not this view.
      if (item.favorite && item.kind !== 'map') favoriteIds.add(item.targetId)
    }
    annotationIndex.value = index
    favorites.value = favoriteIds
  } catch {
    /* annotations unavailable; favorites stay as-is */
  }
}

/** One-time migration: legacy localStorage favorites → rmmv.db asset_annotations. */
async function migrateLegacyFavoritesToDb(project: string): Promise<void> {
  const legacy = getProjectAssetFavorites(project)
  if (legacy.size === 0) return
  for (const id of legacy) {
    await projectAssets.setAnnotation({
      targetId: id,
      kind: id.includes(':') ? 'asset' : 'folder',
      favorite: true,
    }, project)
  }
  clearProjectAssetFavorites(project)
}

function toggleFavorite(id: string): void {
  const project = projectStore.currentProject
  if (!project) return
  const next = new Set(favorites.value)
  const makeFavorite = !next.has(id)
  if (makeFavorite) {
    next.add(id)
  } else {
    next.delete(id)
  }
  favorites.value = next
  void projectAssets.setAnnotation({
    targetId: id,
    kind: id.includes(':') ? 'asset' : 'folder',
    favorite: makeFavorite,
  }, project).catch(() => {
    void refreshFavorites() // revert the optimistic flip on failure
  })
}

function toggleFavoriteForContextFolder(): void {
  const folderId = contextFolderId.value
  closeContextMenu()
  if (folderId) toggleFavorite(folderId)
}

function isFavorite(id: string): boolean {
  return favorites.value.has(id)
}

/** Stored note for any annotation target (file entry id or folder node id). */
function entryNote(targetId: string): string {
  return annotationIndex.value.get(targetId)?.note || ''
}

async function editNoteForSelection(): Promise<void> {
  const entry = singleSelectedFile.value
  closeContextMenu()
  if (!entry) return
  await editNoteForTarget(entry.id, 'asset', entryPrimaryPath(entry))
}

async function editNoteForContextFolder(): Promise<void> {
  const folderId = contextFolderId.value
  closeContextMenu()
  if (folderId) await editNoteForTarget(folderId, 'folder', null)
}

/** Prompt-based note editor; notes double-write to DB and (PNG/OGG) into the file itself. */
async function editNoteForTarget(
  targetId: string,
  kind: 'asset' | 'folder',
  relativePath: string | null,
): Promise<void> {
  const project = projectStore.currentProject
  if (!project) return
  const current = entryNote(targetId)
  let note = ''
  try {
    const response = await ElMessageBox.prompt(
      t('projectAssets.notePrompt'),
      t('projectAssets.noteTitle'),
      { inputType: 'textarea', inputValue: current },
    )
    note = String(response.value ?? '')
  } catch {
    return
  }
  if (note === current) return
  try {
    const result = await projectAssets.setAnnotation({
      targetId,
      kind,
      note,
      relativePath: relativePath || undefined,
    }, project)
    const next = new Map(annotationIndex.value)
    if (result) {
      next.set(targetId, result)
    } else {
      next.delete(targetId)
    }
    annotationIndex.value = next
    ElMessage.success(t('projectAssets.noteSaved'))
  } catch (error) {
    showMutationToast(formatError(error))
  }
}

const searchQuery = ref('')
const sortPreference = loadProjectAssetSortPreference()
const sortKey = ref<ProjectAssetSortKeySetting>(sortPreference.key)
const sortDir = ref<ProjectAssetSortDir>(sortPreference.dir)
const viewMode = ref<ProjectAssetViewMode>(loadProjectAssetViewMode('other'))
const selection = ref<ProjectAssetSelectionState>(emptyProjectAssetSelection())
const selectedFolderId = ref<string | null>(null)
const mutationBusy = ref(false)
const mutationError = ref('')

const previewVisible = ref(false)
const previewIndex = ref(0)
const imageViewerVisible = ref(false)
const imageViewerUrls = ref<string[]>([])
const imageViewerIndex = ref(0)

const pageHost = ref<HTMLElement | null>(null)
const previewPanelRequested = ref(false)
const previewPanelWidth = ref(loadProjectAssetPreviewPanelWidth())

const previewPanelEntry = computed(() => {
  const entries = selectedFileEntries.value
  if (entries.length !== 1) return null
  return entries[0]!
})
const previewPanelMedia = computed(() => {
  const entry = previewPanelEntry.value
  return projectAssetMediaKind(entry ? entryCategoryId(entry) : selectedCategoryId.value)
})
const previewToggleAvailable = computed(() => previewPanelMedia.value !== 'audio')
const previewPanelVisible = computed(() =>
  previewPanelRequested.value && previewToggleAvailable.value)
const previewPanelNote = computed(() =>
  previewPanelEntry.value ? entryNote(previewPanelEntry.value.id).trim() : '')

let previewResizeStartX = 0
let previewResizeStartWidth = 0

function effectivePreviewPanelMaxWidth(): number {
  const available = (pageHost.value?.clientWidth || window.innerWidth) - 230 - 32 - 40 - 360
  return Math.max(
    PROJECT_ASSET_PREVIEW_PANEL_WIDTH_MIN,
    Math.min(PROJECT_ASSET_PREVIEW_PANEL_WIDTH_MAX, available),
  )
}

function setPreviewPanelWidth(width: number, persist = false): void {
  previewPanelWidth.value = Math.min(
    effectivePreviewPanelMaxWidth(),
    clampProjectAssetPreviewPanelWidth(width),
  )
  if (persist) saveProjectAssetPreviewPanelWidth(previewPanelWidth.value)
}

function onPreviewResizeStart(event: PointerEvent): void {
  previewResizeStartX = event.clientX
  previewResizeStartWidth = previewPanelWidth.value
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPreviewResizeMove(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement
  if (!target.hasPointerCapture(event.pointerId)) return
  setPreviewPanelWidth(previewResizeStartWidth - (event.clientX - previewResizeStartX))
}

function onPreviewResizeEnd(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement
  if (!target.hasPointerCapture(event.pointerId)) return
  target.releasePointerCapture(event.pointerId)
  saveProjectAssetPreviewPanelWidth(previewPanelWidth.value)
}

function onPreviewResizeKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 16
  let width: number | null = null
  if (event.key === 'ArrowLeft') width = previewPanelWidth.value + step
  if (event.key === 'ArrowRight') width = previewPanelWidth.value - step
  if (event.key === 'Home') width = PROJECT_ASSET_PREVIEW_PANEL_WIDTH_MIN
  if (event.key === 'End') width = effectivePreviewPanelMaxWidth()
  if (width === null) return
  event.preventDefault()
  setPreviewPanelWidth(width, true)
}

const contextMenu = ref<{ x: number; y: number } | null>(null)
const contextMenuRef = ref<HTMLElement | null>(null)
const contextMenuKind = ref<'cell' | 'background' | 'folder' | 'tree'>('cell')
const contextFolderId = ref<string | null>(null)

/** In-app clipboard: mutation-target snapshot taken at copy/cut time (carries the source category). */
const assetClipboard = ref<{ mode: 'copy' | 'move'; targets: ProjectAssetDeleteTargetInput[] } | null>(null)

/** In-app folder clipboard for Explorer-style cut of an MZ pictures subfolder. */
const folderClipboard = ref<{ nodeId: string } | null>(null)

const referencesDialog = ref<{
  name: string
  references: ManagedAssetRef[]
  loading: boolean
  failed: boolean
} | null>(null)

const containerWidth = ref(0)
const containerHeight = ref(0)
const scrollTop = ref(0)
const failedThumbnails = ref(new Set<string>())
/** Ids allowed to bind thumbnail src; armed top→bottom so the serial main-process queue matches viewport order. */
const armedThumbnailIds = ref(new Set<string>())
let thumbnailArmGeneration = 0
/** Lazy per-category folder-icon previews: categoryId -> up to two thumbnail URLs. */
const folderPreviews = ref(new Map<string, string[]>())
const folderPreviewLoading = new Set<string>()

/** Thumbnail edge in px (user zoom, 48-512, persisted). Default 72. */
const thumbSize = ref(loadProjectAssetThumbSize())
const cellWidth = computed(() =>
  thumbSize.value + CELL_PAD * 2 + CELL_BORDER * 2,
)
const cellHeight = computed(() =>
  CELL_PAD
  + thumbSize.value
  + CELL_INNER_GAP
  + NAME_LINE_HEIGHT * NAME_LINES
  + CELL_PAD
  + CELL_BORDER * 2,
)

type MarqueeState = {
  originX: number
  originY: number
  currentX: number
  currentY: number
}
const marquee = ref<MarqueeState | null>(null)
let marqueeActive = false
let suppressNextClick = false
let marqueePending = false
let marqueePendingOrigin: { x: number; y: number } | null = null
let marqueePendingHost: HTMLElement | null = null
let marqueePendingPointerId = -1
const MARQUEE_DRAG_THRESHOLD = 5
const fileDropActive = ref(false)
let fileDragDepth = 0

const listingCoordinator = new LatestAsyncCoordinator<{
  project: string
  categoryId: string
  bucket: number
}>()

let resizeObserver: ResizeObserver | null = null
let unsubscribeAssetWatcher: (() => void) | null = null

const previewSurfaceLabels = computed<AssetPreviewSurfaceLabels>(() => ({
  previewFailed: t('projectAssets.previewFailed'),
  none: t('projectAssets.previewNone'),
  previewZoom: t('projectAssets.previewZoom'),
  resetZoom: t('projectAssets.resetZoom'),
  zoomOut: t('projectAssets.zoomOut'),
  zoomIn: t('projectAssets.zoomIn'),
  fontSample: t('projectAssets.fontPreviewSample'),
  fontLoadFailed: t('projectAssets.fontPreviewFailed'),
}))

const previewDialogLabels = computed<AssetPreviewDialogLabels>(() => ({
  closeTitle: t('projectAssets.previewCloseTitle'),
  close: t('common.close'),
}))

const referencesDialogLabels = computed(() => ({
  title: t('projectAssets.referencesTitle'),
  empty: t('projectAssets.referencesEmpty'),
  loadFailed: t('projectAssets.referencesLoadFailed'),
  loading: t('projectAssets.referencesLoading'),
  close: t('common.close'),
}))

const thumbnailBucket = computed(() =>
  selectProjectAssetThumbnailBucket(thumbSize.value, window.devicePixelRatio || 1),
)

const treeData = computed<TreeNodeView[]>(() => {
  const nodes = treeNodes.value.map((node) => mapTreeNode(node))
  if (nodes.length === 0) return nodes
  return [
    {
      id: FAVORITES_NODE_ID,
      label: t('projectAssets.favoritesNode'),
      entryCount: favorites.value.size,
      children: undefined,
    },
    ...nodes,
  ]
})

const selectedNode = computed(() => findTreeNode(treeNodes.value, selectedCategoryId.value))

const isGroupSelection = computed(() =>
  Boolean(selectedCategoryId.value && isProjectAssetGroupCategory(selectedCategoryId.value)),
)

const folderItems = computed<FolderGridItem[]>(() => {
  if (isFavoritesSelection.value) {
    const items: FolderGridItem[] = []
    for (const id of favorites.value) {
      if (id.includes(':')) continue
      const node = findTreeNode(treeNodes.value, id)
      if (!node) continue
      items.push({
        kind: 'folder' as const,
        id: node.id,
        label: projectAssetCategoryLabel(node.id, language.value),
        entryCount: node.entryCount,
      })
    }
    return items.sort((left, right) => left.label.localeCompare(right.label))
  }
  const node = selectedNode.value
  if (!node?.children?.length) return []
  return node.children.map((child) => ({
    kind: 'folder' as const,
    id: child.id,
    label: projectAssetCategoryLabel(child.id, language.value),
    entryCount: child.entryCount,
  }))
})

const filteredEntries = computed(() => {
  // Favorites listing is a snapshot; keep it live against un-favoriting.
  const base = isFavoritesSelection.value
    ? categoryEntries.value.filter((entry) => favorites.value.has(entry.id))
    : categoryEntries.value
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return base
  return base.filter((entry) => entry.name.toLowerCase().includes(query))
})

/** Search-filtered entries in the user's chosen sort order; single order source for grid, range-select and preview navigation. */
const sortedEntries = computed(() =>
  sortProjectAssetEntries(filteredEntries.value, sortKey.value, sortDir.value),
)

watch([sortKey, sortDir], ([key, dir]) => {
  saveProjectAssetSortPreference({ key, dir })
})

/** Explorer-style sort menu entries (menu order: name, date modified, type, size). */
const sortMenuItems = computed(() => ([
  { key: 'name' as const, label: t('projectAssets.sortName') },
  { key: 'mtimeMs' as const, label: t('projectAssets.sortModified') },
  { key: 'type' as const, label: t('projectAssets.sortType') },
  { key: 'bytes' as const, label: t('projectAssets.sortSize') },
]))

/** Details header columns share the sort keys with the toolbar menu. */
const detailHeaderColumns = computed(() => {
  const columns: Array<{
    key: ProjectAssetSortKey | 'duration' | 'note'
    label: string
    className: string
    sortable: boolean
  }> = [
    { key: 'name', label: t('projectAssets.columnName'), className: 'col-name', sortable: true },
    { key: 'type', label: t('projectAssets.columnType'), className: 'col-type', sortable: true },
    { key: 'bytes', label: t('projectAssets.columnSize'), className: 'col-size', sortable: true },
  ]
  if (detailsShowsDuration.value) {
    columns.push({ key: 'duration', label: t('projectAssets.columnDuration'), className: 'col-duration', sortable: false })
  }
  columns.push({ key: 'mtimeMs', label: t('projectAssets.columnModified'), className: 'col-mtime', sortable: true })
  columns.push({ key: 'note', label: t('projectAssets.columnNote'), className: 'col-note', sortable: false })
  return columns
})

/** Header click cycles the column: ascending → descending → natural order. */
function onHeaderSortClick(column: ProjectAssetSortKey) {
  const next = nextProjectAssetHeaderSort(sortKey.value, sortDir.value, column)
  sortKey.value = next.key
  sortDir.value = next.dir
}

// ── Audio durations (lazy, viewport-driven; the user accepts delayed display) ──

/** Bumped whenever a probe settles so cached labels re-render. */
const audioDurationVersion = ref(0)

function isAudioEntry(entry: ProjectAssetBrowseEntry): boolean {
  return projectAssetMediaKind(entryCategoryId(entry)) === 'audio'
}

/** The duration column only appears when the listing actually contains audio files. */
const detailsShowsDuration = computed(() => sortedEntries.value.some((entry) => isAudioEntry(entry)))

function requestAudioDuration(entry: ProjectAssetBrowseEntry): void {
  if (!isAudioEntry(entry) || !entry.url) return
  if (getCachedProjectAssetAudioDuration(entry.url) !== undefined) return
  void loadProjectAssetAudioDuration(entry.url).then(() => {
    audioDurationVersion.value += 1
  })
}

function entryDurationLabel(entry: ProjectAssetBrowseEntry): string {
  void audioDurationVersion.value
  if (!isAudioEntry(entry) || !entry.url) return '—'
  const cached = getCachedProjectAssetAudioDuration(entry.url)
  if (cached === undefined) return '…'
  if (Number.isNaN(cached)) return '—'
  return formatPluginAudioClock(cached)
}

// ── Docked audio player (selection → right-click Play; Stop hides the bar) ──

const audioPlaylist = ref<AssetsAudioBarItem[] | null>(null)

const selectedAudioEntries = computed(() =>
  selectedFileEntries.value.filter((entry) => isAudioEntry(entry) && Boolean(entry.url)),
)

function playSelectedAudio(): void {
  const entries = selectedAudioEntries.value
  closeContextMenu()
  playAudioEntries(entries)
}

function playAudioEntries(entries: ProjectAssetBrowseEntry[]): void {
  if (entries.length === 0) return
  audioPlaylist.value = entries.map((entry) => ({
    id: entry.id,
    name: displayAssetName(entry.name),
    url: entry.url as string,
  }))
}

function closeAudioPlayer(): void {
  audioPlaylist.value = null
}

/** Explorer-style View menu icon-size presets (labels localized). */
const iconSizePresets = computed(() => ([
  { key: 'xl', size: 256, label: t('projectAssets.viewIcons.xl') },
  { key: 'l', size: 128, label: t('projectAssets.viewIcons.l') },
  { key: 'm', size: 72, label: t('projectAssets.viewIcons.m') },
  { key: 's', size: 48, label: t('projectAssets.viewIcons.s') },
]))

watch(thumbSize, (size) => {
  saveProjectAssetThumbSize(size)
})

watch(selectedCategoryId, (categoryId, previousCategoryId) => {
  if (categoryId !== previousCategoryId) closeAudioPlayer()
  if (!categoryId) return
  viewMode.value = loadProjectAssetViewMode(projectAssetMediaKind(categoryId))
})

watch(viewMode, (mode) => {
  if (!selectedCategoryId.value) return
  saveProjectAssetViewMode(mode, projectAssetMediaKind(selectedCategoryId.value))
})

const showIconGrid = computed(() => viewMode.value === 'icons')
const showDetailsView = computed(() => viewMode.value === 'details' || viewMode.value === 'list')

const displayDirectory = computed(() => {
  const node = selectedNode.value
  if (node?.directory) return node.directory
  return categoryDirectory.value
})

const pathCrumbs = computed(() =>
  buildProjectAssetPathCrumbs(displayDirectory.value, treeNodes.value),
)

/** Absolute on-disk directory for the current node — what "copy path" writes and hover shows. */
const displayAbsoluteDirectory = computed(() => {
  const project = projectStore.currentProject
  const relative = displayDirectory.value
  if (!project || !relative) return ''
  const separator = project.includes('\\') ? '\\' : '/'
  const root = project.replace(/[\\/]+$/, '')
  return [root, ...relative.split('/').filter(Boolean)].join(separator)
})

const searchPlaceholder = computed(() => {
  // The favorites node is frontend-only; projectAssetCategoryLabel would throw for it.
  const label = isFavoritesSelection.value
    ? t('projectAssets.favoritesNode')
    : selectedCategoryId.value
      ? projectAssetCategoryLabel(selectedCategoryId.value, language.value)
      : ''
  if (!label) return t('projectAssets.searchPlaceholder')
  return t('projectAssets.searchInFolder', { name: label })
})

const imageDimensionCache = ref(new Map<string, { width: number; height: number }>())

const previewableImageEntries = computed(() => {
  return sortedEntries.value.filter((entry) => {
    const categoryId = entryCategoryId(entry)
    return isProjectAssetImageCategory(categoryId)
      && projectAssetCanPreview(categoryId, entry.encrypted)
      && entry.url
  })
})

function onGridWheel(event: WheelEvent) {
  if (!showIconGrid.value || !event.ctrlKey) return
  event.preventDefault()
  const step = event.deltaY > 0 ? -8 : 8
  thumbSize.value = clampProjectAssetThumbSize(thumbSize.value + step)
}

const gridItems = computed<GridItem[]>(() => {
  if (!selectedCategoryId.value) return []
  const query = searchQuery.value.trim().toLowerCase()
  const folders = query
    ? folderItems.value.filter((item) => item.label.toLowerCase().includes(query))
    : folderItems.value
  // Group roots (audio / img): folders only.
  if (isGroupSelection.value) return folders
  // Leaf categories may still have children (MZ pictures disk subfolders).
  // Explorer order: folders first, then files at this level.
  const files = sortedEntries.value.map((entry) => ({ kind: 'file' as const, entry }))
  return [...folders, ...files]
})

const gridWindow = computed(() =>
  computeProjectAssetGridWindow({
    containerWidth: Math.max(0, containerWidth.value - GRID_INSET * 2),
    containerHeight: Math.max(0, containerHeight.value - GRID_INSET * 2),
    cellWidth: cellWidth.value,
    cellHeight: cellHeight.value,
    gap: CELL_GAP,
    itemCount: gridItems.value.length,
    scrollTop: Math.max(0, scrollTop.value - GRID_INSET),
    overscanRows: OVERSCAN_ROWS,
  }),
)

const visibleItems = computed(() => {
  const { startIndex, endIndex, columnCount } = gridWindow.value
  const width = cellWidth.value
  const height = cellHeight.value
  return gridItems.value.slice(startIndex, endIndex).map((item, offset) => {
    const index = startIndex + offset
    const row = Math.floor(index / columnCount)
    const column = index % columnCount
    return {
      item,
      index,
      style: {
        position: 'absolute' as const,
        left: `${GRID_INSET + column * (width + CELL_GAP)}px`,
        top: `${GRID_INSET + row * (height + CELL_GAP)}px`,
        width: `${width}px`,
        height: `${height}px`,
      },
    }
  })
})

/** Fetch up to three image thumbnails of a category for its folder icon. Cached and in-flight deduped; failures settle as "no previews" without retry storms. */
async function ensureFolderPreview(categoryId: string) {
  const project = projectStore.currentProject
  if (!project) return
  if (folderPreviews.value.has(categoryId) || folderPreviewLoading.has(categoryId)) return
  folderPreviewLoading.add(categoryId)
  try {
    const listing = await projectAssets.browseCategory(categoryId, project, 128)
    const urls = listing.entries
      .filter((entry) => Boolean(entry.thumbnailUrl) && !entry.encrypted)
      .slice(0, 3)
      .map((entry) => entry.thumbnailUrl as string)
    folderPreviews.value.set(categoryId, urls)
  } catch {
    folderPreviews.value.set(categoryId, [])
  } finally {
    folderPreviewLoading.delete(categoryId)
  }
}

watch(visibleItems, (items) => {
  for (const cell of items) {
    if (cell.item.kind === 'folder') void ensureFolderPreview(cell.item.id)
  }
  void armVisibleThumbnails(items)
}, { immediate: true })

async function armVisibleThumbnails(
  items: Array<{ item: GridItem; index: number }>,
) {
  const generation = ++thumbnailArmGeneration
  const ordered = [...items]
    .filter((cell) => cell.item.kind === 'file')
    .sort((left, right) => left.index - right.index)
  const pending = ordered.filter((cell) => cell.item.kind === 'file' && !armedThumbnailIds.value.has(cell.item.entry.id))
  for (let offset = 0; offset < pending.length; offset += THUMB_ARM_BATCH) {
    if (generation !== thumbnailArmGeneration) return
    const batch = pending.slice(offset, offset + THUMB_ARM_BATCH)
    const next = new Set(armedThumbnailIds.value)
    for (const cell of batch) {
      if (cell.item.kind !== 'file') continue
      next.add(cell.item.entry.id)
    }
    armedThumbnailIds.value = next
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

function displayAssetName(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || name
}

const emptyMessage = computed(() => {
  if (!projectStore.currentProject) return t('projectAssets.noProject')
  if (!selectedCategoryId.value) return t('projectAssets.selectCategory')
  if (categoryLoading.value || treeLoading.value) return ''
  if (gridItems.value.length === 0) {
    return searchQuery.value.trim()
      ? t('projectAssets.emptySearch')
      : isGroupSelection.value || categoryEntries.value.length === 0
        ? t('projectAssets.emptyCategory')
        : t('projectAssets.emptySearch')
  }
  return ''
})

const previewItems = computed<AssetPreviewItem[]>(() => {
  if (isGroupSelection.value) return []
  return sortedEntries.value.map((entry) => toPreviewItem(entry))
})

const canImport = computed(() =>
  Boolean(
    projectStore.currentProject
    && selectedCategoryId.value
    && !isGroupSelection.value
    && !isFavoritesSelection.value
    && !mutationBusy.value,
  ),
)

/** Ordered file ids for the current category listing (full list; not the virtualized window). */
const orderedFileIds = computed(() => {
  if (isGroupSelection.value) return [] as string[]
  return sortedEntries.value.map((entry) => entry.id)
})

const selectedIdSet = computed(() => new Set(selection.value.selectedIds))

const selectedFileEntries = computed(() => {
  if (isGroupSelection.value) return [] as ProjectAssetBrowseEntry[]
  const ids = selectedIdSet.value
  return sortedEntries.value.filter((entry) => ids.has(entry.id))
})

const singleSelectedFile = computed(() =>
  selectedFileEntries.value.length === 1 ? selectedFileEntries.value[0]! : null,
)

const contextDeleteLabel = computed(() => {
  const count = selectedFileEntries.value.length
  if (count <= 1) return t('projectAssets.delete')
  return t('projectAssets.deleteMany', { count })
})

const selectionStats = computed(() => {
  const entries = selectedFileEntries.value
  if (entries.length === 0) return null
  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes || 0), 0)
  return { count: entries.length, totalBytes, totalSize: formatSize(totalBytes) }
})

const marqueeStyle = computed(() => {
  if (!marquee.value) return null
  const rect = normalizeContentRect({
    left: marquee.value.originX,
    top: marquee.value.originY,
    right: marquee.value.currentX,
    bottom: marquee.value.currentY,
  })
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.right - rect.left}px`,
    height: `${rect.bottom - rect.top}px`,
  }
})

function mapTreeNode(node: ProjectAssetCategoryTreeNode): TreeNodeView {
  return {
    id: node.id,
    label: projectAssetCategoryLabel(node.id, language.value),
    entryCount: node.entryCount,
    children: node.children?.map((child) => mapTreeNode(child)),
  }
}

function findTreeNode(
  nodes: ProjectAssetCategoryTreeNode[],
  id: string,
): ProjectAssetCategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findTreeNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

function formatSize(size: number): string {
  return formatProjectAssetBytes(size) || '—'
}

function formatModified(mtimeMs: number): string {
  return formatProjectAssetModified(mtimeMs) || '—'
}

function entryTypeLabel(entry: ProjectAssetBrowseEntry): string {
  return formatProjectAssetTypeName(entry.variants[0]?.extension || '') || '—'
}

function cellExtensionTag(entry: ProjectAssetBrowseEntry): string {
  const raw = entry.variants[0]?.extension || entry.name.split('.').pop() || ''
  // Backend extensions carry the leading dot (path.extname); tags show bare "png".
  return raw.replace(/^\./, '').toLowerCase()
}

function cellExtensionColorClass(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(e)) return 'ext-image'
  if (['ogg', 'mp3', 'wav', 'm4a', 'flac', 'aac'].includes(e)) return 'ext-audio'
  if (['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(e)) return 'ext-video'
  if (['ttf', 'otf', 'woff', 'woff2'].includes(e)) return 'ext-font'
  return 'ext-other'
}

function formatError(errorValue: unknown): string {
  return formatUserFacingErrorMessage(errorValue, 'general', language.value)
}

function typeIcon(categoryId: string) {
  if (isProjectAssetImageCategory(categoryId)) return Picture
  if (categoryId === 'movies') return Film
  if (categoryId === 'effects') return MagicStick
  if (categoryId === 'fonts') return Document
  if (projectAssetMediaKind(categoryId) === 'audio') return Headset
  return Document
}

/** Scale type icons with the thumb slider (avoid tiny glyph in a huge square). */
function typeIconSizePx(size: number): number {
  return Math.max(20, Math.min(96, Math.round(size * 0.45)))
}

/** Fonts and movies get in-cell content previews; both arm lazily like image thumbnails. */
function usesArmedFontThumb(categoryId: string): boolean {
  return projectAssetMediaKind(categoryId) === 'font'
}

function usesArmedVideoThumb(categoryId: string): boolean {
  return categoryId === 'movies'
}

function cellUsesIconFallback(entry: ProjectAssetBrowseEntry): boolean {
  if (entry.encrypted) return true
  if (failedThumbnails.value.has(entry.id)) return true
  const categoryId = entryCategoryId(entry)
  if (isProjectAssetImageCategory(categoryId)) {
    return !entry.thumbnailUrl
  }
  if (usesArmedFontThumb(categoryId) || usesArmedVideoThumb(categoryId)) {
    return !entry.url || !armedThumbnailIds.value.has(entry.id)
  }
  return true
}

function cellShowsFontThumb(entry: ProjectAssetBrowseEntry): boolean {
  if (entry.encrypted || failedThumbnails.value.has(entry.id)) return false
  if (!usesArmedFontThumb(entryCategoryId(entry))) return false
  return Boolean(entry.url) && armedThumbnailIds.value.has(entry.id)
}

function entryPrimaryPath(entry: ProjectAssetBrowseEntry): string {
  return entry.variants[0]?.relativePath || ''
}

function clearFileSelection() {
  selection.value = clearProjectAssetSelection()
}

function clearAllSelection() {
  clearFileSelection()
  selectedFolderId.value = null
}

function isFileSelected(entryId: string): boolean {
  return selectedIdSet.value.has(entryId)
}

function isFolderSelected(folderId: string): boolean {
  return selectedFolderId.value === folderId
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function applyFileSelection(next: ProjectAssetSelectionState) {
  selectedFolderId.value = null
  selection.value = next
}

function focusGridHost() {
  gridHost.value?.focus({ preventScroll: true })
}

function buildEntryMetadata(entry: ProjectAssetBrowseEntry): string {
  const parts = [
    t('projectAssets.metaSize', { size: formatSize(entry.bytes) }),
    t('projectAssets.metaModified', { time: formatModified(entry.mtimeMs) }),
  ]
  if (entry.variants.length > 1) {
    parts.push(t('projectAssets.metaVariants', {
      files: entry.variants.map((variant) => variant.fileName).join(', '),
    }))
  }
  if (entry.encrypted) {
    parts.push(t('projectAssets.cannotPreviewEncrypted'))
  }
  return parts.join(' · ')
}

function buildEffectPreviewInfo(entry: ProjectAssetBrowseEntry): NonNullable<AssetPreviewItem['info']> {
  const rows = [
    { label: t('projectAssets.effectInfoName'), value: entry.name },
    { label: t('projectAssets.effectInfoSize'), value: formatSize(entry.bytes) },
    { label: t('projectAssets.effectInfoModified'), value: formatModified(entry.mtimeMs) },
  ]
  if (entry.variants.length > 0) {
    rows.push({
      label: t('projectAssets.effectInfoFiles'),
      value: entry.variants.map((variant) => variant.relativePath || variant.fileName).join(', '),
    })
  }
  return {
    notice: t('projectAssets.effectPreviewDescription'),
    rows,
    action: {
      label: t('projectAssets.previewEffect'),
      run: () => startEffectPreview(entry),
    },
  }
}

async function startEffectPreview(entry: ProjectAssetBrowseEntry): Promise<void> {
  const project = projectStore.currentProject
  if (!project || entry.encrypted) return
  try {
    const result = await playtest.start({
      mode: 'particle_preview',
      project,
      animationPreview: buildProjectAssetEffectPreview(entry.name),
    })
    if (result.error || !result.run || result.run.status === 'failed' || result.run.status === 'stop_failed') {
      throw new Error(result.run?.error || result.error || t('topbar.playtest.launchFailed'))
    }
    ElMessage.success(t('projectAssets.effectPreviewStarted'))
  } catch (error) {
    ElMessage.error(t('projectAssets.effectPreviewFailed', { message: formatError(error) }))
  }
}

function toPreviewItem(entry: ProjectAssetBrowseEntry): AssetPreviewItem {
  const categoryId = entryCategoryId(entry)
  const media = projectAssetMediaKind(categoryId)
  const canPreview = projectAssetCanPreview(categoryId, entry.encrypted)
  if (media === 'effect' && !entry.encrypted) {
    return {
      id: entry.id,
      displayName: entry.name,
      url: '',
      media: 'effect',
      metadata: buildEntryMetadata(entry),
      info: buildEffectPreviewInfo(entry),
    }
  }
  return {
    id: entry.id,
    displayName: entry.name,
    url: canPreview ? entry.url : '',
    media: canPreview ? media : 'other',
    metadata: buildEntryMetadata(entry),
  }
}

function measureGrid() {
  const el = gridHost.value
  if (!el) return
  containerWidth.value = el.clientWidth
  containerHeight.value = el.clientHeight
}

function onGridScroll() {
  scrollTop.value = gridHost.value?.scrollTop || 0
  clearMetaTooltip()
}

function syncTreeCurrentKey(categoryId: string) {
  nextTick(() => {
    treeRef.value?.setCurrentKey(categoryId || undefined)
  })
}

async function refreshStagingStatus() {
  if (!projectStore.currentProject) {
    workbenchUi.sbStagingDirty = false
    return
  }
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject)
    workbenchUi.sbStagingDirty = Boolean((status as { staged?: boolean }).staged)
  } catch {
    // Best-effort only: asset mutations are immediate and a stale global indicator
    // must not be presented as asset staging.
  }
}

async function loadTree(preferredCategoryId?: string) {
  folderPreviews.value = new Map()
  if (!projectStore.currentProject) {
    treeNodes.value = []
    selectedCategoryId.value = ''
    categoryEntries.value = []
    treeError.value = ''
    return
  }
  treeLoading.value = true
  treeError.value = ''
  try {
    const tree = await projectAssets.browseTree(projectStore.currentProject)
    treeNodes.value = tree.nodes
    const nextId = preferredCategoryId
      && (preferredCategoryId === FAVORITES_NODE_ID || findTreeNode(tree.nodes, preferredCategoryId))
      ? preferredCategoryId
      : tree.nodes[0]?.id || ''
    selectedCategoryId.value = nextId
    syncTreeCurrentKey(nextId)
    if (nextId) await loadCategory(nextId)
    else {
      categoryEntries.value = []
      categoryError.value = ''
    }
  } catch (error) {
    treeError.value = t('projectAssets.loadTreeFailed', { message: formatError(error) })
    treeNodes.value = []
    categoryEntries.value = []
  } finally {
    treeLoading.value = false
  }
}

async function loadCategory(categoryId: string, options: { preserveViewState?: boolean } = {}) {
  if (!projectStore.currentProject || !categoryId) {
    categoryEntries.value = []
    return
  }
  if (categoryId === FAVORITES_NODE_ID) {
    await loadFavoritesListing(options)
    return
  }
  if (isProjectAssetGroupCategory(categoryId)) {
    listingCoordinator.invalidate({
      project: projectStore.currentProject,
      categoryId,
      bucket: thumbnailBucket.value,
    })
    categoryEntries.value = []
    categoryDirectory.value = ''
    categoryError.value = ''
    categoryLoading.value = false
    if (!options.preserveViewState) {
      clearFileSelection()
      scrollTop.value = 0
      if (gridHost.value) gridHost.value.scrollTop = 0
    }
    return
  }

  const project = projectStore.currentProject
  const bucket = thumbnailBucket.value
  const token = listingCoordinator.begin({ project, categoryId, bucket })
  categoryLoading.value = true
  categoryError.value = ''
  if (!options.preserveViewState) {
    selectedFolderId.value = null
    scrollTop.value = 0
    if (gridHost.value) gridHost.value.scrollTop = 0
    failedThumbnails.value = new Set()
    armedThumbnailIds.value = new Set()
    imageDimensionCache.value = new Map()
    thumbnailArmGeneration += 1
  }

  await listingCoordinator.runExclusive(token, async (context) => {
    try {
      const listing = await projectAssets.browseCategory(categoryId, project, bucket)
      if (!context.isCurrent()) return
      categoryEntries.value = listing.entries
      categoryDirectory.value = listing.directory || ''
      categoryError.value = ''
      selection.value = pruneProjectAssetSelection(
        selection.value,
        new Set(listing.entries.map((entry) => entry.id)),
      )
    } catch (error) {
      if (!context.isCurrent()) return
      categoryEntries.value = []
      categoryDirectory.value = ''
      categoryError.value = t('projectAssets.loadCategoryFailed', { message: formatError(error) })
      clearFileSelection()
    } finally {
      if (context.isCurrent()) categoryLoading.value = false
    }
  })
}

/** Load the virtual favorites listing: browse every node a favorited file lives in, keep only favorites. */
async function loadFavoritesListing(options: { preserveViewState?: boolean } = {}) {
  const project = projectStore.currentProject
  if (!project) return
  const bucket = thumbnailBucket.value
  const token = listingCoordinator.begin({ project, categoryId: FAVORITES_NODE_ID, bucket })
  categoryLoading.value = true
  categoryError.value = ''
  categoryDirectory.value = ''
  if (!options.preserveViewState) {
    selectedFolderId.value = null
    scrollTop.value = 0
    if (gridHost.value) gridHost.value.scrollTop = 0
    failedThumbnails.value = new Set()
    armedThumbnailIds.value = new Set()
    imageDimensionCache.value = new Map()
    thumbnailArmGeneration += 1
  }

  await listingCoordinator.runExclusive(token, async (context) => {
    try {
      const ids = favorites.value
      const nodes = favoriteListingNodes(ids)
      const listings = await Promise.all(nodes.map(async (node) => {
        try {
          return await projectAssets.browseCategory(node, project, bucket)
        } catch {
          return null // node vanished on disk; its favorites simply do not resolve
        }
      }))
      if (!context.isCurrent()) return
      const seen = new Set<string>()
      const entries: ProjectAssetBrowseEntry[] = []
      for (const listing of listings) {
        if (!listing) continue
        for (const entry of listing.entries) {
          if (!ids.has(entry.id) || seen.has(entry.id)) continue
          seen.add(entry.id)
          entries.push(entry)
        }
      }
      categoryEntries.value = entries
      categoryError.value = ''
      selection.value = pruneProjectAssetSelection(
        selection.value,
        new Set(entries.map((entry) => entry.id)),
      )
    } catch (error) {
      if (!context.isCurrent()) return
      categoryEntries.value = []
      categoryError.value = t('projectAssets.loadCategoryFailed', { message: formatError(error) })
      clearFileSelection()
    } finally {
      if (context.isCurrent()) categoryLoading.value = false
    }
  })
}

function selectCategory(categoryId: string) {
  if (!categoryId || categoryId === selectedCategoryId.value) {
    syncTreeCurrentKey(categoryId)
    return
  }
  clearAllSelection()
  selectedCategoryId.value = categoryId
  searchQuery.value = ''
  syncTreeCurrentKey(categoryId)
  void loadCategory(categoryId)
}

function onTreeNodeClick(data: TreeNodeView) {
  selectCategory(data.id)
}

function onCellClick(event: MouseEvent, item: GridItem) {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (item.kind === 'folder') {
    clearFileSelection()
    selectedFolderId.value = item.id
    return
  }

  const entryId = item.entry.id
  if (event.shiftKey) {
    applyFileSelection(selectProjectAssetRange(orderedFileIds.value, selection.value, entryId))
    return
  }
  if (event.ctrlKey || event.metaKey) {
    applyFileSelection(toggleProjectAssetSelection(selection.value, entryId))
    return
  }
  applyFileSelection(selectProjectAssetExclusive(entryId))
}

function onCellDoubleClick(item: GridItem) {
  if (item.kind === 'folder') {
    selectCategory(item.id)
    return
  }
  if (isAudioEntry(item.entry)) {
    applyFileSelection(selectProjectAssetExclusive(item.entry.id))
    playAudioEntries([item.entry])
    return
  }
  openPreviewForEntry(item.entry.id)
}

function openPreviewForEntry(entryId: string) {
  const index = sortedEntries.value.findIndex((entry) => entry.id === entryId)
  if (index < 0) return
  applyFileSelection(selectProjectAssetExclusive(entryId))
  const entry = sortedEntries.value[index]!
  const entryCategory = entryCategoryId(entry)
  const media = projectAssetMediaKind(entryCategory)
  if (media === 'image' && projectAssetCanPreview(entryCategory, entry.encrypted) && entry.url) {
    const imageEntries = previewableImageEntries.value
    const viewerIndex = imageEntries.findIndex((item) => item.id === entryId)
    if (viewerIndex >= 0) {
      imageViewerUrls.value = imageEntries.map((item) => item.url)
      imageViewerIndex.value = viewerIndex
      imageViewerVisible.value = true
      previewVisible.value = false
      return
    }
  }
  imageViewerVisible.value = false
  previewIndex.value = index
  previewVisible.value = true
}

function closePreview() {
  previewVisible.value = false
}

function closeImageViewer() {
  imageViewerVisible.value = false
}

function onImageViewerSwitch(index: number) {
  imageViewerIndex.value = index
  const url = imageViewerUrls.value[index]
  const entry = sortedEntries.value.find((item) => item.url === url)
  if (entry) applyFileSelection(selectProjectAssetExclusive(entry.id))
}

function onPreviewNavigate(index: number) {
  previewIndex.value = index
  const entry = sortedEntries.value[index]
  if (entry) applyFileSelection(selectProjectAssetExclusive(entry.id))
}

function onCellKeydown(event: KeyboardEvent, item: GridItem) {
  if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  // Prevent native button activation on Enter. Folders enter here; files bubble to the grid host.
  event.preventDefault()
  if (item.kind === 'folder') onCellDoubleClick(item)
}

/** Index of the keyboard focus inside gridItems: selected folder tile or the file selection anchor. */
function currentGridFocusIndex(): number {
  const items = gridItems.value
  if (selectedFolderId.value) {
    const index = items.findIndex((item) => item.kind === 'folder' && item.id === selectedFolderId.value)
    if (index >= 0) return index
  }
  const anchor = selection.value.anchorId
  if (anchor) {
    const index = items.findIndex((item) => item.kind === 'file' && item.entry.id === anchor)
    if (index >= 0) return index
  }
  return -1
}

function selectGridItemAt(index: number): void {
  const item = gridItems.value[index]
  if (!item) return
  if (item.kind === 'folder') {
    clearFileSelection()
    selectedFolderId.value = item.id
  } else {
    applyFileSelection(selectProjectAssetExclusive(item.entry.id))
  }
  scrollGridIndexIntoView(index)
}

/** Keep the keyboard-focused item visible. Icon cells are virtualized, so scroll by layout math, not DOM. */
function scrollGridIndexIntoView(index: number): void {
  const host = gridHost.value
  if (!host) return
  if (showIconGrid.value) {
    const columnCount = Math.max(1, gridWindow.value.columnCount)
    const row = Math.floor(index / columnCount)
    const top = GRID_INSET + row * (cellHeight.value + CELL_GAP)
    const bottom = top + cellHeight.value
    if (top < host.scrollTop + GRID_INSET) {
      host.scrollTop = Math.max(0, top - GRID_INSET)
    } else if (bottom > host.scrollTop + host.clientHeight - GRID_INSET) {
      host.scrollTop = bottom + GRID_INSET - host.clientHeight
    }
    return
  }
  // Details rows are plain DOM; let the browser scroll the selected row into view.
  void nextTick(() => {
    host.querySelector('.project-assets-details-row.selected')?.scrollIntoView({ block: 'nearest' })
  })
}

function onGridArrowNavigation(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  const key = event.key
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return false
  const items = gridItems.value
  if (!items.length) return false
  event.preventDefault()
  const columnCount = showIconGrid.value ? Math.max(1, gridWindow.value.columnCount) : 1
  const current = currentGridFocusIndex()
  let next: number
  if (key === 'Home') {
    next = 0
  } else if (key === 'End') {
    next = items.length - 1
  } else if (current < 0) {
    next = 0
  } else {
    const delta = key === 'ArrowLeft' ? -1
      : key === 'ArrowRight' ? 1
        : key === 'ArrowUp' ? -columnCount : columnCount
    next = current + delta
    // Explorer-like: stepping past an edge keeps the current focus.
    if (next < 0 || next >= items.length) return true
  }
  selectGridItemAt(next)
  return true
}

function onThumbnailError(entryId: string) {
  failedThumbnails.value = new Set([...failedThumbnails.value, entryId])
}

function positionContextMenu(x: number, y: number): void {
  contextMenu.value = { x, y }
  void nextTick(() => {
    const menu = contextMenuRef.value
    if (!menu || !contextMenu.value) return
    const margin = 8
    const rect = menu.getBoundingClientRect()
    contextMenu.value = {
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    }
  })
}

function openContextMenu(event: MouseEvent, entryId: string) {
  event.preventDefault()
  if (!selectedIdSet.value.has(entryId)) {
    applyFileSelection(selectProjectAssetExclusive(entryId))
  } else {
    selectedFolderId.value = null
  }
  contextFolderId.value = null
  contextMenuKind.value = 'cell'
  positionContextMenu(event.clientX, event.clientY)
}

function openFolderContextMenu(event: MouseEvent, folderId: string) {
  event.preventDefault()
  event.stopPropagation()
  clearFileSelection()
  selectedFolderId.value = folderId
  contextFolderId.value = folderId
  contextMenuKind.value = 'folder'
  positionContextMenu(event.clientX, event.clientY)
}

function openTreeContextMenu(event: MouseEvent, nodeId: string) {
  event.preventDefault()
  event.stopPropagation()
  // The favorites node is virtual — no on-disk directory to reveal, rename or delete.
  if (nodeId === FAVORITES_NODE_ID) return
  contextFolderId.value = nodeId
  contextMenuKind.value = 'tree'
  positionContextMenu(event.clientX, event.clientY)
}

function onGridBackgroundContextMenu(event: MouseEvent) {
  if (isEventOnGridCell(event.target)) return
  const canPaste = (Boolean(assetClipboard.value) || canPasteFolderHere.value)
    && !isGroupSelection.value && !isFavoritesSelection.value
  if (!canPaste && !canImport.value) return
  event.preventDefault()
  clearAllSelection()
  // Probe the system clipboard so a "paste import" item can appear when Explorer files are copied.
  systemClipboardFiles.value = []
  if (canImport.value && !assetClipboard.value && !folderClipboard.value) {
    void probeSystemClipboardFiles()
  }
  contextMenuKind.value = 'background'
  positionContextMenu(event.clientX, event.clientY)
}

async function showReferencesForSelection() {
  const entry = singleSelectedFile.value
  closeContextMenu()
  if (!entry || !projectStore.currentProject) return
  const target = entryMutationTarget(entry)
  if (!target) return
  referencesDialog.value = { name: entry.name, references: [], loading: true, failed: false }
  try {
    const detail = await projectAssets.detail(target, projectStore.currentProject)
    if (!referencesDialog.value) return
    referencesDialog.value.references = Array.isArray(detail.references) ? detail.references : []
    referencesDialog.value.loading = false
  } catch {
    if (!referencesDialog.value) return
    referencesDialog.value.loading = false
    referencesDialog.value.failed = true
  }
}

async function revealInFolderForSelection() {
  const entry = singleSelectedFile.value
  closeContextMenu()
  if (!entry || !projectStore.currentProject) return
  const relativePath = entryPrimaryPath(entry)
  if (!relativePath) return
  try {
    await projectAssets.revealInFolder({ relativePath }, projectStore.currentProject)
  } catch (error) {
    showMutationToast(formatError(error))
  }
}

async function openSelectionWithSystemApplication() {
  const entry = singleSelectedFile.value
  closeContextMenu()
  if (!entry || !projectStore.currentProject) return
  const relativePath = entryPrimaryPath(entry)
  if (!relativePath) return
  try {
    await projectAssets.openFile({ relativePath }, projectStore.currentProject)
  } catch {
    showMutationToast(t('projectAssets.openFailed'))
  }
}

async function revealFolderInExplorer(nodeId: string) {
  closeContextMenu()
  if (!projectStore.currentProject) return
  const node = findTreeNode(treeNodes.value, nodeId)
  const relativePath = node?.directory || ''
  if (!relativePath) {
    showMutationToast(t('projectAssets.loadCategoryFailed', { message: nodeId }))
    return
  }
  try {
    await projectAssets.revealInFolder({ relativePath }, projectStore.currentProject)
  } catch (error) {
    showMutationToast(formatError(error))
  }
}

function showMutationToast(message: string) {
  ElNotification({
    type: 'error',
    title: t('projectAssets.mutationBlockedTitle'),
    message,
    duration: 0,
    position: 'bottom-right',
  })
}

async function copyCategoryPath() {
  const pathText = displayAbsoluteDirectory.value || displayDirectory.value.trim()
  if (!pathText) return
  try {
    await clipboard.writeText(pathText)
    ElMessage.success(t('projectAssets.pathCopied'))
  } catch (error) {
    showMutationToast(formatError(error))
  }
}

function onPathCrumbClick(nodeId: string | null) {
  if (!nodeId) return
  selectCategory(nodeId)
}

function fileTooltipLines(entry: ProjectAssetBrowseEntry): string[] {
  const lines = [
    t('projectAssets.tooltipSize', { size: formatSize(entry.bytes) }),
    t('projectAssets.tooltipModified', { time: formatModified(entry.mtimeMs) }),
  ]
  const dims = imageDimensionCache.value.get(entry.id)
  if (dims) {
    lines.push(t('projectAssets.tooltipResolution', {
      width: dims.width,
      height: dims.height,
    }))
  }
  if (isAudioEntry(entry) && entry.url) {
    const duration = getCachedProjectAssetAudioDuration(entry.url)
    if (duration !== undefined && !Number.isNaN(duration)) {
      lines.push(t('projectAssets.tooltipDuration', { duration: formatPluginAudioClock(duration) }))
    }
  }
  const note = entryNote(entry.id)
  if (note) lines.push(t('projectAssets.tooltipNote', { note }))
  return lines
}

function folderTooltipLines(item: FolderGridItem): string[] {
  const lines = [t('projectAssets.tooltipEntryCount', { count: item.entryCount })]
  const note = entryNote(item.id)
  if (note) lines.push(t('projectAssets.tooltipNote', { note }))
  return lines
}

// Explorer-style metadata tooltip: shows below the pointer after a short hover delay.
const META_TOOLTIP_DELAY_MS = 400
const metaTooltip = ref<{ lines: string[]; left: number; top: number } | null>(null)
let metaTooltipTimer: ReturnType<typeof setTimeout> | null = null
/** Live pointer position while the show-delay runs, so the tooltip opens under the cursor's final spot. */
let metaTooltipAnchor = { x: 0, y: 0 }

function clearMetaTooltip() {
  if (metaTooltipTimer) {
    clearTimeout(metaTooltipTimer)
    metaTooltipTimer = null
  }
  metaTooltip.value = null
}

function onItemMouseEnter(event: MouseEvent, item: GridItem) {
  if (item.kind === 'file') {
    void ensureImageDimensions(item.entry)
    requestAudioDuration(item.entry)
  }
  clearMetaTooltip()
  metaTooltipAnchor = { x: event.clientX, y: event.clientY }
  metaTooltipTimer = setTimeout(() => {
    metaTooltipTimer = null
    const lines = item.kind === 'folder' ? folderTooltipLines(item) : fileTooltipLines(item.entry)
    if (!lines.length) return
    // Windows-native placement: directly below the cursor (y+20), viewport-clamped, fixed once shown.
    metaTooltip.value = {
      lines,
      left: Math.max(0, Math.min(metaTooltipAnchor.x, window.innerWidth - 300)),
      top: Math.max(0, Math.min(metaTooltipAnchor.y + 20, window.innerHeight - 120)),
    }
  }, META_TOOLTIP_DELAY_MS)
}

function onItemMouseMove(event: MouseEvent) {
  // Only track while the delay is pending; a visible tooltip must not follow the mouse.
  if (metaTooltipTimer) metaTooltipAnchor = { x: event.clientX, y: event.clientY }
}

async function ensureImageDimensions(entry: ProjectAssetBrowseEntry) {
  if (!isProjectAssetImageCategory(entryCategoryId(entry))) return
  if (entry.encrypted || imageDimensionCache.value.has(entry.id)) return
  const url = entry.url || entry.thumbnailUrl
  if (!url) return
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image load failed'))
      el.src = url
    })
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (width > 0 && height > 0) {
      const next = new Map(imageDimensionCache.value)
      next.set(entry.id, { width, height })
      imageDimensionCache.value = next
    }
  } catch {
    /* omit resolution when image cannot be read */
  }
}

async function copyAssetText(kind: 'name' | 'relativePath') {
  const entry = singleSelectedFile.value
  closeContextMenu()
  if (!entry) return
  const text = kind === 'name' ? entry.name : entryPrimaryPath(entry)
  if (!text) return
  try {
    await clipboard.writeText(text)
    ElMessage.success(t('projectAssets.textCopied'))
  } catch (error) {
    showMutationToast(formatError(error))
  }
}

function previewFromContextMenu() {
  const entry = singleSelectedFile.value
  closeContextMenu()
  if (entry) openPreviewForEntry(entry.id)
}

function closeContextMenu() {
  contextMenu.value = null
}

function onWindowResize(): void {
  closeContextMenu()
  if (previewPanelVisible.value) setPreviewPanelWidth(previewPanelWidth.value)
}

function copySelection() {
  const targets = selectedFileEntries.value
    .map((entry) => entryMutationTarget(entry))
    .filter((target): target is NonNullable<typeof target> => Boolean(target))
  if (!targets.length) return
  assetClipboard.value = { mode: 'copy', targets }
  folderClipboard.value = null
  closeContextMenu()

  // Also write files to the system clipboard (Windows) so they can be pasted in Explorer etc.
  const relativePaths = selectedFileEntries.value
    .map((entry) => entryPrimaryPath(entry))
    .filter((p): p is string => Boolean(p))
  if (relativePaths.length > 0 && projectStore.currentProject) {
    void clipboard.writeFiles({
      project: projectStore.currentProject,
      relativePaths,
    })
  }
}

/** Explorer-style cut: in-app only; pasting into another category performs a move. */
function cutSelection() {
  const targets = selectedFileEntries.value
    .map((entry) => entryMutationTarget(entry))
    .filter((target): target is NonNullable<typeof target> => Boolean(target))
  if (!targets.length) return
  assetClipboard.value = { mode: 'move', targets }
  folderClipboard.value = null
  closeContextMenu()
}

/** Directory of the folder node currently under the context menu (empty for group nodes). */
const contextFolderDirectory = computed(() => {
  if (!contextFolderId.value) return ''
  return findTreeNode(treeNodes.value, contextFolderId.value)?.directory || ''
})

/** Folder copy: write the whole directory to the system clipboard (CF_HDROP handles directories). */
async function copyContextFolder() {
  const directory = contextFolderDirectory.value
  closeContextMenu()
  if (!directory || !projectStore.currentProject) return
  try {
    await clipboard.writeFiles({
      project: projectStore.currentProject,
      relativePaths: [directory],
    })
    ElMessage.success(t('projectAssets.folderCopied'))
  } catch (error) {
    showMutationToast(formatError(error))
  }
}

/** Folder cut: in-app only; pasting into another pictures node moves the whole subfolder. */
function cutContextFolder() {
  const folderId = contextFolderId.value
  closeContextMenu()
  if (!folderId || !isProjectAssetUserPictureSubfolder(folderId)) return
  folderClipboard.value = { nodeId: folderId }
  assetClipboard.value = null
}

/** A cut folder may be pasted into the pictures root or any pictures subfolder outside its own subtree. */
const canPasteFolderHere = computed(() => {
  const pending = folderClipboard.value
  if (!pending || isGroupSelection.value || isFavoritesSelection.value) return false
  const target = selectedCategoryId.value
  if (!target) return false
  try {
    if (parseProjectAssetBrowserNodeId(target).categoryId !== PROJECT_ASSET_PICTURES_CATEGORY_ID) return false
  } catch {
    return false
  }
  if (target === pending.nodeId || target.startsWith(`${pending.nodeId}/`)) return false
  const parentId = pending.nodeId.slice(0, pending.nodeId.lastIndexOf('/'))
  return target !== parentId
})

async function pasteFolderClipboard() {
  const pending = folderClipboard.value
  closeContextMenu()
  if (!pending || !canPasteFolderHere.value || !projectStore.currentProject || mutationBusy.value) return
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const result = await projectAssets.moveSubfolder(
      pending.nodeId,
      selectedCategoryId.value,
      projectStore.currentProject,
    )
    folderClipboard.value = null // a cut clipboard is single-use
    ElMessage.success(t('projectAssets.folderMoved'))
    await loadTree(result.nextNodeId)
    await refreshFavorites()
  } catch (error) {
    showMutationToast(formatError(error))
  } finally {
    mutationBusy.value = false
  }
}

/** File paths found on the system clipboard, probed when the background context menu opens. */
const systemClipboardFiles = ref<string[]>([])

async function probeSystemClipboardFiles() {
  try {
    const result = await clipboard.readFiles()
    systemClipboardFiles.value = result.ok ? (result.paths || []).filter(Boolean) : []
  } catch {
    systemClipboardFiles.value = []
  }
}

/** Paste files copied in Explorer etc. into the current category via the regular import flow. */
async function pasteFromSystemClipboard() {
  closeContextMenu()
  if (!canImport.value || !projectStore.currentProject || mutationBusy.value) return
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const result = await clipboard.readFiles()
    const paths = result.ok ? (result.paths || []).filter(Boolean) : []
    if (paths.length === 0) return
    await runImportForSourceFiles(paths)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

function assertCopyResultsShape(
  batch: unknown,
  expected: number,
): asserts batch is ProjectAssetCopyBatchResult {
  const results = (batch as ProjectAssetCopyBatchResult | null | undefined)?.results
  if (!Array.isArray(results) || results.length !== expected) {
    throw new Error(t('projectAssets.copyResultShapeError', {
      expected,
      actual: Array.isArray(results) ? results.length : typeof results,
    }))
  }
}

function formatCopyResultMessage(results: ProjectAssetCopyItemResult[]): string {
  const copied = results.filter((item) => item.status === 'copied')
  const failed = results.filter((item) => item.status === 'failed')
  if (failed.length === 0) {
    return copied.length === 1
      ? t('projectAssets.copyResultAllCopiedOne')
      : t('projectAssets.copyResultAllCopiedMany', { copied: copied.length })
  }
  const lines = [t('projectAssets.copyResultMixed', { copied: copied.length, failed: failed.length })]
  for (const item of failed) {
    lines.push(t('projectAssets.copyResultFailedItem', {
      name: item.target.name,
      reason: item.error || t('projectAssets.copyResultUnknownReason'),
    }))
  }
  return lines.join('\n')
}

async function pasteClipboard() {
  if (folderClipboard.value) {
    await pasteFolderClipboard()
    return
  }
  const clipboard = assetClipboard.value
  if (!clipboard || !projectStore.currentProject || mutationBusy.value) return
  if (!selectedCategoryId.value || isGroupSelection.value || isFavoritesSelection.value) return
  closeContextMenu()
  if (clipboard.mode === 'move') {
    await pasteMoveClipboard(clipboard.targets)
    return
  }
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const batch = await projectAssets.copy(
      { targets: clipboard.targets, targetCategory: selectedCategoryId.value },
      projectStore.currentProject,
    )
    assertCopyResultsShape(batch, clipboard.targets.length)
    const summary = formatCopyResultMessage(batch.results)
    const hasProblems = batch.results.some((item) => item.status !== 'copied')
    if (hasProblems) {
      mutationError.value = summary
    } else {
      mutationError.value = ''
      ElMessage.success(summary)
    }
    const firstCopied = batch.results.find((item) => item.status === 'copied' && item.detail)
    await afterMutation(firstCopied?.detail || null)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

function assertMoveResultsShape(
  batch: unknown,
  expected: number,
): asserts batch is ProjectAssetMoveBatchResult {
  const results = (batch as ProjectAssetMoveBatchResult | null | undefined)?.results
  if (!Array.isArray(results) || results.length !== expected) {
    throw new Error(t('projectAssets.moveResultShapeError', {
      expected,
      actual: Array.isArray(results) ? results.length : typeof results,
    }))
  }
}

function formatMoveResultMessage(results: ProjectAssetMoveItemResult[]): string {
  const moved = results.filter((item) => item.status === 'moved')
  const failed = results.filter((item) => item.status !== 'moved')
  if (failed.length === 0) {
    return moved.length === 1
      ? t('projectAssets.moveResultAllMovedOne')
      : t('projectAssets.moveResultAllMovedMany', { moved: moved.length })
  }
  const lines = [t('projectAssets.moveResultMixed', { moved: moved.length, failed: failed.length })]
  for (const item of failed) {
    lines.push(t('projectAssets.copyResultFailedItem', {
      name: item.target.name,
      reason: item.error || t('projectAssets.copyResultUnknownReason'),
    }))
  }
  return lines.join('\n')
}

/** Cut + paste: move the clipboard targets into the current category; references prompt once for force. */
async function pasteMoveClipboard(targets: ProjectAssetDeleteTargetInput[]) {
  if (!projectStore.currentProject || !selectedCategoryId.value) return
  mutationBusy.value = true
  mutationError.value = ''
  try {
    let batch = await projectAssets.move(
      { targets, targetCategory: selectedCategoryId.value },
      projectStore.currentProject,
    )
    assertMoveResultsShape(batch, targets.length)
    const blocked = batch.results.filter((item) => item.status === 'blocked')
    if (blocked.length > 0) {
      let confirmed = true
      try {
        await ElMessageBox.confirm(
          t('projectAssets.moveConfirmReferences', { count: blocked.length }),
          t('projectAssets.cut'),
          { type: 'warning' },
        )
      } catch {
        confirmed = false
      }
      if (confirmed) {
        batch = await projectAssets.move(
          { targets, targetCategory: selectedCategoryId.value, force: true },
          projectStore.currentProject,
        )
        assertMoveResultsShape(batch, targets.length)
      }
    }
    const summary = formatMoveResultMessage(batch.results)
    const hasProblems = batch.results.some((item) => item.status !== 'moved')
    if (hasProblems) {
      mutationError.value = summary
    } else {
      mutationError.value = ''
      ElMessage.success(summary)
    }
    const anyMoved = batch.results.some((item) => item.status === 'moved')
    if (anyMoved) assetClipboard.value = null // a cut clipboard is single-use
    const firstMoved = batch.results.find((item) => item.status === 'moved' && item.detail)
    await afterMutation(firstMoved?.detail || null)
    if (anyMoved) await refreshFavorites()
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

function localFileParts(filePath: string): { fileName: string; name: string } {
  const fileName = String(filePath || '').split(/[\\/]/).pop() || ''
  return { fileName, name: fileName.replace(/\.[^.]+$/, '') }
}

function entryMutationTarget(entry: ProjectAssetBrowseEntry) {
  const relativePath = entryPrimaryPath(entry)
  if (!relativePath) return null
  return {
    scope: 'project' as const,
    // Nested picture folders are locations, not asset categories. The entry id
    // always carries the backend's base category (for example "pictures").
    category: entryCategoryId(entry),
    relativePath,
  }
}

function contentPointFromClient(
  host: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = host.getBoundingClientRect()
  return viewportPointToContentPoint(
    clientX - rect.left,
    clientY - rect.top,
    host.scrollLeft,
    host.scrollTop,
  )
}

function isEventOnGridCell(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('.project-assets-cell, .project-assets-details-row'))
}

function requireGridHostFromEvent(event: PointerEvent): HTMLElement {
  const host = event.currentTarget
  if (!(host instanceof HTMLElement)) {
    throw new Error('Project assets grid host is missing; cannot resolve marquee coordinates.')
  }
  return host
}

function onGridPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  clearMetaTooltip()
  if (isGroupSelection.value) return
  // Marquee geometry is icon-grid math; the details list selects by plain clicks only.
  if (!showIconGrid.value) return
  const host = requireGridHostFromEvent(event)

  if (isEventOnGridCell(event.target)) {
    // Enter pending state: activate marquee only if the user drags beyond threshold.
    // Do NOT capture pointer here so that a simple click still reaches the cell handler.
    marqueePending = true
    marqueePendingOrigin = contentPointFromClient(host, event.clientX, event.clientY)
    marqueePendingHost = host
    marqueePendingPointerId = event.pointerId
    return
  }

  closeContextMenu()
  marqueeActive = true
  suppressNextClick = false
  const point = contentPointFromClient(host, event.clientX, event.clientY)
  marquee.value = {
    originX: point.x,
    originY: point.y,
    currentX: point.x,
    currentY: point.y,
  }
  host.setPointerCapture(event.pointerId)
  focusGridHost()
  event.preventDefault()
}

/** Apply the marquee rect to the selection; used live during drag (Explorer-like) and on release. */
function applyMarqueeSelection(draft: MarqueeState) {
  const rect = normalizeContentRect({
    left: draft.originX,
    top: draft.originY,
    right: draft.currentX,
    bottom: draft.currentY,
  })
  applyFileSelection(selectProjectAssetsByMarquee(
    orderedFileIds.value,
    {
      columnCount: gridWindow.value.columnCount,
      cellWidth: cellWidth.value,
      cellHeight: cellHeight.value,
      gap: CELL_GAP,
      originX: GRID_INSET,
      originY: GRID_INSET,
      leadingItemCount: gridItems.value.length - orderedFileIds.value.length,
    },
    rect,
  ))
}

function onGridPointerMove(event: PointerEvent) {
  if (marqueePending && marqueePendingOrigin && marqueePendingHost) {
    const point = contentPointFromClient(marqueePendingHost, event.clientX, event.clientY)
    const dx = Math.abs(point.x - marqueePendingOrigin.x)
    const dy = Math.abs(point.y - marqueePendingOrigin.y)
    if (dx > MARQUEE_DRAG_THRESHOLD || dy > MARQUEE_DRAG_THRESHOLD) {
      // Threshold exceeded: promote pending to active marquee.
      marqueePending = false
      marqueeActive = true
      suppressNextClick = true
      closeContextMenu()
      marquee.value = {
        originX: marqueePendingOrigin.x,
        originY: marqueePendingOrigin.y,
        currentX: point.x,
        currentY: point.y,
      }
      marqueePendingHost.setPointerCapture(marqueePendingPointerId)
      marqueePendingOrigin = null
      marqueePendingHost = null
      focusGridHost()
      event.preventDefault()
      applyMarqueeSelection(marquee.value)
    }
    return
  }
  if (!marqueeActive || !marquee.value) return
  const host = requireGridHostFromEvent(event)
  const point = contentPointFromClient(host, event.clientX, event.clientY)
  marquee.value = {
    ...marquee.value,
    currentX: point.x,
    currentY: point.y,
  }
  // Live selection while dragging, matching the native Explorer marquee.
  applyMarqueeSelection(marquee.value)
}

function finishMarquee(event: PointerEvent) {
  if (!marqueeActive) return
  marqueeActive = false
  const draft = marquee.value
  marquee.value = null
  try {
    gridHost.value?.releasePointerCapture(event.pointerId)
  } catch {
    // Pointer may already be released.
  }
  if (!draft) return

  const rect = normalizeContentRect({
    left: draft.originX,
    top: draft.originY,
    right: draft.currentX,
    bottom: draft.currentY,
  })
  const moved = Math.abs(rect.right - rect.left) > 3 || Math.abs(rect.bottom - rect.top) > 3
  if (!moved) {
    clearAllSelection()
    return
  }
  suppressNextClick = true
  applyMarqueeSelection(draft)
}

function onGridPointerUp(event: PointerEvent) {
  if (marqueePending) {
    // Simple click on a cell (no drag): reset pending and let the click handler work.
    marqueePending = false
    marqueePendingOrigin = null
    marqueePendingHost = null
    marqueePendingPointerId = -1
    return
  }
  finishMarquee(event)
}

function onGridPointerCancel(event: PointerEvent) {
  if (marqueePending) {
    marqueePending = false
    marqueePendingOrigin = null
    marqueePendingHost = null
    marqueePendingPointerId = -1
    return
  }
  finishMarquee(event)
}

function onGridKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return
  if (previewVisible.value) return
  if (onGridArrowNavigation(event)) return
  if (isGroupSelection.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      clearAllSelection()
      closeContextMenu()
    }
    return
  }

  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && (event.key === 'a' || event.key === 'A')) {
    event.preventDefault()
    applyFileSelection(selectAllProjectAssets(orderedFileIds.value, selection.value))
    return
  }
  if (ctrl && (event.key === 'c' || event.key === 'C')) {
    if (selectedFileEntries.value.length > 0) {
      event.preventDefault()
      copySelection()
    }
    return
  }
  if (ctrl && (event.key === 'x' || event.key === 'X')) {
    if (selectedFileEntries.value.length > 0) {
      event.preventDefault()
      cutSelection()
    }
    return
  }
  if (ctrl && (event.key === 'v' || event.key === 'V')) {
    event.preventDefault()
    if (assetClipboard.value || folderClipboard.value) {
      void pasteClipboard()
    } else if (canImport.value) {
      // No in-app clipboard: fall back to importing files copied on the system clipboard.
      void pasteFromSystemClipboard()
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    clearAllSelection()
    closeContextMenu()
    return
  }
  if (event.key === 'F2') {
    if (singleSelectedFile.value) {
      event.preventDefault()
      void renameSelectedEntry()
    }
    return
  }
  if (event.key === 'Delete') {
    if (selectedFileEntries.value.length > 0) {
      event.preventDefault()
      void deleteSelectedEntries()
    }
    return
  }
  if (event.key === 'Enter' && !ctrl && !event.shiftKey && !event.altKey) {
    if (selectedFolderId.value) {
      event.preventDefault()
      selectCategory(selectedFolderId.value)
      return
    }
    if (singleSelectedFile.value) {
      event.preventDefault()
      if (isAudioEntry(singleSelectedFile.value)) {
        playAudioEntries([singleSelectedFile.value])
      } else {
        openPreviewForEntry(singleSelectedFile.value.id)
      }
    }
  }
}

async function importFile() {
  if (!canImport.value || !projectStore.currentProject) return
  const category = selectedCategoryId.value
  closeContextMenu()
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const sourceFiles = await projectAssets.selectImportFile(category)
    if (!sourceFiles || sourceFiles.length === 0) return
    await runImportForSourceFiles(sourceFiles)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

type LocalImportRejection = {
  name: string;
  reason: string;
}

function importResultMessageCopy() {
  return {
    allImportedOne: t('projectAssets.importResultAllImportedOne'),
    allImportedMany: (imported: number) => t('projectAssets.importResultAllImportedMany', { imported }),
    mixed: (imported: number, skipped: number, failed: number) => t('projectAssets.importResultMixed', {
      imported,
      skipped,
      failed,
    }),
    skippedItem: (name: string, reason: string) => t('projectAssets.importResultSkippedItem', { name, reason }),
    failedItem: (name: string, reason: string) => t('projectAssets.importResultFailedItem', { name, reason }),
    unknownReason: t('projectAssets.importResultUnknownReason'),
  }
}

async function runImportForSourceFiles(
  sourceFiles: string[],
  preRejections: LocalImportRejection[] = [],
  categoryOverride?: string,
) {
  if (!projectStore.currentProject) return
  const category = categoryOverride || selectedCategoryId.value
  if (!category) return
  const { subpath: importSubpath } = parseProjectAssetBrowserNodeId(category)
  let candidates: ImportOverwriteCandidate[] = sourceFiles.map((sourceFile) => {
    const parts = localFileParts(sourceFile)
    const leaf = parts.name
    return {
      sourceFile,
      name: importSubpath ? `${importSubpath}/${leaf}` : leaf,
      overwrite: false,
    }
  })

  // Overwrite detection needs the target category's existing names; the loaded
  // listing only matches when the target is the category on screen.
  let existingNames: ReadonlySet<string>
  if (!categoryOverride || category === selectedCategoryId.value) {
    existingNames = new Set(categoryEntries.value.map((entry) => entry.name))
  } else {
    const listing = await projectAssets.browseCategory(category, projectStore.currentProject)
    existingNames = new Set(
      ((listing as { entries?: ProjectAssetBrowseEntry[] }).entries || []).map((entry) => entry.name),
    )
  }
  const conflicts = candidates.filter((candidate) => existingNames.has(candidate.name))
  let skippedFromDialog: ProjectAssetImportItemResult[] = []

  if (conflicts.length === 1 && candidates.length === 1) {
    try {
      await ElMessageBox.confirm(
        t('projectAssets.overwriteConfirm', { name: conflicts[0]!.name }),
        t('projectAssets.overwriteTitle'),
        { type: 'warning' },
      )
      candidates[0]!.overwrite = true
    } catch {
      return
    }
  } else if (conflicts.length > 0) {
    const decision = await askBatchOverwriteDecision(conflicts.map((item) => item.name))
    const applied = applyOverwriteBatchDecision(
      candidates,
      new Set(conflicts.map((item) => item.name)),
      decision,
    )
    if (applied.outcome === 'cancel') return
    candidates = applied.candidates
    skippedFromDialog = applied.skipped.map((item) => ({
      sourceFile: item.sourceFile,
      targetName: item.name,
      relativePath: null,
      status: 'skipped' as const,
      error: t('projectAssets.importSkipSameNameReason'),
    }))
  }

  const localFailed: ProjectAssetImportItemResult[] = preRejections.map((item) => ({
    sourceFile: item.name,
    targetName: item.name,
    relativePath: null,
    status: 'failed' as const,
    error: item.reason,
  }))

  let backendResults: ProjectAssetImportItemResult[] = []
  if (candidates.length > 0) {
    const batch = await projectAssets.importLocalFiles(
      {
        category,
        files: candidates.map((candidate) => ({
          sourceFile: candidate.sourceFile,
          overwrite: candidate.overwrite || undefined,
        })),
      },
      projectStore.currentProject,
    )
    if (!batch || typeof batch !== 'object' || !('results' in batch)) {
      throw new Error(t('projectAssets.importResultShapeError', {
        expected: candidates.length,
        actual: 'missing results',
      }))
    }
    const typedBatch = batch as ProjectAssetImportBatchResult
    if (!Array.isArray(typedBatch.results) || typedBatch.results.length !== candidates.length) {
      throw new Error(t('projectAssets.importResultShapeError', {
        expected: candidates.length,
        actual: Array.isArray(typedBatch.results) ? typedBatch.results.length : typeof typedBatch.results,
      }))
    }
    assertImportBatchResultShape(typedBatch, candidates.length)
    backendResults = typedBatch.results
  }

  const combined = [...backendResults, ...skippedFromDialog, ...localFailed]
  const summary = formatImportResultMessage(combined, importResultMessageCopy())
  const hasProblems = combined.some((item) => item.status !== 'imported')
  if (hasProblems) {
    mutationError.value = summary
  } else {
    mutationError.value = ''
    ElMessage.success(summary)
  }

  const firstImported = backendResults.find((item) => item.status === 'imported' && item.detail)
  await afterMutation(firstImported?.detail || null)
}

async function askBatchOverwriteDecision(names: string[]): Promise<'overwrite' | 'skip' | 'cancel'> {
  try {
    await ElMessageBox.confirm(
      t('projectAssets.overwriteBatchConfirm', {
        count: names.length,
        names: names.join('\n'),
      }),
      t('projectAssets.overwriteBatchTitle'),
      {
        type: 'warning',
        distinguishCancelAndClose: true,
        confirmButtonText: t('projectAssets.overwriteBatchOverwrite'),
        cancelButtonText: t('projectAssets.overwriteBatchSkip'),
      },
    )
    return 'overwrite'
  } catch (action) {
    if (action === 'cancel') return 'skip'
    return 'cancel'
  }
}

function isFileDragEvent(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function preventWindowFileNavigation(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  event.preventDefault()
}

function onGridDragEnter(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  event.preventDefault()
  fileDragDepth += 1
  if (canImport.value) fileDropActive.value = true
}

function onGridDragOver(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = canImport.value ? 'copy' : 'none'
  }
  if (canImport.value) fileDropActive.value = true
}

function onGridDragLeave(event: DragEvent) {
  if (!isFileDragEvent(event)) return
  fileDragDepth = Math.max(0, fileDragDepth - 1)
  if (fileDragDepth === 0) fileDropActive.value = false
}

const treeDropTargetId = ref<string | null>(null)

function treeNodeAcceptsDrop(categoryId: string): boolean {
  return Boolean(projectStore.currentProject)
    && categoryId !== FAVORITES_NODE_ID
    && !isProjectAssetGroupCategory(categoryId)
    && !mutationBusy.value
}

function onTreeNodeDragEnter(event: DragEvent, categoryId: string) {
  if (!isFileDragEvent(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (treeNodeAcceptsDrop(categoryId)) treeDropTargetId.value = categoryId
}

function onTreeNodeDragOver(event: DragEvent, categoryId: string) {
  if (!isFileDragEvent(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = treeNodeAcceptsDrop(categoryId) ? 'copy' : 'none'
  }
}

function onTreeNodeDragLeave(event: DragEvent, categoryId: string) {
  if (!isFileDragEvent(event)) return
  const related = event.relatedTarget as Node | null
  if (related && (event.currentTarget as HTMLElement).contains(related)) return
  if (treeDropTargetId.value === categoryId) treeDropTargetId.value = null
}

async function onTreeNodeDrop(event: DragEvent, categoryId: string) {
  if (!isFileDragEvent(event)) return
  event.preventDefault()
  event.stopPropagation()
  treeDropTargetId.value = null
  if (!treeNodeAcceptsDrop(categoryId)) {
    mutationError.value = t('projectAssets.importDropNeedsCategory')
    return
  }
  await runDroppedImport(resolveDroppedImportPlan(event), categoryId)
}

type DroppedImportPlan = {
  sourceFiles: string[]
  rejections: LocalImportRejection[]
}

/** Resolve a drop's dataTransfer into importable absolute paths plus per-item rejections. */
function resolveDroppedImportPlan(event: DragEvent): DroppedImportPlan {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) {
    throw new Error(t('projectAssets.importPathUnresolved', { name: t('projectAssets.importResultUnknownReason') }))
  }
  const files = Array.from(dataTransfer.files || [])
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : []
  const planned = []
  if (items.length > 0) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (!item || item.kind !== 'file') continue
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      const file = item.getAsFile() || files[index] || null
      const label = (file && file.name)
        || (entry && entry.name)
        || t('projectAssets.importResultUnknownReason')
      if (entry && entry.isDirectory) {
        planned.push({ isDirectory: true, name: label, absolutePath: null })
        continue
      }
      if (!file) {
        planned.push({ isDirectory: false, name: label, absolutePath: null })
        continue
      }
      planned.push({
        isDirectory: false,
        name: file.name,
        absolutePath: resolveDroppedFilePath(file),
      })
    }
  } else {
    for (const file of files) {
      planned.push({
        isDirectory: false,
        name: file.name,
        absolutePath: resolveDroppedFilePath(file),
      })
    }
  }

  const plan = planDroppedImportItems(planned)
  const rejections: LocalImportRejection[] = plan.rejections.map((item) => ({
    name: item.name,
    reason: item.reason === 'directory'
      ? t('projectAssets.importDropDirectoryRejected', { name: item.name })
      : t('projectAssets.importPathUnresolved', { name: item.name }),
  }))
  return { sourceFiles: plan.sourceFiles, rejections }
}

async function runDroppedImport(plan: DroppedImportPlan, categoryOverride?: string) {
  if (plan.sourceFiles.length === 0 && plan.rejections.length === 0) return
  mutationBusy.value = true
  mutationError.value = ''
  try {
    if (plan.sourceFiles.length === 0) {
      mutationError.value = formatImportResultMessage(plan.rejections.map((item) => ({
        sourceFile: item.name,
        targetName: item.name,
        relativePath: null,
        status: 'failed' as const,
        error: item.reason,
      })), importResultMessageCopy())
      return
    }
    await runImportForSourceFiles(plan.sourceFiles, plan.rejections, categoryOverride)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

async function onGridDrop(event: DragEvent) {
  event.preventDefault()
  fileDragDepth = 0
  fileDropActive.value = false

  if (!projectStore.currentProject) return
  if (!canImport.value) {
    mutationError.value = t('projectAssets.importDropNeedsCategory')
    return
  }
  if (mutationBusy.value) return

  await runDroppedImport(resolveDroppedImportPlan(event))
}

function resolveDroppedFilePath(file: File): string | null {
  const api = window.api
  if (!api || !api.files || typeof api.files.getPathForFile !== 'function') {
    throw new Error(t('projectAssets.importPathUnresolved', { name: file.name }))
  }
  const absolutePath = String(api.files.getPathForFile(file) || '').trim()
  return absolutePath || null
}

async function renameSelectedEntry() {
  const entry = singleSelectedFile.value
  const target = entry ? entryMutationTarget(entry) : null
  if (!entry || !target || !projectStore.currentProject || mutationBusy.value) return
  closeContextMenu()
  // entry.name is the logical name and may carry an MZ picture subfolder
  // prefix (`ui/foo`). Users rename the leaf only; the prefix is restored on
  // submit so the file stays in its folder.
  const slash = entry.name.lastIndexOf('/')
  const namePrefix = slash >= 0 ? entry.name.slice(0, slash + 1) : ''
  let nextName = ''
  try {
    const response = await ElMessageBox.prompt(
      t('projectAssets.renamePrompt'),
      t('projectAssets.renameTitle'),
      {
        inputValue: entry.name.slice(slash + 1),
        inputPattern: /^[^<>:"/\\|?*\u0000-\u001f]+$/,
        inputErrorMessage: t('projectAssets.nameInvalid'),
      },
    )
    const leaf = String(response.value || '').trim()
    nextName = leaf ? `${namePrefix}${leaf}` : ''
  } catch {
    return
  }
  if (!nextName || nextName === entry.name) return

  mutationBusy.value = true
  mutationError.value = ''
  try {
    const safety = await projectAssets.checkRenameSafety(target, nextName, projectStore.currentProject)
    if (!safety.ok) {
      showMutationToast(t('projectAssets.mutationBlocked', {
        reasons: safety.blockers.join('\n'),
      }))
      return
    }
    if (safety.references.length > 0) {
      try {
        await ElMessageBox.confirm(
          t('projectAssets.renameConfirm', { count: safety.references.length }),
          t('projectAssets.renameTitle'),
          { type: 'warning' },
        )
      } catch {
        return
      }
    }
    const renamed = await projectAssets.rename(target, nextName, projectStore.currentProject)
    await afterMutation(renamed)
    await refreshFavorites()
    ElMessage.success(t('projectAssets.renameSucceeded'))
  } catch (error) {
    showMutationToast(formatError(error))
  } finally {
    mutationBusy.value = false
  }
}

async function renameContextFolder() {
  const folderId = contextFolderId.value
  closeContextMenu()
  if (!folderId || !isProjectAssetUserPictureSubfolder(folderId) || !projectStore.currentProject || mutationBusy.value) {
    return
  }
  const leaf = folderId.split('/').filter(Boolean).pop() || folderId
  let nextName = ''
  try {
    const response = await ElMessageBox.prompt(
      t('projectAssets.folderRenamePrompt'),
      t('projectAssets.folderRenameTitle'),
      {
        inputValue: leaf,
        inputPattern: /^[^<>:"/\\|?*\u0000-\u001f]+$/,
        inputErrorMessage: t('projectAssets.nameInvalid'),
      },
    )
    nextName = normalizeProjectAssetFolderLeafName(String(response.value || '').trim())
  } catch {
    return
  }
  if (!nextName || nextName === leaf) return
  mutationBusy.value = true
  try {
    const result = await projectAssets.renameSubfolder(folderId, nextName, projectStore.currentProject)
    await loadTree(result.nextNodeId)
    await refreshFavorites()
    ElMessage.success(t('projectAssets.folderRenameSucceeded'))
  } catch (error) {
    showMutationToast(formatError(error))
  } finally {
    mutationBusy.value = false
  }
}

async function deleteContextFolder() {
  const folderId = contextFolderId.value
  closeContextMenu()
  if (!folderId || !isProjectAssetUserPictureSubfolder(folderId) || !projectStore.currentProject || mutationBusy.value) {
    return
  }
  const leaf = folderId.split('/').filter(Boolean).pop() || folderId
  try {
    await ElMessageBox.confirm(
      t('projectAssets.folderDeleteConfirm', { name: leaf }),
      t('projectAssets.folderDeleteTitle'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  mutationBusy.value = true
  try {
    // First pass without force: backend blocks the whole folder when any nested
    // asset is still referenced, without deleting anything.
    const first = await projectAssets.removeSubfolder(folderId, false, projectStore.currentProject)
    const blocked = first.results.filter((item) => item.status === 'blocked')
    if (blocked.length > 0) {
      mutationBusy.value = false
      try {
        await ElMessageBox.confirm(
          t('projectAssets.folderDeleteForceConfirm', { count: blocked.length }),
          t('projectAssets.folderDeleteTitle'),
          { type: 'warning' },
        )
      } catch {
        return
      }
      mutationBusy.value = true
      await projectAssets.removeSubfolder(folderId, true, projectStore.currentProject)
    }
    const parentId = folderId.includes('/')
      ? folderId.slice(0, folderId.lastIndexOf('/'))
      : 'pictures'
    await loadTree(parentId === 'pictures' || parentId.startsWith('pictures') ? parentId : 'pictures')
    ElMessage.success(t('projectAssets.folderDeleteSucceeded'))
  } catch (error) {
    showMutationToast(formatError(error))
  } finally {
    mutationBusy.value = false
  }
}

function assertSafetyResultsShape(
  results: unknown,
  expected: number,
): asserts results is ProjectAssetMutationSafetyCheck[] {
  if (!Array.isArray(results)) {
    throw new Error(t('projectAssets.deleteSafetyShapeError', {
      expected,
      actual: typeof results,
    }))
  }
  if (results.length !== expected) {
    throw new Error(t('projectAssets.deleteSafetyShapeError', {
      expected,
      actual: results.length,
    }))
  }
}

function assertDeleteResultsShape(
  batch: unknown,
  expected: number,
): asserts batch is ProjectAssetDeleteBatchResult {
  if (!batch || typeof batch !== 'object' || !('results' in batch)) {
    throw new Error(t('projectAssets.deleteResultShapeError', {
      expected,
      actual: 'missing results',
    }))
  }
  const results = (batch as ProjectAssetDeleteBatchResult).results
  if (!Array.isArray(results) || results.length !== expected) {
    throw new Error(t('projectAssets.deleteResultShapeError', {
      expected,
      actual: Array.isArray(results) ? results.length : typeof results,
    }))
  }
}

function deleteConfirmationCopy() {
  return {
    confirmSingle: (name: string) => t('projectAssets.deleteConfirm', { name }),
    confirmBatchMany: (count: number, referenced: number) =>
      t('projectAssets.deleteConfirmBatchMany', { count, referenced }),
    forceIntro: (references: string) =>
      t('projectAssets.deleteForceConfirm', { references }),
    forceReferenceItem: (name: string, sources: string) =>
      t('projectAssets.deleteForceReferenceItem', { name, sources }),
    forceOverflow: (count: number) => t('projectAssets.deleteForceOverflow', { count }),
    forceButton: t('projectAssets.deleteForceButton'),
  }
}

function formatDeleteResultMessage(results: ProjectAssetDeleteItemResult[]): string {
  const deleted = results.filter((item) => item.status === 'deleted')
  const blocked = results.filter((item) => item.status === 'blocked')
  const failed = results.filter((item) => item.status === 'failed')
  const lines: string[] = []
  if (blocked.length === 0 && failed.length === 0) {
    lines.push(
      deleted.length === 1
        ? t('projectAssets.deleteResultAllDeletedOne')
        : t('projectAssets.deleteResultAllDeletedMany', { deleted: deleted.length }),
    )
    return lines.join('\n')
  }
  lines.push(t('projectAssets.deleteResultMixed', {
    deleted: deleted.length,
    blocked: blocked.length,
    failed: failed.length,
  }))
  for (const item of blocked) {
    const reason = item.error
      || item.references.map((reference) => reference.source).join(', ')
      || t('projectAssets.deleteResultUnknownReason')
    lines.push(t('projectAssets.deleteResultBlockedItem', {
      name: item.target.name,
      reason,
    }))
  }
  for (const item of failed) {
    lines.push(t('projectAssets.deleteResultFailedItem', {
      name: item.target.name,
      reason: item.error || t('projectAssets.deleteResultUnknownReason'),
    }))
  }
  return lines.join('\n')
}

async function deleteSelectedEntries() {
  const entries = selectedFileEntries.value
  if (entries.length === 0 || !projectStore.currentProject || mutationBusy.value) return
  const targets = entries.map((entry) => entryMutationTarget(entry))
  if (targets.some((target) => !target)) {
    mutationError.value = t('projectAssets.deleteMissingPath')
    return
  }
  const resolvedTargets = targets as NonNullable<(typeof targets)[number]>[]
  closeContextMenu()
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const safetyResults = await projectAssets.checkDeleteSafety(
      resolvedTargets,
      projectStore.currentProject,
    )
    assertSafetyResultsShape(safetyResults, resolvedTargets.length)

    const plan = planProjectAssetDeleteConfirmation(entries, safetyResults, deleteConfirmationCopy())
    try {
      await ElMessageBox.confirm(
        plan.message,
        t('projectAssets.deleteTitle'),
        {
          type: 'warning',
          confirmButtonText: plan.confirmButtonText,
          confirmButtonClass: plan.force ? 'el-button--danger' : '',
        },
      )
    } catch {
      return
    }

    const removed = await projectAssets.remove(
      resolvedTargets,
      plan.force,
      projectStore.currentProject,
    )
    assertDeleteResultsShape(removed, resolvedTargets.length)

    const deletedIds = new Set<string>()
    for (let index = 0; index < removed.results.length; index += 1) {
      const result = removed.results[index]!
      if (result.status === 'deleted') {
        deletedIds.add(entries[index]!.id)
      }
    }

    const summary = formatDeleteResultMessage(removed.results)
    const hasProblems = removed.results.some((item) => item.status !== 'deleted')
    if (hasProblems) {
      mutationError.value = summary
    } else {
      mutationError.value = ''
      ElMessage.success(summary)
    }

    // Drop deleted ids before refresh so the reload prune keeps remaining selection.
    selection.value = pruneProjectAssetSelection(
      selection.value,
      selection.value.selectedIds.filter((id) => !deletedIds.has(id)),
    )
    await afterMutation(null)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

async function afterMutation(detail: ManagedAssetDetail | null) {
  await refreshStagingStatus()
  await loadTree(selectedCategoryId.value)
  if (detail?.name) {
    const match = categoryEntries.value.find((entry) => entry.name === detail.name)
    if (match) applyFileSelection(selectProjectAssetExclusive(match.id))
  }
}

async function refreshAll() {
  if (!projectStore.currentProject) return
  mutationError.value = ''
  categoryError.value = ''
  await projectAssets.invalidateBrowseCache(projectStore.currentProject)
  await loadTree(selectedCategoryId.value)
  await refreshStagingStatus()
}

/** Watcher-driven refresh: reload tree + entries while keeping scroll, selection, and armed thumbnails. */
async function refreshSilently() {
  const project = projectStore.currentProject
  if (!project) return
  await projectAssets.invalidateBrowseCache(project)
  try {
    const tree = await projectAssets.browseTree(project)
    treeNodes.value = tree.nodes
    treeError.value = ''
  } catch (error) {
    treeError.value = t('projectAssets.loadTreeFailed', { message: formatError(error) })
    return
  }
  folderPreviews.value = new Map()
  const categoryId = selectedCategoryId.value
  if (!categoryId || (categoryId !== FAVORITES_NODE_ID && !findTreeNode(treeNodes.value, categoryId))) {
    // Current node vanished on disk — fall back to the full reload with default selection.
    await loadTree()
    return
  }
  syncTreeCurrentKey(categoryId)
  await loadCategory(categoryId, { preserveViewState: true })
  await refreshStagingStatus()
}

watch(
  () => projectStore.currentProject,
  (newProject) => {
    clearAllSelection()
    closeAudioPlayer()
    assetClipboard.value = null
    folderClipboard.value = null
    void loadTree()
    void refreshStagingStatus()
    void refreshFavorites()
    // Restart file-system watcher for the new project
    void projectAssets.stopWatcher()
    if (newProject) {
      void projectAssets.startWatcher(newProject)
    }
  },
)

watch(thumbnailBucket, (bucket, previous) => {
  if (bucket === previous) return
  if (!selectedCategoryId.value || isGroupSelection.value) return
  void loadCategory(selectedCategoryId.value)
})

/** Viewport-driven duration probing for the details list (rows are not virtualized). */
let audioDurationObserver: IntersectionObserver | null = null

function rebindAudioDurationObserver() {
  audioDurationObserver?.disconnect()
  audioDurationObserver = null
  const host = gridHost.value
  if (!host || !showDetailsView.value || !detailsShowsDuration.value) return
  if (typeof IntersectionObserver === 'undefined') return
  audioDurationObserver = new IntersectionObserver((observed) => {
    for (const record of observed) {
      if (!record.isIntersecting) continue
      const url = (record.target as HTMLElement).dataset.durationUrl
      audioDurationObserver?.unobserve(record.target)
      if (!url || getCachedProjectAssetAudioDuration(url) !== undefined) continue
      void loadProjectAssetAudioDuration(url).then(() => {
        audioDurationVersion.value += 1
      })
    }
  }, { root: host, rootMargin: '160px 0px' })
  for (const element of host.querySelectorAll('[data-duration-url]')) {
    audioDurationObserver.observe(element)
  }
}

watch([showDetailsView, detailsShowsDuration, gridItems, gridHost], () => {
  void nextTick(() => rebindAudioDurationObserver())
}, { immediate: true })

onMounted(() => {
  measureGrid()
  setPreviewPanelWidth(previewPanelWidth.value)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measureGrid())
    if (gridHost.value) resizeObserver.observe(gridHost.value)
  }
  window.addEventListener('dragover', preventWindowFileNavigation)
  window.addEventListener('drop', preventWindowFileNavigation)
  window.addEventListener('resize', onWindowResize)
  void loadTree()
  void refreshStagingStatus()
  void refreshFavorites()

  // Start file-system watcher for auto-refresh
  if (projectStore.currentProject) {
    void projectAssets.startWatcher(projectStore.currentProject)
  }
  unsubscribeAssetWatcher = projectAssets.onChange(() => {
    void refreshSilently()
  })
})

onUnmounted(() => {
  window.removeEventListener('dragover', preventWindowFileNavigation)
  window.removeEventListener('drop', preventWindowFileNavigation)
  window.removeEventListener('resize', onWindowResize)
  clearMetaTooltip()
  audioDurationObserver?.disconnect()
  audioDurationObserver = null
  resizeObserver?.disconnect()
  resizeObserver = null
  unsubscribeAssetWatcher?.()
  unsubscribeAssetWatcher = null
  void projectAssets.stopWatcher()
})

watch(gridHost, (el, previous) => {
  if (resizeObserver) {
    if (previous) resizeObserver.unobserve(previous)
    if (el) resizeObserver.observe(el)
  }
  measureGrid()
})
</script>

<template>
  <div
    ref="pageHost"
    class="project-assets-page"
    :class="{ 'has-preview-panel': previewPanelVisible }"
    :style="previewPanelVisible
      ? { '--project-assets-preview-width': `${previewPanelWidth}px` }
      : undefined"
    data-ui-id="project-assets-page"
  >
    <aside class="project-assets-tree-pane" :aria-label="t('projectAssets.treeAria')">
      <div v-if="treeError" class="project-assets-error" role="alert">{{ treeError }}</div>
      <div v-else-if="treeLoading && treeData.length === 0" class="project-assets-state">
        …
      </div>
      <div v-else-if="treeData.length === 0" class="project-assets-state">
        {{ t('projectAssets.emptyTree') }}
      </div>
      <el-tree
        v-else
        ref="treeRef"
        class="project-assets-tree"
        data-ui-id="project-assets-tree"
        :data="treeData"
        node-key="id"
        :props="{ label: 'label', children: 'children' }"
        highlight-current
        :expand-on-click-node="false"
        :current-node-key="selectedCategoryId || undefined"
        default-expand-all
        @node-click="onTreeNodeClick"
      >
        <template #default="{ data }">
          <span
            class="project-assets-tree-node"
            :class="{ 'is-drop-target': treeDropTargetId === data.id }"
            :title="`${data.label} (${data.entryCount})`"
            @contextmenu="openTreeContextMenu($event, data.id)"
            @dragenter="onTreeNodeDragEnter($event, data.id)"
            @dragover="onTreeNodeDragOver($event, data.id)"
            @dragleave="onTreeNodeDragLeave($event, data.id)"
            @drop="onTreeNodeDrop($event, data.id)"
          >
            <span>{{ data.label }}</span>
            <el-icon
              v-if="isFavorite(data.id)"
              class="project-assets-tree-favorite"
              :aria-label="t('projectAssets.favorite')"
            ><StarFilled /></el-icon>
            <small>{{ data.entryCount }}</small>
          </span>
        </template>
      </el-tree>
    </aside>

    <section class="project-assets-main">
      <div
        class="project-assets-address-row"
        data-ui-id="project-assets-address-row"
      >
        <div
          class="project-assets-path-bar"
          data-ui-id="project-assets-path-bar"
        >
          <nav
            v-if="pathCrumbs.length"
            class="project-assets-breadcrumbs"
            :aria-label="t('projectAssets.pathAria')"
            :title="displayAbsoluteDirectory"
          >
            <template
              v-for="(crumb, index) in pathCrumbs"
              :key="crumb.directory"
            >
              <span
                v-if="index > 0"
                class="project-assets-crumb-sep"
                aria-hidden="true"
              >›</span>
              <button
                v-if="crumb.nodeId && index < pathCrumbs.length - 1"
                type="button"
                class="project-assets-crumb"
                @click="onPathCrumbClick(crumb.nodeId)"
              >{{ crumb.label }}</button>
              <span
                v-else
                class="project-assets-crumb is-current"
              >{{ crumb.label }}</span>
            </template>
          </nav>
          <code
            v-else
            class="project-assets-path-text"
            tabindex="0"
            :title="displayAbsoluteDirectory"
          >{{ displayDirectory || '—' }}</code>
          <button
            type="button"
            class="project-assets-path-copy"
            data-ui-id="project-assets-path-copy"
            :disabled="!displayDirectory"
            :title="t('projectAssets.pathCopy')"
            @click="copyCategoryPath"
          >
            <el-icon><CopyDocument /></el-icon>
          </button>
        </div>
        <ConsoleSearchInput
          v-model="searchQuery"
          class="project-assets-address-search"
          :placeholder="searchPlaceholder"
        />
      </div>

      <header class="project-assets-toolbar">
        <div class="project-assets-toolbar-actions">
          <el-dropdown
            trigger="click"
            :disabled="!projectStore.currentProject || isGroupSelection"
            data-ui-id="project-assets-sort-menu"
          >
            <button
              type="button"
              class="project-assets-tool-btn"
              :disabled="!projectStore.currentProject || isGroupSelection"
            >
              <el-icon><Sort /></el-icon>
              <span>{{ t('projectAssets.sortMenu') }}</span>
              <el-icon class="project-assets-menu-caret"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="item in sortMenuItems"
                  :key="item.key"
                  @click="sortKey = item.key"
                >
                  <span class="project-assets-menu-check">
                    <el-icon v-if="sortKey === item.key"><Check /></el-icon>
                  </span>
                  <span>{{ item.label }}</span>
                </el-dropdown-item>
                <el-dropdown-item divided @click="sortDir = 'asc'">
                  <span class="project-assets-menu-check">
                    <el-icon v-if="sortDir === 'asc'"><Check /></el-icon>
                  </span>
                  <span>{{ t('projectAssets.sortAsc') }}</span>
                </el-dropdown-item>
                <el-dropdown-item @click="sortDir = 'desc'">
                  <span class="project-assets-menu-check">
                    <el-icon v-if="sortDir === 'desc'"><Check /></el-icon>
                  </span>
                  <span>{{ t('projectAssets.sortDesc') }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown
            trigger="click"
            :disabled="!projectStore.currentProject || isGroupSelection"
            data-ui-id="project-assets-view-menu"
          >
            <button
              type="button"
              class="project-assets-tool-btn"
              :disabled="!projectStore.currentProject || isGroupSelection"
            >
              <el-icon><View /></el-icon>
              <span>{{ t('projectAssets.viewMenu') }}</span>
              <el-icon class="project-assets-menu-caret"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="preset in iconSizePresets"
                  :key="preset.key"
                  @click="viewMode = 'icons'; thumbSize = preset.size"
                >
                  <span class="project-assets-menu-check">
                    <el-icon v-if="showIconGrid && thumbSize === preset.size"><Check /></el-icon>
                  </span>
                  <span>{{ preset.label }}</span>
                </el-dropdown-item>
                <el-dropdown-item divided @click="viewMode = 'details'">
                  <span class="project-assets-menu-check">
                    <el-icon v-if="!showIconGrid"><Check /></el-icon>
                  </span>
                  <span>{{ t('projectAssets.viewDetails') }}</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button
            type="button"
            class="project-assets-tool-btn"
            data-ui-id="project-assets-import"
            :disabled="!canImport"
            @click="importFile"
          >
            <el-icon><Upload /></el-icon>
            <span>{{ t('projectAssets.import') }}</span>
          </button>
          <button
            type="button"
            class="project-assets-tool-btn"
            data-ui-id="project-assets-refresh"
            :disabled="!projectStore.currentProject || mutationBusy"
            :title="t('projectAssets.refresh')"
            @click="refreshAll"
          >
            <el-icon><Refresh /></el-icon>
            <span>{{ t('projectAssets.refresh') }}</span>
          </button>
          <button
            v-if="previewToggleAvailable"
            type="button"
            class="project-assets-tool-btn"
            :class="{ 'is-active': previewPanelVisible }"
            :title="t('projectAssets.togglePreviewPanel')"
            :aria-pressed="previewPanelVisible"
            @click="previewPanelRequested = !previewPanelRequested"
          >
            <el-icon><View /></el-icon>
            <span>{{ t('projectAssets.previewPanel') }}</span>
          </button>
        </div>
      </header>

      <div
        v-if="mutationError"
        class="project-assets-error"
        role="alert"
        data-ui-id="project-assets-mutation-error"
      >
        <span>{{ mutationError }}</span>
        <button type="button" class="project-assets-error-dismiss" @click="mutationError = ''">{{ t('projectAssets.errorDismiss') }}</button>
      </div>
      <div
        v-if="categoryError"
        class="project-assets-error"
        role="alert"
      >
        <span>{{ categoryError }}</span>
        <button type="button" class="project-assets-error-dismiss" @click="categoryError = ''">{{ t('projectAssets.errorDismiss') }}</button>
      </div>

      <div
        ref="gridHost"
        class="project-assets-grid-host"
        :class="{ 'is-file-drop-target': fileDropActive }"
        data-ui-id="project-assets-grid"
        tabindex="0"
        :aria-label="t('projectAssets.gridAria')"
        @scroll="onGridScroll"
        @pointerdown="onGridPointerDown"
        @pointermove="onGridPointerMove"
        @pointerup="onGridPointerUp"
        @pointercancel="onGridPointerCancel"
        @keydown="onGridKeydown"
        @wheel="onGridWheel"
        @contextmenu="onGridBackgroundContextMenu"
        @dragenter="onGridDragEnter"
        @dragover="onGridDragOver"
        @dragleave="onGridDragLeave"
        @drop="onGridDrop"
      >
        <div
          v-if="fileDropActive"
          class="project-assets-drop-hint"
          data-ui-id="project-assets-drop-hint"
        >
          {{ t('projectAssets.dropHint') }}
        </div>
        <div
          v-if="emptyMessage && !categoryLoading"
          class="project-assets-empty"
        >
          {{ emptyMessage }}
        </div>
        <div
          v-else-if="showIconGrid"
          class="project-assets-grid-spacer"
          :class="{ 'is-marquee': Boolean(marquee) }"
          :style="{ height: `${gridWindow.totalHeight + GRID_INSET * 2}px` }"
        >
          <div
            v-for="cell in visibleItems"
            :key="cell.item.kind === 'folder' ? `folder:${cell.item.id}` : cell.item.entry.id"
            class="project-assets-cell-host"
            :style="cell.style"
          >
            <button
              type="button"
              class="project-assets-cell"
              :class="{
                selected: cell.item.kind === 'folder'
                  ? isFolderSelected(cell.item.id)
                  : isFileSelected(cell.item.entry.id),
              }"
              :data-ui-id="cell.item.kind === 'folder'
                ? `project-assets-folder-${cell.item.id}`
                : `project-assets-cell-${cell.item.entry.id}`"
              @click="onCellClick($event, cell.item)"
              @dblclick="onCellDoubleClick(cell.item)"
              @keydown="onCellKeydown($event, cell.item)"
              @mouseenter="onItemMouseEnter($event, cell.item)"
              @mousemove="onItemMouseMove"
              @mouseleave="clearMetaTooltip"
              @contextmenu="cell.item.kind === 'file'
                ? openContextMenu($event, cell.item.entry.id)
                : openFolderContextMenu($event, cell.item.id)"
            >
              <template v-if="cell.item.kind === 'folder'">
                <span
                  class="project-assets-thumb is-folder"
                  :style="{ width: `${thumbSize}px`, height: `${thumbSize}px` }"
                >
                  <button
                    type="button"
                    class="project-assets-fav-btn"
                    :class="{ 'is-favorite': isFavorite(cell.item.id) }"
                    :title="isFavorite(cell.item.id)
                      ? t('projectAssets.unfavorite')
                      : t('projectAssets.favorite')"
                    @click.stop="toggleFavorite(cell.item.id)"
                  >
                    <el-icon :size="14">
                      <StarFilled v-if="isFavorite(cell.item.id)" />
                      <Star v-else />
                    </el-icon>
                  </button>
                  <PluginFileFolderThumb
                    :urls="folderPreviews.get(cell.item.id) ?? []"
                    :size="Math.max(48, Math.round(thumbSize * 0.92))"
                  />
                </span>
                <span class="project-assets-name">{{ cell.item.label }}</span>
              </template>
              <template v-else>
                <span
                  class="project-assets-thumb"
                  :style="{ width: `${thumbSize}px`, height: `${thumbSize}px` }"
                  :class="{
                    'is-icon': cellUsesIconFallback(cell.item.entry),
                    'is-media-thumb': cellShowsFontThumb(cell.item.entry),
                    'is-encrypted': cell.item.entry.encrypted,
                  }"
                >
                  <span
                    v-if="cellExtensionTag(cell.item.entry)"
                    class="project-assets-ext-tag"
                    :class="cellExtensionColorClass(cellExtensionTag(cell.item.entry))"
                  >{{ cellExtensionTag(cell.item.entry) }}</span>
                  <button
                    type="button"
                    class="project-assets-fav-btn"
                    :class="{ 'is-favorite': isFavorite(cell.item.entry.id) }"
                    :title="isFavorite(cell.item.entry.id)
                      ? t('projectAssets.unfavorite')
                      : t('projectAssets.favorite')"
                    @click.stop="toggleFavorite(cell.item.entry.id)"
                  >
                    <el-icon :size="14">
                      <StarFilled v-if="isFavorite(cell.item.entry.id)" />
                      <Star v-else />
                    </el-icon>
                  </button>
                  <img
                    v-if="isProjectAssetImageCategory(entryCategoryId(cell.item.entry))
                      && !cell.item.entry.encrypted
                      && cell.item.entry.thumbnailUrl
                      && !failedThumbnails.has(cell.item.entry.id)
                      && armedThumbnailIds.has(cell.item.entry.id)"
                    :src="cell.item.entry.thumbnailUrl"
                    :alt="cell.item.entry.name"
                    draggable="false"
                    @error="onThumbnailError(cell.item.entry.id)"
                  />
                  <template v-else-if="cell.item.entry.encrypted">
                    <span class="project-assets-encrypted">{{ t('projectAssets.encrypted') }}</span>
                  </template>
                  <template v-else-if="failedThumbnails.has(cell.item.entry.id)">
                    <el-icon :size="typeIconSizePx(thumbSize)">
                      <component :is="typeIcon(entryCategoryId(cell.item.entry))" />
                    </el-icon>
                  </template>
                  <template
                    v-else-if="isProjectAssetImageCategory(entryCategoryId(cell.item.entry))
                      && cell.item.entry.thumbnailUrl
                      && !armedThumbnailIds.has(cell.item.entry.id)"
                  />
                  <AssetGridFontThumb
                    v-else-if="projectAssetMediaKind(entryCategoryId(cell.item.entry)) === 'font'
                      && cell.item.entry.url
                      && armedThumbnailIds.has(cell.item.entry.id)"
                    :src="cell.item.entry.url"
                    :size="thumbSize"
                    :sample-text="t('projectAssets.fontPreviewSample')"
                    @error="onThumbnailError(cell.item.entry.id)"
                  />
                  <AssetGridVideoThumb
                    v-else-if="usesArmedVideoThumb(entryCategoryId(cell.item.entry))
                      && cell.item.entry.url
                      && armedThumbnailIds.has(cell.item.entry.id)"
                    :src="cell.item.entry.url"
                    :alt="cell.item.entry.name"
                    @error="onThumbnailError(cell.item.entry.id)"
                  />
                  <template
                    v-else-if="(usesArmedFontThumb(entryCategoryId(cell.item.entry)) || usesArmedVideoThumb(entryCategoryId(cell.item.entry)))
                      && cell.item.entry.url
                      && !armedThumbnailIds.has(cell.item.entry.id)"
                  />
                  <el-icon v-else :size="typeIconSizePx(thumbSize)">
                    <component :is="typeIcon(entryCategoryId(cell.item.entry))" />
                  </el-icon>
                </span>
                <span class="project-assets-name">{{ displayAssetName(cell.item.entry.name) }}</span>
              </template>
            </button>
          </div>
          <div
            v-if="marqueeStyle"
            class="project-assets-marquee"
            :style="marqueeStyle"
          />
        </div>
        <div
          v-else-if="showDetailsView"
          class="project-assets-details"
          data-ui-id="project-assets-details"
        >
          <div class="project-assets-details-header" :class="{ 'has-duration': detailsShowsDuration }">
            <template v-for="column in detailHeaderColumns" :key="column.key">
              <button
                v-if="column.sortable"
                type="button"
                class="project-assets-details-header-cell"
                :class="column.className"
                :data-ui-id="`project-assets-sort-header-${column.key}`"
                @click="onHeaderSortClick(column.key as ProjectAssetSortKey)"
              >
                <span>{{ column.label }}</span>
                <el-icon v-if="sortKey === column.key" :size="12" class="project-assets-sort-caret">
                  <CaretTop v-if="sortDir === 'asc'" />
                  <CaretBottom v-else />
                </el-icon>
              </button>
              <span v-else :class="column.className">{{ column.label }}</span>
            </template>
          </div>
          <button
            v-for="item in gridItems"
            :key="item.kind === 'folder' ? `folder:${item.id}` : item.entry.id"
            type="button"
            class="project-assets-details-row"
            :class="{
              'has-duration': detailsShowsDuration,
              selected: item.kind === 'folder'
                ? isFolderSelected(item.id)
                : isFileSelected(item.entry.id),
            }"
            :data-duration-url="item.kind === 'file' && isAudioEntry(item.entry) && item.entry.url
              ? item.entry.url
              : undefined"
            :data-ui-id="item.kind === 'folder'
              ? `project-assets-folder-${item.id}`
              : `project-assets-cell-${item.entry.id}`"
            @click="onCellClick($event, item)"
            @dblclick="onCellDoubleClick(item)"
            @mouseenter="onItemMouseEnter($event, item)"
            @mousemove="onItemMouseMove"
            @mouseleave="clearMetaTooltip"
            @contextmenu="item.kind === 'file'
              ? openContextMenu($event, item.entry.id)
              : openFolderContextMenu($event, item.id)"
          >
            <span class="col-name">
              <span
                v-if="item.kind === 'file' && cellExtensionTag(item.entry)"
                class="project-assets-ext-tag is-inline"
                :class="cellExtensionColorClass(cellExtensionTag(item.entry))"
              >{{ cellExtensionTag(item.entry) }}</span>
              <span class="col-name-text">{{ item.kind === 'folder' ? item.label : displayAssetName(item.entry.name) }}</span>
              <button
                type="button"
                class="project-assets-fav-btn is-inline"
                :class="{ 'is-favorite': isFavorite(item.kind === 'folder' ? item.id : item.entry.id) }"
                :title="isFavorite(item.kind === 'folder' ? item.id : item.entry.id)
                  ? t('projectAssets.unfavorite')
                  : t('projectAssets.favorite')"
                @click.stop="toggleFavorite(item.kind === 'folder' ? item.id : item.entry.id)"
              >
                <el-icon :size="12">
                  <StarFilled v-if="isFavorite(item.kind === 'folder' ? item.id : item.entry.id)" />
                  <Star v-else />
                </el-icon>
              </button>
            </span>
            <span class="col-type">{{ item.kind === 'folder' ? '—' : entryTypeLabel(item.entry) }}</span>
            <span class="col-size">{{ item.kind === 'folder' ? '—' : formatSize(item.entry.bytes) }}</span>
            <span v-if="detailsShowsDuration" class="col-duration">{{ item.kind === 'folder' ? '—' : entryDurationLabel(item.entry) }}</span>
            <span class="col-mtime">{{ item.kind === 'folder' ? '—' : formatModified(item.entry.mtimeMs) }}</span>
            <span class="col-note">{{ entryNote(item.kind === 'folder' ? item.id : item.entry.id) || '—' }}</span>
          </button>
        </div>
      </div>

      <ProjectAssetsAudioBar
        v-if="audioPlaylist"
        :items="audioPlaylist"
        @close="closeAudioPlayer"
      />

      <div
        v-if="selectionStats"
        class="project-assets-selection-bar"
      >
        {{ t('projectAssets.selectionCount', { count: selectionStats.count }) }}
        <span class="selection-bar-sep">·</span>
        {{ t('projectAssets.selectionSize', { size: selectionStats.totalSize }) }}
      </div>
    </section>

    <div
      v-if="metaTooltip"
      class="project-assets-meta-tooltip"
      :style="{ left: `${metaTooltip.left}px`, top: `${metaTooltip.top}px` }"
    >
      <p
        v-for="(line, tipIndex) in metaTooltip.lines"
        :key="`tip-${tipIndex}`"
      >{{ line }}</p>
    </div>

    <aside
      v-if="previewPanelVisible"
      class="project-assets-preview-panel"
    >
      <div
        class="project-assets-preview-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('projectAssets.previewPanelResize')"
        :aria-valuemin="PROJECT_ASSET_PREVIEW_PANEL_WIDTH_MIN"
        :aria-valuemax="effectivePreviewPanelMaxWidth()"
        :aria-valuenow="previewPanelWidth"
        @pointerdown="onPreviewResizeStart"
        @pointermove="onPreviewResizeMove"
        @pointerup="onPreviewResizeEnd"
        @pointercancel="onPreviewResizeEnd"
        @keydown="onPreviewResizeKeydown"
      />
      <div class="project-assets-preview-panel-scroll">
        <div v-if="previewPanelEntry" class="project-assets-preview-panel-content">
          <img
            v-if="previewPanelMedia === 'image'
              && previewPanelEntry.thumbnailUrl
              && !failedThumbnails.has(previewPanelEntry.id)"
            class="project-assets-preview-panel-img"
            :src="previewPanelEntry.url || previewPanelEntry.thumbnailUrl"
            :alt="previewPanelEntry.name"
            draggable="false"
          />
          <video
            v-else-if="previewPanelMedia === 'movie' && previewPanelEntry.url"
            class="project-assets-preview-panel-video"
            :src="previewPanelEntry.url"
            controls
            preload="metadata"
          />
          <AssetFontPreview
            v-else-if="previewPanelMedia === 'font' && previewPanelEntry.url"
            class="project-assets-preview-panel-font"
            :src="previewPanelEntry.url"
            :display-name="previewPanelEntry.name"
            :sample-text="t('projectAssets.fontPreviewSample')"
            :load-failed-label="t('projectAssets.fontPreviewFailed')"
          />
          <div v-else class="project-assets-preview-panel-type">
            {{ entryTypeLabel(previewPanelEntry) }}
          </div>
          <p class="project-assets-preview-panel-name">{{ previewPanelEntry.name }}</p>
          <p class="project-assets-preview-panel-size">
            {{ formatSize(previewPanelEntry.bytes) }}
          </p>
          <p
            v-if="previewPanelNote"
            class="project-assets-preview-panel-note"
          >{{ previewPanelNote }}</p>
        </div>
        <div v-else class="project-assets-preview-panel-empty">
          {{ t('projectAssets.previewPanelEmpty') }}
        </div>
      </div>
    </aside>

    <ElImageViewer
      v-if="imageViewerVisible"
      :url-list="imageViewerUrls"
      :initial-index="imageViewerIndex"
      teleported
      hide-on-click-modal
      @close="closeImageViewer"
      @switch="onImageViewerSwitch"
    />

    <AssetPreviewDialog
      :visible="previewVisible"
      :items="previewItems"
      :current-index="previewIndex"
      :labels="previewDialogLabels"
      :surface-labels="previewSurfaceLabels"
      @close="closePreview"
      @navigate="onPreviewNavigate"
    />

    <AssetReferencesDialog
      :visible="Boolean(referencesDialog)"
      :asset-name="referencesDialog?.name || ''"
      :references="referencesDialog?.references || []"
      :loading="referencesDialog?.loading || false"
      :failed="referencesDialog?.failed || false"
      :labels="referencesDialogLabels"
      @close="referencesDialog = null"
    />

    <teleport to="body">
      <div
        v-if="contextMenu"
        class="ctx-mask"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <ul
          ref="contextMenuRef"
          class="ctx-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        >
          <template v-if="contextMenuKind === 'cell'">
            <li
              v-if="selectedAudioEntries.length > 0"
              data-ui-id="project-assets-ctx-play"
              @click="playSelectedAudio"
            >{{ t('projectAssets.play') }}</li>
            <li
              v-if="singleSelectedFile && !isAudioEntry(singleSelectedFile)"
              @click="previewFromContextMenu"
            >{{ t('projectAssets.preview') }}</li>
            <li
              v-if="singleSelectedFile"
              data-ui-id="project-assets-ctx-open"
              @click="openSelectionWithSystemApplication"
            >{{ t('projectAssets.open') }}</li>
            <li
              v-if="singleSelectedFile"
              @click="showReferencesForSelection"
            >{{ t('projectAssets.showReferences') }}</li>
            <li
              v-if="selectedFileEntries.length > 0"
              @click="copySelection"
            >{{ t('projectAssets.copy') }}</li>
            <li
              v-if="selectedFileEntries.length > 0"
              data-ui-id="project-assets-ctx-cut"
              @click="cutSelection"
            >{{ t('projectAssets.cut') }}</li>
            <li
              v-if="singleSelectedFile"
              @click="revealInFolderForSelection"
            >{{ t('projectAssets.revealInFolder') }}</li>
            <li
              v-if="singleSelectedFile"
              @click="copyAssetText('name')"
            >{{ t('projectAssets.copyName') }}</li>
            <li
              v-if="singleSelectedFile"
              @click="copyAssetText('relativePath')"
            >{{ t('projectAssets.copyRelativePath') }}</li>
            <li
              v-if="singleSelectedFile"
              @click="toggleFavorite(singleSelectedFile.id)"
            >{{ isFavorite(singleSelectedFile.id)
              ? t('projectAssets.unfavorite')
              : t('projectAssets.favorite') }}</li>
            <li
              v-if="singleSelectedFile"
              data-ui-id="project-assets-ctx-edit-note"
              @click="editNoteForSelection"
            >{{ t('projectAssets.editNote') }}</li>
            <li
              v-if="singleSelectedFile"
              @click="renameSelectedEntry"
            >{{ t('projectAssets.rename') }}</li>
            <li
              v-if="selectedFileEntries.length > 0"
              class="ctx-danger"
              @click="deleteSelectedEntries"
            >{{ contextDeleteLabel }}</li>
          </template>
          <template v-else-if="contextMenuKind === 'folder' || contextMenuKind === 'tree'">
            <li
              v-if="contextFolderId"
              @click="revealFolderInExplorer(contextFolderId)"
            >{{ t('projectAssets.revealInFolder') }}</li>
            <li
              v-if="contextFolderDirectory"
              data-ui-id="project-assets-ctx-folder-copy"
              @click="copyContextFolder"
            >{{ t('projectAssets.copy') }}</li>
            <li
              v-if="contextFolderId && isProjectAssetUserPictureSubfolder(contextFolderId)"
              data-ui-id="project-assets-ctx-folder-cut"
              @click="cutContextFolder"
            >{{ t('projectAssets.cut') }}</li>
            <li
              v-if="contextFolderId"
              @click="toggleFavoriteForContextFolder"
            >{{ contextFolderId && isFavorite(contextFolderId)
              ? t('projectAssets.unfavorite')
              : t('projectAssets.favorite') }}</li>
            <li
              v-if="contextFolderId"
              data-ui-id="project-assets-ctx-folder-edit-note"
              @click="editNoteForContextFolder"
            >{{ t('projectAssets.editNote') }}</li>
            <li
              v-if="contextFolderId && isProjectAssetUserPictureSubfolder(contextFolderId)"
              @click="renameContextFolder"
            >{{ t('projectAssets.rename') }}</li>
            <li
              v-if="contextFolderId && isProjectAssetUserPictureSubfolder(contextFolderId)"
              class="ctx-danger"
              @click="deleteContextFolder"
            >{{ t('projectAssets.delete') }}</li>
          </template>
          <template v-else>
            <li
              v-if="(assetClipboard || canPasteFolderHere) && !isGroupSelection"
              @click="pasteClipboard"
            >{{ t('projectAssets.paste') }}</li>
            <li
              v-if="!assetClipboard && !canPasteFolderHere && systemClipboardFiles.length > 0 && canImport"
              data-ui-id="project-assets-ctx-paste-import"
              @click="pasteFromSystemClipboard"
            >{{ t('projectAssets.pasteImport', { count: systemClipboardFiles.length }) }}</li>
            <li
              v-if="canImport"
              @click="importFile"
            >{{ t('projectAssets.importMenuItem') }}</li>
          </template>
        </ul>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.project-assets-page {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 16px;
  padding: 12px 20px 20px;
  overflow: hidden;
}

.project-assets-page.has-preview-panel {
  grid-template-columns: 230px minmax(360px, 1fr) var(--project-assets-preview-width, 400px);
}

.project-assets-preview-panel {
  position: relative;
  min-height: 0;
  overflow: visible;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
}

.project-assets-preview-resizer {
  position: absolute;
  z-index: 2;
  top: 8px;
  bottom: 8px;
  left: -10px;
  width: 18px;
  cursor: col-resize;
  touch-action: none;
}

.project-assets-preview-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
}

.project-assets-preview-resizer:hover::after,
.project-assets-preview-resizer:focus-visible::after {
  background: var(--app-accent);
}

.project-assets-preview-resizer:focus-visible {
  outline: none;
}

.project-assets-preview-panel-scroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.project-assets-preview-panel-content {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.project-assets-preview-panel-name {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--app-ink);
  text-align: center;
  overflow-wrap: anywhere;
}

.project-assets-preview-panel-size {
  margin: 4px 0 0;
  color: var(--app-ink-muted);
  font-size: 12px;
}

.project-assets-preview-panel-note {
  width: 100%;
  max-height: 180px;
  margin: 12px 0 0;
  padding: 8px 10px;
  overflow-y: auto;
  box-sizing: border-box;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-sunken);
  color: var(--app-ink-soft);
  font-size: 12px;
  line-height: 1.55;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.project-assets-preview-panel-img {
  /* Natural size, shrink-to-fit only: never upscale small art, never overflow the pane. */
  max-width: 100%;
  max-height: calc(100vh - 260px);
  object-fit: contain;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-sunken);
}

.project-assets-preview-panel-video {
  width: 100%;
  max-height: min(360px, 60vh);
  border-radius: var(--app-radius-sm);
  background: #000;
}

.project-assets-preview-panel-font {
  width: 100%;
  margin: 0;
}

.project-assets-preview-panel-type,
.project-assets-preview-panel-empty {
  display: grid;
  min-height: 120px;
  place-items: center;
  color: var(--app-ink-muted);
  font-size: 12px;
  text-align: center;
}

.project-assets-preview-panel-empty {
  height: 100%;
}

.project-assets-tree-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 8px 6px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
}

.project-assets-tree {
  --el-tree-node-content-height: 30px;
  background: transparent;
}

.project-assets-tree :deep(.el-tree-node__content) {
  border-radius: var(--app-radius-sm);
  font-size: 12px;
}

.project-assets-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.project-assets-tree-node {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding-right: 4px;
  border-radius: var(--app-radius-sm);
}

.project-assets-tree-node.is-drop-target {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  outline: 1px dashed var(--app-accent);
  outline-offset: -1px;
}

.project-assets-tree-node span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-assets-tree-node small {
  margin-left: auto;
  color: var(--app-ink-muted);
  font-size: 10px;
}

.project-assets-tree-favorite {
  flex: none;
  color: var(--el-color-warning);
  font-size: 12px;
}

.project-assets-main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.project-assets-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.project-assets-toolbar-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
  align-items: center;
}

.project-assets-address-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 0 0 auto;
}

.project-assets-address-search {
  flex: 0 1 280px;
  min-width: 160px;
  max-width: 360px;
}

.project-assets-menu-caret {
  margin-left: 2px;
  font-size: 12px;
}

.project-assets-menu-check {
  display: inline-grid;
  place-items: center;
  width: 16px;
  margin-right: 6px;
  flex: 0 0 auto;
}

.project-assets-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-elevated);
  color: var(--app-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.project-assets-tool-btn:hover:not(:disabled) {
  background: var(--app-bg-sunken);
}

.project-assets-tool-btn.is-active {
  border-color: color-mix(in srgb, var(--app-accent) 55%, var(--app-border));
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.project-assets-tool-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.project-assets-tool-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.project-assets-error {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--app-danger) 35%, var(--app-border));
  border-radius: var(--app-radius-sm);
  background: color-mix(in srgb, var(--app-danger) 7%, var(--app-bg));
  color: var(--app-danger);
  font-size: 12px;
  white-space: pre-wrap;
}

.project-assets-error-dismiss {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
}

.project-assets-path-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
}

.project-assets-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow: auto;
  white-space: nowrap;
  font-size: 12px;
}

.project-assets-crumb {
  border: 0;
  padding: 4px 6px;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  cursor: pointer;
}

.project-assets-crumb:hover {
  background: var(--app-bg-sunken);
}

.project-assets-crumb.is-current {
  padding: 4px 6px;
  color: var(--app-ink-muted);
  user-select: text;
}

.project-assets-crumb-sep {
  color: var(--app-ink-muted);
  font-size: 12px;
}

.project-assets-path-text {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  color: var(--app-ink-muted);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-size: 12px;
  overflow: auto;
  white-space: nowrap;
  user-select: text;
}

.project-assets-path-copy {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}

.project-assets-path-copy:hover:not(:disabled) {
  background: var(--app-bg-sunken);
  color: var(--app-ink);
}

.project-assets-path-copy:disabled {
  opacity: 0.45;
  cursor: default;
}

.project-assets-grid-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
  outline: none;
}

.project-assets-grid-host.is-file-drop-target {
  border-color: var(--app-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 55%, transparent);
  background: color-mix(in srgb, var(--app-accent) 8%, var(--app-bg-elevated));
}

.project-assets-drop-hint {
  position: sticky;
  top: 12px;
  z-index: 3;
  width: max-content;
  max-width: calc(100% - 24px);
  margin: 12px auto 0;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--app-accent) 45%, var(--app-border));
  border-radius: var(--app-radius-sm);
  background: color-mix(in srgb, var(--app-bg) 88%, var(--app-accent));
  color: var(--app-fg);
  font-size: 13px;
  pointer-events: none;
}

.project-assets-grid-spacer {
  position: relative;
  width: 100%;
}

.project-assets-grid-spacer.is-marquee {
  user-select: none;
}

.project-assets-marquee {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--app-accent) 90%, var(--app-border));
  background: color-mix(in srgb, var(--app-accent) 35%, transparent);
  pointer-events: none;
}

.project-assets-selection-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-top: auto;
  font-size: 12px;
  color: var(--app-ink-muted);
  border-top: 1px solid var(--app-border);
  background: var(--app-bg-sunken);
}

.selection-bar-sep {
  color: var(--app-border);
}

.project-assets-empty,
.project-assets-state {
  display: grid;
  place-items: center;
  min-height: 160px;
  padding: 24px;
  color: var(--app-ink-muted);
  font-size: 13px;
  text-align: center;
}

.project-assets-cell-host {
  box-sizing: border-box;
}

.project-assets-cell {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.project-assets-cell:hover {
  background: var(--app-bg-sunken);
}

.project-assets-cell.selected {
  border-color: color-mix(in srgb, var(--app-accent) 45%, var(--app-border));
  background: var(--app-accent-soft);
}

.project-assets-cell:focus-visible {
  outline: none;
  box-shadow: var(--app-ring);
}

.project-assets-thumb {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: var(--app-radius-sm);
  background-color: var(--app-bg-sunken);
  background-image:
    linear-gradient(45deg, var(--app-border) 25%, transparent 25%),
    linear-gradient(-45deg, var(--app-border) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--app-border) 75%),
    linear-gradient(-45deg, transparent 75%, var(--app-border) 75%);
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
  color: var(--app-ink-muted);
}

.project-assets-ext-tag {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  padding: 1px 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  border-radius: 3px;
  color: #fff;
  pointer-events: none;
}
.project-assets-ext-tag.ext-image  { background: #2e7d32; }
.project-assets-ext-tag.ext-audio  { background: #c62828; }
.project-assets-ext-tag.ext-video  { background: #1565c0; }
.project-assets-ext-tag.ext-font   { background: #6a1b9a; }
.project-assets-ext-tag.ext-other  { background: #546e7a; }

.project-assets-fav-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  display: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.project-assets-fav-btn:hover {
  background: rgba(0, 0, 0, 0.65);
}
.project-assets-fav-btn.is-favorite {
  display: flex;
  color: #f5a623;
  background: rgba(0, 0, 0, 0.45);
}
.project-assets-cell:hover .project-assets-fav-btn,
.project-assets-cell:focus-within .project-assets-fav-btn {
  display: flex;
}

/* Inline variants for the details list: flow with the name text instead of overlaying the thumb. */
.project-assets-ext-tag.is-inline {
  position: static;
  flex: 0 0 auto;
}
.project-assets-fav-btn.is-inline {
  position: static;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  background: transparent;
  color: var(--app-ink-muted);
}
.project-assets-fav-btn.is-inline:hover {
  background: var(--app-bg-sunken);
  color: var(--app-ink);
}
.project-assets-fav-btn.is-inline.is-favorite {
  display: flex;
  color: #f5a623;
  background: transparent;
}
.project-assets-details-row:hover .project-assets-fav-btn.is-inline,
.project-assets-details-row:focus-within .project-assets-fav-btn.is-inline {
  display: flex;
}

.project-assets-thumb img {
  /* Fill the square box, then letterbox — never overflow-crop. */
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: contain;
  object-position: center;
  image-rendering: pixelated;
}

.project-assets-thumb.is-icon :deep(svg) {
  width: 1em;
  height: 1em;
}

.project-assets-thumb.is-media-thumb {
  padding: 0;
}

.project-assets-thumb.is-folder {
  overflow: visible;
  background-color: transparent;
  background-image: none;
}

.project-assets-thumb.is-encrypted {
  background-image: none;
  background: color-mix(in srgb, var(--app-ink-muted) 12%, var(--app-bg-sunken));
}

.project-assets-details {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 8px 12px 12px;
}

.project-assets-details-header,
.project-assets-details-row {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(72px, 0.7fr) minmax(72px, 0.7fr) minmax(120px, 1fr) minmax(90px, 0.9fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
}

.project-assets-details-header.has-duration,
.project-assets-details-row.has-duration {
  grid-template-columns: minmax(0, 2.2fr) minmax(72px, 0.7fr) minmax(72px, 0.7fr) minmax(56px, 0.5fr) minmax(120px, 1fr) minmax(90px, 0.9fr);
}

.project-assets-details-row .col-note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-ink-muted);
}

.project-assets-details-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 8px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  color: var(--app-ink-muted);
  font-size: 11px;
  font-weight: 600;
}

.project-assets-details-header-cell {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.project-assets-details-header-cell:hover {
  color: var(--app-ink);
}

.project-assets-sort-caret {
  flex: none;
  color: var(--app-accent);
}

.project-assets-details-row {
  padding: 7px 8px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.project-assets-details-row:hover {
  background: var(--app-bg-sunken);
}

.project-assets-details-row.selected {
  background: var(--app-accent-soft);
}

.project-assets-details-row .col-name {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.project-assets-details-row .col-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-assets-encrypted {
  padding: 0 6px;
  font-size: 10px;
  font-weight: 650;
  text-align: center;
  line-height: 1.3;
}

.project-assets-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  width: 100%;
  min-height: 0;
  max-height: 26px;
  font-size: 11px;
  font-weight: 600;
  line-height: 13px;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  min-width: 184px;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--app-shadow-overlay);
  color: var(--app-ink);
  font-size: 13px;
  list-style: none;
}

.ctx-menu li {
  padding: 6px 14px;
  cursor: pointer;
  white-space: nowrap;
}

.ctx-menu li:hover {
  background: var(--app-bg-sunken);
}

.ctx-menu li.ctx-danger {
  color: var(--el-color-danger);
}

/* Explorer-style metadata tooltip anchored below the pointer */
.project-assets-meta-tooltip {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color, #d4d4d8);
  border-radius: 2px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  max-width: 280px;
  color: #1f1f1f;
  font-size: 12px;
  line-height: 1.45;
  pointer-events: none;
}

.project-assets-meta-tooltip p {
  margin: 0;
}
</style>
