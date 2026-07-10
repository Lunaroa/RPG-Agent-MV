import type { ProductLanguage } from './i18n.ts';
export type { ProductLanguage } from './i18n.ts';

// renderer ↔ 后端 的端点单一事实来源（形状侧）。
//
// 这里集中声明后端响应/请求的 TS 类型，由 ui/desktop/src/api/client.ts 经别名
// @contract/types 消费——前端不再手写会漂移的 interface。
//
// 零运行时依赖：纯类型文件，编译后被擦除。

export interface MapTreeNode {
  id: number;
  name: string;
  parentId: number;
  order: number;
  expanded: boolean;
}

export interface MapIndex {
  project: string;
  blocks: MapTreeNode[];
  maps: MapTreeNode[];
}

export interface TilesetSummary {
  id: number;
  name: string;
  mode: number;
  tilesetNames: string[];
}

export interface RmmvAudioSettings {
  name: string;
  volume: number;
  pitch: number;
  pan: number;
}

export interface RmmvMapEncounter {
  troopId: number;
  weight: number;
  regionSet: number[];
  [key: string]: unknown;
}

export interface RmmvMapProperties {
  displayName: string;
  scrollType: number;
  specifyBattleback: boolean;
  battleback1Name: string;
  battleback2Name: string;
  autoplayBgm: boolean;
  bgm: RmmvAudioSettings;
  autoplayBgs: boolean;
  bgs: RmmvAudioSettings;
  disableDashing: boolean;
  parallaxName: string;
  parallaxLoopX: boolean;
  parallaxLoopY: boolean;
  parallaxSx: number;
  parallaxSy: number;
  parallaxShow: boolean;
  encounterList: RmmvMapEncounter[];
  encounterStep: number;
  note: string;
}

export type RmmvSystemPositionTarget = 'player' | 'boat' | 'ship' | 'airship';

export interface RmmvSystemPosition {
  target: RmmvSystemPositionTarget;
  mapId: number;
  x: number;
  y: number;
}

export interface MapPayload {
  project: string;
  info: { id: number; name: string; parentId?: number; [key: string]: unknown };
  map: RmmvMapProperties & {
    width: number;
    height: number;
    tilesetId: number;
    data: number[];
    events: unknown[];
    [key: string]: unknown;
  };
  tileset: {
    id: number;
    name: string;
    tilesetNames: string[];
    flags: number[];
      imageUrls: (string | null)[];
  } | null;
  system: {
    switches: string[];
    variables: string[];
    startPosition: RmmvSystemPosition;
    vehiclePositions: Record<Exclude<RmmvSystemPositionTarget, 'player'>, RmmvSystemPosition>;
  };
  staging: unknown;
}

export interface NamedCatalogEntry {
  id: number;
  name: string;
}

export interface ProjectAssetEntry {
  name: string;
  fileName: string;
  url: string;
}

export type ManagedAssetScope = 'project';

export interface ManagedAssetRef {
  file: string;
  path: string;
}

export interface ManagedAssetDetail {
  scope: ManagedAssetScope;
  name: string;
  fileName: string;
  category: string;
  relativePath: string;
  url?: string;
  size: number;
  staged: boolean;
  references: ManagedAssetRef[];
}

export interface ProjectAssetReferenceGraphAsset {
  category: string;
  name: string;
  fileName: string;
  relativePath: string;
  size: number;
  staged: boolean;
}

export interface ProjectAssetReference {
  category: string;
  name: string;
  file: string;
  path: string;
  source: string;
}

export interface ProjectMissingAssetReference {
  category: string;
  name: string;
  file: string;
  path: string;
  source: string;
  expectedRelativePaths: string[];
}

export interface ProjectAssetReferenceGraph {
  generatedAt: string;
  projectRoot: string;
  summary: {
    assets: number;
    references: number;
    missingReferences: number;
    unusedAssets: number;
  };
  categories: Array<{
    id: string;
    label?: string;
    directory?: string;
  }>;
  assets: ProjectAssetReferenceGraphAsset[];
  references: ProjectAssetReference[];
  missingReferences: ProjectMissingAssetReference[];
  unusedAssets: ProjectAssetReferenceGraphAsset[];
}

