<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section
        class="sub-dialog image-dialog editor-modal-shell"
        :class="{
          'character-list-dialog': tab === 'character' && characterViewMode === 'list',
          'character-gallery-dialog': tab === 'character' && characterViewMode === 'gallery',
          'tile-dialog': tab === 'tile',
        }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-image-title"
      >
        <header class="editor-modal-header"><strong id="event-image-title" class="editor-modal-title">{{ t('eventImgPicker.title') }}</strong><button type="button" class="editor-modal-close" :aria-label="t('eventImgPicker.closeTitle')" :title="t('eventcmd.close')" @click="close">×</button></header>
        <div class="image-tabs editor-tab-strip" :aria-label="t('eventImgPicker.imageType')"><button type="button" :class="{ active: tab === 'character' }" @click="tab = 'character'">{{ t('eventImgPicker.character') }}</button><button type="button" :class="{ active: tab === 'tile' }" @click="tab = 'tile'">{{ t('eventImgPicker.tile') }}</button></div>
        <div v-if="tab === 'character'" class="picker-grid" :class="{ 'gallery-view': characterViewMode === 'gallery' }">
          <CharacterAssetBrowser
            :assets="catalog?.assets.characters || []"
            :selected-name="draft.characterName"
            :search="search"
            :view-mode="characterViewMode"
            @update:search="search = $event"
            @update:view-mode="setCharacterViewMode"
            @select="void selectCharacter($event)"
          />
          <div class="picker-surface character-picker-surface">
            <canvas
              ref="characterCanvas"
              width="560"
              height="430"
              :aria-label="t('eventImgPicker.pickHint')"
              :title="t('eventImgPicker.pickHint')"
              @click="void pickCharacterCell($event)"
              @dblclick.prevent="void confirmCharacterCell($event)"
            />
          </div>
        </div>
        <div v-else class="tile-picker">
          <nav class="editor-tab-strip" :aria-label="t('eventImgPicker.tileTabs')"><button v-for="entry in tileTabs" :key="entry.label" type="button" :class="{ active: tileTab === entry.label }" :disabled="!entry.image" @click="tileTab = entry.label">{{ entry.label }}</button></nav>
          <div class="tile-canvas-scroll">
            <canvas
              ref="tileCanvas"
              width="768"
              height="768"
              :aria-label="t('eventImgPicker.pickHint')"
              :title="t('eventImgPicker.pickHint')"
              @click="pickTileCell"
              @dblclick.prevent="confirmTileCell"
            />
          </div>
        </div>
        <footer class="editor-modal-footer"><span class="editor-dialog-status">{{ summary }}</span><button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button><button type="button" class="editor-btn primary" @click="commit">{{ t('eventcmd.ok') }}</button></footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type { EditorProjectCatalog } from '../../api/client';
