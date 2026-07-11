import { unsupportedAssetUrl } from './clientLocalization';
import { normalizeProductLanguage } from '../i18n/messages';
import { useSettingsStore } from '../stores/settings';

declare global {
  interface Window {
    api: {
      window: {
        minimize(): Promise<{ ok: boolean }>;
        toggleMaximize(): Promise<{ ok: boolean; maximized: boolean }>;
        close(): Promise<{ ok: boolean }>;
        isMaximized(): Promise<{ maximized: boolean }>;
        openExternalUrl(url: string): Promise<{ ok: boolean }>;
      };
      uiControl: {
        onCommand(callback: (payload: unknown) => void): () => void;
        sendResult(payload: unknown): void;
      };
      playtest: {
        start(request: InteractivePlaytestStartRequest): Promise<InteractivePlaytestResult>;
        current(): Promise<InteractivePlaytestResult>;
        stop(): Promise<InteractivePlaytestResult>;
        reveal(runId: string): Promise<{ ok: boolean }>;
        onStatus(callback: (run: InteractivePlaytestRun) => void): () => void;
      };
      projects: {
        list(): Promise<ProjectInfo[]>;
        refresh(): Promise<ProjectInfo[]>;
        add(projectPath: string, options?: { name?: string }): Promise<ProjectRegistrationResult>;
        browseAndAdd(options?: { name?: string }): Promise<ProjectRegistrationResult & { canceled?: boolean }>;
        remove(projectPath: string): Promise<ProjectRemovalResult>;
        initializeGitBaseline(project?: string, options?: { commitMessage?: string }): Promise<unknown>;
        saveProjectVersion(project?: string, options?: { commitMessage?: string }): Promise<unknown>;
      };
      workspace: {
        get(): Promise<unknown>;
        put(body: unknown): Promise<unknown>;
        patch(body: unknown): Promise<unknown>;
      };
      bootstrap: {
        get(): Promise<unknown>;
      };
      sessions: {
        list(): Promise<unknown[]>;
        get(id: string): Promise<unknown>;
        create(payload: unknown): Promise<unknown>;
        delete(id: string): Promise<{ success: boolean }>;
        stop(id: string): Promise<unknown>;
        history(id: string): Promise<unknown[]>;
        saveChatLog(id: string, data: unknown): Promise<{ success: boolean }>;
        submitAskResult(sessionId: string, askId: string, result: unknown): Promise<unknown>;
        listTasks(sessionId: string): Promise<unknown[]>;
        updateTask(sessionId: string, taskId: string, patch: unknown): Promise<unknown>;
        getPlan(sessionId: string): Promise<unknown>;
        listSubagents(sessionId: string): Promise<unknown>;
        stopSubagent(sessionId: string, taskId: string): Promise<unknown>;
        preview(payload: unknown): Promise<unknown>;
        listSlashCommands(): Promise<SlashCommandListItem[]>;
        getContextUsage(sessionId: string): Promise<GetContextUsageResult>;
        slashCommand(sessionId: string, command: string, args?: string): Promise<SlashCommandResult>;
        revealArtifacts(sessionId: string): Promise<unknown>;
        subscribe(sessionId: string, lastSequence?: number): Promise<{ sessionId: string; replayed: number }>;
        unsubscribe(sessionId: string): Promise<{ success: boolean }>;
        onEvent(callback: (data: { sessionId: string; event: unknown }) => void): () => void;
      };
      workflow: {
        listProposals(status?: string): Promise<unknown>;
        getProposal(proposalId: string): Promise<unknown>;
        approveProposal(proposalId: string): Promise<unknown>;
        rejectProposal(proposalId: string, reason?: string): Promise<unknown>;
        getScript(proposalId: string): Promise<unknown>;
        getReport(proposalId: string): Promise<unknown>;
      };
      maps: {
        tree(project?: string): Promise<unknown>;
        tilesets(project?: string): Promise<unknown>;
        get(mapId: number, project?: string): Promise<unknown>;
        create(properties: Record<string, unknown>, project?: string): Promise<unknown>;
        importFromLibrary(assetId: string, parentMapId?: number | null, properties?: Record<string, unknown>, project?: string): Promise<unknown>;
        importPackageFromLibrary(assetIds: string[], parentMapId?: number | null, properties?: Record<string, unknown>, project?: string): Promise<unknown>;
        updateProperties(mapId: number, properties: Record<string, unknown>, project?: string): Promise<unknown>;
        reparent(mapId: number, parentId: number, project?: string): Promise<unknown>;
        duplicate(mapId: number, parentId: number, project?: string): Promise<unknown>;
        remove(mapId: number, project?: string): Promise<unknown>;
        postTiles(mapId: number, edits: unknown[], project?: string): Promise<unknown>;
        setStartPosition(mapId: number, x: number, y: number, project?: string): Promise<unknown>;
        setSystemPosition(target: RmmvSystemPositionTarget, mapId: number, x: number, y: number, project?: string): Promise<unknown>;
        playtest(mapId: number, startX?: number, startY?: number, project?: string): Promise<unknown>;
      };
      events: {
        create(mapId: number, event: Record<string, unknown>, project?: string): Promise<unknown>;
        createFromPlacement(mapId: number, payload: Record<string, unknown>, project?: string): Promise<unknown>;
        update(mapId: number, eventId: number, event: Record<string, unknown>, project?: string): Promise<unknown>;
        remove(mapId: number, eventId: number, project?: string): Promise<unknown>;
        duplicate(mapId: number, eventId: number, project?: string): Promise<unknown>;
      };
      eventRegistry: {
        contracts(project?: string, filters?: Record<string, unknown>): Promise<unknown>;
        showContract(project: string | undefined, contractId: string): Promise<unknown>;
        script(project: string | undefined, contractId: string): Promise<unknown>;
        reject(project: string | undefined, idOrRid: string | number, options?: unknown): Promise<unknown>;
        approve(project: string | undefined, idOrRid: string | number, options?: unknown): Promise<unknown>;
        unreject(project: string | undefined, idOrRid: string | number, options?: unknown): Promise<unknown>;
      };
      projectAssets: {
        editorCatalog(project?: string): Promise<unknown>;
        detail(target: unknown, project?: string): Promise<unknown>;
        rename(target: unknown, nextName: string, project?: string): Promise<unknown>;
        remove(target: unknown, project?: string): Promise<unknown>;
        referenceGraph(project?: string): Promise<unknown>;
        checkRenameSafety(target: unknown, nextName: string, project?: string): Promise<unknown>;
        checkDeleteSafety(target: unknown, project?: string): Promise<unknown>;
        replaceMissingReference(request: unknown, project?: string): Promise<unknown>;
        importLocalFile(request: unknown, project?: string): Promise<unknown>;
        selectImportFile(category: string): Promise<string | null>;
      };
      settings: {
        listProviders(): Promise<{ providers: unknown[] }>;
        getProvider(id: string): Promise<unknown>;
        upsertProvider(id: string, body: unknown): Promise<unknown>;
        deleteProvider(id: string): Promise<unknown>;
        testProvider(id: string, overrides?: Record<string, unknown>): Promise<unknown>;
        fetchModels(id: string, overrides?: unknown): Promise<unknown>;
        fetchThinkingVariants(providerId: string, modelId: string): Promise<unknown>;
        getUi(): Promise<unknown>;
        putUi(body: unknown): Promise<unknown>;
        getPermissions(): Promise<unknown>;
        putPermissions(body: unknown): Promise<unknown>;
        getAgentExecution(): Promise<unknown>;
        putAgentExecution(body: unknown): Promise<unknown>;
        probeAgentExecution(body?: unknown): Promise<unknown>;
        activateInvocation(body: unknown): Promise<unknown>;
        listCompatibleProviders(engine?: string): Promise<unknown>;
        syncProviderSeeds(): Promise<unknown>;
        getAgentCapabilities(): Promise<unknown>;
        putAgentToolAllow(body: { toolId: string; allowed: boolean }): Promise<unknown>;
        putMcpServerEnabled(body: { serverId: string; enabled: boolean }): Promise<unknown>;
        putAgentSkillEnabled(body: { skillPath: string; enabled: boolean }): Promise<unknown>;
        openCapabilityPath(filePath: string): Promise<{ ok: boolean }>;
        createSkill(payload: unknown): Promise<unknown>;
      };
      memory: {
        listProject(projectId: string): Promise<unknown>;
        getOverview(projectId: string): Promise<unknown>;
        listActivity(projectId: string, limit?: number): Promise<unknown>;
        readFile(projectId: string, relPath: string): Promise<unknown>;
        clearProject(projectId: string): Promise<unknown>;
        reindexProject(projectId: string): Promise<unknown>;
        openFolder(projectId: string): Promise<unknown>;
        readUserProfile(): Promise<unknown>;
        writeUserProfile(content: string): Promise<unknown>;
        getSettings(): Promise<unknown>;
        setSettings(patch: Record<string, unknown>): Promise<unknown>;
      };
      staging: {
        projectStatus(project?: string): Promise<unknown>;
        applyProject(project?: string, expectedOperationIds?: string[]): Promise<unknown>;
        discardProject(project?: string): Promise<unknown>;
        mapStatus(mapId: number, project?: string): Promise<unknown>;
        applyMap(mapId: number, project?: string): Promise<unknown>;
        discardMap(mapId: number, project?: string): Promise<unknown>;
      };
      placementQueue: {
        get(project?: string): Promise<unknown>;
        save(session: Record<string, unknown>, project?: string): Promise<unknown>;
        clear(project?: string): Promise<unknown>;
      };
      mapLibrary: {
        list(): Promise<unknown>;
        getSelection(): Promise<unknown>;
        writeSelection(body: Record<string, unknown>): Promise<unknown>;
        validatePackage(assetIds: string[]): Promise<unknown>;
      };
      storyPages: {
        profile(project?: string): Promise<unknown>;
        initializeOriginal(project?: string): Promise<unknown>;
        initializeOriginalWithGitBaseline(project?: string, options?: { commitMessage?: string }): Promise<unknown>;
        sync(project?: string): Promise<unknown>;
        inspectEvent(mapId: number, eventId: number, project?: string): Promise<unknown>;
        changeOrigin(pageNodeId: string, origin: string, project?: string): Promise<unknown>;
      };
      storyOutline: {
        get(project?: string): Promise<unknown>;
        set(payload: unknown, project?: string): Promise<unknown>;
      };
      projectManagement: {
        overview(project?: string): Promise<unknown>;
        getEntry(request: unknown, project?: string): Promise<unknown>;
        updateEntry(request: unknown, project?: string): Promise<unknown>;
        createEntry(request: unknown, project?: string): Promise<unknown>;
        resetEntry(request: unknown, project?: string): Promise<unknown>;
        revertEntry(request: unknown, project?: string): Promise<unknown>;
      };
      commonEvents: {
        list(project?: string): Promise<unknown>;
        get(id: number, project?: string): Promise<unknown>;
        create(request: unknown, project?: string): Promise<unknown>;
        update(id: number, value: unknown, project?: string): Promise<unknown>;
        delete(id: number, options?: unknown, project?: string): Promise<unknown>;
        duplicate(id: number, options?: unknown, project?: string): Promise<unknown>;
        rename(id: number, name: string, project?: string): Promise<unknown>;
        changeTrigger(id: number, trigger: number, switchId?: number, project?: string): Promise<unknown>;
        editCommandList(id: number, list: unknown[], project?: string): Promise<unknown>;
        references(id: number, project?: string): Promise<unknown>;
      };
      plugins: {
        read(project?: string): Promise<unknown>;
        validate(project?: string): Promise<unknown>;
        writeConfiguration(entries: unknown[], project?: string): Promise<unknown>;
        setEnabled(pluginName: string, enabled: boolean, project?: string): Promise<unknown>;
        reorder(pluginNames: string[], project?: string): Promise<unknown>;
        updateParameters(pluginName: string, parameters: Record<string, unknown>, project?: string): Promise<unknown>;
        installFile(sourceFile: string, options?: unknown, project?: string): Promise<unknown>;
        selectInstallFile(): Promise<string | null>;
        deleteFile(pluginName: string, options?: unknown, project?: string): Promise<unknown>;
      };
      assetLibrary: {
        catalog(): Promise<unknown>;
        detail(assetId: string): Promise<unknown>;
        validateImport(assetId: string, project?: string): Promise<unknown>;
        import(assetId: string, project?: string): Promise<unknown>;
      };
    };
  }
}

