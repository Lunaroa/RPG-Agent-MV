import { app, BrowserWindow, dialog, protocol, screen } from 'electron';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureUserDataLayout } from '../../../backend/src/core/desktop/user-data-layout.ts';
import { resolveInstallRoot, resolveUserDataRoot } from '../../../backend/src/core/workspace-paths.ts';
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
  shutdownMapPreview,
  shutdownInteractivePlaytest,
} from './ipc-handlers.js';
import { electronText } from './electronLocalization.js';
import { startUiControlBridge, stopUiControlBridge } from './ui-control-bridge.js';
import { initAutoUpdater } from './auto-updater.js';
import { RMMV_ASSET_SCHEME } from './asset-protocol-policy.js';
import {
  buildDesktopWindowPolicy,
  isBackgroundUiControlMode,
  uiControlProfilePath,
} from './ui-control-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backgroundUiControlMode = isBackgroundUiControlMode();
const preReadyUserDataRoot = backgroundUiControlMode ? resolveUserDataRoot(__dirname) : '';

if (backgroundUiControlMode) {
  const profilePath = uiControlProfilePath(preReadyUserDataRoot);
  fs.mkdirSync(profilePath, { recursive: true });
  app.setPath('userData', profilePath);
}

let mainWindow: BrowserWindow | null = null;
let windowSaveTimer: ReturnType<typeof setTimeout> | null = null;
let allowWindowClose = false;
let closeGuardRunning = false;
let userDataRoot = '';
let installRoot = '';

protocol.registerSchemesAsPrivileged([
  RMMV_ASSET_SCHEME,
]);

function scheduleWindowStateSave(): void {
  if (backgroundUiControlMode) return;
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
    inMemoryWorkspaceSettings: backgroundUiControlMode,
  });

  const backgroundWorkArea = backgroundUiControlMode ? screen.getPrimaryDisplay().workArea : undefined;
  const storedWindowOptions = backgroundUiControlMode
    ? { width: backgroundWorkArea!.width, height: backgroundWorkArea!.height, shouldMaximize: false }
    : readWorkspaceWindowOptions();
  const windowPolicy = buildDesktopWindowPolicy(storedWindowOptions, backgroundUiControlMode, backgroundWorkArea);
  mainWindow = new BrowserWindow({
    width: windowPolicy.width,
    height: windowPolicy.height,
    x: windowPolicy.x,
    y: windowPolicy.y,
    show: windowPolicy.show,
    skipTaskbar: windowPolicy.skipTaskbar,
    focusable: windowPolicy.focusable,
    paintWhenInitiallyHidden: windowPolicy.paintWhenInitiallyHidden,
    useContentSize: windowPolicy.useContentSize,
    frame: false,
    icon: path.join(installRoot, 'src', 'ui', 'desktop', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: windowPolicy.backgroundThrottling,
    },
  });

  if (windowPolicy.shouldMaximize) {
    mainWindow.maximize();
  }

  const firstRunDone = !backgroundUiControlMode && Boolean(getWorkspaceSettings().window?.firstRunDone);
  if (!backgroundUiControlMode && !firstRunDone) {
    patchWorkspaceSettings({
      window: {
        firstRunDone: true,
        maximized: windowPolicy.shouldMaximize,
      },
    });
  }

  if (windowPolicy.persistWindowState) {
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
        await shutdownMapPreview();
        closeGuardRunning = false;
        allowWindowClose = true;
        mainWindow.close();
      })().catch((error) => {
        closeGuardRunning = false;
        const message = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox(electronText(currentProductLanguage(), 'main.closeCheckFailed'), message);
      });
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log(`[main] Loading dev server URL: ${process.env.VITE_DEV_SERVER_URL}`);
    console.log(`[main] Preload path: ${path.join(__dirname, 'preload.js')}`);
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  await startUiControlBridge(userDataRoot, () => mainWindow);

  console.log('[main] Window loaded, IPC handlers ready');
  if (!backgroundUiControlMode) initAutoUpdater(() => currentProductLanguage());
}

let layoutMigrated: string[] = [];

app.whenReady().then(() => {
  installRoot = resolveInstallRoot(__dirname);
  userDataRoot = backgroundUiControlMode
    ? preReadyUserDataRoot
    : app.isPackaged
      ? app.getPath('userData')
      : resolveUserDataRoot(__dirname);

  process.env.AGENT_RPG_INSTALL_ROOT = installRoot;
  process.env.AGENT_RPG_ROOT = userDataRoot;
  if (app.isPackaged) process.env.AGENT_RPG_RESOURCES_PATH = process.resourcesPath;

  const layout = ensureUserDataLayout(installRoot, userDataRoot);
  layoutMigrated = layout.migrated;

  createWindow().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    console.error('[main] failed to start:', err);
    if (backgroundUiControlMode) {
      app.exit(1);
      return;
    }
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
  if (!backgroundUiControlMode && mainWindow && !mainWindow.isDestroyed()) saveWorkspaceWindowState(mainWindow);
  stopUiControlBridge();
  cleanupIpcHandlers();
});

app.on('activate', () => {
  if (backgroundUiControlMode) {
    app.quit();
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => console.error('[main] reactivate failed:', err));
  }
});
