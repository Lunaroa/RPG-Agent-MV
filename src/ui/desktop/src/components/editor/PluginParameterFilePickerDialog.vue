<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="sub-overlay editor-modal-overlay"
      :data-editor-dialog-layer="LAYER_Z.subDialog"
      @mousedown.self="close"
    >
      <section
        class="sub-dialog plugin-file-dialog editor-modal-shell"
        :class="{
          'plugin-file-list-dialog': viewMode === 'list',
          'plugin-file-gallery-dialog': viewMode === 'gallery',
        }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-file-picker-title"
      >
        <header class="editor-modal-header">
          <strong id="plugin-file-picker-title" class="editor-modal-title">{{ title }}</strong>
          <button
            type="button"
            class="editor-modal-close"
            :aria-label="t('pluginFilePicker.closeTitle')"
            :title="t('eventcmd.close')"
            @click="close"
          >×</button>
        </header>

        <p class="directory-hint" :title="directoryHint">
          {{ directoryHint }}
        </p>

        <div class="picker-grid">
          <aside class="file-browser" :class="viewMode">
            <div class="browser-toolbar">
              <label class="file-search">
                <Search aria-hidden="true" />
                <input
                  v-model="search"
                  type="search"
                  :placeholder="t('pluginFilePicker.searchPlaceholder')"
                  :aria-label="t('pluginFilePicker.searchPlaceholder')"
                />
              </label>
              <div class="view-switch" role="group" :aria-label="t('pluginFilePicker.viewMode')">
                <button
                  type="button"
                  :class="{ active: viewMode === 'list' }"
                  :aria-label="t('pluginFilePicker.listView')"
                  :title="t('pluginFilePicker.listView')"
                  :aria-pressed="viewMode === 'list'"
                  @click="setViewMode('list')"
                >
                  <List aria-hidden="true" />
                </button>
                <button
                  type="button"
                  :class="{ active: viewMode === 'gallery' }"
                  :aria-label="t('pluginFilePicker.galleryView')"
                  :title="t('pluginFilePicker.galleryView')"
                  :aria-pressed="viewMode === 'gallery'"
                  @click="setViewMode('gallery')"
                >
                  <Grid aria-hidden="true" />
                </button>
              </div>
            </div>

            <div v-if="viewMode === 'list'" class="file-tree">
              <button
                type="button"
                class="tree-row file-row"
                :class="{ active: !name }"
                @click="selectAsset('')"
              >
                {{ t('pluginFilePicker.none') }}
              </button>
              <PluginFileTreeNodes
                :nodes="treeNodes"
                :depth="0"
                :expanded-ids="expandedFolderIds"
                :selected-name="name"
                :current-path="currentPath"
                @activate-folder="activateFolder"
                @select-file="selectAsset"
                @confirm-file="confirmAsset"
              />
              <p v-if="!treeNodes.length" class="browser-empty">
                {{ t('pluginFilePicker.noMatches') }}
              </p>
            </div>

            <div v-else ref="galleryEl" class="file-gallery" tabindex="0">
              <button
                type="button"
                class="gallery-card none-card"
                :class="{ active: galleryFocusId === PLUGIN_FILE_GALLERY_NONE_ID }"
                data-gallery-id="__none__"
                @click="selectAsset('')"
              >
                <span class="gallery-preview empty-preview" aria-hidden="true"><Close /></span>
                <span class="gallery-copy"><strong>{{ t('pluginFilePicker.none') }}</strong></span>
              </button>
              <button
                v-for="entry in galleryEntries"
                :key="`${entry.kind}:${entry.id}`"
                type="button"
                class="gallery-card"
                :class="{
                  active: galleryFocusId === entry.id,
                  'folder-card': entry.kind === 'folder' || entry.kind === 'parent',
                }"
                :data-gallery-id="entry.id"
                :title="entry.kind === 'file' ? entry.asset.name : entry.label"
                :aria-label="entry.kind === 'file' ? entry.asset.name : entry.label"
                @click="onGalleryClick(entry)"
                @dblclick.prevent="onGalleryDblclick(entry)"
              >
                <span class="gallery-preview" :class="{ 'folder-preview': entry.kind !== 'file' }">
                  <template v-if="entry.kind === 'parent'">
                    <PluginFileFolderThumb :urls="[]" />
                  </template>
                  <template v-else-if="entry.kind === 'folder'">
                    <PluginFileFolderThumb :urls="entry.previewUrls" />
                  </template>
                  <template v-else-if="media === 'image'">
                    <img
                      v-if="entry.asset.url && !failedImageUrls.has(entry.asset.url)"
                      :src="entry.asset.url"
                      :alt="entry.label"
                      loading="lazy"
                      decoding="async"
                      @error="markImageFailed(entry.asset.url)"
                    />
                    <span v-else class="preview-failed" role="img" :aria-label="t('pluginFilePicker.previewFailed')">
                      <WarningFilled aria-hidden="true" />
                    </span>
                  </template>
                  <template v-else>
                    <Document aria-hidden="true" />
                  </template>
                </span>
                <span class="gallery-copy"><strong>{{ entry.label }}</strong></span>
              </button>
              <p v-if="!galleryEntries.length" class="browser-empty">
                {{ t('pluginFilePicker.noMatches') }}
              </p>
            </div>
          </aside>

          <main
            class="preview-surface"
            :class="{ 'is-panning': isPanning || spaceHeld }"
            @wheel.prevent="onPreviewWheel"
            @pointerdown="onPreviewPointerDown"
            @pointermove="onPreviewPointerMove"
            @pointerup="onPreviewPointerUp"
            @pointercancel="onPreviewPointerUp"
            @auxclick.prevent
          >
            <div class="preview-scroll" ref="previewScrollEl">
              <div
                v-if="media === 'image' && selectedAsset && previewUrl"
                class="image-zoom-space"
                :style="{
                  width: `${Math.ceil(imageNaturalWidth * previewZoom)}px`,
                  height: `${Math.ceil(imageNaturalHeight * previewZoom)}px`,
                  transform: `translate(${previewPanX}px, ${previewPanY}px)`,
                }"
              >
                <img
                  :src="previewUrl"
                  :alt="selectedAsset.name"
                  :style="{ transform: `scale(${previewZoom})`, transformOrigin: '0 0' }"
                  draggable="false"
                  @load="onImageLoad"
                  @error="onPreviewImageError"
                />
              </div>
              <audio
                v-else-if="media === 'audio' && previewUrl"
                :key="previewUrl"
                class="audio-preview"
                :src="previewUrl"
                controls
                preload="auto"
              />
              <video
                v-else-if="media === 'movie' && previewUrl"
                :key="previewUrl"
                class="movie-preview"
                :src="previewUrl"
                controls
                preload="metadata"
              />
              <p v-else-if="selectedAsset" class="plain-preview">
                {{ previewFailed ? t('pluginFilePicker.previewFailed') : selectedAsset.name }}
              </p>
              <p v-else class="plain-preview">
                {{ t('pluginFilePicker.none') }}
              </p>
            </div>
            <div
              v-if="media === 'image' && selectedAsset && previewUrl"
              class="picker-zoom"
              :aria-label="t('pluginFilePicker.previewZoom')"
            >
              <button type="button" :title="t('editor.view.zoomOut')" @click="zoomOut">−</button>
              <button type="button" :title="t('pluginFilePicker.resetZoom')" @click="resetZoom">
                {{ Math.round(previewZoom * 100) }}%
              </button>
              <button type="button" :title="t('editor.view.zoomIn')" @click="zoomIn">+</button>
            </div>
          </main>
        </div>

        <footer class="editor-modal-footer">
          <span class="editor-dialog-status">{{ summary }}</span>
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Close, Document, Grid, List, Search, WarningFilled } from '@element-plus/icons-vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { resolveAssetUrl } from '../../api/client';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type {
  PluginFileAssetOption,
  PluginFileMediaKind,
} from '../../utils/pluginParameterFileAssets';
import {
  ancestorPluginFileFolderPaths,
  buildPluginFileTree,
  filterPluginFileAssetsByQuery,
  folderPathOfAssetName,
  getRuntimePluginFileBrowserViewMode,
  listPluginFileGalleryEntries,
  buildPluginFileGalleryNavIds,
  movePluginFileGalleryNavIndex,
  normalizePluginFileBrowsePath,
  parentPluginFileBrowsePath,
  PLUGIN_FILE_GALLERY_NONE_ID,
  resolvePluginFileGalleryColumnCount,
  resolvePluginFileGalleryFocusId,
  setRuntimePluginFileBrowserViewMode,
  type PluginFileBrowserViewMode,
  type PluginFileGalleryEntry,
} from '../../utils/pluginParameterFileBrowser';
import PluginFileTreeNodes from './PluginFileTreeNodes.vue';
import PluginFileFolderThumb from './PluginFileFolderThumb.vue';

