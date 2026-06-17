import fs from 'node:fs';
import path from 'node:path';

import { PATHS, resolveCliOutRoot } from '../workspace-paths.ts';

export interface PruneWorkspaceLegacyOptions {
  /** 仅报告将删除的路径，不写入磁盘。 */
  dryRun?: boolean;
}

export interface PruneWorkspaceLegacyResult {
  removed: string[];
  skipped: string[];
}

function isP3Ready(root: string): boolean {
  return fs.existsSync(path.join(root, PATHS.backendCli))
    && fs.existsSync(path.join(root, PATHS.agentsRegistry));
}

function isEmptyDirectory(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).length === 0;
}

function isEmptyTree(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length === 0) return true;
  return entries.every((entry) => {
    if (entry.isFile()) return false;
    if (entry.isDirectory()) return isEmptyTree(path.join(dir, entry.name));
    return false;
  });
}

function skip(rel: string, result: PruneWorkspaceLegacyResult): void {
  if (!result.skipped.includes(rel)) {
    result.skipped.push(rel);
  }
}

function removePathRobust(target: string): void {
  if (!fs.existsSync(target)) return;

  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    if (!fs.existsSync(target)) return;
  } catch {
    // fall through to rename strategy
  }

  if (fs.existsSync(target)) {
    const parent = path.dirname(target);
    const trashName = `.p3-legacy-trash-${path.basename(target)}-${Date.now()}`;
    const trashPath = path.join(parent, trashName);
    try {
      fs.renameSync(target, trashPath);
      fs.rmSync(trashPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      throw new Error(`Failed to remove ${target}`);
    }
  }
}

function tryRemove(
  root: string,
  rel: string,
  options: PruneWorkspaceLegacyOptions,
  result: PruneWorkspaceLegacyResult,
): void {
  const target = path.join(root, rel);
  if (!fs.existsSync(target)) return;

  if (options.dryRun) {
    result.removed.push(rel);
    return;
  }

  try {
    removePathRobust(target);
    result.removed.push(rel);
  } catch {
    skip(rel, result);
    process.stderr.write(`[workspace-legacy-cleanup] skipped ${rel} (locked or in use)\n`);
  }
}

function tryRemoveIf(
  root: string,
  rel: string,
  condition: boolean,
  options: PruneWorkspaceLegacyOptions,
  result: PruneWorkspaceLegacyResult,
): void {
  if (condition) {
    tryRemove(root, rel, options, result);
  }
}

/**
 * 启动时清理 workspace 顶层 P3 遗留空壳与重复目录；幂等、不触碰活跃四层布局。
 */
export function pruneWorkspaceLegacyArtifacts(
  workflowRoot: string,
  options: PruneWorkspaceLegacyOptions = {},
): PruneWorkspaceLegacyResult {
  const root = path.resolve(workflowRoot);
  const result: PruneWorkspaceLegacyResult = { removed: [], skipped: [] };

  if (!isP3Ready(root)) {
    return result;
  }

  if (!options.dryRun) {
    resolveCliOutRoot(root);
  }

  const uiDir = path.join(root, 'ui');
  if (fs.existsSync(uiDir) && isEmptyTree(uiDir)) {
    tryRemove(root, 'ui', options, result);
  } else if (fs.existsSync(uiDir)) {
    skip('ui', result);
  }

  tryRemoveIf(root, 'backend', fs.existsSync(path.join(root, 'src', 'backend')), options, result);
  tryRemoveIf(root, 'agents', fs.existsSync(path.join(root, PATHS.agentsRegistry)), options, result);
  tryRemoveIf(root, 'contract', fs.existsSync(path.join(root, 'src', 'contract', 'types.ts')), options, result);
  tryRemoveIf(root, 'py', fs.existsSync(path.join(root, 'src', 'py', '__init__.py')), options, result);
  tryRemoveIf(root, 'scripts', isP3Ready(root), options, result);
  tryRemoveIf(
    root,
    'local-assets',
    fs.existsSync(path.join(root, 'data', 'assets')),
    options,
    result,
  );

  const secretsDir = path.join(root, 'secrets');
  if (isEmptyDirectory(secretsDir)) {
    tryRemove(root, 'secrets', options, result);
  }

  const hasTopLevelData = fs.existsSync(path.join(root, 'data', 'rmmv.db'))
    || fs.existsSync(path.join(root, 'data'));
  tryRemoveIf(root, 'src/data', hasTopLevelData, options, result);


  const runtimeOut = path.join(root, PATHS.cliOutRoot);
  const legacyOut = path.join(root, PATHS.cliOutRootLegacy);
  if (fs.existsSync(runtimeOut) && isEmptyDirectory(legacyOut)) {
    tryRemove(root, PATHS.cliOutRootLegacy, options, result);
  }

  const toolsDir = path.join(root, 'tools');
  if (isEmptyDirectory(toolsDir)) {
    tryRemove(root, 'tools', options, result);
  } else if (fs.existsSync(toolsDir)) {
    const entries = fs.readdirSync(toolsDir);
    const onlyReadme = entries.length === 1 && entries[0].toLowerCase() === 'readme.md';
    if (onlyReadme) {
      tryRemove(root, 'tools', options, result);
    }
  }

  return result;
}
