<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import {
  ArrowRight,
  Grid,
  Headset,
  MagicStick,
  MapLocation,
  Picture,
  User,
  VideoPlay,
} from '@element-plus/icons-vue';
import {
  assetLibrary,
  mapLibrary,
  maps,
  type AssetLibraryCatalog,
  type AssetLibraryCategoryId,
  type AssetLibraryEntry,
  type AssetLibrarySkillEntry,
  type MapLibraryPackageValidation,
  type PackageImportResult,
} from '../../api/client';
import {
  assetFolderLabel,
  buildAssetLibraryFolders,
  countAssetFolders,
  filterAssetByFolder,
  loadFoldersPaneExpanded,
  loadStoredFolderId,
  saveFoldersPaneExpanded,
  saveStoredFolderId,
} from '../../config/asset-library-folders';
import { LAYER_Z } from '../../constants/layerZIndex';
import { translateKnownIssues } from '../../config/known-issues-i18n';
import { useI18n } from '../../i18n';
import { useProjectStore } from '../../stores/project';
import { buildMapPickerOptions, type MapPickerOption } from '../../utils/map-tree-options';
import {
  consoleAssetsText,
  importedMapIdSuffix,
  translateAssetImportIssue,
} from '../../utils/consoleAssetsPaneLocalization';
import { formatUserFacingErrorMessage } from '../../utils/user-facing-error';
import ConsoleSearchInput from './ConsoleSearchInput.vue';

interface FolderTreeNode {
  id: string;
  label: string;
  count: number;
}

interface PreviewSlice {
  label: string;
  className: string;
}

const props = defineProps<{ catalog: AssetLibraryCatalog | null; loading: boolean; error: string | null }>();
const projectStore = useProjectStore();
const { language, t } = useI18n();
const selectedCategory = ref<AssetLibraryCategoryId>('maps');
const selectedFolderId = ref('all');
const foldersPaneExpanded = ref(false);
const selectedEntry = ref<AssetLibraryEntry | null>(null);
const search = ref('');
const detailLoading = ref(false);
const actionBusy = ref(false);
const actionMessage = ref('');
const actionError = ref('');
const visibleLimit = ref(250);
const folderTreeRef = ref<{ setCurrentKey: (key: string) => void } | null>(null);
const contextMenuZ = LAYER_Z.contextMenu;

const folderContext = reactive({
  visible: false,
  x: 0,
  y: 0,
  folderId: '',
  folderLabel: '',
  count: 0,
});

const importDialog = reactive({
  visible: false,
  folderId: '',
  folderLabel: '',
  count: 0,
  includeEvents: false,
  parentMapId: 0,
  parentMapOptions: [] as MapPickerOption[],
  parentMapLoading: false,
  validation: null as MapLibraryPackageValidation | null,
  busy: false,
  error: '',
});

const categoryIcons = {
  maps: MapLocation,
  skills: MagicStick,
  tilesets: Grid,
  characters: User,
  images: Picture,
  audio: Headset,
  videos: VideoPlay,
};

const gridCategories = new Set<AssetLibraryCategoryId>(['maps', 'tilesets', 'characters', 'images']);

const ASSET_CATEGORY_LABEL_KEYS: Record<AssetLibraryCategoryId, Parameters<typeof t>[0]> = {
  maps: 'assets.category.maps',
  skills: 'assets.category.skills',
  tilesets: 'assets.category.tilesets',
  characters: 'assets.category.characters',
  images: 'assets.category.images',
  audio: 'assets.category.audio',
  videos: 'assets.category.videos',
};

const categories = computed(() => props.catalog?.categories || []);
const categoryEntries = computed(() =>
  (props.catalog?.entries || []).filter((entry) => entry.category === selectedCategory.value),
);
const categoryFolders = computed(() => buildAssetLibraryFolders(categoryEntries.value, language.value));
const folderCounts = computed(() => countAssetFolders(categoryEntries.value));
const showFolderPane = computed(() => categoryFolders.value.length > 1);
const folderTreeData = computed<FolderTreeNode[]>(() =>
  categoryFolders.value.map((folder) => ({
    id: folder.id,
    label: folder.label,
    count: folderCounts.value[folder.id] ?? 0,
  })),
);
const filteredEntries = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const byFolder = filterAssetByFolder(categoryEntries.value, selectedFolderId.value);
  if (!query) return byFolder;
  return byFolder.filter((entry) => entryMatchesSearch(entry, query));
});
const searchPlaceholder = computed(() =>
  selectedCategory.value === 'skills' ? t('assets.searchDesc') : t('assets.searchSource'),
);
const visibleEntries = computed(() => filteredEntries.value.slice(0, visibleLimit.value));
const usesGrid = computed(() => gridCategories.has(selectedCategory.value));
const listEmptyMessage = computed(() => {
  if (!categoryEntries.value.length) return t('assets.noAssets');
  if (!filteredEntries.value.length) return t('assets.noMatchAssets');
  return '';
});
const selectedFile = computed(() => selectedEntry.value?.kind === 'file' ? selectedEntry.value : null);
const selectedMap = computed(() => selectedEntry.value?.kind === 'map' ? selectedEntry.value.map : null);
const selectedSkill = computed(() => selectedEntry.value?.kind === 'skill' ? selectedEntry.value : null);
const translatedKnownIssues = computed(() =>
  selectedMap.value ? translateKnownIssues(selectedMap.value.knownIssues, language.value) : [],
);
const isImage = computed(() => selectedFile.value?.category === 'tilesets' || selectedFile.value?.category === 'characters' || selectedFile.value?.category === 'images');
const isAudio = computed(() => selectedFile.value?.category === 'audio');
const isVideo = computed(() => selectedFile.value?.category === 'videos');
const selectedPreviewSlices = computed<PreviewSlice[]>(() => {
  const file = selectedFile.value;
  if (!file || file.category !== 'characters') return [];
  if (file.subtype === 'faces') {
    return Array.from({ length: 8 }, (_, index) => ({
      label: t('assets.faceN', { n: index + 1 }),
      className: `face-${index}`,
    }));
  }
  if (file.subtype === 'svActors') {
    const labels = consoleAssetsText(language.value).svActorPreviewLabels;
    return labels.map((label, index) => ({
      label,
      className: `sv-${index}`,
    }));
  }
  if (file.subtype === 'characters') {
    const labels = consoleAssetsText(language.value).characterDirectionLabels;
    return labels.map((label, index) => ({
      label,
      className: `dir-${index}`,
    }));
  }
  return [];
});