function desktopApi(): Window['api'] {
  return (globalThis as unknown as { api: Window['api'] }).api;
}

// 端点响应/请求形状的单一事实来源（见 RPG-Agent-MV/contract/types.ts）。
import type {
  MapTreeNode, MapIndex, TilesetSummary, MapPayload, TileEdit, EventReport,
  EditorProjectCatalog, NamedCatalogEntry, ProjectAssetEntry, ManagedAssetDetail, ProjectManagedEntry, ProjectManagedEntryRevertResult, ProjectManagedEntryResetResult,
  ProjectAssetMutationSafetyCheck, ProjectAssetReferenceGraph, ProjectAssetReferenceGraphAsset,
  ProjectAssetReference, ProjectAssetReplaceMissingReferenceInput,
  ProjectAssetReplaceMissingReferenceResult, ProjectAssetImportLocalFileInput,
  AssetLibraryCatalog, AssetLibraryCategoryId, AssetLibraryEntry, AssetLibraryImportResult,
  AssetLibraryImportValidation, AssetLibrarySkillEntry,
  ProviderSummary, UiSettings, PermissionSettings, AgentExecutionSettings, AgentExecutionEngineId,
  EngineProviderBinding, ActivateInvocationResult, ProbeAgentExecutionResult,
  WorkspaceSettings,
  TestResult, FetchModelsResult, ThinkingVariantsResult,
  MapLibraryMapMeta, MapLibraryEntry, MapLibraryIndex, MapSelection,
  BootstrapSnapshot, SessionDetail, SessionPlanSnapshot, SessionRuntimeEvent, SessionSubagentSnapshot, SessionSummary,
  StoryOutline, StoryEventOverview, StoryEventPageOverview, StoryPageOrigin, StoryProjectProfile, StoryProjectSyncResult,
  StoryProjectGitInitializeResult, ProjectGitBaselineResult, ProjectVersionSaveOptions,
  RmmvAudioSettings, RmmvMapEncounter, RmmvMapProperties, RmmvSystemPosition, RmmvSystemPositionTarget,
  RmmvDatabaseEntrySchema, RmmvDatabaseFieldKind, RmmvDatabaseFieldSchema, RmmvDatabaseReferenceField,
  InteractivePlaytestResult, InteractivePlaytestRun,
  AgentCapabilitiesSnapshot, CapabilityToolEntry, RuleSnapshot,
} from '@contract/types';
export type {
  MapTreeNode, MapIndex, TilesetSummary, MapPayload, TileEdit, EventReport,
  EditorProjectCatalog, NamedCatalogEntry, ProjectAssetEntry, ManagedAssetDetail, ProjectManagedEntry, ProjectManagedEntryRevertResult, ProjectManagedEntryResetResult,
  ProjectAssetMutationSafetyCheck, ProjectAssetReferenceGraph, ProjectAssetReferenceGraphAsset, ProjectAssetReference,
  ProjectAssetReplaceMissingReferenceInput,
  ProjectAssetReplaceMissingReferenceResult, ProjectAssetImportLocalFileInput,
  AssetLibraryCatalog, AssetLibraryCategoryId, AssetLibraryEntry, AssetLibraryImportResult,
  AssetLibraryImportValidation, AssetLibrarySkillEntry,
  ProviderSummary, UiSettings, PermissionSettings, AgentExecutionSettings, AgentExecutionEngineId,
  EngineProviderBinding, ActivateInvocationResult, ProbeAgentExecutionResult,
  WorkspaceSettings,
  TestResult, FetchModelsResult, ThinkingVariantsResult,
  MapLibraryMapMeta, MapLibraryEntry, MapLibraryIndex, MapSelection,
  BootstrapSnapshot, SessionDetail, SessionPlanSnapshot, SessionRuntimeEvent, SessionSubagentSnapshot, SessionSummary,
  StoryOutline, StoryEventOverview, StoryEventPageOverview, StoryPageOrigin, StoryProjectProfile, StoryProjectSyncResult,
  StoryProjectGitInitializeResult, ProjectGitBaselineResult, ProjectVersionSaveOptions,
  RmmvAudioSettings, RmmvMapEncounter, RmmvMapProperties, RmmvSystemPosition, RmmvSystemPositionTarget,
  RmmvDatabaseEntrySchema, RmmvDatabaseFieldKind, RmmvDatabaseFieldSchema, RmmvDatabaseReferenceField,
  InteractivePlaytestResult, InteractivePlaytestRun,
  AgentCapabilitiesSnapshot, CapabilityToolEntry, RuleSnapshot,
};

