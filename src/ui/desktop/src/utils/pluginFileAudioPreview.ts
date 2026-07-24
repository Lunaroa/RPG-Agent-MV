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

export type PluginAudioPlaybackBundle = {
  objectUrl: string;
  /** Finite seconds when decode succeeds; otherwise NaN (wait for media element). */
  durationSeconds: number;
};

/**
 * Fetch audio once into a blob object URL (so the media element can seek and
 * usually reports a finite duration). Also decode duration when possible.
 */
export async function createPluginAudioPlaybackBundle(src: string): Promise<PluginAudioPlaybackBundle> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to load audio preview (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  let durationSeconds = Number.NaN;
  try {
    durationSeconds = await decodePluginAudioBlobDurationSeconds(blob);
  } catch {
    durationSeconds = Number.NaN;
  }
  return { objectUrl, durationSeconds };
}

export async function decodePluginAudioBlobDurationSeconds(blob: Blob): Promise<number> {
  const buffer = await blob.arrayBuffer();
  const Context = window.AudioContext
    || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    return readFiniteAudioDuration(decoded.duration);
  } finally {
    await context.close();
  }
}
