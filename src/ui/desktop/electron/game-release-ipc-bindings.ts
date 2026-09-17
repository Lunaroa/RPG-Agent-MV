import crypto from 'node:crypto';
import path from 'node:path';

import type { BrowserWindow, Dialog, IpcMain, Shell } from 'electron';

import type {
  AndroidKeystoreCreateRequest,
  AndroidToolchainInstallRequest,
  GameReleaseCredentialKind,
  GameBuildRequest,
  GameManifestSigningSaveRequest,
  GameReleasePublishRequest,
  GameReleaseSaveRequest,
  GameReleaseProjectSettings,
} from '../../../contract/game-release.ts';
import type { GameReleaseCredentialStore, GameReleaseCredentialValue } from './game-release-credential-store.ts';

const CHANNELS = [
  'gameRelease:status',
  'gameRelease:save',
  'gameRelease:testUpdateIndex',
  'gameBuild:getSettings',
  'gameBuild:listAndroidIconCandidates',
  'gameBuild:saveSettings',
  'gameBuild:preflight',
  'gameBuild:build',
  'gameBuild:cancel',
  'gameBuild:listEncryptionKeys',
  'gameBuild:generateEncryptionKey',
  'gameBuild:importEncryptionKey',
  'gameBuild:publish',
  'gameBuild:getAndroidToolchain',
  'gameBuild:installAndroidToolchain',
  'gameBuild:getCredentialStatus',
  'gameBuild:forgetCredential',
  'gameBuild:createManifestSigningIdentity',
  'gameBuild:createAndroidKeystore',
  'gameBuild:selectOutputDirectory',
  'gameBuild:reveal',
] as const;

interface GameReleaseModule {
  readGameReleaseStatus(workflowRoot: string, project: string): unknown;
  saveGameReleaseConfig(workflowRoot: string, project: string, request: GameReleaseSaveRequest): unknown;
  testGameReleaseUpdateIndex(value: unknown): Promise<unknown>;
}

interface GameBuildModule {
  readGameBuildSettings(project: string): unknown;
  listAndroidIconCandidates(project: string): string[];
  saveGameBuildSettings(project: string, value: unknown): unknown;
  preflightGameBuild(workflowRoot: string, project: string, input: { presetId: string; releaseConfig?: unknown }): unknown;
  buildGame(workflowRoot: string, project: string, request: GameBuildRequest): Promise<unknown>;
  startGameBuildWorker(
    workflowRoot: string,
    project: string,
    request: GameBuildRequest,
    onProgress: (event: unknown) => void,
  ): { result: Promise<unknown>; cancel: () => void };
}

const activeBuilds = new Map<string, { senderId: number; cancel: () => void }>();

interface GameEncryptionModule {
  listGameEncryptionKeys(project: string): unknown;
  generateGameEncryptionKey(project: string, id: string): unknown;
  importGameEncryptionKey(project: string, id: string, encodedKey: string): unknown;
}

interface GamePublicationModule {
  publishGameRelease(project: string, request: GameReleasePublishRequest): Promise<unknown>;
}

interface GameManifestSigningModule {
  createGameManifestSigningIdentity(credentialId: string): {
    credentialId: string;
    algorithm: 'ECDSA-P256-SHA256';
    keyId: string;
    publicKey: string;
    privateKey: string;
  };
}

interface GameAndroidToolchainModule {
  inspectAndroidToolchain(workflowRoot: string, configuredRoot?: string): unknown;
  installAndroidToolchain(workflowRoot: string, request: AndroidToolchainInstallRequest): Promise<unknown>;
  createAndroidReleaseKeystore(
    workflowRoot: string,
    configuredRoot: string | undefined,
    project: string,
    destination: string,
    request: AndroidKeystoreCreateRequest,
  ): unknown;
}

