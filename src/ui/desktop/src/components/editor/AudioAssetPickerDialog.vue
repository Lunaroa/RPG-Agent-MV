<template>
  <teleport to="body">
    <div v-if="visible" class="sub-overlay editor-modal-overlay" :data-editor-dialog-layer="LAYER_Z.subDialog" @mousedown.self="close">
      <section class="sub-dialog audio-asset-dialog editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="audio-asset-picker-title">
        <header class="editor-modal-header">
          <strong id="audio-asset-picker-title" class="editor-modal-title">{{ title }}</strong>
          <button type="button" class="editor-modal-close" :aria-label="t('eventcmd.close')" :title="t('eventcmd.close')" @click="close">×</button>
        </header>
        <div class="audio-picker-grid">
          <aside>
            <input v-model="search" :placeholder="t('imgPicker.searchPlaceholder')" />
            <button type="button" :class="{ active: !name }" @click="name = ''">{{ t('imgPicker.none') }}</button>
            <button
              v-for="asset in filteredAssets"
              :key="asset.fileName"
              type="button"
              :class="{ active: name === asset.name }"
              @click="name = asset.name"
            >
              {{ asset.name }}
            </button>
          </aside>
          <main>
            <PluginFileAudioPreview v-if="selectedAsset" :key="selectedAsset.url" :src="selectedAsset.url" />
            <p v-else class="audio-picker-empty">{{ t('imgPicker.none') }}</p>
          </main>
        </div>
        <footer class="editor-modal-footer">
          <span class="editor-dialog-status">{{ name || t('imgPicker.none') }}</span>
          <button type="button" class="editor-btn" @click="close">{{ t('eventcmd.cancel') }}</button>
          <button type="button" class="editor-btn primary" @click="commit">{{ t('eventcmd.ok') }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import { isTopmostEditorDialog } from '../../utils/editorDialogLayer';
import type { EditorProjectCatalog, ProjectAssetEntry } from '../../api/client';
import PluginFileAudioPreview from './PluginFileAudioPreview.vue';

type AudioAssetKind = keyof EditorProjectCatalog['assets'];

const props = defineProps<{ catalog: EditorProjectCatalog | null }>();
const emit = defineEmits<{ commit: [selection: { name: string }] }>();

const { t } = useI18n();
const subDialogZ = String(LAYER_Z.subDialog);
const visible = ref(false);
const title = ref('');
const assetKind = ref<AudioAssetKind>('bgm');
const name = ref('');
const search = ref('');

const assets = computed<ProjectAssetEntry[]>(() => props.catalog?.assets[assetKind.value] || []);
const selectedAsset = computed(() => assets.value.find((asset) => asset.name === name.value) || null);
const filteredAssets = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? assets.value.filter((asset) => asset.name.toLowerCase().includes(query)) : assets.value;
});

function open(options: { asset: AudioAssetKind; title?: string; name?: string }) {
  assetKind.value = options.asset;
  title.value = options.title || t('eventcmd.chooseAudio');
  name.value = options.name || '';
  search.value = '';
  visible.value = true;
}

function close() {
  visible.value = false;
}

function commit() {
  emit('commit', { name: name.value });
  close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !visible.value || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  event.preventDefault();
  close();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

defineExpose({ open });
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.audio-asset-dialog { width: min(640px, calc(100vw - 32px)); max-height: min(70vh, 560px); }
.audio-picker-grid { min-height: 0; display: grid; grid-template-columns: 220px 1fr; flex: 1; }
aside { overflow: auto; border-right: 1px solid var(--app-border); }
aside input { box-sizing: border-box; width: calc(100% - 16px); margin: 8px; padding: 5px; border: 1px solid var(--app-border); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); }
aside button { width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-bottom: 1px solid var(--app-border); background: var(--app-bg); color: var(--app-ink); cursor: pointer; text-align: left; }
aside button:hover { background: var(--app-bg-sunken); }
aside button.active { background: var(--app-accent-soft); color: var(--app-accent); font-weight: 600; }
main { min-width: 0; display: grid; align-content: center; padding: 14px; }
.audio-picker-empty { margin: 0; color: var(--app-ink-muted); font-size: 12px; text-align: center; }
</style>
