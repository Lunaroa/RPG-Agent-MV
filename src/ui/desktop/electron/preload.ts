import type {
  EventSearchOptions,
  MapOverviewPngExportProgressEvent,
  MapOverviewPngExportScene,
  MapOverviewScanProgressEvent,
} from '../../../contract/types.ts';

const { contextBridge, ipcRenderer } = require('electron');

// 暴露 IPC API 给渲染层（由 vite-plugin-electron 构建为 dist-electron/preload.js）
contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    openExternalUrl: (url: string) => ipcRenderer.invoke('window:openExternalUrl', url),
  },

  documentation: {
    open: (language: string) => ipcRenderer.invoke('documentation:open', language),
    bootstrap: (language: string, preferredPath?: string) => ipcRenderer.invoke('documentation:bootstrap', language, preferredPath),
    navigation: () => ipcRenderer.invoke('documentation:navigation'),
    read: (relativePath: string) => ipcRenderer.invoke('documentation:read', relativePath),
    onSetLanguage: (callback: (language: string) => void) => {
      const handler = (_event: unknown, language: string) => callback(language);
      ipcRenderer.on('documentation:setLanguage', handler);
      return () => ipcRenderer.removeListener('documentation:setLanguage', handler);
    },
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  },

  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
  },

  uiControl: {
    onCommand: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('ui-control:command', handler);
      return () => ipcRenderer.removeListener('ui-control:command', handler);
    },
    sendResult: (payload: unknown) => ipcRenderer.send('ui-control:renderer-result', payload),
  },

  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    refresh: () => ipcRenderer.invoke('projects:refresh'),
    add: (projectPath: string, options?: unknown) => ipcRenderer.invoke('projects:add', projectPath, options),
    browseAndAdd: (options?: unknown) => ipcRenderer.invoke('projects:browseAndAdd', options),
    remove: (projectPath: string) => ipcRenderer.invoke('projects:remove', projectPath),
    initializeGitBaseline: (project?: string, options?: unknown) =>
      ipcRenderer.invoke('projects:initializeGitBaseline', project, options),
    saveProjectVersion: (project?: string, options?: unknown) =>
      ipcRenderer.invoke('projects:saveProjectVersion', project, options),
    openFolder: (project?: string) => ipcRenderer.invoke('projects:openFolder', project),
  },

  workspace: {
    get: () => ipcRenderer.invoke('workspace:get'),
    put: (body: unknown) => ipcRenderer.invoke('workspace:put', body),
    patch: (body: unknown) => ipcRenderer.invoke('workspace:patch', body),
  },

  workspaceSurfaces: {
    validate: (request: unknown, project?: string) => ipcRenderer.invoke('workspaceSurfaces:validate', request, project),
  },

  bootstrap: {
    get: () => ipcRenderer.invoke('bootstrap:get'),
  },

  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    get: (id: string) => ipcRenderer.invoke('sessions:get', id),
    create: (payload: unknown) => ipcRenderer.invoke('sessions:create', payload),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    deleteMany: (ids: string[]) => ipcRenderer.invoke('sessions:deleteMany', ids),
    stop: (id: string) => ipcRenderer.invoke('sessions:stop', id),
    history: (id: string) => ipcRenderer.invoke('sessions:history', id),
    saveChatLog: (id: string, data: unknown) => ipcRenderer.invoke('sessions:saveChatLog', id, data),
    submitAskResult: (sessionId: string, askId: string, result: unknown) =>
      ipcRenderer.invoke('sessions:submitAskResult', sessionId, askId, result),
    listTasks: (sessionId: string) => ipcRenderer.invoke('sessions:listTasks', sessionId),
    updateTask: (sessionId: string, taskId: string, patch: unknown) =>
      ipcRenderer.invoke('sessions:updateTask', sessionId, taskId, patch),
    getPlan: (sessionId: string) => ipcRenderer.invoke('sessions:getPlan', sessionId),
    listSubagents: (sessionId: string) => ipcRenderer.invoke('sessions:listSubagents', sessionId),
    stopSubagent: (sessionId: string, taskId: string) =>
      ipcRenderer.invoke('sessions:stopSubagent', sessionId, taskId),
    preview: (payload: unknown) => ipcRenderer.invoke('sessions:preview', payload),
    listSlashCommands: () => ipcRenderer.invoke('sessions:listSlashCommands'),
    getContextUsage: (sessionId: string) => ipcRenderer.invoke('sessions:getContextUsage', sessionId),
    slashCommand: (sessionId: string, command: string, args?: string) =>
      ipcRenderer.invoke('sessions:slashCommand', sessionId, command, args),
    revealArtifacts: (sessionId: string) => ipcRenderer.invoke('sessions:revealArtifacts', sessionId),
    subscribe: (sessionId: string, lastSequence?: number) =>
      ipcRenderer.invoke('sessions:subscribe', sessionId, lastSequence),
    unsubscribe: (sessionId: string) => ipcRenderer.invoke('sessions:unsubscribe', sessionId),
    onEvent: (callback: (data: unknown) => void) => {
      const handler = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('sessions:event', handler);
      return () => ipcRenderer.removeListener('sessions:event', handler);
    },
  },

  maps: {
    tree: (project?: string) => ipcRenderer.invoke('maps:tree', project),
    tilesets: (project?: string) => ipcRenderer.invoke('maps:tilesets', project),
    get: (mapId: number, project?: string) => ipcRenderer.invoke('maps:get', mapId, project),
    overview: (project?: string, sessionId?: string) => ipcRenderer.invoke('maps:overview', project, sessionId),
    onOverviewProgress: (callback: (progress: MapOverviewScanProgressEvent) => void) => {
      const handler = (_event: unknown, progress: MapOverviewScanProgressEvent) => callback(progress);
      ipcRenderer.on('maps:overviewProgress', handler);
      return () => ipcRenderer.removeListener('maps:overviewProgress', handler);
    },
    overviewThumbnail: (
      mapId: number,
      version: string,
      project: string | undefined,
      sessionId: string,
    ) => ipcRenderer.invoke('maps:overviewThumbnail', mapId, version, project, sessionId),
    cancelOverviewThumbnails: (sessionId: string) => ipcRenderer.invoke('maps:cancelOverviewThumbnails', sessionId),
    finalizeOverviewThumbnails: (project?: string) => ipcRenderer.invoke('maps:finalizeOverviewThumbnails', project),
    startOverviewPngExport: (scene: MapOverviewPngExportScene) => ipcRenderer.invoke('maps:overviewExportStart', scene),
    overviewPngExportStatus: () => ipcRenderer.invoke('maps:overviewExportStatus'),
    cancelOverviewPngExport: (requestId: string) => ipcRenderer.invoke('maps:overviewExportCancel', requestId),
    onOverviewPngExportProgress: (callback: (progress: MapOverviewPngExportProgressEvent) => void) => {
      const handler = (_event: unknown, progress: MapOverviewPngExportProgressEvent) => callback(progress);
      ipcRenderer.on('maps:overviewExportProgress', handler);
      return () => ipcRenderer.removeListener('maps:overviewExportProgress', handler);
    },
    create: (properties: unknown, project?: string) => ipcRenderer.invoke('maps:create', properties, project),
    importFromLibrary: (assetId: string, parentMapId: number | null, properties: unknown, project?: string) =>
      ipcRenderer.invoke('maps:importFromLibrary', assetId, parentMapId, properties, project),
    importPackageFromLibrary: (assetIds: string[], parentMapId: number | null, properties: unknown, project?: string) =>
      ipcRenderer.invoke('maps:importPackageFromLibrary', assetIds, parentMapId, properties, project),
    updateProperties: (mapId: number, properties: unknown, project?: string) =>
      ipcRenderer.invoke('maps:updateProperties', mapId, properties, project),
    reparent: (mapId: number, parentId: number, project?: string) =>
      ipcRenderer.invoke('maps:reparent', mapId, parentId, project),
    move: (mapId: number, targetMapId: number, position: 'before' | 'after' | 'inside', project?: string) =>
      ipcRenderer.invoke('maps:move', mapId, targetMapId, position, project),
    duplicate: (mapId: number, parentId: number, project?: string) =>
      ipcRenderer.invoke('maps:duplicate', mapId, parentId, project),
    remove: (mapId: number, project?: string) => ipcRenderer.invoke('maps:remove', mapId, project),
    postTiles: (mapId: number, edits: unknown[], project?: string) =>
      ipcRenderer.invoke('maps:postTiles', mapId, edits, project),
    setStartPosition: (mapId: number, x: number, y: number, project?: string) =>
      ipcRenderer.invoke('maps:setStartPosition', mapId, x, y, project),
    setSystemPosition: (target: string, mapId: number, x: number, y: number, project?: string) =>
      ipcRenderer.invoke('maps:setSystemPosition', target, mapId, x, y, project),
    playtest: (mapId: number, startX: number, startY: number, project?: string) =>
      ipcRenderer.invoke('maps:playtest', mapId, startX, startY, project),
  },

  events: {
    create: (mapId: number, event: unknown, project?: string) =>
      ipcRenderer.invoke('events:create', mapId, event, project),
    createFromPlacement: (mapId: number, payload: unknown, project?: string) =>
      ipcRenderer.invoke('events:createFromPlacement', mapId, payload, project),
    update: (mapId: number, eventId: number, event: unknown, project?: string) =>
      ipcRenderer.invoke('events:update', mapId, eventId, event, project),
    remove: (mapId: number, eventId: number, project?: string) =>
      ipcRenderer.invoke('events:remove', mapId, eventId, project),
    duplicate: (mapId: number, eventId: number, project?: string) =>
      ipcRenderer.invoke('events:duplicate', mapId, eventId, project),
    search: (query: string, project?: string, options?: EventSearchOptions) =>
      ipcRenderer.invoke('events:search', query, project, options),
  },

  eventRegistry: {
    contracts: (project?: string, filters?: unknown) =>
      ipcRenderer.invoke('eventRegistry:contracts', project, filters),
    showContract: (project: string | undefined, contractId: string) =>
      ipcRenderer.invoke('eventRegistry:showContract', contractId, project),
    script: (project: string | undefined, contractId: string) =>
      ipcRenderer.invoke('eventRegistry:script', contractId, project),
    reject: (project: string | undefined, idOrRid: string | number, options?: unknown) =>
      ipcRenderer.invoke('eventRegistry:reject', idOrRid, project, options),
    approve: (project: string | undefined, idOrRid: string | number, options?: unknown) =>
      ipcRenderer.invoke('eventRegistry:approve', idOrRid, project, options),
    unreject: (project: string | undefined, idOrRid: string | number, options?: unknown) =>
      ipcRenderer.invoke('eventRegistry:unreject', idOrRid, project, options),
  },

  projectAssets: {
    editorCatalog: (project?: string) => ipcRenderer.invoke('projectAssets:editorCatalog', project),
    listRelativeDirectory: (relativeDirectory: string, project?: string, recursive?: boolean) =>
      ipcRenderer.invoke('projectAssets:listRelativeDirectory', relativeDirectory, project, recursive),
    detail: (target: unknown, project?: string) => ipcRenderer.invoke('projectAssets:detail', target, project),
    rename: (target: unknown, nextName: string, project?: string) => ipcRenderer.invoke('projectAssets:rename', target, nextName, project),
    remove: (target: unknown, project?: string) => ipcRenderer.invoke('projectAssets:remove', target, project),
    referenceGraph: (project?: string) => ipcRenderer.invoke('projectAssets:referenceGraph', project),
    checkRenameSafety: (target: unknown, nextName: string, project?: string) =>
      ipcRenderer.invoke('projectAssets:checkRenameSafety', target, nextName, project),
    checkDeleteSafety: (target: unknown, project?: string) => ipcRenderer.invoke('projectAssets:checkDeleteSafety', target, project),
    replaceMissingReference: (request: unknown, project?: string) =>
      ipcRenderer.invoke('projectAssets:replaceMissingReference', request, project),
    importLocalFile: (request: unknown, project?: string) =>
      ipcRenderer.invoke('projectAssets:importLocalFile', request, project),
    selectImportFile: (category: string) => ipcRenderer.invoke('projectAssets:selectImportFile', category),
  },

  projectManagement: {
    overview: (project?: string) => ipcRenderer.invoke('projectManagement:overview', project),
    getEntry: (request: unknown, project?: string) => ipcRenderer.invoke('projectManagement:getEntry', request, project),
    updateEntry: (request: unknown, project?: string) => ipcRenderer.invoke('projectManagement:updateEntry', request, project),
    createEntry: (request: unknown, project?: string) => ipcRenderer.invoke('projectManagement:createEntry', request, project),
    resizeDatabase: (request: unknown, project?: string) => ipcRenderer.invoke('projectManagement:resizeDatabase', request, project),
    resetEntry: (request: unknown, project?: string) => ipcRenderer.invoke('projectManagement:resetEntry', request, project),
    revertEntry: (request: unknown, project?: string) => ipcRenderer.invoke('projectManagement:revertEntry', request, project),
  },

  playtest: {
    start: (request: unknown) => ipcRenderer.invoke('playtest:start', request),
    current: () => ipcRenderer.invoke('playtest:current'),
    runtimeInfo: (request: unknown) => ipcRenderer.invoke('playtest:runtimeInfo', request),
    stop: () => ipcRenderer.invoke('playtest:stop'),
    reveal: (runId: string) => ipcRenderer.invoke('playtest:reveal', runId),
    selectRuntime: (request: unknown) => ipcRenderer.invoke('playtest:selectRuntime', request),
    onStatus: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('playtest:status', handler);
      return () => ipcRenderer.removeListener('playtest:status', handler);
    },
  },

  mapPreview: {
    start: (request: unknown) => ipcRenderer.invoke('mapPreview:start', request),
    current: () => ipcRenderer.invoke('mapPreview:current'),
    stop: () => ipcRenderer.invoke('mapPreview:stop'),
    suspend: () => ipcRenderer.invoke('mapPreview:suspend'),
    resume: (request: unknown) => ipcRenderer.invoke('mapPreview:resume', request),
    selectMap: (request: unknown) => ipcRenderer.invoke('mapPreview:selectMap', request),
    panCamera: (request: unknown) => ipcRenderer.invoke('mapPreview:panCamera', request),
    setSwitch: (request: unknown) => ipcRenderer.invoke('mapPreview:setSwitch', request),
    setVariable: (request: unknown) => ipcRenderer.invoke('mapPreview:setVariable', request),
    setSelfSwitch: (request: unknown) => ipcRenderer.invoke('mapPreview:setSelfSwitch', request),
    evaluate: (request: unknown) => ipcRenderer.invoke('mapPreview:evaluate', request),
    resetOverrides: () => ipcRenderer.invoke('mapPreview:resetOverrides'),
    replaceOverrides: (request: unknown) => ipcRenderer.invoke('mapPreview:replaceOverrides', request),
    setEventExecution: (request: unknown) => ipcRenderer.invoke('mapPreview:setEventExecution', request),
    sendInput: (request: unknown) => ipcRenderer.invoke('mapPreview:sendInput', request),
    ackFrame: (request: unknown) => ipcRenderer.invoke('mapPreview:ackFrame', request),
    setView: (request: unknown) => ipcRenderer.invoke('mapPreview:setView', request),
    runtimeEvent: (request: unknown) => ipcRenderer.invoke('mapPreview:runtimeEvent', request),
    onStatus: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('mapPreview:status', handler);
      return () => ipcRenderer.removeListener('mapPreview:status', handler);
    },
    onFrame: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('mapPreview:frame', handler);
      return () => ipcRenderer.removeListener('mapPreview:frame', handler);
    },
    onRuntimeCommand: (callback: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on('mapPreview:runtimeCommand', handler);
      return () => ipcRenderer.removeListener('mapPreview:runtimeCommand', handler);
    },
  },

  commonEvents: {
    list: (project?: string) => ipcRenderer.invoke('commonEvents:list', project),
    get: (id: number, project?: string) => ipcRenderer.invoke('commonEvents:get', id, project),
    create: (request: unknown, project?: string) => ipcRenderer.invoke('commonEvents:create', request, project),
    update: (id: number, value: unknown, project?: string) => ipcRenderer.invoke('commonEvents:update', id, value, project),
    delete: (id: number, options?: unknown, project?: string) => ipcRenderer.invoke('commonEvents:delete', id, options, project),
    duplicate: (id: number, options?: unknown, project?: string) => ipcRenderer.invoke('commonEvents:duplicate', id, options, project),
    rename: (id: number, name: string, project?: string) => ipcRenderer.invoke('commonEvents:rename', id, name, project),
    changeTrigger: (id: number, trigger: number, switchId?: number, project?: string) =>
      ipcRenderer.invoke('commonEvents:changeTrigger', id, trigger, switchId, project),
    editCommandList: (id: number, list: unknown[], project?: string) =>
      ipcRenderer.invoke('commonEvents:editCommandList', id, list, project),
    references: (id: number, project?: string) => ipcRenderer.invoke('commonEvents:references', id, project),
  },

  plugins: {
    read: (project?: string) => ipcRenderer.invoke('plugins:read', project),
    readEntry: (pluginIndex: number, project?: string) => ipcRenderer.invoke('plugins:readEntry', pluginIndex, project),
    validate: (project?: string) => ipcRenderer.invoke('plugins:validate', project),
    writeConfiguration: (entries: unknown[], project?: string) => ipcRenderer.invoke('plugins:writeConfiguration', entries, project),
    addConfiguration: (pluginName: string, project?: string) => ipcRenderer.invoke('plugins:addConfiguration', pluginName, project),
    removeConfiguration: (pluginIndex: number, project?: string) => ipcRenderer.invoke('plugins:removeConfiguration', pluginIndex, project),
    setEnabled: (pluginIndex: number, enabled: boolean, project?: string) => ipcRenderer.invoke('plugins:setEnabled', pluginIndex, enabled, project),
    reorder: (pluginIndexes: number[], project?: string) => ipcRenderer.invoke('plugins:reorder', pluginIndexes, project),
    updateParameters: (pluginIndex: number, parameters: Record<string, unknown>, project?: string) =>
      ipcRenderer.invoke('plugins:updateParameters', pluginIndex, parameters, project),
    installFile: (sourceFile: string, options?: unknown, project?: string) =>
      ipcRenderer.invoke('plugins:installFile', sourceFile, options, project),
    installDirectory: (sourceDirectory: string, options?: unknown, project?: string) =>
      ipcRenderer.invoke('plugins:installDirectory', sourceDirectory, options, project),
    selectInstallFile: () => ipcRenderer.invoke('plugins:selectInstallFile'),
    selectInstallDirectory: () => ipcRenderer.invoke('plugins:selectInstallDirectory'),
    deleteFile: (pluginName: string, options?: unknown, project?: string) =>
      ipcRenderer.invoke('plugins:deleteFile', pluginName, options, project),
  },

  assetLibrary: {
    catalog: () => ipcRenderer.invoke('assetLibrary:catalog'),
    detail: (assetId: string) => ipcRenderer.invoke('assetLibrary:detail', assetId),
    validateImport: (assetId: string, project?: string) => ipcRenderer.invoke('assetLibrary:validateImport', assetId, project),
    import: (assetId: string, project?: string) => ipcRenderer.invoke('assetLibrary:import', assetId, project),
  },

  settings: {
    listProviders: () => ipcRenderer.invoke('settings:listProviders'),
    getProvider: (id: string) => ipcRenderer.invoke('settings:getProvider', id),
    upsertProvider: (id: string, body: unknown) => ipcRenderer.invoke('settings:upsertProvider', id, body),
    deleteProvider: (id: string) => ipcRenderer.invoke('settings:deleteProvider', id),
    testProvider: (id: string, overrides?: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:testProvider', id, overrides),
    fetchModels: (id: string, overrides?: unknown) =>
      ipcRenderer.invoke('settings:fetchModels', id, overrides),
    fetchThinkingVariants: (providerId: string, modelId: string) =>
      ipcRenderer.invoke('settings:fetchThinkingVariants', providerId, modelId),
    getUi: () => ipcRenderer.invoke('settings:getUi'),
    putUi: (body: unknown) => ipcRenderer.invoke('settings:putUi', body),
    getPermissions: () => ipcRenderer.invoke('settings:getPermissions'),
    putPermissions: (body: unknown) => ipcRenderer.invoke('settings:putPermissions', body),
    getAgentExecution: () => ipcRenderer.invoke('settings:getAgentExecution'),
    putAgentExecution: (body: unknown) => ipcRenderer.invoke('settings:putAgentExecution', body),
    probeAgentExecution: (body?: unknown) => ipcRenderer.invoke('settings:probeAgentExecution', body),
    activateInvocation: (body: unknown) => ipcRenderer.invoke('settings:activateInvocation', body),
    listCompatibleProviders: (engine?: string) =>
      ipcRenderer.invoke('settings:listCompatibleProviders', engine),
    syncProviderSeeds: () => ipcRenderer.invoke('settings:syncProviderSeeds'),
    getAgentCapabilities: () =>
      ipcRenderer.invoke('settings:getAgentCapabilities'),
    putAgentToolAllow: (body: { toolId: string; allowed: boolean }) =>
      ipcRenderer.invoke('settings:putAgentToolAllow', body),
    putMcpServerEnabled: (body: { serverId: string; enabled: boolean }) =>
      ipcRenderer.invoke('settings:putMcpServerEnabled', body),
    putAgentSkillEnabled: (body: { skillPath: string; enabled: boolean }) =>
      ipcRenderer.invoke('settings:putAgentSkillEnabled', body),
    createSkill: (payload: unknown) => ipcRenderer.invoke('settings:createSkill', payload),
    openCapabilityPath: (filePath: string) => ipcRenderer.invoke('settings:openCapabilityPath', filePath),
  },

  memory: {
    listProject: (projectId: string) => ipcRenderer.invoke('memory:listProject', projectId),
    getOverview: (projectId: string) => ipcRenderer.invoke('memory:getOverview', projectId),
    listActivity: (projectId: string, limit?: number) => ipcRenderer.invoke('memory:listActivity', { projectId, limit }),
    readFile: (projectId: string, relPath: string) => ipcRenderer.invoke('memory:readFile', { projectId, relPath }),
    clearProject: (projectId: string) => ipcRenderer.invoke('memory:clearProject', projectId),
    reindexProject: (projectId: string) => ipcRenderer.invoke('memory:reindexProject', projectId),
    openFolder: (projectId: string) => ipcRenderer.invoke('memory:openFolder', projectId),
    readUserProfile: () => ipcRenderer.invoke('memory:readUserProfile'),
    writeUserProfile: (content: string) => ipcRenderer.invoke('memory:writeUserProfile', { content }),
    getSettings: () => ipcRenderer.invoke('memory:getSettings'),
    setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('memory:setSettings', patch),
  },

  staging: {
    projectStatus: (project?: string) => ipcRenderer.invoke('staging:projectStatus', project),
    applyProject: (project?: string, expectedOperationIds?: string[]) =>
      ipcRenderer.invoke('staging:applyProject', project, expectedOperationIds),
    discardProject: (project?: string) => ipcRenderer.invoke('staging:discardProject', project),
    mapStatus: (mapId: number, project?: string) => ipcRenderer.invoke('staging:mapStatus', mapId, project),
    applyMap: (mapId: number, project?: string) => ipcRenderer.invoke('staging:applyMap', mapId, project),
    discardMap: (mapId: number, project?: string) => ipcRenderer.invoke('staging:discardMap', mapId, project),
  },

  placementQueue: {
    get: (project?: string) => ipcRenderer.invoke('placementQueue:get', project),
    save: (session: unknown, project?: string) => ipcRenderer.invoke('placementQueue:save', session, project),
    clear: (project?: string) => ipcRenderer.invoke('placementQueue:clear', project),
  },

  mapLibrary: {
    list: () => ipcRenderer.invoke('mapLibrary:list'),
    getSelection: () => ipcRenderer.invoke('mapLibrary:getSelection'),
    writeSelection: (body: unknown) => ipcRenderer.invoke('mapLibrary:writeSelection', body),
    validatePackage: (assetIds: string[]) => ipcRenderer.invoke('mapLibrary:validatePackage', assetIds),
  },

  storyPages: {
    profile: (project?: string) => ipcRenderer.invoke('storyPages:profile', project),
    initializeOriginal: (project?: string) => ipcRenderer.invoke('storyPages:initializeOriginal', project),
    initializeOriginalWithGitBaseline: (project?: string, options?: unknown) =>
      ipcRenderer.invoke('storyPages:initializeOriginalWithGitBaseline', project, options),
    sync: (project?: string) => ipcRenderer.invoke('storyPages:sync', project),
    inspectEvent: (mapId: number, eventId: number, project?: string) =>
      ipcRenderer.invoke('storyPages:inspectEvent', mapId, eventId, project),
    changeOrigin: (pageNodeId: string, origin: string, project?: string) =>
      ipcRenderer.invoke('storyPages:changeOrigin', pageNodeId, origin, project),
  },

  storyOutline: {
    get: (project?: string) => ipcRenderer.invoke('storyOutline:get', project),
    set: (payload: unknown, project?: string) => ipcRenderer.invoke('storyOutline:set', payload, project),
  },

  workflow: {
    listProposals: (status?: string) => ipcRenderer.invoke('workflow:listProposals', status),
    getProposal: (proposalId: string) => ipcRenderer.invoke('workflow:getProposal', proposalId),
    approveProposal: (proposalId: string) => ipcRenderer.invoke('workflow:approveProposal', proposalId),
    rejectProposal: (proposalId: string, reason?: string) =>
      ipcRenderer.invoke('workflow:rejectProposal', proposalId, reason),
    getScript: (proposalId: string) => ipcRenderer.invoke('workflow:getScript', proposalId),
    getReport: (proposalId: string) => ipcRenderer.invoke('workflow:getReport', proposalId),
  },
});

contextBridge.exposeInMainWorld('backend', {
  getPort: () => Promise.resolve(null),
  getToken: () => Promise.resolve(null),
});
