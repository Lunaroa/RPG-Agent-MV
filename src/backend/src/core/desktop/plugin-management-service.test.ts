import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { bootstrapDatabase } from '../db/bootstrap.ts';
import { closeDatabase } from '../db/pool.ts';
import { readJson, writeJson } from '../rmmv/json.ts';
import {
  applyProjectStaging,
  getProjectFileForRead,
  getProjectStagingStatus,
  stageProjectFilesAtomically,
} from './staging-service.ts';
import {
  addPluginConfigurationEntry,
  deletePluginFile,
  installPluginFile,
  readPluginConfiguration,
  removePluginConfigurationEntry,
  reorderPlugins,
  setPluginEnabled,
  updatePluginParameters,
  validatePluginConfiguration,
} from './plugin-management-service.ts';

interface Fixture {
  root: string;
  project: string;
}

describe('plugin management service', { concurrency: false }, () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = createFixture();
    await bootstrapDatabase(fixture.root, {
      dbPath: path.join(fixture.root, 'data', 'test-rmmv.db'),
      importLegacyJson: false,
    });
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('reads plugins.js and plugin file list', () => {
    const config = readPluginConfiguration(fixture.root, fixture.project);

    assert.equal(config.relativePath, 'www/js/plugins.js');
    assert.equal(config.exists, true);
    assert.deepEqual(config.plugins.map((plugin) => plugin.name), ['CoreFix', 'QuestLog', 'OldPlugin']);
    assert.equal(config.plugins[0].status, true);
    assert.equal(config.plugins[0].parameterCount, 1);
    assert.equal(config.plugins[0].fileExists, true);
    assert.deepEqual(config.pluginFiles.map((file) => file.fileName), ['CoreFix.js', 'OldPlugin.js', 'QuestLog.js']);
    assert.equal(config.validation.ok, true);
  });

  test('reads display metadata only from the default plugin header', () => {
    fs.writeFileSync(path.join(fixture.project, 'www', 'js', 'plugins', 'Documentation.js'), `/*:ja
 * @plugindesc Localized description must not be selected.
 * @target MZ
 * @base LocalizedOnly
 * @param localized
 * @type string
 * @help
 * Localized help must not be selected.
 */
/*:
 * @target MV
 * @plugindesc Default description.
 * @author Sample Author
 * @url javascript:alert(1)
 * @base CoreFix
 * @orderAfter CoreFix
 * @help
 * First help line.
 *
 * Second help line.
 * @param ignored
 * @type string
 */
`, 'utf8');
    writePluginsJs(fixture.project, [
      { name: 'Documentation', status: false, description: 'Configuration fallback', parameters: {} },
    ]);

    const plugin = readPluginConfiguration(fixture.root, fixture.project).plugins[0];
    assert.deepEqual(plugin.header.target, ['MV']);
    assert.equal(plugin.header.plugindesc, 'Default description.');
    assert.equal(plugin.header.author, 'Sample Author');
    assert.equal(plugin.header.url, 'javascript:alert(1)');
    assert.equal(plugin.header.urlHref, undefined);
    assert.deepEqual(plugin.header.base, ['CoreFix']);
    assert.deepEqual(plugin.header.orderAfter, ['CoreFix']);
    assert.deepEqual(plugin.targets, ['MV']);
    assert.deepEqual(plugin.dependencies?.base, ['CoreFix']);
    assert.deepEqual(plugin.parameterSchema?.fields.map((field) => field.key), ['ignored']);
    assert.equal(plugin.header.help, 'First help line.\n\nSecond help line.');
    assert.deepEqual(plugin.header.helpSections, [
      { language: '', content: 'First help line.\n\nSecond help line.' },
      { language: 'ja', content: 'Localized help must not be selected.' },
    ]);
    assert.equal(plugin.header.displayPath, 'js/plugins/Documentation.js');
  });

  test('parses common RMMV plugin parameter schema and plugin command hints', () => {
    const config = readPluginConfiguration(fixture.root, fixture.project);
    const coreFix = config.plugins.find((plugin) => plugin.name === 'CoreFix');

    assert.ok(coreFix?.parameterSchema);
    assert.equal(coreFix.parameterSchema.source, 'rmmv-plugin-header');
    assert.deepEqual(coreFix.parameterSchema.fields.map((field) => field.key), [
      'speed',
      'mode',
      'enabled',
      'notes',
      'Picture Name',
      'actorId',
    ]);
    const speed = coreFix.parameterSchema.fields.find((field) => field.key === 'speed');
    assert.equal(speed?.kind, 'number');
    assert.equal(speed?.label, 'Speed');
    assert.equal(speed?.min, 1);
    assert.equal(speed?.max, 10);
    assert.equal(speed?.defaultValue, '1');
    const mode = coreFix.parameterSchema.fields.find((field) => field.key === 'mode');
    assert.equal(mode?.kind, 'select');
    assert.deepEqual(mode?.options, [{ label: 'Safe', value: 'safe' }, { label: 'Fast', value: 'fast' }]);
    const enabled = coreFix.parameterSchema.fields.find((field) => field.key === 'enabled');
    assert.equal(enabled?.kind, 'boolean');
    assert.deepEqual(enabled?.options, [{ label: 'Enabled', value: 'true' }, { label: 'Disabled', value: 'false' }]);
    const picture = coreFix.parameterSchema.fields.find((field) => field.key === 'Picture Name');
    assert.equal(picture?.kind, 'file');
    assert.equal(picture?.rawType, 'file');
    assert.equal(picture?.directory, 'img/pictures');
    const actor = coreFix.parameterSchema.fields.find((field) => field.key === 'actorId');
    assert.equal(actor?.kind, 'database');
    assert.equal(actor?.rawType, 'actor');
    assert.equal(actor?.databaseTable, 'Actors');
    assert.deepEqual(coreFix.commandHints.map((hint) => `${hint.source}:${hint.command}`), [
      'command-comparison:CoreFix',
      'switch-command-case:CoreReset',
    ]);
  });

  test('treats note as multiline while preserving raw JSON and object parameters as readonly', () => {
    fs.writeFileSync(path.join(fixture.project, 'www', 'js', 'plugins', 'ParameterKinds.js'), `/*:
 * @plugindesc Parameter kind fixture.
 * @param notes
 * @type note
 * @default First line
 *
 * @param rawJson
 * @type json
 * @default {"enabled":true}
 *
 * @param rawObject
 * @type object
 * @default {"mode":"safe"}
 */
`, 'utf8');
    writePluginsJs(fixture.project, [
      {
        name: 'ParameterKinds',
        status: true,
        description: '',
        parameters: {
          notes: 'First line\nSecond line',
          rawJson: '{"enabled":true}',
          rawObject: '{"mode":"safe"}',
        },
      },
    ]);

    const plugin = readPluginConfiguration(fixture.root, fixture.project).plugins[0];
    const fields = Object.fromEntries(
      (plugin.parameterSchema?.fields || []).map((entry) => [entry.key, entry]),
    );
    assert.equal(fields.notes.kind, 'multiline');
    assert.equal(fields.notes.editable, undefined);
    assert.equal(fields.rawJson.editable, false);
    assert.equal(fields.rawJson.rawType, 'json');
    assert.equal(fields.rawObject.editable, false);
    assert.equal(fields.rawObject.rawType, 'object');

    assert.throws(() => updatePluginParameters(
      fixture.root,
      fixture.project,
      'ParameterKinds',
      {
        notes: 'Changed',
        rawJson: '{"enabled":false}',
        rawObject: '{"mode":"safe"}',
      },
    ), /must be preserved unchanged/);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
    assert.equal(
      sourcePluginArray(fixture.project)[0].parameters.rawJson,
      '{"enabled":true}',
    );
  });

  test('warns about unsupported parameter types and exposes them as readonly', () => {
    fs.writeFileSync(path.join(fixture.project, 'www', 'js', 'plugins', 'Unsupported.js'), `/*:
 * @plugindesc Unsupported schema fixture.
 * @param title
 * @type text
 * @default Hello
 *
 * @param Complex Settings
 * @type struct<Settings>[]
 * @default []
 */
`, 'utf8');
    writePluginsJs(fixture.project, [
      { name: 'Unsupported', status: true, description: 'Unsupported', parameters: { title: 'Hello', 'Complex Settings': '[]' } },
    ]);

    const config = readPluginConfiguration(fixture.root, fixture.project);
    const plugin = config.plugins[0];
    assert.deepEqual(plugin.parameterSchema?.fields.map((field) => field.key), ['title', 'Complex Settings']);
    assert.equal(
      plugin.parameterSchema?.fields.find((field) => field.key === 'Complex Settings')?.editable,
      false,
    );
    assert.ok(plugin.parameterSchemaWarnings.some((warning) => warning.includes('Complex Settings')));
    assert.ok(config.validation.issues.some((issue) =>
      issue.code === 'plugin-parameter-schema-unparsed'
      && issue.pluginName === 'Unsupported'
      && issue.message.includes('Complex Settings')));
  });

  test('parses MV struct and array parameter schema safely', () => {
    fs.writeFileSync(path.join(fixture.project, 'www', 'js', 'plugins', 'ComplexParams.js'), `/*:
 * @plugindesc Complex parameter fixture.
 * @param Settings
 * @type struct<Settings>
 * @default {"title":"Ready","speed":"3","enabled":"true"}
 *
 * @param Settings List
 * @type struct<Settings>[]
 * @default []
 *
 * @param Level List
 * @type number[]
 * @min 1
 * @max 99
 * @default ["1","5"]
 *
 * @param Choice List
 * @type select[]
 * @option One
 * @value one
 * @option Two
 * @value two
 * @default ["one"]
 */
/*~struct~Settings:
 * @param title
 * @text Title
 * @type string
 * @default Ready
 *
 * @param speed
 * @type number
 * @min 1
 * @max 10
 * @default 3
 *
 * @param enabled
 * @type boolean
 * @default true
 */
`, 'utf8');
    writePluginsJs(fixture.project, [
      {
        name: 'ComplexParams',
        status: true,
        description: 'Complex',
        parameters: {
          Settings: '{"title":"Ready","speed":"3","enabled":"true"}',
          'Settings List': '["{\\"title\\":\\"A\\",\\"speed\\":\\"1\\",\\"enabled\\":\\"true\\"}"]',
          'Level List': '["1","5"]',
          'Choice List': '["one"]',
        },
      },
    ]);

    const config = readPluginConfiguration(fixture.root, fixture.project);
    const plugin = config.plugins[0];

    assert.equal(plugin.parameterSchemaWarnings.length, 0);
    assert.deepEqual(plugin.parameterSchema?.fields.map((field) => `${field.key}:${field.kind}`), [
      'Settings:struct',
      'Settings List:array',
      'Level List:array',
      'Choice List:array',
    ]);
    const settings = plugin.parameterSchema?.fields.find((field) => field.key === 'Settings');
    assert.equal(settings?.structName, 'Settings');
    assert.deepEqual(settings?.fields?.map((field) => `${field.key}:${field.kind}`), [
      'title:text',
      'speed:number',
      'enabled:boolean',
    ]);
    const settingsList = plugin.parameterSchema?.fields.find((field) => field.key === 'Settings List');
    assert.equal(settingsList?.item?.kind, 'struct');
    assert.deepEqual(settingsList?.item?.fields?.map((field) => field.key), ['title', 'speed', 'enabled']);
    const levelList = plugin.parameterSchema?.fields.find((field) => field.key === 'Level List');
    assert.equal(levelList?.item?.kind, 'number');
    assert.equal(levelList?.item?.min, 1);
    assert.equal(levelList?.item?.max, 99);
    const choiceList = plugin.parameterSchema?.fields.find((field) => field.key === 'Choice List');
    assert.equal(choiceList?.item?.kind, 'select');
    assert.deepEqual(choiceList?.item?.options, [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }]);
  });

  test('disables a plugin through staging without mutating source plugins.js', () => {
    const result = setPluginEnabled(fixture.root, fixture.project, 'QuestLog', false);

    assert.equal(result.plugins.find((plugin) => plugin.name === 'QuestLog')?.status, false);
    assert.equal(sourcePluginStatus(fixture.project, 'QuestLog'), true);
    const staged = readJsonPluginArray(getProjectFileForRead(fixture.root, fixture.project, 'www/js/plugins.js')!);
    assert.equal(staged.find((plugin) => plugin.name === 'QuestLog')?.status, false);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).files.some((file) => file.relativePath === 'www/js/plugins.js'), true);
  });

  test('reorders plugins through staged plugins.js', () => {
    const result = reorderPlugins(fixture.root, fixture.project, ['OldPlugin', 'QuestLog', 'CoreFix']);

    assert.deepEqual(result.plugins.map((plugin) => plugin.name), ['OldPlugin', 'QuestLog', 'CoreFix']);
    assert.deepEqual(sourcePluginArray(fixture.project).map((plugin) => plugin.name), ['CoreFix', 'QuestLog', 'OldPlugin']);
  });

  test('updates plugin parameters through staged plugins.js', () => {
    const result = updatePluginParameters(fixture.root, fixture.project, 'CoreFix', {
      speed: '2',
      mode: 'safe',
    });

    const coreFix = result.plugins.find((plugin) => plugin.name === 'CoreFix');
    assert.deepEqual(coreFix?.parameters, { speed: '2', mode: 'safe' });
    assert.deepEqual(sourcePluginArray(fixture.project).find((plugin) => plugin.name === 'CoreFix')?.parameters, { speed: '1' });
  });

  test('validates missing plugin files, duplicate names, and non-object parameters', () => {
    writePluginsJs(fixture.project, [
      { name: 'CoreFix', status: true, description: '', parameters: { speed: '1' } },
      { name: 'CoreFix', status: false, description: '', parameters: {} },
      { name: 'MissingPlugin', status: true, description: '', parameters: {} },
      { name: 'BadParams', status: true, description: '', parameters: 'broken' },
    ]);

    const result = validatePluginConfiguration(fixture.root, fixture.project);

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'plugin-name-duplicate' && issue.pluginName === 'CoreFix'));
    assert.ok(result.issues.some((issue) => issue.code === 'plugin-file-missing' && issue.pluginName === 'MissingPlugin'));
    assert.ok(result.issues.some((issue) => issue.code === 'plugin-parameters-invalid' && issue.pluginName === 'BadParams'));
  });

  test('reports missing plugins.js', () => {
    fs.unlinkSync(path.join(fixture.project, 'www', 'js', 'plugins.js'));

    const result = validatePluginConfiguration(fixture.root, fixture.project);

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'plugins-js-missing'));
  });

  test('applies staged plugin configuration back to source only on apply', () => {
    setPluginEnabled(fixture.root, fixture.project, 'QuestLog', false);

    assert.equal(sourcePluginStatus(fixture.project, 'QuestLog'), true);
    const applied = applyProjectStaging(fixture.root, fixture.project);

    assert.equal(applied.applied, true);
    assert.equal(sourcePluginStatus(fixture.project, 'QuestLog'), false);
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
  });

  test('installs and deletes plugin files through staging', () => {
    const external = path.join(fixture.root, 'external', 'NewPlugin.js');
    fs.mkdirSync(path.dirname(external), { recursive: true });
    fs.writeFileSync(external, '/* new plugin */', 'utf8');

    const installed = installPluginFile(fixture.root, fixture.project, external);
    assert.equal(installed.relativePath, 'www/js/plugins/NewPlugin.js');
    assert.equal(installed.configuration?.plugins.find((plugin) => plugin.name === 'NewPlugin')?.status, false);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'js', 'plugins', 'NewPlugin.js')), false);
    assert.ok(getProjectFileForRead(fixture.root, fixture.project, 'www/js/plugins/NewPlugin.js'));
    assert.equal(sourcePluginArray(fixture.project).some((plugin) => plugin.name === 'NewPlugin'), false);

    const deleted = deletePluginFile(fixture.root, fixture.project, 'OldPlugin');
    assert.equal(deleted.relativePath, 'www/js/plugins/OldPlugin.js');
    assert.equal(deleted.configuration?.plugins.some((plugin) => plugin.name === 'OldPlugin'), false);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'js', 'plugins', 'OldPlugin.js')), true);
    assert.equal(getProjectFileForRead(fixture.root, fixture.project, 'www/js/plugins/OldPlugin.js'), null);
    assert.equal(sourcePluginArray(fixture.project).some((plugin) => plugin.name === 'OldPlugin'), true);

    applyProjectStaging(fixture.root, fixture.project);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'js', 'plugins', 'NewPlugin.js')), true);
    assert.equal(fs.existsSync(path.join(fixture.project, 'www', 'js', 'plugins', 'OldPlugin.js')), false);
    assert.equal(sourcePluginStatus(fixture.project, 'NewPlugin'), false);
    assert.equal(sourcePluginArray(fixture.project).some((plugin) => plugin.name === 'OldPlugin'), false);
  });

  test('adds and removes configuration entries without copying or deleting plugin files', () => {
    const looseFile = path.join(fixture.project, 'www', 'js', 'plugins', 'LoosePlugin.js');
    fs.writeFileSync(looseFile, '/* loose plugin */', 'utf8');
    const sourceBefore = fs.readFileSync(path.join(fixture.project, 'www', 'js', 'plugins.js'), 'utf8');

    const added = addPluginConfigurationEntry(fixture.root, fixture.project, 'LoosePlugin');
    assert.equal(added.plugins.at(-1)?.name, 'LoosePlugin');
    assert.equal(added.plugins.at(-1)?.status, false);
    assert.equal(fs.readFileSync(path.join(fixture.project, 'www', 'js', 'plugins.js'), 'utf8'), sourceBefore);
    assert.equal(fs.existsSync(looseFile), true);

    const removed = removePluginConfigurationEntry(fixture.root, fixture.project, 'LoosePlugin');
    assert.equal(removed.plugins.some((plugin) => plugin.name === 'LoosePlugin'), false);
    assert.equal(removed.pluginFiles.some((file) => file.name === 'LoosePlugin' && file.exists), true);
    assert.equal(fs.existsSync(looseFile), true);
    assert.equal(fs.readFileSync(path.join(fixture.project, 'www', 'js', 'plugins.js'), 'utf8'), sourceBefore);
  });

  test('rejects newly introduced dependency conflicts before staging', () => {
    fs.writeFileSync(path.join(fixture.project, 'www', 'js', 'plugins', 'BasePlugin.js'), `/*:
 * @plugindesc Base.
 */`, 'utf8');
    fs.writeFileSync(path.join(fixture.project, 'www', 'js', 'plugins', 'DependentPlugin.js'), `/*:
 * @plugindesc Dependent.
 * @base BasePlugin
 * @orderAfter BasePlugin
 */`, 'utf8');
    writePluginsJs(fixture.project, [
      { name: 'BasePlugin', status: false, description: '', parameters: {} },
      { name: 'DependentPlugin', status: false, description: '', parameters: {} },
    ]);

    assert.throws(
      () => setPluginEnabled(fixture.root, fixture.project, 'DependentPlugin', true),
      /PLUGIN_DEPENDENCY_CONFLICT.*requires enabled base plugin BasePlugin/,
    );
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);

    setPluginEnabled(fixture.root, fixture.project, 'BasePlugin', true);
    setPluginEnabled(fixture.root, fixture.project, 'DependentPlugin', true);
    applyProjectStaging(fixture.root, fixture.project);
    assert.throws(
      () => reorderPlugins(fixture.root, fixture.project, ['DependentPlugin', 'BasePlugin']),
      /PLUGIN_DEPENDENCY_CONFLICT.*must be ordered after base plugin BasePlugin/,
    );
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
  });

  test('allows disabling a missing plugin but rejects enabling it without staging', () => {
    fs.rmSync(path.join(fixture.project, 'www', 'js', 'plugins', 'OldPlugin.js'));
    setPluginEnabled(fixture.root, fixture.project, 'OldPlugin', false);
    applyProjectStaging(fixture.root, fixture.project);

    assert.throws(
      () => setPluginEnabled(fixture.root, fixture.project, 'OldPlugin', true),
      /PLUGIN_FILE_MISSING.*OldPlugin/,
    );
    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
    assert.equal(sourcePluginStatus(fixture.project, 'OldPlugin'), false);
  });

  test('preserves enabled state, description, and parameters when overwriting a plugin file', () => {
    const external = path.join(fixture.root, 'external', 'QuestLog.js');
    fs.mkdirSync(path.dirname(external), { recursive: true });
    fs.writeFileSync(external, '/* replacement quest */', 'utf8');

    const installed = installPluginFile(fixture.root, fixture.project, external, { overwrite: true });
    const questLog = installed.configuration?.plugins.find((plugin) => plugin.name === 'QuestLog');

    assert.equal(questLog?.status, true);
    assert.equal(questLog?.description, 'Quest UI');
    assert.deepEqual(questLog?.parameters, { visible: 'true' });
    assert.equal(
      fs.readFileSync(getProjectFileForRead(fixture.root, fixture.project, 'www/js/plugins/QuestLog.js')!, 'utf8'),
      '/* replacement quest */',
    );
    assert.equal(sourcePluginStatus(fixture.project, 'QuestLog'), true);
  });

  test('does not expose force deletion and rolls back every draft when an atomic stage fails', () => {
    assert.throws(
      () => deletePluginFile(fixture.root, fixture.project, 'QuestLog', { force: true }),
      /force/i,
    );

    const pluginRelative = 'www/js/plugins/QuestLog.js';
    const configRelative = 'www/js/plugins.js';
    const sourcePlugin = fs.readFileSync(path.join(fixture.project, ...pluginRelative.split('/')));
    const sourceConfig = fs.readFileSync(path.join(fixture.project, ...configRelative.split('/')));
    assert.throws(() => stageProjectFilesAtomically(fixture.root, fixture.project, [
      { relativePath: pluginRelative, content: Buffer.from('replacement') },
      { relativePath: configRelative, content: Buffer.from('replacement config') },
    ], undefined, {
      beforeMutation: ({ index }) => {
        if (index === 1) throw new Error('injected second draft failure');
      },
    }), /injected second draft failure/);

    assert.equal(getProjectStagingStatus(fixture.root, fixture.project).staged, false);
    assert.deepEqual(fs.readFileSync(getProjectFileForRead(fixture.root, fixture.project, pluginRelative)!), sourcePlugin);
    assert.deepEqual(fs.readFileSync(getProjectFileForRead(fixture.root, fixture.project, configRelative)!), sourceConfig);
  });
});

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rmmv-plugin-management-'));
  const project = path.join(root, 'projects', 'Project');
  const dataDir = path.join(project, 'www', 'data');
  writeJson(path.join(dataDir, 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: true }]);
  writeJson(path.join(dataDir, 'System.json'), { gameTitle: 'Plugin Test', switches: [null], variables: [null] });
  writeJson(path.join(dataDir, 'Map001.json'), { width: 2, height: 2, tilesetId: 1, data: Array(24).fill(0), events: [null] });
  fs.mkdirSync(path.join(project, 'www', 'js', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'CoreFix.js'), `/*:
 * @plugindesc Core fixes.
 * @param speed
 * @text Speed
 * @desc Movement speed multiplier.
 * @type number
 * @min 1
 * @max 10
 * @default 1
 *
 * @param mode
 * @type select
 * @option Safe
 * @value safe
 * @option Fast
 * @value fast
 * @default safe
 *
 * @param enabled
 * @type boolean
 * @on Enabled
 * @off Disabled
 * @default true
 *
 * @param notes
 * @type multiline_string
 * @default ready
 *
 * @param Picture Name
 * @type file
 * @dir img/pictures
 * @default Portrait
 *
 * @param actorId
 * @type actor
 * @default 1
 */
Game_Interpreter.prototype.pluginCommand = function(command, args) {
  if (command === 'CoreFix') this.coreFix(args);
  switch (command) {
    case 'CoreReset':
      this.coreReset(args);
      break;
  }
};
`, 'utf8');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'QuestLog.js'), '/* quest */', 'utf8');
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins', 'OldPlugin.js'), '/* old */', 'utf8');
  writePluginsJs(project, [
    { name: 'CoreFix', status: true, description: 'Core patch', parameters: { speed: '1' } },
    { name: 'QuestLog', status: true, description: 'Quest UI', parameters: { visible: 'true' } },
    { name: 'OldPlugin', status: false, description: 'Legacy', parameters: {} },
  ]);
  return { root, project };
}

function writePluginsJs(project: string, entries: unknown[]): void {
  fs.mkdirSync(path.join(project, 'www', 'js'), { recursive: true });
  fs.writeFileSync(path.join(project, 'www', 'js', 'plugins.js'), `var $plugins =\n${JSON.stringify(entries, null, 2)};\n`, 'utf8');
}

function sourcePluginArray(project: string): Array<{ name: string; status: boolean; parameters: Record<string, unknown> }> {
  return readJsonPluginArray(path.join(project, 'www', 'js', 'plugins.js'));
}

function sourcePluginStatus(project: string, pluginName: string): boolean | undefined {
  return sourcePluginArray(project).find((plugin) => plugin.name === pluginName)?.status;
}

function readJsonPluginArray(file: string): Array<{ name: string; status: boolean; parameters: Record<string, unknown> }> {
  const raw = fs.readFileSync(file, 'utf8');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  return JSON.parse(raw.slice(start, end + 1)) as Array<{ name: string; status: boolean; parameters: Record<string, unknown> }>;
}
