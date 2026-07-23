import type { MapPreviewLoadProgress } from '@contract/types';

export function mapPreviewProgressRatio(progress?: MapPreviewLoadProgress): number | null {
  if (!progress) return null;
  if (isProgressPair(progress.completedBytes, progress.totalBytes)) {
    return progress.totalBytes === 0 ? 1 : clampRatio(progress.completedBytes! / progress.totalBytes!);
  }
  if (isProgressPair(progress.completed, progress.total)) {
    return progress.total === 0 ? 1 : clampRatio(progress.completed! / progress.total!);
  }
  return null;
}

export function formatMapPreviewBytes(value: number, locale: string): string {
  const bytes = Math.max(0, Number.isFinite(value) ? value : 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const maximumFractionDigits = unit === 0 || amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(amount)} ${units[unit]}`;
}

export function formatMapPreviewElapsed(secondsInput: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(secondsInput) ? secondsInput : 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${seconds}s`;
}

function isProgressPair(completed?: number, total?: number): boolean {
  return Number.isFinite(completed) && Number.isFinite(total) && total! >= 0 && completed! >= 0;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}
