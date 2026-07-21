import { describe, expect, it } from 'vitest';
import {
  createPreviewVariableDraftState,
  discardPreviewVariableDraft,
  preparePreviewVariableDraft,
  previewVariableDraftValue,
  resetPreviewVariableDrafts,
  syncPreviewVariableDrafts,
  updatePreviewVariableDraft,
} from './previewVariableDrafts';

describe('preview variable drafts', () => {
  it('preserves input across runtime refreshes until the submitted value is confirmed', () => {
    const state = createPreviewVariableDraftState();
    expect(previewVariableDraftValue(state, 1, () => 0)).toBe('0');
    updatePreviewVariableDraft(state, 1, '001');
    syncPreviewVariableDrafts(state, [1], () => 0, 1);
    expect(state.drafts.get(1)).toBe('001');
    expect(preparePreviewVariableDraft(state, 1)).toBe(1);
    syncPreviewVariableDrafts(state, [1], () => 0, null);
    expect(state.drafts.get(1)).toBe('001');
    syncPreviewVariableDrafts(state, [1], () => 1, null);
    expect(state.drafts.get(1)).toBe('1');
    expect(state.dirtyIds.has(1)).toBe(false);
  });

  it('keeps a failed draft and permits an explicit retry', () => {
    const state = createPreviewVariableDraftState();
    updatePreviewVariableDraft(state, 2, 'hello');
    expect(preparePreviewVariableDraft(state, 2)).toBe('hello');
    syncPreviewVariableDrafts(state, [2], () => '', null);
    expect(state.drafts.get(2)).toBe('hello');
    expect(preparePreviewVariableDraft(state, 2)).toBeNull();
    expect(preparePreviewVariableDraft(state, 2, true)).toBe('hello');
  });

  it('discards or resets drafts to the effective runtime value', () => {
    const state = createPreviewVariableDraftState();
    updatePreviewVariableDraft(state, 3, '1e3');
    discardPreviewVariableDraft(state, 3, 8);
    expect(state.drafts.get(3)).toBe('8');
    updatePreviewVariableDraft(state, 3, 'changed');
    resetPreviewVariableDrafts(state, [3], () => 'baseline');
    expect(state.drafts.get(3)).toBe('baseline');
    expect(state.dirtyIds.size).toBe(0);
  });
});
