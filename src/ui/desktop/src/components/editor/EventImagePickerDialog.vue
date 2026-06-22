<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog image-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="event-image-title">
        <header class="editor-modal-header"><strong id="event-image-title" class="editor-modal-title">{{ t('eventImgPicker.title') }}</strong><button type="button" class="editor-modal-close" :aria-label="t('eventImgPicker.closeTitle')" :title="t('eventcmd.close')" @click="close">×</button></header>
        <div class="image-tabs editor-tab-strip" :aria-label="t('eventImgPicker.imageType')"><button type="button" :class="{ active: tab === 'character' }" @click="tab = 'character'">{{ t('eventImgPicker.character') }}</button><button type="button" :class="{ active: tab === 'tile' }" @click="tab = 'tile'">{{ t('eventImgPicker.tile') }}</button></div>
        <div v-if="tab === 'character'" class="picker-grid">
          <aside>
            <input v-model="search" :placeholder="t('eventImgPicker.searchCharacters')" />
            <button type="button" :class="{ active: !draft.characterName }" @click="selectCharacter('')">{{ t('imgPicker.none') }}</button>
            <button v-for="asset in filteredCharacters" :key="asset.fileName" type="button" :class="{ active: draft.characterName === asset.name }" @click="selectCharacter(asset.name)">{{ asset.name }}</button>
          </aside>
          <main><canvas ref="characterCanvas" width="560" height="430" @click="pickCharacterCell" /></main>
        </div>
        <div v-else class="tile-picker">
          <nav class="editor-tab-strip" :aria-label="t('eventImgPicker.tileTabs')"><button v-for="entry in tileTabs" :key="entry.label" type="button" :class="{ active: tileTab === entry.label }" :disabled="!entry.image" @click="tileTab = entry.label">{{ entry.label }}</button></nav>
          <canvas ref="tileCanvas" width="768" height="768" @click="pickTileCell" />
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
import { TILE_ID_A5, TILE_SIZE, eventCharacterFrame, isBigCharacterName } from '../../composables/useMapRenderer';
const props = defineProps<{ catalog: EditorProjectCatalog | null; tilesetImages: (HTMLImageElement | null)[]; loadImage: (url: string) => Promise<HTMLImageElement | null> }>();
const emit = defineEmits<{ commit: [image: MvEventImage] }>();
const { language, t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const tab = ref<'character' | 'tile'>('character');
const search = ref('');
const draft = ref<MvEventImage>(defaultImage());
const characterCanvas = ref<HTMLCanvasElement>();
const tileCanvas = ref<HTMLCanvasElement>();
const characterCache = new Map<string, HTMLImageElement | null>();
const tileTab = ref('B');
const summary = computed(() => imageSummary(draft.value, language.value));
const filteredCharacters = computed(() => (props.catalog?.assets.characters || []).filter((asset) => asset.name.toLowerCase().includes(search.value.toLowerCase())));
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

function open(image: MvEventImage) { draft.value = clone(image || defaultImage()); tab.value = draft.value.tileId ? 'tile' : 'character'; visible.value = true; void nextTick(paint); }
function close() { visible.value = false; }
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
  context.strokeStyle = '#fff'; context.lineWidth = 3; context.strokeRect(dx + frame.sx * scale, dy + frame.sy * scale, frame.sw * scale, frame.sh * scale);
}
async function pickCharacterCell(event: MouseEvent) {
  const canvas = characterCanvas.value, image = draft.value.characterName ? await characterBitmap(draft.value.characterName) : null;
  if (!canvas || !image) return;
  const rect = canvas.getBoundingClientRect(), scale = Math.min(1, (canvas.width - 20) / image.naturalWidth, (canvas.height - 20) / image.naturalHeight);
  const x = ((event.clientX - rect.left) * canvas.width / rect.width - 10) / scale, y = ((event.clientY - rect.top) * canvas.height / rect.height - 10) / scale;
  const big = isBigCharacterName(draft.value.characterName), cols = big ? 3 : 12, rows = big ? 4 : 8, col = Math.floor(x / (image.naturalWidth / cols)), row = Math.floor(y / (image.naturalHeight / rows));
  if (col < 0 || row < 0 || col >= cols || row >= rows) return;
  Object.assign(draft.value, big ? { characterIndex: 0, pattern: col, direction: [2,4,6,8][row] } : { characterIndex: Math.floor(col / 3) + Math.floor(row / 4) * 4, pattern: col % 3, direction: [2,4,6,8][row % 4] });
  paintCharacterSheet();
}
function paintTileSheet() {
  const canvas = tileCanvas.value, entry = tileTabs.value.find((item) => item.label === tileTab.value);
  if (!canvas || !entry?.image) return;
  canvas.width = entry.image.naturalWidth; canvas.height = entry.image.naturalHeight;
  const context = canvas.getContext('2d')!; context.drawImage(entry.image, 0, 0);
  context.strokeStyle = 'rgba(255,255,255,.4)';
  for (let x = 0; x <= canvas.width / TILE_SIZE; x++) { context.beginPath(); context.moveTo(x * TILE_SIZE + .5, 0); context.lineTo(x * TILE_SIZE + .5, canvas.height); context.stroke(); }
  for (let y = 0; y <= canvas.height / TILE_SIZE; y++) { context.beginPath(); context.moveTo(0, y * TILE_SIZE + .5); context.lineTo(canvas.width, y * TILE_SIZE + .5); context.stroke(); }
}
function pickTileCell(event: MouseEvent) {
  const canvas = tileCanvas.value, entry = tileTabs.value.find((item) => item.label === tileTab.value);
  if (!canvas || !entry) return;
  const rect = canvas.getBoundingClientRect(), col = Math.floor((event.clientX - rect.left) * canvas.width / rect.width / TILE_SIZE), row = Math.floor((event.clientY - rect.top) * canvas.height / rect.height / TILE_SIZE);
  const tileId = entry.label === 'A5' ? entry.base + row * 8 + col : entry.base + (col < 8 ? 0 : 128) + row * 8 + col % 8;
  Object.assign(draft.value, { tileId, characterName: '', characterIndex: 0, pattern: 1, direction: 2 });
}
function commit() { emit('commit', clone(draft.value)); close(); }
defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.sub-dialog { width: min(820px, 86vw); max-height: min(82vh, 700px); }
.picker-grid { min-height: 0; display: grid; grid-template-columns: 190px 1fr; flex: 1; }
aside { overflow: auto; border-right: 1px solid var(--app-border); }
aside input { width: calc(100% - 16px); margin: 8px; padding: 5px; border: 1px solid var(--app-border); }
aside button { width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-bottom: 1px solid var(--app-border); background: var(--app-bg); color: var(--app-ink); cursor: pointer; text-align: left; }
aside button:hover { background: var(--app-bg-sunken); }
aside button.active { background: var(--app-accent-soft); color: var(--app-accent); font-weight: 600; }
main, .tile-picker { overflow: auto; background: #aeb9c3; }
canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
</style>
