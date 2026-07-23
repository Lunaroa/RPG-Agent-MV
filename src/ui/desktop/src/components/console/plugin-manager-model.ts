import type {
  ManagedPluginEntry,
  ManagedPluginFile,
  PluginConfigurationResult,
  RpgMakerEngine,
} from '../../api/client';

export interface PluginManagerGroups {
  configured: ManagedPluginEntry[];
  unconfigured: ManagedPluginFile[];
  enabledCount: number;
  configuredCount: number;
}

export type PluginEngineTarget = 'MV' | 'MZ';

export type PluginHelpLanguageMessageKey =
  | 'plugins.helpLanguageDefault'
  | 'plugins.helpLanguageJapanese'
  | 'plugins.helpLanguageEnglish'
  | 'plugins.helpLanguageChinese';

export type PluginReferenceTarget =
  | { kind: 'configured'; name: string }
  | { kind: 'file'; relativePath: string };

export function buildPluginManagerGroups(
  configuration: PluginConfigurationResult | null,
  search = '',
): PluginManagerGroups {
  const configured = configuration?.plugins || [];
  const configuredNames = new Set(configured.map((plugin) => plugin.name).filter(Boolean));
  const unconfigured = (configuration?.pluginFiles || []).filter(
    (file) => !configuredNames.has(file.name),
  );
  const query = search.trim().toLocaleLowerCase();
  return {
    configured: query
      ? configured.filter((plugin) => matchesPluginSearch([
          plugin.name,
          plugin.header.plugindesc,
          plugin.description,
          plugin.header.displayPath,
        ], query))
      : configured,
    unconfigured: query
      ? unconfigured.filter((file) => matchesPluginSearch([
          file.name,
          file.header.plugindesc,
          file.header.displayPath,
        ], query))
      : unconfigured,
    enabledCount: configured.filter((plugin) => plugin.status).length,
    configuredCount: configured.length,
  };
}

export function isPluginReorderLocked(search: string, busy: boolean): boolean {
  return Boolean(search.trim()) || busy;
}

export function pluginSupportsEngine(
  targets: string[],
  engine: RpgMakerEngine,
): boolean | null {
  const normalized = pluginEngineTargets(targets);
  if (!normalized.length) return null;
  const current = engine === 'rpg-maker-mz' ? 'MZ' : 'MV';
  return normalized.includes(current);
}

export function pluginEngineTargets(targets: string[]): PluginEngineTarget[] {
  const declared = new Set(
    targets.map((target) => String(target || '').trim().toUpperCase()).filter(Boolean),
  );
  return (['MV', 'MZ'] as const).filter((target) => declared.has(target));
}

export function pluginHelpLanguageKey(language: string): PluginHelpLanguageMessageKey | null {
  const normalized = String(language || '').trim().toLocaleLowerCase().replace(/_/g, '-');
  if (!normalized) return 'plugins.helpLanguageDefault';
  if (normalized === 'ja' || normalized === 'jp' || normalized.startsWith('ja-')) {
    return 'plugins.helpLanguageJapanese';
  }
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'plugins.helpLanguageEnglish';
  }
  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'plugins.helpLanguageChinese';
  }
  return null;
}

export function resolvePluginReference(
  configuration: PluginConfigurationResult | null,
  name: string,
): PluginReferenceTarget | null {
  const normalizedName = String(name || '').trim();
  if (!configuration || !normalizedName) return null;
  const configured = configuration.plugins.find((plugin) => plugin.name === normalizedName);
  if (configured) return { kind: 'configured', name: configured.name };
  const file = buildPluginManagerGroups(configuration).unconfigured.find(
    (entry) => entry.name === normalizedName,
  );
  return file ? { kind: 'file', relativePath: file.relativePath } : null;
}

export function movePluginName(
  names: string[],
  pluginName: string,
  requestedIndex: number,
): string[] {
  const from = names.indexOf(pluginName);
  if (from < 0 || requestedIndex < 0 || requestedIndex > names.length) return names;
  const next = [...names];
  const [moved] = next.splice(from, 1);
  const insertion = Math.max(0, Math.min(
    next.length,
    from < requestedIndex ? requestedIndex - 1 : requestedIndex,
  ));
  next.splice(insertion, 0, moved);
  return next;
}

function matchesPluginSearch(values: unknown[], query: string): boolean {
  return values.some(
    (value) => String(value || '').toLocaleLowerCase().includes(query),
  );
}
