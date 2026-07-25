<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Document,
  Folder,
  Headset,
  Film,
  MagicStick,
  Picture,
  Refresh,
  Upload,
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
  ProjectAssetBrowseEntry,
  ProjectAssetCategoryTreeNode,
} from '@contract/types'
import {
  maps as mapsApi,
  projectAssets,
  type ManagedAssetDetail,
} from '../api/client'
import AssetPreviewDialog from '../components/AssetPreviewDialog.vue'
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
import { computeProjectAssetGridWindow } from '../utils/projectAssetGridWindow'
import { selectProjectAssetThumbnailBucket } from '../utils/projectAssetThumbnailBucket'
import { parseProjectStagingSummary, type ProjectStagingSummary } from '../utils/projectStaging'
import { formatUserFacingErrorMessage } from '../utils/user-facing-error'

/** Cell width/height for the virtualized grid (room for thumb + wrapped name). */
const CELL_SIZE = 148
const CELL_GAP = 10
const THUMB_SIZE = 96
const OVERSCAN_ROWS = 2

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
const categoryError = ref('')
const categoryLoading = ref(false)

const searchQuery = ref('')
const selectedEntryId = ref<string | null>(null)
const mutationBusy = ref(false)
const mutationError = ref('')

const stagingDirty = ref(false)
const stagingBusy = ref(false)
const stagingError = ref('')

const previewVisible = ref(false)
const previewIndex = ref(0)

const contextMenu = ref<{ x: number; y: number; entryId: string } | null>(null)

const containerWidth = ref(0)
const containerHeight = ref(0)
const scrollTop = ref(0)
const failedThumbnails = ref(new Set<string>())

const listingCoordinator = new LatestAsyncCoordinator<{
  project: string
  categoryId: string
  bucket: number
}>()

let resizeObserver: ResizeObserver | null = null

const previewSurfaceLabels = computed<AssetPreviewSurfaceLabels>(() => ({
  previewFailed: t('projectAssets.previewFailed'),
  none: t('projectAssets.previewNone'),
  previewZoom: t('projectAssets.previewZoom'),
  resetZoom: t('projectAssets.resetZoom'),
  zoomOut: t('projectAssets.zoomOut'),
  zoomIn: t('projectAssets.zoomIn'),
}))

const previewDialogLabels = computed<AssetPreviewDialogLabels>(() => ({
  closeTitle: t('projectAssets.previewCloseTitle'),
  close: t('common.close'),
}))

const thumbnailBucket = computed(() =>
  selectProjectAssetThumbnailBucket(THUMB_SIZE, window.devicePixelRatio || 1),
)

const treeData = computed<TreeNodeView[]>(() =>
  treeNodes.value.map((node) => mapTreeNode(node)),
)

const selectedNode = computed(() => findTreeNode(treeNodes.value, selectedCategoryId.value))

const isGroupSelection = computed(() =>
  Boolean(selectedCategoryId.value && isProjectAssetGroupCategory(selectedCategoryId.value)),
)

const folderItems = computed<FolderGridItem[]>(() => {
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
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return categoryEntries.value
  return categoryEntries.value.filter((entry) => entry.name.toLowerCase().includes(query))
})

const gridItems = computed<GridItem[]>(() => {
  if (!selectedCategoryId.value) return []
  if (isGroupSelection.value) {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return folderItems.value
    return folderItems.value.filter((item) => item.label.toLowerCase().includes(query))
  }
  return filteredEntries.value.map((entry) => ({ kind: 'file' as const, entry }))
})

const gridWindow = computed(() =>
  computeProjectAssetGridWindow({
    containerWidth: containerWidth.value,
    containerHeight: containerHeight.value,
    cellSize: CELL_SIZE,
    gap: CELL_GAP,
    itemCount: gridItems.value.length,
    scrollTop: scrollTop.value,
    overscanRows: OVERSCAN_ROWS,
  }),
)

