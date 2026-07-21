import type { EditorMode } from '../components/editor/editorTypes';
import type { PaletteTabId } from '../components/editor/editorTypes';
import type { MapPreviewOverrides } from '@contract/types';
import { useWorkspaceStore } from '../stores/workspace';

export const EDITOR_DEFAULT_ZOOM = 0.75;

export interface EditorWorkspaceSelection {
  mapId: number;
  mode: EditorMode;
  zoom?: number;
  expandedMapIds?: number[];
  tileTab?: PaletteTabId;
}

export function clampEditorZoom(value: number): number {
  return Math.max(0.25, Math.min(2, Math.round(value * 4) / 4));
}

export function readEditorZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EDITOR_DEFAULT_ZOOM;
  return clampEditorZoom(value);
}

function normalizeExpandedMapIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? [...new Set(ids)] : undefined;
}

function normalizePaletteTab(value: unknown): PaletteTabId | undefined {
  return ['A', 'B', 'C', 'D', 'E', 'R'].includes(String(value)) ? value as PaletteTabId : undefined;
}

export function readEditorWorkspaceSelection(project: string): EditorWorkspaceSelection | null {
  const workspace = useWorkspaceStore();
  const value = workspace.readProjectEditor(project);
  if (!value) return null;
  return {
    mapId: value.mapId,
    mode: value.mode,
    zoom: value.zoom == null ? undefined : readEditorZoom(value.zoom),
    expandedMapIds: normalizeExpandedMapIds(value.expandedMapIds),
    tileTab: normalizePaletteTab(value.tileTab),
  };
}

export function writeEditorWorkspaceSelection(project: string, selection: EditorWorkspaceSelection): void {
  const workspace = useWorkspaceStore();
  workspace.patchProjectEditor(project, {
    mapId: selection.mapId,
    mode: selection.mode,
    zoom: readEditorZoom(selection.zoom),
    expandedMapIds: normalizeExpandedMapIds(selection.expandedMapIds) ?? [],
    tileTab: selection.tileTab,
    previewOverrides: workspace.readProjectEditor(project)?.previewOverrides,
  });
}

export function readEditorPreviewOverrides(project: string): MapPreviewOverrides {
  return useWorkspaceStore().readProjectEditor(project)?.previewOverrides || { switches: {}, variables: {}, selfSwitches: {} };
}

export function writeEditorPreviewOverrides(project: string, overrides: MapPreviewOverrides): void {
  const workspace = useWorkspaceStore();
  const current = workspace.readProjectEditor(project);
  if (!current) throw new Error('Editor workspace state must be initialized before preview overrides are saved.');
  workspace.patchProjectEditor(project, { ...current, previewOverrides: overrides });
}
