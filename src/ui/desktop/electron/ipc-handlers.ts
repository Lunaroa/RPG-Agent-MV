import { BrowserWindow, dialog, ipcMain, net, protocol, screen, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { cleanupMapIpcHandlers, registerMapIpcHandlers } from './map-ipc-bindings.js';
import {
  cleanupInteractivePlaytestIpcHandlers,
  registerInteractivePlaytestIpcHandlers,
} from './interactive-playtest-ipc-bindings.js';
import { electronText, stagingCloseButtons } from './electronLocalization.js';
import { toIpcPayload } from './ipc-serialize.js';
import { cleanupSessionIpcHandlers, registerSessionIpcHandlers } from './session-ipc-bindings.js';
import {
  DEFAULT_AGENT_EXECUTION_ENGINE,
  type InteractivePlaytestResult,
  type InteractivePlaytestRun,
  type WorkspaceSettings,
  type WorkspaceWindowState,
} from '../../../contract/types.ts';
import { normalizeProductLanguage, type ProductLanguage } from '../../../contract/i18n.ts';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  isLikelyMaximizedWindowBounds,
  isValidWindowBounds,
  mergeWorkspaceSettings,
  normalizeWorkspaceSettings,
} from '../src/utils/workspaceSettings.ts';

export interface AppRoots {
  installRoot: string;
  userDataRoot: string;
  layoutMigrated?: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let llm: any;
let ConsoleSettingsDao: any;
let StagingManifestDao: any;
let MapSelectionDao: any;
let scanProject: any;
let resolveDataDir: any;
let applyPatchToProject: any;
let readJson: any;
let writeJson: any;
let writeMapJson: any;
let exists: any;
let desktop: any;
let agentSessionRuntime: any;
let interactivePlaytestService: any;
let assetProtocolRegistered = false;
let backendCoreUrl: URL | null = null;
let backendWithProductLanguage: (<T>(language: ProductLanguage, fn: () => T) => T) | null = null;

export function getWorkspaceSettings(): WorkspaceSettings {
  if (!ConsoleSettingsDao) return normalizeWorkspaceSettings({});
  return normalizeWorkspaceSettings(ConsoleSettingsDao.get('workspace') || {});
}

export function patchWorkspaceSettings(patch: WorkspaceSettings): WorkspaceSettings {
  const merged = mergeWorkspaceSettings(getWorkspaceSettings(), patch);
  ConsoleSettingsDao.set('workspace', merged);
  return merged;
}

export function currentProductLanguage(): ProductLanguage {
  const raw = ConsoleSettingsDao?.get('ui') as { language?: unknown } | undefined;
  return normalizeProductLanguage(raw?.language);
}

function withBackendProductLanguage<T>(language: ProductLanguage, fn: () => T): T {
  if (!backendWithProductLanguage) {
    throw new Error('Backend product language context is not initialized');
  }
  return backendWithProductLanguage(language, fn);
}

function normalizeAgentExecutionSettings(raw: Record<string, unknown>): Record<string, unknown> {
  const bindings = (raw.bindings || {}) as Record<string, { providerId?: string; modelId?: string } | undefined>;
  const binding = bindings[DEFAULT_AGENT_EXECUTION_ENGINE];
  return {
    ...raw,
    engine: DEFAULT_AGENT_EXECUTION_ENGINE,
    bindings: binding?.providerId && binding?.modelId
      ? { [DEFAULT_AGENT_EXECUTION_ENGINE]: binding }
      : {},
  };
}

export function saveWorkspaceWindowState(win: BrowserWindow): void {
  if (!ConsoleSettingsDao || win.isDestroyed()) return;
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  patchWorkspaceSettings({
    window: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
      firstRunDone: true,
    },
  });
}

function hasProjectStaging(status: unknown): boolean {
  if (!status || typeof status !== 'object') return false;
  const value = status as { staged?: unknown; files?: unknown; maps?: unknown };
  return Boolean(value.staged)
    || (Array.isArray(value.files) && value.files.length > 0)
    || (Array.isArray(value.maps) && value.maps.length > 0);
}

function stagingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stagingOperationIds(status: unknown): string[] {
  if (!status || typeof status !== 'object') return [];
  const operations = (status as { operations?: unknown }).operations;
  if (!Array.isArray(operations)) return [];
  return operations.flatMap((operation) => (
    operation
      && typeof operation === 'object'
      && typeof (operation as { operationId?: unknown }).operationId === 'string'
      ? [(operation as { operationId: string }).operationId]
      : []
  ));
}

export async function confirmProjectStagingBeforeClose(workflowRoot: string, win: BrowserWindow): Promise<boolean> {
  if (!desktop || win.isDestroyed()) return true;
  const lastProjectPath = String(getWorkspaceSettings().lastProjectPath || '').trim();
  if (!lastProjectPath) return true;

  let projectPath = '';
  let stagingStatus: unknown;
  try {
    projectPath = desktop.project.resolveProjectPath(workflowRoot, lastProjectPath);
    stagingStatus = desktop.staging.getProjectStagingStatus(workflowRoot, projectPath);
  } catch (error) {
    const language = currentProductLanguage();
    await dialog.showMessageBox(win, {
      type: 'error',
      title: electronText(language, 'staging.checkFailed'),
      message: electronText(language, 'staging.checkFailed'),
      detail: stagingErrorMessage(error),
    });
    return false;
  }

  if (!hasProjectStaging(stagingStatus)) return true;

  const language = currentProductLanguage();
  const operationIds = stagingOperationIds(stagingStatus);
  const operationDetail = operationIds.length
    ? `\n\n${electronText(language, 'staging.agentOperations', { operations: operationIds.join('\n') })}`
    : '';
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: electronText(language, 'staging.savePrompt'),
    message: electronText(language, 'staging.savePrompt'),
    buttons: stagingCloseButtons(language),
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    detail: `${electronText(language, 'staging.closeDetail')}${operationDetail}`,
  });

  if (result.response === 2) return false;

  try {
    if (result.response === 0) {
      await desktop.staging.applyProjectStaging(workflowRoot, projectPath, {
        expectedOperationIds: operationIds,
        validate: () => desktop.projectManagement.preflightProjectManagedStagingApply(workflowRoot, projectPath),
      });
    } else if (result.response === 1) {
      desktop.staging.discardProjectStaging(workflowRoot, projectPath);
    }
  } catch (error) {
    const failureKey = result.response === 0 ? 'staging.saveFailed' : 'staging.discardFailed';
    await dialog.showMessageBox(win, {
      type: 'error',
      title: electronText(currentProductLanguage(), failureKey),
      message: electronText(currentProductLanguage(), failureKey),
      detail: stagingErrorMessage(error),
    });
    return false;
  }

  return true;
}

