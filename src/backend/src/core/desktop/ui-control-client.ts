export interface BackgroundUiControlServerInfo {
  commandUrl: string;
  token: string;
  pid: number;
  windowMode: 'background';
}

export function validateBackgroundUiControlServerInfo(
  raw: unknown,
  isAlive: (pid: number) => boolean = isProcessAlive,
): BackgroundUiControlServerInfo {
  if (!raw || typeof raw !== 'object') throw new Error('UI control bridge metadata is invalid.');
  const value = raw as Record<string, unknown>;
  if (value.windowMode !== 'background') {
    throw new Error('UI control refused a non-background Electron instance. Start npm run dev:ui-control.');
  }
  const commandUrl = typeof value.commandUrl === 'string' ? value.commandUrl.trim() : '';
  const token = typeof value.token === 'string' ? value.token.trim() : '';
  const pid = Number(value.pid);
  if (!commandUrl || !token || !Number.isInteger(pid) || pid < 1) {
    throw new Error('UI control bridge metadata is invalid.');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(commandUrl);
  } catch {
    throw new Error('UI control bridge command URL is invalid.');
  }
  if (parsedUrl.protocol !== 'http:' || parsedUrl.hostname !== '127.0.0.1') {
    throw new Error('UI control bridge command URL must use loopback HTTP.');
  }
  if (!isAlive(pid)) {
    throw new Error(`Background UI control process ${pid} is no longer running.`);
  }
  return { commandUrl, token, pid, windowMode: 'background' };
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EPERM');
  }
}
