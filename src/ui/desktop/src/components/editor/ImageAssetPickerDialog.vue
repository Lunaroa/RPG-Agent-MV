<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog image-asset-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="image-asset-picker-title">
        <header class="editor-modal-header">
          <strong id="image-asset-picker-title" class="editor-modal-title">{{ title }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('imgPicker.closeTitle')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="picker-grid" :class="{ 'picker-grid--single': mode === 'icon' }">
          <!-- Icon indexes always reference the fixed IconSet sheet; no asset switching. -->
          <aside v-if="mode !== 'icon'">
            <input v-model="search" :placeholder="t('imgPicker.searchPlaceholder')" />
            <button type="button" :class="{ active: !name }" @click="selectAsset('')" @dblclick="confirmAsset('')">{{ t('imgPicker.none') }}</button>
            <button
              v-for="asset in filteredAssets"
              :key="asset.fileName"
              type="button"
              :class="{ active: name === asset.name }"
              @click="selectAsset(asset.name)"
              @dblclick="confirmAsset(asset.name)"
            >
              {{ asset.name }}
            </button>
          </aside>
          <main>
            <canvas v-if="mode === 'face' || mode === 'character'" ref="canvas" @click="pickCell" @dblclick="commit" />
            <div v-else-if="mode === 'icon'" class="icon-grid-main">
              <div v-if="!selectedAsset" class="icon-grid-empty">{{ t('imgPicker.iconSetMissing') }}</div>
              <div v-else class="icon-grid-scroll">
                <canvas ref="iconCanvas" @click="pickIconCell" @dblclick="commit" />
              </div>
            </div>
            <div v-else class="plain-preview">
              <img v-if="selectedAsset" :src="selectedAsset.url" :alt="selectedAsset.name" />
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
  <!-- Plain image picking delegates to the plugin-manager file picker (folder tree, list/gallery views, double-click confirm). -->
  <PluginParameterFilePickerDialog
    ref="plainPicker"
    :title="title"
    :directory="plainDirectory"
    media="image"
    :assets="plainAssets"
    :folders="plainFolders"
    @commit="commitPlainSelection"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type { EditorProjectCatalog, ProjectAssetEntry } from '../../api/client';
import { MV_FACE_COLUMNS, MV_FACE_ROWS, mvFaceIndexFromCanvasPoint, normalizeFaceSize, normalizeMvFaceIndex } from '../../utils/rmmvFace';
import { isBigCharacterName } from '../../composables/useMapRenderer';
import {
  catalogImageRootAssets,
  foldersFromAssetNames,
  PLUGIN_FILE_DIRECTORY_BUCKETS,
  resolveCatalogImageRootSelection,
  type PluginFileAssetOption,
} from '../../utils/pluginParameterFileAssets';
import PluginParameterFilePickerDialog from './PluginParameterFilePickerDialog.vue';

type ImageAssetKind = keyof EditorProjectCatalog['assets'];
type ImagePickerMode = 'plain' | 'face' | 'character' | 'icon';

interface OpenOptionsBase {
  mode?: ImagePickerMode;
  title?: string;
  name?: string;
  index?: number;
}

type OpenOptions = OpenOptionsBase & (
  | { asset: ImageAssetKind; rootDirectory?: never }
  | { asset?: never; rootDirectory: 'img' }
);

interface ImageAssetPickerSelection {
  asset: ImageAssetKind;
  mode: ImagePickerMode;
  name: string;
  index: number;
  directory: string;
}

const props = defineProps<{
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{ commit: [selection: ImageAssetPickerSelection] }>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const title = ref(t('imgPicker.chooseImage'));
const assetKind = ref<ImageAssetKind>('pictures');
const rootDirectory = ref<'img' | null>(null);
const mode = ref<ImagePickerMode>('plain');
const name = ref('');
const index = ref(0);
const search = ref('');
// Icons render 1:1 at the project's iconSize (RM default 32); never upscale.
const iconCellPx = computed(() => Math.max(1, Number(props.catalog?.iconSize) || 32));

const canvas = ref<HTMLCanvasElement>();
const iconCanvas = ref<HTMLCanvasElement>();
const plainPicker = ref<InstanceType<typeof PluginParameterFilePickerDialog> | null>(null);
let bitmap: HTMLImageElement | null = null;
const imageCache = new Map<string, HTMLImageElement | null>();

// Plain mode feeds the plugin-manager picker straight from the catalog bucket.
const assetDirectory = computed(() =>
  PLUGIN_FILE_DIRECTORY_BUCKETS.find((bucket) => bucket.key === assetKind.value)?.directory
  || `img/${String(assetKind.value)}`);
const plainDirectory = computed(() => rootDirectory.value || assetDirectory.value);
const plainAssets = computed<PluginFileAssetOption[]>(() => {
  if (rootDirectory.value === 'img') return catalogImageRootAssets(props.catalog);
  return (props.catalog?.assets[assetKind.value] || [])
    .map((asset) => ({ name: String(asset.name || '').replace(/\\/g, '/'), fileName: asset.fileName, url: asset.url }))
    .filter((asset) => Boolean(asset.name) && !asset.name.includes('..'))
    .sort((left, right) => left.name.localeCompare(right.name));
});
const plainFolders = computed(() => foldersFromAssetNames(plainAssets.value.map((asset) => asset.name)));

function iconGridLayout(): { cols: number; rows: number; nativeCellW: number; nativeCellH: number } {
  const iconSize = Math.max(1, Number(props.catalog?.iconSize) || 32);
  const w = bitmap?.naturalWidth || iconSize * 16;
  const h = bitmap?.naturalHeight || iconSize * 16;
  const cols = Math.max(1, Math.floor(w / iconSize));
  const rows = Math.max(1, Math.floor(h / iconSize));
  const nativeCellW = iconSize;
  const nativeCellH = iconSize;
  return { cols, rows, nativeCellW, nativeCellH };
}

const faceSize = computed(() => normalizeFaceSize(props.catalog?.faceSize));

const assets = computed<ProjectAssetEntry[]>(() => props.catalog?.assets[assetKind.value] || []);
const selectedAsset = computed(() => assets.value.find((asset) => asset.name === name.value) || null);
const filteredAssets = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? assets.value.filter((asset) => asset.name.toLowerCase().includes(query)) : assets.value;
});
const summary = computed(() => {
  if (!name.value) return t('imgPicker.none');
  if (mode.value === 'plain') return name.value;
  return `${name.value} #${index.value}`;
});

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function open(options: OpenOptions) {
  mode.value = options.mode || 'plain';
  title.value = options.title || t('imgPicker.chooseImage');
  rootDirectory.value = options.rootDirectory || null;
  if (options.rootDirectory === 'img') {
    if (mode.value !== 'plain') throw new Error('The img root picker only supports plain image selection.');
    const current = resolveCatalogImageRootSelection(options.name);
    if (current) assetKind.value = current.asset;
    name.value = current?.name || '';
    plainPicker.value?.open(String(options.name || ''));
    return;
  }
  assetKind.value = options.asset;
  if (mode.value === 'plain') {
    name.value = options.name || '';
    plainPicker.value?.open(String(options.name || ''));
    return;
  }
  name.value = options.name || '';
  index.value = mode.value === 'face'
    ? normalizeMvFaceIndex(options.index)
    : mode.value === 'icon'
      ? Math.max(0, Math.floor(options.index ?? 0))
      : normalizeCharacterIndex(options.index);
  search.value = '';
  visible.value = true;
  void nextTick(paint);
}

