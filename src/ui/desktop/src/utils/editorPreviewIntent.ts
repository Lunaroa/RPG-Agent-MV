import type { MapPreviewFrame, MapPreviewSession } from '../api/client';

export type EditorPreviewIntent =
  | { active: false; project: string }
  | { active: true; project: string; mapId: number; mapRevision: string };

export function previewSessionMatchesIntent(session: MapPreviewSession, intent: EditorPreviewIntent): boolean {
  return intent.active
    && session.mapId === intent.mapId
    && (session.mapRevision || '') === intent.mapRevision;
}

export function previewFrameMatchesIntent(frame: MapPreviewFrame, intent: EditorPreviewIntent): boolean {
  return intent.active
    && frame.mapId === intent.mapId
    && frame.mapRevision === intent.mapRevision;
}
