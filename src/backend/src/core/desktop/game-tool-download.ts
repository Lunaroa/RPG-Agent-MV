import crypto from 'node:crypto';
import fs from 'node:fs';
import { GameBuildProcessCanceledError } from './game-build-process-service.ts';

export interface ToolDownloadOptions {
  isCanceled?: () => boolean;
  onProgress?: (received: number, total?: number) => void;
  idleTimeoutMs?: number;
}

export async function downloadVerifiedTool(url: string, destination: string, sha256: string, options: ToolDownloadOptions = {}): Promise<void> {
  if (options.isCanceled?.()) throw new GameBuildProcessCanceledError();
  const controller = new AbortController();
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  let lastActivity = Date.now();
  let received = 0;
  let file: fs.promises.FileHandle | undefined;
  let downloadFailed = false;
  let downloadError: unknown;
  const poll = setInterval(() => {
    if (options.isCanceled?.()) controller.abort(new GameBuildProcessCanceledError());
    else if (Date.now() - lastActivity > (options.idleTimeoutMs ?? 60_000)) controller.abort(new Error('Toolchain download timed out without receiving data. Check the connection and retry.'));
  }, 50);
  poll.unref();
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Toolchain download failed with HTTP ${response.status}.`);
    const totalHeader = Number(response.headers.get('content-length'));
    const total = totalHeader > 0 ? totalHeader : undefined;
    lastActivity = Date.now();
    options.onProgress?.(0, total);
    file = await fs.promises.open(temporary, 'wx');
    const hash = crypto.createHash('sha256');
    for await (const chunk of response.body) {
      controller.signal.throwIfAborted();
      lastActivity = Date.now();
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      hash.update(bytes);
      await file.writeFile(bytes);
      options.onProgress?.(received, total);
    }
    if (total !== undefined && received !== total) throw new Error('Toolchain download size does not match the server response.');
    if (hash.digest('hex') !== sha256) throw new Error('Toolchain download SHA-256 mismatch.');
    await file.close();
    file = undefined;
    controller.signal.throwIfAborted();
    fs.renameSync(temporary, destination);
  } catch (error) {
    const failure = controller.signal.aborted ? controller.signal.reason : error;
    downloadFailed = true;
    downloadError = failure;
    controller.abort(failure);
    throw failure;
  } finally {
    clearInterval(poll);
    const cleanupErrors: unknown[] = [];
    try { await file?.close(); } catch (error) { cleanupErrors.push(error); }
    try { if (fs.existsSync(temporary)) fs.rmSync(temporary); } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) {
      const errors = downloadFailed ? [downloadError, ...cleanupErrors] : cleanupErrors;
      throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : String(error)).join('\n'));
    }
  }
}
