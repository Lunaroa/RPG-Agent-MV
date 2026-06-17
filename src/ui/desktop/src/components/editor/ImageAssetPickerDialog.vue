<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog image-asset-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="image-asset-picker-title">
        <header class="editor-modal-header">
          <strong id="image-asset-picker-title" class="editor-modal-title">{{ title }}</strong>
          <button type="button" class="editor-modal-close" aria-label="关闭图像选择" title="关闭" @click="close">×</button>
        </header>
        <div class="picker-grid">
          <aside>
            <input v-model="search" placeholder="搜索图像" />
            <button type="button" :class="{ active: !name }" @click="selectAsset('')">(无)</button>
            <button
              v-for="asset in filteredAssets"
              :key="asset.fileName"
              type="button"
              :class="{ active: name === asset.name }"
              @click="selectAsset(asset.name)"
            >
              {{ asset.name }}
            </button>
          </aside>
          <main>
            <canvas v-if="mode === 'face' || mode === 'character'" ref="canvas" @click="pickCell" />
            <div v-else class="plain-preview">
              <img v-if="selectedAsset" :src="selectedAsset.url" :alt="selectedAsset.name" />
            </div>
          </main>
        </div>
        <footer class="editor-modal-footer">
          <span class="editor-dialog-status">{{ summary }}</span>
          <button type="button" class="editor-btn" @click="close">取消</button>
          <button type="button" class="editor-btn primary" @click="commit">确定</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type { EditorProjectCatalog, ProjectAssetEntry } from '../../api/client';
import { MV_FACE_COLUMNS, MV_FACE_HEIGHT, MV_FACE_ROWS, MV_FACE_WIDTH, mvFaceIndexFromCanvasPoint, normalizeMvFaceIndex } from '../../utils/rmmvFace';
import { isBigCharacterName } from '../../composables/useMapRenderer';

type ImageAssetKind = keyof EditorProjectCatalog['assets'];
type ImagePickerMode = 'plain' | 'face' | 'character';

interface OpenOptions {
  asset: ImageAssetKind;
  mode?: ImagePickerMode;
  title?: string;
  name?: string;
  index?: number;
}

const props = defineProps<{
  catalog: EditorProjectCatalog | null;
  loadImage: (url: string) => Promise<HTMLImageElement | null>;
}>();

const emit = defineEmits<{ commit: [selection: { asset: ImageAssetKind; mode: ImagePickerMode; name: string; index: number }] }>();

const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const title = ref('选择图像');
const assetKind = ref<ImageAssetKind>('pictures');
const mode = ref<ImagePickerMode>('plain');
const name = ref('');
const index = ref(0);
const search = ref('');
const canvas = ref<HTMLCanvasElement>();
let bitmap: HTMLImageElement | null = null;
const imageCache = new Map<string, HTMLImageElement | null>();

const assets = computed<ProjectAssetEntry[]>(() => props.catalog?.assets[assetKind.value] || []);
const selectedAsset = computed(() => assets.value.find((asset) => asset.name === name.value) || null);
const filteredAssets = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? assets.value.filter((asset) => asset.name.toLowerCase().includes(query)) : assets.value;
});
const summary = computed(() => {
  if (!name.value) return '(无)';
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
  assetKind.value = options.asset;
  mode.value = options.mode || 'plain';
  title.value = options.title || '选择图像';
  name.value = options.name || '';
  index.value = mode.value === 'face' ? normalizeMvFaceIndex(options.index) : normalizeCharacterIndex(options.index);
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
  const width = bitmap?.naturalWidth || MV_FACE_WIDTH * MV_FACE_COLUMNS;
  const height = bitmap?.naturalHeight || MV_FACE_HEIGHT * MV_FACE_ROWS;
  const context = fillCanvas(width, height);
  if (!context) return;
  if (!bitmap) return;
  context.drawImage(bitmap, 0, 0);
  context.strokeStyle = 'rgba(255,255,255,.55)';
  context.lineWidth = 1;
  for (let x = 0; x <= MV_FACE_COLUMNS; x += 1) drawLine(context, x * MV_FACE_WIDTH + 0.5, 0, x * MV_FACE_WIDTH + 0.5, height);
  for (let y = 0; y <= MV_FACE_ROWS; y += 1) drawLine(context, 0, y * MV_FACE_HEIGHT + 0.5, width, y * MV_FACE_HEIGHT + 0.5);
  const faceIndex = normalizeMvFaceIndex(index.value);
  context.strokeStyle = '#fff';
  context.lineWidth = 3;
  context.strokeRect(faceIndex % MV_FACE_COLUMNS * MV_FACE_WIDTH + 1.5, Math.floor(faceIndex / MV_FACE_COLUMNS) * MV_FACE_HEIGHT + 1.5, MV_FACE_WIDTH - 3, MV_FACE_HEIGHT - 3);
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
    index.value = mvFaceIndexFromCanvasPoint(x, y);
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

function normalizeCharacterIndex(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(7, Math.floor(numeric)));
}

function commit() {
  emit('commit', { asset: assetKind.value, mode: mode.value, name: name.value, index: index.value });
  close();
}

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog { width: min(820px, 86vw); max-height: min(82vh, 700px); }
.picker-grid { min-height: 0; display: grid; grid-template-columns: 190px 1fr; flex: 1; }
aside { overflow: auto; border-right: 1px solid var(--app-border); }
aside input { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); }
aside button { width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-bottom: 1px solid var(--app-border); background: var(--app-bg); color: var(--app-ink); cursor: pointer; text-align: left; }
aside button:hover { background: var(--app-bg-sunken); }
aside button.active { background: var(--app-accent-soft); color: var(--app-accent); font-weight: 600; }
main { min-width: 0; overflow: auto; background: #aeb9c3; }
canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
.plain-preview { min-height: 320px; display: grid; place-items: center; padding: 14px; }
.plain-preview img { max-width: 100%; max-height: 560px; image-rendering: pixelated; }
</style>
