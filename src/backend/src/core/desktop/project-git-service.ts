import fs from 'node:fs';
import path from 'node:path';

import type {
  ProjectGitChange,
  ProjectGitChangeKind,
  ProjectGitCommit,
  ProjectGitConflictChoice,
  ProjectGitDiffLine,
  ProjectGitFileDiff,
  ProjectGitStatus,
} from '../../../../contract/project-git.ts';
import { assertGitAvailable, GitMissingError, runGit } from './git-runner.ts';
import { normalizeVersionCommitMessage } from './project-service.ts';
import {
  projectDirectoryMissing,
  projectGitChangePathRequired,
  projectGitLfsMissing,
  projectGitNotMerging,
  projectGitPullConflict,
  projectGitRemoteInvalid,
  projectGitRemoteMissing,
  projectGitRootMismatch,
  projectVersionNoChanges,
  projectVersionNotInitialized,
  projectVersionSaved,
} from './projectServiceLocalization.ts';

export const PROJECT_GITIGNORE_CONTENT = [
  '# RPG Maker editor/runtime state',
  '*.rmmvproject.bak',
  'save/',
  'www/save/',
  '.luna_rpg/',
  '.rpg-agent/',
  'Thumbs.db',
  'desktop.ini',
  '',
].join('\n');

export const PROJECT_GITATTRIBUTES_CONTENT = [
  '# Large binary assets are managed by Git LFS',
  'img/** filter=lfs diff=lfs merge=lfs -text',
  'audio/** filter=lfs diff=lfs merge=lfs -text',
  'movies/** filter=lfs diff=lfs merge=lfs -text',
  '*.png filter=lfs diff=lfs merge=lfs -text',
  '*.jpg filter=lfs diff=lfs merge=lfs -text',
  '*.jpeg filter=lfs diff=lfs merge=lfs -text',
  '*.gif filter=lfs diff=lfs merge=lfs -text',
  '*.webp filter=lfs diff=lfs merge=lfs -text',
  '*.ogg filter=lfs diff=lfs merge=lfs -text',
  '*.m4a filter=lfs diff=lfs merge=lfs -text',
  '*.mp3 filter=lfs diff=lfs merge=lfs -text',
  '*.mp4 filter=lfs diff=lfs merge=lfs -text',
  '*.webm filter=lfs diff=lfs merge=lfs -text',
  '',
].join('\n');

function assertProjectDirectory(projectPath: string): void {
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error(projectDirectoryMissing(projectPath));
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isGitRepository(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, '.git'));
}

function isMerging(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, '.git', 'MERGE_HEAD'));
}