function close() {
  visible.value = false;
}

async function selectAsset(value: string) {
  name.value = value;
  index.value = 0;
  await paint();
}

async function loadSelectedBitmap(): Promise<HTMLImageElement | null> {
  const asset = selectedAsset.value;
  if (!asset) return null;
  const key = `${assetKind.value}:${asset.fileName}`;
  if (imageCache.has(key)) return imageCache.get(key) || null;
  const image = await props.loadImage(asset.url);
  imageCache.set(key, image);
  return image;
}

async function paint() {
  if (mode.value === 'plain') return;
  bitmap = await loadSelectedBitmap();
  if (mode.value === 'icon') { paintIconSheet(); return; }
  if (mode.value === 'face') paintFaceSheet();
  else paintCharacterSheet();
}

function fillCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  const el = canvas.value;
  if (!el) return null;
  el.width = width;
  el.height = height;
  const context = el.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#aeb9c3';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  return context;
}

function paintFaceSheet() {
  const width = bitmap?.naturalWidth || faceSize.value * MV_FACE_COLUMNS;
  const height = bitmap?.naturalHeight || faceSize.value * MV_FACE_ROWS;
  const context = fillCanvas(width, height);
  if (!context) return;
  if (!bitmap) return;
  context.drawImage(bitmap, 0, 0);
  context.strokeStyle = 'rgba(255,255,255,.55)';
  context.lineWidth = 1;
  for (let x = 0; x <= MV_FACE_COLUMNS; x += 1) drawLine(context, x * faceSize.value + 0.5, 0, x * faceSize.value + 0.5, height);
  for (let y = 0; y <= MV_FACE_ROWS; y += 1) drawLine(context, 0, y * faceSize.value + 0.5, width, y * faceSize.value + 0.5);
  const faceIndex = normalizeMvFaceIndex(index.value);
  context.strokeStyle = '#fff';
  context.lineWidth = 3;
  context.strokeRect(faceIndex % MV_FACE_COLUMNS * faceSize.value + 1.5, Math.floor(faceIndex / MV_FACE_COLUMNS) * faceSize.value + 1.5, faceSize.value - 3, faceSize.value - 3);
}

