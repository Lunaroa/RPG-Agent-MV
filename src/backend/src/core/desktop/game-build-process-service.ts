import { spawn } from 'node:child_process';
import path from 'node:path';

export function javaToolArguments(executable: string, args: string[]): string[] {
  // Match the managed JDK producer encoding to the UTF-8 process readers, including its launcher.
  const name = path.basename(executable).toLowerCase();
  if (name === 'java.exe') return ['-Dfile.encoding=UTF-8', ...args];
  if (name === 'keytool.exe') return ['-J-Dfile.encoding=UTF-8', ...args];
  return args;
}

export interface GameBuildProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer: number;
  isCanceled?: () => boolean;
  input?: string;
  timeoutMs?: number;
  onOutput?: (text: string) => void;
}

export interface GameBuildProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export class GameBuildProcessCanceledError extends Error {
  constructor() {
    super('The build process was canceled.');
    this.name = 'GameBuildProcessCanceledError';
  }
}

export function runGameBuildProcess(
  executable: string,
  args: string[],
  options: GameBuildProcessOptions,
): Promise<GameBuildProcessResult> {
  if (options.isCanceled?.()) return Promise.reject(new GameBuildProcessCanceledError());
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let canceled = false;
    let settled = false;
    let outputError: Error | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const startedAt = Date.now();

    const clear = () => {
      clearInterval(cancelPoll);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const terminate = () => {
      if (canceled || settled) return;
      canceled = true;
      try { child.kill(); } catch { /* The close or error event will settle the result. */ }
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          try { child.kill('SIGKILL'); } catch { /* The close or error event will settle the result. */ }
        }
      }, 2_000);
      forceKillTimer.unref();
    };
    const append = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > options.maxBuffer) {
        outputError = new Error(`The build process produced more than ${options.maxBuffer} bytes of output.`);
        terminate();
        return;
      }
      if (target === 'stdout') stdout += text;
      else stderr += text;
      try { options.onOutput?.(text); }
      catch (error) {
        outputError = error instanceof Error ? error : new Error(String(error));
        terminate();
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));
    child.stdin?.on('error', () => { /* An early exit is reported by the process result. */ });
    child.stdin?.end(options.input);
    const cancelPoll = setInterval(() => {
      if (options.isCanceled?.()) terminate();
      if (options.timeoutMs && Date.now() - startedAt >= options.timeoutMs) {
        outputError = new Error(`The build process timed out after ${options.timeoutMs} ms.`);
        terminate();
      }
    }, 50);
    cancelPoll.unref();

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clear();
      if (canceled) reject(new GameBuildProcessCanceledError());
      else reject(error);
    });
    child.once('close', (status) => {
      if (settled) return;
      settled = true;
      clear();
      if (outputError) reject(outputError);
      else if (canceled) reject(new GameBuildProcessCanceledError());
      else resolve({ status, stdout, stderr });
    });
  });
}