export interface ProjectAssetMutationSafetyCheck {
  ok: boolean;
  action: 'delete' | 'rename';
  target: {
    category: string;
    name: string;
    relativePath: string | null;
  };
  nextName?: string;
  nextRelativePath?: string;
  references: ProjectAssetReference[];
  blockers: string[];
}

export interface ProjectAssetReplaceMissingReferenceInput {
  category: string;
  missingName: string;
  replacementName: string;
}

export interface ProjectAssetReplaceMissingReferenceResult {
  category: string;
  missingName: string;
  replacementName: string;
  updatedReferences: number;
  updatedFiles: string[];
}

export interface ProjectAssetImportLocalFileInput {
  category: string;
  sourceFile: string;
  targetName?: string;
  overwrite?: boolean;
}

export type AssetLibraryCategoryId =
  | 'maps'
  | 'skills'
  | 'tilesets'
  | 'characters'
  | 'images'
  | 'audio'
  | 'videos';

export interface AssetLibraryCategory {
  id: AssetLibraryCategoryId;
  label: string;
  count: number;
}

export interface AssetLibraryFileEntry {
  kind: 'file';
  assetId: string;
  category: Exclude<AssetLibraryCategoryId, 'maps' | 'skills'>;
  subtype: string;
  name: string;
  fileName: string;
  sourceSlug: string;
  relativePath: string;
  url: string;
  size: number;
  format: string;
}

export interface AssetLibraryDependencyRef {
  id: number;
  name: string;
}

export interface AssetLibrarySkillDependencies {
  skillTypes: AssetLibraryDependencyRef[];
  weaponTypes: AssetLibraryDependencyRef[];
  elements: AssetLibraryDependencyRef[];
  animations: AssetLibraryDependencyRef[];
  states: AssetLibraryDependencyRef[];
  commonEvents: AssetLibraryDependencyRef[];
  plugins: string[];
  resources: string[];
}

export interface AssetLibrarySkillEntry {
  kind: 'skill';
  assetId: string;
  category: 'skills';
  name: string;
  sourcePackage: string;
  skill: Record<string, unknown>;
  dependencies: AssetLibrarySkillDependencies;
}

export interface AssetLibraryMapEntry {
  kind: 'map';
  assetId: string;
  category: 'maps';
  name: string;
  map: MapLibraryEntry;
}

export type AssetLibraryEntry = AssetLibraryFileEntry | AssetLibrarySkillEntry | AssetLibraryMapEntry;

export interface AssetLibraryCatalog {
  totalEntries: number;
  categories: AssetLibraryCategory[];
  entries: AssetLibraryEntry[];
}

export interface AssetLibraryImportValidation {
  ok: boolean;
  issues: string[];
}

export interface AssetLibraryImportResult {
  kind: AssetLibraryEntry['kind'];
  assetId: string;
  importedId?: number;
  relativePath?: string;
}

export interface ProjectManagedEntry {
  kind: 'switch' | 'variable' | 'commonEvent' | 'database';
  group?: string;
  id: number;
  value: unknown;
  relativePath: string;
  schema?: RmmvDatabaseEntrySchema;
}

export type RmmvDatabaseFieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'unknown';

export interface RmmvDatabaseFieldSchema {
  path: string;
  kind: RmmvDatabaseFieldKind | RmmvDatabaseFieldKind[];
  required?: boolean;
  note?: string;
}

export interface RmmvDatabaseReferenceField {
  path: string;
  target: string;
  note?: string;
}

export interface RmmvDatabaseEntrySchema {
  group: string;
  key: string;
  fileName: string;
  isArrayTable: boolean;
  coreFields: RmmvDatabaseFieldSchema[];
  references: RmmvDatabaseReferenceField[];
}

