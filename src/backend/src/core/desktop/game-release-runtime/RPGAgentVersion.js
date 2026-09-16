/*:
 * @target MV MZ
 * @plugindesc RPG Agent game version, save origin, compatibility policy, and migration API.
 * @author RPG Agent MV contributors
 *
 * @command GetCurrentVersion
 * @text Get Current Version
 * @arg variableId
 * @type variable
 * @default 1
 *
 * @command GetSaveOriginVersion
 * @text Get Save Origin Version
 * @arg variableId
 * @type variable
 * @default 1
 *
 * @command CompareVersion
 * @text Compare Version
 * @arg version
 * @type string
 * @default 1.0.0
 * @arg resultVariableId
 * @type variable
 * @default 1
 *
 * @command IsAtLeast
 * @text Is At Least
 * @arg version
 * @type string
 * @default 1.0.0
 * @arg resultSwitchId
 * @type switch
 * @default 1
 *
 * @command CheckForUpdates
 * @text Check For Updates
 *
 * @help
 * The public API is available as globalThis.RPGAgentVersion.
 * Release settings are loaded from data/RPGAgentRelease.json.
 *
 * MV plugin commands:
 *   RPGAgentVersion GetCurrentVersion 1
 *   RPGAgentVersion GetSaveOriginVersion 1
 *   RPGAgentVersion CompareVersion 1.2.3 2
 *   RPGAgentVersion IsAtLeast 1.2.3 3
 *   RPGAgentVersion CheckForUpdates
 */
