import fs from 'node:fs';
import path from 'node:path';

import type { InteractiveBattleTestBattler } from '../../../../contract/types.ts';
import { validateEffectiveRmmvDatabaseState } from '../rmmv/database-changes.ts';
import { writeJsonAtomic } from '../rmmv/json.ts';
import { resolveRmmvLayout } from '../rmmv/rmmv-layout.ts';
import {
  cleanupIsolatedProject,
  prepareIsolatedStagedProject,
  verifyIsolatedSourceState,
  type IsolatedProjectPreparation,
} from './isolated-project-preparation.ts';

export interface BattleTestConfiguration {
  troopId: number;
  battlers: InteractiveBattleTestBattler[];
  battleback1Name: string;
  battleback2Name: string;
}

export interface BattleTestProjectPreparation extends IsolatedProjectPreparation {
  executable: string;
  troopId: number;
  troopName: string;
  battlers: InteractiveBattleTestBattler[];
  battleback1Name: string;
  battleback2Name: string;
}

export interface BattleTestPreparationDependencies {
  createTemporaryProject?: () => string;
}

export function prepareBattleTestProject(
  workflowRoot: string,
  project: string,
  configuration: BattleTestConfiguration,
  dependencies: BattleTestPreparationDependencies = {},
): BattleTestProjectPreparation {
  validateConfigurationShape(configuration);
  const isolated = prepareIsolatedStagedProject(workflowRoot, project, {
    temporaryPrefix: 'rmmv-agent-battle-test-',
    ...(dependencies.createTemporaryProject ? { createTemporaryProject: dependencies.createTemporaryProject } : {}),
  });
  try {
    const preflightState = verifyIsolatedSourceState(workflowRoot, isolated);
    assertStableSource(preflightState);
    const layout = resolveRmmvLayout(isolated.temporaryProject);
    const systemPath = path.join(layout.dataDir, 'System.json');
    const troopsPath = path.join(layout.dataDir, 'Troops.json');
    const actorsPath = path.join(layout.dataDir, 'Actors.json');
    const system = readRecord(systemPath, 'System.json');
    const troops = readArray(troopsPath, 'Troops.json');
    const actors = readArray(actorsPath, 'Actors.json');
    const troop = recordAt(troops, configuration.troopId, `Troop #${configuration.troopId}`);
    const members = Array.isArray(troop.members) ? troop.members : [];
    if (members.length > 8) {
      throw new BattleTestPreparationError(`Troop #${configuration.troopId} has ${members.length} members; Battle Test supports at most 8.`);
    }
    validateBattlers(configuration.battlers, actors);
    assertBattleback(layout.resourceRoot, 'battlebacks1', configuration.battleback1Name);
    assertBattleback(layout.resourceRoot, 'battlebacks2', configuration.battleback2Name);

    system.testTroopId = configuration.troopId;
    system.testBattlers = configuration.battlers.map((battler) => ({
      actorId: battler.actorId,
      level: battler.level,
      equips: [...battler.equips],
    }));
    system.battleback1Name = configuration.battleback1Name;
    system.battleback2Name = configuration.battleback2Name;
    writeJsonAtomic(systemPath, system);

    const validation = validateEffectiveRmmvDatabaseState(workflowRoot, isolated.temporaryProject);
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      const detail = errors.slice(0, 5).map((issue) => `${issue.source.path}: ${issue.message}`).join(' ');
      throw new BattleTestPreparationError(`Battle Test database validation failed with ${errors.length} error(s). ${detail}`);
    }
    const executable = path.join(isolated.temporaryProject, 'Game.exe');
    if (!isFile(executable)) throw new BattleTestPreparationError(`Game.exe was not found in the isolated project: ${executable}`);
    assertStableSource(verifyIsolatedSourceState(workflowRoot, isolated));

    return {
      ...isolated,
      executable,
      troopId: configuration.troopId,
      troopName: String(troop.name || `#${configuration.troopId}`),
      battlers: configuration.battlers.map((entry) => ({ ...entry, equips: [...entry.equips] })),
      battleback1Name: configuration.battleback1Name,
      battleback2Name: configuration.battleback2Name,
    };
  } catch (error) {
    try { cleanupIsolatedProject(isolated); } catch { /* Report the preflight error first. */ }
    throw error;
  }
}