const props = defineProps<{
  title?: string;
  directory: string;
  media: PluginFileMediaKind;
  assets: PluginFileAssetOption[];
  folders?: string[];
}>();

const emit = defineEmits<{ commit: [name: string] }>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const search = ref('');
const name = ref('');
const currentPath = ref('');
const expandedFolderIds = ref<Set<string>>(new Set());
const viewMode = ref<PluginFileBrowserViewMode>(getRuntimePluginFileBrowserViewMode());
const galleryFocusId = ref(PLUGIN_FILE_GALLERY_NONE_ID);
const galleryEl = ref<HTMLElement | null>(null);
const previewScrollEl = ref<HTMLElement | null>(null);
const failedImageUrls = ref(new Set<string>());
const previewZoom = ref(1);
const previewPanX = ref(0);
const previewPanY = ref(0);
const previewUrl = ref('');
const imageNaturalWidth = ref(320);
const imageNaturalHeight = ref(240);
const previewFailed = ref(false);
const spaceHeld = ref(false);
const isPanning = ref(false);
let panPointerId: number | null = null;
let panOriginX = 0;
let panOriginY = 0;
let panStartX = 0;
let panStartY = 0;
const PREVIEW_ZOOM_MIN = 0.25;
const PREVIEW_ZOOM_MAX = 4;

