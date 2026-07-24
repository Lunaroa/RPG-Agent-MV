<script setup lang="ts">
import { computed } from 'vue';
import type { EditorProjectCatalog, PluginParameterSchemaField } from '../../api/client';
import { resolvePluginParameterValueDecor } from '../../utils/pluginParameterValueDecor';
import ActorWalkingFrameThumb from './ActorWalkingFrameThumb.vue';
import ActorWalkingSheetThumb from './ActorWalkingSheetThumb.vue';
import IconSetThumb from './IconSetThumb.vue';

const props = defineProps<{
  field: PluginParameterSchemaField;
  value: unknown;
  catalog: EditorProjectCatalog | null;
  /** Inline thumb height in the value cell (row-scaled). */
  inlineSize?: number;
  /** Popover preview max edge (width & height). */
  popoverMax?: number;
}>();

const INLINE = computed(() => Math.max(16, Math.round(props.inlineSize ?? 28)));
const POPOVER_MAX = computed(() => Math.max(64, Math.round(props.popoverMax ?? 200)));
const popoverIconSize = computed(() =>
  Math.min(POPOVER_MAX.value, Math.max(32, Math.round(props.catalog?.iconSize || 32) * 2)),
);

const decor = computed(() =>
  resolvePluginParameterValueDecor(props.field, props.value, props.catalog),
);

const hasMedia = computed(() => Boolean(decor.value.media));
</script>

<template>
  <span
    v-if="decor.icon || hasMedia"
    class="parameter-value-decor"
  >
    <component
      :is="decor.icon"
      v-if="decor.icon"
      class="parameter-value-type-icon"
      :size="14"
      :stroke-width="1.75"
      aria-hidden="true"
    />

    <el-popover
      v-if="hasMedia && decor.media"
      placement="right"
      trigger="hover"
      :show-after="180"
      :hide-after="60"
      width="auto"
      popper-class="plugin-parameter-value-media-popper"
    >
      <template #reference>
        <span class="parameter-value-thumb" :style="{ height: `${INLINE}px` }">
          <ActorWalkingFrameThumb
            v-if="decor.media.kind === 'actor'"
            :character-name="decor.media.characterName"
            :character-index="decor.media.characterIndex"
            :catalog="catalog"
            :size="INLINE"
          />
          <IconSetThumb
            v-else-if="decor.media.kind === 'icon'"
            :icon-index="decor.media.iconIndex"
            :catalog="catalog"
            :size="INLINE"
          />
          <img
            v-else
            :src="decor.media.url"
            alt=""
            class="parameter-value-thumb-img"
            draggable="false"
          />
        </span>
      </template>
      <div
        class="parameter-value-popover-preview"
        :style="{ maxWidth: `${POPOVER_MAX}px`, maxHeight: `${POPOVER_MAX}px` }"
      >
        <ActorWalkingSheetThumb
          v-if="decor.media.kind === 'actor'"
          :character-name="decor.media.characterName"
          :character-index="decor.media.characterIndex"
          :catalog="catalog"
          :max-width="POPOVER_MAX"
          :max-height="POPOVER_MAX"
        />
        <IconSetThumb
          v-else-if="decor.media.kind === 'icon'"
          :icon-index="decor.media.iconIndex"
          :catalog="catalog"
          :size="popoverIconSize"
        />
        <img
          v-else
          :src="decor.media.url"
          alt=""
          class="parameter-value-popover-img"
          draggable="false"
        />
      </div>
    </el-popover>
  </span>
</template>

<style scoped>
.parameter-value-decor {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  max-width: 42%;
}
.parameter-value-type-icon {
  flex: 0 0 auto;
  color: var(--console-accent, #be5630);
  opacity: 0.92;
}
.parameter-value-thumb {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  max-width: 72px;
  overflow: hidden;
  border: 1px solid var(--console-border, #e4dcce);
  border-radius: 4px;
  background:
    linear-gradient(45deg, #ece4d8 25%, transparent 25%),
    linear-gradient(-45deg, #ece4d8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ece4d8 75%),
    linear-gradient(-45deg, transparent 75%, #ece4d8 75%);
  background-color: #f7f2e9;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-size: 8px 8px;
  cursor: default;
}
.parameter-value-thumb-img {
  height: 100%;
  width: auto;
  max-width: 72px;
  display: block;
  object-fit: contain;
  image-rendering: auto;
}
</style>

<style>
.plugin-parameter-value-media-popper.el-popper {
  width: auto !important;
  min-width: 0 !important;
  max-width: none;
  padding: 8px !important;
}
.plugin-parameter-value-media-popper .parameter-value-popover-preview {
  display: grid;
  place-items: center;
  overflow: hidden;
  width: max-content;
  max-width: inherit;
}
.plugin-parameter-value-media-popper .parameter-value-popover-img,
.plugin-parameter-value-media-popper .actor-walking-sheet-thumb {
  max-width: 200px;
  max-height: 200px;
  width: auto;
  height: auto;
  display: block;
  object-fit: contain;
  image-rendering: auto;
}
.plugin-parameter-value-media-popper .actor-walking-sheet-thumb {
  image-rendering: pixelated;
}
</style>