export class BattleTestPreparationError extends Error {}

function validateConfigurationShape(configuration: BattleTestConfiguration): void {
  if (!Number.isInteger(configuration.troopId) || configuration.troopId <= 0) {
    throw new BattleTestPreparationError('Battle Test troopId must be a positive integer.');
  }
  if (!Array.isArray(configuration.battlers) || configuration.battlers.length < 1 || configuration.battlers.length > 4) {
    throw new BattleTestPreparationError('Battle Test requires 1 to 4 actors.');
  }
  if (typeof configuration.battleback1Name !== 'string' || typeof configuration.battleback2Name !== 'string') {
    throw new BattleTestPreparationError('Battle Test battleback names must be strings.');
  }
}

function validateBattlers(battlers: InteractiveBattleTestBattler[], actors: unknown[]): void {
  const seen = new Set<number>();
  for (const [index, battler] of battlers.entries()) {
    if (!battler || typeof battler !== 'object') throw new BattleTestPreparationError(`Battle Test actor ${index + 1} is invalid.`);
    if (!Number.isInteger(battler.actorId) || battler.actorId <= 0) {
      throw new BattleTestPreparationError(`Battle Test actor ${index + 1} has an invalid actorId.`);
    }
    if (seen.has(battler.actorId)) throw new BattleTestPreparationError(`Battle Test actor #${battler.actorId} is selected more than once.`);
    seen.add(battler.actorId);
    recordAt(actors, battler.actorId, `Actor #${battler.actorId}`);
    if (!Number.isInteger(battler.level) || battler.level < 1 || battler.level > 99) {
      throw new BattleTestPreparationError(`Battle Test actor #${battler.actorId} level must be from 1 to 99.`);
    }
    if (!Array.isArray(battler.equips) || battler.equips.some((equipId) => !Number.isInteger(equipId) || equipId < 0)) {
      throw new BattleTestPreparationError(`Battle Test actor #${battler.actorId} equipment must contain nonnegative integer IDs.`);
    }
  }
}

function assertBattleback(resourceRoot: string, bucket: 'battlebacks1' | 'battlebacks2', name: string): void {
  if (!name) return;
  if (name !== path.basename(name) || /[\\/]/.test(name)) {
    throw new BattleTestPreparationError(`Unsafe Battle Test ${bucket} name: ${name}`);
  }
  const image = path.join(resourceRoot, 'img', bucket, `${name}.png`);
  if (!isFile(image)) throw new BattleTestPreparationError(`Battle Test ${bucket} image was not found: ${name}`);
}

function assertStableSource(state: ReturnType<typeof verifyIsolatedSourceState>): void {
  if (!state.sourceUnchanged) throw new BattleTestPreparationError('Source project content changed while preparing Battle Test.');
  if (!state.savesUnchanged) throw new BattleTestPreparationError('Source project save content changed while preparing Battle Test.');
  if (!state.stagingUnchanged) {
    throw new BattleTestPreparationError(`Staged project content changed while preparing Battle Test.${state.stagingError ? ` ${state.stagingError}` : ''}`);
  }
}

function readRecord(filePath: string, label: string): Record<string, unknown> {
  const value = readJson(filePath, label);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BattleTestPreparationError(`${label} must contain an object.`);
  return value as Record<string, unknown>;
}

function readArray(filePath: string, label: string): unknown[] {
  const value = readJson(filePath, label);
  if (!Array.isArray(value)) throw new BattleTestPreparationError(`${label} must contain an array.`);
  return value;
}

function readJson(filePath: string, label: string): unknown {
  if (!isFile(filePath)) throw new BattleTestPreparationError(`${label} was not found: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new BattleTestPreparationError(`${label} is invalid JSON: ${errorMessage(error)}`);
  }
}

function recordAt(values: unknown[], id: number, label: string): Record<string, unknown> {
  const value = values[id];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BattleTestPreparationError(`${label} does not exist.`);
  return value as Record<string, unknown>;
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
