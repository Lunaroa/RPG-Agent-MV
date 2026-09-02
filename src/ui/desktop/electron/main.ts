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
  requestRendererCloseResolution,
  saveWorkspaceWindowState,
  shutdownMapPreview,
  shutdownInteractivePlaytest,
} from './ipc-handlers.js';
import { electronText } from './electronLocalization.js';
import { registerDesktopDevToolsShortcuts } from './desktop-devtools-shortcuts.js';
import { startUiControlBridge, stopUiControlBridge } from './ui-control-bridge.js';
import { initAutoUpdater } from './auto-updater.js';
import { RMMV_ASSET_SCHEME } from './asset-protocol-policy.js';
import { MAP_PREVIEW_SCHEME } from './map-preview-protocol.js';
import { cleanupDocumentationWindow, configureDocumentationWindow, DOCUMENTATION_SCHEME } from './documentation-window.js';
import { resolveDocumentationRoot } from './documentation-policy.js';
import {
  buildDesktopWindowPolicy,
  isBackgroundUiControlMode,
  uiControlProfilePath,
} from './ui-control-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backgroundUiControlMode = isBackgroundUiControlMode();
const preReadyUserDataRoot = backgroundUiControlMode ? resolveUserDataRoot(__dirname) : '';

function installUiDesignerRendererLoadDiagnostics(webContents: BrowserWindow['webContents']): void {
  const isRendererUrl = (value: string) => value.startsWith(`${MAP_PREVIEW_SCHEME.scheme}://`);
  const report = (stage: string, details: Record<string, unknown> = {}) => {
    console.warn(`[ui-control][ui-designer-load] ${JSON.stringify({ stage, ...details })}`);
  };
  const reportConsole = (_event: unknown, level: number, message: string, line: number, sourceId: string) => {
    if (isRendererUrl(sourceId) || /MZUI|renderer bridge|rpg-agent-preview/i.test(message)) {
      report('console-message', { level, message: String(message).slice(0, 1024), line, source: String(sourceId).slice(0, 512) });
    }
  };
  const reportFail = (_event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean, frameProcessId: number, frameRoutingId: number) => {
    if (!isRendererUrl(validatedURL)) return;
    report('did-fail-load', { errorCode, errorDescription, url: validatedURL, isMainFrame, frameProcessId, frameRoutingId });
  };
  webContents.on('console-message', reportConsole);
  webContents.on('did-frame-navigate', (_event, url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isRendererUrl(url)) report('did-frame-navigate', { url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId });
  });
  webContents.on('did-fail-load', reportFail);
  webContents.on('did-fail-provisional-load', reportFail);
  webContents.on('did-frame-finish-load', (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    try {
      const frame = webContents.mainFrame.framesInSubtree.find((candidate) => candidate.processId === frameProcessId && candidate.routingId === frameRoutingId);
      if (frame && isRendererUrl(frame.url)) report('did-frame-finish-load', { url: frame.url, isMainFrame, frameProcessId, frameRoutingId });
    } catch {
      // The frame may disappear while a renderer session is being disposed.
    }
  });
}

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
  MAP_PREVIEW_SCHEME,
  { scheme: DOCUMENTATION_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
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

async function offerForceClose(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const language = currentProductLanguage();
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: electronText(language, 'main.closeInProgressTitle'),
    message: electronText(language, 'main.closeInProgressTitle'),
    detail: electronText(language, 'main.closeInProgressDetail'),
    buttons: [electronText(language, 'main.forceClose'), electronText(language, 'main.closeWait')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (result.response !== 0 || win.isDestroyed()) return;
  void shutdownInteractivePlaytest().catch(() => undefined);
  void shutdownMapPreview().catch(() => undefined);
  win.destroy();
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url !== 'about:blank' || details.frameName !== 'rpg-agent-ui-designer-preview') return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: mainWindow ?? undefined,
        modal: false,
        frame: true,
        useContentSize: true,
        show: !backgroundUiControlMode,
        paintWhenInitiallyHidden: true,
        backgroundColor: '#090a0d',
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      },
    };
  });

  // The UI designer preview window has no preload of its own; give its
  // webContents the same F12 DevTools toggle as the main editor window.
  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    if (backgroundUiControlMode) return;
    if (details.frameName !== 'rpg-agent-ui-designer-preview') return;
    registerDesktopDevToolsShortcuts(childWindow.webContents);
  });

  if (backgroundUiControlMode) installUiDesignerRendererLoadDiagnostics(mainWindow.webContents);

  if (!backgroundUiControlMode) {
    registerDesktopDevToolsShortcuts(mainWindow.webContents);
  }

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
      if (closeGuardRunning) {
        void offerForceClose(mainWindow);
        return;
      }
      closeGuardRunning = true;
      void (async () => {
        const win = mainWindow!;
        const rendererProceed = await requestRendererCloseResolution(win);
        if (!rendererProceed || win.isDestroyed()) {
          closeGuardRunning = false;
          return;
        }
        const confirmed = await confirmProjectStagingBeforeClose(userDataRoot, win);
        if (!confirmed || win.isDestroyed()) {
          closeGuardRunning = false;
          return;
        }
        await shutdownInteractivePlaytest();
        await shutdownMapPreview();
        closeGuardRunning = false;
        allowWindowClose = true;
        win.close();
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

  configureDocumentationWindow({
    documentationRoot: resolveDocumentationRoot({ packaged: app.isPackaged, appPath: app.getAppPath(), installRoot }),
    preloadPath: path.join(__dirname, 'documentation-preload.js'),
    rendererEntry: process.env.VITE_DEV_SERVER_URL
      ? new URL('documentation.html', process.env.VITE_DEV_SERVER_URL).toString()
      : path.join(__dirname, '../dist/documentation.html'),
  });

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
  cleanupDocumentationWindow();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (!backgroundUiControlMode && mainWindow && !mainWindow.isDestroyed()) saveWorkspaceWindowState(mainWindow);
  stopUiControlBridge();
  cleanupIpcHandlers();
  cleanupDocumentationWindow();
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
