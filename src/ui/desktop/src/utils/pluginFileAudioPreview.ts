/** Survives Vue remounts when the file picker swaps `:key` on preview src. */
let rememberedVolumePercent = 100;
let rememberedMuted = false;

export function getRememberedPluginAudioVolume(): { volumePercent: number; muted: boolean } {
  return { volumePercent: rememberedVolumePercent, muted: rememberedMuted };
}

export function rememberPluginAudioVolume(volumePercent: number, muted: boolean): void {
  const clamped = Math.min(100, Math.max(0, volumePercent));
  rememberedVolumePercent = clamped;
  rememberedMuted = muted || clamped <= 0;
}

/** Format seconds as m:ss (or h:mm:ss when ≥ 1 hour). Invalid values → `--:--`. */
export function formatPluginAudioClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Progress ratio in [0, 1] for a determinate seek bar. */
export function pluginAudioProgressRatio(current: number, duration: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, current / duration));
}

export function readFiniteAudioDuration(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : Number.NaN;
}

/** Default bar count for the preview waveform canvas. */
export const PLUGIN_AUDIO_WAVEFORM_BAR_COUNT = 160;

/**
 * Downsample a mono channel into normalized peak bars in [0, 1].
 * Empty / invalid input yields an empty array (caller shows a flat placeholder).
 */
export function buildAudioWaveformPeaks(
  channelData: ArrayLike<number>,
  barCount: number = PLUGIN_AUDIO_WAVEFORM_BAR_COUNT,
): number[] {
  const count = Math.max(1, Math.floor(barCount));
  const length = channelData.length;
  if (length <= 0) return [];
  const peaks = new Array<number>(count).fill(0);
  const block = Math.max(1, Math.floor(length / count));
  for (let i = 0; i < count; i += 1) {
    const start = i * block;
    const end = i === count - 1 ? length : Math.min(length, start + block);
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const value = Math.abs(Number(channelData[j]) || 0);
      if (value > peak) peak = value;
    }
    peaks[i] = peak;
  }
  let max = 0;
  for (const peak of peaks) {
    if (peak > max) max = peak;
  }
  if (max <= 0) return peaks.map(() => 0);
  return peaks.map((peak) => peak / max);
}

export type PluginAudioPlaybackBundle = {
  objectUrl: string;
  /** Finite seconds when decode succeeds; otherwise NaN (wait for media element). */
  durationSeconds: number;
  /** Normalized waveform peaks for canvas drawing; empty when decode fails. */
  peaks: number[];
};

/**
 * Fetch audio once into a blob object URL (so the media element can seek and
 * usually reports a finite duration). Also decode duration and waveform peaks.
 */
export async function createPluginAudioPlaybackBundle(src: string): Promise<PluginAudioPlaybackBundle> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to load audio preview (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  let durationSeconds = Number.NaN;
  let peaks: number[] = [];
  try {
    const decoded = await decodePluginAudioBlob(blob);
    durationSeconds = readFiniteAudioDuration(decoded.duration);
    const channel = decoded.numberOfChannels > 0 ? decoded.getChannelData(0) : new Float32Array();
    peaks = buildAudioWaveformPeaks(channel);
  } catch {
    durationSeconds = Number.NaN;
    peaks = [];
  }
  return { objectUrl, durationSeconds, peaks };
}

export async function decodePluginAudioBlobDurationSeconds(blob: Blob): Promise<number> {
  const decoded = await decodePluginAudioBlob(blob);
  return readFiniteAudioDuration(decoded.duration);
}

async function decodePluginAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const buffer = await blob.arrayBuffer();
  const Context = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  try {
    return await context.decodeAudioData(buffer.slice(0));
  } finally {
    await context.close();
  }
}

/** Map a click/pointer x on the waveform to a seek time. */
export function seekTimeFromWaveformPointer(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || rectWidth <= 0) {
    return 0;
  }
  const ratio = Math.min(1, Math.max(0, (clientX - rectLeft) / rectWidth));
  return ratio * durationSeconds;
}
