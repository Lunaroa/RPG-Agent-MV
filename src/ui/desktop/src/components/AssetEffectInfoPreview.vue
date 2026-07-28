<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useI18n } from '../i18n';
import ParticleAnimationPreviewFrame from './ParticleAnimationPreviewFrame.vue';
import { useEffectThumbnail } from '../composables/useEffectThumbnail';
import type { AssetPreviewItem } from '../utils/assetPreview';

const props = defineProps<{
  displayName: string;
  info: NonNullable<AssetPreviewItem['info']>;
}>();

const { t } = useI18n();
const actionBusy = ref(false);
const playing = ref(false);
const frameRef = ref<InstanceType<typeof ParticleAnimationPreviewFrame> | null>(null);

// Default view is the static representative-frame thumbnail; the live playback
// frame is only mounted once the user asks to play the full animation.
const { url: thumbnailUrl } = useEffectThumbnail(
  () => props.displayName,
  {
    sizeBucket: 512,
    project: () => props.info.playback?.project,
    enabled: () => Boolean(props.info.playback),
  },
);

async function playEffect(): Promise<void> {
  const playback = props.info.playback;
  if (!playback || actionBusy.value) return;
  actionBusy.value = true;
  playing.value = true;
  try {
    await nextTick();
    await frameRef.value?.play({ ...playback.animation });
  } catch (error) {
    ElMessage.error(t('projectAssets.effectPreviewFailed', { message: (error as Error).message }));
  } finally {
    actionBusy.value = false;
  }
}
</script>

<template>
  <div class="effect-info" role="region" :aria-label="displayName">
    <p class="effect-info-notice">{{ info.notice }}</p>
    <dl class="effect-info-rows">
      <div v-for="row in info.rows" :key="`${row.label}:${row.value}`" class="effect-info-row">
        <dt>{{ row.label }}</dt>
        <dd :title="row.value">{{ row.value }}</dd>
      </div>
    </dl>
    <template v-if="info.playback">
      <div class="effect-info-stage">
        <ParticleAnimationPreviewFrame
          v-if="playing"
          ref="frameRef"
          class="effect-info-frame"
          :project="info.playback.project"
        />
        <img
          v-else-if="thumbnailUrl"
          class="effect-info-thumb"
          :src="thumbnailUrl"
          :alt="displayName"
          draggable="false"
        />
        <div v-else class="effect-info-thumb-empty" aria-hidden="true" />
      </div>
      <button
        type="button"
        class="effect-info-action"
        :disabled="actionBusy"
        :aria-busy="actionBusy"
        @click="playEffect"
      >
        {{ info.playback.label }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.effect-info {
  width: min(100%, 520px);
  margin: 24px;
  padding: 18px 20px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(20, 24, 29, .18);
  display: grid;
  gap: 14px;
}
.effect-info-notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--app-accent, #c45c26) 12%, #fff);
  color: #2a3138;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}
.effect-info-rows {
  margin: 0;
  display: grid;
  gap: 10px;
}
.effect-info-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 10px;
  align-items: start;
}
.effect-info-row dt {
  margin: 0;
  color: #8a939e;
  font-size: 11px;
  font-weight: 650;
}
.effect-info-row dd {
  margin: 0;
  color: #2a3138;
  font: 600 12px / 1.35 var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  overflow-wrap: anywhere;
  word-break: break-word;
}
.effect-info-frame {
  width: 100%;
  height: 100%;
}
.effect-info-stage {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #171411;
  border-radius: 6px;
  overflow: hidden;
}
.effect-info-thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.effect-info-thumb-empty {
  width: 100%;
  height: 100%;
}
.effect-info-action {
  min-height: 32px;
  justify-self: start;
  border: 1px solid var(--app-accent, #c45c26);
  border-radius: 6px;
  background: var(--app-accent, #c45c26);
  color: #fff;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.effect-info-action:hover:not(:disabled) {
  filter: brightness(.96);
}
.effect-info-action:focus-visible {
  outline: 2px solid var(--app-accent, #c45c26);
  outline-offset: 2px;
}
.effect-info-action:disabled {
  cursor: wait;
  opacity: .6;
}
</style>
