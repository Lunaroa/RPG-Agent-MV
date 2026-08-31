import { BrowserWindow, ipcMain } from 'electron';

let versionWindow: BrowserWindow | null = null;
let preloadPath = '';
let rendererEntry = '';
let getMainWindow: () => BrowserWindow | null = () => null;
let configured = false;

export function configureVersionWindow(options: {
  preloadPath: string;
  rendererEntry: string;
  getMainWindow: () => BrowserWindow | null;
}): void {
  if (configured) return;
  configured = true;
  preloadPath = options.preloadPath;
  rendererEntry = options.rendererEntry;
  getMainWindow = options.getMainWindow;
  ipcMain.handle('versionWindow:open', () => openVersionWindow());
  ipcMain.handle('versionWindow:status-changed', (_event, status: unknown) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('projectGit:statusChanged', status ?? null);
    return { ok: true };
  });
  ipcMain.handle('versionWindow:project-changed', (_event, project: unknown) => {
    if (versionWindow && !versionWindow.isDestroyed()) {
      versionWindow.webContents.send('projectGit:projectChanged', typeof project === 'string' ? project : '');
    }
    return { ok: true };
  });
}

async function openVersionWindow(): Promise<{ ok: true }> {
  if (versionWindow && !versionWindow.isDestroyed()) {
    if (versionWindow.isMinimized()) versionWindow.restore();
    versionWindow.focus();
    return { ok: true };
  }
  versionWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 560,
    show: false,
    backgroundColor: '#f7f5f1',
    title: 'Luna RPG Agent Version Management',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  versionWindow.on('closed', () => { versionWindow = null; });
  versionWindow.once('ready-to-show', () => versionWindow?.show());
  versionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  versionWindow.webContents.on('will-navigate', (event, target) => {
    const allowedPrefix = /^https?:\/\//.test(rendererEntry) ? rendererEntry : 'file:';
    if (target.startsWith(allowedPrefix)) return;
    event.preventDefault();
  });
  if (/^https?:\/\//.test(rendererEntry)) {
    const target = new URL(rendererEntry);
    target.searchParams.set('window', 'version');
    await versionWindow.loadURL(target.toString());
  } else await versionWindow.loadFile(rendererEntry, { query: { window: 'version' } });
  return { ok: true };
}

export function cleanupVersionWindow(): void {
  if (!configured) return;
  configured = false;
  ipcMain.removeHandler('versionWindow:open');
  ipcMain.removeHandler('versionWindow:status-changed');
  ipcMain.removeHandler('versionWindow:project-changed');
  if (versionWindow && !versionWindow.isDestroyed()) versionWindow.destroy();
  versionWindow = null;
}
