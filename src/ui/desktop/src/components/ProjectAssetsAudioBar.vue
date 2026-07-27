<template>
  <div class="assets-audio-bar" data-ui-id="project-assets-audio-bar">
    <audio
      ref="audioEl"
      :src="playbackSrc || undefined"
      preload="auto"
      @loadedmetadata="syncFromElement"
      @durationchange="syncFromElement"
      @timeupdate="syncFromElement"
      @ended="onEnded"
      @play="playing = true"
      @pause="playing = false"
      @error="onTrackError"
    />

    <div class="bar-controls">
      <button
        type="button"
        class="bar-btn"
        :disabled="loadFailed || !playbackSrc"
        :aria-label="playing ? t('projectAssets.playerPause') : t('projectAssets.playerPlay')"
        :title="playing ? t('projectAssets.playerPause') : t('projectAssets.playerPlay')"
        @click="togglePlay"
      >
        <Pause v-if="playing" aria-hidden="true" />
        <Play v-else aria-hidden="true" />
      </button>
      <button
        type="button"
        class="bar-btn"
        :aria-label="t('projectAssets.playerStop')"
        :title="t('projectAssets.playerStop')"
        @click="emit('close')"
      >
        <Square aria-hidden="true" />
      </button>
      <button
        type="button"
        class="bar-btn"
        :disabled="items.length <= 1"
        :aria-label="t('projectAssets.playerPrev')"
        :title="t('projectAssets.playerPrev')"
        @click="stepTrack(-1)"
      >
        <SkipBack aria-hidden="true" />
      </button>
      <button
        type="button"
        class="bar-btn"
        :disabled="items.length <= 1"
        :aria-label="t('projectAssets.playerNext')"
        :title="t('projectAssets.playerNext')"
        @click="stepTrack(1)"
      >
        <SkipForward aria-hidden="true" />
      </button>

      <span class="bar-title" :title="currentItem?.name || ''">
        {{ currentItem?.name || '' }}
        <small v-if="items.length > 1">{{ currentIndex + 1 }}/{{ items.length }}</small>
      </span>

      <AudioWaveformSeek
        v-if="!loadFailed"
        class="bar-waveform"
        :peaks="waveformPeaks"
        :current-time="currentTime"
        :duration="duration"
        :disabled="!canSeek"
        :aria-label="t('projectAssets.playerSeek')"
        @seek="seekTo"
      />
      <p v-else class="bar-error" role="alert">
        {{ t('projectAssets.playerLoadFailed') }}
      </p>

      <span class="bar-clock" aria-live="off">
        {{ formatPluginAudioClock(currentTime) }}
        <span class="bar-clock-sep">/</span>
        {{ formatPluginAudioClock(duration) }}
      </span>

      <button
        type="button"
        class="bar-btn"
        :class="{ 'is-active': loopEnabled }"
        :aria-label="t('projectAssets.playerLoop')"
        :title="t('projectAssets.playerLoop')"
        :aria-pressed="loopEnabled"
        @click="loopEnabled = !loopEnabled"
      >
        <Repeat aria-hidden="true" />
      </button>
      <button
        type="button"
        class="bar-btn"
        :class="{ 'is-active': shuffleEnabled }"
        :aria-label="t('projectAssets.playerShuffle')"
        :title="t('projectAssets.playerShuffle')"
        :aria-pressed="shuffleEnabled"
        @click="shuffleEnabled = !shuffleEnabled"
      >
        <Shuffle aria-hidden="true" />
      </button>
      <button
        type="button"
        class="bar-btn"
        :aria-label="t('projectAssets.playerVolume')"
        :title="t('projectAssets.playerVolume')"
        @click="toggleMute"
      >
        <VolumeX v-if="muted || volumePercent <= 0" aria-hidden="true" />
        <Volume2 v-else aria-hidden="true" />
      </button>
      <el-slider
        class="bar-volume"
        :model-value="muted ? 0 : volumePercent"
        :max="100"
        :show-tooltip="false"
        :aria-label="t('projectAssets.playerVolume')"
        @input="onVolumeInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import {
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
} from '@lucide/vue';
import { useI18n } from '../i18n';
import AudioWaveformSeek from './AudioWaveformSeek.vue';
import {
  createPluginAudioPlaybackBundle,
  formatPluginAudioClock,
  getRememberedPluginAudioVolume,
  readFiniteAudioDuration,
  rememberPluginAudioVolume,
} from '../utils/pluginFileAudioPreview';

export interface AssetsAudioBarItem {
  id: string;
  name: string;
  url: string;
}

const props = defineProps<{ items: AssetsAudioBarItem[] }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const audioEl = ref<HTMLAudioElement | null>(null);
const currentIndex = ref(0);
const playbackSrc = ref('');
const waveformPeaks = ref<number[]>([]);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(Number.NaN);
const loopEnabled = ref(false);
const shuffleEnabled = ref(false);
const loadFailed = ref(false);
const remembered = getRememberedPluginAudioVolume();
const volumePercent = ref(remembered.volumePercent);
const muted = ref(remembered.muted);
let objectUrl: string | null = null;
let loadController: AbortController | null = null;
let bindToken = 0;

const currentItem = computed(() => props.items[currentIndex.value] || null);
const canSeek = computed(() => Number.isFinite(duration.value) && duration.value > 0);