export function registerGameReleaseIpcHandlers(
  ipcMain: IpcMain,
  dialog: Dialog,
  shell: Shell,
  dependencies: {
    workflowRoot: string;
    resolveProject: (value?: string) => string;
    release: GameReleaseModule;
    build: GameBuildModule;
    encryption: GameEncryptionModule;
    publication: GamePublicationModule;
    manifestSigning: GameManifestSigningModule;
    androidToolchain: GameAndroidToolchainModule;
    credentials: GameReleaseCredentialStore;
    serialize: (value: unknown) => unknown;
    parentWindow: (sender: Electron.WebContents) => BrowserWindow | undefined;
  },
): void {
  cleanupGameReleaseIpcHandlers(ipcMain);
  ipcMain.handle('gameRelease:status', (_event, project?: string) => dependencies.serialize(
    dependencies.release.readGameReleaseStatus(dependencies.workflowRoot, dependencies.resolveProject(project)),
  ));
  ipcMain.handle('gameRelease:save', (_event, request: GameReleaseSaveRequest, project?: string) => dependencies.serialize(
    dependencies.release.saveGameReleaseConfig(
      dependencies.workflowRoot,
      dependencies.resolveProject(project),
      dependencies.serialize(request) as GameReleaseSaveRequest,
    ),
  ));
  ipcMain.handle('gameRelease:testUpdateIndex', async (_event, value: unknown, project?: string) => {
    dependencies.resolveProject(project);
    return dependencies.serialize(await dependencies.release.testGameReleaseUpdateIndex(dependencies.serialize(value)));
  });
  ipcMain.handle('gameBuild:getSettings', (_event, project?: string) => dependencies.serialize(
    dependencies.build.readGameBuildSettings(dependencies.resolveProject(project)),
  ));
  ipcMain.handle('gameBuild:listAndroidIconCandidates', (_event, project?: string) => dependencies.serialize(
    dependencies.build.listAndroidIconCandidates(dependencies.resolveProject(project)),
  ));
  ipcMain.handle('gameBuild:saveSettings', (_event, value: GameReleaseProjectSettings, project?: string) => dependencies.serialize(
    dependencies.build.saveGameBuildSettings(
      dependencies.resolveProject(project),
      dependencies.serialize(value),
    ),
  ));
  ipcMain.handle('gameBuild:preflight', (_event, input: { presetId: string; releaseConfig?: unknown }, project?: string) => dependencies.serialize(
    dependencies.build.preflightGameBuild(
      dependencies.workflowRoot,
      dependencies.resolveProject(project),
      dependencies.serialize(input) as { presetId: string; releaseConfig?: unknown },
    ),
  ));
  ipcMain.handle('gameBuild:build', async (event, request: GameBuildRequest, project?: string) => {
    const resolvedProject = dependencies.resolveProject(project);
    const plain = dependencies.serialize(request) as GameBuildRequest;
    plain.operationId ||= crypto.randomUUID();
    if (activeBuilds.has(plain.operationId)) throw new Error('A packaging operation with this id is already running.');
    if ([...activeBuilds.values()].some((active) => active.senderId === event.sender.id)) {
      throw new Error('This window already has a packaging operation in progress.');
    }
    const settings = dependencies.build.readGameBuildSettings(resolvedProject) as GameReleaseProjectSettings;
    const preset = settings.presets.find((candidate) => candidate.id === plain.presetId);
    if (!preset) throw new Error('The selected packaging preset no longer exists.');
    resolveSigningCredential(dependencies.credentials, preset, plain);
    const handle = dependencies.build.startGameBuildWorker(
      dependencies.workflowRoot,
      resolvedProject,
      plain,
      (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('gameBuild:progress', dependencies.serialize(progress));
      },
    );
    activeBuilds.set(plain.operationId, { senderId: event.sender.id, cancel: handle.cancel });
    const cancelOnDestroyed = () => handle.cancel();
    event.sender.once('destroyed', cancelOnDestroyed);
    try {
      return dependencies.serialize(await handle.result);
    } finally {
      event.sender.removeListener('destroyed', cancelOnDestroyed);
      activeBuilds.delete(plain.operationId);
    }
  });
  ipcMain.handle('gameBuild:cancel', (event, operationId: string) => {
    const id = String(operationId || '');
    const active = activeBuilds.get(id);
    if (!active || active.senderId !== event.sender.id) return { canceled: false };
    active.cancel();
    return { canceled: true };
  });
  ipcMain.handle('gameBuild:listEncryptionKeys', (_event, project?: string) => dependencies.serialize(
    dependencies.encryption.listGameEncryptionKeys(dependencies.resolveProject(project)),
  ));
  ipcMain.handle('gameBuild:generateEncryptionKey', (_event, id: string, project?: string) => dependencies.serialize(
    dependencies.encryption.generateGameEncryptionKey(dependencies.resolveProject(project), String(id || '')),
  ));
  ipcMain.handle('gameBuild:importEncryptionKey', (_event, id: string, encodedKey: string, project?: string) => dependencies.serialize(
    dependencies.encryption.importGameEncryptionKey(
      dependencies.resolveProject(project),
      String(id || ''),
      String(encodedKey || ''),
    ),
  ));
  ipcMain.handle('gameBuild:publish', async (_event, request: GameReleasePublishRequest, project?: string) => {
    const resolvedProject = dependencies.resolveProject(project);
    const plain = dependencies.serialize(request) as GameReleasePublishRequest;
    resolveUploadCredential(dependencies.credentials, plain);
    resolveManifestSigningCredential(
      dependencies.credentials,
      dependencies.build.readGameBuildSettings(resolvedProject) as GameReleaseProjectSettings,
      plain,
    );
    return dependencies.serialize(await dependencies.publication.publishGameRelease(
      resolvedProject,
      plain,
    ));
  });
  ipcMain.handle('gameBuild:getAndroidToolchain', (_event, project?: string) => {
    const resolvedProject = dependencies.resolveProject(project);
    const settings = dependencies.build.readGameBuildSettings(resolvedProject) as GameReleaseProjectSettings;
    return dependencies.serialize(
      dependencies.androidToolchain.inspectAndroidToolchain(
        dependencies.workflowRoot,
        settings.androidToolchainRoot,
      ),
    );
  });
  ipcMain.handle('gameBuild:installAndroidToolchain', async (_event, request: AndroidToolchainInstallRequest) => dependencies.serialize(
    await dependencies.androidToolchain.installAndroidToolchain(
      dependencies.workflowRoot,
      dependencies.serialize(request) as AndroidToolchainInstallRequest,
    ),
  ));
  ipcMain.handle('gameBuild:getCredentialStatus', (_event, kind?: GameReleaseCredentialKind, credentialId?: string) => (
    dependencies.credentials.status(kind, credentialId)
  ));
  ipcMain.handle('gameBuild:forgetCredential', (_event, kind: GameReleaseCredentialKind, credentialId: string) => ({
    removed: dependencies.credentials.forget(kind, String(credentialId || '')),
  }));
  ipcMain.handle('gameBuild:createManifestSigningIdentity', (_event, request: GameManifestSigningSaveRequest, project?: string) => {
    const resolvedProject = dependencies.resolveProject(project);
    const plain = dependencies.serialize(request) as GameManifestSigningSaveRequest;
    if (!plain?.releaseConfig || !plain?.settings) throw new Error('Release configuration and packaging settings are required.');
    const previousRelease = dependencies.release.readGameReleaseStatus(dependencies.workflowRoot, resolvedProject) as {
      config: GameManifestSigningSaveRequest['releaseConfig'];
      sourceHash: string | null;
    };
    const previousSettings = dependencies.build.readGameBuildSettings(resolvedProject) as GameReleaseProjectSettings;
    const previousCredentialId = previousSettings.manifestSigningCredentialId;
    const credentialId = `manifest-signing-${crypto.randomUUID()}`;
    const identity = dependencies.manifestSigning.createGameManifestSigningIdentity(credentialId);
    const nextReleaseConfig = dependencies.serialize(plain.releaseConfig) as GameManifestSigningSaveRequest['releaseConfig'];
    nextReleaseConfig.update.manifestSignature = {
      enabled: true,
      algorithm: identity.algorithm,
      keyId: identity.keyId,
      publicKey: identity.publicKey,
    };
    const nextSettings = dependencies.serialize(plain.settings) as GameReleaseProjectSettings;
    nextSettings.manifestSigningCredentialId = credentialId;
    let savedRelease: unknown;
    let releaseWritten = false;
    let settingsWritten = false;
    try {
      savedRelease = dependencies.release.saveGameReleaseConfig(dependencies.workflowRoot, resolvedProject, {
        config: nextReleaseConfig,
        expectedSourceHash: plain.releaseExpectedSourceHash,
        installRuntimePlugins: true,
      });
      releaseWritten = true;
      const savedSettings = dependencies.build.saveGameBuildSettings(resolvedProject, nextSettings) as GameReleaseProjectSettings;
      settingsWritten = true;
      dependencies.credentials.save('manifest-signing', credentialId, { privateKey: identity.privateKey });
      if (previousCredentialId && previousCredentialId !== credentialId) {
        dependencies.credentials.forget('manifest-signing', previousCredentialId);
      }
      return dependencies.serialize({
        identity: {
          credentialId: identity.credentialId,
          algorithm: identity.algorithm,
          keyId: identity.keyId,
          publicKey: identity.publicKey,
        },
        release: savedRelease,
        settings: savedSettings,
      });
    } catch (error) {
      dependencies.credentials.forget('manifest-signing', credentialId);
      const rollbackFailures: string[] = [];
      if (settingsWritten) {
        try {
          dependencies.build.saveGameBuildSettings(resolvedProject, previousSettings);
        } catch (rollbackError) {
          rollbackFailures.push(`packaging settings: ${errorMessage(rollbackError)}`);
        }
      }
      if (releaseWritten) {
        try {
          const current = dependencies.release.readGameReleaseStatus(dependencies.workflowRoot, resolvedProject) as { sourceHash: string | null };
          dependencies.release.saveGameReleaseConfig(dependencies.workflowRoot, resolvedProject, {
            config: previousRelease.config,
            expectedSourceHash: current.sourceHash,
            installRuntimePlugins: true,
          });
        } catch (rollbackError) {
          rollbackFailures.push(`release configuration: ${errorMessage(rollbackError)}`);
        }
      }
      const rollbackDetail = rollbackFailures.length ? ` Rollback failed for ${rollbackFailures.join('; ')}.` : '';
      throw new Error(`Could not save the manifest signing identity.${rollbackDetail}`, { cause: error });
    }
  });
  ipcMain.handle('gameBuild:createAndroidKeystore', async (event, request: AndroidKeystoreCreateRequest, project?: string) => {
    const resolvedProject = dependencies.resolveProject(project);
    const settings = dependencies.build.readGameBuildSettings(resolvedProject) as GameReleaseProjectSettings;
    const safeName = String(request?.commonName || 'game').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'game';
    const options: Electron.SaveDialogOptions = {
      title: 'Create Android release signing file',
      defaultPath: path.join(path.dirname(resolvedProject), `${safeName}-release.jks`),
      filters: [{ name: 'Java key store', extensions: ['jks', 'keystore'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const parent = dependencies.parentWindow(event.sender);
    const selected = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return null;
    return dependencies.serialize(dependencies.androidToolchain.createAndroidReleaseKeystore(
      dependencies.workflowRoot,
      settings.androidToolchainRoot,
      resolvedProject,
      selected.filePath,
      dependencies.serialize(request) as AndroidKeystoreCreateRequest,
    ));
  });
  ipcMain.handle('gameBuild:selectOutputDirectory', async (event, initialPath?: string) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select game build output folder',
      defaultPath: typeof initialPath === 'string' && initialPath.trim() ? initialPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    };
    const parent = dependencies.parentWindow(event.sender);
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('gameBuild:reveal', async (_event, target: string) => {
    const selected = String(target || '').trim();
    if (!selected) throw new Error('A build output path is required.');
    shell.showItemInFolder(selected);
    return { ok: true };
  });
}

function resolveSigningCredential(
  store: GameReleaseCredentialStore,
  preset: GameReleaseProjectSettings['presets'][number],
  request: GameBuildRequest,
): void {
  const android = preset.android;
  if (!android || android.signing !== 'release') return;
  const credentialId = android.signingCredentialId;
  if (!credentialId) throw new Error('The Android release signing credential reference is missing from this preset.');
  const provided = request.signingCredential;
  const hasStorePassword = Boolean(provided?.storePassword);
  const hasKeyPassword = Boolean(provided?.keyPassword);
  if (hasStorePassword !== hasKeyPassword) {
    throw new Error('Enter both the Android keystore password and key password, or leave both empty to use a remembered credential.');
  }
  if (hasStorePassword && hasKeyPassword) {
    if (request.rememberSigningCredential) {
      store.save('android-signing', credentialId, {
        storePassword: provided!.storePassword!,
        keyPassword: provided!.keyPassword!,
      });
    }
    return;
  }
  const remembered = store.read('android-signing', credentialId);
  if (remembered) {
    request.signingCredential = {
      storePassword: remembered.storePassword,
      keyPassword: remembered.keyPassword,
    };
    return;
  }
  if (request.rememberSigningCredential) {
    throw new Error('Enter both Android signing passwords before choosing to remember them.');
  }
}

function resolveUploadCredential(store: GameReleaseCredentialStore, request: GameReleasePublishRequest): void {
  const upload = request.upload;
  if (!upload?.enabled || upload.authorization === 'none') return;
  const credentialId = upload.credentialId;
  if (!credentialId) throw new Error('The authenticated upload credential reference is missing from this preset.');
  const provided = request.uploadCredential;
  const normalized = normalizeUploadCredential(upload.authorization, provided);
  if (normalized) {
    if (request.rememberUploadCredential) store.save('upload', credentialId, normalized);
    return;
  }
  const remembered = store.read('upload', credentialId);
  if (remembered) {
    request.uploadCredential = {
      ...(remembered.username ? { username: remembered.username } : {}),
      ...(remembered.password !== undefined ? { password: remembered.password } : {}),
      ...(remembered.token ? { token: remembered.token } : {}),
    };
    return;
  }
  if (request.rememberUploadCredential) {
    throw new Error('Enter the upload credential before choosing to remember it.');
  }
}

function resolveManifestSigningCredential(
  store: GameReleaseCredentialStore,
  settings: GameReleaseProjectSettings,
  request: GameReleasePublishRequest,
): void {
  delete request.manifestSigningCredential;
  const credentialId = settings.manifestSigningCredentialId;
  if (!credentialId) return;
  const remembered = store.read('manifest-signing', credentialId);
  if (remembered?.privateKey) request.manifestSigningCredential = { privateKey: remembered.privateKey };
}

function normalizeUploadCredential(
  authorization: 'basic' | 'bearer',
  value: GameReleasePublishRequest['uploadCredential'],
): GameReleaseCredentialValue | null {
  if (authorization === 'basic') {
    const username = value?.username || '';
    const hasPassword = value?.password !== undefined && value.password !== '';
    if (!username && !hasPassword) return null;
    if (!username || !hasPassword) throw new Error('Enter both the upload username and password.');
    return { username, password: value!.password! };
  }
  if (!value?.token) return null;
  return { token: value.token };
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function cleanupGameReleaseIpcHandlers(ipcMain: IpcMain): void {
  for (const active of activeBuilds.values()) active.cancel();
  activeBuilds.clear();
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
}
