import type { EditorEventListItem } from './editorTypes';

export function previewEventMatchesQuery(event: EditorEventListItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const id = String(event.id);
  const paddedId = id.padStart(3, '0');
  return needle === id
    || needle === paddedId
    || needle === `ev${id}`
    || needle === `ev${paddedId}`
    || event.name.trim().toLocaleLowerCase().includes(needle);
}

export function filterPreviewSelfSwitchEvents(events: EditorEventListItem[], query: string): EditorEventListItem[] {
  return events.filter((event) => previewEventMatchesQuery(event, query));
}