export interface InteractivePlaytestStartRequest {
  project: string;
  sessionId?: string;
  confirmedStagingHash?: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  isDefault: boolean;
  source?: 'workspace' | 'registered';
  dataDir?: string;
  layout?: 'www-data' | 'data';
}

export interface ProjectRegistrationResult {
  project: ProjectInfo | null;
  projects: ProjectInfo[];
}

export interface ProjectRemovalResult {
  projects: ProjectInfo[];
}

export interface ManagedPluginEntry {
  index: number;
  name: string;
  status: boolean;
  description: string;
  parameters: Record<string, unknown>;
  parameterCount: number;
  fileName: string;
  fileRelativePath: string;
  fileExists: boolean;
  parameterSchema?: PluginParameterSchema;
  parameterSchemaWarnings: string[];
  commandHints: PluginCommandHint[];
}

export interface PluginParameterSchemaField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select' | 'json' | 'struct' | 'array';
  description: string;
  rawType?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string | number | boolean; label: string }>;
  min?: number;
  max?: number;
  directory?: string;
  required?: boolean;
  structName?: string;
  fields?: PluginParameterSchemaField[];
  item?: PluginParameterSchemaField;
}

export interface PluginParameterSchema {
  source: 'rmmv-plugin-header';
  fields: PluginParameterSchemaField[];
  structs?: Record<string, PluginParameterSchemaField[]>;
  warnings: string[];
}

export interface PluginCommandHint {
  pluginName: string;
  command: string;
  source: 'command-comparison' | 'switch-command-case';
  evidence: string;
}

export interface ManagedPluginFile {
  name: string;
  fileName: string;
  relativePath: string;
  exists: boolean;
  staged: boolean;
  deleted: boolean;
  size: number | null;
}

export interface PluginValidationIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  pluginName?: string;
  index?: number;
  relativePath?: string;
}

export interface PluginValidationResult {
  ok: boolean;
  issues: PluginValidationIssue[];
}

export interface PluginConfigurationResult {
  project: string;
  relativePath: string;
  exists: boolean;
  plugins: ManagedPluginEntry[];
  pluginFiles: ManagedPluginFile[];
  validation: PluginValidationResult;
}

// 默认工程：后端 resolveProjectPath 把空值兜底到 projects/Project，
// 这里显式传同一相对路径，便于将来切换多工程。
export const DEFAULT_PROJECT = 'projects/Project';