const title = computed(() => props.title || t('pluginFilePicker.title'));
const filteredAssets = computed(() => filterPluginFileAssetsByQuery(props.assets, search.value));
const filteredFolders = computed(() => {
  const query = search.value.trim().toLowerCase();
  const folders = props.folders || [];
  if (!query) return folders;
  return folders.filter((folder) => folder.toLowerCase().includes(query));
});
const treeNodes = computed(() => buildPluginFileTree(filteredAssets.value, filteredFolders.value));
const galleryEntries = computed(() =>
  listPluginFileGalleryEntries(filteredAssets.value, currentPath.value, {
    parentLabel: t('pluginFilePicker.parentFolder'),
    folders: filteredFolders.value,
  }),
);
const galleryNavIds = computed(() => buildPluginFileGalleryNavIds(galleryEntries.value));
const selectedAsset = computed(() =>
  props.assets.find((asset) => asset.name === name.value) || null,
);
const summary = computed(() =>
  name.value ? name.value : t('pluginFilePicker.none'),
);
const directoryHint = computed(() => {
  const base = t('pluginFilePicker.directory', { directory: props.directory });
  if (!currentPath.value) return base;
  return `${base} / ${currentPath.value}`;
});

watch(selectedAsset, (asset) => {
  previewPanX.value = 0;
  previewPanY.value = 0;
  void refreshPreview(asset);
});

watch(
  () => [visible.value, viewMode.value, name.value, currentPath.value, galleryNavIds.value.join('\0')] as const,
  () => {
    if (!visible.value || viewMode.value !== 'gallery') return;
    if (!galleryNavIds.value.includes(galleryFocusId.value)) {
      galleryFocusId.value = resolvePluginFileGalleryFocusId(name.value, galleryEntries.value);
    }
  },
);