function revokeObjectUrl(): void {
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

function resetTrackState(): void {
  audioEl.value?.pause();
  playing.value = false;
  currentTime.value = 0;
  duration.value = Number.NaN;
  waveformPeaks.value = [];
  loadFailed.value = false;
  playbackSrc.value = '';
  loadController?.abort();
  loadController = null;
  revokeObjectUrl();
}

async function bindCurrentTrack(): Promise<void> {
  const token = ++bindToken;
  resetTrackState();
  const item = currentItem.value;
  if (!item) return;
  try {
    loadController = new AbortController();
    const bundle = await createPluginAudioPlaybackBundle(item.url, loadController.signal);
    if (token !== bindToken) {
      URL.revokeObjectURL(bundle.objectUrl);
      return;
    }
    objectUrl = bundle.objectUrl;
    playbackSrc.value = bundle.objectUrl;
    waveformPeaks.value = bundle.peaks;
    duration.value = bundle.durationSeconds;
    await nextTick();
    applyVolume();
    await playCurrent();
  } catch {
    if (token !== bindToken) return;
    loadFailed.value = true;
  }
}

function applyVolume(): void {
  const element = audioEl.value;
  if (!element) return;
  element.volume = Math.min(1, Math.max(0, volumePercent.value / 100));
  element.muted = muted.value;
}

function syncFromElement(): void {
  const element = audioEl.value;
  if (!element) return;
  const nextDuration = readFiniteAudioDuration(element.duration);
  if (Number.isFinite(nextDuration)) duration.value = nextDuration;
  currentTime.value = element.currentTime || 0;
}

async function playCurrent(): Promise<void> {
  const element = audioEl.value;
  if (!element || !currentItem.value || !playbackSrc.value || loadFailed.value) return;
  applyVolume();
  try {
    await element.play();
  } catch {
    playing.value = false;
  }
}

function togglePlay(): void {
  const element = audioEl.value;
  if (!element) return;
  if (element.paused) void playCurrent();
  else element.pause();
}

function pickNextIndex(direction: 1 | -1): number {
  const count = props.items.length;
  if (count <= 1) return 0;
  if (shuffleEnabled.value) {
    let next = currentIndex.value;
    while (next === currentIndex.value) next = Math.floor(Math.random() * count);
    return next;
  }
  return (currentIndex.value + direction + count) % count;
}

function stepTrack(direction: 1 | -1): void {
  currentIndex.value = pickNextIndex(direction);
}

function onEnded(): void {
  const count = props.items.length;
  if (count <= 1) {
    if (!loopEnabled.value) {
      playing.value = false;
      return;
    }
    seekTo(0);
    void playCurrent();
    return;
  }
  if (shuffleEnabled.value) {
    currentIndex.value = pickNextIndex(1);
    return;
  }
  const atEnd = currentIndex.value >= count - 1;
  if (atEnd && !loopEnabled.value) {
    playing.value = false;
    return;
  }
  currentIndex.value = atEnd ? 0 : currentIndex.value + 1;
}

function onTrackError(): void {
  playing.value = false;
  loadFailed.value = true;
}

function seekTo(seconds: number): void {
  const element = audioEl.value;
  if (!element || !canSeek.value) return;
  const next = Math.min(duration.value, Math.max(0, seconds));
  element.currentTime = next;
  currentTime.value = next;
}

function onVolumeInput(value: number | number[]): void {
  const percent = Array.isArray(value) ? Number(value[0]) || 0 : value;
  volumePercent.value = Math.min(100, Math.max(0, Math.round(percent)));
  muted.value = volumePercent.value <= 0;
  rememberPluginAudioVolume(volumePercent.value, muted.value);
  applyVolume();
}

function toggleMute(): void {
  muted.value = !muted.value;
  if (!muted.value && volumePercent.value <= 0) volumePercent.value = 100;
  rememberPluginAudioVolume(volumePercent.value, muted.value);
  applyVolume();
}

watch(
  () => props.items,
  () => {
    if (currentIndex.value === 0) {
      void bindCurrentTrack();
    } else {
      currentIndex.value = 0;
    }
  },
  { immediate: true },
);

watch(currentIndex, () => {
  void bindCurrentTrack();
});

onUnmounted(() => {
  bindToken += 1;
  loadController?.abort();
  loadController = null;
  resetTrackState();
});
</script>

<style scoped>
.assets-audio-bar {
  /* Single-row player: controls, waveform and volume share one line. */
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
}

.bar-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-ink-soft);
  cursor: pointer;
}

.bar-btn:hover:not(:disabled) {
  background: var(--app-bg-sunken);
  color: var(--app-ink);
}

.bar-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.bar-btn.is-active {
  background: var(--app-accent-soft);
  color: var(--app-accent);
}

.bar-btn svg {
  width: 14px;
  height: 14px;
}

.bar-title {
  flex: none;
  min-width: 60px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--app-ink);
}

.bar-title small {
  margin-left: 4px;
  color: var(--app-ink-muted);
}

.bar-clock {
  flex: none;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--app-ink-muted);
}

.bar-clock-sep {
  margin: 0 2px;
}

.bar-volume {
  flex: none;
  width: 80px;
  --el-slider-height: 4px;
  --el-slider-button-size: 12px;
}

.bar-waveform {
  flex: 1;
  min-width: 0;
  height: 26px;
}

.bar-error {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-danger);
  font-size: 12px;
}
</style>