export interface EditorProjectCatalog {
  project: string;
  maps: MapTreeNode[];
  switches: NamedCatalogEntry[];
  variables: NamedCatalogEntry[];
  elements: NamedCatalogEntry[];
  skillTypes: NamedCatalogEntry[];
  weaponTypes: NamedCatalogEntry[];
  armorTypes: NamedCatalogEntry[];
  equipTypes: NamedCatalogEntry[];
  actors: NamedCatalogEntry[];
  classes: NamedCatalogEntry[];
  skills: NamedCatalogEntry[];
  items: NamedCatalogEntry[];
  weapons: NamedCatalogEntry[];
  armors: NamedCatalogEntry[];
  states: NamedCatalogEntry[];
  enemies: NamedCatalogEntry[];
  troops: NamedCatalogEntry[];
  tilesets: NamedCatalogEntry[];
  commonEvents: NamedCatalogEntry[];
  animations: NamedCatalogEntry[];
  assets: {
    characters: ProjectAssetEntry[];
    faces: ProjectAssetEntry[];
    svActors: ProjectAssetEntry[];
    enemies: ProjectAssetEntry[];
    svEnemies: ProjectAssetEntry[];
    tilesets: ProjectAssetEntry[];
    animations: ProjectAssetEntry[];
    pictures: ProjectAssetEntry[];
    parallaxes: ProjectAssetEntry[];
    battlebacks1: ProjectAssetEntry[];
    battlebacks2: ProjectAssetEntry[];
    system: ProjectAssetEntry[];
    titles1: ProjectAssetEntry[];
    titles2: ProjectAssetEntry[];
    bgm: ProjectAssetEntry[];
    bgs: ProjectAssetEntry[];
    me: ProjectAssetEntry[];
    se: ProjectAssetEntry[];
    movies: ProjectAssetEntry[];
  };
}

export interface RmmvMapSummary {
  id: number;
  name: string;
  parentId: number;
  order: number;
  width: number;
  height: number;
  tilesetId: number;
  tilesetName: string | null;
  eventCount: number;
}

export interface RmmvMapTreeNode {
  id: number;
  children: number[];
}

export interface RmmvMapIndexResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  maps: RmmvMapSummary[];
  tree: RmmvMapTreeNode[];
}

export type RmmvDbTableName =
  | 'actors'
  | 'classes'
  | 'skills'
  | 'items'
  | 'weapons'
  | 'armors'
  | 'states'
  | 'enemies'
  | 'troops'
  | 'tilesets'
  | 'animations'
  | 'commonEvents'
  | 'system'
  | 'types'
  | 'terms';

export interface RmmvDbCatalogActorRow { id: number; name: string; classId: number; initialLevel: number; nickname: string | null }
export interface RmmvDbCatalogClassRow { id: number; name: string; expForLevel99: number | null }
export interface RmmvDbCatalogSkillRow { id: number; name: string; iconIndex: number; mpCost: number; tpCost: number; scope: number; occasion: number; description: string | null }
export interface RmmvDbCatalogItemRow { id: number; name: string; iconIndex: number; price: number; consumable: boolean; scope: number; occasion: number; description: string | null }
export interface RmmvDbCatalogWeaponRow { id: number; name: string; iconIndex: number; price: number; wtypeId: number; description: string | null }
export interface RmmvDbCatalogArmorRow { id: number; name: string; iconIndex: number; price: number; atypeId: number; etypeId: number; description: string | null }
export interface RmmvDbCatalogStateRow { id: number; name: string; iconIndex: number; restriction: number; removeAtBattleEnd: boolean; removeByDamage: boolean; description: string | null }
export interface RmmvDbCatalogEnemyRow { id: number; name: string; exp: number; gold: number; battlerName: string | null }
export interface RmmvDbCatalogTroopRow { id: number; name: string; memberCount: number }
export interface RmmvDbCatalogTilesetRow { id: number; name: string; mode: number; tilesetNames: string[] }
export interface RmmvDbCatalogAnimationRow { id: number; name: string; animation1Name: string | null; animation2Name: string | null }
export interface RmmvDbCatalogCommonEventRow { id: number; name: string; trigger: number; switchId: number }
export interface RmmvDbCatalogSystemRow {
  id: 0;
  name: string;
  gameTitle: string;
  switchCount: number;
  variableCount: number;
  startMapId: number;
  startX: number;
  startY: number;
  partyMembers: number[];
}
export interface RmmvDbCatalogTypesRow {
  id: 0;
  name: 'Types';
  elements: string[];
  skillTypes: string[];
  weaponTypes: string[];
  armorTypes: string[];
  equipTypes: string[];
}
export interface RmmvDbCatalogTermsRow {
  id: 0;
  name: 'Terms';
  basicCount: number;
  paramsCount: number;
  commandsCount: number;
  messageCount: number;
}

