import { describe, expect, it } from 'vitest';
import { previewEventSelectionChange } from './previewEventSelection';

describe('preview event selection', () => {
  const available = new Set([1, 2]);

  it('focuses only when explicitly selecting a different valid event', () => {
    expect(previewEventSelectionChange(null, 1, available)).toEqual({ selectedEventId: 1, focus: true });
    expect(previewEventSelectionChange(1, 2, available)).toEqual({ selectedEventId: 2, focus: true });
  });

  it('clears on a repeated click, a blank click, or an invalid event', () => {
    expect(previewEventSelectionChange(1, 1, available)).toEqual({ selectedEventId: null, focus: false });
    expect(previewEventSelectionChange(1, null, available)).toEqual({ selectedEventId: null, focus: false });
    expect(previewEventSelectionChange(1, 3, available)).toEqual({ selectedEventId: null, focus: false });
  });
});