function providerSummaryForIpc(provider: Record<string, unknown>): Record<string, unknown> {
  const id = typeof provider.id === 'string' ? provider.id : '';
  const label = typeof provider.label === 'string' ? provider.label.trim() : '';
  const displayName = typeof provider.displayName === 'string' ? provider.displayName.trim() : '';
  return {
    ...provider,
    displayName: displayName || label || id,
  };
}

function getWorkAreaForWindowState(windowState: WorkspaceWindowState) {
  if (isValidWindowBounds(windowState)) {
    return screen.getDisplayMatching({
      x: windowState.x!,
      y: windowState.y!,
      width: windowState.width!,
      height: windowState.height!,
    }).workArea;
  }
  return screen.getPrimaryDisplay().workArea;
}

export function readWorkspaceWindowOptions(): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  shouldMaximize: boolean;
} {
  const windowState = getWorkspaceSettings().window || {};
  const workArea = getWorkAreaForWindowState(windowState);
  const shouldUseStoredBounds = isValidWindowBounds(windowState)
    && !isLikelyMaximizedWindowBounds(windowState, workArea);
  const width = shouldUseStoredBounds ? windowState.width! : DEFAULT_WINDOW_WIDTH;
  const height = shouldUseStoredBounds ? windowState.height! : DEFAULT_WINDOW_HEIGHT;
  const options: {
    width: number;
    height: number;
    x?: number;
    y?: number;
    shouldMaximize: boolean;
  } = { width, height, shouldMaximize: true };
  if (shouldUseStoredBounds) {
    options.x = windowState.x;
    options.y = windowState.y;
  }
  return options;
}

// 动态加载后端模块
async function loadBackendModules(roots: AppRoots) {
  const corePath = path.resolve(roots.installRoot, 'src/backend/src/core');
  
  console.log('[ipc] Loading backend modules from:', corePath);
  
  // 将路径转换为 file:// URL（Windows 需要，确保以 / 结尾）
  const coreUrl = new URL(`file:///${corePath.replace(/\\/g, '/')}/`);
  backendCoreUrl = coreUrl;
  
  console.log('[ipc] Core URL:', coreUrl.href);

  const requestLanguageModule = await import(new URL('i18n/request-language.ts', coreUrl).href);
  backendWithProductLanguage = requestLanguageModule.withProductLanguage;
  
  // 使用 dynamic import 加载模块
  const llmUrl = new URL('llm/index.ts', coreUrl).href;
  console.log('[ipc] Loading llm from:', llmUrl);
  const llmModule = await import(llmUrl);
  // llm/index.ts 导出的是命名导出，不是默认导出
  llm = llmModule;
  
  const consoleSettingsDaoModule = await import(new URL('db/dao/console-settings-dao.ts', coreUrl).href);
  ConsoleSettingsDao = consoleSettingsDaoModule.ConsoleSettingsDao;
  
  const stagingManifestDaoModule = await import(new URL('db/dao/staging-manifest-dao.ts', coreUrl).href);
  StagingManifestDao = stagingManifestDaoModule.StagingManifestDao;
  
  const mapSelectionDaoModule = await import(new URL('db/dao/map-selection-dao.ts', coreUrl).href);
  MapSelectionDao = mapSelectionDaoModule.MapSelectionDao;
  
  const projectScannerModule = await import(new URL('rmmv/project-scanner.ts', coreUrl).href);
  scanProject = projectScannerModule.scanProject;
  resolveDataDir = projectScannerModule.resolveDataDir;
  
  const patcherModule = await import(new URL('rmmv/patcher.ts', coreUrl).href);
  applyPatchToProject = patcherModule.applyPatchToProject;

  const jsonModule = await import(new URL('rmmv/json.ts', coreUrl).href);
  readJson = jsonModule.readJson;
  writeJson = jsonModule.writeJson;
  writeMapJson = jsonModule.writeMapJson;
  exists = jsonModule.exists;

  const bootstrapModule = await import(new URL('db/bootstrap.ts', coreUrl).href);
  await bootstrapModule.bootstrapDatabase(roots.userDataRoot);
  await llm.ensureProviderSeedsInitialized(roots.userDataRoot);
  await llm.refreshProviderSeedCatalogFields(roots.userDataRoot);

  if (roots.layoutMigrated && roots.layoutMigrated.length > 0) {
    const layoutModule = await import(new URL('desktop/user-data-layout.ts', coreUrl).href);
    layoutModule.recordUserDataLayoutMetadata(
      roots.userDataRoot,
      roots.installRoot,
      roots.layoutMigrated,
    );
  }

  desktop = {
    project: await import(new URL('desktop/project-service.ts', coreUrl).href),
    maps: await import(new URL('desktop/map-service.ts', coreUrl).href),
    events: await import(new URL('desktop/event-service.ts', coreUrl).href),
    eventRegistry: await import(new URL('workflow/event/event-registry.ts', coreUrl).href),
    eventScript: await import(new URL('desktop/event-script-service.ts', coreUrl).href),
    staging: await import(new URL('desktop/staging-service.ts', coreUrl).href),
    library: await import(new URL('desktop/library-service.ts', coreUrl).href),
    assets: await import(new URL('desktop/asset-service.ts', coreUrl).href),
    catalog: await import(new URL('desktop/editor-catalog-service.ts', coreUrl).href),
    scanner: {
      scanProject: (await import(new URL('rmmv/project-scanner.ts', coreUrl).href)).scanProject,
      buildAssetInventory: (await import(new URL('rmmv/asset-inventory.ts', coreUrl).href)).buildAssetInventory,
    },
    assetLibrary: await import(new URL('desktop/asset-library-service.ts', coreUrl).href),
    assetManagement: await import(new URL('desktop/asset-management-service.ts', coreUrl).href),
    projectManagement: await import(new URL('desktop/project-management-service.ts', coreUrl).href),
    commonEvents: await import(new URL('desktop/common-event-service.ts', coreUrl).href),
    pluginManagement: await import(new URL('desktop/plugin-management-service.ts', coreUrl).href),
    storyPages: await import(new URL('desktop/story-page-sync-service.ts', coreUrl).href),
    outline: await import(new URL('desktop/outline-service.ts', coreUrl).href),
    placementQueue: await import(new URL('desktop/placement-queue-service.ts', coreUrl).href),
    interactivePlaytest: await import(new URL('desktop/interactive-playtest-service.ts', coreUrl).href),
  };
  const sessionRuntimeModule = await import(new URL('desktop/agent-session-runtime.ts', coreUrl).href);
  agentSessionRuntime = new sessionRuntimeModule.AgentSessionRuntime(roots.userDataRoot);
  await agentSessionRuntime.initialize();
  interactivePlaytestService = new desktop.interactivePlaytest.InteractivePlaytestService(
    roots.userDataRoot,
    { onStatus: publishInteractivePlaytestStatus },
  );
}

