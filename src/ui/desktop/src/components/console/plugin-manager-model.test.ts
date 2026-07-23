import { describe, expect, test } from 'vitest';
import type {
  ManagedPluginEntry,
  ManagedPluginFile,
  PluginConfigurationResult,
  PluginHeaderMetadata,
} from '../../api/client';
import {
  buildPluginManagerGroups,
  isPluginReorderLocked,
  movePluginIndex,
  pluginEngineTargets,
  pluginHelpLanguageKey,
  pluginSupportsEngine,
  resolvePluginReference,
} from './plugin-manager-model';

const header = (name: string, description = ''): PluginHeaderMetadata => ({
  target: ['MZ'],
  plugindesc: description,
  help: '',
  helpSections: [],
  author: '',
  url: '',
  base: [],
  orderAfter: [],
  displayPath: `js/plugins/${name}.js`,
});

const plugin = (name: string, status: boolean): ManagedPluginEntry => ({
  index: 0,
  name,
  status,
  description: '',
  parameters: {},
  parameterCount: 0,
  fileName: `${name}.js`,
  fileRelativePath: `js/plugins/${name}.js`,
  fileExists: true,
  parameterSchemaWarnings: [],
  commandHints: [],
  targets: ['MZ'],
  header: header(name, `${name} description`),
});

const file = (name: string, deleted = false): ManagedPluginFile => ({
  name,
  fileName: `${name}.js`,
  relativePath: `js/plugins/${name}.js`,
  exists: !deleted,
  staged: deleted,
  deleted,
  size: deleted ? null : 100,
  header: header(name, `${name} description`),
});

function configuration(): PluginConfigurationResult {
  const configured = [plugin('Core', true), plugin('Feature', false)];
  configured[0].index = 0;
  configured[1].index = 1;
  return {
    project: 'projects/sample',
    relativePath: 'js/plugins.js',
    exists: true,
    plugins: configured,
    pluginFiles: [file('Core'), file('Feature'), file('Extra'), file('Removed', true)],
    validation: { ok: true, issues: [] },
  };
}

describe('plugin manager model', () => {
  test('groups configured, unconfigured, and pending-delete files while counting configurations only', () => {
    const groups = buildPluginManagerGroups(configuration());
    expect(groups.configured.map((entry) => entry.name)).toEqual(['Core', 'Feature']);
    expect(groups.unconfigured.map((entry) => [entry.name, entry.deleted])).toEqual([
      ['Extra', false],
      ['Removed', true],
    ]);
    expect(groups.enabledCount).toBe(1);
    expect(groups.configuredCount).toBe(2);
  });

  test('filters both groups and locks reordering only while search or an action is active', () => {
    const groups = buildPluginManagerGroups(configuration(), 'extra');
    expect(groups.configured).toEqual([]);
    expect(groups.unconfigured.map((entry) => entry.name)).toEqual(['Extra']);
    expect(isPluginReorderLocked('extra', false)).toBe(true);
    expect(isPluginReorderLocked('  ', false)).toBe(false);
    expect(isPluginReorderLocked('', true)).toBe(true);
  });

  test('moves within the complete configured order without dropping other entries', () => {
    expect(movePluginIndex([0, 1, 2, 3], 1, 4)).toEqual([0, 2, 3, 1]);
    expect(movePluginIndex([0, 1, 2, 3], 2, 0)).toEqual([2, 0, 1, 3]);
  });

  test('compares declared plugin targets with the current RPG Maker engine', () => {
    expect(pluginSupportsEngine([], 'rpg-maker-mv')).toBeNull();
    expect(pluginSupportsEngine(['MV'], 'rpg-maker-mv')).toBe(true);
    expect(pluginSupportsEngine(['MV', 'MZ'], 'rpg-maker-mz')).toBe(true);
    expect(pluginSupportsEngine(['MZ'], 'rpg-maker-mv')).toBe(false);
    expect(pluginSupportsEngine(['mv'], 'rpg-maker-mz')).toBe(false);
    expect(pluginEngineTargets(['mz', 'unknown', 'MV', 'MZ'])).toEqual(['MV', 'MZ']);
  });

  test('maps known help languages to product labels while preserving unknown codes', () => {
    expect(pluginHelpLanguageKey('')).toBe('plugins.helpLanguageDefault');
    expect(pluginHelpLanguageKey('ja')).toBe('plugins.helpLanguageJapanese');
    expect(pluginHelpLanguageKey('jp')).toBe('plugins.helpLanguageJapanese');
    expect(pluginHelpLanguageKey('en-US')).toBe('plugins.helpLanguageEnglish');
    expect(pluginHelpLanguageKey('zh_CN')).toBe('plugins.helpLanguageChinese');
    expect(pluginHelpLanguageKey('ko')).toBeNull();
  });

  test('resolves dependency navigation only to real configured or unconfigured plugins', () => {
    expect(resolvePluginReference(configuration(), 'Core')).toEqual({
      kind: 'configured',
      name: 'Core',
    });
    expect(resolvePluginReference(configuration(), 'Extra')).toEqual({
      kind: 'file',
      relativePath: 'js/plugins/Extra.js',
    });
    expect(resolvePluginReference(configuration(), 'Missing')).toBeNull();
  });
});
