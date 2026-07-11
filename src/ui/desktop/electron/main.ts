import { app, BrowserWindow, dialog, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureUserDataLayout } from '../../../backend/src/core/desktop/user-data-layout.ts';
import { resolveInstallRoot } from '../../../backend/src/core/workspace-paths.ts';
import { initFileLogger } from '../../../backend/src/core/file-log.ts';
import {
  cleanupIpcHandlers,
  confirmProjectStagingBeforeClose,
  currentProductLanguage,
  getWorkspaceSettings,
  initializeIpcHandlers,
  patchWorkspaceSettings,
  readWorkspaceWindowOptions,
  saveWorkspaceWindowState,
  shutdownInteractivePlaytest,
} from './ipc-handlers.js';
import { electronText } from './electronLocalization.js';
import { startUiControlBridge, stopUiControlBridge } from './ui-control-bridge.js';
import { initAutoUpdater } from './auto-updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let windowSaveTimer: ReturnType<typeof setTimeout> | null = null;
let allowWindowClose = false;
let closeGuardRunning = false;
let userDataRoot = '';
let installRoot = '';

protocol.registerSchemesAsPrivileged([
  { scheme: 'rmmv-asset', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

function scheduleWindowStateSave(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(() => {
    windowSaveTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) saveWorkspaceWindowState(mainWindow);
  }, 250);
}

async function createWindow() {
  initFileLogger();

  await initializeIpcHandlers({
    installRoot,
    userDataRoot,
    layoutMigrated,
  });

  const windowOptions = readWorkspaceWindowOptions();
  mainWindow = new BrowserWindow({
    width: windowOptions.width,
    height: windowOptions.height,
    x: windowOptions.x,
    y: windowOptions.y,
    frame: false,
    icon: path.join(installRoot, 'src', 'ui', 'desktop', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (windowOptions.shouldMaximize) {
    mainWindow.maximize();
  }
  await startUiControlBridge(userDataRoot, () => mainWindow);

  const firstRunDone = Boolean(getWorkspaceSettings().window?.firstRunDone);
  if (!firstRunDone) {
    patchWorkspaceSettings({
      window: {
        firstRunDone: true,
        maximized: windowOptions.shouldMaximize,
      },
    });
  }

  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('close', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    saveWorkspaceWindowState(mainWindow);
    if (allowWindowClose) return;
    event.preventDefault();
    if (closeGuardRunning) return;
    closeGuardRunning = true;
    void (async () => {
      const confirmed = await confirmProjectStagingBeforeClose(userDataRoot, mainWindow!);
      if (!confirmed || !mainWindow || mainWindow.isDestroyed()) {
        closeGuardRunning = false;
        return;
      }
      await shutdownInteractivePlaytest();
      closeGuardRunning = false;
      allowWindowClose = true;
      mainWindow.close();
    })().catch((error) => {
      closeGuardRunning = false;
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(electronText(currentProductLanguage(), 'main.closeCheckFailed'), message);
    });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log(`[main] Loading dev server URL: ${process.env.VITE_DEV_SERVER_URL}`);
    console.log(`[main] Preload path: ${path.join(__dirname, 'preload.js')}`);
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  console.log('[main] Window loaded, IPC handlers ready');
  initAutoUpdater(() => currentProductLanguage());
}

let layoutMigrated: string[] = [];

app.whenReady().then(() => {
  installRoot = resolveInstallRoot(__dirname);
  userDataRoot = app.isPackaged ? app.getPath('userData') : installRoot;

  process.env.AGENT_RPG_INSTALL_ROOT = installRoot;
  process.env.AGENT_RPG_ROOT = userDataRoot;
  if (app.isPackaged) process.env.AGENT_RPG_RESOURCES_PATH = process.resourcesPath;

  const layout = ensureUserDataLayout(installRoot, userDataRoot);
  layoutMigrated = layout.migrated;

  createWindow().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    console.error('[main] failed to start:', err);
    dialog.showErrorBox(
      electronText(currentProductLanguage(), 'main.startupFailedTitle'),
      electronText(currentProductLanguage(), 'main.startupFailedDetail', { message }),
    );
    app.quit();
  });
});

app.on('window-all-closed', () => {
  stopUiControlBridge();
  cleanupIpcHandlers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) saveWorkspaceWindowState(mainWindow);
  stopUiControlBridge();
  cleanupIpcHandlers();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => console.error('[main] reactivate failed:', err));
  }
});