function onKeyDown(event: KeyboardEvent) {
  if (!visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    spaceHeld.value = true;
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (viewMode.value === 'gallery') {
    if (
      event.key === 'ArrowLeft'
      || event.key === 'ArrowRight'
      || event.key === 'ArrowUp'
      || event.key === 'ArrowDown'
    ) {
      event.preventDefault();
      moveGalleryFocus(event.key);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activateGalleryFocus();
    }
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceHeld.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
});

function open(currentName = '') {
  const normalized = normalizePluginFileBrowsePath(currentName);
  name.value = normalized;
  search.value = '';
  previewZoom.value = 1;
  previewPanX.value = 0;
  previewPanY.value = 0;
  failedImageUrls.value = new Set();
  currentPath.value = folderPathOfAssetName(normalized);
  expandedFolderIds.value = new Set(ancestorPluginFileFolderPaths(normalized));
  viewMode.value = getRuntimePluginFileBrowserViewMode();
  visible.value = true;
  void nextTick(() => {
    galleryFocusId.value = resolvePluginFileGalleryFocusId(normalized, galleryEntries.value);
    void refreshPreview(selectedAsset.value);
    scrollGalleryFocusIntoView();
  });
}

function close() {
  visible.value = false;
  previewUrl.value = '';
}

function setViewMode(mode: PluginFileBrowserViewMode): void {
  viewMode.value = mode;
  setRuntimePluginFileBrowserViewMode(mode);
}

function markImageFailed(url: string): void {
  failedImageUrls.value = new Set([...failedImageUrls.value, url]);
}

function activateFolder(folderId: string): void {
  const next = new Set(expandedFolderIds.value);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  expandedFolderIds.value = next;
  currentPath.value = normalizePluginFileBrowsePath(folderId);
}

function enterFolder(folderPath: string): void {
  currentPath.value = normalizePluginFileBrowsePath(folderPath);
  const next = new Set(expandedFolderIds.value);
  for (const ancestor of ancestorPluginFileFolderPaths(`${folderPath}/x`)) {
    next.add(ancestor);
  }
  next.add(folderPath);
  expandedFolderIds.value = next;
  galleryFocusId.value = PLUGIN_FILE_GALLERY_NONE_ID;
  void nextTick(() => scrollGalleryFocusIntoView());
}

function selectAsset(value: string) {
  const normalized = normalizePluginFileBrowsePath(value);
  name.value = normalized;
  previewZoom.value = 1;
  previewPanX.value = 0;
  previewPanY.value = 0;
  galleryFocusId.value = normalized
    ? resolvePluginFileGalleryFocusId(normalized, galleryEntries.value)
    : PLUGIN_FILE_GALLERY_NONE_ID;
  if (normalized) {
    currentPath.value = folderPathOfAssetName(normalized);
    const next = new Set(expandedFolderIds.value);
    for (const ancestor of ancestorPluginFileFolderPaths(normalized)) next.add(ancestor);
    expandedFolderIds.value = next;
  }
}

function confirmAsset(value: string) {
  selectAsset(value);
  commit();
}

function onGalleryClick(entry: PluginFileGalleryEntry): void {
  if (entry.kind === 'parent') {
    galleryFocusId.value = PLUGIN_FILE_GALLERY_NONE_ID;
    currentPath.value = parentPluginFileBrowsePath(currentPath.value);
    void nextTick(() => scrollGalleryFocusIntoView());
    return;
  }
  if (entry.kind === 'folder') {
    enterFolder(entry.path);
    return;
  }
  selectAsset(entry.asset.name);
}

function onGalleryDblclick(entry: PluginFileGalleryEntry): void {
  if (entry.kind === 'file') confirmAsset(entry.asset.name);
  else onGalleryClick(entry);
}

function moveGalleryFocus(
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
): void {
  const ids = galleryNavIds.value;
  if (!ids.length) return;
  const current = Math.max(0, ids.indexOf(galleryFocusId.value));
  const nextIndex = movePluginFileGalleryNavIndex(
    current,
    key,
    resolvePluginFileGalleryColumnCount(window.innerWidth),
    ids.length,
  );
  const nextId = ids[nextIndex];
  if (!nextId || nextId === galleryFocusId.value) return;
  applyGalleryFocusId(nextId);
  scrollGalleryFocusIntoView();
}

function applyGalleryFocusId(focusId: string): void {
  galleryFocusId.value = focusId;
  if (focusId === PLUGIN_FILE_GALLERY_NONE_ID) {
    name.value = '';
    previewZoom.value = 1;
    previewPanX.value = 0;
    previewPanY.value = 0;
    return;
  }
  const entry = galleryEntries.value.find((item) => item.id === focusId);
  if (entry?.kind === 'file') {
    name.value = entry.asset.name;
    previewZoom.value = 1;
    previewPanX.value = 0;
    previewPanY.value = 0;
  }
}

function activateGalleryFocus(): void {
  const focusId = galleryFocusId.value;
  if (focusId === PLUGIN_FILE_GALLERY_NONE_ID) {
    commit();
    return;
  }
  const entry = galleryEntries.value.find((item) => item.id === focusId);
  if (!entry) return;
  if (entry.kind === 'file') {
    confirmAsset(entry.asset.name);
    return;
  }
  onGalleryClick(entry);
}

function scrollGalleryFocusIntoView(): void {
  void nextTick(() => {
    const root = galleryEl.value;
    if (!root) return;
    const focusId = galleryFocusId.value;
    const target = root.querySelector(
      focusId === PLUGIN_FILE_GALLERY_NONE_ID
        ? '[data-gallery-id="__none__"]'
        : `[data-gallery-id="${CSS.escape(focusId)}"]`,
    ) as HTMLElement | null;
    target?.scrollIntoView({ block: 'nearest' });
  });
}

async function refreshPreview(asset: PluginFileAssetOption | null) {
  previewFailed.value = false;
  if (!asset?.url) {
    previewUrl.value = '';
    return;
  }
  try {
    previewUrl.value = await resolveAssetUrl(asset.url);
  } catch {
    previewUrl.value = '';
    previewFailed.value = true;
  }
}

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  imageNaturalWidth.value = Math.max(1, image.naturalWidth || 320);
  imageNaturalHeight.value = Math.max(1, image.naturalHeight || 240);
  fitPreviewToView();
}

