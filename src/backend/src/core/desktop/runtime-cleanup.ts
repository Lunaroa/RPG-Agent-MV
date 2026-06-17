import fs from 'node:fs';
import path from 'node:path';

import { SESSION_RETENTION_DAYS } from './session-retention.ts';

/** 与 session retention 对齐的 ephemeral 子项保留天数。 */
export const RUNTIME_EPHEMERAL_RETENTION_DAYS = Number(
  process.env.RMMV_RUNTIME_EPHEMERAL_RETENTION_DAYS || SESSION_RETENTION_DAYS,
);

export interface PruneRuntimeLegacyArtifactsOptions {
  /** 仅报告将删除的路径，不写入磁盘。 */
  dryRun?: boolean;
  now?: Date;
  ephemeralRetentionDays?: number;
}

export interface PruneRuntimeLegacyArtifactsResult {
  removed: string[];
  skipped: string[];
}

const LEGACY_RUNTIME_FILES = [
  'rmmv.db',
  'rmmv.db-wal',
  'rmmv.db-shm',
  'rmmv.db.bak',
  'console-settings.json',
  'sessions.json',
] as const;

const LEGACY_RUNTIME_REL_PATHS = [
  'providers/providers.json',
  'map-selection',
  'story-tasks',
  'story-outlines',
  'edge-cdp-profile',
] as const;

const EPHEMERAL_PRUNE_DIRS = [
  'agent-console-playtest',
  'tool-results',
] as const;

function runtimePath(workflowRoot: string, ...segments: string[]): string {
  return path.join(path.resolve(workflowRoot), 'runtime', ...segments);
}

function relRuntime(...segments: string[]): string {
  return path.join('runtime', ...segments).replace(/\\/g, '/');
}

function removePath(
  target: string,
  rel: string,
  options: PruneRuntimeLegacyArtifactsOptions,
  result: PruneRuntimeLegacyArtifactsResult,
): void {
  if (!fs.existsSync(target)) return;
  if (!options.dryRun) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  result.removed.push(rel);
}

function skip(
  rel: string,
  result: PruneRuntimeLegacyArtifactsResult,
): void {
  if (!result.skipped.includes(rel)) {
    result.skipped.push(rel);
  }
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** SQLite 已是 SSOT 时，event-registry 下仅 JSON 或空目录视为可删遗留。 */
function isDeprecatedEventRegistryDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const top = fs.readdirSync(dir);
  if (top.length === 0) return true;
  const files = walkFiles(dir);
  if (files.length === 0) return true;
  return files.every((file) => file.endsWith('.json'));
}

function isEmptyDirectory(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).length === 0;
}

function pruneStaleEphemeralEntries(
  workflowRoot: string,
  dirName: string,
  cutoffMs: number,
  options: PruneRuntimeLegacyArtifactsOptions,
  result: PruneRuntimeLegacyArtifactsResult,
): void {
  const dir = runtimePath(workflowRoot, dirName);
  if (!fs.existsSync(dir)) return;

  let removedAny = false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = relRuntime(dirName, entry.name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs >= cutoffMs) continue;

    if (!options.dryRun) {
      fs.rmSync(full, { recursive: true, force: true });
    }
    result.removed.push(rel);
    removedAny = true;
  }

  if (removedAny && isEmptyDirectory(dir) && !options.dryRun) {
    fs.rmSync(dir, { recursive: true, force: true });
    result.removed.push(relRuntime(dirName));
  }
}

/**
 * 启动时清理 runtime/ 下已迁 SQLite 或明确废弃的路径；幂等、不触碰活跃模板与密钥。
 */
export function pruneRuntimeLegacyArtifacts(
  workflowRoot: string,
  options: PruneRuntimeLegacyArtifactsOptions = {},
): PruneRuntimeLegacyArtifactsResult {
  const root = path.resolve(workflowRoot);
  const result: PruneRuntimeLegacyArtifactsResult = { removed: [], skipped: [] };
  const dataDb = path.join(root, 'data', 'rmmv.db');
  const hasDataDb = fs.existsSync(dataDb);

  for (const name of LEGACY_RUNTIME_FILES) {
    const rel = relRuntime(name);
    const target = runtimePath(root, name);
    if (!fs.existsSync(target)) continue;

    if (name.startsWith('rmmv.db') && !hasDataDb) {
      skip(rel, result);
      continue;
    }

    removePath(target, rel, options, result);
  }

  for (const relPath of LEGACY_RUNTIME_REL_PATHS) {
    removePath(runtimePath(root, relPath), relRuntime(relPath), options, result);
  }

  const eventRegistryDir = runtimePath(root, 'event-registry');
  if (fs.existsSync(eventRegistryDir)) {
    const rel = relRuntime('event-registry');
    if (isDeprecatedEventRegistryDir(eventRegistryDir)) {
      removePath(eventRegistryDir, rel, options, result);
    } else {
      skip(rel, result);
    }
  }

  const secretsDir = runtimePath(root, 'secrets');
  if (isEmptyDirectory(secretsDir)) {
    removePath(secretsDir, relRuntime('secrets'), options, result);
  }

  const dataAssetsDir = path.join(root, 'data', 'assets');
  const legacyLocalAssetsDir = path.join(root, 'local-assets');
  if (fs.existsSync(dataAssetsDir) && fs.existsSync(legacyLocalAssetsDir)) {
    removePath(legacyLocalAssetsDir, 'local-assets', options, result);
  }

  const workspaceSecretsDir = path.join(root, 'secrets');
  if (isEmptyDirectory(workspaceSecretsDir)) {
    removePath(workspaceSecretsDir, 'secrets', options, result);
  }

  const now = options.now ?? new Date();
  const retentionDays = options.ephemeralRetentionDays ?? RUNTIME_EPHEMERAL_RETENTION_DAYS;
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const dirName of EPHEMERAL_PRUNE_DIRS) {
    pruneStaleEphemeralEntries(root, dirName, cutoffMs, options, result);
  }

  return result;
}