function syncFolderSelection(categoryId = selectedCategory.value) {
  selectedFolderId.value = loadStoredFolderId(categoryId, buildAssetLibraryFolders(
    (props.catalog?.entries || []).filter((entry) => entry.category === categoryId),
    language.value,
  ));
  foldersPaneExpanded.value = loadFoldersPaneExpanded(categoryId);
  void nextTick(() => folderTreeRef.value?.setCurrentKey(selectedFolderId.value));
}

watch(categories, (next) => {
  if (!next.some((category) => category.id === selectedCategory.value) && next[0]) {
    selectedCategory.value = next[0].id;
  }
}, { immediate: true });

watch(selectedCategory, (categoryId) => {
  search.value = '';
  selectedEntry.value = null;
  actionMessage.value = '';
  actionError.value = '';
  visibleLimit.value = 250;
  syncFolderSelection(categoryId);
});

watch(categoryFolders, (folders) => {
  if (!folders.some((folder) => folder.id === selectedFolderId.value)) {
    selectedFolderId.value = 'all';
  }
});

watch(selectedFolderId, (folderId) => {
  saveStoredFolderId(selectedCategory.value, folderId);
  selectedEntry.value = null;
  visibleLimit.value = 250;
  void nextTick(() => folderTreeRef.value?.setCurrentKey(folderId));
});

watch(foldersPaneExpanded, (expanded) => {
  saveFoldersPaneExpanded(selectedCategory.value, expanded);
});

watch(() => props.catalog, (catalog) => {
  if (!catalog) return;
  syncFolderSelection();
}, { immediate: true });

watch(search, () => {
  selectedEntry.value = null;
  visibleLimit.value = 250;
});

watch(() => projectStore.currentProject, () => {
  selectedEntry.value = null;
  actionMessage.value = '';
  actionError.value = '';
});

function selectFolder(folderId: string) {
  selectedFolderId.value = folderId;
}

function toggleFoldersPane() {
  foldersPaneExpanded.value = !foldersPaneExpanded.value;
}

function formatFolderLabel(node: FolderTreeNode) {
  return `${node.label} (${node.count})`;
}

function collectFolderMapAssetIds(folderId: string): string[] {
  return filterAssetByFolder(categoryEntries.value, folderId)
    .filter((entry): entry is AssetLibraryEntry & { kind: 'map' } => entry.kind === 'map')
    .map((entry) => entry.assetId);
}

function onFolderContextMenu(event: MouseEvent, data: FolderTreeNode) {
  event.preventDefault();
  if (selectedCategory.value !== 'maps' || data.id === 'all' || data.count <= 0) return;
  Object.assign(folderContext, {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    folderId: data.id,
    folderLabel: data.label,
    count: data.count,
  });
}

function closeFolderContext() {
  folderContext.visible = false;
}

async function openFolderImportDialog() {
  const { folderId, folderLabel, count } = folderContext;
  closeFolderContext();
  if (!projectStore.currentProject) {
    actionError.value = t('assets.openProjectFirst');
    return;
  }
  Object.assign(importDialog, {
    visible: true,
    folderId,
    folderLabel,
    count,
    includeEvents: false,
    parentMapId: 0,
    parentMapOptions: [{ id: 0, label: t('assets.root') }],
    parentMapLoading: true,
    validation: null,
    busy: false,
    error: '',
  });
  const assetIds = collectFolderMapAssetIds(folderId);
  try {
    const [index, validation] = await Promise.all([
      maps.tree(projectStore.currentProject),
      mapLibrary.validatePackage(assetIds),
    ]);
    importDialog.parentMapOptions = buildMapPickerOptions(index.maps, language.value);
    importDialog.validation = validation;
  } catch (error) {
    importDialog.error = formatErrorText(error);
  } finally {
    importDialog.parentMapLoading = false;
  }
}

function closeImportDialog() {
  if (importDialog.busy) return;
  importDialog.visible = false;
}

