import type { BrowserWindow, Dialog, IpcMain } from 'electron';
import { shell } from 'electron';
import { normalizeProductLanguage, type ProductLanguage } from '../../../contract/i18n.ts';
import type {
  ProjectGitCommitRequest,
  ProjectGitDiffRequest,
  ProjectGitFileResult,
  ProjectGitPathRequest,
  ProjectGitProjectRequest,
  ProjectGitRemoteRequest,
  ProjectGitResolveRequest,
  ProjectGitSyncRequest,
} from '../../../contract/project-git.ts';

type DialogLike = Pick<Dialog, 'showSaveDialog'>;

interface ProjectGitModule {
  getProjectGitStatus(projectPath: string): Promise<unknown>;
  enableProjectGit(projectPath: string): Promise<unknown>;
  commitProjectGit(projectPath: string, message?: string): Promise<unknown>;
  listProjectGitLog(projectPath: string, limit?: number): Promise<unknown>;
  discardProjectGitChange(projectPath: string, relativePath: string): Promise<unknown>;
  setProjectGitRemote(projectPath: string, url: string): Promise<unknown>;
  pushProjectGit(projectPath: string, token?: string): Promise<unknown>;
  pullProjectGit(projectPath: string, token?: string): Promise<unknown>;
  listProjectGitConflicts(projectPath: string): Promise<unknown>;
  resolveProjectGitConflict(projectPath: string, relativePath: string, choice: 'local' | 'remote'): Promise<unknown>;
  abortProjectGitMerge(projectPath: string): Promise<unknown>;
  getProjectGitFileDiff(projectPath: string, relativePath: string): Promise<unknown>;
}

interface ProjectBackupModule {
  backupProject(projectRoot: string, outputPath: string): Promise<unknown>;
  defaultProjectBackupName(): string;
}

interface GitInstallerModule {
  downloadGitInstaller(): Promise<{ path: string; name: string }>;
}

interface ProjectGitIpcDependencies {
  resolveProject(project?: string): string;
  dialogParent?(sender: unknown): BrowserWindow | undefined;
  git: ProjectGitModule;
  backup: ProjectBackupModule;
  installer: GitInstallerModule;
  productLanguage?(): ProductLanguage | string | null | undefined;
  withProductLanguage?<T>(language: ProductLanguage, fn: () => T): T;
}

function success<T>(value: T, message: string, outputPath?: string): ProjectGitFileResult<T> {
  return { status: 'success', message, value, ...(outputPath ? { path: outputPath } : {}) };
}

function failure<T>(error: unknown): ProjectGitFileResult<T> {
  return { status: 'error', message: error instanceof Error ? error.message : String(error) };
}

function resolveProject(dependencies: ProjectGitIpcDependencies, request: ProjectGitProjectRequest | undefined): string {
  if (typeof request?.project !== 'string' || !request.project.trim()) {
    throw new Error('Select an RPG Maker project before using version management.');
  }
  return dependencies.resolveProject(request.project);
}

