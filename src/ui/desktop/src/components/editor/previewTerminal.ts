import type { MapPreviewConsoleEntry, MapPreviewConsoleLevel } from '@contract/types';

export type PreviewTerminalLevel = MapPreviewConsoleLevel | 'command';
export type PreviewTerminalSource = MapPreviewConsoleEntry['source'] | 'input';

export interface PreviewTerminalEntry {
  id: number;
  level: PreviewTerminalLevel;
  source: PreviewTerminalSource;
  timestamp: number;
  text: string;
  requestId?: string;
}

export function appendPreviewTerminalEntry(
  entries: readonly PreviewTerminalEntry[],
  entry: PreviewTerminalEntry,
  maximum = 500,
): PreviewTerminalEntry[] {
  const limit = Math.max(1, Math.floor(maximum));
  return [...entries, entry].slice(-limit);
}

export function previewTerminalEntryMatches(entry: PreviewTerminalEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${entry.level} ${entry.requestId || ''} ${entry.text}`.toLocaleLowerCase().includes(needle);
}

export function isPreviewTerminalNearBottom(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold = 16,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}