export type RmmvDbCatalogRow =
  | RmmvDbCatalogActorRow
  | RmmvDbCatalogClassRow
  | RmmvDbCatalogSkillRow
  | RmmvDbCatalogItemRow
  | RmmvDbCatalogWeaponRow
  | RmmvDbCatalogArmorRow
  | RmmvDbCatalogStateRow
  | RmmvDbCatalogEnemyRow
  | RmmvDbCatalogTroopRow
  | RmmvDbCatalogTilesetRow
  | RmmvDbCatalogAnimationRow
  | RmmvDbCatalogCommonEventRow
  | RmmvDbCatalogSystemRow
  | RmmvDbCatalogTypesRow
  | RmmvDbCatalogTermsRow;

export interface RmmvDbCatalogPageInfo {
  total: number;
  matched: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
}

export interface RmmvDbCatalogResult {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  query: string | null;
  offset: number;
  limit: number;
  includeUnnamed: boolean;
  tables: Partial<Record<RmmvDbTableName, RmmvDbCatalogRow[]>>;
  pageInfo: Partial<Record<RmmvDbTableName, RmmvDbCatalogPageInfo>>;
}

export interface RmmvCommonEventReference {
  kind: 'mapEvent' | 'commonEvent' | 'system';
  mapId?: number;
  eventId?: number;
  pageIndex?: number;
  commandIndex?: number;
  commonEventId?: number;
  systemKey?: string;
}

export interface RmmvCommonEventReferenceList {
  generatedAt: string;
  projectRoot: string;
  dataDir: string;
  commonEventId: number;
  exists: boolean;
  name: string | null;
  referencedBy: RmmvCommonEventReference[];
}

export interface TileEdit {
  kind?: 'tile' | 'autotile' | 'shadow' | 'region';
  x: number;
  y: number;
  layer?: number;
  tileId?: number;
  autotileKind?: number;
  shadowBits?: number;
  regionId?: number;
}

export interface EventReport {
  op: string;
  mapId: number;
  eventId: number;
  event: Record<string, unknown> | null;
  staging: unknown;
  mapFile?: string;
  before?: unknown;
  after?: unknown;
}

export interface ProviderSummary {
  id: string;
  displayName?: string;
  protocol?: string;
  baseUrl?: string;
  defaultModel?: string;
  credentialPresent?: boolean;
  credentialMask?: string;
  models?: Array<{ id: string; label: string }>;
  hiddenModelIds?: string[];
  supportedEngines?: AgentExecutionEngineId[];
  presetKind?: 'official' | 'kimi-plan' | 'custom' | 'opencode' | string;
  opencodeAuth?: {
    enabled?: boolean;
    envVar?: string;
  };
  disableModelFetch?: boolean;
  [key: string]: unknown;
}

export interface EngineProviderBinding {
  providerId: string;
  modelId: string;
}

export interface UiSettings {
  theme?: string;
  fontSize?: number;
  chatWidth?: number;
  language?: ProductLanguage;
  [key: string]: unknown;
}

export interface PermissionSettings {
  askOnWrite?: boolean;
  askOnBash?: boolean;
  askOnNetwork?: boolean;
  autoApproveLimit?: number;
  [key: string]: unknown;
}

export type AgentExecutionEngineId = 'opencode';

/** Default agent execution engine when settings are unset (fresh install / fallback). */
export const DEFAULT_AGENT_EXECUTION_ENGINE: AgentExecutionEngineId = 'opencode';

export interface AgentExecutionSettings {
  engine?: AgentExecutionEngineId;
  bindings?: Partial<Record<AgentExecutionEngineId, EngineProviderBinding>>;
  lastSyncedAt?: string;
}

export interface WorkspaceWindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximized?: boolean;
  firstRunDone?: boolean;
}

export interface WorkspaceLayoutState {
  appRailOpen?: boolean;
  agentPanelOpen?: boolean;
  bottomPanelOpen?: boolean;
  leftDockTilesOpen?: boolean;
  leftDockPaletteHeight?: number;
  agentPanelWidth?: number;
  chatHistoryWidth?: number;
}

export interface WorkspaceComposerState {
  thinkingLevel?: string;
  modelsByEngine?: Record<string, EngineProviderBinding>;
}

export interface WorkspaceEditorProjectState {
  mapId: number;
  mode: 'map' | 'event';
  zoom?: number;
  expandedMapIds?: number[];
  tileTab?: string;
}

