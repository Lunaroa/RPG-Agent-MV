<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="sub-overlay editor-modal-overlay"
      :data-editor-dialog-layer="LAYER_Z.subDialog"
      @mousedown.self="close"
    >
      <section
        class="sub-dialog tileset-picker-dialog editor-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-tileset-picker-title"
      >
        <header class="editor-modal-header">
          <strong id="plugin-tileset-picker-title" class="editor-modal-title">{{ title }}</strong>
          <button
            type="button"
            class="editor-modal-close"
            :aria-label="t('pluginTilesetPicker.closeTitle')"
            :title="t('eventcmd.close')"
            @click="close"
          >×</button>
        </header>

        <p class="directory-hint">{{ t('pluginTilesetPicker.hint') }}</p>

        <div class="picker-grid">
          <aside class="tileset-browser">
            <label class="file-search">
              <Search aria-hidden="true" />
              <input
                v-model="search"
                type="search"
                :placeholder="t('pluginTilesetPicker.searchPlaceholder')"
                :aria-label="t('pluginTilesetPicker.searchPlaceholder')"
              />
            </label>

            <div ref="galleryEl" class="file-gallery" tabindex="0">
              <button
                type="button"
                class="gallery-card none-card"
                :class="{ active: selectedId === 0 }"
                @click="selectId(0)"
                @dblclick.prevent="commit"
              >
                <span class="gallery-preview empty-preview" aria-hidden="true"><Close /></span>
                <span class="gallery-copy"><strong>{{ t('pluginTilesetPicker.none') }}</strong></span>
              </button>
              <button
                v-for="option in filteredOptions"
                :key="option.id"
                type="button"
                class="gallery-card"
                :class="{ active: selectedId === option.id }"
                :title="option.label"
                :aria-label="option.label"
                @click="selectId(option.id)"
                @dblclick.prevent="commit"
              >
                <span class="gallery-preview">
                  <img
                    v-if="option.previewUrl && !failedUrls.has(option.previewUrl)"
                    :src="option.previewUrl"
                    :alt="option.label"
                    loading="lazy"
                    decoding="async"
                    @error="markFailed(option.previewUrl)"
                  />
                  <span
                    v-else
                    class="preview-failed"
                    role="img"
                    :aria-label="t('pluginTilesetPicker.previewFailed')"
                  >
                    <WarningFilled aria-hidden="true" />
                  </span>
                </span>
                <span class="gallery-copy"><strong>{{ option.label }}</strong></span>
              </button>
              <p v-if="!filteredOptions.length" class="browser-empty">
                {{ t('pluginTilesetPicker.noMatches') }}
              </p>
            </div>
          </aside>

          <main class="preview-surface">
            <div class="preview-scroll">
              <img
                v-if="selectedPreviewUrl && !previewFailed"
                :src="selectedPreviewUrl"
                :alt="selectedLabel"
                class="tileset-fit-preview"
                draggable="false"
                @error="previewFailed = true"
              />
              <p v-else class="plain-preview">
                {{
                  selectedId <= 0
                    ? t('pluginTilesetPicker.none')
                    : (previewFailed ? t('pluginTilesetPicker.previewFailed') : selectedLabel)
                }}
              </p>
            </div>
          </main>
        </div>

        <footer class="editor-modal-footer">
          <span class="editor-dialog-status">{{ selectedLabel }}</span>
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Close, Search, WarningFilled } from '@element-plus/icons-vue';
import type { EditorProjectCatalog } from '../../api/client';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import {
  buildPluginParameterTilesetOptions,
  type PluginTilesetPickerOption,
} from '../../utils/pluginParameterTilesetPicker';

const props = defineProps<{
  title?: string;
  catalog?: EditorProjectCatalog | null;
}>();

const emit = defineEmits<{
  commit: [value: number];
}>();

const { t } = useI18n();
const visible = ref(false);
const search = ref('');
const selectedId = ref(0);
const failedUrls = ref(new Set<string>());
const previewFailed = ref(false);
const galleryEl = ref<HTMLElement | null>(null);
const subDialogZ = String(LAYER_Z.subDialog);

const title = computed(() => props.title || t('pluginTilesetPicker.title'));
const options = computed(() => buildPluginParameterTilesetOptions(props.catalog));
const filteredOptions = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return options.value;
  return options.value.filter((option) => option.label.toLowerCase().includes(query));
});
const selectedOption = computed<PluginTilesetPickerOption | null>(() =>
  options.value.find((option) => option.id === selectedId.value) || null,
);
const selectedLabel = computed(() =>
  selectedId.value <= 0
    ? t('pluginTilesetPicker.none')
    : (selectedOption.value?.label || String(selectedId.value)),
);
const selectedPreviewUrl = computed(() => selectedOption.value?.previewUrl || null);

watch(selectedPreviewUrl, () => {
  previewFailed.value = false;
});

function open(currentId: unknown): void {
  const id = Number(currentId);
  selectedId.value = Number.isInteger(id) && id > 0 ? id : 0;
  search.value = '';
  failedUrls.value = new Set();
  previewFailed.value = false;
  visible.value = true;
}

function close(): void {
  visible.value = false;
}

function selectId(id: number): void {
  selectedId.value = id;
}

function commit(): void {
  emit('commit', selectedId.value);
  close();
}

function markFailed(url: string | null): void {
  if (!url) return;
  failedUrls.value = new Set([...failedUrls.value, url]);
}

function onKeyDown(event: KeyboardEvent): void {
  if (!visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === 'Enter' && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
    commit();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown, true);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true);
});

defineExpose({ open, close });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.tileset-picker-dialog {
  --dialog-width: 1080px;
  width: min(var(--dialog-width), calc(100vw - 48px));
  max-height: min(860px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
}
.directory-hint {
  margin: 0;
  padding: 6px 14px;
  color: var(--app-ink-muted);
  font-size: 11px;
  border-bottom: 1px solid var(--app-border);
}
.picker-grid {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
  overflow: hidden;
}
.tileset-browser {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--app-border);
  background: var(--app-bg);
}
.file-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px;
  padding: 0 8px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-bg-sunken);
}
.file-search :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--app-ink-muted);
}
.file-search input {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: 0;
  background: transparent;
  color: var(--app-ink);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.file-gallery {
  min-height: 0;
  flex: 1;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
  object-fit: contain;
  image-rendering: pixelated;
}
.empty-preview { background-image: none; }
.empty-preview :deep(svg),
.preview-failed :deep(svg) {
  width: 28px;
  height: 28px;
}
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
  min-width: 0;
  min-height: 0;
  background: #aeb9c3;
}
.preview-scroll {
  height: 100%;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 16px;
}
.tileset-fit-preview {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
  object-fit: contain;
  image-rendering: pixelated;
}
.plain-preview {
  margin: 0;
  padding: 24px;
  color: #2a3138;
  font-size: 13px;
  text-align: center;
}
@media (max-width: 900px) {
  .picker-grid { grid-template-columns: 1fr; }
  .tileset-browser { border-right: 0; border-bottom: 1px solid var(--app-border); max-height: 45vh; }
  .file-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