async function assertGitRepositoryRoot(projectPath: string): Promise<void> {
  const topLevel = (await runGit(projectPath, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (!samePath(topLevel, projectPath)) {
    throw new Error(projectGitRootMismatch(topLevel));
  }
}

function assertEnabled(projectPath: string): void {
  if (!isGitRepository(projectPath)) {
    throw new Error(projectVersionNotInitialized());
  }
}

async function detectLfsReady(projectPath: string): Promise<boolean> {
  try {
    await runGit(projectPath, ['lfs', 'version'], 'git lfs version');
    return true;
  } catch {
    return false;
  }
}

async function detectGitAvailable(projectPath: string): Promise<boolean> {
  try {
    await assertGitAvailable(projectPath);
    return true;
  } catch (error) {
    if (error instanceof GitMissingError) return false;
    throw error;
  }
}

function normalizeRelativePath(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error(projectGitChangePathRequired());
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(projectGitChangePathRequired());
  }
  return segments.join('/');
}

function changeKindFromStatus(staged: string, unstaged: string): ProjectGitChangeKind {
  const flags = `${staged}${unstaged}`;
  if (flags === '??') return 'added';
  if (flags.includes('R')) return 'renamed';
  if (flags.includes('A')) return 'added';
  if (flags.includes('D')) return 'deleted';
  return 'modified';
}

function parsePorcelainChanges(projectPath: string, output: string): ProjectGitChange[] {
  const changes: ProjectGitChange[] = [];
  for (const line of output.split('\n')) {
    if (line.length < 4) continue;
    const staged = line[0] ?? ' ';
    const unstaged = line[1] ?? ' ';
    let filePath = line.slice(3).trim();
    const renameMarker = filePath.indexOf(' -> ');
    if (renameMarker >= 0) filePath = filePath.slice(renameMarker + 4);
    if (filePath.startsWith('"') && filePath.endsWith('"')) filePath = filePath.slice(1, -1);
    if (!filePath) continue;
    const kind = changeKindFromStatus(staged, unstaged);
    let size: number | null = null;
    if (kind !== 'deleted') {
      try {
        size = fs.statSync(path.join(projectPath, ...filePath.split('/'))).size;
      } catch {
        size = null;
      }
    }
    changes.push({ path: filePath, kind, size });
  }
  changes.sort((left, right) => left.path.localeCompare(right.path));
  return changes;
}

async function readAheadBehind(projectPath: string): Promise<{ ahead: number; behind: number }> {
  try {
    const output = (await runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).stdout.trim();
    const [ahead, behind] = output.split(/\s+/).map((value) => Number(value));
    return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function readRemoteUrl(projectPath: string): Promise<string | null> {
  try {
    const url = (await runGit(projectPath, ['remote', 'get-url', 'origin'])).stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

export async function getProjectGitStatus(projectPath: string): Promise<ProjectGitStatus> {
  assertProjectDirectory(projectPath);
  const available = await detectGitAvailable(projectPath);
  const lfsReady = available ? await detectLfsReady(projectPath) : false;
  if (!available || !isGitRepository(projectPath)) {
    return {
      available,
      enabled: false,
      lfsReady,
      branch: null,
      changes: [],
      ahead: 0,
      behind: 0,
      remoteUrl: null,
      merging: false,
    };
  }
  await assertGitRepositoryRoot(projectPath);
  const branchOutput = (await runGit(projectPath, ['branch', '--show-current'])).stdout.trim();
  const statusOutput = (await runGit(projectPath, ['status', '--porcelain', '--untracked-files=all'])).stdout;
  const { ahead, behind } = await readAheadBehind(projectPath);
  return {
    available: true,
    enabled: true,
    lfsReady,
    branch: branchOutput || 'main',
    changes: parsePorcelainChanges(projectPath, statusOutput),
    ahead,
    behind,
    remoteUrl: await readRemoteUrl(projectPath),
    merging: isMerging(projectPath),
  };
}

async function ensureGitIdentity(projectPath: string): Promise<void> {
  try {
    await runGit(projectPath, ['config', 'user.name']);
  } catch {
    await runGit(projectPath, ['config', 'user.name', 'Luna RPG Agent']);
  }
  try {
    await runGit(projectPath, ['config', 'user.email']);
  } catch {
    await runGit(projectPath, ['config', 'user.email', 'luna-rpg-agent@localhost']);
  }
}

export async function enableProjectGit(projectPath: string): Promise<ProjectGitStatus> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  if (!isGitRepository(projectPath)) {
    await runGit(projectPath, ['init']);
  }
  await assertGitRepositoryRoot(projectPath);
  if (!(await detectLfsReady(projectPath))) {
    throw new Error(projectGitLfsMissing());
  }
  await ensureGitIdentity(projectPath);
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, PROJECT_GITIGNORE_CONTENT, 'utf8');
  }
  const attributesPath = path.join(projectPath, '.gitattributes');
  if (!fs.existsSync(attributesPath)) {
    fs.writeFileSync(attributesPath, PROJECT_GITATTRIBUTES_CONTENT, 'utf8');
  }
  await runGit(projectPath, ['lfs', 'install', '--local'], 'git lfs install');
  await commitProjectGit(projectPath, undefined);
  return getProjectGitStatus(projectPath);
}

export async function commitProjectGit(
  projectPath: string,
  message?: string,
): Promise<{ committed: boolean; commitHash?: string; message: string }> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  await assertGitRepositoryRoot(projectPath);
  const statusOutput = (await runGit(projectPath, ['status', '--porcelain', '--untracked-files=all'])).stdout.trim();
  if (!statusOutput) {
    return { committed: false, message: projectVersionNoChanges() };
  }
  const commitMessage = normalizeVersionCommitMessage(message);
  await runGit(projectPath, ['add', '-A']);
  await runGit(projectPath, ['commit', '-m', commitMessage]);
  const commitHash = (await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
  return { committed: true, commitHash, message: projectVersionSaved() };
}

export async function listProjectGitLog(projectPath: string, limit = 100): Promise<ProjectGitCommit[]> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  const output = (await runGit(projectPath, [
    'log', `--max-count=${Math.max(1, Math.min(limit, 500))}`, '--format=%H%x1f%an%x1f%aI%x1f%s',
  ])).stdout;
  return output.split('\n').filter(Boolean).map((line) => {
    const [hash = '', author = '', time = '', ...messageParts] = line.split('\x1f');
    return { hash, author, time, message: messageParts.join('\x1f') };
  });
}

export async function discardProjectGitChange(projectPath: string, relativePath: string): Promise<void> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  const relative = normalizeRelativePath(relativePath);
  const statusOutput = (await runGit(projectPath, ['status', '--porcelain', '--', relative])).stdout.trim();
  if (!statusOutput) return;
  const staged = statusOutput[0] ?? ' ';
  const unstaged = statusOutput[1] ?? ' ';
  if (staged === '?' || unstaged === '?') {
    await fs.promises.rm(path.join(projectPath, ...relative.split('/')), { recursive: true, force: true });
    return;
  }
  if (staged === 'A') {
    await runGit(projectPath, ['rm', '-f', '--', relative]);
    return;
  }
  await runGit(projectPath, ['checkout', 'HEAD', '--', relative]);
}

