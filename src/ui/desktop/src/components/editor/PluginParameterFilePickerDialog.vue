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

        <p class="directory-hint" :title="directory">
          {{ t('pluginFilePicker.directory', { directory }) }}
        </p>

        <div class="picker-grid">
          <aside>
            <input
              v-model="search"
              :placeholder="t('pluginFilePicker.searchPlaceholder')"
              :aria-label="t('pluginFilePicker.searchPlaceholder')"
            />
            <button
              type="button"
              :class="{ active: !name }"
              @click="selectAsset('')"
            >
              {{ t('pluginFilePicker.none') }}
            </button>
            <button
              v-for="asset in filteredAssets"
              :key="asset.name"
              type="button"
              :class="{ active: name === asset.name }"
              :title="asset.name"
              @click="selectAsset(asset.name)"
              @dblclick.prevent="confirmAsset(asset.name)"
            >
              {{ asset.name }}
            </button>
            <p v-if="!filteredAssets.length" class="aside-empty">
              {{ t('pluginFilePicker.noMatches') }}
            </p>
          </aside>

          <main class="preview-surface">
            <div class="preview-scroll">
              <div
                v-if="media === 'image' && selectedAsset"
                class="image-zoom-space"
                :style="{
                  width: `${Math.ceil(imageNaturalWidth * previewZoom)}px`,
                  height: `${Math.ceil(imageNaturalHeight * previewZoom)}px`,
                }"
              >
                <img
                  v-if="previewUrl"
                  :src="previewUrl"
                  :alt="selectedAsset.name"
                  :style="{ transform: `scale(${previewZoom})`, transformOrigin: '0 0' }"
                  @load="onImageLoad"
                />
              </div>
              <audio
                v-else-if="media === 'audio' && previewUrl"
                class="audio-preview"
                :src="previewUrl"
                controls
              />
              <video
                v-else-if="media === 'movie' && previewUrl"
                class="movie-preview"
                :src="previewUrl"
                controls
              />
              <p v-else-if="selectedAsset" class="plain-preview">
                {{ selectedAsset.name }}
              </p>
              <p v-else class="plain-preview">
                {{ t('pluginFilePicker.none') }}
              </p>
            </div>
            <div
              v-if="media === 'image' && selectedAsset"
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
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { resolveAssetUrl } from '../../api/client';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type {
  PluginFileAssetOption,
  PluginFileMediaKind,
} from '../../utils/pluginParameterFileAssets';

const props = defineProps<{
  title?: string;
  directory: string;
  media: PluginFileMediaKind;
  assets: PluginFileAssetOption[];
}>();

const emit = defineEmits<{ commit: [name: string] }>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const search = ref('');
const name = ref('');
const previewZoom = ref(1);
const previewUrl = ref('');
const imageNaturalWidth = ref(320);
const imageNaturalHeight = ref(240);
const PREVIEW_ZOOM_MIN = 0.25;
const PREVIEW_ZOOM_MAX = 4;

const title = computed(() => props.title || t('pluginFilePicker.title'));
const filteredAssets = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return props.assets;
  return props.assets.filter((asset) => asset.name.toLowerCase().includes(query));
});
const selectedAsset = computed(() =>
  props.assets.find((asset) => asset.name === name.value) || null,
);
const summary = computed(() =>
  name.value ? name.value : t('pluginFilePicker.none'),
);

watch(selectedAsset, (asset) => {
  void refreshPreview(asset);
});

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

function open(currentName = '') {
  name.value = currentName || '';
  search.value = '';
  previewZoom.value = 1;
  visible.value = true;
  void nextTick(() => {
    void refreshPreview(selectedAsset.value);
  });
}

function close() {
  visible.value = false;
  previewUrl.value = '';
}

function selectAsset(value: string) {
  name.value = value;
  previewZoom.value = 1;
}

function confirmAsset(value: string) {
  name.value = value;
  commit();
}

async function refreshPreview(asset: PluginFileAssetOption | null) {
  if (!asset?.url) {
    previewUrl.value = '';
    return;
  }
  previewUrl.value = await resolveAssetUrl(asset.url);
}

function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  imageNaturalWidth.value = Math.max(1, image.naturalWidth || 320);
  imageNaturalHeight.value = Math.max(1, image.naturalHeight || 240);
}

function clampPreviewZoom(value: number): number {
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(value * 100) / 100));
}
function zoomIn() { previewZoom.value = clampPreviewZoom(previewZoom.value * 1.25); }
function zoomOut() { previewZoom.value = clampPreviewZoom(previewZoom.value / 1.25); }
function resetZoom() { previewZoom.value = 1; }

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
  width: min(920px, calc(100vw - 48px));
  max-height: min(86vh, 900px);
}
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
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  flex: 0 1 var(--picker-height);
}
aside {
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--app-border);
}
aside input {
  box-sizing: border-box;
  width: calc(100% - 16px);
  margin: 8px;
  padding: 5px 8px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-sm);
  background: var(--app-bg);
  color: var(--app-ink);
}
aside button {
  width: 100%;
  min-height: 28px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg);
  color: var(--app-ink);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
aside button:hover { background: var(--app-bg-sunken); }
aside button.active {
  background: var(--app-accent-soft);
  color: var(--app-accent);
  font-weight: 600;
}
.aside-empty {
  margin: 0;
  padding: 16px 10px;
  color: var(--app-ink-soft);
  font-size: 12px;
}
.preview-surface {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: #aeb9c3;
}
.preview-scroll {
  height: 100%;
  overflow: auto;
  display: grid;
  place-items: center;
}
.image-zoom-space {
  position: relative;
  flex: 0 0 auto;
}
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
</style>