export const workspace = {
  get() {
    return desktopApi().workspace.get() as Promise<WorkspaceSettings>;
  },
  put(body: WorkspaceSettings) {
    return desktopApi().workspace.put(toPlain(body)) as Promise<WorkspaceSettings>;
  },
  patch(body: WorkspaceSettings) {
    return desktopApi().workspace.patch(toPlain(body)) as Promise<WorkspaceSettings>;
  },
};

export const projects = {
  list() {
    return desktopApi().projects.list();
  },
  refresh() {
    return desktopApi().projects.refresh();
  },
  add(projectPath: string, options: { name?: string } = {}) {
    return desktopApi().projects.add(projectPath, options);
  },
  browseAndAdd(options: { name?: string } = {}) {
    return desktopApi().projects.browseAndAdd(options);
  },
  remove(projectPath: string) {
    return desktopApi().projects.remove(projectPath);
  },
  initializeGitBaseline(project: string = DEFAULT_PROJECT, options: ProjectVersionSaveOptions = {}) {
    return desktopApi().projects.initializeGitBaseline(project, options) as Promise<ProjectGitBaselineResult>;
  },
  saveProjectVersion(project: string = DEFAULT_PROJECT, options: ProjectVersionSaveOptions = {}) {
    return desktopApi().projects.saveProjectVersion(project, options) as Promise<ProjectGitBaselineResult>;
  },
};

export const eventRegistry = {
  contracts(project: string = DEFAULT_PROJECT, filters: Record<string, unknown> = {}) {
    return desktopApi().eventRegistry.contracts(project, filters) as Promise<{
      contracts?: Array<Record<string, unknown>>;
      count?: number;
    }>;
  },
  showContract(project: string = DEFAULT_PROJECT, contractId: string) {
    return desktopApi().eventRegistry.showContract(project, contractId);
  },
  script(project: string = DEFAULT_PROJECT, contractId: string) {
    return desktopApi().eventRegistry.script(project, contractId) as Promise<import('../utils/eventScript').EventScriptResult>;
  },
  reject(project: string = DEFAULT_PROJECT, contractId: string, options: { reason?: string; abandon?: boolean } = {}) {
    return desktopApi().eventRegistry.reject(project, contractId, options) as Promise<{ status: string; contractId?: string; previousStatus?: string }>;
  },
  approve(project: string = DEFAULT_PROJECT, contractId: string, options: { note?: string } = {}) {
    return desktopApi().eventRegistry.approve(project, contractId, toPlain(options)) as Promise<{ status: string; contractId?: string; previousStatus?: string }>;
  },
  unreject(project: string = DEFAULT_PROJECT, contractId: string, options: { status?: string } = {}) {
    return desktopApi().eventRegistry.unreject(project, contractId, options) as Promise<{ status: string; contractId?: string }>;
  },
};

export interface SlashCommandListItem {
  name: string;
  descriptionKey: string;
  argsHint?: string;
}

export interface SlashCommandResult {
  ok: boolean;
  display: 'composer_hint' | 'chat_status';
  message: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  data?: {
    contextUsedTokens?: number;
    contextWindowTokens?: number;
    contextPercent?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    totalCost?: number;
    turnCount?: number;
  };
}

export interface ContextUsageSnapshot {
  contextUsedTokens: number;
  contextWindowTokens: number;
  contextPercent: number;
}

export type GetContextUsageResult =
  | { ok: true; data: ContextUsageSnapshot }
  | {
    ok: false;
    message: string;
    messageKey: string;
    messageParams?: Record<string, string | number>;
  };

export const sessions = {
  list() {
    return desktopApi().sessions.list();
  },
  get(sessionId: string) {
    return desktopApi().sessions.get(sessionId);
  },
  history(sessionId: string) {
    return desktopApi().sessions.history(sessionId);
  },
  saveChatLog(sessionId: string, data: unknown) {
    return desktopApi().sessions.saveChatLog(sessionId, data);
  },
  create(payload: unknown) {
    return desktopApi().sessions.create(payload);
  },
  stop(sessionId: string) {
    return desktopApi().sessions.stop(sessionId);
  },
  submitAskResult(sessionId: string, askId: string, result: unknown) {
    return desktopApi().sessions.submitAskResult(sessionId, askId, result);
  },
  listTasks(sessionId: string) {
    return desktopApi().sessions.listTasks(sessionId);
  },
  updateTask(sessionId: string, taskId: string, patch: unknown) {
    return desktopApi().sessions.updateTask(sessionId, taskId, patch);
  },
  getPlan(sessionId: string) {
    return desktopApi().sessions.getPlan(sessionId) as Promise<SessionPlanSnapshot>;
  },
  listSubagents(sessionId: string) {
    return desktopApi().sessions.listSubagents(sessionId) as Promise<SessionSubagentSnapshot>;
  },
  stopSubagent(sessionId: string, taskId: string) {
    return desktopApi().sessions.stopSubagent(sessionId, taskId) as Promise<{ ok: boolean; reason?: string; requestId?: string; taskId?: string }>;
  },
  delete(sessionId: string) {
    return desktopApi().sessions.delete(sessionId);
  },
  preview(payload: unknown) {
    return desktopApi().sessions.preview(payload);
  },
  listSlashCommands() {
    return desktopApi().sessions.listSlashCommands();
  },
  getContextUsage(sessionId: string) {
    return desktopApi().sessions.getContextUsage(sessionId) as Promise<GetContextUsageResult>;
  },
  slashCommand(sessionId: string, command: string, args?: string) {
    return desktopApi().sessions.slashCommand(sessionId, command, args);
  },
  revealArtifacts(sessionId: string) {
    return desktopApi().sessions.revealArtifacts(sessionId);
  },
};

export const workflow = {
  listProposals(status?: string) {
    return desktopApi().workflow.listProposals(status);
  },
  getProposal(proposalId: string) {
    return desktopApi().workflow.getProposal(proposalId);
  },
  approveProposal(proposalId: string) {
    return desktopApi().workflow.approveProposal(proposalId);
  },
  rejectProposal(proposalId: string, reason?: string) {
    return desktopApi().workflow.rejectProposal(proposalId, reason);
  },
  getScript(proposalId: string) {
    return desktopApi().workflow.getScript(proposalId);
  },
  getReport(proposalId: string) {
    return desktopApi().workflow.getReport(proposalId);
  },
};

export const bootstrap = {
  get() {
    return desktopApi().bootstrap.get() as Promise<BootstrapSnapshot>;
  },
};

export const storyOutline = {
  get(project: string = DEFAULT_PROJECT) {
    return desktopApi().storyOutline.get(project) as Promise<StoryOutline | null>;
  },
  set(payload: Partial<StoryOutline>, project: string = DEFAULT_PROJECT) {
    return desktopApi().storyOutline.set(toPlain(payload), project) as Promise<StoryOutline>;
  },
};

