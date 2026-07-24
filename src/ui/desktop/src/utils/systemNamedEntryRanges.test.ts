import { describe, expect, test } from 'vitest';
import {
  buildSystemNamedEntryRanges,
  displaySystemNamedEntryName,
  formatSystemNamedEntryId,
} from './systemNamedEntryRanges';

describe('system named entry ranges', () => {
  test('builds RM-style pages of twenty', () => {
    expect(buildSystemNamedEntryRanges(40)).toEqual([
      { start: 1, end: 20 },
      { start: 21, end: 40 },
    ]);
    expect(buildSystemNamedEntryRanges(25)).toEqual([
      { start: 1, end: 20 },
      { start: 21, end: 25 },
    ]);
    expect(buildSystemNamedEntryRanges(0)).toEqual([]);
  });

  test('formats ids and empty placeholder names', () => {
    expect(formatSystemNamedEntryId(23)).toBe('0023');
    expect(displaySystemNamedEntryName(23, '')).toBe('');
    expect(displaySystemNamedEntryName(23, '#23')).toBe('');
    expect(displaySystemNamedEntryName(23, 'Clock')).toBe('Clock');
  });
});
