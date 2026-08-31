import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withTestLanguage } from '../i18n/with-test-language.ts';

import {
  abortProjectGitMerge,
  commitProjectGit,
  discardProjectGitChange,
  enableProjectGit,
  getProjectGitFileDiff,
  getProjectGitStatus,
  listProjectGitConflicts,
  listProjectGitLog,
  pullProjectGit,
  pushProjectGit,
  resolveProjectGitConflict,
  setProjectGitRemote,
} from './project-git-service.ts';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function writeProjectFile(projectRoot: string, relativePath: string, content: string): void {
  const target = path.join(projectRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createProject(projectRoot: string): void {
  writeProjectFile(projectRoot, 'Game.rpgproject', 'RPGMV 1.6.2');
  writeProjectFile(projectRoot, 'data/System.json', JSON.stringify({ gameTitle: 'Sample Game' }));
  writeProjectFile(projectRoot, 'img/faces/actor1.png', Buffer.from([1, 2, 3]).toString('binary'));
}

function configureIdentity(projectRoot: string): void {
  git(projectRoot, ['config', 'user.name', 'Fixture User']);
  git(projectRoot, ['config', 'user.email', 'fixture@example.com']);
}

test('enable initializes a repository with LFS rules and a first commit', async (t) => withTestLanguage(async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-enable-'));
  try {
    createProject(projectRoot);
    let status = await getProjectGitStatus(projectRoot);
    assert.equal(status.available, true);
    assert.equal(status.enabled, false);

    status = await enableProjectGit(projectRoot);
    configureIdentity(projectRoot);
    assert.equal(status.enabled, true);
    assert.ok(status.branch);
    assert.ok(fs.existsSync(path.join(projectRoot, '.gitignore')));
    assert.ok(fs.readFileSync(path.join(projectRoot, '.gitattributes'), 'utf8').includes('filter=lfs'));
    const log = await listProjectGitLog(projectRoot);
    assert.equal(log.length, 1);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}));

test('status reports added, modified and deleted files with sizes', async (t) => withTestLanguage(async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-status-'));
  try {
    createProject(projectRoot);
    await enableProjectGit(projectRoot);
    configureIdentity(projectRoot);

    writeProjectFile(projectRoot, 'data/System.json', JSON.stringify({ gameTitle: 'Changed' }));
    writeProjectFile(projectRoot, 'data/Map001.json', JSON.stringify({ events: [] }));
    fs.rmSync(path.join(projectRoot, 'Game.rpgproject'));

    const status = await getProjectGitStatus(projectRoot);
    const kinds = new Map(status.changes.map((change) => [change.path, change.kind]));
    assert.equal(kinds.get('data/System.json'), 'modified');
    assert.equal(kinds.get('data/Map001.json'), 'added');
    assert.equal(kinds.get('Game.rpgproject'), 'deleted');
    const modified = status.changes.find((change) => change.path === 'data/System.json');
    assert.ok(modified && typeof modified.size === 'number' && modified.size > 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}));

test('commit records a labelled milestone and discarding restores files', async (t) => withTestLanguage(async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-commit-'));
  try {
    createProject(projectRoot);
    await enableProjectGit(projectRoot);
    configureIdentity(projectRoot);

    writeProjectFile(projectRoot, 'data/System.json', JSON.stringify({ gameTitle: 'Chapter 1' }));
    const result = await commitProjectGit(projectRoot, 'v1.0.0');
    assert.equal(result.committed, true);
    assert.ok(result.commitHash);
    const log = await listProjectGitLog(projectRoot);
    assert.equal(log[0]?.message, 'v1.0.0');

    writeProjectFile(projectRoot, 'data/System.json', JSON.stringify({ gameTitle: 'Broken' }));
    writeProjectFile(projectRoot, 'scratch.txt', 'temp');
    await discardProjectGitChange(projectRoot, 'data/System.json');
    await discardProjectGitChange(projectRoot, 'scratch.txt');
    const status = await getProjectGitStatus(projectRoot);
    assert.equal(status.changes.length, 0);
    assert.ok(fs.readFileSync(path.join(projectRoot, 'data', 'System.json'), 'utf8').includes('Chapter 1'));

    const empty = await commitProjectGit(projectRoot, 'nothing');
    assert.equal(empty.committed, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}));

test('push and pull synchronize commits through a remote and report ahead/behind', async (t) => withTestLanguage(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-sync-'));
  const remote = path.join(root, 'remote.git');
  const local = path.join(root, 'local');
  const other = path.join(root, 'other');
  fs.mkdirSync(local, { recursive: true });
  try {
    git(root, ['init', '--bare', remote]);
    createProject(local);
    await enableProjectGit(local);
    configureIdentity(local);
    git(local, ['remote', 'add', 'origin', remote]);

    const pushed = await pushProjectGit(local);
    assert.deepEqual(pushed, { ahead: 0, behind: 0 });

    git(root, ['clone', remote, other]);
    configureIdentity(other);
    writeProjectFile(other, 'data/Map002.json', JSON.stringify({ events: [] }));
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'remote change']);
    git(other, ['push', 'origin', 'HEAD']);

    const pulled = await pullProjectGit(local);
    assert.equal(pulled.merging, false);
    assert.ok(fs.existsSync(path.join(local, 'data', 'Map002.json')));
    assert.deepEqual(await pullProjectGit(local), { ahead: 0, behind: 0, merging: false });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}));

test('pull conflicts can be resolved per file or aborted', async (t) => withTestLanguage(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-conflict-'));
  const remote = path.join(root, 'remote.git');
  const local = path.join(root, 'local');
  const other = path.join(root, 'other');
  fs.mkdirSync(local, { recursive: true });
  try {
    git(root, ['init', '--bare', remote]);
    createProject(local);
    await enableProjectGit(local);
    configureIdentity(local);
    git(local, ['remote', 'add', 'origin', remote]);
    await pushProjectGit(local);

    git(root, ['clone', remote, other]);
    configureIdentity(other);
    writeProjectFile(other, 'data/System.json', JSON.stringify({ gameTitle: 'Remote Title' }));
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'remote title']);
    git(other, ['push', 'origin', 'HEAD']);

    writeProjectFile(local, 'data/System.json', JSON.stringify({ gameTitle: 'Local Title' }));
    await commitProjectGit(local, 'local title');

    await assert.rejects(pullProjectGit(local), /冲突|conflict/i);
    assert.deepEqual(await listProjectGitConflicts(local), ['data/System.json']);
    assert.equal((await getProjectGitStatus(local)).merging, true);

    const resolved = await resolveProjectGitConflict(local, 'data/System.json', 'remote');
    assert.equal(resolved.merged, true);
    assert.ok(fs.readFileSync(path.join(local, 'data', 'System.json'), 'utf8').includes('Remote Title'));
    assert.equal((await getProjectGitStatus(local)).merging, false);

    // abort path
    writeProjectFile(other, 'data/System.json', JSON.stringify({ gameTitle: 'Remote Again' }));
    git(other, ['add', '-A']);
    git(other, ['commit', '-m', 'remote again']);
    git(other, ['push', 'origin', 'HEAD']);
    writeProjectFile(local, 'data/System.json', JSON.stringify({ gameTitle: 'Local Again' }));
    await commitProjectGit(local, 'local again');
    await assert.rejects(pullProjectGit(local), /冲突|conflict/i);
    await abortProjectGitMerge(local);
    assert.equal((await getProjectGitStatus(local)).merging, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}));

test('remote url validation accepts https and rejects credentials or ssh', async (t) => withTestLanguage(async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-remote-'));
  try {
    createProject(projectRoot);
    await enableProjectGit(projectRoot);
    configureIdentity(projectRoot);
    const url = await setProjectGitRemote(projectRoot, 'https://example.com/account/repository.git');
    assert.equal(url, 'https://example.com/account/repository.git');
    assert.equal((await getProjectGitStatus(projectRoot)).remoteUrl, url);
    await assert.rejects(setProjectGitRemote(projectRoot, 'git@example.com:account/repository.git'));
    await assert.rejects(setProjectGitRemote(projectRoot, 'https://user:secret@example.com/a/b.git'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}));

test('file diff shows line-level add and del entries, and flags binary files', async (t) => withTestLanguage(async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-diff-'));
  try {
    createProject(projectRoot);
    await enableProjectGit(projectRoot);
    configureIdentity(projectRoot);

    writeProjectFile(projectRoot, 'data/System.json', '{"gameTitle":"Changed Title"}');
    writeProjectFile(projectRoot, 'notes.txt', 'first\nsecond');
    writeProjectFile(projectRoot, 'img/faces/new.png', Buffer.from([0, 1, 0, 2]).toString('binary'));

    const modified = await getProjectGitFileDiff(projectRoot, 'data/System.json');
    assert.equal(modified.kind, 'modified');
    assert.ok(modified.lines.some((line) => line.type === 'del' && line.text.includes('Sample Game')));
    assert.ok(modified.lines.some((line) => line.type === 'add' && line.text.includes('Changed Title')));
    assert.ok(modified.lines.some((line) => line.type === 'hunk'));

    const added = await getProjectGitFileDiff(projectRoot, 'notes.txt');
    assert.equal(added.kind, 'added');
    assert.deepEqual(added.lines.map((line) => `${line.type}:${line.text}`), ['add:first', 'add:second']);

    const binary = await getProjectGitFileDiff(projectRoot, 'img/faces/new.png');
    assert.equal(binary.binary, true);
    assert.equal(binary.lines.length, 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}));


