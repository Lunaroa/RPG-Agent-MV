import type { MapPreviewOverrides, MapPreviewStateCatalog } from '@contract/types';
import { parseMapPreviewSelfSwitchKey } from '@contract/map-preview-state';

export function filterMapPreviewOverrides(
  overrides: MapPreviewOverrides,
  catalog: MapPreviewStateCatalog,
  mapId?: number | null,
): MapPreviewOverrides {
  const switchIds = new Set(catalog.switches.map((entry) => String(entry.id)));
  const variableIds = new Set(catalog.variables.map((entry) => String(entry.id)));
  return {
    switches: Object.fromEntries(Object.entries(overrides.switches).filter(([id]) => switchIds.has(id))),
    variables: Object.fromEntries(Object.entries(overrides.variables).filter(([id]) => variableIds.has(id))),
    selfSwitches: Object.fromEntries(Object.entries(overrides.selfSwitches).filter(([key]) => {
      const parsed = parseMapPreviewSelfSwitchKey(key);
      return parsed && (mapId == null || parsed.mapId === mapId);
    })),
  };
}

export function removeMapPreviewOverrides(
  overrides: MapPreviewOverrides,
  catalog: MapPreviewStateCatalog,
): MapPreviewOverrides {
  const switches = { ...overrides.switches };
  const variables = { ...overrides.variables };
  for (const entry of catalog.switches) delete switches[String(entry.id)];
  for (const entry of catalog.variables) delete variables[String(entry.id)];
  return { switches, variables, selfSwitches: {} };
}