function paintCharacterSheet() {
  const width = bitmap?.naturalWidth || 384;
  const height = bitmap?.naturalHeight || 256;
  const context = fillCanvas(width, height);
  if (!context) return;
  if (!bitmap) return;
  context.drawImage(bitmap, 0, 0);
  const big = isBigCharacterName(name.value);
  const cols = big ? 1 : 4;
  const rows = big ? 1 : 2;
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  context.strokeStyle = 'rgba(255,255,255,.55)';
  context.lineWidth = 1;
  for (let x = 0; x <= cols; x += 1) drawLine(context, x * cellWidth + 0.5, 0, x * cellWidth + 0.5, height);
  for (let y = 0; y <= rows; y += 1) drawLine(context, 0, y * cellHeight + 0.5, width, y * cellHeight + 0.5);
  const characterIndex = big ? 0 : normalizeCharacterIndex(index.value);
  const col = characterIndex % 4;
  const row = Math.floor(characterIndex / 4);
  context.strokeStyle = '#fff';
  context.lineWidth = 3;
  context.strokeRect(col * cellWidth + 1.5, row * cellHeight + 1.5, cellWidth - 3, cellHeight - 3);
}

function paintIconSheet() {
  const { cols, rows, nativeCellW, nativeCellH } = iconGridLayout();
  const cell = iconCellPx.value;
  const canvasW = cols * cell;
  const canvasH = rows * cell;
  const el = iconCanvas.value;
  if (!el) return;
  el.width = canvasW;
  el.height = canvasH;
  const context = el.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvasW, canvasH);
  context.fillStyle = '#aeb9c3';
  context.fillRect(0, 0, canvasW, canvasH);
  context.imageSmoothingEnabled = false;
  if (bitmap) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        context.drawImage(
          bitmap,
          c * nativeCellW, r * nativeCellH, nativeCellW, nativeCellH,
          c * cell, r * cell, cell, cell,
        );
      }
    }
  }
  context.strokeStyle = 'rgba(255,255,255,.4)';
  context.lineWidth = 1;
  for (let x = 0; x <= cols; x += 1) drawLine(context, x * cell + 0.5, 0, x * cell + 0.5, canvasH);
  for (let y = 0; y <= rows; y += 1) drawLine(context, 0, y * cell + 0.5, canvasW, y * cell + 0.5);
  const selIdx = Math.max(0, Math.floor(index.value));
  const selCol = selIdx % cols;
  const selRow = Math.floor(selIdx / cols);
  context.strokeStyle = '#fff';
  context.lineWidth = 3;
  context.strokeRect(selCol * cell + 1.5, selRow * cell + 1.5, cell - 3, cell - 3);
}

