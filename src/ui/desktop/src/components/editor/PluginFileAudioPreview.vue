<template>
  <div class="audio-shell" :aria-label="t('pluginFilePicker.audioPreview')">
    <audio
      ref="audioEl"
      :src="playbackSrc || undefined"
      preload="auto"
      @loadedmetadata="syncFromElement"
      @durationchange="syncFromElement"
      @loadeddata="syncFromElement"
      @canplay="syncFromElement"
      @timeupdate="syncFromElement"
      @ended="onEnded"
      @play="playing = true"
      @pause="playing = false"
      @error="onAudioError"
    />

    <div class="audio-bar">
      <button
        type="button"
        class="audio-btn"
        :disabled="!playbackSrc || loadFailed"
        :aria-label="playing ? t('pluginFilePicker.audioPause') : t('pluginFilePicker.audioPlay')"
        :title="playing ? t('pluginFilePicker.audioPause') : t('pluginFilePicker.audioPlay')"
        @click="togglePlay"
      >
        <Pause v-if="playing" aria-hidden="true" />
        <Play v-else aria-hidden="true" />
      </button>

      <span class="audio-clock" aria-live="off">
        {{ formatPluginAudioClock(currentTime) }}
        <span class="clock-sep">/</span>
        {{ formatPluginAudioClock(duration) }}
      </span>

      <el-slider
        class="audio-seek"
        :model-value="seekValue"
        :min="0"
        :max="seekMax"
        :step="0.01"
        :disabled="!canSeek"
        :show-tooltip="false"
        :aria-label="t('pluginFilePicker.audioSeek')"
        @input="onSeekInput"
      />

      <el-popover
        v-model:visible="volumeOpen"
        placement="top"
        trigger="click"
        :width="48"
        :show-arrow="false"
        :teleported="true"
        :z-index="volumeZ"
        popper-class="plugin-file-audio-volume-popper"
      >
        <template #reference>
          <button
            type="button"
            class="audio-btn volume-btn"
            :aria-label="t('pluginFilePicker.audioVolume')"
            :title="t('pluginFilePicker.audioVolume')"
            :aria-expanded="volumeOpen"
          >
            <VolumeX v-if="muted || volumePercent <= 0" aria-hidden="true" />
            <Volume2 v-else aria-hidden="true" />
          </button>
        </template>
        <div class="volume-popup-body">
          <el-slider
            vertical
            height="100px"
            :model-value="volumePercent"
            :min="0"
            :max="100"
            :step="1"
            :show-tooltip="false"
            :aria-label="t('pluginFilePicker.audioVolume')"
            @input="onVolumeInput"
          />
        </div>
      </el-popover>
    </div>

    <p v-if="loadFailed" class="audio-error" role="alert">
      {{ t('pluginFilePicker.previewFailed') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Pause, Play, Volume2, VolumeX } from '@lucide/vue';
import { LAYER_Z } from '../../constants/layerZIndex';
import { useI18n } from '../../i18n';
import {
  createPluginAudioPlaybackBundle,
  formatPluginAudioClock,
  readFiniteAudioDuration,
} from '../../utils/pluginFileAudioPreview';

const props = defineProps<{
  src: string;
}>();

const { t } = useI18n();
/** Above file-picker subDialog (2500) so the volume popover is clickable. */
const volumeZ = LAYER_Z.contextMenu;
const audioEl = ref<HTMLAudioElement | null>(null);
const playbackSrc = ref('');
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(Number.NaN);
const volumePercent = ref(100);
const muted = ref(false);
const volumeOpen = ref(false);
const seeking = ref(false);
const loadFailed = ref(false);
let objectUrl: string | null = null;
let bindToken = 0;

const canSeek = computed(() => Number.isFinite(duration.value) && duration.value > 0);
const seekMax = computed(() => (canSeek.value ? duration.value : 1));
const seekValue = computed(() => (canSeek.value ? currentTime.value : 0));

watch(
  () => props.src,
  (src) => {
    void bindSource(src);
  },
  { immediate: true },
);

function revokeObjectUrl(): void {
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

async function bindSource(src: string): Promise<void> {
  const token = ++bindToken;
  playing.value = false;
  currentTime.value = 0;
  duration.value = Number.NaN;
  volumeOpen.value = false;
  seeking.value = false;
  loadFailed.value = false;
  playbackSrc.value = '';
  revokeObjectUrl();
  if (!src) return;

  try {
    const bundle = await createPluginAudioPlaybackBundle(src);
    if (token !== bindToken) {
      URL.revokeObjectURL(bundle.objectUrl);
      return;
    }
    objectUrl = bundle.objectUrl;
    playbackSrc.value = bundle.objectUrl;
    if (Number.isFinite(bundle.durationSeconds)) {
      duration.value = bundle.durationSeconds;
    }
  } catch {
    if (token !== bindToken) return;
    loadFailed.value = true;
  }
}

function syncFromElement(): void {
  const el = audioEl.value;
  if (!el) return;
  if (!seeking.value) {
    currentTime.value = el.currentTime || 0;
  }
  const nextDuration = readFiniteAudioDuration(el.duration);
  if (Number.isFinite(nextDuration)) {
    duration.value = nextDuration;
  }
  volumePercent.value = Math.round((el.muted ? 0 : el.volume) * 100);
  muted.value = el.muted || el.volume <= 0;
}

function onAudioError(): void {
  loadFailed.value = true;
}

function togglePlay(): void {
  const el = audioEl.value;
  if (!el || !playbackSrc.value || loadFailed.value) return;
  if (el.paused) {
    void el.play();
  } else {
    el.pause();
  }
}

function onEnded(): void {
  playing.value = false;
  syncFromElement();
}

function onSeekInput(value: number | number[]): void {
  const el = audioEl.value;
  if (!el || !canSeek.value) return;
  const next = Array.isArray(value) ? value[0] : value;
  if (!Number.isFinite(next)) return;
  seeking.value = true;
  currentTime.value = next;
  el.currentTime = next;
  seeking.value = false;
}

function onVolumeInput(value: number | number[]): void {
  const el = audioEl.value;
  if (!el) return;
  const next = Array.isArray(value) ? value[0] : value;
  if (!Number.isFinite(next)) return;
  const clamped = Math.min(100, Math.max(0, next));
  el.volume = clamped / 100;
  el.muted = clamped <= 0;
  volumePercent.value = clamped;
  muted.value = el.muted;
}

onUnmounted(() => {
  bindToken += 1;
  audioEl.value?.pause();
  revokeObjectUrl();
});
</script>

<style scoped>
.audio-shell {
  width: min(100%, 520px);
  margin: 24px;
  display: grid;
  gap: 8px;
  justify-items: stretch;
}
.audio-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 10px 6px 6px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(20, 24, 29, .18);
}
.audio-btn {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #2a3138;
  cursor: pointer;
}
.audio-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.audio-btn:hover:not(:disabled) { background: #eef1f4; }
.audio-btn:focus-visible {
  outline: 2px solid var(--app-accent, #c45c26);
  outline-offset: 1px;
}
.audio-btn :deep(svg) {
  width: 16px;
  height: 16px;
}
.audio-clock {
  flex: 0 0 auto;
  min-width: 7.5em;
  color: #3a414b;
  font: 600 11px / 1 var(--app-font-mono, "Cascadia Mono", Consolas, monospace);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.clock-sep {
  margin: 0 3px;
  color: #8a939e;
  font-weight: 500;
}
.audio-seek {
  flex: 1 1 auto;
  min-width: 80px;
  margin: 0 4px;
}
.audio-seek :deep(.el-slider__runway) {
  height: 4px;
  margin: 0;
  background: #c9d0d7;
}
.audio-seek :deep(.el-slider__bar) {
  height: 4px;
  background: #2a3138;
}
.audio-seek :deep(.el-slider__button-wrapper) {
  width: 16px;
  height: 16px;
  top: -6px;
}
.audio-seek :deep(.el-slider__button) {
  width: 12px;
  height: 12px;
  border: 0;
  background: #2a3138;
}
.volume-popup-body {
  display: grid;
  place-items: center;
  padding: 4px 0;
}
.audio-error {
  margin: 0;
  color: var(--app-danger, #b42318);
  font-size: 12px;
  text-align: center;
}
</style>

<style>
.plugin-file-audio-volume-popper.el-popper {
  min-width: 48px !important;
  width: 48px !important;
  padding: 10px 6px !important;
  z-index: 3000 !important;
}
.plugin-file-audio-volume-popper .el-slider.is-vertical {
  margin: 0 auto;
}
.plugin-file-audio-volume-popper .el-slider__runway {
  width: 4px;
  background: #c9d0d7;
}
.plugin-file-audio-volume-popper .el-slider__bar {
  width: 4px;
  background: #2a3138;
}
.plugin-file-audio-volume-popper .el-slider__button {
  width: 12px;
  height: 12px;
  border: 0;
  background: #2a3138;
}
</style>
