import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const pluginSource = fs.readFileSync(new URL('./RPGAgentVersion.js', import.meta.url), 'utf8');

test('exposes the stable version API and preserves save origin across later versions', () => {
  const runtime = createRuntime();
  vm.runInContext(pluginSource, runtime.context, { filename: 'RPGAgentVersion.js' });
  const api = runtime.context.RPGAgentVersion as Record<string, (...args: unknown[]) => unknown>;

  assert.equal(api.getVersion!(), '01.2.3-Beta.2');
  assert.deepEqual(toPlain(api.getParts!()), { major: '01', minor: '2', patch: '3', suffix: 'Beta.2' });
  assert.equal(api.compare!('1.2.3'), 0);
  assert.equal(api.compare!('2.0.0'), -1);
  assert.equal(api.isAtLeast!('1.2.0'), true);
  assert.throws(() => api.compare!('v1.2.3'), /Invalid game version/);

  runtime.dataManager.setupNewGame();
  const firstSave = runtime.dataManager.makeSaveContents();
  assert.deepEqual(toPlain(firstSave.rpgAgentRelease), {
    originVersion: '01.2.3-Beta.2', originChannel: 'stable',
  });
  assert.deepEqual(toPlain(runtime.dataManager.makeSavefileInfo().rpgAgentRelease), {
    originVersion: '01.2.3-Beta.2', originChannel: 'stable',
  });

  runtime.context.$dataRPGAgentRelease.version = '2.0.0';
  runtime.dataManager.extractSaveContents(firstSave);
  assert.equal(api.getSaveOriginVersion!(), '01.2.3-Beta.2');
  assert.equal(api.getSaveOriginChannel!(), 'stable');
  assert.deepEqual(toPlain(runtime.dataManager.makeSaveContents().rpgAgentRelease), {
    originVersion: '01.2.3-Beta.2', originChannel: 'stable',
  });

  runtime.title.start();
  assert.equal(api.getSaveOriginVersion!(), null);
  assert.equal(api.getSaveOriginChannel!(), null);
});

test('runs migration callbacks before applying save contents and blocks failed policies', () => {
  const runtime = createRuntime();
  vm.runInContext(pluginSource, runtime.context, { filename: 'RPGAgentVersion.js' });
  const api = runtime.context.RPGAgentVersion as Record<string, (...args: unknown[]) => unknown>;
  runtime.context.$dataRPGAgentRelease.saveCompatibility.older = 'callback';
  const contents = {
    variables: { value: 1 },
    rpgAgentRelease: { originVersion: '0.5.0', originChannel: 'stable' },
  };
  api.registerSaveMigration!((input: unknown) => {
    const migration = input as { contents: typeof contents };
    migration.contents.variables.value = 2;
    return true;
  });
  runtime.dataManager.extractSaveContents(contents);
  assert.equal(runtime.extracted?.variables.value, 2);

  runtime.context.$dataRPGAgentRelease.saveCompatibility.older = 'block';
  runtime.extracted = null;
  assert.throws(() => runtime.dataManager.extractSaveContents(contents), /This save was created/);
  assert.equal(runtime.extracted, null);
});

test('keeps the MZ command registry and MV text commands aligned with the public API', () => {
  const runtime = createRuntime();
  vm.runInContext(pluginSource, runtime.context, { filename: 'RPGAgentVersion.js' });

  runtime.commands.get('RPGAgentVersion:GetCurrentVersion')!({ variableId: '1' });
  runtime.commands.get('RPGAgentVersion:CompareVersion')!({ version: '2.0.0', resultVariableId: '2' });
  runtime.commands.get('RPGAgentVersion:IsAtLeast')!({ version: '1.2.0', resultSwitchId: '3' });
  runtime.commands.get('RPGAgentVersion:CheckForUpdates')!({});
  assert.equal(runtime.variables.get(1), '01.2.3-Beta.2');
  assert.equal(runtime.variables.get(2), -1);
  assert.equal(runtime.switches.get(3), true);
  assert.equal(runtime.updateChecks, 1);

  runtime.interpreter.pluginCommand('rpgagentversion', ['GetCurrentVersion', '4']);
  runtime.interpreter.pluginCommand('RPGAgentVersion', ['CompareVersion', '1.2.3', '5']);
  runtime.interpreter.pluginCommand('RPGAgentVersion', ['IsAtLeast', '2.0.0', '6']);
  runtime.interpreter.pluginCommand('RPGAgentVersion', ['CheckForUpdates']);
  assert.equal(runtime.variables.get(4), '01.2.3-Beta.2');
  assert.equal(runtime.variables.get(5), 0);
  assert.equal(runtime.switches.get(6), false);
  assert.equal(runtime.updateChecks, 2);
});

