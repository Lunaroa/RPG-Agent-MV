import path from 'node:path';
import { normalizeProductLanguage, type ProductLanguage } from '../../../contract/i18n.ts';
import type { EventSearchOptions } from '../../../contract/types.ts';
import { electronText } from './electronLocalization.ts';
import { invokeDesktop } from './ipc-desktop-error.ts';

export interface IpcRegistrar {
  handle(channel: string, listener: (...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface ProjectIpcOptions {
  selectProjectDirectory?: (event: unknown) => Promise<string | null>;
  selectPluginFile?: (event: unknown) => Promise<string | null>;
  selectAssetFile?: (event: unknown, category: string, extensions: string[]) => Promise<string | null>;
  productLanguage?: () => ProductLanguage;
  withProductLanguage: <T>(language: ProductLanguage, fn: () => T) => T;
  shouldSuppressProjectCompatibilityWarnings?: () => boolean;
  suppressProjectCompatibilityWarnings?: () => void;
  confirmProjectCompatibility?: (
    event: unknown,
    warning: {
      detectedVersion: string;
      supportedVersion: string;
      versionMismatch: boolean;
      encryptedResources: boolean;
      encryptedImages: boolean;
      encryptedAudio: boolean;
    },
    action: 'import' | 'write',
  ) => Promise<{ confirmed: boolean; suppressFutureWarnings: boolean }>;
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
  'maps:move',
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
  'events:search',
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
  'projectAssets:selectImportFile',
  'projectManagement:overview',
  'projectManagement:getEntry',
  'projectManagement:updateEntry',
  'projectManagement:createEntry',
  'projectManagement:resizeDatabase',
  'projectManagement:resetEntry',
  'projectManagement:revertEntry',
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
  'plugins:selectInstallFile',
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
  options: ProjectIpcOptions,
): void {
  const project = (value?: string) => desktop.project.resolveProjectPath(workflowRoot, value);
  const runInLanguage = <T>(fn: () => T): T =>
    options.withProductLanguage(normalizeProductLanguage(options.productLanguage?.()), fn);
  const handle = (channel: string, listener: (...args: any[]) => unknown) => {
    ipc.handle(channel, (...args) => runInLanguage(() => listener(...args)));
  };

  const confirmProjectCompatibility = async (
    event: unknown,
    projectPath: string,
    action: 'import' | 'write',
  ): Promise<boolean> => {
    const warning = desktop.project.getProjectCompatibilityWarning(projectPath);
    const relevantWarning = action === 'import'
      ? warning
      : warning?.versionMismatch ? warning : null;
    if (!relevantWarning || options.shouldSuppressProjectCompatibilityWarnings?.()) return true;
    if (!options.confirmProjectCompatibility) {
      throw new Error('RPG Maker project compatibility confirmation is unavailable.');
    }
    const result = await options.confirmProjectCompatibility(event, relevantWarning, action);
    if (result.confirmed && result.suppressFutureWarnings) {
      options.suppressProjectCompatibilityWarnings?.();
    }
    return result.confirmed;
  };

  handle('projects:list', () => desktop.project.listProjects(workflowRoot));
  handle('projects:refresh', () => desktop.project.refreshProjects(workflowRoot));
  handle('projects:add', async (event, projectPath: string, addOptions?: Record<string, unknown>) => {
    if (!await confirmProjectCompatibility(event, projectPath, 'import')) {
      return { canceled: true, project: null, projects: desktop.project.listProjects(workflowRoot) };
    }
    return {
      canceled: false,
      project: desktop.project.registerExternalProject(workflowRoot, projectPath, addOptions || {}),
      projects: desktop.project.listProjects(workflowRoot),
    };
  });
  handle('projects:browseAndAdd', async (event, addOptions?: Record<string, unknown>) => {
    if (!options.selectProjectDirectory) {
      throw new Error(electronText(options.productLanguage?.(), 'projects.selectDirectoryUnsupported'));
    }
    const selectedPath = await options.selectProjectDirectory(event);
    if (!selectedPath) {
      return {
        canceled: true,
        project: null,
        projects: desktop.project.listProjects(workflowRoot),
      };
    }
    if (!await confirmProjectCompatibility(event, selectedPath, 'import')) {
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
  handle('projects:remove', (_event, projectPath: string) => ({
    projects: desktop.project.removeRegisteredProject(workflowRoot, projectPath),
  }));
  handle('projects:initializeGitBaseline', (_event, value?: string, options?: Record<string, unknown>) =>
    desktop.project.initializeProjectGitBaseline(workflowRoot, value, options));
  handle('projects:saveProjectVersion', (_event, value?: string, options?: Record<string, unknown>) =>
    desktop.project.saveProjectVersion(workflowRoot, value, options));
  handle('maps:tree', (_event, value?: string) => desktop.maps.buildMapIndex(workflowRoot, project(value)));
  handle('maps:tilesets', (_event, value?: string) => desktop.maps.buildTilesetIndex(workflowRoot, project(value)));
  handle('maps:get', (_event, mapId: number, value?: string) =>
    desktop.maps.buildMapPayload(workflowRoot, project(value), mapId));
  handle('maps:create', (_event, properties: Record<string, unknown>, value?: string) => desktop.maps.createMapDraft(workflowRoot, project(value), properties));
  handle('maps:importFromLibrary', (_event, assetId: string, parentMapId?: number | null, properties?: Record<string, unknown>, value?: string) => desktop.maps.importMapDraftFromLibrary(workflowRoot, project(value), assetId, { ...(properties || {}), parentId: parentMapId || 0 }));
  handle('maps:importPackageFromLibrary', (_event, assetIds: string[], parentMapId?: number | null, properties?: Record<string, unknown>, value?: string) =>
    desktop.maps.importMapPackageFromLibrary(workflowRoot, project(value), assetIds, parentMapId || 0, properties || {}));
  handle('maps:updateProperties', (_event, mapId: number, properties: Record<string, unknown>, value?: string) => desktop.maps.updateMapPropertiesDraft(workflowRoot, project(value), mapId, properties));
  handle('maps:reparent', (_event, mapId: number, parentId: number, value?: string) => desktop.maps.reparentMapDraft(workflowRoot, project(value), mapId, parentId));
  handle('maps:move', (_event, mapId: number, targetMapId: number, position: 'before' | 'after' | 'inside', value?: string) =>
    desktop.maps.moveMapDraft(workflowRoot, project(value), mapId, targetMapId, position));
  handle('maps:duplicate', (_event, mapId: number, parentId: number, value?: string) => desktop.maps.duplicateMapDraft(workflowRoot, project(value), mapId, parentId));
  handle('maps:remove', (_event, mapId: number, value?: string) => desktop.maps.deleteMapDraft(workflowRoot, project(value), mapId));
  handle('maps:postTiles', (_event, mapId: number, edits: unknown[], value?: string) => desktop.maps.postMapTiles(workflowRoot, project(value), mapId, edits));
  handle('maps:setStartPosition', (_event, mapId: number, x: number, y: number, value?: string) =>
    desktop.maps.setStartPositionDraft(workflowRoot, project(value), mapId, x, y));
  handle('maps:setSystemPosition', (_event, target: string, mapId: number, x: number, y: number, value?: string) =>
    desktop.maps.setSystemPositionDraft(workflowRoot, project(value), target, mapId, x, y));
  handle('maps:playtest', (_event, mapId: number, startX?: number, startY?: number, value?: string) => desktop.maps.createPlaytestArtifact(workflowRoot, project(value), mapId, startX, startY));

  handle('events:create', (_event, mapId: number, event: Record<string, unknown>, value?: string) =>
    invokeDesktop(() => desktop.events.createEvent(workflowRoot, project(value), mapId, event)));
  handle('events:createFromPlacement', (_event, mapId: number, payload: Record<string, unknown>, value?: string) =>
    invokeDesktop(() => desktop.events.createPlacementEvent(workflowRoot, project(value), mapId, payload)));
  handle('events:update', (_event, mapId: number, eventId: number, event: Record<string, unknown>, value?: string) =>
    invokeDesktop(() => desktop.events.updateEvent(workflowRoot, project(value), mapId, eventId, event)));
  handle('events:remove', (_event, mapId: number, eventId: number, value?: string) =>
    invokeDesktop(() => desktop.events.removeEvent(workflowRoot, project(value), mapId, eventId)));
  handle('events:duplicate', (_event, mapId: number, eventId: number, value?: string) =>
    invokeDesktop(() => desktop.events.duplicateEvent(workflowRoot, project(value), mapId, eventId)));
  handle('events:search', (_event, query: string, value?: string, options?: EventSearchOptions) =>
    invokeDesktop(() => desktop.maps.searchProjectEvents(workflowRoot, project(value), query, options)));
  const registryOptions = (relProject?: string) => ({
    runtimeRoot: path.join(workflowRoot, 'runtime'),
    projectPath: project(relProject),
  });
  handle('eventRegistry:contracts', (_event, relProject?: string, filters?: Record<string, unknown>) =>
    desktop.eventRegistry.listContracts(registryOptions(relProject).projectPath, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      ...(filters || {}),
    }));
  handle('eventRegistry:showContract', (_event, contractId: string, relProject?: string) =>
    desktop.eventRegistry.showContract(registryOptions(relProject).projectPath, contractId, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
    }));
  // Preview before placement by rendering the registry contract through the same normalization path as compilation.
  handle('eventRegistry:script', (_event, contractId: string) =>
    desktop.eventScript.getEventScript(contractId));
  // Reject or abandon a contract when the player does not accept placement.
  handle('eventRegistry:reject', (_event, idOrRid: string | number, relProject?: string, rejectOptions?: Record<string, unknown>) =>
    desktop.eventRegistry.rejectContract(registryOptions(relProject).projectPath, idOrRid, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      abandon: Boolean(rejectOptions?.abandon),
      reason: typeof rejectOptions?.reason === 'string' ? rejectOptions.reason : undefined,
    }));
  // Approve a reviewing contract into the placement queue.
  handle('eventRegistry:approve', (_event, idOrRid: string | number, relProject?: string, approveOptions?: Record<string, unknown>) =>
    desktop.eventRegistry.approveContract(registryOptions(relProject).projectPath, idOrRid, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      note: typeof approveOptions?.note === 'string' ? approveOptions.note : undefined,
    }));
  // Undo a rejection and restore the contract to a placeable state.
  handle('eventRegistry:unreject', (_event, idOrRid: string | number, relProject?: string, unrejectOptions?: Record<string, unknown>) =>
    desktop.eventRegistry.unrejectContract(registryOptions(relProject).projectPath, idOrRid, {
      runtimeRoot: registryOptions(relProject).runtimeRoot,
      status: typeof unrejectOptions?.status === 'string' ? unrejectOptions.status : undefined,
    }));
  handle('projectAssets:editorCatalog', (_event, value?: string) => desktop.catalog.buildEditorProjectCatalog(workflowRoot, project(value)));
  handle('projectAssets:detail', (_event, target: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.getAssetDetail(workflowRoot, project(value), target));
  handle('projectAssets:rename', (_event, target: Record<string, unknown>, nextName: string, value?: string) =>
    desktop.assetManagement.renameAsset(workflowRoot, project(value), target, nextName));
  handle('projectAssets:remove', (_event, target: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.deleteAsset(workflowRoot, project(value), target));
  handle('projectAssets:referenceGraph', (_event, value?: string) =>
    desktop.assetManagement.buildProjectAssetReferenceGraph(workflowRoot, project(value)));
  handle('projectAssets:checkRenameSafety', (_event, target: Record<string, unknown>, nextName: string, value?: string) =>
    desktop.assetManagement.checkProjectAssetRenameSafety(workflowRoot, project(value), target, nextName));
  handle('projectAssets:checkDeleteSafety', (_event, target: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.checkProjectAssetDeleteSafety(workflowRoot, project(value), target));
  handle('projectAssets:replaceMissingReference', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.replaceMissingAssetReference(workflowRoot, project(value), request));
  handle('projectAssets:importLocalFile', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.assetManagement.importLocalAssetFile(workflowRoot, project(value), request));
  handle('projectAssets:selectImportFile', async (event, category: string) => {
    if (!options.selectAssetFile) throw new Error(electronText(options.productLanguage?.(), 'assets.selectFileUnsupported'));
    const extensions = desktop.assetManagement.getAssetImportFileExtensions(category);
    return options.selectAssetFile(event, category, extensions);
  });
  handle('projectManagement:overview', (_event, value?: string) => {
    const resolved = project(value);
    const scan = desktop.projectManagement.buildProjectManagementScan(workflowRoot, resolved);
    const assets = desktop.assetManagement.buildStagedAwareAssetInventory(workflowRoot, resolved);
    return { scan, assets };
  });
  handle('projectManagement:getEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.getProjectManagedEntry(workflowRoot, project(value), request));
  handle('projectManagement:updateEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.updateProjectManagedEntry(workflowRoot, project(value), request));
  handle('projectManagement:createEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.createProjectManagedEntry(workflowRoot, project(value), request));
  handle('projectManagement:resizeDatabase', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.resizeProjectManagedDatabase(workflowRoot, project(value), request));
  handle('projectManagement:resetEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.resetProjectManagedEntry(workflowRoot, project(value), request));
  handle('projectManagement:revertEntry', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.projectManagement.revertProjectManagedEntry(workflowRoot, project(value), request));

  handle('commonEvents:list', (_event, value?: string) =>
    desktop.commonEvents.listCommonEvents(workflowRoot, project(value)));
  handle('commonEvents:get', (_event, commonEventId: number, value?: string) =>
    desktop.commonEvents.getCommonEvent(workflowRoot, project(value), { id: commonEventId }));
  handle('commonEvents:create', (_event, request: Record<string, unknown>, value?: string) =>
    desktop.commonEvents.createCommonEvent(workflowRoot, project(value), request || {}));
  handle('commonEvents:update', (_event, commonEventId: number, valuePayload: unknown, value?: string) =>
    desktop.commonEvents.updateCommonEvent(workflowRoot, project(value), { id: commonEventId, value: valuePayload }));
  handle('commonEvents:delete', (_event, commonEventId: number, deleteOptions?: Record<string, unknown>, value?: string) =>
    desktop.commonEvents.deleteCommonEvent(workflowRoot, project(value), { id: commonEventId, ...(deleteOptions || {}) }));
  handle('commonEvents:duplicate', (_event, commonEventId: number, options?: Record<string, unknown>, value?: string) =>
    desktop.commonEvents.duplicateCommonEvent(workflowRoot, project(value), { id: commonEventId, ...(options || {}) }));
  handle('commonEvents:rename', (_event, commonEventId: number, name: string, value?: string) =>
    desktop.commonEvents.renameCommonEvent(workflowRoot, project(value), { id: commonEventId, name }));
  handle('commonEvents:changeTrigger', (_event, commonEventId: number, trigger: number, switchId?: number, value?: string) =>
    desktop.commonEvents.changeCommonEventTrigger(workflowRoot, project(value), { id: commonEventId, trigger, switchId }));
  handle('commonEvents:editCommandList', (_event, commonEventId: number, list: unknown[], value?: string) =>
    desktop.commonEvents.editCommonEventCommandList(workflowRoot, project(value), { id: commonEventId, list: list || [] }));
  handle('commonEvents:references', (_event, commonEventId: number, value?: string) =>
    desktop.commonEvents.findCommonEventUsages(workflowRoot, project(value), commonEventId));

  handle('plugins:read', (_event, value?: string) =>
    desktop.pluginManagement.readPluginConfiguration(workflowRoot, project(value)));
  handle('plugins:validate', (_event, value?: string) =>
    desktop.pluginManagement.validatePluginConfiguration(workflowRoot, project(value)));
  handle('plugins:writeConfiguration', (_event, entries: Array<Record<string, unknown>>, value?: string) =>
    desktop.pluginManagement.writePluginConfiguration(workflowRoot, project(value), entries || []));
  handle('plugins:setEnabled', (_event, pluginName: string, enabled: boolean, value?: string) =>
    desktop.pluginManagement.setPluginEnabled(workflowRoot, project(value), pluginName, enabled));
  handle('plugins:reorder', (_event, pluginNames: string[], value?: string) =>
    desktop.pluginManagement.reorderPlugins(workflowRoot, project(value), pluginNames || []));
  handle('plugins:updateParameters', (_event, pluginName: string, parameters: Record<string, unknown>, value?: string) =>
    desktop.pluginManagement.updatePluginParameters(workflowRoot, project(value), pluginName, parameters || {}));
  handle('plugins:installFile', (_event, sourceFile: string, options?: Record<string, unknown>, value?: string) =>
    desktop.pluginManagement.installPluginFile(workflowRoot, project(value), sourceFile, options || {}));
  handle('plugins:selectInstallFile', async (event) => {
    if (!options.selectPluginFile) throw new Error(electronText(options.productLanguage?.(), 'plugins.selectFileUnsupported'));
    return options.selectPluginFile(event);
  });
  handle('plugins:deleteFile', (_event, pluginName: string, options?: Record<string, unknown>, value?: string) =>
    desktop.pluginManagement.deletePluginFile(workflowRoot, project(value), pluginName, options || {}));

  handle('assetLibrary:catalog', () => desktop.assetLibrary.buildAssetLibraryCatalog(workflowRoot));
  handle('assetLibrary:detail', (_event, assetId: string) => desktop.assetLibrary.getAssetLibraryEntry(workflowRoot, assetId));
  handle('assetLibrary:validateImport', (_event, assetId: string, value?: string) =>
    desktop.assetLibrary.validateAssetLibraryImport(workflowRoot, project(value), assetId));
  handle('assetLibrary:import', (_event, assetId: string, value?: string) =>
    desktop.assetLibrary.importAssetLibraryEntry(workflowRoot, project(value), assetId));

  handle('staging:projectStatus', (_event, value?: string) => desktop.staging.getProjectStagingStatus(workflowRoot, project(value)));
  handle('staging:applyProject', async (event, value?: string, expectedOperationIds?: string[]) => {
    const resolved = project(value);
    if (!await confirmProjectCompatibility(event, resolved, 'write')) return { canceled: true };
    return desktop.staging.applyProjectStaging(workflowRoot, resolved, {
      expectedOperationIds: expectedOperationIds || [],
      validate: () => desktop.projectManagement.preflightProjectManagedStagingApply(workflowRoot, resolved),
    });
  });
  handle('staging:discardProject', (_event, value?: string) => desktop.staging.discardProjectStaging(workflowRoot, project(value)));
  handle('staging:mapStatus', (_event, mapId: number, value?: string) => desktop.staging.getStagingStatus(workflowRoot, project(value), mapId));
  handle('staging:applyMap', async (event, mapId: number, value?: string) => {
    const resolved = project(value);
    if (!await confirmProjectCompatibility(event, resolved, 'write')) return { canceled: true };
    return desktop.staging.applyStagedMap(workflowRoot, resolved, mapId);
  });
  handle('staging:discardMap', (_event, mapId: number, value?: string) => desktop.staging.discardStagedMap(workflowRoot, project(value), mapId));

  handle('placementQueue:get', (_event, value?: string) =>
    desktop.placementQueue.getPlacementQueueSession(workflowRoot, project(value)));
  handle('placementQueue:save', (_event, session: Record<string, unknown>, value?: string) =>
    desktop.placementQueue.savePlacementQueueSession(project(value), session));
  handle('placementQueue:clear', (_event, value?: string) => {
    desktop.placementQueue.clearPlacementQueueSession(project(value));
    return { ok: true };
  });

  handle('mapLibrary:list', () => desktop.library.listMapLibrary(workflowRoot));
  handle('mapLibrary:getSelection', () => desktop.library.getMapLibrarySelection());
  handle('mapLibrary:writeSelection', (_event, body: Record<string, unknown>) => desktop.library.writeMapLibrarySelection(workflowRoot, body));
  handle('mapLibrary:validatePackage', (_event, assetIds: string[]) => desktop.library.validateMapLibraryPackage(workflowRoot, assetIds));

  handle('storyPages:profile', (_event, value?: string) => desktop.storyPages.getStoryProjectProfile(project(value)));
  handle('storyPages:initializeOriginal', (_event, value?: string) => {
    const resolved = project(value);
    return desktop.storyPages.initializeOriginalStoryProject(resolved);
  });
  handle('storyPages:initializeOriginalWithGitBaseline', (_event, value?: string, options?: Record<string, unknown>) =>
    desktop.storyPages.initializeOriginalStoryProjectWithGitBaseline(workflowRoot, value, options));
  handle('storyPages:sync', (_event, value?: string) => desktop.storyPages.syncStoryProject(project(value)));
  handle('storyPages:inspectEvent', (_event, mapId: number, eventId: number, value?: string) =>
    desktop.storyPages.inspectStoryEventForEditor(workflowRoot, project(value), mapId, eventId));
  handle('storyPages:changeOrigin', (_event, pageNodeId: string, origin: string, value?: string) =>
    desktop.storyPages.changeStoryPageOrigin(project(value), pageNodeId, origin));

  handle('storyOutline:get', (_event, value?: string) => desktop.outline.getStoryOutline(workflowRoot, project(value)));
  handle('storyOutline:set', (_event, payload: Record<string, unknown>, value?: string) => desktop.outline.upsertStoryOutline(workflowRoot, project(value), payload));
}

export function cleanupMapIpcHandlers(ipc: IpcRegistrar): void {
  for (const channel of MAP_IPC_CHANNELS) ipc.removeHandler(channel);
}