const visibleItems = computed(() => {
  const { startIndex, endIndex, columnCount } = gridWindow.value
  return gridItems.value.slice(startIndex, endIndex).map((item, offset) => {
    const index = startIndex + offset
    const row = Math.floor(index / columnCount)
    const column = index % columnCount
    return {
      item,
      index,
      style: {
        position: 'absolute' as const,
        left: `${column * (CELL_SIZE + CELL_GAP)}px`,
        top: `${row * (CELL_SIZE + CELL_GAP)}px`,
        width: `${CELL_SIZE}px`,
        height: `${CELL_SIZE}px`,
      },
    }
  })
})

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
  return filteredEntries.value.map((entry) => toPreviewItem(entry))
})

const canImport = computed(() =>
  Boolean(
    projectStore.currentProject
    && selectedCategoryId.value
    && !isGroupSelection.value
    && !mutationBusy.value
    && !stagingBusy.value,
  ),
)

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
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatModified(mtimeMs: number): string {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return '—'
  return new Date(mtimeMs).toLocaleString()
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

function entryPrimaryPath(entry: ProjectAssetBrowseEntry): string {
  return entry.variants[0]?.relativePath || ''
}

function buildEntryMetadata(entry: ProjectAssetBrowseEntry, categoryId: string): string {
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
  } else if (categoryId === 'effects') {
    parts.push(t('projectAssets.cannotPreviewEffects'))
  }
  return parts.join(' · ')
}

function toPreviewItem(entry: ProjectAssetBrowseEntry): AssetPreviewItem {
  const categoryId = selectedCategoryId.value
  const canPreview = projectAssetCanPreview(categoryId, entry.encrypted)
  return {
    id: entry.id,
    displayName: entry.name,
    url: canPreview ? entry.url : '',
    media: canPreview ? projectAssetMediaKind(categoryId) : 'other',
    metadata: buildEntryMetadata(entry, categoryId),
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
}

function syncTreeCurrentKey(categoryId: string) {
  nextTick(() => {
    treeRef.value?.setCurrentKey(categoryId || undefined)
  })
}

async function refreshStagingStatus() {
  if (!projectStore.currentProject) {
    stagingDirty.value = false
    workbenchUi.sbStagingDirty = false
    stagingError.value = ''
    return
  }
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject)
    stagingDirty.value = Boolean((status as { staged?: boolean }).staged)
    workbenchUi.sbStagingDirty = stagingDirty.value
    stagingError.value = ''
  } catch (error) {
    // Keep last known dirty flag; surface that the indicator cannot be trusted.
    stagingError.value = t('projectAssets.stagingStatusFailed', { message: formatError(error) })
  }
}

async function confirmAgentOperations(summary: ProjectStagingSummary): Promise<boolean> {
  const operations = summary.operations.length
  if (operations <= 0) return true
  try {
    await ElMessageBox.confirm(
      t('story.applyAgentOperationsConfirm', { operations }),
      t('story.applyAgentOperationsTitle'),
      { type: 'warning' },
    )
    return true
  } catch {
    return false
  }
}

