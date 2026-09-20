import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { AndroidToolchainInstallRequest, MediaToolInstallRequest, GameToolInstallProgress, GameToolKind } from '../../../../contract/game-release.ts';
export { inspectMediaTools } from './game-content-processing-service.ts';

export function startGameToolInstall(workflowRoot: string, kind: GameToolKind, request: AndroidToolchainInstallRequest | MediaToolInstallRequest, onProgress: (event: GameToolInstallProgress) => void) {
  if (kind !== 'android' && kind !== 'media') throw new Error('Unknown packaging tool.');
  if ((kind === 'android' ? (request as AndroidToolchainInstallRequest).acceptAndroidSdkLicense : (request as MediaToolInstallRequest).acceptLicense) !== true) throw new Error('Accept the tool license before installation.');
  const operationId = request.operationId || crypto.randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operationId)) throw new Error('Invalid installation operation id.');
  const typescript = import.meta.url.endsWith('.ts');
  const logDirectory = path.join(path.resolve(workflowRoot), 'runtime', 'game-build', 'logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  const logFile = path.join(logDirectory, `${operationId}.jsonl`);
  const writeLog = (event: unknown) => fs.appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), event })}\n`, 'utf8');
  const worker = new Worker(new URL(typescript ? './game-tool-install-worker.ts' : './game-tool-install-worker.js', import.meta.url), {
    execArgv: typescript ? ['--experimental-strip-types', '--experimental-transform-types'] : [],
  });
  const cancelBuffer = new SharedArrayBuffer(4);
  const canceled = new Int32Array(cancelBuffer);
  const result = new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let progressError: Error | undefined;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      error = progressError || error;
      try { writeLog(error ? { error: error.message } : { completed: true }); }
      catch (logError) { error ||= logError instanceof Error ? logError : new Error(String(logError)); }
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    worker.on('message', message => {
      if (message.type === 'progress') {
        const event = { ...message.event, kind, operationId, logPath: logFile };
        try { writeLog(event); onProgress(event); }
        catch (error) {
          progressError = error instanceof Error ? error : new Error(String(error));
          Atomics.store(canceled, 0, 1);
        }
      } else if (message.type === 'result') finish(undefined, message.result);
      else if (message.type === 'error') finish(new Error(message.error));
    });
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Tool installation worker exited before completion (${code}).`)); });
    try {
      const initial: GameToolInstallProgress = { kind, operationId, logPath: logFile, stage: 'download', received: 0 };
      writeLog(initial);
      onProgress(initial);
      worker.postMessage({ workflowRoot, kind, request, cancelBuffer });
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
  return { result, cancel: () => { Atomics.store(canceled, 0, 1); } };
}
