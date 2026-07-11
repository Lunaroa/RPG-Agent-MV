import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface UpdatePublishState {
  dirtyPaths: string[];
  hasGitHubToken: boolean;
  versions: {
    product: string;
    desktop: string;
    backend: string;
  };
}

export function validateUpdatePublishState(state: UpdatePublishState): string[] {
  const errors: string[] = [];
  if (state.dirtyPaths.length) {
    errors.push('Secure update publishing requires a clean Git worktree.');
  }
  if (!state.hasGitHubToken) {
    errors.push('A GitHub release token is required in GH_TOKEN or GITHUB_TOKEN.');
  }
  const versions = Object.values(state.versions);
  if (!versions[0] || versions.some((version) => version !== versions[0])) {
    errors.push('Product, desktop, and backend package versions must match.');
  }
  return errors;
}

function readPackageVersion(filePath: string): string {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version?: unknown };
  return typeof value.version === 'string' ? value.version.trim() : '';
}

export function collectUpdatePublishState(productRoot: string): UpdatePublishState {
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: productRoot, encoding: 'utf8' },
  );
  if (status.status !== 0) {
    throw new Error(`Unable to inspect the release worktree: ${status.stderr || status.stdout || `exit ${status.status}`}`);
  }
  return {
    dirtyPaths: String(status.stdout || '').split(/\r?\n/).filter(Boolean),
    hasGitHubToken: Boolean(process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()),
    versions: {
      product: readPackageVersion(path.join(productRoot, 'package.json')),
      desktop: readPackageVersion(path.join(productRoot, 'src', 'ui', 'desktop', 'package.json')),
      backend: readPackageVersion(path.join(productRoot, 'src', 'backend', 'package.json')),
    },
  };
}

export function runUpdatePublishGuard(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const productRoot = path.resolve(scriptDir, '../../../..');
  const errors = validateUpdatePublishState(collectUpdatePublishState(productRoot));
  if (errors.length) {
    throw new Error(`Secure GitHub update publish blocked:\n- ${errors.join('\n- ')}`);
  }
  console.log('[update-publish] clean worktree, GitHub token, and package versions verified');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  runUpdatePublishGuard();
}
