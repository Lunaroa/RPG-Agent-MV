import type { PluginParameterSchemaField } from '../api/client';
import type { CommandField } from '../composables/eventCommandCatalog';
import { PLUGIN_FILE_DIRECTORY_BUCKETS } from './pluginParameterFileAssets';

/**
 * Maps the small, path-oriented event-command field contract onto the field
 * contract already consumed by the plugin parameter editor.
 *
 * This is deliberately an adapter, not a second field registry: command
 * definitions remain the source of truth for event commands and the returned
 * schema is only used while rendering the existing plugin controls.
 */
export function commandFieldToPluginParameterField(
  field: CommandField,
): PluginParameterSchemaField | null {
  const base = {
    key: field.path.map((part) => String(part)).join('.'),
    label: field.label,
    description: '',
  };

  if (field.kind === 'database') {
    const catalog = field.catalog;
    if (catalog === 'maps') {
      return { ...base, kind: 'map', rawType: 'map' };
    }

    const databaseTable = DATABASE_TABLE_BY_CATALOG[catalog || ''];
    return databaseTable
      ? { ...base, kind: 'database', rawType: databaseTable, databaseTable }
      : null;
  }

  if (field.kind === 'asset') {
    const bucket = PLUGIN_FILE_DIRECTORY_BUCKETS.find((entry) => entry.key === field.asset);
    return bucket
      ? { ...base, kind: 'file', rawType: 'file', directory: bucket.directory }
      : null;
  }

  return null;
}

const DATABASE_TABLE_BY_CATALOG: Record<string, string> = {
  actors: 'Actors',
  classes: 'Classes',
  skills: 'Skills',
  items: 'Items',
  weapons: 'Weapons',
  armors: 'Armors',
  enemies: 'Enemies',
  troops: 'Troops',
  states: 'States',
  animations: 'Animations',
  tilesets: 'Tilesets',
  commonEvents: 'CommonEvents',
  switches: 'System.switches',
  variables: 'System.variables',
};
