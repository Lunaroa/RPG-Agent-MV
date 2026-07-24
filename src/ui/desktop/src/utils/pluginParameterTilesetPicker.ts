import type {
  EditorProjectCatalog,
  EditorTilesetCatalogEntry,
} from '../api/client';
import { resolveTilesetPreviewSheetName } from './pluginParameterValueDecor';

export type PluginTilesetPickerOption = {
  id: number;
  label: string;
  /** Catalog asset URL for the cheap preview sheet; null when no sheet is available. */
  previewUrl: string | null;
};

/**
 * Build tileset picker rows from the editor catalog (SSOT).
 * Preview sheet prefers A5, else first non-empty tilesetNames entry.
 */
export function buildPluginParameterTilesetOptions(
  catalog: EditorProjectCatalog | null | undefined,
): PluginTilesetPickerOption[] {
  if (!catalog) return [];
  return (catalog.tilesets || []).map((entry) => {
    const tileset = entry as EditorTilesetCatalogEntry;
    const sheetName = resolveTilesetPreviewSheetName(tileset.tilesetNames);
    const asset = sheetName
      ? catalog.assets.tilesets.find((item) => item.name === sheetName)
      : undefined;
    return {
      id: tileset.id,
      label: `${tileset.id} · ${tileset.name}`,
      previewUrl: asset?.url || null,
    };
  });
}

export function resolvePluginTilesetPreviewUrl(
  catalog: EditorProjectCatalog | null | undefined,
  tilesetId: unknown,
): string | null {
  const id = Number(tilesetId);
  if (!catalog || !Number.isInteger(id) || id <= 0) return null;
  const tileset = catalog.tilesets.find((entry) => entry.id === id) as
    | EditorTilesetCatalogEntry
    | undefined;
  if (!tileset) return null;
  const sheetName = resolveTilesetPreviewSheetName(tileset.tilesetNames);
  if (!sheetName) return null;
  return catalog.assets.tilesets.find((entry) => entry.name === sheetName)?.url || null;
}

export function formatPluginTilesetDisplayLabel(
  catalog: EditorProjectCatalog | null | undefined,
  tilesetId: unknown,
  noneLabel: string,
): string {
  const id = Number(tilesetId);
  if (!Number.isInteger(id) || id <= 0) return noneLabel;
  const tileset = catalog?.tilesets.find((entry) => entry.id === id);
  if (!tileset) return String(tilesetId);
  return `${tileset.id} · ${tileset.name}`;
}