function formatPackageImportSummary(result: PackageImportResult, total: number): string {
  const lines = [t('assets.importSuccess', { imported: result.mapIds.length, total })];
  if (result.usedSourceHierarchy) lines.push(t('assets.hierarchyRestored'));
  if (result.warnings.length) {
    lines.push(t('assets.warnings', { warnings: result.warnings.join(t('ui.separator.semicolon')) }));
  }
  return lines.join('\n');
}

function formatPackageImportFailures(result: PackageImportResult): string {
  if (!result.failed.length) return '';
  return result.failed.map((item) => `${item.assetId}: ${item.message}`).join('\n');
}

async function runFolderImport() {
  if (importDialog.busy) return;
  if (!projectStore.currentProject) {
    importDialog.error = t('assets.openProjectFirst');
    return;
  }
  const assetIds = collectFolderMapAssetIds(importDialog.folderId);
  if (!assetIds.length) {
    importDialog.error = t('assets.noImportableMaps');
    return;
  }
  importDialog.busy = true;
  importDialog.error = '';
  actionMessage.value = '';
  actionError.value = '';
  try {
    const result = await maps.importPackageFromLibrary(
      assetIds,
      importDialog.parentMapId,
      { includeEvents: importDialog.includeEvents },
      projectStore.currentProject,
    );
    importDialog.visible = false;
    actionMessage.value = formatPackageImportSummary(result, assetIds.length);
    const failures = formatPackageImportFailures(result);
    if (failures) actionError.value = t('assets.importFailed', { count: result.failed.length, details: failures });
  } catch (error) {
    importDialog.error = formatErrorText(error);
  } finally {
    importDialog.busy = false;
  }
}

async function openEntry(entry: AssetLibraryEntry) {
  detailLoading.value = true;
  actionMessage.value = '';
  actionError.value = '';
  try {
    selectedEntry.value = await assetLibrary.detail(entry.assetId);
  } catch (error) {
    actionError.value = formatErrorText(error);
  } finally {
    detailLoading.value = false;
  }
}

async function importSelected() {
  if (!selectedEntry.value || actionBusy.value) return;
  if (!projectStore.currentProject) {
    actionError.value = t('assets.openProjectForAssets');
    return;
  }
  actionBusy.value = true;
  actionMessage.value = '';
  actionError.value = '';
  try {
    const validation = await assetLibrary.validateImport(selectedEntry.value.assetId, projectStore.currentProject);
    if (!validation.ok) {
      actionError.value = formatAssetImportIssues(validation.issues);
      return;
    }
    const result = await assetLibrary.import(selectedEntry.value.assetId, projectStore.currentProject);
    actionMessage.value = result.kind === 'skill'
      ? t('assets.skillImported', { id: Number(result.importedId ?? 0) })
      : result.kind === 'map'
        ? t('assets.mapImported', { idSuffix: result.importedId ? importedMapIdSuffix(result.importedId, language.value) : '' })
        : t('assets.assetImported');
  } catch (error) {
    actionError.value = formatErrorText(error);
  } finally {
    actionBusy.value = false;
  }
}

function entrySource(entry: AssetLibraryEntry): string {
  return assetFolderLabel(entry, language.value);
}

function entryMatchesSearch(entry: AssetLibraryEntry, query: string): boolean {
  if (entry.name.toLocaleLowerCase().includes(query)) return true;
  if (entrySource(entry).toLocaleLowerCase().includes(query)) return true;
  if (entry.kind === 'skill') {
    const description = String(entry.skill.description || '').toLocaleLowerCase();
    if (description.includes(query)) return true;
  }
  if (entry.kind === 'file') {
    if (entry.subtype.toLocaleLowerCase().includes(query)) return true;
    if (entry.sourceSlug.toLocaleLowerCase().includes(query)) return true;
  }
  return false;
}

function entryMeta(entry: AssetLibraryEntry): string {
  if (entry.kind === 'map') {
    const map = entry.map.map;
    return map?.width && map?.height ? `${map.width} × ${map.height}` : entry.map.engine;
  }
  if (entry.kind === 'skill') return String(entry.skill.description || t('assets.rmmvSkill'));
  return `${entry.subtype} · ${entry.format.toUpperCase()} · ${formatSize(entry.size)}`;
}

function entryPreviewUrl(entry: AssetLibraryEntry): string {
  if (entry.kind === 'map') return entry.map.screenshotUrl;
  if (entry.kind === 'file' && (entry.category === 'tilesets' || entry.category === 'characters' || entry.category === 'images')) {
    return entry.url;
  }
  return '';
}

function entryBadge(entry: AssetLibraryEntry): string {
  if (entry.kind === 'map') {
    const map = entry.map.map;
    return map?.width && map?.height ? `${map.width}×${map.height}` : entry.map.engine;
  }
  if (entry.kind === 'file') {
    if (entry.subtype === 'characters') return t('assets.fourDir');
    if (entry.subtype === 'faces') return t('assets.eightFaces');
    if (entry.subtype === 'svActors') return 'SV';
    return entry.subtype;
  }
  return entry.category;
}