test('classifies legacy, older, same, newer, and cross-channel saves before loading', () => {
  const cases = [
    { kind: 'legacy', origin: null, action: 'allow', outcome: 'allowed' },
    { kind: 'older', origin: { originVersion: '1.0.0', originChannel: 'stable' }, action: 'warn', outcome: 'warned' },
    { kind: 'same', origin: { originVersion: '1.2.3-rc.1', originChannel: 'stable' }, action: 'block', outcome: 'blocked' },
    { kind: 'newer', origin: { originVersion: '2.0.0', originChannel: 'stable' }, action: 'allow', outcome: 'allowed' },
    { kind: 'differentChannel', origin: { originVersion: '1.0.0', originChannel: 'preview' }, action: 'block', outcome: 'blocked' },
  ] as const;
  for (const entry of cases) {
    const runtime = createRuntime();
    vm.runInContext(pluginSource, runtime.context, { filename: 'RPGAgentVersion.js' });
    runtime.context.$dataRPGAgentRelease.saveCompatibility[entry.kind] = entry.action;
    const contents = {
      variables: { value: 1 },
      ...(entry.origin ? { rpgAgentRelease: entry.origin } : {}),
    };
    if (entry.outcome === 'blocked') {
      assert.throws(() => runtime.dataManager.extractSaveContents(contents), /This save was created/);
      assert.equal(runtime.extracted, null);
    } else {
      runtime.dataManager.extractSaveContents(contents);
      assert.equal(runtime.extracted?.variables.value, 1);
      assert.equal(runtime.alerts.length, entry.outcome === 'warned' ? 1 : 0);
    }
  }
});

function createRuntime() {
  const commands = new Map<string, (args: Record<string, string>) => void>();
  const variables = new Map<number, unknown>();
  const switches = new Map<number, boolean>();
  const runtime: {
    context: vm.Context & Record<string, any>;
    dataManager: Record<string, any>;
    title: { start: () => void };
    interpreter: { pluginCommand: (command: string, args: string[]) => void };
    commands: typeof commands;
    variables: typeof variables;
    switches: typeof switches;
    alerts: string[];
    updateChecks: number;
    extracted: { variables: { value: number } } | null;
  } = {
    context: null as never,
    dataManager: {},
    title: { start() {} },
    interpreter: { pluginCommand() {} },
    commands,
    variables,
    switches,
    alerts: [],
    updateChecks: 0,
    extracted: null,
  };

  function SceneTitle(this: unknown) {}
  SceneTitle.prototype.start = function() {};
  function GameInterpreter(this: unknown) {}
  GameInterpreter.prototype.pluginCommand = function() {};
  const dataManager = {
    loadDatabase() {},
    loadDataFile() {},
    isDatabaseLoaded() { return true; },
    setupNewGame() {},
    makeSaveContents() { return { variables: { value: 1 } }; },
    extractSaveContents(contents: { variables: { value: number } }) { runtime.extracted = contents; },
    makeSavefileInfo() { return { title: 'slot' }; },
  };
  const context = vm.createContext({
    console,
    DataManager: dataManager,
    PluginManager: { registerCommand(plugin: string, command: string, handler: (args: Record<string, string>) => void) {
      commands.set(`${plugin}:${command}`, handler);
    } },
    Scene_Title: SceneTitle,
    Game_Interpreter: GameInterpreter,
    $gameVariables: { setValue(id: number, value: unknown) { variables.set(id, value); } },
    $gameSwitches: { setValue(id: number, value: boolean) { switches.set(id, value); } },
    RPGAgentUpdater: { open() { runtime.updateChecks += 1; } },
    $dataRPGAgentRelease: {
      schemaVersion: 1,
      gameId: 'sample-game',
      version: '01.2.3 -Beta.2',
      channel: 'stable',
      update: { enabled: false, indexUrl: '', checkOnStart: true, policy: 'optional' },
      saveCompatibility: {
        legacy: 'allow', older: 'allow', same: 'allow', newer: 'warn', differentChannel: 'warn',
      },
    },
    alert(message: string) { runtime.alerts.push(message); },
  }) as vm.Context & Record<string, any>;
  runtime.context = context;
  runtime.dataManager = dataManager;
  runtime.title = new context.Scene_Title();
  runtime.interpreter = new context.Game_Interpreter();
  return runtime;
}

function toPlain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
