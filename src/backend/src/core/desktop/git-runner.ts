import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';

import {
  projectCheckGitDependency,
  projectGitFailed,
  projectGitMissing,
  projectGitTimeout,
} from './projectServiceLocalization.ts';

const execFileAsync = promisify(execFile);

export const DEFAULT_GIT_READ_TIMEOUT_MS = 30_000;
export const DEFAULT_GIT_WRITE_TIMEOUT_MS = 300_000;
export const DEFAULT_GIT_NETWORK_TIMEOUT_MS = 600_000;

const NETWORK_COMMANDS = new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote']);

export const GIT_MISSING_CODE = 'GIT_MISSING';

export class GitMissingError extends Error {
  readonly code = GIT_MISSING_CODE;

  constructor() {
    super(projectGitMissing());
    this.name = 'GitMissingError';
  }
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
}

export async function runGit(cwd: string, args: string[], label = `git ${args.join(' ')}`): Promise<GitRunResult> {
  const timeoutMs = gitCommandTimeoutMs(args);
  const invocation = gitInvocation(args);
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return {
      stdout: stringOutput(result.stdout),
      stderr: stringOutput(result.stderr),
    };
  } catch (error) {
    const err = error as ExecFileException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string | number;
      killed?: boolean;
      signal?: NodeJS.Signals;
    };
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GitMissingError();
    }
    if (err.killed || err.signal === 'SIGTERM' || /timed out/i.test(err.message || '')) {
      throw new Error(projectGitTimeout(label, Math.max(1, Math.round(timeoutMs / 1000))));
    }
    const output = `${stringOutput(err.stderr)}${stringOutput(err.stdout)}`.trim();
    throw new Error(projectGitFailed(output, err.message || `git ${args.join(' ')}`));
  }
}

export async function assertGitAvailable(cwd: string): Promise<void> {
  await runGit(cwd, ['--version'], projectCheckGitDependency());
}

export function gitCommandTimeoutMs(args: readonly string[]): number {
  const raw = Number(process.env.RMMV_GIT_TIMEOUT_MS || '');
  if (Number.isFinite(raw) && raw > 0) return raw;
  const command = gitCommandName(args);
  if (NETWORK_COMMANDS.has(command)) return DEFAULT_GIT_NETWORK_TIMEOUT_MS;
  return command === 'add' || command === 'commit'
    ? DEFAULT_GIT_WRITE_TIMEOUT_MS
    : DEFAULT_GIT_READ_TIMEOUT_MS;
}

function gitCommandName(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '-c') {
      index += 1;
      continue;
    }
    return args[index] ?? '';
  }
  return '';
}

export function gitInvocation(args: string[]): { command: string; args: string[] } {
  const configured = process.env.RMMV_GIT_COMMAND?.trim();
  if (!configured) return { command: 'git', args };
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(configured)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', [configured, ...args].join(' ')],
    };
  }
  return { command: configured, args };
}

function stringOutput(value: string | Buffer | undefined): string {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}