async function loadTree(preferredCategoryId?: string) {
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
    const nextId = preferredCategoryId && findTreeNode(tree.nodes, preferredCategoryId)
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

async function loadCategory(categoryId: string) {
  if (!projectStore.currentProject || !categoryId) {
    categoryEntries.value = []
    return
  }
  if (isProjectAssetGroupCategory(categoryId)) {
    listingCoordinator.invalidate({
      project: projectStore.currentProject,
      categoryId,
      bucket: thumbnailBucket.value,
    })
    categoryEntries.value = []
    categoryError.value = ''
    categoryLoading.value = false
    selectedEntryId.value = null
    scrollTop.value = 0
    if (gridHost.value) gridHost.value.scrollTop = 0
    return
  }

  const project = projectStore.currentProject
  const bucket = thumbnailBucket.value
  const token = listingCoordinator.begin({ project, categoryId, bucket })
  categoryLoading.value = true
  categoryError.value = ''
  selectedEntryId.value = null
  scrollTop.value = 0
  if (gridHost.value) gridHost.value.scrollTop = 0
  failedThumbnails.value = new Set()

  await listingCoordinator.runExclusive(token, async (context) => {
    try {
      const listing = await projectAssets.browseCategory(categoryId, project, bucket)
      if (!context.isCurrent()) return
      categoryEntries.value = listing.entries
      categoryError.value = ''
    } catch (error) {
      if (!context.isCurrent()) return
      categoryEntries.value = []
      categoryError.value = t('projectAssets.loadCategoryFailed', { message: formatError(error) })
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
  selectedCategoryId.value = categoryId
  searchQuery.value = ''
  syncTreeCurrentKey(categoryId)
  void loadCategory(categoryId)
}

function onTreeNodeClick(data: TreeNodeView) {
  selectCategory(data.id)
}

function onCellClick(item: GridItem) {
  if (item.kind === 'folder') {
    selectedEntryId.value = item.id
    return
  }
  selectedEntryId.value = item.entry.id
}

function onCellDoubleClick(item: GridItem) {
  if (item.kind === 'folder') {
    selectCategory(item.id)
    return
  }
  openPreviewForEntry(item.entry.id)
}

function openPreviewForEntry(entryId: string) {
  const index = filteredEntries.value.findIndex((entry) => entry.id === entryId)
  if (index < 0) return
  selectedEntryId.value = entryId
  previewIndex.value = index
  previewVisible.value = true
}

function closePreview() {
  previewVisible.value = false
}

function onPreviewNavigate(index: number) {
  previewIndex.value = index
  const entry = filteredEntries.value[index]
  if (entry) selectedEntryId.value = entry.id
}

function onCellKeydown(event: KeyboardEvent, item: GridItem) {
  if (event.key === 'Enter') {
    event.preventDefault()
    onCellDoubleClick(item)
  }
}

function onThumbnailError(entryId: string) {
  failedThumbnails.value = new Set([...failedThumbnails.value, entryId])
}

function openContextMenu(event: MouseEvent, entryId: string) {
  event.preventDefault()
  selectedEntryId.value = entryId
  contextMenu.value = { x: event.clientX, y: event.clientY, entryId }
}

function closeContextMenu() {
  contextMenu.value = null
}

function localFileParts(filePath: string): { fileName: string; name: string } {
  const fileName = String(filePath || '').split(/[\\/]/).pop() || ''
  return { fileName, name: fileName.replace(/\.[^.]+$/, '') }
}

function selectedFileEntry(): ProjectAssetBrowseEntry | null {
  if (!selectedEntryId.value || isGroupSelection.value) return null
  return categoryEntries.value.find((entry) => entry.id === selectedEntryId.value) || null
}

function entryMutationTarget(entry: ProjectAssetBrowseEntry) {
  const relativePath = entryPrimaryPath(entry)
  if (!relativePath) return null
  return {
    scope: 'project' as const,
    category: selectedCategoryId.value,
    relativePath,
  }
}

async function importFile() {
  if (!canImport.value || !projectStore.currentProject) return
  const category = selectedCategoryId.value
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const sourceFile = await projectAssets.selectImportFile(category)
    if (!sourceFile) return
    const { name } = localFileParts(sourceFile)
    const overwrite = categoryEntries.value.some((entry) => entry.name === name)
    if (overwrite) {
      try {
        await ElMessageBox.confirm(
          t('projectAssets.overwriteConfirm', { name }),
          t('projectAssets.overwriteTitle'),
          { type: 'warning' },
        )
      } catch {
        return
      }
    }
    const imported = await projectAssets.importLocalFile(
      { category, sourceFile, overwrite },
      projectStore.currentProject,
    )
    await afterMutation(imported)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

async function renameSelectedEntry() {
  const entry = selectedFileEntry()
  const target = entry ? entryMutationTarget(entry) : null
  if (!entry || !target || !projectStore.currentProject || mutationBusy.value) return
  closeContextMenu()
  let nextName = ''
  try {
    const response = await ElMessageBox.prompt(
      t('projectAssets.renamePrompt', { count: 0 }),
      t('projectAssets.renameTitle'),
      {
        inputValue: entry.name,
        inputPattern: /^[^<>:"/\\|?*\u0000-\u001f]+$/,
        inputErrorMessage: t('projectAssets.nameInvalid'),
      },
    )
    nextName = String(response.value || '').trim()
  } catch {
    return
  }
  if (!nextName || nextName === entry.name) return

  mutationBusy.value = true
  mutationError.value = ''
  try {
    const safety = await projectAssets.checkRenameSafety(target, nextName, projectStore.currentProject)
    if (!safety.ok) {
      mutationError.value = t('projectAssets.mutationBlocked', {
        reasons: safety.blockers.join('\n'),
      })
      return
    }
    try {
      await ElMessageBox.confirm(
        t('projectAssets.renameConfirm', { count: safety.references.length }),
        t('projectAssets.renameTitle'),
        { type: 'warning' },
      )
    } catch {
      return
    }
    const renamed = await projectAssets.rename(target, nextName, projectStore.currentProject)
    await afterMutation(renamed)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

async function deleteSelectedEntry() {
  const entry = selectedFileEntry()
  const target = entry ? entryMutationTarget(entry) : null
  if (!entry || !target || !projectStore.currentProject || mutationBusy.value) return
  closeContextMenu()
  mutationBusy.value = true
  mutationError.value = ''
  try {
    const safety = await projectAssets.checkDeleteSafety(target, projectStore.currentProject)
    if (!safety.ok) {
      mutationError.value = t('projectAssets.mutationBlocked', {
        reasons: safety.blockers.join('\n'),
      })
      return
    }
    try {
      await ElMessageBox.confirm(
        t('projectAssets.deleteConfirm', { name: entry.name }),
        t('projectAssets.deleteTitle'),
        { type: 'warning' },
      )
    } catch {
      return
    }
    await projectAssets.remove(target, projectStore.currentProject)
    selectedEntryId.value = null
    await afterMutation(null)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    mutationBusy.value = false
  }
}

async function afterMutation(detail: ManagedAssetDetail | null) {
  await refreshStagingStatus()
  if (stagingError.value) {
    // Mutation reached staging; if status cannot be read, do not imply a clean project.
    stagingDirty.value = true
    workbenchUi.sbStagingDirty = true
  }
  await loadTree(selectedCategoryId.value)
  if (detail?.name) {
    const match = categoryEntries.value.find((entry) => entry.name === detail.name)
    if (match) selectedEntryId.value = match.id
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

async function applyProjectStaging() {
  if (!projectStore.currentProject || stagingBusy.value) return
  stagingBusy.value = true
  mutationError.value = ''
  try {
    const status = await mapsApi.projectStaging(projectStore.currentProject)
    const summary = parseProjectStagingSummary(status)
    if (!await confirmAgentOperations(summary)) return
    const result = await mapsApi.applyProjectStaging(
      projectStore.currentProject,
      summary.operations.map((operation) => operation.operationId),
    ) as { canceled?: boolean }
    if (result?.canceled) return
    await refreshStagingStatus()
    await loadTree(selectedCategoryId.value)
    ElMessage.success(t('editor.toolbar.applyStaging'))
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    stagingBusy.value = false
  }
}

async function discardProjectStaging() {
  if (!projectStore.currentProject || stagingBusy.value) return
  stagingBusy.value = true
  mutationError.value = ''
  try {
    await mapsApi.discardProjectStaging(projectStore.currentProject)
    await refreshStagingStatus()
    await loadTree(selectedCategoryId.value)
  } catch (error) {
    mutationError.value = formatError(error)
  } finally {
    stagingBusy.value = false
  }
}

watch(
  () => projectStore.currentProject,
  () => {
    void loadTree()
    void refreshStagingStatus()
  },
)

watch(thumbnailBucket, (bucket, previous) => {
  if (bucket === previous) return
  if (!selectedCategoryId.value || isGroupSelection.value) return
  void loadCategory(selectedCategoryId.value)
})

onMounted(() => {
  measureGrid()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measureGrid())
    if (gridHost.value) resizeObserver.observe(gridHost.value)
  }
  void loadTree()
  void refreshStagingStatus()
})

watch(gridHost, (el, previous) => {
  if (resizeObserver) {
    if (previous) resizeObserver.unobserve(previous)
    if (el) resizeObserver.observe(el)
  }
  measureGrid()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div class="project-assets-page" data-ui-id="project-assets-page">
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
          <span class="project-assets-tree-node" :title="`${data.label} (${data.entryCount})`">
            <span>{{ data.label }}</span>
            <small>{{ data.entryCount }}</small>
          </span>
        </template>
      </el-tree>
    </aside>

    <section class="project-assets-main">
      <header class="project-assets-toolbar">
        <ConsoleSearchInput
          v-model="searchQuery"
          :placeholder="t('projectAssets.searchPlaceholder')"
        />
        <div class="project-assets-toolbar-actions">
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
            :disabled="!projectStore.currentProject || mutationBusy || stagingBusy"
            :title="t('projectAssets.refresh')"
            @click="refreshAll"
          >
            <el-icon><Refresh /></el-icon>
            <span>{{ t('projectAssets.refresh') }}</span>
          </button>
        </div>
      </header>

      <div
        v-if="stagingDirty"
        class="project-assets-staging"
        data-ui-id="project-assets-staging-bar"
      >
        <span>{{ t('projectAssets.stagingPending') }}</span>
        <div class="project-assets-staging-actions">
          <button
            type="button"
            class="project-assets-tool-btn"
            data-ui-id="project-assets-discard"
            :disabled="stagingBusy || mutationBusy"
            @click="discardProjectStaging"
          >
            {{ t('editor.toolbar.discard') }}
          </button>
          <button
            type="button"
            class="project-assets-tool-btn project-assets-apply"
            data-ui-id="project-assets-apply"
            :disabled="stagingBusy || mutationBusy"
            @click="applyProjectStaging"
          >
            {{ t('editor.toolbar.applyStaging') }}
          </button>
        </div>
      </div>

      <div v-if="stagingError" class="project-assets-error" role="alert" data-ui-id="project-assets-staging-error">{{ stagingError }}</div>
      <div v-if="mutationError" class="project-assets-error" role="alert">{{ mutationError }}</div>
      <div v-if="categoryError" class="project-assets-error" role="alert">{{ categoryError }}</div>

      <div
        ref="gridHost"
        class="project-assets-grid-host"
        data-ui-id="project-assets-grid"
        :aria-label="t('projectAssets.gridAria')"
        @scroll="onGridScroll"
      >
        <div
          v-if="emptyMessage && !categoryLoading"
          class="project-assets-empty"
        >
          {{ emptyMessage }}
        </div>
        <div
          v-else
          class="project-assets-grid-spacer"
          :style="{ height: `${gridWindow.totalHeight}px` }"
        >
          <button
            v-for="cell in visibleItems"
            :key="cell.item.kind === 'folder' ? `folder:${cell.item.id}` : cell.item.entry.id"
            type="button"
            class="project-assets-cell"
            :class="{
              selected: cell.item.kind === 'folder'
                ? selectedEntryId === cell.item.id
                : selectedEntryId === cell.item.entry.id,
            }"
            :style="cell.style"
            :data-ui-id="cell.item.kind === 'folder'
              ? `project-assets-folder-${cell.item.id}`
              : `project-assets-cell-${cell.item.entry.id}`"
            @click="onCellClick(cell.item)"
            @dblclick="onCellDoubleClick(cell.item)"
            @keydown="onCellKeydown($event, cell.item)"
            @contextmenu="cell.item.kind === 'file'
              ? openContextMenu($event, cell.item.entry.id)
              : undefined"
          >
            <template v-if="cell.item.kind === 'folder'">
              <span class="project-assets-thumb is-icon">
                <el-icon><Folder /></el-icon>
              </span>
              <span class="project-assets-name" :title="`${cell.item.label} (${cell.item.entryCount})`">{{ cell.item.label }}</span>
            </template>
            <template v-else>
              <span
                class="project-assets-thumb"
                :class="{
                  'is-icon': !isProjectAssetImageCategory(selectedCategoryId)
                    || cell.item.entry.encrypted
                    || !cell.item.entry.thumbnailUrl
                    || failedThumbnails.has(cell.item.entry.id),
                  'is-encrypted': cell.item.entry.encrypted,
                }"
              >
                <img
                  v-if="isProjectAssetImageCategory(selectedCategoryId)
                    && !cell.item.entry.encrypted
                    && cell.item.entry.thumbnailUrl
                    && !failedThumbnails.has(cell.item.entry.id)"
                  :src="cell.item.entry.thumbnailUrl"
                  :alt="cell.item.entry.name"
                  draggable="false"
                  @error="onThumbnailError(cell.item.entry.id)"
                />
                <template v-else-if="cell.item.entry.encrypted">
                  <span class="project-assets-encrypted">{{ t('projectAssets.encrypted') }}</span>
                </template>
                <template v-else-if="failedThumbnails.has(cell.item.entry.id)">
                  <span class="project-assets-encrypted">{{ t('projectAssets.thumbnailFailed') }}</span>
                </template>
                <el-icon v-else>
                  <component :is="typeIcon(selectedCategoryId)" />
                </el-icon>
              </span>
              <span class="project-assets-name" :title="cell.item.entry.name">{{ cell.item.entry.name }}</span>
            </template>
          </button>
        </div>
      </div>
    </section>

    <AssetPreviewDialog
      :visible="previewVisible"
      :items="previewItems"
      :current-index="previewIndex"
      :labels="previewDialogLabels"
      :surface-labels="previewSurfaceLabels"
      @close="closePreview"
      @navigate="onPreviewNavigate"
    />

    <teleport to="body">
      <div
        v-if="contextMenu"
        class="ctx-mask"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <ul
          class="ctx-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        >
          <li @click="renameSelectedEntry">{{ t('projectAssets.rename') }}</li>
          <li class="ctx-danger" @click="deleteSelectedEntry">{{ t('projectAssets.delete') }}</li>
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

.project-assets-toolbar :deep(.console-search-input) {
  flex: 1;
  min-width: 0;
}

.project-assets-toolbar-actions {
  display: flex;
  gap: 8px;
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

.project-assets-tool-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.project-assets-tool-btn :deep(svg) {
  width: 14px;
  height: 14px;
}

.project-assets-apply {
  border-color: color-mix(in srgb, var(--app-accent) 40%, var(--app-border));
  color: var(--app-accent);
}

.project-assets-staging {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink-muted);
  font-size: 12px;
}

.project-assets-staging-actions {
  display: flex;
  gap: 8px;
}

.project-assets-error {
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--app-danger) 35%, var(--app-border));
  border-radius: var(--app-radius-sm);
  background: color-mix(in srgb, var(--app-danger) 7%, var(--app-bg));
  color: var(--app-danger);
  font-size: 12px;
  white-space: pre-wrap;
}

.project-assets-grid-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
}

.project-assets-grid-spacer {
  position: relative;
  width: 100%;
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

.project-assets-cell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  text-align: left;
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
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 100%;
  height: 72px;
  overflow: hidden;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-sunken);
  color: var(--app-ink-muted);
}

.project-assets-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.project-assets-thumb.is-icon :deep(svg) {
  width: 28px;
  height: 28px;
}

.project-assets-thumb.is-encrypted {
  background: color-mix(in srgb, var(--app-ink-muted) 12%, var(--app-bg-sunken));
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
  -webkit-line-clamp: 3;
  overflow: hidden;
  min-height: 0;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
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
</style>