export async function getProjectGitRemote(projectPath: string): Promise<string | null> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  return readRemoteUrl(projectPath);
}

export async function setProjectGitRemote(projectPath: string, url: string): Promise<string> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  const normalized = typeof url === 'string' ? url.trim() : '';
  if (!/^https:\/\/[^\s/]+\.[^\s/]+\/[^\s]+/i.test(normalized) || normalized.includes('@')) {
    throw new Error(projectGitRemoteInvalid());
  }
  const existing = await readRemoteUrl(projectPath);
  if (existing) {
    await runGit(projectPath, ['remote', 'set-url', 'origin', normalized]);
  } else {
    await runGit(projectPath, ['remote', 'add', 'origin', normalized]);
  }
  return normalized;
}

function authConfigArgs(token: string | undefined): string[] {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) return [];
  const basic = Buffer.from(`x:${trimmed}`, 'utf8').toString('base64');
  return ['-c', `http.extraHeader=AUTHORIZATION: Basic ${basic}`];
}

export async function pushProjectGit(projectPath: string, token?: string): Promise<{ ahead: number; behind: number }> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  if (!(await readRemoteUrl(projectPath))) throw new Error(projectGitRemoteMissing());
  await runGit(projectPath, [...authConfigArgs(token), 'push', '-u', 'origin', 'HEAD'], 'git push');
  await runGit(projectPath, [...authConfigArgs(token), 'fetch', 'origin'], 'git fetch');
  return readAheadBehind(projectPath);
}

