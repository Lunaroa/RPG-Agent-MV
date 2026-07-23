import { describe, expect, it } from 'vitest';

import type { MapPreviewLoadProgress } from '@contract/types';
import {
  formatMapPreviewElapsed,
  mapPreviewProgressRatio,
} from './mapPreviewProgress';

function progress(overrides: Partial<MapPreviewLoadProgress>): MapPreviewLoadProgress {
  return {
    taskId: 'preview-task',
    phase: 'isolation',
    stage: 'copying-project',
    taskStartedAt: '2026-01-01T00:00:00.000Z',
    stageStartedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('map preview loading progress', () => {
  it('uses bytes for determinate copy progress and clamps the result', () => {
    expect(mapPreviewProgressRatio(progress({
      completed: 1,
      total: 4,
      completedBytes: 75,
      totalBytes: 100,
    }))).toBe(.75);
    expect(mapPreviewProgressRatio(progress({ completedBytes: 150, totalBytes: 100 }))).toBe(1);
  });

  it('does not invent a percentage while scanning an unknown total', () => {
    expect(mapPreviewProgressRatio(progress({
      stage: 'scanning-project',
      completed: 1286,
    }))).toBeNull();
  });

  it('treats a known empty stage as complete', () => {
    expect(mapPreviewProgressRatio(progress({ completed: 0, total: 0 }))).toBe(1);
  });

  it('formats elapsed time without project-specific data', () => {
    expect(formatMapPreviewElapsed(9)).toBe('9s');
    expect(formatMapPreviewElapsed(125)).toBe('2:05');
  });
});
