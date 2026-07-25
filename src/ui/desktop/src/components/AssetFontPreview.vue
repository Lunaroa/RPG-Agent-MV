<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import {
  ASSET_FONT_PREVIEW_SAMPLE_DEFAULT,
  ASSET_FONT_PREVIEW_SIZES_PX,
} from '../utils/assetPreview';

const props = withDefaults(defineProps<{
  src: string;
  displayName: string;
  sampleText?: string;
  loadFailedLabel?: string;
}>(), {
  sampleText: ASSET_FONT_PREVIEW_SAMPLE_DEFAULT,
  loadFailedLabel: 'Preview failed to load',
});

const familyName = ref('');
const loadFailed = ref(false);
const ready = ref(false);
let loadedFace: FontFace | null = null;
let bindToken = 0;

watch(
  () => [props.src, props.displayName] as const,
  () => {
    void bindFont();
  },
  { immediate: true },
);

async function bindFont(): Promise<void> {
  const token = ++bindToken;
  await releaseFace();
  loadFailed.value = false;
  ready.value = false;
  familyName.value = '';
  if (!props.src) {
    loadFailed.value = true;
    return;
  }
  const family = `asset-font-preview-${token}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const response = await fetch(props.src);
    if (!response.ok) throw new Error(`font fetch ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (token !== bindToken) return;
    const face = new FontFace(family, buffer);
    await face.load();
    if (token !== bindToken) {
      try {
        document.fonts.delete(face);
      } catch {
        /* ignore */
      }
      return;
    }
    document.fonts.add(face);
    loadedFace = face;
    familyName.value = family;
    ready.value = true;
  } catch {
    if (token !== bindToken) return;
    loadFailed.value = true;
  }
}

async function releaseFace(): Promise<void> {
  if (!loadedFace) return;
  try {
    document.fonts.delete(loadedFace);
  } catch {
    /* ignore */
  }
  loadedFace = null;
}

onUnmounted(() => {
  bindToken += 1;
  void releaseFace();
});
</script>

<template>
  <div class="font-preview" :aria-label="displayName">
    <p v-if="loadFailed" class="font-preview-error" role="alert">{{ loadFailedLabel }}</p>
    <template v-else-if="ready">
      <p
        v-for="size in ASSET_FONT_PREVIEW_SIZES_PX"
        :key="size"
        class="font-preview-row"
      >
        <span class="font-preview-size">{{ size }}</span>
        <span
          class="font-preview-sample"
          :style="{ fontFamily: `'${familyName}', sans-serif`, fontSize: `${size}px` }"
        >{{ sampleText }}</span>
      </p>
    </template>
    <p v-else class="font-preview-loading">…</p>
  </div>
</template>

<style scoped>
.font-preview {
  width: min(100%, 640px);
  margin: 24px;
  padding: 16px 18px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(20, 24, 29, .18);
  display: grid;
  gap: 12px;
}
.font-preview-row {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 12px;
  align-items: baseline;
  margin: 0;
}
.font-preview-size {
  color: #8a939e;
  font: 600 11px / 1 var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  text-align: right;
}
.font-preview-sample {
  color: #2a3138;
  line-height: 1.35;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.font-preview-error,
.font-preview-loading {
  margin: 0;
  color: #3a414b;
  font-size: 13px;
  text-align: center;
}
.font-preview-error {
  color: var(--app-danger, #b42318);
}
</style>