export const maps = {
  tree(project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.tree(project) as Promise<MapIndex>;
  },
  tilesets(project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.tilesets(project) as Promise<{ project: string; tilesets: TilesetSummary[] }>;
  },
  get(mapId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.get(mapId, project) as Promise<MapPayload>;
  },
  create(properties: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.create(properties, project);
  },
  updateProperties(mapId: number, properties: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.updateProperties(mapId, properties, project);
  },
  reparent(mapId: number, parentId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.reparent(mapId, parentId, project);
  },
  duplicate(mapId: number, parentId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.duplicate(mapId, parentId, project);
  },
  remove(mapId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.remove(mapId, project);
  },
  postTiles(mapId: number, edits: TileEdit[], project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.postTiles(mapId, edits, project) as Promise<{ changedCells: number; changes: TileEdit[]; staging: unknown }>;
  },
  setStartPosition(mapId: number, x: number, y: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.setStartPosition(mapId, x, y, project) as Promise<{
      target: RmmvSystemPositionTarget;
      mapId: number;
      x: number;
      y: number;
      relativePath: string;
      staging: unknown;
    }>;
  },
  setSystemPosition(target: RmmvSystemPositionTarget, mapId: number, x: number, y: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.setSystemPosition(target, mapId, x, y, project) as Promise<{
      target: RmmvSystemPositionTarget;
      mapId: number;
      x: number;
      y: number;
      relativePath: string;
      staging: unknown;
    }>;
  },
  playtest(mapId: number, startX = 0, startY = 0, project: string = DEFAULT_PROJECT) {
    return desktopApi().maps.playtest(mapId, startX, startY, project);
  },
  projectStaging(project: string = DEFAULT_PROJECT) {
    return desktopApi().staging.projectStatus(project);
  },
  applyProjectStaging(project: string = DEFAULT_PROJECT, expectedOperationIds: string[] = []) {
    return desktopApi().staging.applyProject(project, [...expectedOperationIds]);
  },
  discardProjectStaging(project: string = DEFAULT_PROJECT) {
    return desktopApi().staging.discardProject(project);
  },
  applyMapStaging(mapId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().staging.applyMap(mapId, project);
  },
  discardMapStaging(mapId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().staging.discardMap(mapId, project);
  },
  importFromLibrary(
    assetId: string,
    parentMapId?: number | null,
    properties?: Record<string, unknown>,
    project: string = DEFAULT_PROJECT,
  ) {
    return desktopApi().maps.importFromLibrary(assetId, parentMapId, properties, project) as Promise<LibraryImportResult>;
  },
  importPackageFromLibrary(
    assetIds: string[],
    parentMapId?: number | null,
    properties?: Record<string, unknown>,
    project: string = DEFAULT_PROJECT,
  ) {
    return desktopApi().maps.importPackageFromLibrary(assetIds, parentMapId, properties, project) as Promise<PackageImportResult>;
  },
};

export interface LibraryImportResult {
  mapId: number;
  map: Record<string, unknown>;
  warnings?: string[];
}

export interface PackageImportResult {
  mapIds: number[];
  idMap: Record<number, number>;
  failed: Array<{ assetId: string; message: string }>;
  warnings: string[];
  usedSourceHierarchy: boolean;
}

// ──── 项目管理 overview 类型 ────

export interface ProjectOverviewMapEvent {
  id: number;
  name: string;
  note: string;
  x: number;
  y: number;
  pageCount: number;
  pages: unknown[];
  searchText: string;
}

export interface ProjectOverviewMap {
  id: number;
  name: string;
  parentId: number;
  order: number;
  fileName: string;
  exists: boolean;
  width: number;
  height: number;
  tilesetId: number;
  scrollType?: number;
  eventCount: number;
  events: ProjectOverviewMapEvent[];
}

export interface ProjectOverviewSwitch {
  id: number;
  name: string;
}

export interface ProjectOverviewVariable {
  id: number;
  name: string;
}

export interface ProjectOverviewCommonEvent {
  id: number;
  name: string;
  trigger: string;
  switchId: number;
  switchName: string;
  commands: unknown;
  searchText: string;
}

export interface CommonEventSummary {
  id: number;
  name: string;
  trigger: number;
  switchId: number;
}

export interface CommonEventListResult {
  project: string;
  relativePath: string;
  commonEvents: CommonEventSummary[];
}

export interface CommonEventMutationResult {
  entry: ProjectManagedEntry;
  staging: unknown;
}

export interface CommonEventDeleteResult {
  deleted: true;
  id: number;
  relativePath: string;
  staging: unknown;
}

export interface CommonEventUsageReference {
  kind: 'mapEventCommand' | 'commonEventCommand' | 'databaseEffect' | 'system';
  source: string;
  mapId?: number;
  eventId?: number;
  pageIndex?: number;
  commandIndex?: number;
  commonEventId?: number;
  databaseFile?: string;
  databaseId?: number;
  effectIndex?: number;
  systemKey?: string;
}

export type ProjectOverviewDbPreviewAsset =
  | 'characters'
  | 'faces'
  | 'svActors'
  | 'enemies'
  | 'animations'
  | 'tilesets'
  | 'battlebacks1'
  | 'battlebacks2'
  | 'system'
  | 'titles1'
  | 'titles2';

export interface ProjectOverviewDbPreview {
  kind: 'face' | 'character' | 'svActor' | 'image' | 'icon';
  asset: ProjectOverviewDbPreviewAsset;
  name?: string;
  index?: number;
  iconIndex?: number;
  label?: string;
}

export interface ProjectOverviewDbEntry {
  id: number;
  name: string;
  preview?: ProjectOverviewDbPreview;
}

export interface ProjectOverviewDbGroup {
  exists: boolean;
  count: number;
  named: ProjectOverviewDbEntry[];
}

export interface ProjectOverviewAudioBucket {
  dir: string;
  exists: boolean;
  count: number;
  names: string[];
  files: string[];
}

export interface ProjectOverviewImageBucket {
  dir: string;
  exists: boolean;
  count: number;
  names: string[];
  files: string[];
}