(() => {
  'use strict';

  const PLUGIN_NAME = 'RPGAgentVersion';
  const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?: *-([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*))?$/;
  const ACTIONS = new Set(['allow', 'warn', 'block', 'callback']);
  const migrationHandlers = [];
  let activeSaveOrigin = null;

  function parseVersion(value) {
    if (typeof value !== 'string') throw new Error('Game version must be a string.');
    const match = VERSION_RE.exec(value);
    if (!match) {
      throw new Error(`Invalid game version ${JSON.stringify(value)}. Expected a.b.c with an optional ASCII -suffix.`);
    }
    return {
      major: match[1],
      minor: match[2],
      patch: match[3],
      suffix: match[4] || '',
      normalized: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ''}`,
    };
  }

  function compareDecimal(left, right) {
    const a = left.replace(/^0+(?=\d)/, '');
    const b = right.replace(/^0+(?=\d)/, '');
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a === b ? 0 : a < b ? -1 : 1;
  }

  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (const key of ['major', 'minor', 'patch']) {
      const compared = compareDecimal(a[key], b[key]);
      if (compared !== 0) return compared;
    }
    return 0;
  }

  function config() {
    const value = globalThis.$dataRPGAgentRelease;
    if (!value || typeof value !== 'object') throw new Error('RPGAgentRelease.json is not loaded.');
    const version = parseVersion(value.version).normalized;
    return { ...value, version };
  }

  function currentOrigin() {
    if (!activeSaveOrigin) return null;
    return {
      originVersion: typeof activeSaveOrigin.originVersion === 'string' ? activeSaveOrigin.originVersion : null,
      originChannel: typeof activeSaveOrigin.originChannel === 'string' ? activeSaveOrigin.originChannel : null,
    };
  }

  function originFromContents(contents) {
    const raw = contents && contents.rpgAgentRelease;
    if (!raw || typeof raw !== 'object') return null;
    const originVersion = typeof raw.originVersion === 'string' ? raw.originVersion : null;
    const originChannel = typeof raw.originChannel === 'string' ? raw.originChannel : null;
    return originVersion || originChannel ? { originVersion, originChannel } : null;
  }

  function originForSave() {
    const existing = currentOrigin();
    if (existing && existing.originVersion) return existing;
    const release = config();
    return { originVersion: release.version, originChannel: release.channel };
  }

  function compatibilityKind(origin, release) {
    if (!origin || !origin.originVersion) return 'legacy';
    if (origin.originChannel && origin.originChannel !== release.channel) return 'differentChannel';
    const compared = compareVersions(origin.originVersion, release.version);
    return compared < 0 ? 'older' : compared > 0 ? 'newer' : 'same';
  }

  function policyMessage(kind, origin, release) {
    const custom = release.saveCompatibility.messages && release.saveCompatibility.messages[kind];
    if (typeof custom === 'string' && custom.trim()) return custom.trim();
    const from = origin && origin.originVersion ? origin.originVersion : 'legacy save';
    return `This save was created by ${from} (${origin && origin.originChannel || 'unknown channel'}); the current game is ${release.version} (${release.channel}).`;
  }

  function applyCompatibilityPolicy(contents) {
    const release = config();
    const origin = originFromContents(contents);
    const kind = compatibilityKind(origin, release);
    const action = release.saveCompatibility && release.saveCompatibility[kind];
    if (!ACTIONS.has(action)) throw new Error(`Invalid save compatibility action for ${kind}.`);
    const message = policyMessage(kind, origin, release);
    if (action === 'block') throw new Error(message);
    if (action === 'warn' && typeof globalThis.alert === 'function') globalThis.alert(message);
    if (action === 'callback') {
      if (!migrationHandlers.length) throw new Error(`${message} No save migration callback is registered.`);
      for (const handler of migrationHandlers) {
        const result = handler({
          currentVersion: release.version,
          currentChannel: release.channel,
          originVersion: origin && origin.originVersion,
          originChannel: origin && origin.originChannel,
          contents,
        });
        if (result && typeof result.then === 'function') {
          throw new Error('Save migration callbacks must finish synchronously.');
        }
        if (result === false) throw new Error('A save migration callback rejected this save.');
      }
    }
    return origin;
  }

  const api = Object.freeze({
    getVersion() { return parseVersion(config().version).normalized; },
    getParts() {
      const parts = parseVersion(config().version);
      return { major: parts.major, minor: parts.minor, patch: parts.patch, suffix: parts.suffix };
    },
    compare(version) { return compareVersions(config().version, version); },
    isAtLeast(version) { return compareVersions(config().version, version) >= 0; },
    getSaveOriginVersion() { return currentOrigin() && currentOrigin().originVersion; },
    getSaveOriginChannel() { return currentOrigin() && currentOrigin().originChannel; },
    registerSaveMigration(handler) {
      if (typeof handler !== 'function') throw new Error('Save migration handler must be a function.');
      migrationHandlers.push(handler);
      return () => {
        const index = migrationHandlers.indexOf(handler);
        if (index >= 0) migrationHandlers.splice(index, 1);
      };
    },
  });
  globalThis.RPGAgentVersion = api;

  const originalLoadDatabase = DataManager.loadDatabase;
  DataManager.loadDatabase = function() {
    originalLoadDatabase.apply(this, arguments);
    this.loadDataFile('$dataRPGAgentRelease', 'RPGAgentRelease.json');
  };

  const originalIsDatabaseLoaded = DataManager.isDatabaseLoaded;
  DataManager.isDatabaseLoaded = function() {
    return originalIsDatabaseLoaded.apply(this, arguments) && Boolean(globalThis.$dataRPGAgentRelease);
  };

  const originalSetupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function() {
    activeSaveOrigin = null;
    return originalSetupNewGame.apply(this, arguments);
  };

  const originalMakeSaveContents = DataManager.makeSaveContents;
  DataManager.makeSaveContents = function() {
    const contents = originalMakeSaveContents.apply(this, arguments);
    const origin = originForSave();
    contents.rpgAgentRelease = { originVersion: origin.originVersion, originChannel: origin.originChannel };
    activeSaveOrigin = { ...contents.rpgAgentRelease };
    return contents;
  };

  const originalExtractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function(contents) {
    const origin = applyCompatibilityPolicy(contents);
    const result = originalExtractSaveContents.apply(this, arguments);
    activeSaveOrigin = origin;
    return result;
  };

  const originalMakeSavefileInfo = DataManager.makeSavefileInfo;
  DataManager.makeSavefileInfo = function() {
    const info = originalMakeSavefileInfo.apply(this, arguments);
    const origin = originForSave();
    info.rpgAgentRelease = { originVersion: origin.originVersion, originChannel: origin.originChannel };
    return info;
  };

  if (globalThis.Scene_Title && Scene_Title.prototype) {
    const originalTitleStart = Scene_Title.prototype.start;
    Scene_Title.prototype.start = function() {
      activeSaveOrigin = null;
      return originalTitleStart.apply(this, arguments);
    };
  }

  if (globalThis.Scene_Boot && Scene_Boot.prototype) {
    const originalBootStart = Scene_Boot.prototype.start;
    Scene_Boot.prototype.start = function() {
      const result = originalBootStart.apply(this, arguments);
      try {
        if (globalThis.RPGAgentAndroid && typeof RPGAgentAndroid.markContentHealthy === 'function') {
          RPGAgentAndroid.markContentHealthy();
        }
      } catch (error) {
        console.error('[RPGAgentVersion] Android content health confirmation failed', error);
      }
      return result;
    };
  }

  function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer.`);
    return id;
  }

  function runCommand(name, args) {
    if (name === 'GetCurrentVersion') {
      $gameVariables.setValue(positiveId(args.variableId, 'variableId'), api.getVersion());
    } else if (name === 'GetSaveOriginVersion') {
      $gameVariables.setValue(positiveId(args.variableId, 'variableId'), api.getSaveOriginVersion() || '');
    } else if (name === 'CompareVersion') {
      $gameVariables.setValue(positiveId(args.resultVariableId, 'resultVariableId'), api.compare(String(args.version || '')));
    } else if (name === 'IsAtLeast') {
      $gameSwitches.setValue(positiveId(args.resultSwitchId, 'resultSwitchId'), api.isAtLeast(String(args.version || '')));
    } else if (name === 'CheckForUpdates') {
      if (!globalThis.RPGAgentUpdater) throw new Error('RPGAgentUpdater is not enabled.');
      globalThis.RPGAgentUpdater.open();
    } else {
      throw new Error(`Unknown ${PLUGIN_NAME} command: ${name}.`);
    }
  }

  if (PluginManager.registerCommand) {
    for (const command of ['GetCurrentVersion', 'GetSaveOriginVersion', 'CompareVersion', 'IsAtLeast', 'CheckForUpdates']) {
      PluginManager.registerCommand(PLUGIN_NAME, command, (args) => runCommand(command, args));
    }
  }

  const originalPluginCommand = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    originalPluginCommand.apply(this, arguments);
    if (String(command).toLowerCase() !== PLUGIN_NAME.toLowerCase()) return;
    const subcommand = String(args[0] || '');
    if (subcommand === 'GetCurrentVersion') runCommand(subcommand, { variableId: args[1] });
    else if (subcommand === 'GetSaveOriginVersion') runCommand(subcommand, { variableId: args[1] });
    else if (subcommand === 'CompareVersion') runCommand(subcommand, { version: args[1], resultVariableId: args[2] });
    else if (subcommand === 'IsAtLeast') runCommand(subcommand, { version: args[1], resultSwitchId: args[2] });
    else if (subcommand === 'CheckForUpdates') runCommand(subcommand, {});
    else throw new Error(`Unknown ${PLUGIN_NAME} command: ${subcommand}.`);
  };
})();