function publishInteractivePlaytestStatus(run: InteractivePlaytestRun): void {
  const payload = toIpcPayload(run);
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('playtest:status', payload);
      }
    } catch (error) {
      console.warn(`[playtest] Could not publish run ${run.runId} to a renderer: ${stagingErrorMessage(error)}`);
    }
  }
  if (!run.sessionId || !agentSessionRuntime) return;
  const terminal = ['stopped', 'exited', 'failed', 'stop_failed'].includes(run.status);
  const phase = run.status === 'starting' ? 'start' : terminal ? 'done' : 'update';
  try {
    const pushed = agentSessionRuntime.pushExternalEvent(run.sessionId, {
      type: 'playtest_run',
      phase,
      ...payload,
      at: run.updatedAt,
    });
    if (!pushed?.ok) {
      console.warn(`[playtest] Could not publish run ${run.runId} to session ${run.sessionId}: ${pushed?.reason || 'unknown error'}`);
    }
  } catch (error) {
    console.warn(`[playtest] Could not persist run ${run.runId} in session ${run.sessionId}: ${stagingErrorMessage(error)}`);
  }
}

function resolveInteractivePlaytestSession(project: string, requestedSessionId?: string): string | undefined {
  const summaries = agentSessionRuntime?.list?.() as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(summaries)) return undefined;
  const matchesProject = (session: Record<string, unknown>) => {
    const sessionProject = typeof session.project === 'string' ? session.project.trim() : '';
    if (!sessionProject) return false;
    try {
      return sameResolvedPath(desktop.project.resolveProjectPath(workflowRoot, sessionProject), project);
    } catch {
      return false;
    }
  };
  if (requestedSessionId) {
    const requested = summaries.find((session) => session.id === requestedSessionId);
    if (requested && matchesProject(requested)) return requestedSessionId;
  }
  return summaries
    .filter(matchesProject)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    .map((session) => String(session.id || '').trim())
    .find(Boolean);
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    let resolved = path.resolve(value);
    try {
      resolved = fs.realpathSync.native(resolved);
    } catch {
      // The playtest service performs the authoritative existence check.
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function requireInteractivePlaytestService(): any {
  if (!interactivePlaytestService) throw new Error('Interactive playtest service is not initialized.');
  return interactivePlaytestService;
}

export async function shutdownInteractivePlaytest(): Promise<InteractivePlaytestResult> {
  if (!interactivePlaytestService) return { confirmationRequired: false };
  const result = await interactivePlaytestService.shutdown() as InteractivePlaytestResult;
  if (result.run?.status === 'stop_failed') {
    throw new Error(result.run.error || 'Game.exe process-tree cleanup failed.');
  }
  return result;
}

// 类型定义
interface MapInfo {
  id: number;
  name: string;
  parentId: number;
  order: number;
  fileName: string;
  exists: boolean;
  width: number;
  height: number;
  tilesetId: number;
  eventCount: number;
}

interface MapTree {
  maps: MapInfo[];
  tilesets: { id: number; name: string }[];
}

interface MapPayload {
  mapId: number;
  mapInfo: MapInfo | undefined;
  map: Record<string, unknown> | null;
  tilesets: { id: number; name: string }[];
}

interface StagingStatus {
  hasStaging: boolean;
  maps: { mapId: number; hasChanges: boolean }[];
}

let workflowRoot: string = '';

/**
 * 获取地图树
 */
async function getMapsTree(projectPath: string): Promise<MapTree> {
  const scanResult = scanProject(projectPath);
  const tilesets = (scanResult.database.Tilesets?.named || []) as { id: number; name: string }[];

  return {
    maps: scanResult.maps,
    tilesets
  };
}

/**
 * 获取地图图块集
 */
async function getMapsTilesets(projectPath: string): Promise<{ id: number; name: string }[]> {
  const scanResult = scanProject(projectPath);
  return (scanResult.database.Tilesets?.named || []) as { id: number; name: string }[];
}

/**
 * 构建地图负载
 */
async function buildMapPayload(projectPath: string, mapId: number): Promise<MapPayload> {
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);
  const tilesets = (scanResult.database.Tilesets?.named || []) as { id: number; name: string }[];

  let map: Record<string, unknown> | null = null;
  if (mapInfo && mapInfo.exists) {
    const dataDir = resolveDataDir(projectPath);
    const mapFile = path.join(dataDir, mapInfo.fileName);
    if (exists(mapFile)) {
      map = readJson(mapFile) as Record<string, unknown>;
    }
  }

  return {
    mapId,
    mapInfo,
    map,
    tilesets
  };
}

/**
 * 创建地图
 */
async function createMap(projectPath: string, properties: Record<string, unknown>): Promise<Record<string, unknown>> {
  const spec = {
    engine: 'rpg-maker-mv',
    operations: [{
      op: 'add-map',
      ...properties
    }]
  };

  const report = applyPatchToProject(projectPath, spec as Parameters<typeof applyPatchToProject>[1]);
  return { success: true, report };
}

/**
 * 更新地图属性
 */
async function updateMapProperties(projectPath: string, mapId: number, properties: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);

  if (!mapInfo || !mapInfo.exists) {
    throw new Error(`Map ${mapId} not found`);
  }

  const mapFile = path.join(dataDir, mapInfo.fileName);
  const map = readJson(mapFile) as Record<string, unknown>;

  // 更新属性
  for (const [key, value] of Object.entries(properties)) {
    if (key !== 'data' && key !== 'events') {
      (map as Record<string, unknown>)[key] = value;
    }
  }

  writeMapJson(mapFile, map);
  return { success: true, mapId, properties };
}

/**
 * 重新设置父地图
 */
async function reparentMap(projectPath: string, mapId: number, parentId: number): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const mapInfosFile = path.join(dataDir, 'MapInfos.json');
  const mapInfos = readJson(mapInfosFile) as { id: number; parentId?: number }[];

  const mapInfo = mapInfos.find(m => m && m.id === mapId);
  if (!mapInfo) {
    throw new Error(`Map ${mapId} not found in MapInfos.json`);
  }

  mapInfo.parentId = parentId;
  writeJson(mapInfosFile, mapInfos);

  return { success: true, mapId, parentId };
}

/**
 * 复制地图
 */
async function duplicateMap(projectPath: string, mapId: number, parentId: number): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);

  if (!mapInfo || !mapInfo.exists) {
    throw new Error(`Map ${mapId} not found`);
  }

  // 找到下一个可用的 ID
  const maxId = scanResult.maps.reduce((max, m) => Math.max(max, m.id), 0);
  const newId = maxId + 1;

  const mapFile = path.join(dataDir, mapInfo.fileName);
  const map = readJson(mapFile) as Record<string, unknown>;
  const newFileName = `Map${String(newId).padStart(3, '0')}.json`;
  const newMapFile = path.join(dataDir, newFileName);

  // 写入新地图
  writeMapJson(newMapFile, map);

  // 更新 MapInfos.json
  const mapInfosFile = path.join(dataDir, 'MapInfos.json');
  const mapInfos = readJson(mapInfosFile) as Record<string, unknown>[];
  const newMapInfo = {
    id: newId,
    name: `${mapInfo.name} (Copy)`,
    parentId,
    order: (mapInfos.length || 0) + 1,
    expanded: false,
    scrollX: 0,
    scrollY: 0
  };
  mapInfos[newId] = newMapInfo;
  writeJson(mapInfosFile, mapInfos);

  return { success: true, mapId: newId, sourceMapId: mapId };
}

