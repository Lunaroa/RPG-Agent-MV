import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createBinaryPatch } from './game-binary-diff.ts';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process') as typeof import('node:child_process');
const runtimeFile = fileURLToPath(new URL('./game-windows-updater-runtime/updater.cjs', import.meta.url));

test('creates and removes update directories using MV filesystem APIs without following junctions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-updater-filesystem-'));
  const directory = path.join(root, 'download');
  const outside = path.join(root, 'preserved');
  const mkdir = fs.mkdirSync;
  const { ensureDirectory, removeDirectory } = require('./game-windows-updater-runtime/filesystem.cjs');
  try {
    // A Node 9 filesystem has only single-directory mkdir, not recursive options.
    fs.mkdirSync = ((target: fs.PathLike, options?: unknown) => {
      assert.equal(options, undefined);
      return mkdir(target);
    }) as typeof fs.mkdirSync;
    ensureDirectory(path.join(directory, 'nested', 'package'));
    ensureDirectory(path.join(directory, 'nested', 'package'));
    ensureDirectory(outside);
    fs.writeFileSync(path.join(outside, 'save.dat'), 'preserved save', 'utf8');
    fs.symlinkSync(outside, path.join(directory, 'linked-save'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => removeDirectory(path.join(directory, 'linked-save')), /real directory/);
    removeDirectory(directory);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.readFileSync(path.join(outside, 'save.dat'), 'utf8'), 'preserved save');
    assert.throws(() => ensureDirectory(path.join(outside, 'save.dat')), /not a directory/);
  } finally {
    fs.mkdirSync = mkdir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('applies generated binary patches and rejects the wrong baseline', () => {
  const previousTestFlag = process.env.RPG_AGENT_UPDATER_TEST;
  process.env.RPG_AGENT_UPDATER_TEST = '1';
  try {
    const updater = require(runtimeFile) as { applyBinaryPatch(base: Buffer | null, patch: Buffer): Buffer };
    const base = Buffer.alloc(128 * 1024, 1);
    const next = Buffer.from(base);
    next.write('updated content', 70000, 'utf8');
    const patch = createBinaryPatch(base, next);
    assert.deepEqual(updater.applyBinaryPatch(base, patch), next);
    assert.deepEqual(updater.applyBinaryPatch(null, createBinaryPatch(null, next)), next);
    assert.throws(() => updater.applyBinaryPatch(Buffer.from('wrong baseline'), patch), /baseline SHA-256/);
  } finally {
    if (previousTestFlag === undefined) delete process.env.RPG_AGENT_UPDATER_TEST;
    else process.env.RPG_AGENT_UPDATER_TEST = previousTestFlag;
  }
});

test('prepares, applies, and rolls back a Windows content update without touching saves', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-updater-runtime-'));
  const game = path.join(root, 'game');
  const packageDirectory = path.join(root, 'package');
  const staging = path.join(root, 'staging');
  const backup = path.join(game, '.rpg-agent', 'update-backups', 'release-next');
  const previousTestFlag = process.env.RPG_AGENT_UPDATER_TEST;
  process.env.RPG_AGENT_UPDATER_TEST = '1';
  try {
    const updater = require(runtimeFile) as {
      validatePlan(value: unknown): any;
      prepareTarget(plan: any, stagingDirectory: string): void;
      applyTarget(plan: any, stagingDirectory: string, backupDirectory: string): any;
      rollback(plan: any, backupDirectory: string, journal: any): void;
    };
    write(game, 'data/Map001.json', 'old map');
    write(game, 'data/Removed.json', 'remove me');
    write(game, 'save/file1.rpgsave', 'player save');
    write(packageDirectory, 'data/Map001.json', 'new map');
    write(packageDirectory, 'data/Added.json', 'new file');
    const targetFiles = [
      manifestEntry('data/Added.json', 'new file'),
      manifestEntry('data/Map001.json', 'new map'),
    ];
    write(packageDirectory, '.rpg-agent/release-package.json', JSON.stringify({
      schemaVersion: 1,
      releaseId: 'release-next',
      gameId: 'sample-game',
      channel: 'stable',
      packageType: 'full',
      targetFiles,
      deletedFiles: ['data/Removed.json'],
      patches: [],
    }));
    const plan = updater.validatePlan({
      schemaVersion: 1,
      gameProcessId: process.pid,
      gameDirectory: game,
      packageDirectory,
      gameId: 'sample-game',
      currentReleaseId: 'release-old',
      release: { releaseId: 'release-next', channel: 'stable' },
      pkg: {
        packageType: 'full',
        targetFiles,
        deletedFiles: ['data/Removed.json'],
      },
    });

    updater.prepareTarget(plan, staging);
    const journal = updater.applyTarget(plan, staging, backup);
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Map001.json'), 'utf8'), 'new map');
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Added.json'), 'utf8'), 'new file');
    assert.equal(fs.existsSync(path.join(game, 'data', 'Removed.json')), false);
    assert.equal(fs.readFileSync(path.join(game, 'save', 'file1.rpgsave'), 'utf8'), 'player save');

    updater.rollback(plan, backup, journal);
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Map001.json'), 'utf8'), 'old map');
    assert.equal(fs.existsSync(path.join(game, 'data', 'Added.json')), false);
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Removed.json'), 'utf8'), 'remove me');
    assert.equal(fs.readFileSync(path.join(game, 'save', 'file1.rpgsave'), 'utf8'), 'player save');
  } finally {
    if (previousTestFlag === undefined) delete process.env.RPG_AGENT_UPDATER_TEST;
    else process.env.RPG_AGENT_UPDATER_TEST = previousTestFlag;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects corrupted Windows update content before changing the installed game', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-updater-corrupt-'));
  const game = path.join(root, 'game');
  const packageDirectory = path.join(root, 'package');
  const staging = path.join(root, 'staging');
  const previousTestFlag = process.env.RPG_AGENT_UPDATER_TEST;
  process.env.RPG_AGENT_UPDATER_TEST = '1';
  try {
    const updater = require(runtimeFile) as {
      validatePlan(value: unknown): any;
      prepareTarget(plan: any, stagingDirectory: string): void;
    };
    write(game, 'data/Map001.json', 'installed map');
    write(game, 'save/file1.rpgsave', 'player save');
    write(packageDirectory, 'data/Map001.json', 'corrupted download');
    const targetFiles = [manifestEntry('data/Map001.json', 'expected new map')];
    write(packageDirectory, '.rpg-agent/release-package.json', JSON.stringify({
      schemaVersion: 1,
      releaseId: 'release-corrupt',
      gameId: 'sample-game',
      channel: 'stable',
      packageType: 'full',
      targetFiles,
      deletedFiles: [],
      patches: [],
    }));
    const plan = updater.validatePlan({
      schemaVersion: 1,
      gameProcessId: process.pid,
      gameDirectory: game,
      packageDirectory,
      gameId: 'sample-game',
      currentReleaseId: 'release-old',
      release: { releaseId: 'release-corrupt', channel: 'stable' },
      pkg: { packageType: 'full', targetFiles, deletedFiles: [] },
    });

    assert.throws(() => updater.prepareTarget(plan, staging), /verification failed/i);
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Map001.json'), 'utf8'), 'installed map');
    assert.equal(fs.readFileSync(path.join(game, 'save', 'file1.rpgsave'), 'utf8'), 'player save');
  } finally {
    if (previousTestFlag === undefined) delete process.env.RPG_AGENT_UPDATER_TEST;
    else process.env.RPG_AGENT_UPDATER_TEST = previousTestFlag;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rolls back files already replaced when a later Windows file is locked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-updater-locked-'));
  const game = path.join(root, 'game');
  const staging = path.join(root, 'staging');
  const backup = path.join(game, '.rpg-agent', 'update-backups', 'release-locked');
  const previousTestFlag = process.env.RPG_AGENT_UPDATER_TEST;
  process.env.RPG_AGENT_UPDATER_TEST = '1';
  try {
    const updater = require(runtimeFile) as {
      validatePlan(value: unknown): any;
      applyTarget(plan: any, stagingDirectory: string, backupDirectory: string, journal: any): any;
      rollback(plan: any, backupDirectory: string, journal: any): void;
    };
    write(game, 'data/First.json', 'first old');
    write(game, 'data/Locked.json', 'locked old');
    write(game, 'save/file1.rpgsave', 'player save');
    write(staging, 'data/First.json', 'first new');
    write(staging, 'data/Locked.json', 'locked new');
    const targetFiles = [
      manifestEntry('data/First.json', 'first new'),
      manifestEntry('data/Locked.json', 'locked new'),
    ];
    const plan = updater.validatePlan({
      schemaVersion: 1,
      gameProcessId: process.pid,
      gameDirectory: game,
      packageDirectory: path.join(root, 'package'),
      gameId: 'sample-game',
      currentReleaseId: 'release-old',
      release: { releaseId: 'release-locked', channel: 'stable' },
      pkg: { packageType: 'full', targetFiles, deletedFiles: [] },
    });
    const journal = {
      schemaVersion: 1,
      releaseId: 'release-locked',
      previousReleaseId: 'release-old',
      files: [],
    };
    const lockedPath = path.join(game, 'data', 'Locked.json');
    const originalRemove = fs.unlinkSync;
    try {
      fs.unlinkSync = ((target: fs.PathLike) => {
        if (path.resolve(String(target)) === path.resolve(lockedPath)) {
          const error = new Error('simulated locked file') as NodeJS.ErrnoException;
          error.code = 'EBUSY';
          throw error;
        }
        return originalRemove(target);
      }) as typeof fs.unlinkSync;
      assert.throws(() => updater.applyTarget(plan, staging, backup, journal), /simulated locked file/);
    } finally {
      fs.unlinkSync = originalRemove;
    }
    updater.rollback(plan, backup, journal);
    assert.equal(fs.readFileSync(path.join(game, 'data', 'First.json'), 'utf8'), 'first old');
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Locked.json'), 'utf8'), 'locked old');
    assert.equal(fs.readFileSync(path.join(game, 'save', 'file1.rpgsave'), 'utf8'), 'player save');
  } finally {
    if (previousTestFlag === undefined) delete process.env.RPG_AGENT_UPDATER_TEST;
    else process.env.RPG_AGENT_UPDATER_TEST = previousTestFlag;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restores the previous Windows release when updated-game startup health fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-agent-updater-health-'));
  const game = path.join(root, 'game');
  const packageDirectory = path.join(root, 'package');
  const planFile = path.join(root, 'plan.json');
  const previousTestFlag = process.env.RPG_AGENT_UPDATER_TEST;
  const spawnDescriptor = Object.getOwnPropertyDescriptor(childProcess, 'spawn');
  process.env.RPG_AGENT_UPDATER_TEST = '1';
  try {
    const updater = require(runtimeFile) as {
      runPlan(planPath: string): Promise<void>;
    };
    write(game, 'Game.exe', 'test executable');
    write(game, 'data/Map001.json', 'old map');
    write(game, 'save/file1.rpgsave', 'player save');
    write(packageDirectory, 'data/Map001.json', 'new map');
    const targetFiles = [manifestEntry('data/Map001.json', 'new map')];
    write(packageDirectory, '.rpg-agent/release-package.json', JSON.stringify({
      schemaVersion: 1,
      releaseId: 'release-health-failure',
      gameId: 'sample-game',
      channel: 'stable',
      packageType: 'full',
      targetFiles,
      deletedFiles: [],
      patches: [],
    }));
    fs.writeFileSync(planFile, JSON.stringify({
      schemaVersion: 1,
      gameProcessId: 2_147_000_000,
      gameDirectory: game,
      packageDirectory,
      gameId: 'sample-game',
      currentReleaseId: 'release-old',
      release: { releaseId: 'release-health-failure', channel: 'stable' },
      pkg: { packageType: 'full', targetFiles, deletedFiles: [] },
    }), 'utf8');

    const spawnArguments: string[][] = [];
    Object.defineProperty(childProcess, 'spawn', {
      configurable: true,
      writable: true,
      value: (_command: string, args: readonly string[] = []) => {
        spawnArguments.push(Array.from(args));
        return {
          pid: 2_147_000_000 + spawnArguments.length,
          unref: () => undefined,
        };
      },
    });

    await assert.rejects(
      updater.runPlan(planFile),
      /exited before startup self-check completed/i,
    );
    assert.equal(fs.readFileSync(path.join(game, 'data', 'Map001.json'), 'utf8'), 'old map');
    assert.equal(fs.readFileSync(path.join(game, 'save', 'file1.rpgsave'), 'utf8'), 'player save');
    assert.equal(spawnArguments.length, 2);
    assert.equal(spawnArguments[0].includes('--rpg-agent-expected-release=release-health-failure'), true);
    assert.equal(spawnArguments[1].includes('--rpg-agent-expected-release=release-old'), true);
  } finally {
    if (spawnDescriptor) Object.defineProperty(childProcess, 'spawn', spawnDescriptor);
    if (previousTestFlag === undefined) delete process.env.RPG_AGENT_UPDATER_TEST;
    else process.env.RPG_AGENT_UPDATER_TEST = previousTestFlag;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function manifestEntry(relativePath: string, content: string) {
  const buffer = Buffer.from(content, 'utf8');
  return {
    path: relativePath,
    bytes: buffer.byteLength,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    processing: 'none',
  };
}

function write(root: string, relativePath: string, content: string): void {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}
