<template>
  <div class="assets-audio-bar" data-ui-id="project-assets-audio-bar">
    <audio
      ref="audioEl"
      :src="currentItem?.url || undefined"
      preload="auto"
      @loadedmetadata="syncFromElement"
      @durationchange="syncFromElement"
      @timeupdate="syncFromElement"
      @ended="onEnded"
      @play="playing = true"
      @pause="playing = false"
      @error="onTrackError"
    />

    <button
      type="button"
      class="bar-btn"
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

    <span class="bar-clock" aria-live="off">
      {{ formatPluginAudioClock(currentTime) }}
      <span class="bar-clock-sep">/</span>
      {{ formatPluginAudioClock(duration) }}
    </span>

    <el-slider
      class="bar-seek"
      :model-value="seekValue"
      :max="seekMax"
      :step="0.1"
      :disabled="!canSeek"
      :show-tooltip="false"
      :aria-label="t('projectAssets.playerSeek')"
      @input="onSeekInput"
      @change="onSeekChange"
    />

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
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
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
import {
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

const props = defineProps<{
  items: AssetsAudioBarItem[];
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const audioEl = ref<HTMLAudioElement | null>(null);
const currentIndex = ref(0);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(Number.NaN);
const loopEnabled = ref(false);
const shuffleEnabled = ref(false);
const seeking = ref(false);
const remembered = getRememberedPluginAudioVolume();
const volumePercent = ref(remembered.volumePercent);
const muted = ref(remembered.muted);
let pendingSeekTime = 0;

const currentItem = computed(() => props.items[currentIndex.value] || null);
const canSeek = computed(() => Number.isFinite(duration.value) && duration.value > 0);
const seekMax = computed(() => (canSeek.value ? duration.value : 1));
const seekValue = computed(() => (seeking.value ? pendingSeekTime : canSeek.value ? currentTime.value : 0));

function applyVolume(): void {
  const el = audioEl.value;
  if (!el) return;
  el.volume = Math.min(1, Math.max(0, volumePercent.value / 100));
  el.muted = muted.value;
}

function syncFromElement(): void {
  const el = audioEl.value;
  if (!el) return;
  duration.value = readFiniteAudioDuration(el.duration);
  if (!seeking.value) currentTime.value = el.currentTime || 0;
}

function playCurrent(): void {
  const el = audioEl.value;
  if (!el || !currentItem.value) return;
  applyVolume();
  void el.play().catch(() => {
    playing.value = false;
  });
}

function togglePlay(): void {
  const el = audioEl.value;
  if (!el) return;
  if (el.paused) playCurrent();
  else el.pause();
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
    const el = audioEl.value;
    if (el) {
      el.currentTime = 0;
      playCurrent();
    }
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
  // Skip unplayable tracks so one broken file does not stall the playlist.
  playing.value = false;
  if (props.items.length > 1) stepTrack(1);
}

function onSeekInput(value: number | number[]): void {
  if (!canSeek.value) return;
  seeking.value = true;
  pendingSeekTime = Array.isArray(value) ? Number(value[0]) || 0 : value;
}

function onSeekChange(value: number | number[]): void {
  const target = Array.isArray(value) ? Number(value[0]) || 0 : value;
  seeking.value = false;
  const el = audioEl.value;
  if (!el || !canSeek.value) return;
  el.currentTime = Math.min(seekMax.value, Math.max(0, target));
  currentTime.value = el.currentTime;
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

/** New playlist (right-click play again) restarts from its first track. */
watch(
  () => props.items,
  () => {
    currentIndex.value = 0;
    currentTime.value = 0;
    duration.value = Number.NaN;
    void nextTickPlay();
  },
  { immediate: true },
);

watch(currentIndex, () => {
  currentTime.value = 0;
  duration.value = Number.NaN;
  void nextTickPlay();
});

async function nextTickPlay(): Promise<void> {
  await Promise.resolve();
  playCurrent();
}

onUnmounted(() => {
  audioEl.value?.pause();
});
</script>

<style scoped>
.assets-audio-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-elevated);
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
  min-width: 0;
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

.bar-seek {
  flex: 1;
  min-width: 80px;
  --el-slider-height: 4px;
  --el-slider-button-size: 12px;
}

.bar-volume {
  flex: none;
  width: 80px;
  --el-slider-height: 4px;
  --el-slider-button-size: 12px;
}
</style>