/**
 * 删除地图
 */
async function removeMap(projectPath: string, mapId: number): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);

  if (!mapInfo) {
    throw new Error(`Map ${mapId} not found`);
  }

  // 删除地图文件
  const mapFile = path.join(dataDir, mapInfo.fileName);
  if (exists(mapFile)) {
    fs.unlinkSync(mapFile);
  }

  // 更新 MapInfos.json
  const mapInfosFile = path.join(dataDir, 'MapInfos.json');
  const mapInfos = readJson(mapInfosFile) as Record<string, unknown>[];
  if (mapInfos[mapId]) {
    mapInfos[mapId] = null;
    writeJson(mapInfosFile, mapInfos);
  }

  return { success: true, mapId };
}

/**
 * 更新地图图块
 */
async function postMapTiles(projectPath: string, mapId: number, edits: unknown[]): Promise<Record<string, unknown>> {
  const spec = {
    engine: 'rpg-maker-mv',
    operations: [{
      op: 'set-map-tiles',
      mapId,
      edits
    }]
  };

  const report = applyPatchToProject(projectPath, spec as Parameters<typeof applyPatchToProject>[1]);
  return { success: true, report };
}

/**
 * 测试地图
 */
async function playtestMap(projectPath: string, mapId: number, startX?: number, startY?: number): Promise<Record<string, unknown>> {
  // 这个功能需要启动游戏引擎，暂时返回成功
  return {
    success: true,
    message: 'Playtest functionality requires game engine integration',
    mapId,
    startX: startX || 0,
    startY: startY || 0
  };
}

/**
 * 创建事件
 */
async function createEvent(projectPath: string, mapId: number, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const spec = {
    engine: 'rpg-maker-mv',
    operations: [{
      op: 'add-map-event',
      mapId,
      ...event
    }]
  };

  const report = applyPatchToProject(projectPath, spec as Parameters<typeof applyPatchToProject>[1]);
  return { success: true, report };
}

/**
 * 更新事件
 */
async function updateEvent(projectPath: string, mapId: number, eventId: number, event: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);

  if (!mapInfo || !mapInfo.exists) {
    throw new Error(`Map ${mapId} not found`);
  }

  const mapFile = path.join(dataDir, mapInfo.fileName);
  const map = readJson(mapFile) as { events: Record<number, Record<string, unknown>> };

  if (!map.events || !map.events[eventId]) {
    throw new Error(`Event ${eventId} not found on map ${mapId}`);
  }

  // 更新事件属性
  for (const [key, value] of Object.entries(event)) {
    map.events[eventId][key] = value;
  }

  writeMapJson(mapFile, map);
  return { success: true, mapId, eventId };
}

/**
 * 删除事件
 */
async function removeEvent(projectPath: string, mapId: number, eventId: number): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);

  if (!mapInfo || !mapInfo.exists) {
    throw new Error(`Map ${mapId} not found`);
  }

  const mapFile = path.join(dataDir, mapInfo.fileName);
  const map = readJson(mapFile) as { events: Record<number, Record<string, unknown>> };

  if (!map.events || !map.events[eventId]) {
    throw new Error(`Event ${eventId} not found on map ${mapId}`);
  }

  // 删除事件
  delete map.events[eventId];
  writeMapJson(mapFile, map);

  return { success: true, mapId, eventId };
}

/**
 * 复制事件
 */
async function duplicateEvent(projectPath: string, mapId: number, eventId: number): Promise<Record<string, unknown>> {
  const dataDir = resolveDataDir(projectPath);
  const scanResult = scanProject(projectPath);
  const mapInfo = scanResult.maps.find(m => m.id === mapId);

  if (!mapInfo || !mapInfo.exists) {
    throw new Error(`Map ${mapId} not found`);
  }

  const mapFile = path.join(dataDir, mapInfo.fileName);
  const map = readJson(mapFile) as { events: Record<number, Record<string, unknown>> };

  if (!map.events || !map.events[eventId]) {
    throw new Error(`Event ${eventId} not found on map ${mapId}`);
  }

  // 找到下一个可用的事件 ID
  const eventIds = Object.keys(map.events).map(Number).filter(id => id > 0);
  const newEventId = eventIds.length > 0 ? Math.max(...eventIds) + 1 : 1;

  // 复制事件
  const sourceEvent = map.events[eventId];
  const newEvent = {
    ...sourceEvent,
    id: newEventId,
    name: `${sourceEvent.name || 'Event'} (Copy)`
  };

  map.events[newEventId] = newEvent;
  writeMapJson(mapFile, map);

  return { success: true, mapId, eventId: newEventId, sourceEventId: eventId };
}

/**
 * 获取项目暂存状态
 */
function getProjectStagingStatus(root: string, projectPath: string): StagingStatus {
  try {
    const projectId = path.relative(root, projectPath) || 'default';
    const manifests = StagingManifestDao.listByProject(projectId);

    return {
      hasStaging: manifests.length > 0,
      maps: manifests.map(m => ({
        mapId: (m.manifest.mapId as number) || 0,
        hasChanges: true
      }))
    };
  } catch (error) {
    return { hasStaging: false, maps: [] };
  }
}

/**
 * 获取地图暂存状态
 */
function getStagingStatus(root: string, projectPath: string, mapId: number): { hasChanges: boolean } {
  try {
    const projectId = path.relative(root, projectPath) || 'default';
    const manifests = StagingManifestDao.listByProject(projectId);
    const hasChanges = manifests.some(m => (m.manifest.mapId as number) === mapId);

    return { hasChanges };
  } catch (error) {
    return { hasChanges: false };
  }
}

/**
 * 应用项目暂存
 */