function drawLine(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function pickCell(event: MouseEvent) {
  if (!bitmap || !canvas.value) return;
  const rect = canvas.value.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.value.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.value.height / rect.height;
  if (mode.value === 'face') {
    index.value = mvFaceIndexFromCanvasPoint(x, y, faceSize.value);
    paintFaceSheet();
    return;
  }
  if (isBigCharacterName(name.value)) {
    index.value = 0;
    paintCharacterSheet();
    return;
  }
  const col = Math.max(0, Math.min(3, Math.floor(x / (canvas.value.width / 4))));
  const row = Math.max(0, Math.min(1, Math.floor(y / (canvas.value.height / 2))));
  index.value = row * 4 + col;
  paintCharacterSheet();
}

function pickIconCell(event: MouseEvent) {
  if (!iconCanvas.value) return;
  const { cols, rows } = iconGridLayout();
  const rect = iconCanvas.value.getBoundingClientRect();
  const x = (event.clientX - rect.left) * iconCanvas.value.width / rect.width;
  const y = (event.clientY - rect.top) * iconCanvas.value.height / rect.height;
  const col = Math.max(0, Math.min(cols - 1, Math.floor(x / iconCellPx.value)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(y / iconCellPx.value)));
  index.value = row * cols + col;
  paintIconSheet();
}

function normalizeCharacterIndex(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(7, Math.floor(numeric)));
}

function commit() {
  emit('commit', {
    asset: assetKind.value,
    mode: mode.value,
    name: name.value,
    index: index.value,
    directory: assetDirectory.value,
  });
  close();
}

function confirmAsset(value: string) {
  name.value = value;
  index.value = 0;
  commit();
}

function commitPlainSelection(selection: string) {
  if (rootDirectory.value === 'img') {
    const resolved = resolveCatalogImageRootSelection(selection);
    if (!resolved) {
      if (!selection) emit('commit', { asset: assetKind.value, mode: 'plain', name: '', index: 0, directory: 'img' });
      return;
    }
    assetKind.value = resolved.asset;
    name.value = resolved.name;
    emit('commit', { ...resolved, mode: 'plain', index: 0 });
    return;
  }
  name.value = selection;
  emit('commit', {
    asset: assetKind.value,
    mode: 'plain',
    name: selection,
    index: 0,
    directory: assetDirectory.value,
  });
}


defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog { width: min(820px, 86vw); max-height: min(82vh, 700px); }
.picker-grid { min-height: 0; display: grid; grid-template-columns: 240px 1fr; flex: 1; }
.picker-grid--single { grid-template-columns: 1fr; }
aside { overflow: auto; border-right: 1px solid var(--app-border); }
aside input { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); }
aside button { width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-bottom: 1px solid var(--app-border); background: var(--app-bg); color: var(--app-ink); cursor: pointer; text-align: left; }
aside button:hover { background: var(--app-bg-sunken); }
aside button.active { background: var(--app-accent-soft); color: var(--app-accent); font-weight: 600; }
main { min-width: 0; overflow: auto; background: #aeb9c3; }
canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
.plain-preview { min-height: 320px; display: grid; place-items: center; padding: 14px; }
.plain-preview img { max-width: 100%; max-height: 560px; image-rendering: pixelated; }
.icon-grid-main { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.icon-grid-scroll { flex: 1; overflow: auto; background: #aeb9c3; }
.icon-grid-scroll canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
.icon-grid-empty { padding: 32px; text-align: center; color: var(--app-text-muted); }
</style>
