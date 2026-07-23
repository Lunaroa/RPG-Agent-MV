<template>
  <aside class="character-browser" :class="viewMode">
    <div class="browser-toolbar">
      <label class="character-search">
        <Search aria-hidden="true" />
        <input
          :value="search"
          type="search"
          :aria-label="t('eventImgPicker.searchCharacters')"
          :placeholder="t('eventImgPicker.searchCharacters')"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="view-switch" role="group" :aria-label="t('eventImgPicker.viewMode')">
        <button
          type="button"
          :class="{ active: viewMode === 'list' }"
          :aria-label="t('eventImgPicker.listView')"
          :title="t('eventImgPicker.listView')"
          :aria-pressed="viewMode === 'list'"
          @click="emit('update:view-mode', 'list')"
        >
          <List aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="{ active: viewMode === 'gallery' }"
          :aria-label="t('eventImgPicker.galleryView')"
          :title="t('eventImgPicker.galleryView')"
          :aria-pressed="viewMode === 'gallery'"
          @click="emit('update:view-mode', 'gallery')"
        >
          <Grid aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="viewMode === 'list'" class="character-list">
      <button
        :ref="(element) => setAssetElement('', element)"
        type="button"
        :class="{ active: !selectedName }"
        @click="emit('select', '')"
      >
        {{ t('imgPicker.none') }}
      </button>
      <button
        v-for="asset in filteredAssets"
        :key="asset.fileName"
        :ref="(element) => setAssetElement(asset.name, element)"
        type="button"
        :class="{ active: selectedName === asset.name }"
        :title="asset.fileName"
        @click="emit('select', asset.name)"
      >
        {{ asset.name }}
      </button>
      <div v-if="!filteredAssets.length" class="browser-empty" role="status">{{ t('eventImgPicker.noCharacterMatches') }}</div>
    </div>

    <div v-else class="character-gallery">
      <button
        :ref="(element) => setAssetElement('', element)"
        type="button"
        class="character-card none-card"
        :class="{ active: !selectedName }"
        @click="emit('select', '')"
      >
        <span class="character-preview empty-preview" aria-hidden="true"><Close /></span>
        <span class="character-copy"><strong>{{ t('imgPicker.none') }}</strong></span>
      </button>
      <button
        v-for="asset in filteredAssets"
        :key="asset.fileName"
        :ref="(element) => setAssetElement(asset.name, element)"
        type="button"
        class="character-card"
        :class="{ active: selectedName === asset.name }"
        :aria-label="`${asset.name} (${asset.fileName})`"
        :title="asset.fileName"
        @click="emit('select', asset.name)"
      >
        <span class="character-preview">
          <img
            v-if="!failedImageUrls.has(asset.url)"
            :src="asset.url"
            :alt="asset.name"
            loading="lazy"
            decoding="async"
            @error="markImageFailed(asset.url)"
          />
          <span v-else class="preview-failed" role="img" :aria-label="t('eventImgPicker.previewFailed')">
            <WarningFilled aria-hidden="true" />
          </span>
        </span>
        <span class="character-copy"><strong>{{ asset.name }}</strong></span>
      </button>
      <div v-if="!filteredAssets.length" class="browser-empty" role="status">{{ t('eventImgPicker.noCharacterMatches') }}</div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Close, Grid, List, Search, WarningFilled } from '@element-plus/icons-vue';
import type { ProjectAssetEntry } from '../../api/client';
import { useI18n } from '../../i18n';
import { characterAssetMatches, type CharacterAssetViewMode } from '../../utils/characterAssetBrowser';

const props = defineProps<{
  assets: ProjectAssetEntry[];
  selectedName: string;
  search: string;
  viewMode: CharacterAssetViewMode;
}>();
const emit = defineEmits<{
  'update:search': [value: string];
  'update:view-mode': [mode: CharacterAssetViewMode];
  select: [name: string];
}>();
const { t } = useI18n();
const failedImageUrls = ref(new Set<string>());
const assetElements = new Map<string, HTMLElement>();
const filteredAssets = computed(() => props.assets.filter((asset) => characterAssetMatches(asset, props.search)));