async function applyProjectStaging(root: string, projectPath: string): Promise<Record<string, unknown>> {
  try {
    const projectId = path.relative(root, projectPath) || 'default';
    StagingManifestDao.deleteByProject(projectId);
    return { success: true, message: 'Staging applied' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 应用地图暂存
 */
async function applyStagedMap(root: string, projectPath: string, mapId: number): Promise<Record<string, unknown>> {
  try {
    const projectId = path.relative(root, projectPath) || 'default';
    const manifests = StagingManifestDao.listByProject(projectId);
    const mapManifests = manifests.filter(m => (m.manifest.mapId as number) === mapId);

    for (const manifest of mapManifests) {
      StagingManifestDao.delete(manifest.id);
    }

    return { success: true, mapId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 丢弃项目暂存
 */
function discardProjectStaging(root: string, projectPath: string): Record<string, unknown> {
  try {
    const projectId = path.relative(root, projectPath) || 'default';
    StagingManifestDao.deleteByProject(projectId);
    return { success: true, message: 'Staging discarded' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 丢弃地图暂存
 */
async function discardStagedMap(root: string, projectPath: string, mapId: number): Promise<Record<string, unknown>> {
  try {
    const projectId = path.relative(root, projectPath) || 'default';
    const manifests = StagingManifestDao.listByProject(projectId);
    const mapManifests = manifests.filter(m => (m.manifest.mapId as number) === mapId);

    for (const manifest of mapManifests) {
      StagingManifestDao.delete(manifest.id);
    }

    return { success: true, mapId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 列出地图库
 */
async function listMapLibrary(root: string): Promise<Record<string, unknown>> {
  try {
    const selections = MapSelectionDao.listByProject('library');
    const entries = selections.map(s => s.selection);
    return {
      totalEntries: entries.length,
      entries
    };
  } catch (error) {
    return {
      totalEntries: 0,
      entries: []
    };
  }
}

/**
 * 获取地图库选择
 */
async function getMapLibrarySelection(root: string): Promise<Record<string, unknown> | null> {
  try {
    const selection = MapSelectionDao.getLatest('library');
    return selection ? selection.selection : null;
  } catch (error) {
    return null;
  }
}

/**
 * 写入地图库选择
 */
async function writeMapLibrarySelection(root: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    MapSelectionDao.create('library', body);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 获取地图库截图 URL
 */
function getMapLibraryScreenshotUrl(root: string, assetId: string): string {
  // 返回截图路径
  return path.join(root, 'runtime', 'screenshots', `${assetId}.png`);
}

export async function initializeIpcHandlers(roots: AppRoots): Promise<void> {
  workflowRoot = roots.userDataRoot;

  await loadBackendModules(roots);
  registerAssetProtocol();
  
  registerSessionIpcHandlers(ipcMain, agentSessionRuntime, {
    revealArtifacts: async (sessionId: string) => {
      const session = agentSessionRuntime.get(sessionId) as { outDir?: unknown } | null;
      if (!session || typeof session.outDir !== 'string' || !session.outDir.trim()) {
        throw new Error('session artifacts not found');
      }
      const error = await shell.openPath(session.outDir);
      if (error) throw new Error(error);
      return { success: true };
    },
  });

  registerMapIpcHandlers(ipcMain, workflowRoot, desktop, {
    productLanguage: currentProductLanguage,
    withProductLanguage: withBackendProductLanguage,
    selectProjectDirectory: async (event: Electron.IpcMainInvokeEvent) => {
      const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
      const result = await dialog.showOpenDialog(parent, {
        title: electronText(currentProductLanguage(), 'projects.selectDirectoryTitle'),
        properties: ['openDirectory'],
      });
      if (result.canceled) return null;
      return result.filePaths[0] || null;
    },
    selectPluginFile: async (event: Electron.IpcMainInvokeEvent) => {
      const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
      const result = await dialog.showOpenDialog(parent, {
        title: electronText(currentProductLanguage(), 'plugins.selectFileTitle'),
        properties: ['openFile'],
        filters: [{ name: 'JavaScript', extensions: ['js'] }],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    },
    selectAssetFile: async (event: Electron.IpcMainInvokeEvent, category: string, extensions: string[]) => {
      const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
      const result = await dialog.showOpenDialog(parent, {
        title: electronText(currentProductLanguage(), 'assets.selectFileTitle', { category }),
        properties: ['openFile'],
        filters: [{ name: category, extensions }],
      });
      return result.canceled ? null : result.filePaths[0] || null;
    },
  });

  registerInteractivePlaytestIpcHandlers(ipcMain, requireInteractivePlaytestService(), {
    getLastProject: () => String(getWorkspaceSettings().lastProjectPath || ''),
    resolveProject: (project) => desktop.project.resolveProjectPath(workflowRoot, project),
    resolveSession: resolveInteractivePlaytestSession,
    revealEvidence: (runId) => {
      const run = requireInteractivePlaytestService().getRun(runId) as InteractivePlaytestRun | null;
      if (!run || !fs.existsSync(run.artifactPath)) throw new Error('Interactive playtest evidence was not found.');
      shell.showItemInFolder(run.artifactPath);
    },
  });

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, maximized: false };
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, maximized: win.isMaximized() };
  });
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return { ok: true };
  });
  ipcMain.handle('window:isMaximized', (event) => {
    return { maximized: Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized()) };
  });
  ipcMain.handle('window:openExternalUrl', async (_event, url: string) => {
    const target = new URL(String(url || ''));
    if (!['https:', 'http:'].includes(target.protocol)) {
      throw new Error(`Unsupported URL protocol: ${target.protocol}`);
    }
    await shell.openExternal(target.toString());
    return { ok: true };
  });

  ipcMain.handle('workspace:get', () => {
    return toIpcPayload(getWorkspaceSettings());
  });

  ipcMain.handle('workspace:put', (_event, body: Record<string, unknown>) => {
    const plain = normalizeWorkspaceSettings(toIpcPayload(body));
    ConsoleSettingsDao.set('workspace', plain);
    return toIpcPayload(plain);
  });

  ipcMain.handle('workspace:patch', (_event, body: Record<string, unknown>) => {
    return toIpcPayload(patchWorkspaceSettings(toIpcPayload(body) as WorkspaceSettings));
  });

  // Settings — all returns pass through toIpcPayload (structured-clone safe plain JSON)
  ipcMain.handle('settings:listProviders', async () => {
    const providers = await llm.providerRegistry.listProviders(workflowRoot);
    return toIpcPayload({
      providers: providers.map((provider: Record<string, unknown>) => providerSummaryForIpc(provider)),
    });
  });

  ipcMain.handle('settings:getProvider', async (_event, id: string) => {
    const provider = await llm.providerRegistry.getProvider(workflowRoot, id);
    if (!provider) throw new Error('provider not found');
    return toIpcPayload(providerSummaryForIpc(provider as Record<string, unknown>));
  });

  ipcMain.handle('settings:upsertProvider', async (_event, id: string, body: Record<string, unknown>) => {
    const patch = toIpcPayload(body) as Record<string, unknown>;
    const updated = await llm.providerRegistry.upsertProvider(workflowRoot, id, patch);
    return toIpcPayload({ provider: providerSummaryForIpc(updated as Record<string, unknown>) });
  });

  ipcMain.handle('settings:deleteProvider', async (_event, id: string) => {
    const removed = await llm.providerRegistry.removeProvider(workflowRoot, id);
    return toIpcPayload({ removed });
  });

  ipcMain.handle('settings:testProvider', async (_event, id: string, overrides?: Record<string, unknown>) => {
    try {
      const opts = overrides && typeof overrides === 'object' ? overrides : {};
      const apiKey = typeof opts.apiKey === 'string' ? opts.apiKey : undefined;
      const baseUrl = typeof opts.baseUrl === 'string' ? opts.baseUrl : undefined;
      const model = typeof opts.model === 'string' ? opts.model : undefined;
      return toIpcPayload(await llm.testProvider(workflowRoot, id, { apiKey, baseUrl, model }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return toIpcPayload({ ok: false, error: message });
    }
  });

  ipcMain.handle('settings:fetchModels', async (_event, id: string, overrides?: Record<string, unknown>) => {
    try {
      const opts = overrides && typeof overrides === 'object' ? overrides : {};
      const apiKey = typeof opts.apiKey === 'string' ? opts.apiKey : undefined;
      const baseUrl = typeof opts.baseUrl === 'string' ? opts.baseUrl : undefined;
      const persist = Boolean(opts.persist);
      const result = await llm.listModelsForProvider(workflowRoot, id, { apiKey, baseUrl });
      if (persist && result.ok && result.models?.length) {
        await llm.providerRegistry.upsertProvider(workflowRoot, id, {
          models: result.models.map((m) => ({ id: m.id, label: m.label || m.id })),
        });
      }
      return toIpcPayload(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return toIpcPayload({ ok: false, error: message });
    }
  });

  ipcMain.handle('settings:fetchThinkingVariants', async (_event, providerId: string, modelId: string) => {
    try {
      return toIpcPayload(await llm.listThinkingVariants(workflowRoot, providerId, modelId));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return toIpcPayload({ ok: false, variants: [{ id: 'default', label: electronText(currentProductLanguage(), 'settings.defaultVariant') }], error: message });
    }
  });

  ipcMain.handle('settings:getUi', () => {
    return toIpcPayload(ConsoleSettingsDao.get('ui') || {});
  });

  ipcMain.handle('settings:putUi', (_event, body: Record<string, unknown>) => {
    const plain = toIpcPayload(body) as Record<string, unknown>;
    ConsoleSettingsDao.set('ui', plain);
    return toIpcPayload(plain);
  });

  ipcMain.handle('settings:getPermissions', () => {
    return toIpcPayload(ConsoleSettingsDao.get('permissions') || {});
  });

  ipcMain.handle('settings:putPermissions', (_event, body: Record<string, unknown>) => {
    const plain = toIpcPayload(body) as Record<string, unknown>;
    ConsoleSettingsDao.set('permissions', plain);
    return toIpcPayload(plain);
  });

  ipcMain.handle('settings:getAgentExecution', () => {
    const stored = toIpcPayload(ConsoleSettingsDao.get('agentExecution') || {}) as Record<string, unknown>;
    return toIpcPayload(normalizeAgentExecutionSettings(stored));
  });

  ipcMain.handle('settings:putAgentExecution', async (_event, body: Record<string, unknown>) => {
    const plain = normalizeAgentExecutionSettings(toIpcPayload(body) as Record<string, unknown>);
    ConsoleSettingsDao.set('agentExecution', plain);
    const { activateBinding, defaultEngine } = await import(
      new URL('llm/invocation/index.ts', backendCoreUrl!).href,
    );
    const engine = defaultEngine();
    plain.engine = engine;
    const bindings = (plain.bindings || {}) as Record<string, { providerId?: string; modelId?: string }>;
    const { resolveBindingStorageKey } = await import(
      new URL('workflow/agent/runtime-adapters/index.ts', backendCoreUrl!).href,
    );
    const bindingKey = resolveBindingStorageKey(engine);
    const binding = bindings[bindingKey];
    if (binding?.providerId && binding?.modelId) {
      const activated = await activateBinding(
        workflowRoot,
        engine,
        binding.providerId,
        binding.modelId,
        plain,
      );
      return toIpcPayload({
        ...plain,
        bindings: activated.bindings,
        lastSyncedAt: activated.lastSyncedAt,
        activation: {
          ok: activated.ok,
          profileId: activated.profileId,
          blocker: activated.blocker,
          materialized: activated.materialized,
        },
      });
    }
    return toIpcPayload(plain);
  });

  // ---- Durable agent memory (Phase 1: read / clear / open folder) ----
  const loadMemoryStore = () => import(new URL('memory/memory-store.ts', backendCoreUrl!).href);
  async function resolveMemoryProjectId(raw: unknown): Promise<string> {
    const { resolveActiveProjectId } = await import(new URL('memory/active-project.ts', backendCoreUrl!).href);
    const id = resolveActiveProjectId({ projectId: typeof raw === 'string' ? raw : '' });
    if (!id) throw new Error('A valid projectId is required');
    return id;
  }

  ipcMain.handle('memory:listProject', async (_event, projectId: unknown) => {
    const id = await resolveMemoryProjectId(projectId);
    const store = await loadMemoryStore();
    return toIpcPayload(store.listProjectMemory(workflowRoot, id));
  });

  ipcMain.handle('memory:getOverview', async (_event, projectId: unknown) => {
    const id = await resolveMemoryProjectId(projectId);
    const store = await loadMemoryStore();
    const settings = await loadMemorySettings();
    return toIpcPayload({ ...store.getProjectMemoryOverview(workflowRoot, id), settings: settings.readMemorySettings() });
  });

  ipcMain.handle('memory:listActivity', async (_event, payload: Record<string, unknown> = {}) => {
    const plain = toIpcPayload(payload) as Record<string, unknown>;
    const id = await resolveMemoryProjectId(plain.projectId);
    const limit = typeof plain.limit === 'number' ? plain.limit : 50;
    const store = await loadMemoryStore();
    return toIpcPayload({ projectId: id, entries: store.readActivityLog(workflowRoot, id, limit) });
  });

  ipcMain.handle('memory:readFile', async (_event, payload: Record<string, unknown> = {}) => {
    const plain = toIpcPayload(payload) as Record<string, unknown>;
    const id = await resolveMemoryProjectId(plain.projectId);
    const relPath = String(plain.relPath || '');
    const store = await loadMemoryStore();
    return toIpcPayload({ relPath, content: store.readMemoryFile(workflowRoot, id, relPath) });
  });

  ipcMain.handle('memory:clearProject', async (_event, projectId: unknown) => {
    const id = await resolveMemoryProjectId(projectId);
    const store = await loadMemoryStore();
    return toIpcPayload({ cleared: store.clearProjectMemory(workflowRoot, id) });
  });

  ipcMain.handle('memory:reindexProject', async (_event, projectId: unknown) => {
    const id = await resolveMemoryProjectId(projectId);
    const store = await loadMemoryStore();
    const index = store.reindexProjectMemory(workflowRoot, id);
    return toIpcPayload({ projectId: id, index });
  });

  ipcMain.handle('memory:openFolder', async (_event, projectId: unknown) => {
    const id = await resolveMemoryProjectId(projectId);
    const paths = await import(new URL('workspace-paths.ts', backendCoreUrl!).href);
    const dir = paths.resolveProjectMemoryDir(workflowRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return toIpcPayload({ ok: !error, error: error || null, dir });
  });

  // ---- Shared author profile (USER.md) — cross-project, Phase 2a ----
  ipcMain.handle('memory:readUserProfile', async () => {
    const store = await loadMemoryStore();
    return toIpcPayload({ content: store.readUserProfile(workflowRoot) });
  });

  ipcMain.handle('memory:writeUserProfile', async (_event, payload: Record<string, unknown> = {}) => {
    const plain = toIpcPayload(payload) as Record<string, unknown>;
    const store = await loadMemoryStore();
    store.writeUserProfile(workflowRoot, String(plain.content ?? ''));
    return toIpcPayload({ content: store.readUserProfile(workflowRoot) });
  });

  // ---- Memory settings: master switch + recall model (backend-owned, Phase 2a) ----
  const loadMemorySettings = () => import(new URL('memory/memory-settings.ts', backendCoreUrl!).href);

  ipcMain.handle('memory:getSettings', async () => {
    const mod = await loadMemorySettings();
    return toIpcPayload(mod.readMemorySettings());
  });

  ipcMain.handle('memory:setSettings', async (_event, payload: Record<string, unknown> = {}) => {
    const plain = toIpcPayload(payload) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof plain.enabled === 'boolean') patch.enabled = plain.enabled;
    if ('recallModel' in plain) patch.recallModel = plain.recallModel ?? null;
    if (typeof plain.autoExtractEnabled === 'boolean') patch.autoExtractEnabled = plain.autoExtractEnabled;
    const mod = await loadMemorySettings();
    return toIpcPayload(mod.writeMemorySettings(patch));
  });

  ipcMain.handle('settings:activateInvocation', async (_event, payload: Record<string, unknown> = {}) => {
    const { activateBinding, defaultEngine } = await import(
      new URL('llm/invocation/index.ts', backendCoreUrl!).href,
    );
    const request = toIpcPayload(payload) as Record<string, unknown>;
    const stored = normalizeAgentExecutionSettings(
      toIpcPayload(ConsoleSettingsDao.get('agentExecution') || {}) as Record<string, unknown>,
    );
    const engine = defaultEngine();
    const providerId = String(request.providerId || '');
    const modelId = String(request.modelId || '');
    if (!providerId || !modelId) {
      throw new Error('providerId and modelId are required');
    }
    const activated = await activateBinding(
      workflowRoot,
      engine,
      providerId,
      modelId,
      { ...stored, engine },
    );
    return toIpcPayload(activated);
  });

  ipcMain.handle('settings:listCompatibleProviders', async (_event, engine?: string) => {
    const { listCompatibleProviders, defaultEngine } = await import(
      new URL('llm/invocation/index.ts', backendCoreUrl!).href,
    );
    const resolved = defaultEngine();
    const providers = await listCompatibleProviders(resolved, workflowRoot);
    return toIpcPayload({ engine: resolved, providers });
  });

  ipcMain.handle('settings:getAgentCapabilities', async () => {
    const { getAgentCapabilitiesSnapshot } = await import(
      new URL('workflow/agent/agent-capabilities.ts', backendCoreUrl!).href,
    );
    const agentExecution = ConsoleSettingsDao.get('agentExecution') || { engine: DEFAULT_AGENT_EXECUTION_ENGINE };
    const engine = (agentExecution as { engine?: string }).engine || DEFAULT_AGENT_EXECUTION_ENGINE;
    const snapshot = getAgentCapabilitiesSnapshot(workflowRoot, {
      engine,
    });
    return toIpcPayload(snapshot);
  });

  ipcMain.handle('settings:putAgentToolAllow', async (_event, body: Record<string, unknown>) => {
    const plain = toIpcPayload(body) as { toolId: string; allowed: boolean };
    const { updateAgentToolAllow } = await import(
      new URL('workflow/agent/agent-capabilities.ts', backendCoreUrl!).href,
    );
    const agentExecution = ConsoleSettingsDao.get('agentExecution') || { engine: DEFAULT_AGENT_EXECUTION_ENGINE };
    const engine = (agentExecution as { engine?: string }).engine || DEFAULT_AGENT_EXECUTION_ENGINE;
    const snapshot = updateAgentToolAllow(
      workflowRoot,
      plain.toolId,
      Boolean(plain.allowed),
    );
    return toIpcPayload({ ...snapshot, engine });
  });

  ipcMain.handle('settings:putMcpServerEnabled', async (_event, body: Record<string, unknown>) => {
    const plain = toIpcPayload(body) as { serverId: string; enabled: boolean };
    const { updateMcpServerEnabled } = await import(
      new URL('workflow/agent/agent-capabilities.ts', backendCoreUrl!).href,
    );
    const snapshot = updateMcpServerEnabled(workflowRoot, plain.serverId, Boolean(plain.enabled));
    return toIpcPayload(snapshot);
  });

  ipcMain.handle('settings:putAgentSkillEnabled', async (_event, body: Record<string, unknown>) => {
    const plain = toIpcPayload(body) as { skillPath: string; enabled: boolean };
    const { updateAgentSkillEnabled } = await import(
      new URL('workflow/agent/agent-capabilities.ts', backendCoreUrl!).href,
    );
    const snapshot = updateAgentSkillEnabled(
      workflowRoot,
      plain.skillPath,
      Boolean(plain.enabled),
    );
    return toIpcPayload(snapshot);
  });

  ipcMain.handle('settings:createSkill', async (_event, body: Record<string, unknown>) => {
    const plain = toIpcPayload(body) as { skill?: string; description?: string };
    const { createNativeSkill } = await import(
      new URL('desktop/native-skill-service.ts', backendCoreUrl!).href,
    );
    return withBackendProductLanguage(currentProductLanguage(), () => toIpcPayload(createNativeSkill(
      workflowRoot,
      String(plain.skill || ''),
      String(plain.description || ''),
    )));
  });

  ipcMain.handle('settings:openCapabilityPath', async (_event, filePath: string) => {
    const target = path.resolve(String(filePath || ''));
    if (!fs.existsSync(target)) throw new Error(`File not found: ${target}`);
    await shell.openPath(target);
    return { ok: true };
  });

  ipcMain.handle('settings:syncProviderSeeds', async () => {
    const { syncProviderSeeds } = await import(
      new URL('llm/provider-seeds.ts', backendCoreUrl!).href,
    );
    const result = await syncProviderSeeds(workflowRoot);
    return toIpcPayload(result);
  });

  ipcMain.handle('settings:probeAgentExecution', async (_event, body: Record<string, unknown> = {}) => {
    if (!backendCoreUrl) {
      throw new Error('Backend modules not loaded');
    }
    const { probeAgentExecution, defaultEngine } = await import(
      new URL('workflow/agent/runtime-adapters/index.ts', backendCoreUrl).href,
    );
    const partial = toIpcPayload(body) as Record<string, unknown>;
    const stored = toIpcPayload(ConsoleSettingsDao.get('agentExecution') || {}) as Record<string, unknown>;
    const engine = defaultEngine();
    const settings = { ...stored, ...partial, engine };
    return toIpcPayload(probeAgentExecution(engine, settings, workflowRoot));
  });


  // ---- Dynamic workflow proposals (agent proposes → human approves → background run) ----
  const loadWorkflowProposals = () => import(new URL('workflow/orchestrator/proposals.ts', backendCoreUrl!).href);

  ipcMain.handle('workflow:listProposals', async (_event, status?: string) => {
    const proposals = await loadWorkflowProposals();
    const filter = status ? { status: status as never } : undefined;
    return toIpcPayload({ proposals: proposals.listProposals(workflowRoot, filter) });
  });

  ipcMain.handle('workflow:getProposal', async (_event, proposalId: string) => {
    const proposals = await loadWorkflowProposals();
    return toIpcPayload({ proposal: proposals.readProposal(workflowRoot, String(proposalId || '')) });
  });

  ipcMain.handle('workflow:rejectProposal', async (_event, proposalId: string, reason?: string) => {
    const proposals = await loadWorkflowProposals();
    return toIpcPayload({ proposal: proposals.rejectProposal(workflowRoot, String(proposalId || ''), reason) });
  });

  ipcMain.handle('workflow:getScript', async (_event, proposalId: string) => {
    const proposals = await loadWorkflowProposals();
    try {
      return toIpcPayload({ ok: true, script: proposals.readProposalScript(workflowRoot, String(proposalId || '')) });
    } catch (error) {
      return toIpcPayload({ ok: false, script: null, error: error instanceof Error ? error.message : String(error) });
    }
  });

  ipcMain.handle('workflow:getReport', async (_event, proposalId: string) => {
    const proposals = await loadWorkflowProposals();
    const proposal = proposals.readProposal(workflowRoot, String(proposalId || ''));
    if (!proposal?.reportPath || !fs.existsSync(proposal.reportPath)) {
      return toIpcPayload({ ok: false, report: null });
    }
    try {
      return toIpcPayload({ ok: true, report: JSON.parse(fs.readFileSync(proposal.reportPath, 'utf8')) });
    } catch (error) {
      return toIpcPayload({ ok: false, report: null, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 批准 = 后台开跑（立刻返回），进度与报告顺着发起会话的事件流回到对话里。
  ipcMain.handle('workflow:approveProposal', async (_event, proposalId: string) => {
    const proposals = await loadWorkflowProposals();
    const id = String(proposalId || '');
    const proposal = proposals.readProposal(workflowRoot, id);
    if (!proposal) throw new Error('提议不存在');
    const result = agentSessionRuntime.approveWorkflowProposal(id, proposal.sessionId || undefined);
    if (!result.ok) throw new Error(result.reason || '无法批准工作流提议');
    return toIpcPayload({ ok: true, status: result.status || 'running', proposalId: id });
  });

  console.log('[ipc] IPC handlers initialized');
}

function registerAssetProtocol(): void {
  if (assetProtocolRegistered) return;
  protocol.handle('rmmv-asset', (request) => {
    try {
      return net.fetch(pathToFileURL(desktop.assets.resolveAssetRequest(workflowRoot, request.url)).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  assetProtocolRegistered = true;
}

/**
 * 清理 IPC 处理器
 */
export function cleanupIpcHandlers(): void {
  if (interactivePlaytestService) {
    interactivePlaytestService.shutdownSync();
    interactivePlaytestService = null;
  }
  cleanupSessionIpcHandlers(ipcMain);
  cleanupMapIpcHandlers(ipcMain);
  cleanupInteractivePlaytestIpcHandlers(ipcMain);
  ipcMain.removeHandler('window:minimize');
  ipcMain.removeHandler('window:toggleMaximize');
  ipcMain.removeHandler('window:close');
  ipcMain.removeHandler('window:isMaximized');
  ipcMain.removeHandler('window:openExternalUrl');
  ipcMain.removeHandler('workspace:get');
  ipcMain.removeHandler('workspace:put');
  ipcMain.removeHandler('workspace:patch');
  ipcMain.removeHandler('settings:listProviders');
  ipcMain.removeHandler('settings:getProvider');
  ipcMain.removeHandler('settings:upsertProvider');
  ipcMain.removeHandler('settings:deleteProvider');
  ipcMain.removeHandler('settings:testProvider');
  ipcMain.removeHandler('settings:fetchModels');
  ipcMain.removeHandler('settings:fetchThinkingVariants');
  ipcMain.removeHandler('settings:getUi');
  ipcMain.removeHandler('settings:putUi');
  ipcMain.removeHandler('settings:getPermissions');
  ipcMain.removeHandler('settings:putPermissions');
  ipcMain.removeHandler('settings:getAgentExecution');
  ipcMain.removeHandler('settings:putAgentExecution');
  ipcMain.removeHandler('settings:activateInvocation');
  ipcMain.removeHandler('settings:listCompatibleProviders');
  ipcMain.removeHandler('settings:syncProviderSeeds');
  ipcMain.removeHandler('settings:probeAgentExecution');
  ipcMain.removeHandler('settings:getAgentCapabilities');
  ipcMain.removeHandler('settings:putAgentToolAllow');
  ipcMain.removeHandler('settings:putMcpServerEnabled');
  ipcMain.removeHandler('settings:putAgentSkillEnabled');
  ipcMain.removeHandler('settings:createSkill');
  ipcMain.removeHandler('settings:openCapabilityPath');
  ipcMain.removeHandler('workflow:listProposals');
  ipcMain.removeHandler('workflow:getProposal');
  ipcMain.removeHandler('workflow:rejectProposal');
  ipcMain.removeHandler('workflow:getScript');
  ipcMain.removeHandler('workflow:getReport');
  ipcMain.removeHandler('workflow:approveProposal');
  if (assetProtocolRegistered) {
    protocol.unhandle('rmmv-asset');
    assetProtocolRegistered = false;
  }
  agentSessionRuntime?.close().catch((error: Error) => console.warn('[ipc] Agent runtime close failed:', error.message));
  agentSessionRuntime = null;
  backendWithProductLanguage = null;
  console.log('[ipc] IPC handlers cleaned up');
}