export async function pullProjectGit(projectPath: string, token?: string): Promise<{ ahead: number; behind: number; merging: boolean }> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  if (!(await readRemoteUrl(projectPath))) throw new Error(projectGitRemoteMissing());
  const branch = (await runGit(projectPath, ['branch', '--show-current'])).stdout.trim() || 'main';
  try {
    await runGit(projectPath, [...authConfigArgs(token), 'pull', '--no-rebase', 'origin', branch], 'git pull');
  } catch (error) {
    if (isMerging(projectPath)) throw new Error(projectGitPullConflict());
    throw error;
  }
  const { ahead, behind } = await readAheadBehind(projectPath);
  return { ahead, behind, merging: isMerging(projectPath) };
}

export async function listProjectGitConflicts(projectPath: string): Promise<string[]> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  if (!isMerging(projectPath)) return [];
  const output = (await runGit(projectPath, ['diff', '--name-only', '--diff-filter=U'])).stdout;
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export async function resolveProjectGitConflict(
  projectPath: string,
  relativePath: string,
  choice: ProjectGitConflictChoice,
): Promise<{ merged: boolean; remaining: string[] }> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  if (!isMerging(projectPath)) throw new Error(projectGitNotMerging());
  const relative = normalizeRelativePath(relativePath);
  const side = choice === 'remote' ? '--theirs' : '--ours';
  await runGit(projectPath, ['checkout', side, '--', relative]);
  await runGit(projectPath, ['add', '--', relative]);
  const remaining = await listProjectGitConflicts(projectPath);
  if (remaining.length === 0) {
    await runGit(projectPath, ['commit', '--no-edit']);
    return { merged: true, remaining: [] };
  }
  return { merged: false, remaining };
}

export async function abortProjectGitMerge(projectPath: string): Promise<void> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  if (!isMerging(projectPath)) throw new Error(projectGitNotMerging());
  await runGit(projectPath, ['merge', '--abort']);
}

const DIFF_TEXT_LIMIT_BYTES = 512 * 1024;
const DIFF_LINE_LIMIT = 5000;

function looksBinary(content: Buffer): boolean {
  return content.subarray(0, Math.min(content.length, 8192)).includes(0);
}

function parseUnifiedDiff(patch: string): ProjectGitDiffLine[] {
  const lines: ProjectGitDiffLine[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')
      || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity index')
      || line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('@@')) lines.push({ type: 'hunk', text: line });
    else if (line.startsWith('+')) lines.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) lines.push({ type: 'del', text: line.slice(1) });
    else lines.push({ type: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
    if (lines.length >= DIFF_LINE_LIMIT) break;
  }
  return lines;
}

export async function getProjectGitFileDiff(projectPath: string, relativePath: string): Promise<ProjectGitFileDiff> {
  assertProjectDirectory(projectPath);
  await assertGitAvailable(projectPath);
  assertEnabled(projectPath);
  const relative = normalizeRelativePath(relativePath);
  const statusOutput = (await runGit(projectPath, ['status', '--porcelain', '--', relative])).stdout.trim();
  const kind = statusOutput
    ? changeKindFromStatus(statusOutput[0] ?? ' ', statusOutput[1] ?? ' ')
    : 'modified';

  if (kind === 'added' && statusOutput.startsWith('??')) {
    const absolute = path.join(projectPath, ...relative.split('/'));
    const content = await fs.promises.readFile(absolute);
    if (looksBinary(content)) return { path: relative, kind, binary: true, tooLarge: false, lines: [] };
    if (content.length > DIFF_TEXT_LIMIT_BYTES) return { path: relative, kind, binary: false, tooLarge: true, lines: [] };
    const lines = content.toString('utf8').split('\n').slice(0, DIFF_LINE_LIMIT)
      .map((text) => ({ type: 'add' as const, text }));
    return { path: relative, kind, binary: false, tooLarge: false, lines };
  }

  const patch = (await runGit(projectPath, ['diff', 'HEAD', '--', relative])).stdout;
  if (patch.includes('Binary files') || patch.includes('GIT binary patch')) {
    return { path: relative, kind, binary: true, tooLarge: false, lines: [] };
  }
  return { path: relative, kind, binary: false, tooLarge: false, lines: parseUnifiedDiff(patch) };
}