function previewClass(entry: AssetLibraryEntry): Record<string, boolean> {
  const isPixel = entry.category === 'tilesets' || entry.category === 'characters';
  const isCover = entry.kind === 'map' || (entry.kind === 'file' && entry.category === 'images');
  return {
    pixel: isPixel,
    cover: isCover,
    contain: !isCover,
    checker: entry.kind === 'file' && (entry.category === 'tilesets' || entry.category === 'characters' || entry.category === 'images'),
  };
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function skillValue(field: string): unknown {
  return selectedSkill.value?.skill[field];
}

function skillDamage(field: string): unknown {
  const damage = selectedSkill.value?.skill.damage;
  return damage && typeof damage === 'object' ? (damage as Record<string, unknown>)[field] : '';
}

function dependencyRows(skill: AssetLibrarySkillEntry): string[] {
  const groups: Array<[string, Array<{ id: number; name: string }>]> = [
    [t('assets.skillType'), skill.dependencies.skillTypes],
    [t('assets.weaponType'), skill.dependencies.weaponTypes],
    [t('assets.element'), skill.dependencies.elements],
    [t('assets.animation'), skill.dependencies.animations],
    [t('assets.state'), skill.dependencies.states],
    [t('assets.commonEvent'), skill.dependencies.commonEvents],
  ];
  const rows = groups.flatMap(([label, items]) => items.map((item) => `${label} #${item.id} · ${item.name}`));
  rows.push(...skill.dependencies.plugins.map((item) => `${t('assets.plugin')} · ${item}`));
  rows.push(...skill.dependencies.resources.map((item) => `${t('assets.resource')} · ${item}`));
  return rows;
}

function skillEffects(): string[] {
  const effects = selectedSkill.value?.skill.effects;
  if (!Array.isArray(effects) || !effects.length) return [t('assets.noEffects')];
  return effects.map((effect, index) => {
    if (!effect || typeof effect !== 'object') return t('assets.effectN', { n: index + 1 });
    const row = effect as Record<string, unknown>;
    return t('assets.effectDetail', { n: index + 1, code: Number(row.code ?? 0), dataId: Number(row.dataId ?? 0), value: Number(row.value1 ?? row.value ?? 0) });
  });
}

function categoryLabel(category: AssetLibraryCatalog['categories'][number]): string {
  return t(ASSET_CATEGORY_LABEL_KEYS[category.id] || 'assets.category.maps') || category.label;
}

function selectedCategoryLabel(): string {
  const category = categories.value.find((item) => item.id === selectedCategory.value);
  return category ? categoryLabel(category) : '';
}

function mapTagsLabel(tags: readonly string[]): string {
  return tags.length ? tags.join(t('assets.tagSeparator')) : t('commonEvent.none');
}


function formatErrorText(errorValue: unknown): string {
  return formatUserFacingErrorMessage(errorValue, 'general', language.value);
}

function formatAssetImportIssues(issues: string[]): string {
  return [t('assets.precheckFailed'), ...issues.map((issue) => translateAssetImportIssue(issue, language.value))].join('\n');
}
</script>

<template>
  <div class="console-subpage">
    <div v-if="error" class="state error">{{ formatErrorText(error) }}</div>
    <div v-else-if="loading" class="state">{{ t('assets.loadingLibrary') }}</div>
    <div v-else class="library-layout">
      <aside class="library-categories">
        <div class="console-panel-title">{{ t('assets.categories') }}</div>
        <div class="category-list">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="category-button"
            :class="{ active: category.id === selectedCategory }"
            @click="selectedCategory = category.id"
          >
            <component :is="categoryIcons[category.id]" />
            <span>{{ categoryLabel(category) }}</span>
            <b>{{ category.count }}</b>
          </button>
        </div>
        <div v-if="showFolderPane" class="folder-pane">
          <button type="button" class="folder-pane-toggle" @click="toggleFoldersPane">
            <el-icon :class="{ collapsed: !foldersPaneExpanded }"><ArrowRight /></el-icon>
            <span>{{ t('assets.source') }}</span>
            <b>{{ folderCounts.all ?? 0 }}</b>
          </button>
          <div v-show="foldersPaneExpanded" class="folder-tree-wrap">
            <el-tree
              ref="folderTreeRef"
              :data="folderTreeData"
              node-key="id"
              :props="{ label: 'label' }"
              highlight-current
              :expand-on-click-node="false"
              :current-node-key="selectedFolderId"
              @node-click="selectFolder($event.id)"
              @node-contextmenu="onFolderContextMenu"
            >
              <template #default="{ data }">
                <span class="folder-node" :title="formatFolderLabel(data)">
                  <span>{{ data.label }}</span>
                  <small>{{ data.count }}</small>
                </span>
              </template>
            </el-tree>
          </div>
        </div>
      </aside>

      <section class="library-list">
        <div class="console-list-header">
          <div class="list-heading">
            <strong>
              {{ selectedCategoryLabel() }}
              <template v-if="selectedFolderId !== 'all'">
                · {{ categoryFolders.find((folder) => folder.id === selectedFolderId)?.label }}
              </template>
            </strong>
            <small>{{ t('story.itemCount', { count: filteredEntries.length }) }}</small>
          </div>
          <ConsoleSearchInput v-model="search" :placeholder="searchPlaceholder" />
        </div>
        <div class="entry-list">
          <div v-if="usesGrid" class="asset-grid">
            <button
              v-for="entry in visibleEntries"
              :key="entry.assetId"
              type="button"
              class="asset-card"
              :class="{ active: selectedEntry?.assetId === entry.assetId }"
              @click="openEntry(entry)"
            >
              <span class="asset-thumb" :class="previewClass(entry)">
                <img
                  v-if="entryPreviewUrl(entry)"
                  :src="entryPreviewUrl(entry)"
                  :alt="entry.name"
                >
                <component v-else :is="categoryIcons[entry.category]" />
              </span>
              <span class="asset-card-copy">
                <strong>{{ entry.name }}</strong>
                <small>{{ entrySource(entry) }}</small>
              </span>
              <em>{{ entryBadge(entry) }}</em>
            </button>
          </div>
          <template v-else>
            <button
              v-for="entry in visibleEntries"
              :key="entry.assetId"
              type="button"
              class="entry-button"
              :class="{ active: selectedEntry?.assetId === entry.assetId }"
              @click="openEntry(entry)"
            >
              <span class="entry-icon"><component :is="categoryIcons[entry.category]" /></span>
              <span class="entry-copy">
                <strong>{{ entry.name }}</strong>
                <small>{{ entryMeta(entry) }}</small>
              </span>
              <em>{{ entrySource(entry) }}</em>
            </button>
          </template>
          <button
            v-if="visibleEntries.length < filteredEntries.length"
            type="button"
            class="load-more"
            @click="visibleLimit += 250"
          >
            {{ t('story.showMore', { count: Math.min(250, filteredEntries.length - visibleEntries.length) }) }}
          </button>
          <div v-if="listEmptyMessage" class="empty">{{ listEmptyMessage }}</div>
        </div>
      </section>

      <aside class="library-detail">
        <div class="console-panel-title">{{ t('assets.details') }}</div>
        <div v-if="detailLoading" class="state">{{ t('assets.loadingDetails') }}</div>
        <div v-else-if="!selectedEntry" class="empty">{{ t('assets.selectHint') }}</div>
        <div v-else class="detail-scroll">
          <div class="detail-preview" :class="selectedEntry ? previewClass(selectedEntry) : {}">
            <img v-if="isImage && selectedFile" :src="selectedFile.url" :alt="selectedFile.name">
            <audio v-else-if="isAudio && selectedFile" :src="selectedFile.url" controls />
            <video v-else-if="isVideo && selectedFile" :src="selectedFile.url" controls />
            <img v-else-if="selectedMap && selectedMap.screenshotUrl" :src="selectedMap.screenshotUrl" :alt="selectedMap.title">
            <component v-else :is="categoryIcons[selectedEntry.category]" />
          </div>

          <div class="detail-heading">
            <strong>{{ selectedEntry.name }}</strong>
            <small>{{ entrySource(selectedEntry) }}</small>
          </div>

          <dl v-if="selectedFile" class="facts">
            <dt>{{ t('eventEditorDialog.type') }}</dt><dd>{{ selectedFile.subtype }} · {{ selectedFile.format.toUpperCase() }}</dd>
            <dt>{{ t('plugins.file') }}</dt><dd>{{ selectedFile.fileName }}</dd>
            <dt>{{ t('assets.size') }}</dt><dd>{{ formatSize(selectedFile.size) }}</dd>
            <dt>{{ t('assets.source') }}</dt><dd>{{ selectedFile.sourceSlug }}</dd>
            <dt>{{ t('assets.libraryPath') }}</dt><dd>{{ selectedFile.relativePath }}</dd>
          </dl>
          <div v-if="selectedPreviewSlices.length && selectedFile" class="slice-panel">
            <strong>{{ t('assets.slicePreview') }}</strong>
            <div class="slice-grid" :class="selectedFile.subtype">
              <span v-for="slice in selectedPreviewSlices" :key="slice.className" class="slice-cell">
                <span class="slice-thumb" :class="slice.className">
                  <img :src="selectedFile.url" :alt="slice.label">
                </span>
                <small>{{ slice.label }}</small>
              </span>
            </div>
          </div>

          <template v-else-if="selectedMap">
            <dl class="facts">
              <dt>{{ t('assets.dimensions') }}</dt><dd>{{ selectedMap.map?.width || t('plugins.unknown') }} × {{ selectedMap.map?.height || t('plugins.unknown') }}</dd>
              <dt>{{ t('assets.tileset') }}</dt><dd>{{ selectedMap.map?.tilesetName || `#${selectedMap.map?.tilesetId ?? t('plugins.unknown')}` }}</dd>
              <dt>{{ t('assets.sourcePack') }}</dt><dd>{{ selectedMap.packageLabel }}</dd>
              <dt>{{ t('assets.tags') }}</dt><dd>{{ mapTagsLabel(selectedMap.tags) }}</dd>
              <dt>{{ t('assets.dependencies') }}</dt><dd>{{ t('assets.dependencyCount', { count: Object.values(selectedMap.dependencies).reduce<number>((sum, value) => sum + Number(value || 0), 0) }) }}</dd>
            </dl>
            <div v-if="translatedKnownIssues.length" class="detail-block warning">
              <strong>{{ t('assets.knownIssues') }}</strong>
              <span v-for="issue in translatedKnownIssues" :key="issue">{{ issue }}</span>
            </div>
          </template>

          <template v-else-if="selectedSkill">
            <p class="skill-description">{{ String(skillValue('description') || t('plugins.noDescription')) }}</p>
            <dl class="facts">
              <dt>MP / TP</dt><dd>{{ skillValue('mpCost') || 0 }} / {{ skillValue('tpCost') || 0 }}</dd>
              <dt>{{ t('assets.scope') }}</dt><dd>#{{ skillValue('scope') }}</dd>
              <dt>{{ t('assets.damageFormula') }}</dt><dd><code>{{ skillDamage('formula') || t('commonEvent.none') }}</code></dd>
              <dt>{{ t('assets.animation') }}</dt><dd>#{{ skillValue('animationId') || 0 }}</dd>
              <dt>{{ t('assets.successRate') }}</dt><dd>{{ skillValue('successRate') }}%</dd>
              <dt>{{ t('eventEditorDialog.note') }}</dt><dd>{{ skillValue('note') || t('commonEvent.none') }}</dd>
            </dl>
            <div class="detail-block">
              <strong>{{ t('assets.additionalEffects') }}</strong>
              <span v-for="effect in skillEffects()" :key="effect">{{ effect }}</span>
            </div>
            <div class="detail-block">
              <strong>{{ t('assets.importDeps') }}</strong>
              <span v-for="row in dependencyRows(selectedSkill)" :key="row">{{ row }}</span>
            </div>
          </template>

          <div v-if="actionError" class="action-status error">{{ formatErrorText(actionError) }}</div>
          <div v-if="actionMessage" class="action-status success">{{ actionMessage }}</div>
          <button type="button" class="import-button" :disabled="actionBusy" @click="importSelected">
            {{ actionBusy ? t('assets.validatingImport') : t('assets.importCurrent') }}
          </button>
        </div>
      </aside>
    </div>

    <teleport to="body">
      <div
        v-if="folderContext.visible"
        class="ctx-mask"
        :style="{ zIndex: contextMenuZ }"
        @mousedown.self="closeFolderContext"
        @contextmenu.prevent="closeFolderContext"
      >
        <ul class="ctx-menu" :style="{ left: `${folderContext.x}px`, top: `${folderContext.y}px` }">
          <li @click="openFolderImportDialog">{{ t('assets.importAllMaps', { count: folderContext.count }) }}</li>
        </ul>
      </div>
    </teleport>

    <el-dialog
      v-model="importDialog.visible"
      :title="t('assets.bulkImportMaps')"
      width="440px"
      :close-on-click-modal="false"
      :show-close="!importDialog.busy"
      :close-on-press-escape="!importDialog.busy"
      @close="closeImportDialog"
    >
      <p class="import-dialog-lead">
        {{ t('assets.sourceColon') }}<strong>{{ importDialog.folderLabel }}</strong>{{ t('assets.mapCount', { count: importDialog.count }) }}
      </p>
      <el-checkbox v-model="importDialog.includeEvents" :disabled="importDialog.busy">
        {{ t('assets.keepSourceEvents') }}
      </el-checkbox>
      <div class="import-dialog-field">
        <label>{{ t('assets.attachParent') }}</label>
        <el-select
          v-model="importDialog.parentMapId"
          filterable
          :loading="importDialog.parentMapLoading"
          :disabled="importDialog.busy"
          style="width: 100%"
        >
          <el-option
            v-for="option in importDialog.parentMapOptions"
            :key="option.id"
            :label="option.label"
            :value="option.id"
          />
        </el-select>
      </div>
      <div v-if="importDialog.validation && importDialog.validation.issues.length" class="import-dialog-warn">
        {{ t('assets.precheckIssues', { count: importDialog.validation.issues.length }) }}
      </div>
      <div v-if="importDialog.error" class="import-dialog-error">{{ formatErrorText(importDialog.error) }}</div>
      <template #footer>
        <el-button size="small" :disabled="importDialog.busy" @click="closeImportDialog">{{ t('eventcmd.cancel') }}</el-button>
        <el-button size="small" type="primary" :loading="importDialog.busy" @click="runFolderImport">
          {{ importDialog.busy ? t('assets.importing') : t('assets.startImport') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.library-layout{height:100%;min-height:0;display:grid;grid-template-columns:200px minmax(320px,1fr) minmax(300px,38%);gap:22px;padding:14px 40px 34px}
.library-categories,.library-list,.library-detail{min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--console-border,#e4dcce);border-radius:14px;background:var(--console-paper,#fffdfa);box-shadow:none}
.console-panel-title{height:44px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid var(--console-border,#e4dcce);background:var(--console-paper,#fffdfa);color:var(--console-text-soft,#5a5247);font-size:12px;font-weight:650}
.category-list,.folder-tree-wrap,.entry-list,.detail-scroll{min-height:0;overflow:auto}
.category-list{flex:0 0 auto;padding:8px}
.folder-pane{min-height:0;display:flex;flex:1;flex-direction:column;border-top:1px solid var(--console-border,#e4dcce);overflow:hidden}
.folder-pane-toggle{width:100%;height:34px;display:flex;align-items:center;gap:6px;padding:0 10px;border:0;background:transparent;color:var(--console-text-muted,#9a8e7e);font:inherit;font-size:10.5px;font-weight:650;cursor:pointer}
.folder-pane-toggle:hover{background:#f1e9db;color:var(--console-text-soft,#5a5247)}.folder-pane-toggle b{margin-left:auto;color:var(--console-text-faint,#b3a795);font-size:10px;font-weight:500}
.folder-pane-toggle .el-icon{width:12px;transition:transform .15s ease}.folder-pane-toggle .el-icon.collapsed{transform:rotate(0deg)}.folder-pane-toggle .el-icon:not(.collapsed){transform:rotate(90deg)}
.folder-tree-wrap{flex:1;padding:4px 6px 8px}
.folder-tree-wrap :deep(.el-tree){--el-tree-node-content-height:30px;background:transparent}
.folder-tree-wrap :deep(.el-tree-node__content){border-radius:var(--app-radius-sm);font-size:10.5px}
.folder-tree-wrap :deep(.el-tree-node.is-current > .el-tree-node__content){background:var(--console-accent-soft,#f6e3d7);color:var(--console-accent,#be5630)}
.folder-node{min-width:0;display:flex;align-items:center;gap:6px}.folder-node span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.folder-node small{margin-left:auto;color:var(--app-ink-muted);font-size:9.5px}
.category-button{width:100%;height:34px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;border-radius:9px;background:transparent;color:var(--console-text-soft,#5a5247);font:inherit;font-size:11px;cursor:pointer}
.category-button:hover,.category-button.active{background:var(--console-accent-soft,#f6e3d7);color:var(--console-accent,#be5630)}.category-button.active{font-weight:650}.category-button :deep(svg){width:14px}.category-button b{margin-left:auto;color:var(--console-text-faint,#b3a795);font-size:10px}
.category-button:focus-visible,.entry-button:focus-visible,.asset-card:focus-visible,.folder-pane-toggle:focus-visible,.import-button:focus-visible{outline:none;box-shadow:var(--app-ring)}
.list-heading{min-width:0;display:flex;flex-direction:column;gap:2px}.list-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.list-heading small{color:var(--console-text-muted,#9a8e7e);font-size:10px;font-weight:500}
.entry-list{padding:8px}.entry-button{width:100%;display:flex;align-items:center;gap:9px;padding:8px;border:0;border-radius:9px;background:transparent;color:var(--console-text,#211d17);font:inherit;text-align:left;cursor:pointer}.entry-button:hover,.entry-button.active{background:#fbf1e9}.entry-button.active{box-shadow:inset 3px 0 var(--console-accent,#be5630)}
.entry-icon{width:30px;height:30px;display:grid;place-items:center;flex:0 0 30px;border-radius:8px;background:#f2eadc;color:var(--console-accent,#be5630)}.entry-icon :deep(svg){width:15px}.entry-copy{min-width:0;display:flex;flex:1;flex-direction:column}.entry-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.entry-copy small,.entry-button em{overflow:hidden;color:var(--console-text-muted,#9a8e7e);font-size:9.5px;font-style:normal;text-overflow:ellipsis;white-space:nowrap}.entry-button em{max-width:30%}
.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.asset-card{position:relative;min-width:0;display:flex;min-height:166px;flex-direction:column;gap:8px;padding:8px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--console-text,#211d17);font:inherit;text-align:left;cursor:pointer}
.asset-card:hover{background:#fbf1e9}.asset-card.active{border-color:var(--console-accent,#be5630);background:#fff7ef;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--console-accent,#be5630) 35%,transparent)}
.asset-thumb{height:104px;display:grid;place-items:center;overflow:hidden;border:1px solid #eadfce;border-radius:8px;background:#f6efe4;color:var(--console-accent,#be5630)}
.asset-thumb.checker,.detail-preview.checker,.slice-thumb{background-color:#f5efe6;background-image:linear-gradient(45deg,#ded6c8 25%,transparent 25%),linear-gradient(-45deg,#ded6c8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ded6c8 75%),linear-gradient(-45deg,transparent 75%,#ded6c8 75%);background-position:0 0,0 6px,6px -6px,-6px 0;background-size:12px 12px}
.asset-thumb img{width:100%;height:100%;display:block}.asset-thumb.cover img{object-fit:cover}.asset-thumb.contain img{object-fit:contain;padding:6px}.asset-thumb.pixel img,.detail-preview.pixel img,.slice-thumb img{image-rendering:pixelated;image-rendering:crisp-edges}
.asset-thumb :deep(svg){width:26px}.asset-card-copy{min-width:0;display:flex;flex-direction:column;gap:2px}.asset-card-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.asset-card-copy small{overflow:hidden;color:var(--console-text-muted,#9a8e7e);font-size:9.5px;text-overflow:ellipsis;white-space:nowrap}.asset-card em{position:absolute;top:14px;right:14px;max-width:78px;overflow:hidden;padding:2px 6px;border:1px solid rgba(150,118,82,.24);border-radius:999px;background:rgba(255,253,250,.88);color:var(--console-text-soft,#5a5247);font-size:9px;font-style:normal;text-overflow:ellipsis;white-space:nowrap}
.load-more{width:100%;padding:9px;border:0;background:transparent;color:var(--console-accent,#be5630);font:inherit;font-size:11px;cursor:pointer}.empty,.state{display:grid;place-items:center;min-height:100px;padding:20px;color:var(--console-text-muted,#9a8e7e);font-size:11px;text-align:center}.state{flex:1}.state.error{color:var(--app-danger)}
.detail-scroll{padding:12px}.detail-preview{min-height:150px;max-height:310px;display:grid;place-items:center;overflow:auto;border:1px solid #eadfce;border-radius:11px;background:var(--console-paper-soft,#faf5ec);color:var(--console-text-muted,#9a8e7e)}.detail-preview img,.detail-preview video{max-width:100%;max-height:300px}.detail-preview.cover img{width:100%;height:100%;object-fit:contain}.detail-preview audio{width:90%}.detail-preview :deep(svg){width:36px}
.detail-heading{display:flex;flex-direction:column;margin:13px 0 10px}.detail-heading strong{font-size:14px}.detail-heading small{color:var(--console-text-muted,#9a8e7e);font-size:10px}.facts{display:grid;grid-template-columns:68px minmax(0,1fr);gap:7px 10px;margin:0;padding:11px;border-radius:9px;background:var(--console-paper-soft,#faf5ec);font-size:10.5px}.facts dt{color:var(--console-text-muted,#9a8e7e)}.facts dd{margin:0;word-break:break-word}.facts code{white-space:pre-wrap;color:var(--console-text,#211d17)}
.slice-panel{display:grid;gap:8px;margin-top:10px;padding:10px;border:1px solid var(--console-border,#e4dcce);border-radius:9px;background:var(--console-paper,#fffdfa)}.slice-panel>strong{font-size:11px}.slice-grid{display:grid;gap:7px}.slice-grid.faces{grid-template-columns:repeat(4,minmax(0,1fr))}.slice-grid.characters,.slice-grid.svActors{grid-template-columns:repeat(4,minmax(0,1fr))}.slice-cell{min-width:0;display:grid;gap:4px}.slice-cell small{overflow:hidden;color:var(--console-text-muted,#9a8e7e);font-size:9px;text-align:center;text-overflow:ellipsis;white-space:nowrap}.slice-thumb{height:48px;display:block;overflow:hidden;border:1px solid #e5d8c4;border-radius:6px}.slice-thumb img{width:100%;height:100%;display:block;object-fit:cover}.slice-thumb.face-0 img{object-position:0 0}.slice-thumb.face-1 img{object-position:33.333% 0}.slice-thumb.face-2 img{object-position:66.666% 0}.slice-thumb.face-3 img{object-position:100% 0}.slice-thumb.face-4 img{object-position:0 100%}.slice-thumb.face-5 img{object-position:33.333% 100%}.slice-thumb.face-6 img{object-position:66.666% 100%}.slice-thumb.face-7 img{object-position:100% 100%}.slice-thumb.dir-0 img{object-position:50% 0}.slice-thumb.dir-1 img{object-position:50% 33.333%}.slice-thumb.dir-2 img{object-position:50% 66.666%}.slice-thumb.dir-3 img{object-position:50% 100%}.slice-thumb.sv-0 img{object-position:0 0}.slice-thumb.sv-1 img{object-position:20% 0}.slice-thumb.sv-2 img{object-position:40% 0}.slice-thumb.sv-3 img{object-position:60% 0}.slice-thumb.sv-4 img{object-position:80% 0}.slice-thumb.sv-5 img{object-position:100% 0}
.skill-description{margin:0 0 10px;color:var(--app-ink-soft);font-size:11px;line-height:1.65}.detail-block{display:flex;flex-direction:column;gap:4px;margin-top:10px;padding:10px;border:1px solid var(--app-border);border-radius:var(--app-radius-md);font-size:10px}.detail-block strong{margin-bottom:2px;font-size:11px}.detail-block span{color:var(--app-ink-soft)}.detail-block.warning{border-color:var(--app-warn);background:var(--app-warn-soft)}
.action-status{margin-top:10px;padding:8px;border-radius:9px;white-space:pre-wrap;font-size:10px}.action-status.error{background:var(--app-danger-soft);color:var(--app-danger)}.action-status.success{background:var(--app-ok-soft);color:var(--app-ok)}.import-button{width:100%;height:36px;margin-top:12px;border:0;border-radius:10px;background:var(--console-accent,#be5630);color:white;font:inherit;font-size:11px;font-weight:750;cursor:pointer}.import-button:hover{background:var(--console-accent-hover,#a8481f)}.import-button:disabled{cursor:wait;opacity:.55}
.ctx-mask{position:fixed;inset:0}.ctx-menu{position:fixed;min-width:200px;margin:0;padding:4px 0;border:1px solid var(--app-border);border-radius:var(--app-radius-md);background:var(--el-bg-color-overlay);box-shadow:var(--app-shadow-overlay);color:var(--app-ink);font-size:12px;list-style:none}.ctx-menu li{padding:6px 14px;cursor:pointer;white-space:nowrap}.ctx-menu li:hover{background:var(--app-bg-sunken)}
.import-dialog-lead{margin:0 0 14px;font-size:12px;line-height:1.6;color:var(--console-text,#211d17)}.import-dialog-field{display:flex;flex-direction:column;gap:6px;margin-top:14px}.import-dialog-field label{font-size:11px;color:var(--console-text-soft,#5a5247)}.import-dialog-warn{margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--app-warn-soft);color:var(--app-warn);font-size:10px}.import-dialog-error{margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--app-danger-soft);color:var(--app-danger);white-space:pre-wrap;font-size:10px}
@media(max-width:1100px){.library-layout{grid-template-columns:170px minmax(280px,1fr) minmax(270px,36%)}}
</style>