export function registerProjectGitIpcHandlers(
  ipcMain: Pick<IpcMain, 'handle'>,
  dialog: DialogLike,
  dependencies: ProjectGitIpcDependencies,
): void {
  const handle = (channel: string, listener: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (...args) => {
      if (!dependencies.withProductLanguage) return listener(...args);
      return dependencies.withProductLanguage(
        normalizeProductLanguage(dependencies.productLanguage?.()),
        () => listener(...args),
      );
    });
  };

  handle('projectGit:status', async (_event, request: ProjectGitProjectRequest = {}) => {
    try {
      return success(await dependencies.git.getProjectGitStatus(resolveProject(dependencies, request)), 'Ready.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:enable', async (_event, request: ProjectGitProjectRequest = {}) => {
    try {
      return success(await dependencies.git.enableProjectGit(resolveProject(dependencies, request)), 'Version management enabled.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:commit', async (_event, request: ProjectGitCommitRequest = {}) => {
    try {
      return success(await dependencies.git.commitProjectGit(resolveProject(dependencies, request), request.message), 'Committed.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:log', async (_event, request: ProjectGitProjectRequest = {}) => {
    try {
      return success(await dependencies.git.listProjectGitLog(resolveProject(dependencies, request)), 'Ready.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:discard', async (_event, request: ProjectGitPathRequest = {}) => {
    try {
      await dependencies.git.discardProjectGitChange(resolveProject(dependencies, request), String(request.path || ''));
      return success(null, 'Change discarded.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:setRemote', async (_event, request: ProjectGitRemoteRequest = {}) => {
    try {
      return success(await dependencies.git.setProjectGitRemote(resolveProject(dependencies, request), String(request.url || '')), 'Remote updated.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:push', async (_event, request: ProjectGitSyncRequest = {}) => {
    try {
      return success(await dependencies.git.pushProjectGit(resolveProject(dependencies, request), request.token), 'Pushed.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:pull', async (_event, request: ProjectGitSyncRequest = {}) => {
    try {
      return success(await dependencies.git.pullProjectGit(resolveProject(dependencies, request), request.token), 'Pulled.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:conflicts', async (_event, request: ProjectGitProjectRequest = {}) => {
    try {
      return success(await dependencies.git.listProjectGitConflicts(resolveProject(dependencies, request)), 'Ready.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:resolve', async (_event, request: ProjectGitResolveRequest = {}) => {
    try {
      return success(
        await dependencies.git.resolveProjectGitConflict(
          resolveProject(dependencies, request),
          String(request.path || ''),
          request.choice === 'remote' ? 'remote' : 'local',
        ),
        'Conflict resolved.',
      );
    } catch (error) { return failure(error); }
  });

  handle('projectGit:abortMerge', async (_event, request: ProjectGitProjectRequest = {}) => {
    try {
      await dependencies.git.abortProjectGitMerge(resolveProject(dependencies, request));
      return success(null, 'Merge aborted.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:diff', async (_event, request: ProjectGitDiffRequest = {}) => {
    try {
      return success(
        await dependencies.git.getProjectGitFileDiff(resolveProject(dependencies, request), String(request.path || '')),
        'Ready.',
      );
    } catch (error) { return failure(error); }
  });

  handle('projectGit:downloadGit', async () => {
    try {
      const installer = await dependencies.installer.downloadGitInstaller();
      const openError = await shell.openPath(installer.path);
      if (openError) throw new Error(openError);
      return success({ path: installer.path, name: installer.name }, 'Git installer downloaded.');
    } catch (error) { return failure(error); }
  });

  handle('projectGit:backup', async (event, request: ProjectGitProjectRequest = {}) => {
    try {
      const project = resolveProject(dependencies, request);
      const parent = dependencies.dialogParent?.(event.sender);
      const options: Electron.SaveDialogOptions = {
        title: 'Back Up Project',
        defaultPath: dependencies.backup.defaultProjectBackupName(),
        filters: [{ name: 'Compressed TAR archive', extensions: ['gz'] }],
      };
      const selected = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      if (selected.canceled || !selected.filePath) return { status: 'idle', message: 'Canceled.' };
      return success(
        await dependencies.backup.backupProject(project, selected.filePath),
        'Project backup created.',
        selected.filePath,
      );
    } catch (error) { return failure(error); }
  });
}

export function cleanupProjectGitIpcHandlers(ipcMain: Pick<IpcMain, 'removeHandler'>): void {
  for (const channel of [
    'projectGit:status',
    'projectGit:enable',
    'projectGit:commit',
    'projectGit:log',
    'projectGit:discard',
    'projectGit:setRemote',
    'projectGit:push',
    'projectGit:pull',
    'projectGit:conflicts',
    'projectGit:resolve',
    'projectGit:abortMerge',
    'projectGit:diff',
    'projectGit:downloadGit',
    'projectGit:backup',
  ]) ipcMain.removeHandler(channel);
}