export interface ProjectOverview {
  scan: {
    generatedAt: string;
    projectRoot: string;
    dataDir: string;
    engine: string;
    maps: ProjectOverviewMap[];
    switches: ProjectOverviewSwitch[];
    variables: ProjectOverviewVariable[];
    commonEvents: ProjectOverviewCommonEvent[];
    database: Record<string, ProjectOverviewDbGroup>;
    audit: {
      summary: { info: number; warn: number; error: number; total: number };
      findings: Array<{ severity: string; code: string; message: string; details: Record<string, unknown> }>;
    };
  };
  assets: {
    generatedAt: string;
    projectRoot: string;
    dataDir: string;
    audioRoot: string;
    imageRoot: string;
    summary: {
      audio: Record<string, { exists: boolean; count: number }>;
      images: Record<string, { exists: boolean; count: number }>;
      animations: { total: number; named: number; withMissingSheets: number };
    };
    audio: Record<string, ProjectOverviewAudioBucket>;
    images: Record<string, ProjectOverviewImageBucket>;
    animations: Array<{ id: number; name: string; animation1Name: string; animation2Name: string; missingSheets: string[] }>;
  };
}

export interface MapLibraryPackageValidation {
  ok: boolean;
  issues: Array<{ assetId: string; title: string; message: string }>;
  sourceProjectReachable: boolean;
  sourceProjectPath: string | null;
}

export const events = {
  create(mapId: number, event: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().events.create(mapId, event, project) as Promise<EventReport>;
  },
  createFromPlacement(mapId: number, payload: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().events.createFromPlacement(mapId, payload, project) as Promise<EventReport & { usedContractPatch?: boolean }>;
  },
  update(mapId: number, eventId: number, event: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().events.update(mapId, eventId, event, project) as Promise<EventReport>;
  },
  remove(mapId: number, eventId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().events.remove(mapId, eventId, project) as Promise<EventReport>;
  },
  duplicate(mapId: number, eventId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().events.duplicate(mapId, eventId, project) as Promise<EventReport>;
  },
};

export const projectAssets = {
  editorCatalog(project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.editorCatalog(project) as Promise<EditorProjectCatalog>;
  },
  detail(target: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.detail(toPlain(target), project) as Promise<ManagedAssetDetail>;
  },
  referenceGraph(project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.referenceGraph(project) as Promise<ProjectAssetReferenceGraph>;
  },
  rename(target: Record<string, unknown>, nextName: string, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.rename(toPlain(target), nextName, project) as Promise<ManagedAssetDetail>;
  },
  remove(target: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.remove(toPlain(target), project) as Promise<{ deleted: true }>;
  },
  checkRenameSafety(target: Record<string, unknown>, nextName: string, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.checkRenameSafety(toPlain(target), nextName, project) as Promise<ProjectAssetMutationSafetyCheck>;
  },
  checkDeleteSafety(target: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.checkDeleteSafety(toPlain(target), project) as Promise<ProjectAssetMutationSafetyCheck>;
  },
  replaceMissingReference(request: ProjectAssetReplaceMissingReferenceInput, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.replaceMissingReference(
      toPlain(request),
      project,
    ) as Promise<ProjectAssetReplaceMissingReferenceResult>;
  },
  importLocalFile(request: ProjectAssetImportLocalFileInput, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectAssets.importLocalFile(
      toPlain(request),
      project,
    ) as Promise<ManagedAssetDetail>;
  },
  selectImportFile(category: string) {
    return desktopApi().projectAssets.selectImportFile(category) as Promise<string | null>;
  },
};

export const placementQueue = {
  get(project: string = DEFAULT_PROJECT) {
    return desktopApi().placementQueue.get(project);
  },
  save(session: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().placementQueue.save(toPlain(session), project);
  },
  clear(project: string = DEFAULT_PROJECT) {
    return desktopApi().placementQueue.clear(project);
  },
};

export const system = {
  openExternalUrl(url: string) {
    return desktopApi().window.openExternalUrl(url) as Promise<{ ok: boolean }>;
  },
};

export async function resolveAssetUrl(relativeUrl: string): Promise<string> {
  if (relativeUrl.startsWith('http') || relativeUrl.startsWith('rmmv-asset://')) return relativeUrl;
  const language = normalizeProductLanguage(useSettingsStore().ui.language);
  throw new Error(unsupportedAssetUrl(relativeUrl, language));
}

/** Strip Vue proxies / non-cloneable values before ipcRenderer.invoke. */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const settings = {
  listProviders() {
    return desktopApi().settings.listProviders() as Promise<{ providers: ProviderSummary[] }>;
  },
  getProvider(id: string) {
    return desktopApi().settings.getProvider(id) as Promise<ProviderSummary>;
  },
  createProvider(id: string, body: unknown) {
    return desktopApi().settings.upsertProvider(id, toPlain(body)) as Promise<ProviderSummary>;
  },
  updateProvider(id: string, body: unknown) {
    return desktopApi().settings.upsertProvider(id, toPlain(body)) as Promise<ProviderSummary>;
  },
  deleteProvider(id: string) {
    return desktopApi().settings.deleteProvider(id);
  },
  testProvider(
    id: string,
    overrides?: { apiKey?: string; baseUrl?: string; model?: string },
  ) {
    return desktopApi().settings.testProvider(id, overrides ? toPlain(overrides) : undefined) as Promise<TestResult>;
  },
  fetchModels(
    id: string,
    overrides?: { apiKey?: string; baseUrl?: string; persist?: boolean },
  ) {
    return desktopApi().settings.fetchModels(id, overrides ? toPlain(overrides) : undefined) as Promise<FetchModelsResult>;
  },
  fetchThinkingVariants(providerId: string, modelId: string) {
    return desktopApi().settings.fetchThinkingVariants(providerId, modelId) as Promise<ThinkingVariantsResult>;
  },
  getUi() {
    return desktopApi().settings.getUi() as Promise<UiSettings>;
  },
  putUi(body: UiSettings) {
    return desktopApi().settings.putUi(toPlain(body)) as Promise<UiSettings>;
  },
  getPermissions() {
    return desktopApi().settings.getPermissions() as Promise<PermissionSettings>;
  },
  putPermissions(body: PermissionSettings) {
    return desktopApi().settings.putPermissions(toPlain(body)) as Promise<PermissionSettings>;
  },
  getAgentExecution() {
    return desktopApi().settings.getAgentExecution() as Promise<AgentExecutionSettings>;
  },
  putAgentExecution(body: AgentExecutionSettings) {
    return desktopApi().settings.putAgentExecution(toPlain(body)) as Promise<AgentExecutionSettings>;
  },
  probeAgentExecution(body: AgentExecutionSettings = {}) {
    return desktopApi().settings.probeAgentExecution(toPlain(body)) as Promise<ProbeAgentExecutionResult>;
  },
  activateInvocation(body: {
    engine?: string;
    providerId: string;
    modelId: string;
  }) {
    return desktopApi().settings.activateInvocation(toPlain(body)) as Promise<ActivateInvocationResult>;
  },
  listCompatibleProviders(engine?: string) {
    return desktopApi().settings.listCompatibleProviders(engine) as Promise<{
      engine: string;
      providers: ProviderSummary[];
    }>;
  },
  syncProviderSeeds() {
    return desktopApi().settings.syncProviderSeeds() as Promise<{
      imported: string[];
      skipped: string[];
      errors: Array<{ providerId: string; error: string }>;
      seedPath: string;
      catalogCount: number;
      seedCount: number;
      clearedCount: number;
    }>;
  },
  getAgentCapabilities() {
    return desktopApi().settings.getAgentCapabilities() as Promise<AgentCapabilitiesSnapshot>;
  },
  putAgentToolAllow(body: { toolId: string; allowed: boolean }) {
    return desktopApi().settings.putAgentToolAllow(toPlain(body)) as Promise<AgentCapabilitiesSnapshot>;
  },
  putMcpServerEnabled(body: { serverId: string; enabled: boolean }) {
    return desktopApi().settings.putMcpServerEnabled(toPlain(body)) as Promise<AgentCapabilitiesSnapshot>;
  },
  putAgentSkillEnabled(body: { skillPath: string; enabled: boolean }) {
    return desktopApi().settings.putAgentSkillEnabled(toPlain(body)) as Promise<AgentCapabilitiesSnapshot>;
  },
  createSkill(skill: string, description: string) {
    return desktopApi().settings.createSkill(toPlain({ skill, description })) as Promise<{
      skill: string;
      skillPath: string;
      backupPath: string;
    }>;
  },
  openCapabilityPath(filePath: string) {
    return desktopApi().settings.openCapabilityPath(filePath) as Promise<{ ok: boolean }>;
  },
};

