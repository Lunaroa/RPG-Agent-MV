import { parseMapPreviewVariableInput } from '@contract/map-preview-state';
import type { MapPreviewVariableValue } from '../../api/client';

export interface PreviewVariableDraftState {
  drafts: Map<number, string>;
  dirtyIds: Set<number>;
  submitted: Map<number, { raw: string; value: MapPreviewVariableValue }>;
}

export function createPreviewVariableDraftState(): PreviewVariableDraftState {
  return { drafts: new Map(), dirtyIds: new Set(), submitted: new Map() };
}

export function previewVariableDraftValue(
  state: PreviewVariableDraftState,
  id: number,
  effectiveValue: () => MapPreviewVariableValue,
): string {
  if (!state.drafts.has(id)) state.drafts.set(id, String(effectiveValue()));
  return state.drafts.get(id) || '';
}

export function beginPreviewVariableDraft(state: PreviewVariableDraftState, id: number, effective: MapPreviewVariableValue): void {
  if (!state.dirtyIds.has(id)) state.drafts.set(id, String(effective));
}

export function updatePreviewVariableDraft(state: PreviewVariableDraftState, id: number, raw: string): void {
  state.drafts.set(id, raw);
  state.dirtyIds.add(id);
  state.submitted.delete(id);
}

export function preparePreviewVariableDraft(
  state: PreviewVariableDraftState,
  id: number,
  force = false,
): MapPreviewVariableValue | null {
  if (!state.dirtyIds.has(id)) return null;
  const raw = state.drafts.get(id) || '';
  const value = parseMapPreviewVariableInput(raw);
  const submitted = state.submitted.get(id);
  if (!force && submitted?.raw === raw && Object.is(submitted.value, value)) return null;
  state.submitted.set(id, { raw, value });
  return value;
}

export function discardPreviewVariableDraft(state: PreviewVariableDraftState, id: number, effective: MapPreviewVariableValue): void {
  state.dirtyIds.delete(id);
  state.submitted.delete(id);
  state.drafts.set(id, String(effective));
}

export function syncPreviewVariableDrafts(
  state: PreviewVariableDraftState,
  ids: readonly number[],
  effectiveValue: (id: number) => MapPreviewVariableValue,
  focusedId: number | null,
): void {
  const validIds = new Set(ids);
  for (const id of state.drafts.keys()) {
    if (!validIds.has(id)) {
      state.drafts.delete(id);
      state.dirtyIds.delete(id);
      state.submitted.delete(id);
    }
  }
  for (const id of ids) {
    const effective = effectiveValue(id);
    const submitted = state.submitted.get(id);
    if (submitted && Object.is(submitted.value, effective)) {
      state.submitted.delete(id);
      state.dirtyIds.delete(id);
      state.drafts.set(id, String(effective));
    } else if (!state.dirtyIds.has(id) && focusedId !== id) state.drafts.set(id, String(effective));
  }
}

export function resetPreviewVariableDrafts(
  state: PreviewVariableDraftState,
  ids: readonly number[],
  effectiveValue: (id: number) => MapPreviewVariableValue,
): void {
  state.dirtyIds.clear();
  state.submitted.clear();
  state.drafts.clear();
  for (const id of ids) state.drafts.set(id, String(effectiveValue(id)));
}