export interface WorkspaceSettings {
  lastProjectPath?: string;
  window?: WorkspaceWindowState;
  layout?: WorkspaceLayoutState;
  composer?: WorkspaceComposerState;
  projects?: Record<string, WorkspaceEditorProjectState>;
}

export interface ActivateInvocationResult {
  ok: boolean;
  profileId: string | null;
  blocker: string | null;
  lastSyncedAt?: string;
  bindings?: Partial<Record<AgentExecutionEngineId, EngineProviderBinding>>;
  materialized?: {
    agentRuntimeEnvKeys?: string[];
  };
}

export interface AgentExecutionEngineMeta {
  id: AgentExecutionEngineId;
  label: string;
  available: boolean;
  hint: string;
}

export interface ProbeAgentExecutionResult {
  engine: AgentExecutionEngineId;
  ok: boolean;
  commandDisplay: string | null;
  error: string | null;
}

export interface TestResult {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
}

export interface FetchModelsResult {
  ok: boolean;
  models?: Array<{ id: string; label: string; metadata?: Record<string, unknown> }>;
  error?: string;
}

export interface ThinkingVariantItem {
  id: string;
  label: string;
}

export interface ThinkingVariantsResult {
  ok: boolean;
  variants: ThinkingVariantItem[];
  error?: string;
}

export type SessionStatus =
  | 'preparing'
  | 'starting'
  | 'running'
  | 'pass'
  | 'blocked'
  | 'failed'
  | 'error'
  | 'stopped'
  | 'interrupted';

export interface SessionRuntimeEvent {
  type: string;
  sessionId?: string;
  sequence?: number;
  at?: string;
  status?: string;
  text?: string;
  tool?: string;
  call_id?: string;
  input?: unknown;
  output?: unknown;
  success?: boolean;
  blocker?: unknown;
  command?: string;
  executable?: string;
  outDir?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number | null;
  [key: string]: unknown;
}

export interface SessionSummary {
  id: string;
  status: SessionStatus | string;
  profileId: string;
  project: string;
  productLanguage?: ProductLanguage;
  intent: string;
  displayText: string;
  parentSessionId?: string | null;
  blocker?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  outDir?: string;
  lastSequence?: number;
}

export interface SessionDetail extends SessionSummary {
  chatLog?: { segments?: unknown[] } | null;
  events?: SessionRuntimeEvent[];
}

export type SessionPlanMode =
  | 'idle'
  | 'planning'
  | 'approval_requested'
  | 'approved'
  | 'rejected'
  | 'error';

export interface SessionPlanSnapshot {
  sessionId: string;
  mode: SessionPlanMode;
  title: string;
  planMarkdown: string;
  askId?: string | null;
  requestId?: string | null;
  filePath?: string | null;
  feedback?: string | null;
  error?: string | null;
  updatedAt?: string | null;
}

export type SessionSubagentStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'timeout'
  | 'not_ready'
  | 'unknown';

export interface SessionSubagentActivity {
  id: string;
  kind: 'started' | 'progress' | 'output' | 'notification' | 'stop_requested' | 'stopped' | 'failed';
  title: string;
  detail?: string | null;
  status?: SessionSubagentStatus | string | null;
  tool?: string | null;
  input?: unknown;
  output?: unknown;
  outputFile?: string | null;
  at?: string | null;
}

export interface SessionSubagentItem {
  id: string;
  description: string;
  prompt?: string;
  status: SessionSubagentStatus;
  taskType?: string | null;
  /** True when the subagent was launched to run asynchronously while the parent continues. */
  background?: boolean;
  output?: string | null;
  outputFile?: string | null;
  error?: string | null;
  sessionUrl?: string | null;
  callId?: string | null;
  updatedAt?: string | null;
  stopRequestId?: string | null;
  activity?: SessionSubagentActivity[];
}

export interface SessionSubagentSnapshot {
  sessionId: string;
  items: SessionSubagentItem[];
  updatedAt?: string | null;
}

export interface BootstrapSnapshot {
  workflowRoot: string;
  executionEngines?: AgentExecutionEngineMeta[];
  currentExecution?: AgentExecutionEngineId;
  profiles: Record<string, {
    id: string;
    runtime?: string | null;
    provider?: string | null;
    model?: string | null;
    label?: string | null;
    dynamic?: boolean;
  }>;
}