import { clone, defaultImage, imageSummary, type MvEventImage } from '../../composables/useEventEditor';
import { TILE_ID_A5, eventCharacterFrame, isBigCharacterName } from '../../composables/useMapRenderer';
import CharacterAssetBrowser from './CharacterAssetBrowser.vue';
import {
  getRuntimeCharacterAssetViewMode,
  setRuntimeCharacterAssetViewMode,
  type CharacterAssetViewMode,
} from '../../utils/characterAssetBrowser';
const props = defineProps<{ catalog: EditorProjectCatalog | null; tilesetImages: (HTMLImageElement | null)[]; loadImage: (url: string) => Promise<HTMLImageElement | null> }>();
const emit = defineEmits<{ commit: [image: MvEventImage] }>();
const { language, t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const tab = ref<'character' | 'tile'>('character');
const search = ref('');
const characterViewMode = ref<CharacterAssetViewMode>(getRuntimeCharacterAssetViewMode());
const draft = ref<MvEventImage>(defaultImage());
const characterCanvas = ref<HTMLCanvasElement>();
const tileCanvas = ref<HTMLCanvasElement>();
const characterCache = new Map<string, HTMLImageElement | null>();
const tileTab = ref('B');
const summary = computed(() => imageSummary(draft.value, language.value));
const tileSize = computed(() => Math.max(1, Number(props.catalog?.tileSize) || 48));
const tileTabs = computed(() => [
  { label: 'A5', image: props.tilesetImages[4], base: TILE_ID_A5 },
  { label: 'B', image: props.tilesetImages[5], base: 0 },
  { label: 'C', image: props.tilesetImages[6], base: 256 },
  { label: 'D', image: props.tilesetImages[7], base: 512 },
  { label: 'E', image: props.tilesetImages[8], base: 768 },
]);
watch([tab, tileTab], () => void nextTick(paint));
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function open(image: MvEventImage) {
  draft.value = clone(image || defaultImage());
  tab.value = draft.value.tileId ? 'tile' : 'character';
  if (draft.value.tileId) tileTab.value = tileTabForId(Number(draft.value.tileId));
  visible.value = true;
  void nextTick(paint);
}
function close() { visible.value = false; }
function setCharacterViewMode(mode: CharacterAssetViewMode): void {
  characterViewMode.value = mode;
  setRuntimeCharacterAssetViewMode(mode);
}
async function selectCharacter(name: string) {
  Object.assign(draft.value, { tileId: 0, characterName: name, characterIndex: 0, pattern: 1, direction: 2 });
  if (name) await characterBitmap(name);
  paintCharacterSheet();
}
async function characterBitmap(name: string) {
  if (characterCache.has(name)) return characterCache.get(name) || null;
  const asset = props.catalog?.assets.characters.find((entry) => entry.name === name);
  const image = asset ? await props.loadImage(asset.url) : null;
  characterCache.set(name, image);
  return image;
}
async function paint() { if (tab.value === 'character') await paintCharacterSheet(); else paintTileSheet(); }
async function paintCharacterSheet() {
  const canvas = characterCanvas.value;
  if (!canvas) return;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#aeb9c3'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (!draft.value.characterName) return;
  const image = await characterBitmap(draft.value.characterName);
  if (!image) return;
  const scale = Math.min(1, (canvas.width - 20) / image.naturalWidth, (canvas.height - 20) / image.naturalHeight);
  const dx = 10, dy = 10, dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
  context.imageSmoothingEnabled = false; context.drawImage(image, dx, dy, dw, dh);
  const big = isBigCharacterName(draft.value.characterName), cols = big ? 3 : 12, rows = big ? 4 : 8, cw = dw / cols, ch = dh / rows;
  context.strokeStyle = 'rgba(255,255,255,.55)';
  for (let x = 0; x <= cols; x++) { context.beginPath(); context.moveTo(dx + x * cw, dy); context.lineTo(dx + x * cw, dy + dh); context.stroke(); }
  for (let y = 0; y <= rows; y++) { context.beginPath(); context.moveTo(dx, dy + y * ch); context.lineTo(dx + dw, dy + y * ch); context.stroke(); }
  const frame = eventCharacterFrame(image, draft.value)!;
  const sx = dx + frame.sx * scale, sy = dy + frame.sy * scale, sw = frame.sw * scale, sh = frame.sh * scale;
  context.strokeStyle = 'rgba(0,0,0,.88)'; context.lineWidth = 5; context.strokeRect(sx, sy, sw, sh);
  context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(sx, sy, sw, sh);
}
async function pickCharacterCell(event: MouseEvent): Promise<boolean> {
  const canvas = characterCanvas.value, image = draft.value.characterName ? await characterBitmap(draft.value.characterName) : null;
  if (!canvas || !image) return false;
  const rect = canvas.getBoundingClientRect(), scale = Math.min(1, (canvas.width - 20) / image.naturalWidth, (canvas.height - 20) / image.naturalHeight);
  const x = ((event.clientX - rect.left) * canvas.width / rect.width - 10) / scale, y = ((event.clientY - rect.top) * canvas.height / rect.height - 10) / scale;
  const big = isBigCharacterName(draft.value.characterName), cols = big ? 3 : 12, rows = big ? 4 : 8, col = Math.floor(x / (image.naturalWidth / cols)), row = Math.floor(y / (image.naturalHeight / rows));
  if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
  Object.assign(draft.value, big ? { characterIndex: 0, pattern: col, direction: [2,4,6,8][row] } : { characterIndex: Math.floor(col / 3) + Math.floor(row / 4) * 4, pattern: col % 3, direction: [2,4,6,8][row % 4] });
  paintCharacterSheet();
  return true;
}
async function confirmCharacterCell(event: MouseEvent): Promise<void> {
  if (await pickCharacterCell(event)) commit();
}
function paintTileSheet() {
  const canvas = tileCanvas.value, entry = tileTabs.value.find((item) => item.label === tileTab.value);
  if (!canvas || !entry?.image) return;
  canvas.width = entry.image.naturalWidth; canvas.height = entry.image.naturalHeight;
  const context = canvas.getContext('2d')!; context.drawImage(entry.image, 0, 0);
  context.strokeStyle = 'rgba(255,255,255,.4)';
  for (let x = 0; x <= canvas.width / tileSize.value; x++) { context.beginPath(); context.moveTo(x * tileSize.value + .5, 0); context.lineTo(x * tileSize.value + .5, canvas.height); context.stroke(); }
  for (let y = 0; y <= canvas.height / tileSize.value; y++) { context.beginPath(); context.moveTo(0, y * tileSize.value + .5); context.lineTo(canvas.width, y * tileSize.value + .5); context.stroke(); }
  const selected = selectedTileCell(entry.label, entry.base, Number(draft.value.tileId || 0));
  if (selected) {
    const x = selected.col * tileSize.value, y = selected.row * tileSize.value;
    context.strokeStyle = 'rgba(0,0,0,.9)'; context.lineWidth = 5; context.strokeRect(x + 2.5, y + 2.5, tileSize.value - 5, tileSize.value - 5);
    context.strokeStyle = '#fff'; context.lineWidth = 2; context.strokeRect(x + 2.5, y + 2.5, tileSize.value - 5, tileSize.value - 5);
  }
}
function pickTileCell(event: MouseEvent): boolean {
  const canvas = tileCanvas.value, entry = tileTabs.value.find((item) => item.label === tileTab.value);
  if (!canvas || !entry?.image) return false;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
  const col = Math.floor(x / tileSize.value), row = Math.floor(y / tileSize.value);
  const tileId = entry.label === 'A5' ? entry.base + row * 8 + col : entry.base + (col < 8 ? 0 : 128) + row * 8 + col % 8;
  Object.assign(draft.value, { tileId, characterName: '', characterIndex: 0, pattern: 1, direction: 2 });
  paintTileSheet();
  return true;
}
function confirmTileCell(event: MouseEvent): void {
  if (pickTileCell(event)) commit();
}
function tileTabForId(tileId: number): string {
  if (tileId >= TILE_ID_A5) return 'A5';
  if (tileId >= 768) return 'E';
  if (tileId >= 512) return 'D';
  if (tileId >= 256) return 'C';
  return 'B';
}
function selectedTileCell(label: string, base: number, tileId: number): { col: number; row: number } | null {
  if (!tileId || tileTabForId(tileId) !== label) return null;
  const local = tileId - base;
  if (label === 'A5') return { col: local % 8, row: Math.floor(local / 8) };
  return { col: local < 128 ? local % 8 : 8 + (local % 8), row: Math.floor((local % 128) / 8) };
}
function commit() { emit('commit', clone(draft.value)); close(); }
defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog {
  --picker-height: 460px;
  --picker-right-width: 600px;
  width: min(var(--dialog-width), calc(100vw - 48px));
  max-height: min(86vh, 760px);
}
.character-list-dialog { --dialog-width: 820px; --browser-width: 220px; }
.character-gallery-dialog { --dialog-width: 1320px; --browser-width: 720px; }
.tile-dialog { --dialog-width: var(--picker-right-width); }
.picker-grid {
  height: min(var(--picker-height), calc(100vh - 160px));
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, var(--browser-width)) minmax(0, var(--picker-right-width));
  flex: 0 1 var(--picker-height);
}
.picker-surface,
.tile-picker {
  width: min(100%, var(--picker-right-width));
  height: min(var(--picker-height), calc(100vh - 160px));
  min-width: 0;
  min-height: 0;
  background: #aeb9c3;
}
.picker-surface {
  display: grid;
  place-items: center;
  overflow: auto;
}
.tile-picker {
  display: flex;
  flex: 0 1 var(--picker-height);
  flex-direction: column;
}
.tile-picker > nav { flex: 0 0 auto; }
.tile-canvas-scroll { min-width: 0; min-height: 0; flex: 1; overflow: auto; }
.picker-surface canvas { margin: auto; }
canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
@media (max-width: 1100px) {
  .character-gallery-dialog .picker-grid {
    grid-template-columns: minmax(420px, 1fr) minmax(0, min(var(--picker-right-width), calc(100% - 420px)));
  }
}
@media (max-width: 900px) {
  .sub-dialog { width: min(var(--dialog-width), calc(100vw - 24px)); }
  .character-gallery-dialog .picker-grid {
    grid-template-columns: minmax(270px, 1fr) minmax(0, min(520px, calc(100% - 270px)));
  }
}
</style>
