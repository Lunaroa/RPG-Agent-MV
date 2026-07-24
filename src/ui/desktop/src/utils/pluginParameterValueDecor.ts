import type { Component } from 'vue';
import {
  Bug,
  Clapperboard,
  FlaskConical,
  GraduationCap,
  Grid3x3,
  Hash,
  Map as MapIcon,
  Package,
  ScrollText,
  Shield,
  Sparkles,
  Sword,
  ToggleLeft,
  Users,
  UsersRound,
} from '@lucide/vue';
import type {
  EditorActorCatalogEntry,
  EditorAnimationCatalogEntry,
  EditorIconCatalogEntry,
  EditorProjectCatalog,
  PluginParameterSchemaField,
} from '../api/client';
import {
  inferPluginFileMediaKind,
  resolvePluginParameterFileAssetsFromCatalog,
} from './pluginParameterFileAssets';

export type PluginParameterValueIconId =
  | 'actor'
  | 'class'
  | 'skill'
  | 'item'
  | 'weapon'
  | 'armor'
  | 'enemy'
  | 'troop'
  | 'state'
  | 'animation'
  | 'tileset'
  | 'commonEvent'
  | 'switch'
  | 'variable'
  | 'map';

export type PluginParameterValueMedia =
  | {
      kind: 'actor';
      characterName: string;
      characterIndex: number;
    }
  | {
      kind: 'icon';
      iconIndex: number;
    }
  | {
      kind: 'image';
      url: string;
    };

export type PluginParameterValueDecor = {
  icon: Component | null;
  iconId: PluginParameterValueIconId | null;
  media: PluginParameterValueMedia | null;
};

const ICON_BY_TABLE: Record<string, { id: PluginParameterValueIconId; icon: Component }> = {
  Actors: { id: 'actor', icon: Users },
  Classes: { id: 'class', icon: GraduationCap },
  Skills: { id: 'skill', icon: Sparkles },
  Items: { id: 'item', icon: Package },
  Weapons: { id: 'weapon', icon: Sword },
  Armors: { id: 'armor', icon: Shield },
  Enemies: { id: 'enemy', icon: Bug },
  Troops: { id: 'troop', icon: UsersRound },
  States: { id: 'state', icon: FlaskConical },
  Animations: { id: 'animation', icon: Clapperboard },
  Tilesets: { id: 'tileset', icon: Grid3x3 },
  CommonEvents: { id: 'commonEvent', icon: ScrollText },
  'System.switches': { id: 'switch', icon: ToggleLeft },
  'System.variables': { id: 'variable', icon: Hash },
};

const ICONSET_TABLES = new Set([
  'Skills',
  'Items',
  'Weapons',
  'Armors',
  'States',
]);

/**
 * Resolve value-column decoration: database icons, actor/file/animation media thumbs.
 * Media URLs come only from the editor catalog (SSOT); missing assets → no thumb.
 */
export function resolvePluginParameterValueDecor(
  field: PluginParameterSchemaField | null | undefined,
  value: unknown,
  catalog: EditorProjectCatalog | null | undefined,
): PluginParameterValueDecor {
  if (!field) return { icon: null, iconId: null, media: null };

  if (field.kind === 'map') {
    return { icon: MapIcon, iconId: 'map', media: null };
  }

  if (field.kind === 'file') {
    return {
      icon: null,
      iconId: null,
      media: resolveFileImageMedia(field.directory, value, catalog),
    };
  }

  if (field.kind !== 'database') {
    return { icon: null, iconId: null, media: null };
  }

  const table = String(field.databaseTable || '');
  const mapped = ICON_BY_TABLE[table];
  const icon = mapped?.icon ?? null;
  const iconId = mapped?.id ?? null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || !catalog) {
    return { icon, iconId, media: null };
  }

  if (table === 'Actors') {
    const actor = catalog.actors.find((entry) => entry.id === id) as EditorActorCatalogEntry | undefined;
    const characterName = String(actor?.characterName || '').trim();
    if (!characterName) return { icon, iconId, media: null };
    return {
      icon,
      iconId,
      media: {
        kind: 'actor',
        characterName,
        characterIndex: Number.isInteger(actor?.characterIndex) ? Number(actor?.characterIndex) : 0,
      },
    };
  }

  if (ICONSET_TABLES.has(table)) {
    const entry = resolveIconCatalogEntry(table, id, catalog);
    const iconIndex = Math.floor(Number(entry?.iconIndex));
    if (!Number.isFinite(iconIndex) || iconIndex <= 0) return { icon, iconId, media: null };
    if (!catalog.assets.system.some((asset) => asset.name === 'IconSet' && asset.url)) {
      return { icon, iconId, media: null };
    }
    return { icon, iconId, media: { kind: 'icon', iconIndex } };
  }

  if (table === 'Animations') {
    const animation = catalog.animations.find((entry) => entry.id === id) as
      | EditorAnimationCatalogEntry
      | undefined;
    const sheetName = String(animation?.animation1Name || '').trim();
    if (!sheetName) return { icon, iconId, media: null };
    const asset = catalog.assets.animations.find((entry) => entry.name === sheetName);
    if (!asset?.url) return { icon, iconId, media: null };
    return { icon, iconId, media: { kind: 'image', url: asset.url } };
  }

  return { icon, iconId, media: null };
}

function resolveIconCatalogEntry(
  table: string,
  id: number,
  catalog: EditorProjectCatalog,
): EditorIconCatalogEntry | undefined {
  const list =
    table === 'Skills' ? catalog.skills
      : table === 'Items' ? catalog.items
        : table === 'Weapons' ? catalog.weapons
          : table === 'Armors' ? catalog.armors
            : table === 'States' ? catalog.states
              : null;
  if (!list) return undefined;
  return list.find((entry) => entry.id === id) as EditorIconCatalogEntry | undefined;
}

function resolveFileImageMedia(
  directory: unknown,
  value: unknown,
  catalog: EditorProjectCatalog | null | undefined,
): PluginParameterValueMedia | null {
  const selected = String(value ?? '').trim();
  if (!selected) return null;
  if (inferPluginFileMediaKind(String(directory || '')) !== 'image') return null;
  const resolved = resolvePluginParameterFileAssetsFromCatalog(catalog, directory);
  if (!resolved || resolved.ok !== true) return null;
  const asset = resolved.assets.find((entry) => entry.name === selected);
  if (!asset?.url) return null;
  return { kind: 'image', url: asset.url };
}