export interface MemoryFileInfo {
  relPath: string;
  name: string;
  description: string;
  type?: string;
  role: 'work-manual' | 'index' | 'topic';
  sizeBytes: number;
  updatedAt: string | null;
}

export interface ProjectMemorySnapshot {
  projectId: string;
  dir: string;
  exists: boolean;
  files: MemoryFileInfo[];
}

export interface MemoryActivityEntry {
  at: string;
  projectId: string;
  op: 'write' | 'remove' | 'reindex' | 'clear' | 'review' | 'progress';
  target?: string;
  detail?: string;
}

export interface MemoryProfileInfo {
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface MemoryOverviewStats {
  totalFiles: number;
  totalBytes: number;
  topicCount: number;
  manualPresent: boolean;
  indexPresent: boolean;
  lastUpdatedAt: string | null;
}

export interface MemoryTodaySummary {
  reviews: number;
  writes: number;
  removes: number;
  reindexes: number;
}

export interface ProjectMemoryOverview extends ProjectMemorySnapshot {
  stats: MemoryOverviewStats;
  today: MemoryTodaySummary;
  recentActivity: MemoryActivityEntry[];
  profile: MemoryProfileInfo;
  settings: MemoryFeatureSettings;
}

export interface RecallModelRef {
  providerId: string;
  modelId: string;
}

export interface MemoryFeatureSettings {
  enabled: boolean;
  recallModel: RecallModelRef | null;
  autoExtractEnabled: boolean;
}

export const memory = {
  listProject(projectId: string) {
    return desktopApi().memory.listProject(projectId) as Promise<ProjectMemorySnapshot>;
  },
  getOverview(projectId: string) {
    return desktopApi().memory.getOverview(projectId) as Promise<ProjectMemoryOverview>;
  },
  listActivity(projectId: string, limit = 50) {
    return desktopApi().memory.listActivity(projectId, limit) as Promise<{ projectId: string; entries: MemoryActivityEntry[] }>;
  },
  readFile(projectId: string, relPath: string) {
    return desktopApi().memory.readFile(projectId, relPath) as Promise<{ relPath: string; content: string }>;
  },
  clearProject(projectId: string) {
    return desktopApi().memory.clearProject(projectId) as Promise<{ cleared: boolean }>;
  },
  reindexProject(projectId: string) {
    return desktopApi().memory.reindexProject(projectId) as Promise<{ projectId: string; index: string }>;
  },
  openFolder(projectId: string) {
    return desktopApi().memory.openFolder(projectId) as Promise<{ ok: boolean; error: string | null; dir: string }>;
  },
  readUserProfile() {
    return desktopApi().memory.readUserProfile() as Promise<{ content: string }>;
  },
  writeUserProfile(content: string) {
    return desktopApi().memory.writeUserProfile(content) as Promise<{ content: string }>;
  },
  getSettings() {
    return desktopApi().memory.getSettings() as Promise<MemoryFeatureSettings>;
  },
  setSettings(patch: Partial<MemoryFeatureSettings>) {
    return desktopApi().memory.setSettings(patch as Record<string, unknown>) as Promise<MemoryFeatureSettings>;
  },
};

export const mapLibrary = {
  list() {
    return desktopApi().mapLibrary.list() as Promise<MapLibraryIndex>;
  },
  getSelection() {
    return desktopApi().mapLibrary.getSelection() as Promise<MapSelection | null>;
  },
  writeSelection(body: Record<string, unknown>) {
    return desktopApi().mapLibrary.writeSelection(body) as Promise<MapSelection>;
  },
  validatePackage(assetIds: string[]) {
    return desktopApi().mapLibrary.validatePackage(assetIds) as Promise<MapLibraryPackageValidation>;
  },
};

export const storyPages = {
  profile(project: string = DEFAULT_PROJECT) {
    return desktopApi().storyPages.profile(project) as Promise<StoryProjectProfile | null>;
  },
  initializeOriginal(project: string = DEFAULT_PROJECT) {
    return desktopApi().storyPages.initializeOriginal(project) as Promise<StoryProjectSyncResult>;
  },
  initializeOriginalWithGitBaseline(project: string = DEFAULT_PROJECT, options: ProjectVersionSaveOptions = {}) {
    return desktopApi().storyPages.initializeOriginalWithGitBaseline(project, options) as Promise<StoryProjectGitInitializeResult>;
  },
  sync(project: string = DEFAULT_PROJECT) {
    return desktopApi().storyPages.sync(project) as Promise<StoryProjectSyncResult>;
  },
  inspectEvent(mapId: number, eventId: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().storyPages.inspectEvent(mapId, eventId, project) as Promise<StoryEventOverview | null>;
  },
  changeOrigin(pageNodeId: string, origin: StoryPageOrigin, project: string = DEFAULT_PROJECT) {
    return desktopApi().storyPages.changeOrigin(pageNodeId, origin, project) as Promise<StoryEventOverview>;
  },
};

export const projectManagement = {
  overview(project: string = DEFAULT_PROJECT) {
    return desktopApi().projectManagement.overview(project) as Promise<ProjectOverview>;
  },
  getEntry(request: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectManagement.getEntry(toPlain(request), project) as Promise<ProjectManagedEntry>;
  },
  updateEntry(request: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectManagement.updateEntry(toPlain(request), project) as Promise<ProjectManagedEntry>;
  },
  createEntry(request: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectManagement.createEntry(toPlain(request), project) as Promise<ProjectManagedEntry>;
  },
  resetEntry(request: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectManagement.resetEntry(toPlain(request), project) as Promise<ProjectManagedEntryResetResult>;
  },
  revertEntry(request: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().projectManagement.revertEntry(toPlain(request), project) as Promise<ProjectManagedEntryRevertResult>;
  },
};

export const playtest = {
  start(request: InteractivePlaytestStartRequest) {
    return desktopApi().playtest.start(toPlain(request)) as Promise<InteractivePlaytestResult>;
  },
  current() {
    return desktopApi().playtest.current() as Promise<InteractivePlaytestResult>;
  },
  stop() {
    return desktopApi().playtest.stop() as Promise<InteractivePlaytestResult>;
  },
  reveal(runId: string) {
    return desktopApi().playtest.reveal(runId);
  },
  onStatus(callback: (run: InteractivePlaytestRun) => void) {
    return desktopApi().playtest.onStatus(callback);
  },
};

export const commonEvents = {
  list(project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.list(project) as Promise<CommonEventListResult>;
  },
  get(id: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.get(id, project) as Promise<ProjectManagedEntry>;
  },
  create(request: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.create(toPlain(request), project) as Promise<CommonEventMutationResult>;
  },
  update(id: number, value: unknown, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.update(id, toPlain(value), project) as Promise<CommonEventMutationResult>;
  },
  remove(id: number, options: Record<string, unknown> = {}, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.delete(id, toPlain(options), project) as Promise<CommonEventDeleteResult>;
  },
  duplicate(id: number, options: Record<string, unknown> = {}, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.duplicate(id, toPlain(options), project) as Promise<CommonEventMutationResult>;
  },
  rename(id: number, name: string, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.rename(id, name, project) as Promise<CommonEventMutationResult>;
  },
  changeTrigger(id: number, trigger: number, switchId = 0, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.changeTrigger(id, trigger, switchId, project) as Promise<CommonEventMutationResult>;
  },
  editCommandList(id: number, list: unknown[], project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.editCommandList(id, toPlain(list), project) as Promise<CommonEventMutationResult>;
  },
  references(id: number, project: string = DEFAULT_PROJECT) {
    return desktopApi().commonEvents.references(id, project) as Promise<CommonEventUsageReference[]>;
  },
};

export const plugins = {
  selectInstallFile() {
    return desktopApi().plugins.selectInstallFile() as Promise<string | null>;
  },
  read(project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.read(project) as Promise<PluginConfigurationResult>;
  },
  validate(project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.validate(project) as Promise<PluginValidationResult>;
  },
  writeConfiguration(entries: Array<Partial<ManagedPluginEntry>>, project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.writeConfiguration(toPlain(entries), project) as Promise<PluginConfigurationResult>;
  },
  setEnabled(pluginName: string, enabled: boolean, project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.setEnabled(pluginName, enabled, project) as Promise<PluginConfigurationResult>;
  },
  reorder(pluginNames: string[], project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.reorder(toPlain(pluginNames), project) as Promise<PluginConfigurationResult>;
  },
  updateParameters(pluginName: string, parameters: Record<string, unknown>, project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.updateParameters(pluginName, toPlain(parameters), project) as Promise<PluginConfigurationResult>;
  },
  installFile(sourceFile: string, options: Record<string, unknown> = {}, project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.installFile(sourceFile, toPlain(options), project) as Promise<{
      name: string;
      relativePath: string;
      staging: unknown;
      configuration?: PluginConfigurationResult;
    }>;
  },
  deleteFile(pluginName: string, options: Record<string, unknown> = {}, project: string = DEFAULT_PROJECT) {
    return desktopApi().plugins.deleteFile(pluginName, toPlain(options), project) as Promise<{
      name: string;
      relativePath: string;
      staging: unknown;
      configuration?: PluginConfigurationResult;
    }>;
  },
};

export const assetLibrary = {
  catalog() {
    return desktopApi().assetLibrary.catalog() as Promise<AssetLibraryCatalog>;
  },
  detail(assetId: string) {
    return desktopApi().assetLibrary.detail(assetId) as Promise<AssetLibraryEntry>;
  },
  validateImport(assetId: string, project: string = DEFAULT_PROJECT) {
    return desktopApi().assetLibrary.validateImport(assetId, project) as Promise<AssetLibraryImportValidation>;
  },
  import(assetId: string, project: string = DEFAULT_PROJECT) {
    return desktopApi().assetLibrary.import(assetId, project) as Promise<AssetLibraryImportResult>;
  },
};

// SSE 替换为 IPC 事件推送
export function openSessionEventStream(
  sessionId: string,
  opts?: { fromSequence?: number }
): { close: () => void; onEvent: (callback: (event: unknown) => void) => void } {
  const callbacks: ((event: unknown) => void)[] = [];
  let lastSequence = Math.max(0, Number(opts?.fromSequence) || 0);
  let closed = false;

  // 监听事件
  const cleanup = desktopApi().sessions.onEvent((data) => {
    if (data.sessionId === sessionId) {
      const event = data.event as { sequence?: number };
      const sequence = Number(event?.sequence || 0);
      if (sequence && sequence <= lastSequence) return;
      if (sequence) lastSequence = sequence;
      callbacks.forEach(cb => cb(data.event));
    }
  });
  queueMicrotask(() => {
    if (!closed) desktopApi().sessions.subscribe(sessionId, lastSequence).catch(console.error);
  });

  return {
    close: () => {
      closed = true;
      desktopApi().sessions.unsubscribe(sessionId).catch(console.error);
      cleanup();
      callbacks.length = 0;
    },
    onEvent: (callback: (event: unknown) => void) => {
      callbacks.push(callback);
    }
  };
}

export const api = { bootstrap, projects, eventRegistry, sessions, playtest, settings, memory, maps, events, projectAssets, projectManagement, commonEvents, plugins, assetLibrary, placementQueue, storyPages, storyOutline, resolveAssetUrl, openSessionEventStream };