export interface MapLibraryMapMeta {
  width?: number;
  height?: number;
  tilesetId?: number | null;
  tilesetName?: string;
  [key: string]: unknown;
}

export interface MapLibraryEntry {
  assetId: string;
  title: string;
  engine: string;
  map?: MapLibraryMapMeta | null;
  tags: string[];
  license: Record<string, unknown>;
  knownIssues: string[];
  dependencies: Record<string, unknown>;
  source: { name: string };
  /** 源资源包/样例工程文件夹 id（importBatch.sourceSlug 或 localPath 推导） */
  packageId: string;
  /** 人类可读的资源包名称，用于侧栏分组 */
  packageLabel: string;
  screenshotUrl: string;
}

export interface MapLibraryIndex {
  totalEntries: number;
  entries: MapLibraryEntry[];
}

export interface MapSelection {
  schemaVersion: number;
  selectedAt: string;
  assetId: string;
  title: string;
  [key: string]: unknown;
}

// ---- 创意大纲（Story Outline）：项目级 Markdown 文本，只承载创作意图 ----
// 生产进度、地图、依赖、验收均以 StoryPage / EventContract 为准。

export interface StoryOutline {
  projectId: string;
  title?: string;
  body: string;
  updatedAt: string;
  updatedBy?: string;
}

// ---- 剧情模块模型（地图 ► 事件 ► 页）----
// 对应 SQLite 表 story_event_anchors / story_pages。

// 内容来源按事件公共部分和每一页分别判断权限。
export type StoryContentOrigin = 'baseline' | 'original' | 'mod';
export type StoryPageOrigin = StoryContentOrigin;
export type StoryEventOrigin = StoryContentOrigin;
export type StoryProjectMode = 'original' | 'mod';
export type StoryIntegrityStatus =
  | 'synced'
  | 'baseline-modified'
  | 'baseline-deleted'
  | 'missing'
  | 'sync-error';

export interface StoryProjectProfile {
  projectId: string;
  projectPath: string;
  mode: StoryProjectMode;
  defaultOrigin: Exclude<StoryContentOrigin, 'baseline'>;
  baselineVersion?: string;
  baselineProjectPath?: string;
  initializedAt: string;
  updatedAt: string;
}

export interface ProjectVersionSaveOptions {
  commitMessage?: string;
}

export interface ProjectGitBaselineResult {
  ok: boolean;
  projectPath: string;
  initialized: boolean;
  committed: boolean;
  commitHash?: string;
  message: string;
}

export interface StoryIntegrityIssue {
  issueId: string;
  projectId: string;
  scopeType: 'project' | 'event' | 'page' | 'scene' | 'contract';
  scopeId: string;
  code: string;
  severity: 'warning' | 'error';
  message: string;
  mapId?: number;
  eventId?: number;
  pageNodeId?: string;
  detail?: Record<string, unknown>;
  detectedAt: string;
  resolvedAt?: string;
}

export interface StoryEventAnchor {
  projectId: string;
  anchorId: string;
  origin: StoryEventOrigin;          // 事件名字/坐标/备注/整事件删除的权限来源
  mapId: number;
  eventId?: number;
  eventName?: string;               // 跨版本认事件用
  x?: number;
  y?: number;
  eventRid?: number;                // 历史兼容字段；当前默认流程不再区分 MOD/原版
  baselineVersion?: string;
  currentShell?: Record<string, unknown>;
  baselineShell?: Record<string, unknown>;
  currentShellFingerprint?: string;
  baselineShellFingerprint?: string;
  integrityStatus: StoryIntegrityStatus;
  detail?: Record<string, unknown>;
}

