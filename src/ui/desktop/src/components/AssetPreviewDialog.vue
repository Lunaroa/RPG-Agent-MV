<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="sub-overlay editor-modal-overlay"
      :data-editor-dialog-layer="LAYER_Z.subDialog"
      @mousedown.self="emitClose"
    >
      <section
        class="sub-dialog asset-preview-dialog editor-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-preview-dialog-title"
      >
        <header class="editor-modal-header">
          <strong id="asset-preview-dialog-title" class="editor-modal-title">
            {{ currentItem?.displayName || '' }}
          </strong>
          <button
            type="button"
            class="editor-modal-close"
            :aria-label="labels.closeTitle"
            :title="labels.close"
            @click="emitClose"
          >×</button>
        </header>

        <div class="asset-preview-body">
          <p v-if="currentItem?.metadata" class="asset-preview-meta">{{ currentItem.metadata }}</p>
          <AssetPreviewSurface
            v-if="currentItem"
            class="asset-preview-surface"
            :media="currentItem.media"
            :preview-url="currentPreviewUrl"
            :display-name="currentItem.displayName"
            :preview-failed="currentPreviewFailed"
            :space-held="spaceHeld"
            :labels="surfaceLabels"
            @image-error="onImageError"
          />
          <p v-else class="asset-preview-empty plain-preview">{{ surfaceLabels.none }}</p>
        </div>

        <footer class="editor-modal-footer">
          <span class="editor-dialog-status">{{ currentItem?.displayName || surfaceLabels.none }}</span>
          <button type="button" class="editor-btn" @click="emitClose">{{ labels.close }}</button>
        </footer>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { LAYER_Z } from '../constants/layerZIndex';
import { isTopmostEditorDialog } from '../utils/editorDialogLayer';
import type {
  AssetPreviewDialogLabels,
  AssetPreviewItem,
  AssetPreviewSurfaceLabels,
} from '../utils/assetPreview';
import { resolveAssetPreviewNavIndex } from '../utils/assetPreviewNav';
import AssetPreviewSurface from './AssetPreviewSurface.vue';

const props = defineProps<{
  visible: boolean;
  items: AssetPreviewItem[];
  currentIndex: number;
  labels: AssetPreviewDialogLabels;
  surfaceLabels: AssetPreviewSurfaceLabels;
}>();

const emit = defineEmits<{
  close: [];
  navigate: [index: number];
}>();

const subDialogZ = String(LAYER_Z.subDialog);
const spaceHeld = ref(false);
const imageFailedIds = ref(new Set<string>());

const currentItem = computed(() => props.items[props.currentIndex] || null);
const currentPreviewFailed = computed(() =>
  currentItem.value ? imageFailedIds.value.has(currentItem.value.id) : false,
);
const currentPreviewUrl = computed(() =>
  currentItem.value && !currentPreviewFailed.value ? currentItem.value.url : '',
);
watch(
  () => props.visible,
  (open) => {
    if (!open) {
      spaceHeld.value = false;
      imageFailedIds.value = new Set();
    }
  },
);

function emitClose() {
  emit('close');
}

function onImageError() {
  const item = props.items[props.currentIndex];
  if (!item) return;
  imageFailedIds.value = new Set([...imageFailedIds.value, item.id]);
}

function onKeyDown(event: KeyboardEvent) {
  if (!props.visible || !isTopmostEditorDialog(LAYER_Z.subDialog)) return;
  const inTextField = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement;
  if (inTextField) return;

  if (event.code === 'Space') {
    event.preventDefault();
    spaceHeld.value = true;
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    emitClose();
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    const next = resolveAssetPreviewNavIndex(props.currentIndex, delta, props.items.length);
    if (next < 0 || next === props.currentIndex) return;
    emit('navigate', next);
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceHeld.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
});
</script>

<style scoped>
.sub-overlay { z-index: v-bind(subDialogZ); }
.asset-preview-dialog {
  --dialog-width: 960px;
  width: min(var(--dialog-width), calc(100vw - 48px));
  max-height: min(86vh, 900px);
}
.asset-preview-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: min(610px, calc(100vh - 180px));
  overflow: hidden;
}
.asset-preview-meta {
  margin: 0;
  padding: 8px 12px;
  border-bottom: 1px solid var(--app-border);
  color: var(--app-ink-soft, #5a5247);
  font-family: var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-preview-surface {
  flex: 1;
  min-height: 0;
}
.asset-preview-empty.plain-preview {
  margin: 0;
  padding: 24px;
  color: #2a3138;
  font-size: 13px;
  text-align: center;
}
</style>