function onPreviewImageError() {
  previewFailed.value = true;
  previewUrl.value = '';
}

/** Fit whole image in the preview pane (min scale), never crop. */
function fitPreviewToView() {
  const scroll = previewScrollEl.value;
  const pad = 32;
  const availW = Math.max(1, (scroll?.clientWidth || 480) - pad);
  const availH = Math.max(1, (scroll?.clientHeight || 360) - pad);
  const scale = Math.min(
    1,
    availW / Math.max(1, imageNaturalWidth.value),
    availH / Math.max(1, imageNaturalHeight.value),
  );
  previewZoom.value = clampPreviewZoom(scale);
  previewPanX.value = 0;
  previewPanY.value = 0;
}

function clampPreviewZoom(value: number): number {
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value * 100) / 100));
}
function zoomIn() { previewZoom.value = clampPreviewZoom(previewZoom.value * 1.25); }
function zoomOut() { previewZoom.value = clampPreviewZoom(previewZoom.value / 1.25); }
function resetZoom() {
  previewZoom.value = 1;
  previewPanX.value = 0;
  previewPanY.value = 0;
}
function onPreviewWheel(event: WheelEvent) {
  if (event.deltaY < 0) zoomIn();
  else zoomOut();
}
function onPreviewPointerDown(event: PointerEvent) {
  if (props.media !== 'image' || !selectedAsset.value) return;
  const middle = event.button === 1;
  const spaceDrag = event.button === 0 && spaceHeld.value;
  if (!middle && !spaceDrag) return;
  event.preventDefault();
  isPanning.value = true;
  panPointerId = event.pointerId;
  panOriginX = event.clientX;
  panOriginY = event.clientY;
  panStartX = previewPanX.value;
  panStartY = previewPanY.value;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function onPreviewPointerMove(event: PointerEvent) {
  if (!isPanning.value || panPointerId !== event.pointerId) return;
  previewPanX.value = panStartX + (event.clientX - panOriginX);
  previewPanY.value = panStartY + (event.clientY - panOriginY);
}
function onPreviewPointerUp(event: PointerEvent) {
  if (panPointerId !== event.pointerId) return;
  isPanning.value = false;
  panPointerId = null;
}

function commit() {
  emit('commit', name.value);
  close();
}

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog {
  --picker-height: 610px;
  --picker-right-width: 560px;
  --dialog-width: 920px;
  --browser-width: 280px;
  width: min(var(--dialog-width), calc(100vw - 48px));
  max-height: min(86vh, 900px);
}
.plugin-file-list-dialog { --dialog-width: 900px; --browser-width: 300px; }
.plugin-file-gallery-dialog { --dialog-width: 1320px; --browser-width: 720px; }
.directory-hint {
  margin: 0;
  padding: 0 14px 8px;
  color: var(--app-ink-soft, #5a5247);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-grid {
  height: min(var(--picker-height), calc(100vh - 180px));
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, var(--browser-width)) minmax(0, var(--picker-right-width));
  flex: 0 1 var(--picker-height);
}
.file-browser {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--app-border);
  background: var(--app-bg);
}
.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--app-border);
}
.file-search {
  height: 30px;
  min-width: 0;
  display: flex;
  flex: 1;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--app-border);
  border-radius: 4px;
  background: var(--app-bg);
  color: var(--app-ink-muted);
}
.file-search:focus-within {
  border-color: var(--app-accent);
  box-shadow: 0 0 0 1px var(--app-accent);
}
.file-search :deep(svg) { width: 13px; height: 13px; }
.file-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  font-size: 11px;
}
.view-switch {
  height: 30px;
  display: flex;
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid var(--app-border);
  border-radius: 4px;
  background: var(--app-bg-soft);
}
.view-switch button {
  width: 28px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--app-ink-muted);
  cursor: pointer;
}
.view-switch button:hover { color: var(--app-ink); background: var(--app-bg); }
.view-switch button.active {
  background: var(--app-bg);
  color: var(--app-accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.view-switch :deep(svg) { width: 14px; height: 14px; }
.file-tree,
.file-gallery {
  min-height: 0;
  flex: 1;
  overflow: auto;
}
.tree-row {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 0;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
  color: var(--app-ink);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 11px;
}
.tree-row:hover { background: var(--app-bg-sunken); }
.tree-row.active {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  font-weight: 600;
}
.file-gallery {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
  padding: 8px;
}
.gallery-card {
  min-width: 0;
  display: flex;
  min-height: 148px;
  flex-direction: column;
  gap: 7px;
  padding: 7px;
  border: 1px solid var(--app-border);
  border-radius: 7px;
  background: var(--app-bg);
  color: var(--app-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.gallery-card:hover { background: var(--app-bg-soft); }
.gallery-card.active {
  border-color: var(--app-accent);
  background: var(--app-accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 35%, transparent);
}
.gallery-preview {
  height: 120px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: 5px;
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
.gallery-preview img {
  /* Fit by min(box/img) scale: whole image visible, never crop. */
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
  object-fit: contain;
  image-rendering: auto;
}
.folder-preview {
  background-image: none;
  background-color: #f7f4ee;
  color: #c9a227;
}
.folder-preview :deep(svg),
.empty-preview :deep(svg),
.preview-failed :deep(svg) {
  width: 28px;
  height: 28px;
}
.empty-preview { background-image: none; }
.preview-failed {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--app-danger-soft);
  color: var(--app-danger);
}
.gallery-copy {
  min-width: 0;
  display: block;
}
.gallery-copy strong {
  display: block;
  overflow: hidden;
  color: var(--app-ink);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.browser-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 18px 10px;
  color: var(--app-ink-muted);
  font-size: 11px;
  text-align: center;
}
.preview-surface {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: #aeb9c3;
  touch-action: none;
}
.preview-surface.is-panning,
.preview-surface.is-panning * {
  cursor: grab;
}
.preview-surface.is-panning:active,
.preview-surface.is-panning:active * {
  cursor: grabbing;
}
.preview-scroll {
  height: 100%;
  overflow: auto;
  display: grid;
  place-items: center;
}
.image-zoom-space { position: relative; flex: 0 0 auto; }
.image-zoom-space img {
  display: block;
  image-rendering: pixelated;
}
.audio-preview,
.movie-preview {
  width: min(100%, 520px);
  margin: 24px;
}
.plain-preview {
  margin: 0;
  padding: 24px;
  color: #2a3138;
  font-size: 13px;
  text-align: center;
}
.picker-zoom {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(20, 24, 29, .18);
}
.picker-zoom button {
  height: 26px;
  min-width: 28px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #3a414b;
  font: 600 11px var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  cursor: pointer;
}
.picker-zoom button:hover { background: #eef1f4; }
.picker-zoom button:focus-visible {
  outline: 2px solid var(--app-accent, #c45c26);
  outline-offset: 1px;
}
@media (max-width: 1300px) {
  .file-gallery { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 1100px) {
  .plugin-file-gallery-dialog .picker-grid {
    grid-template-columns: minmax(420px, 1fr) minmax(0, min(var(--picker-right-width), calc(100% - 420px)));
  }
  .file-gallery { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