export interface BaselineStoryEventAnchorInput {
  projectId: string;
  anchorId?: string;
  mapId: number;
  eventId: number;
  eventName: string;
  x: number;
  y: number;
  baselineVersion: string;
  currentShell?: Record<string, unknown>;
  baselineShell?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

export interface ModStoryEventAnchorInput {
  projectId: string;
  anchorId?: string;
  mapId: number;
  eventRid: number;
  eventId: number;
  eventName: string;
  x: number;
  y: number;
  currentShell?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

export interface EditableStoryEventAnchorInput {
  projectId: string;
  anchorId?: string;
  origin: 'original' | 'mod';
  mapId: number;
  eventId: number;
  eventRid?: number;
  eventName: string;
  x: number;
  y: number;
  currentShell?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

export interface StoryPage {
  projectId: string;
  pageNodeId: string;
  anchorId: string;
  origin: StoryPageOrigin;
  pageRef: string;                  // 当前默认流程为数据库内稳定页 ID；baseline 仅供历史兼容
  pageUid?: string;                 // 数据库内稳定页 ID；不写入 RMMV 事件命令
  orderHint?: number;
  contractId?: string;              // 页面来自哪个契约（逻辑引用 event_contracts.contract_id）
  sceneId?: string;                 // 事件契约的语义标签；不再关联大纲进度
  gating?: Record<string, unknown>; // 门控开关 / 一次性 or 永久接管
  currentPage?: Record<string, unknown>;
  baselinePage?: Record<string, unknown>;
  currentFingerprint?: string;
  baselineFingerprint?: string;
  integrityStatus: StoryIntegrityStatus;
  lastSyncedAt?: string;
  detail?: Record<string, unknown>;
  rowVersion: number;
}

export interface StoryPageHistoryEntry {
  historyId: number;
  projectId: string;
  pageNodeId: string;
  action: 'created' | 'updated' | 'deleted' | 'restored' | 'origin-changed';
  beforePage?: Record<string, unknown>;
  afterPage?: Record<string, unknown>;
  beforeFingerprint?: string;
  afterFingerprint?: string;
  actorType: 'agent' | 'user' | 'external' | 'system';
  actorId?: string;
  sessionId?: string;
  createdAt: string;
}

export interface StoryEventPageOverview {
  pageNodeId: string;
  pageUid?: string;
  pageIndex?: number;
  origin: StoryPageOrigin;
  editable: boolean;
  integrityStatus: StoryIntegrityStatus;
  currentFingerprint?: string;
  baselineFingerprint?: string;
}

export interface StoryEventOverview {
  projectId: string;
  anchorId: string;
  mapId: number;
  eventId: number;
  eventName: string;
  origin: StoryEventOrigin;
  shellEditable: boolean;
  integrityStatus: StoryIntegrityStatus;
  pages: StoryEventPageOverview[];
  issues: StoryIntegrityIssue[];
}

export interface StoryProjectSyncResult {
  profile: StoryProjectProfile | null;
  scannedMaps: number;
  scannedEvents: number;
  scannedPages: number;
  changedFiles: string[];
  issues: StoryIntegrityIssue[];
}

export interface StoryProjectGitInitializeResult extends StoryProjectSyncResult {
  git: ProjectGitBaselineResult;
  message: string;
}

export interface CapabilityToolEntry {
  id: string;
  kind: string;
  layer: string;
  title: string;
  description: string;
  readOnly: boolean;
  riskLevel: 'normal' | 'high' | 'experimental';
  riskBadges: Array<'high' | 'experimental'>;
  allowed: boolean;
  denied: boolean;
  inAgentRuntimeProfile: boolean;
  inAgentAllow: boolean;
  available: boolean;
  toggleable: boolean;
  disabledReason?: string | null;
  requiresNewSession: boolean;
  warning?: string | null;
}

export interface McpServerSnapshot {
  id: string;
  title: string;
  description: string;
  type?: string;
  url?: string;
  enabled: boolean;
  managedBy?: string;
  userToggleable: boolean;
  runtimeInjected?: boolean;
}

export interface SkillSnapshot {
  path: string;
  absolutePath: string;
  title: string;
  description: string;
  enabled: boolean;
}

export interface RuleSnapshot {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  category: string;
  layer: 'developer' | 'agentPolicy';
  description?: string;
}

export interface AgentPolicySnapshot {
  note?: string | null;
  allowCount: number;
  denyCount: number;
  deny: string[];
}

export interface AgentCapabilitiesSnapshot {
  generatedAt: string;
  workflowRoot: string;
  repoRoot: string | null;
  engine: string | null;
  builtinTools: CapabilityToolEntry[];
  mcpServers: McpServerSnapshot[];
  skills: SkillSnapshot[];
  rules: RuleSnapshot[];
  agentPolicy: AgentPolicySnapshot;
  manifestPath: string;
}
