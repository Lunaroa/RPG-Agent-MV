import path from 'node:path';
import { invokeDesktop } from './ipc-desktop-error.ts';

export interface IpcRegistrar {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface ProjectIpcOptions {
  selectProjectDirectory?: (event: unknown) => Promise<string | null>;
}

export const MAP_IPC_CHANNELS = [
  'projects:list',
  'projects:refresh',
  'projects:add',
  'projects:browseAndAdd',
  'projects:remove',
  'projects:initializeGitBaseline',
  'projects:saveProjectVersion',
  'maps:tree',
  'maps:tilesets',
  'maps:get',
  'maps:create',
  'maps:importFromLibrary',
  'maps:importPackageFromLibrary',
  'maps:updateProperties',
  'maps:reparent',
  'maps:duplicate',
  'maps:remove',
  'maps:postTiles',
  'maps:setStartPosition',
  'maps:setSystemPosition',
  'maps:playtest',
  'events:create',
  'events:createFromPlacement',
  'events:update',
  'events:remove',
  'events:duplicate',
  'eventRegistry:contracts',
  'eventRegistry:showContract',
  'eventRegistry:script',
  'eventRegistry:reject',
  'eventRegistry:approve',
  'eventRegistry:unreject',
  'projectAssets:editorCatalog',
  'projectAssets:detail',
  'projectAssets:rename',
  'projectAssets:remove',
  'projectAssets:referenceGraph',
  'projectAssets:checkRenameSafety',
  'projectAssets:checkDeleteSafety',
  'projectAssets:replaceMissingReference',
  'projectAssets:importLocalFile',
  'projectManagement:overview',
  'projectManagement:getEntry',
  'projectManagement:updateEntry',
  'projectManagement:createEntry',
  'commonEvents:list',
  'commonEvents:get',
  'commonEvents:create',
  'commonEvents:update',
  'commonEvents:delete',
  'commonEvents:duplicate',
  'commonEvents:rename',
  'commonEvents:changeTrigger',
  'commonEvents:editCommandList',
  'commonEvents:references',
  'plugins:read',
  'plugins:validate',
  'plugins:writeConfiguration',
  'plugins:setEnabled',
  'plugins:reorder',
  'plugins:updateParameters',
  'plugins:installFile',
  'plugins:deleteFile',
  'assetLibrary:catalog',
  'assetLibrary:detail',
  'assetLibrary:validateImport',
  'assetLibrary:import',
  'staging:projectStatus',
  'staging:applyProject',
  'staging:discardProject',
  'staging:mapStatus',
  'staging:applyMap',
  'staging:discardMap',
  'placementQueue:get',
  'placementQueue:save',
  'placementQueue:clear',
  'mapLibrary:list',
  'mapLibrary:getSelection',
  'mapLibrary:writeSelection',
  'mapLibrary:validatePackage',
  'storyPages:profile',
  'storyPages:initializeOriginal',
  'storyPages:initializeOriginalWithGitBaseline',
  'storyPages:sync',
  'storyPages:inspectEvent',
  'storyPages:changeOrigin',
  'storyOutline:get',
  'storyOutline:set',
] as const;

export function registerMapIpcHandlers(
  ipc: IpcRegistrar,
  workflowRoot: string,
  desktop: any,
  options: ProjectIpcOptions = {},
): void {
  const project = (value?: string) => desktop.project.resolveProjectPath(workflowRoot, value);

  ipc.handle('projects:list', () => desktop.project.listProjects(workflowRoot));
  ipc.handle('projects:refresh', () => desktop.project.refreshProjects(workflowRoot));
  ipc.handle('projects:add', (_event, projectPath: string, addOptions?: Record<string, unknown>) => ({
    project: desktop.project.registerExternalProject(workflowRoot, projectPath, addOptions || {}),
    projects: desktop.project.listProjects(workflowRoot),
  }));
  ipc.handle('projects:browseAndAdd', async (event, addOptions?: Record<string, unknown>) => {
    if (!options.selectProjectDirectory) throw new Error('当前运行环境不支持选择项目目录');
    const selectedPath = await options.selectProjectDirectory(event);
    if (!selectedPath) {
      return {
        canceled: true,
        project: null,
        projects: desktop.project.listProjects(workflowRoot),
      };
    }
    return {
      canceled: false,
      project: desktop.project.registerExternalProject(workflowRoot, selectedPath, addOptions || {}),
      projects: desktop.project.listProjects(workflowRoot),
    };
  });
  ipc.handle('projects:remove', (_event, projectPath: string) => ({
    projects: desktop.project.removeRegisteredProject(workflowRoot, projectPath),
  }));
  ipc.handle('projects:initializeGitBaseline', (_event, value?: string, options?: Record<string, unknown>) =>
    desktop.project.initializeProjectGitBaseline(workflowRoot, value, options));
  ipc.handle('projects:saveProjectVersion', (_event, value?: string, options?: Record<string, unknown>) =>
    desktop.project.saveProjectVersion(workflowRoot, value, options));
  ipc.handle('maps:tree', (_event, value?: string) => desktop.maps.buildMapIndex(workflowRoot, project(value)));
  ipc.handle('maps:tilesets', (_event, value?: string) => desktop.maps.buildTilesetIndex(workflowRoot, project(value)));
  ipc.handle('maps:get', (_event, mapId: number, value?: string) =>
    desktop.maps.buildMapPayload(workflowRoot, project(value), mapId));
  ipc.handle('maps:create', (_event, properties: Record<string, unknown>, value?: string) => desktop.maps.createMapDraft(workflowRoot, project(value), properties));
  ipc.handle('maps:importFromLibrary', (_event, assetId: string, parentMapId?: number | null, properties?: Record<string, unknown>, value?: string) => desktop.maps.importMapDraftFromLibrary(workflowRoot, project(value), assetId, { ...(properties || {}), parentId: parentMapId || 0 }));
  ipc.handle('maps:importPackageFromLibrary', (_event, assetIds: string[], parentMapId?: number | null, properties?: Record<string, unknown>, value?: string) =>
    desktop.maps.importMapPackageFromLibrary(workflowRoot, project(value), assetIds, parentMapId || 0, properties || {}));
  ipc.handle('maps:updateProperties', (_event, mapId: number, properties: Record<string, unknown>, value?: string) => desktop.maps.updateMapPropertiesDraft(workflowRoot, project(value), mapId, properties));
  ipc.handle('maps:reparent', (_event, mapId: number, parentId: number, value?: string) => desktop.maps.reparentMapDraft(workflowRoot, project(value), mapId, parentId));
  ipc.handle('maps:duplicate', (_event, mapId: number, parentId: number, value?: string) => desktop.maps.duplicateMapDraft(workflowRoot, project(value), mapId, parentId));
  ipc.handle('maps:remove', (_event, mapId: number, value?: string) => desktop.maps.deleteMapDraft(workflowRoot, project(value), mapId));
  ipc.handle('maps:postTiles', (_event, mapId: number, edits: unknown[], value?: string) => desktop.maps.postMapTiles(workflowRoot, project(value), mapId, edits));
  ipc.handle('maps:setStartPosition', (_event, mapId: number, x: number, y: number, value?: string) =>
    desktop.maps.setStartPositionDraft(workflowRoot, project(value), mapId, x, y));
  ipc.handle('maps:setSystemPosition', (_event, target: string, mapId: number, x: number, y: number, value?: string) =>
    desktop.maps.setSystemPositionDraft(workflowRoot, project(value), target, mapId, x, y));
  ipc.handle('maps:playtest', (_event, mapId: number, startX?: number, startY?: number, value?: string) => desktop.maps.createPlaytestArtifact(workflowRoot, project(value), mapId, startX, startY));

  ipc.handle('events:create', (_event, mapId: number, event: Record<string, unknown>, value?: string) =>
    invokeDesktop(() => desktop.events.createEvent(workflowRoot, project(value), mapId, event)));
  ipc.handle('events:createFromPlacement', (_event, mapId: number, payload: Record<string, unknown>, value?: string) =>
    invokeDesktop(() => desktop.events.createPlacementEvent(workflowRoot, project(value), mapId, payload)));
  ipc.handle('events:update', (_event, mapId: number, eventId: number, event: Record<string, unknown>, value?: string) =>
    invokeDesktop(() => desktop.events.updateEvent(workflowRoot, project(value), mapId, eventId, event)));
  ipc.handle('events:remove', (_event, mapId: number, eventId: number, value?: string) =>
    invokeDesktop(() => desktop.events.removeEvent(workflowRoot, project(value), mapId, eventId)));
  ipc.handle('events:duplicate', (_event, mapId: number, eventId: number, value?: string) =>
    invokeDesktop(() => desktop.events.duplicateEvent(workflowRoot, project(value), mapId, eventId)));
  const registryOptions = (relProject?: string) => ({
    runtimeRoot: path.join(workflowRoot, 'runtime'),
    projectPath: project(relProject),
  });
  ipc.handle('eventRegistry:contracts', (_event, relProject?: string, filters?: Record<string, unknown>) =>
    desktop.eventRegistry.listContracts(registryOptions(relProject).projectPath, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      ...(filters || {}),
    }));
  ipc.handle('eventRegistry:showContract', (_event, contractId: string, relProject?: string) =>
    desktop.eventRegistry.showContract(registryOptions(relProject).projectPath, contractId, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
    }));
  // 放置前预览：按 contractId 单行查注册表，渲染成「人话剧本」（与编译同源，先归一再渲染）。
  ipc.handle('eventRegistry:script', (_event, contractId: string) =>
    desktop.eventScript.getEventScript(contractId));
  // 拒绝/弃用一个契约（玩家不接受放置时给它明确状态）。
  ipc.handle('eventRegistry:reject', (_event, idOrRid: string | number, relProject?: string, rejectOptions?: Record<string, unknown>) =>
    desktop.eventRegistry.rejectContract(registryOptions(relProject).projectPath, idOrRid, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      abandon: Boolean(rejectOptions?.abandon),
      reason: typeof rejectOptions?.reason === 'string' ? rejectOptions.reason : undefined,
    }));
  // 批准待确认契约进入待放置队列。
  ipc.handle('eventRegistry:approve', (_event, idOrRid: string | number, relProject?: string, approveOptions?: Record<string, unknown>) =>
    desktop.eventRegistry.approveContract(registryOptions(relProject).projectPath, idOrRid, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      note: typeof approveOptions?.note === 'string' ? approveOptions.note : undefined,
    }));
  // 撤回拒绝：UI 误点拒绝后的 Ctrl+Z，把状态还原回待放置态。
  ipc.handle('eventRegistry:unreject', (_event, idOrRid: string | number, relProject?: string, unrejectOptions?: Record<string, unknown>) =>
    desktop.eventRegistry.unrejectContract(registryOptions(relProject).projectPath, idOrRid, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      status: typeof unrejectOptions?.status === 'string' ? unrejectOptions.status : undefined,
    }));
  ipc.handle('projectAssets:editorCatalog', (_event, value?: string) => desktop.catalog.buildEditorProjectCatalog(workflowRoot, project(value)));
  ipc.handle('projectAssets:detail', (_event, target: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.getAssetDetail(workflowRoot, project(value), target));
  ipc.handle('projectAssets:rename', (_event, target: Record<string, unknown>, nextName: string, value?: string) =>
    desktop.assetManagement.renameAsset(workflowRoot, project(value), target, nextName));
  ipc.handle('projectAssets:remove', (_event, target: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.deleteAsset(workflowRoot, project(value), target));
  ipc.handle('projectAssets:referenceGraph', (_event, value?: string) =>
    desktop.assetManagement.buildProjectAssetReferenceGraph(workflowRoot, project(value)));
  ipc.handle('projectAssets:checkRenameSafety', (_event, target: Record<string, unknown>, nextName: string, value?: string) =>
    desktop.assetManagement.checkProjectAssetRenameSafety(workflowRoot, project(value), target, nextName));
  ipc.handle('projectAssets:checkDeleteSafety', (_event, target: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.checkProjectAssetDeleteSafety(workflowRoot, project(value), target));
  ipc.handle('projectAssets:replaceMissingReference', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.replaceMissingAssetReference(workflowRoot, project(value), request));
  ipc.handle('projectAssets:importLocalFile', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.importLocalAssetFile(workflowRoot, project(value), request));
  ipc.handle('projectManagement:overview', (_event, value?: string) => {
    const resolved = project(value);
    const scan = desktop.scanner.scanProject(resolved);
    const assets = desktop.scanner.buildAssetInventory(resolved);
    return { scan, assets };
  });
  ipc.handle('projectManagement:getEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.getProjectManagedEntry(workflowRoot, project(value), request));
  ipc.handle('projectManagement:updateEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.updateProjectManagedEntry(workflowRoot, project(value), request));
  ipc.handle('projectManagement:createEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.createProjectManagedEntry(workflowRoot, project(value), request));

  ipc.handle('commonEvents:list', (_event, value?: string) =>
    desktop.commonEvents.listCommonEvents(workflowRoot, project(value)));
  ipc.handle('commonEvents:get', (_event, commonEventId: number, value?: string) =>
    desktop.commonEvents.getCommonEvent(workflowRoot, project(value), { id: commonEventId }));
  ipc.handle('commonEvents:create', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.commonEvents.createCommonEvent(workflowRoot, project(value), request || {}));
  ipc.handle('commonEvents:update', (_event, commonEventId: number, valuePayload: unknown, value?: string) =>
    desktop.commonEvents.updateCommonEvent(workflowRoot, project(value), { id: commonEventId, value: valuePayload }));
  ipc.handle('commonEvents:delete', (_event, commonEventId: number, deleteOptions?: Record<string, unknown>, value?: string) =>
    desktop.commonEvents.deleteCommonEvent(workflowRoot, project(value), { id: commonEventId, ...(deleteOptions || {}) }));
  ipc.handle('commonEvents:duplicate', (_event, commonEventId: number, options?: Record<string, unknown>, value?: string) =>
    desktop.commonEvents.duplicateCommonEvent(workflowRoot, project(value), { id: commonEventId, ...(options || {}) }));
  ipc.handle('commonEvents:rename', (_event, commonEventId: number, name: string, value?: string) =>
    desktop.commonEvents.renameCommonEvent(workflowRoot, project(value), { id: commonEventId, name }));
  ipc.handle('commonEvents:changeTrigger', (_event, commonEventId: number, trigger: number, switchId?: number, value?: string) =>
    desktop.commonEvents.changeCommonEventTrigger(workflowRoot, project(value), { id: commonEventId, trigger, switchId }));
  ipc.handle('commonEvents:editCommandList', (_event, commonEventId: number, list: unknown[], value?: string) =>
    desktop.commonEvents.editCommonEventCommandList(workflowRoot, project(value), { id: commonEventId, list: list || [] }));
  ipc.handle('commonEvents:references', (_event, commonEventId: number, value?: string) =>
    desktop.commonEvents.findCommonEventUsages(workflowRoot, project(value), commonEventId));

  ipc.handle('plugins:read', (_event, value?: string) =>
    desktop.pluginManagement.readPluginConfiguration(workflowRoot, project(value)));
  ipc.handle('plugins:validate', (_event, value?: string) =>
    desktop.pluginManagement.validatePluginConfiguration(workflowRoot, project(value)));
  ipc.handle('plugins:writeConfiguration', (_event, entries: Array<Record<string, unknown>>, value?: string) =>
    desktop.pluginManagement.writePluginConfiguration(workflowRoot, project(value), entries || []));
  ipc.handle('plugins:setEnabled', (_event, pluginName: string, enabled: boolean, value?: string) =>
    desktop.pluginManagement.setPluginEnabled(workflowRoot, project(value), pluginName, enabled));
  ipc.handle('plugins:reorder', (_event, pluginNames: string[], value?: string) =>
    desktop.pluginManagement.reorderPlugins(workflowRoot, project(value), pluginNames || []));
  ipc.handle('plugins:updateParameters', (_event, pluginName: string, parameters: Record<string, unknown>, value?: string) =>
    desktop.pluginManagement.updatePluginParameters(workflowRoot, project(value), pluginName, parameters || {}));
  ipc.handle('plugins:installFile', (_event, sourceFile: string, options?: Record<string, unknown>, value?: string) =>
    desktop.pluginManagement.installPluginFile(workflowRoot, project(value), sourceFile, options || {}));
  ipc.handle('plugins:deleteFile', (_event, pluginName: string, options?: Record<string, unknown>, value?: string) =>
    desktop.pluginManagement.deletePluginFile(workflowRoot, project(value), pluginName, options || {}));

  ipc.handle('assetLibrary:catalog', () => desktop.assetLibrary.buildAssetLibraryCatalog(workflowRoot));
  ipc.handle('assetLibrary:detail', (_event, assetId: string) => desktop.assetLibrary.getAssetLibraryEntry(workflowRoot, assetId));
  ipc.handle('assetLibrary:validateImport', (_event, assetId: string, value?: string) =>
    desktop.assetLibrary.validateAssetLibraryImport(workflowRoot, project(value), assetId));
  ipc.handle('assetLibrary:import', (_event, assetId: string, value?: string) =>
    desktop.assetLibrary.importAssetLibraryEntry(workflowRoot, project(value), assetId));

  ipc.handle('staging:projectStatus', (_event, value?: string) => desktop.staging.getProjectStagingStatus(workflowRoot, project(value)));
  ipc.handle('staging:applyProject', (_event, value?: string) => desktop.staging.applyProjectStaging(workflowRoot, project(value)));
  ipc.handle('staging:discardProject', (_event, value?: string) => desktop.staging.discardProjectStaging(workflowRoot, project(value)));
  ipc.handle('staging:mapStatus', (_event, mapId: number, value?: string) => desktop.staging.getStagingStatus(workflowRoot, project(value), mapId));
  ipc.handle('staging:applyMap', (_event, mapId: number, value?: string) => desktop.staging.applyStagedMap(workflowRoot, project(value), mapId));
  ipc.handle('staging:discardMap', (_event, mapId: number, value?: string) => desktop.staging.discardStagedMap(workflowRoot, project(value), mapId));

  ipc.handle('placementQueue:get', (_event, value?: string) =>
    desktop.placementQueue.getPlacementQueueSession(workflowRoot, project(value)));
  ipc.handle('placementQueue:save', (_event, session: Record<string, unknown>, value?: string) =>
    desktop.placementQueue.savePlacementQueueSession(project(value), session));
  ipc.handle('placementQueue:clear', (_event, value?: string) => {
    desktop.placementQueue.clearPlacementQueueSession(project(value));
    return { ok: true };
  });

  ipc.handle('mapLibrary:list', () => desktop.library.listMapLibrary(workflowRoot));
  ipc.handle('mapLibrary:getSelection', () => desktop.library.getMapLibrarySelection());
  ipc.handle('mapLibrary:writeSelection', (_event, body: Record<string, unknown>) => desktop.library.writeMapLibrarySelection(workflowRoot, body));
  ipc.handle('mapLibrary:validatePackage', (_event, assetIds: string[]) => desktop.library.validateMapLibraryPackage(workflowRoot, assetIds));

  ipc.handle('storyPages:profile', (_event, value?: string) => desktop.storyPages.getStoryProjectProfile(project(value)));
  ipc.handle('storyPages:initializeOriginal', (_event, value?: string) => {
    const resolved = project(value);
    return desktop.storyPages.initializeOriginalStoryProject(resolved);
  });
  ipc.handle('storyPages:initializeOriginalWithGitBaseline', (_event, value?: string, options?: Record<string, unknown>) =>
    desktop.storyPages.initializeOriginalStoryProjectWithGitBaseline(workflowRoot, value, options));
  ipc.handle('storyPages:sync', (_event, value?: string) => desktop.storyPages.syncStoryProject(project(value)));
  ipc.handle('storyPages:inspectEvent', (_event, mapId: number, eventId: number, value?: string) =>
    desktop.storyPages.inspectStoryEventForEditor(workflowRoot, project(value), mapId, eventId));
  ipc.handle('storyPages:changeOrigin', (_event, pageNodeId: string, origin: string, value?: string) =>
    desktop.storyPages.changeStoryPageOrigin(project(value), pageNodeId, origin));

  ipc.handle('storyOutline:get', (_event, value?: string) => desktop.outline.getStoryOutline(workflowRoot, project(value)));
  ipc.handle('storyOutline:set', (_event, payload: Record<string, unknown>, value?: string) => desktop.outline.upsertStoryOutline(workflowRoot, project(value), payload));
}

export function cleanupMapIpcHandlers(ipc: IpcRegistrar): void {
  for (const channel of MAP_IPC_CHANNELS) ipc.removeHandler(channel);
}
