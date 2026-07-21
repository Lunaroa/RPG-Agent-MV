export interface PreviewEventSelectionChange {
  selectedEventId: number | null;
  focus: boolean;
}

export function previewEventSelectionChange(
  currentEventId: number | null,
  requestedEventId: number | null,
  availableEventIds: ReadonlySet<number>,
): PreviewEventSelectionChange {
  if (requestedEventId == null || requestedEventId === currentEventId || !availableEventIds.has(requestedEventId)) {
    return { selectedEventId: null, focus: false };
  }
  return { selectedEventId: requestedEventId, focus: true };
}
