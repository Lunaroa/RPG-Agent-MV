import fs from 'node:fs/promises';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { UpdateInfo } from 'electron-updater';
import { autoUpdater } from 'electron-updater';
import { electronText, type ElectronMessageKey } from './electronLocalization.js';
import type { ProductLanguage } from '../../../contract/i18n.ts';
import {
  checkUpdaterAvailability,
  parseSecureUpdateConfigYaml,
} from './update-policy.js';

const STARTUP_CHECK_DELAY_MS = 5_000;

export type CheckForUpdatesResult =
  | { ok: true; status: 'update-available'; version: string; channel: 'github' }
  | { ok: true; status: 'up-to-date'; channel: 'github' }
  | { ok: false; status: 'not-packaged' | 'untrusted-build' | 'busy' | 'error'; error?: string };

type LanguageResolver = () => ProductLanguage;

let languageResolver: LanguageResolver = () => 'en-US';
let initialized = false;
let checking = false;
let promptOpen = false;
let secureConfigValidation: Promise<void> | null = null;

function t(key: ElectronMessageKey, params: Record<string, string | number> = {}): string {
  return electronText(languageResolver(), key, params);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireSecurePackagedUpdateConfig(): Promise<void> {
  if (!secureConfigValidation) {
    secureConfigValidation = (async () => {
      const configPath = path.join(process.resourcesPath, 'app-update.yml');
      const raw = await fs.readFile(configPath, 'utf8');
      parseSecureUpdateConfigYaml(raw);
    })();
  }
  await secureConfigValidation;
}

async function showDownloadFailure(error: unknown): Promise<void> {
  await dialog.showMessageBox({
    type: 'error',
    buttons: [t('updater.ok')],
    title: t('updater.downloadFailedTitle'),
    message: t('updater.downloadFailedMessage'),
    detail: errorMessage(error),
  });
}

async function promptAndDownload(info: UpdateInfo): Promise<void> {
  if (promptOpen) return;
  promptOpen = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: [t('updater.updateNow'), t('updater.later')],
      defaultId: 0,
      cancelId: 1,
      title: t('updater.updateAvailableTitle'),
      message: t('updater.updateAvailableMessage', { version: info.version }),
      detail: t('updater.updateAvailableDetail'),
    });
    if (response !== 0) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('[updater] download failed:', error);
      await showDownloadFailure(error);
    }
  } finally {
    promptOpen = false;
  }
}

async function promptForRestart(info: UpdateInfo): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: [t('updater.restartNow'), t('updater.later')],
    defaultId: 0,
    cancelId: 1,
    title: t('updater.downloadedTitle'),
    message: t('updater.downloadedMessage', { version: info.version }),
    detail: t('updater.downloadedDetail'),
  });
  if (response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
}

async function showUpToDateMessage(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    buttons: [t('updater.ok')],
    title: t('updater.upToDateTitle'),
    message: t('updater.upToDateMessage', { version: app.getVersion() }),
  });
}

async function showUntrustedBuildMessage(error: unknown): Promise<void> {
  await dialog.showMessageBox({
    type: 'error',
    buttons: [t('updater.ok')],
    title: t('updater.untrustedBuildTitle'),
    message: t('updater.untrustedBuildMessage'),
    detail: errorMessage(error),
  });
}

export async function checkForUpdates(options: { manual?: boolean } = {}): Promise<CheckForUpdatesResult> {
  const manual = Boolean(options.manual);
  if (!app.isPackaged) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        buttons: [t('updater.ok')],
        title: t('updater.notPackagedTitle'),
        message: t('updater.notPackagedMessage'),
      });
    }
    return { ok: false, status: 'not-packaged' };
  }
  if (checking) return { ok: false, status: 'busy' };

  checking = true;
  try {
    try {
      await requireSecurePackagedUpdateConfig();
    } catch (error) {
      console.error('[updater] secure update configuration rejected:', error);
      if (manual) await showUntrustedBuildMessage(error);
      return { ok: false, status: 'untrusted-build', error: errorMessage(error) };
    }

    try {
      const result = await checkUpdaterAvailability(autoUpdater);
      if (manual && result.status === 'up-to-date') {
        await showUpToDateMessage();
      }
      if (result.status === 'update-available') {
        return { ok: true, ...result, channel: 'github' };
      }
      return { ok: true, status: 'up-to-date', channel: 'github' };
    } catch (error) {
      const message = errorMessage(error);
      console.error('[updater] GitHub update check failed:', error);
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          buttons: [t('updater.ok')],
          title: t('updater.checkFailedTitle'),
          message: t('updater.checkFailedMessage'),
          detail: message,
        });
      }
      return { ok: false, status: 'error', error: message };
    }
  } finally {
    checking = false;
  }
}

export function initAutoUpdater(getLanguage: LanguageResolver): void {
  if (initialized) return;
  initialized = true;
  languageResolver = getLanguage;

  if (!app.isPackaged) {
    console.log('[updater] skipped in unpackaged/dev mode');
    return;
  }

  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('update-available', (info) => {
    void promptAndDownload(info).catch((error) => {
      console.error('[updater] failed to prompt for update:', error);
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    void promptForRestart(info).catch((error) => {
      console.error('[updater] failed to prompt for restart:', error);
    });
  });

  autoUpdater.on('error', (error) => {
    console.error('[updater] error:', error);
  });

  setTimeout(() => {
    void checkForUpdates({ manual: false });
  }, STARTUP_CHECK_DELAY_MS);
}

export function getAppVersion(): string {
  return app.getVersion();
}
