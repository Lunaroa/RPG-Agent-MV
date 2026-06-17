import { app, BrowserWindow, dialog, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveWorkflowRoot } from '../../../backend/src/core/workspace-paths.ts';
import { initFileLogger } from '../../../backend/src/core/file-log.ts';
import {
  cleanupIpcHandlers,
  confirmProjectStagingBeforeClose,
  getWorkspaceSettings,
  initializeIpcHandlers,
  patchWorkspaceSettings,
  readWorkspaceWindowOptions,
  saveWorkspaceWindowState,
} from './ipc-handlers.js';
import { startUiControlBridge, stopUiControlBridge } from './ui-control-bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let windowSaveTimer: ReturnType<typeof setTimeout> | null = null;
let allowWindowClose = false;
let closeGuardRunning = false;

protocol.registerSchemesAsPrivileged([
  { scheme: 'rmmv-asset', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

function workspaceRoot(): string {
  return resolveWorkflowRoot(__dirname);
}

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
  const root = workspaceRoot();

  await initializeIpcHandlers(root);

  const windowOptions = readWorkspaceWindowOptions();
  mainWindow = new BrowserWindow({
    width: windowOptions.width,
    height: windowOptions.height,
    x: windowOptions.x,
    y: windowOptions.y,
    frame: false,
    icon: path.join(root, 'src', 'ui', 'desktop', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (windowOptions.shouldMaximize) {
    mainWindow.maximize();
  }
  await startUiControlBridge(root, () => mainWindow);

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
    void confirmProjectStagingBeforeClose(root, mainWindow).then((confirmed) => {
      closeGuardRunning = false;
      if (!confirmed || !mainWindow || mainWindow.isDestroyed()) return;
      allowWindowClose = true;
      mainWindow.close();
    }).catch((error) => {
      closeGuardRunning = false;
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox('退出检查失败', message);
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
}

app.whenReady().then(() => {
  if (app.isPackaged) process.env.AGENT_RPG_RESOURCES_PATH = process.resourcesPath;
  createWindow().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    console.error('[main] failed to start:', err);
    dialog.showErrorBox(
      '应用启动失败，即将退出',
      `Agent Console 未能就绪：\n\n${message}\n\n` +
        '常见原因：依赖加载失败或配置错误。',
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