function setAssetElement(name: string, element: unknown): void {
  if (element instanceof HTMLElement) assetElements.set(name, element);
  else assetElements.delete(name);
}

function markImageFailed(url: string): void {
  failedImageUrls.value = new Set([...failedImageUrls.value, url]);
}

function scrollSelectedIntoView(): void {
  assetElements.get(props.selectedName)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

watch(
  () => [props.selectedName, props.viewMode, props.search] as const,
  () => void nextTick(scrollSelectedIntoView),
  { immediate: true },
);
</script>

<style scoped>
.character-browser{min-width:0;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--app-border);background:var(--app-bg)}
.browser-toolbar{display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid var(--app-border)}
.character-search{height:30px;min-width:0;display:flex;flex:1;align-items:center;gap:5px;padding:0 7px;border:1px solid var(--app-border);border-radius:4px;background:var(--app-bg);color:var(--app-ink-muted)}
.character-search:focus-within{border-color:var(--app-accent);box-shadow:0 0 0 1px var(--app-accent)}
.character-search :deep(svg){width:13px;height:13px}
.character-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--app-ink);font:inherit;font-size:11px}
.view-switch{height:30px;display:flex;flex:0 0 auto;padding:2px;border:1px solid var(--app-border);border-radius:4px;background:var(--app-bg-soft)}
.view-switch button{width:28px;height:24px;display:grid;place-items:center;padding:0;border:0;border-radius:3px;background:transparent;color:var(--app-ink-muted);cursor:pointer}
.view-switch button:hover{color:var(--app-ink);background:var(--app-bg)}
.view-switch button.active{background:var(--app-bg);color:var(--app-accent);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.view-switch button:focus-visible,.character-list button:focus-visible,.character-card:focus-visible{outline:2px solid var(--app-accent);outline-offset:-2px}
.view-switch :deep(svg){width:14px;height:14px}
.character-list,.character-gallery{min-height:0;flex:1;overflow:auto}
.character-list button{width:100%;min-height:28px;padding:0 8px;border:0;border-bottom:1px solid var(--app-border);background:var(--app-bg);color:var(--app-ink);cursor:pointer;text-align:left}
.character-list button:hover{background:var(--app-bg-sunken)}
.character-list button.active{background:var(--app-accent-soft);color:var(--app-accent);font-weight:600}
.character-gallery{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));align-content:start;gap:8px;padding:8px}
.character-card{min-width:0;display:flex;min-height:132px;flex-direction:column;gap:7px;padding:7px;border:1px solid var(--app-border);border-radius:7px;background:var(--app-bg);color:var(--app-ink);font:inherit;text-align:left;cursor:pointer}
.character-card:hover{background:var(--app-bg-soft)}
.character-card.active{border-color:var(--app-accent);background:var(--app-accent-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--app-accent) 35%,transparent)}
.character-preview{height:104px;display:grid;place-items:center;overflow:hidden;border:1px solid var(--app-border);border-radius:5px;background-color:var(--app-bg-sunken);background-image:linear-gradient(45deg,var(--app-border) 25%,transparent 25%),linear-gradient(-45deg,var(--app-border) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--app-border) 75%),linear-gradient(-45deg,transparent 75%,var(--app-border) 75%);background-position:0 0,0 6px,6px -6px,-6px 0;background-size:12px 12px}
.character-preview img{width:100%;height:100%;display:block;object-fit:contain;image-rendering:pixelated;image-rendering:crisp-edges}
.empty-preview{background:var(--app-bg-sunken);color:var(--app-ink-muted)}
.empty-preview :deep(svg){width:26px;height:26px}
.preview-failed{width:100%;height:100%;display:grid;place-items:center;background:var(--app-danger-soft);color:var(--app-danger)}
.preview-failed :deep(svg){width:24px;height:24px}
.character-copy{min-width:0;display:block}
.character-copy strong{display:block;overflow:hidden;color:var(--app-ink);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.browser-empty{grid-column:1/-1;padding:18px 10px;color:var(--app-ink-muted);font-size:11px;text-align:center}
@media (max-width: 1300px) {
  .character-gallery{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (max-width: 1100px) {
  .character-gallery{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width: 900px) {
  .character-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
}
</style>
