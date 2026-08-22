/**
 * Shared contract for the v1 MZ/MV UI designer.
 *
 * The source document mirrors docs/plan/v10/设计器需求.md §9.1: editor-only
 * information stays in `UiDesignerDocument`, while `UiRuntimeSceneExport`
 * contains only data consumed by MZUIRuntime.js.
 */

export const UI_DESIGNER_DOCUMENT_VERSION = '1.1.0' as const
export const UI_DESIGNER_EDITOR_VERSION = '1.1.0' as const
export const UI_DESIGNER_RUNTIME_VERSION = '>=1.1.0' as const
export const UI_DESIGNER_SCENE_SCRIPT_VERSION = '1.1.0' as const

export const UI_DESIGNER_NODE_TYPES = [
  'container',
  'list',
  'sprite',
  'nineSlice',
  'frameAnimation',
  'button',
  'text',
  'progressBar',
  'overlay',
  'video',
  'particle',
] as const

export type UiDesignerNodeType = (typeof UI_DESIGNER_NODE_TYPES)[number]
export type UiPropertyMode = 'value' | 'code'
export type UiPropertyModes = Record<string, UiPropertyMode>
export type UiPropertyCodes = Record<string, string>

export type UiFillMode = 'stretch' | 'cover' | 'contain' | 'tile'
export type UiRepeatMode = 'none' | 'horizontal' | 'vertical' | 'both'
export type UiBlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'overlay'
export type UiTextWeight = 'normal' | 'bold' | 'light'
export type UiTextAlign = 'left' | 'center' | 'right'
export type UiTextVerticalAlign = 'top' | 'middle' | 'bottom'

export interface UiBaseNodeProps {
  x: number
  y: number
  width: number
  height: number
  scaleX: number
  scaleY: number
  rotate: number
  opacity: number
  visible: boolean
  anchorX: number
  anchorY: number
  zIndex: number
}

export interface UiPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface UiContainerProps extends UiBaseNodeProps {
  backgroundPath: string
  backgroundFillMode: UiFillMode
  backgroundRepeatMode: UiRepeatMode
  clip: boolean
}

export type UiListAutoFlow = 'row' | 'column'
export type UiListItemAlignment = 'start' | 'center' | 'end' | 'stretch'

/** A non-visual Grid-style repeater whose direct children form one item template. */
export interface UiListProps extends UiBaseNodeProps {
  dataSource: string
  columns: number
  rows: number
  autoFlow: UiListAutoFlow
  columnGap: number
  rowGap: number
  justifyItems: UiListItemAlignment
  alignItems: UiListItemAlignment
  maxItems: number
}

export interface UiSpriteProps extends UiBaseNodeProps {
  path: string
  fillMode: UiFillMode
  repeatMode: UiRepeatMode
  tint: string
  blendMode: UiBlendMode
  scrollX: number
  scrollY: number
}

export interface UiNineSliceProps extends UiBaseNodeProps {
  path: string
  borderTop: number
  borderRight: number
  borderBottom: number
  borderLeft: number
  showGuides: boolean
}

export interface UiFrame {
  id: string
  path: string
  duration: number
}

export interface UiFrameAnimationProps extends UiBaseNodeProps {
  defaultFrameDuration: number
  loop: boolean
  speed: number
  initialFrame: number
  frames: UiFrame[]
  fillMode: UiFillMode
}

export interface UiTextProps extends UiBaseNodeProps {
  content: string
  wrapWidth: number
  richText: boolean
  fontFile: string
  fontSize: number
  fontWeight: UiTextWeight
  italic: boolean
  letterSpacing: number
  textColor: string
  strokeColor: string
  strokeWidth: number
  shadowColor: string
  shadowOffsetX: number
  shadowOffsetY: number
  shadowBlur: number
  align: UiTextAlign
  verticalAlign: UiTextVerticalAlign
  backgroundColor: string
  padding: UiPadding
}

export interface UiButtonImageStates {
  normal: string
  hover: string
  pressed: string
  disabled: string
}

export interface UiButtonProps extends UiTextProps {
  imageStates: UiButtonImageStates
  backgroundColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  hoverTint: string
  pressedScale: number
  disabledCondition: string
  focusColor: string
  focusWidth: number
  hoverSe: string
  clickSe: string
}

export interface UiProgressBarProps extends UiBaseNodeProps {
  trackImage: string
  trackColor: string
  trackRadius: number
  fillImage: string
  fillColor: string
  fillRadius: number
  fillDirection: 'leftToRight' | 'rightToLeft' | 'bottomToTop' | 'topToBottom'
  currentValue: number
  maxValue: number
  animateValue: boolean
}

export interface UiOverlayProps extends UiBaseNodeProps {
  fillColor: string
  clickThrough: boolean
}

export interface UiVideoProps extends UiBaseNodeProps {
  path: string
  autoplay: boolean
  loop: boolean
  muted: boolean
  playbackRate: number
  posterPath: string
}

export interface UiParticleProps extends UiBaseNodeProps {
  maxParticles: number
  emissionInterval: number
  emissionArea: 'point' | 'rectangle' | 'circle'
  imagePath: string
  shape: 'circle' | 'square' | 'star'
  velocityX: number
  velocityY: number
  velocityRandomX: number
  velocityRandomY: number
  gravityX: number
  gravityY: number
  rotationSpeed: number
  lifetime: number
  lifetimeRandom: number
  startScale: number
  endScale: number
  startOpacity: number
  endOpacity: number
  startColor: string
  endColor: string
  blendMode: Extract<UiBlendMode, 'normal' | 'add' | 'screen'>
  glow: number
}

export interface UiAlwaysCondition {
  type: 'none'
}

export interface UiSwitchCondition {
  type: 'switch_on' | 'switch_off'
  switchId: number
}

export interface UiVariableCondition {
  type: 'variable'
  variableId: number
  operator: '==' | '>=' | '<=' | '>' | '<' | '!='
  value: number
}

export interface UiCodeCondition {
  type: 'code'
  code: string
}

export interface UiCompositeCondition {
  type: 'and' | 'or'
  children: UiVisibilityCondition[]
}

export type UiVisibilityCondition =
  | UiAlwaysCondition
  | UiSwitchCondition
  | UiVariableCondition
  | UiCodeCondition
  | UiCompositeCondition

/** Runtime visibility checks may be throttled without changing the condition itself. */
export type UiConditionFrequency = 'per-frame' | 'every-10-frames' | 'per-second'

export type UiAnimationType =
  | 'none'
  | 'fadeIn'
  | 'fadeOut'
  | 'slideFromTop'
  | 'slideFromBottom'
  | 'slideFromLeft'
  | 'slideFromRight'
  | 'scaleIn'
  | 'scaleOut'

export type UiEasing = 'Linear' | 'EaseIn' | 'EaseOut' | 'EaseInOut' | 'Bounce'

export interface UiAnimationConfig {
  type: UiAnimationType
  duration: number
  easing: UiEasing
}

export type UiEventName =
  | 'onClick'
  | 'onHoverEnter'
  | 'onHoverLeave'
  | 'onShow'
  | 'onHide'
  | 'onUpdate'
  | 'onFocus'
  | 'onBlur'

export interface UiActionCondition {
  type: 'switch' | 'variable' | 'code'
  switchId?: number
  variableId?: number
  operator?: '==' | '>=' | '<=' | '>' | '<' | '!='
  value?: number
  code?: string
}

export interface UiActionBase {
  /** Optional source field; the editor uses list index/internal identity when absent. */
  id?: string
  condition?: UiActionCondition
}

export interface UiNoneAction extends UiActionBase {
  type: 'none'
}

export interface UiSceneAction extends UiActionBase {
  type: 'newGame' | 'continue' | 'options' | 'exit'
}

export interface UiGotoSceneAction extends UiActionBase {
  type: 'gotoScene'
  sceneName: string
}

/**
 * Scene classes every RPG Maker MV/MZ runtime registers, offered as gotoScene
 * targets alongside the project's own .mzui scenes. Scene_End is MV-only and
 * Scene_GameEnd is MZ-only; both are listed because the designer serves both
 * engines and the runtime resolves whichever class exists.
 */
export const UI_DESIGNER_BUILTIN_SCENE_NAMES: readonly string[] = [
  'Scene_Title',
  'Scene_Map',
  'Scene_Menu',
  'Scene_Item',
  'Scene_Skill',
  'Scene_Equip',
  'Scene_Status',
  'Scene_Options',
  'Scene_Load',
  'Scene_Save',
  'Scene_Battle',
  'Scene_Shop',
  'Scene_Name',
  'Scene_Gameover',
  'Scene_End',
  'Scene_GameEnd',
  'Scene_Debug',
]

export interface UiToggleNodeAction extends UiActionBase {
  type: 'toggleNode'
  targetNodeId: string
}

export interface UiPlaySeAction extends UiActionBase {
  type: 'playSe'
  seName: string
}

export interface UiUrlAction extends UiActionBase {
  type: 'url'
  url: string
}

export interface UiScriptAction extends UiActionBase {
  type: 'script'
  code: string
}

export interface UiSetVariableAction extends UiActionBase {
  type: 'setVariable'
  variableId: number
  variableOp: '=' | '+' | '-' | '*' | '/'
  variableVal: number
}

export interface UiSetSwitchAction extends UiActionBase {
  type: 'setSwitch'
  switchId: number
  switchVal: 'on' | 'off' | 'toggle'
}

export interface UiMessageAction extends UiActionBase {
  type: 'showMessage'
  message: string
}

export interface UiTweenAction extends UiActionBase {
  type: 'tweenProp'
  tweenNodeId: string
  tweenProp: string
  tweenTarget: number
  tweenDuration: number
  tweenEasing: UiEasing
}

export interface UiWaitAction extends UiActionBase {
  type: 'wait'
  waitFrames: number
}

export type UiEventAction =
  | UiNoneAction
  | UiSceneAction
  | UiGotoSceneAction
  | UiToggleNodeAction
  | UiPlaySeAction
  | UiUrlAction
  | UiScriptAction
  | UiSetVariableAction
  | UiSetSwitchAction
  | UiMessageAction
  | UiTweenAction
  | UiWaitAction

export interface UiEventHandler {
  actions: UiEventAction[]
}

export type UiEventMap = Partial<Record<UiEventName, UiEventHandler>>

export interface UiNodeBase<TType extends UiDesignerNodeType, TProps extends UiBaseNodeProps> {
  id: string
  type: TType
  name: string
  parentId: string | null
  children: string[]
  props: TProps
  propModes: UiPropertyModes
  propCodes: UiPropertyCodes
  /** Editor-only lock; runtime export strips this field. */
  locked: boolean
  condition: UiVisibilityCondition
  conditionFrequency: UiConditionFrequency
  enterAnim: UiAnimationConfig
  exitAnim: UiAnimationConfig
  /** Button-only focus animation; other node types keep the canonical none value. */
  focusAnim: UiAnimationConfig
  events: UiEventMap
}

export type UiContainerNode = UiNodeBase<'container', UiContainerProps>
export type UiListNode = UiNodeBase<'list', UiListProps>
export type UiSpriteNode = UiNodeBase<'sprite', UiSpriteProps>
export type UiNineSliceNode = UiNodeBase<'nineSlice', UiNineSliceProps>
export type UiFrameAnimationNode = UiNodeBase<'frameAnimation', UiFrameAnimationProps>
export type UiButtonNode = UiNodeBase<'button', UiButtonProps>
export type UiTextNode = UiNodeBase<'text', UiTextProps>
export type UiProgressBarNode = UiNodeBase<'progressBar', UiProgressBarProps>
export type UiOverlayNode = UiNodeBase<'overlay', UiOverlayProps>
export type UiVideoNode = UiNodeBase<'video', UiVideoProps>
export type UiParticleNode = UiNodeBase<'particle', UiParticleProps>

export type UiNode =
  | UiContainerNode
  | UiListNode
  | UiSpriteNode
  | UiNineSliceNode
  | UiFrameAnimationNode
  | UiButtonNode
  | UiTextNode
  | UiProgressBarNode
  | UiOverlayNode
  | UiVideoNode
  | UiParticleNode

export interface UiGuide {
  id: string
  type: 'vertical' | 'horizontal'
  position: number
  locked: boolean
}

export interface UiCanvasSettings {
  width: number
  height: number
  backgroundColor: string
  backgroundPattern: 'solid' | 'checkerboard'
  grid: {
    enabled: boolean
    size: number
    color: string
  }
  snap: {
    enabled: boolean
    smartEnabled: boolean
    sensitivity: number
  }
  rulers: boolean
  guidesVisible: boolean
  mapBackground: {
    mapId: number
    blur: number
    switchId: number
  }
}

export interface UiTransition {
  type: 'none' | 'fade' | 'slideLeft' | 'slideRight'
  duration: number
}

export interface UiTransitions {
  enter: UiTransition
  exit: UiTransition
}

export interface UiGlobalFilter {
  blur: number
  glow: number
  preset: '' | 'cyberpunk' | 'retro' | 'monochrome' | string
}

export interface UiSceneMeta {
  sceneName: string
  sceneBase: string
  canvasWidth: number
  canvasHeight: number
  author: string
  description: string
  created: string
  modified: string
}

export interface UiSceneScript {
  version: typeof UI_DESIGNER_SCENE_SCRIPT_VERSION
  source: string
}

export interface UiDesignerDocument {
  version: string
  editorVersion: string
  meta: UiSceneMeta
  transitions: UiTransitions
  globalFilter: UiGlobalFilter
  canvas: UiCanvasSettings
  guides: UiGuide[]
  nodes: UiNode[]
  zOrder: string[]
  sceneScript: UiSceneScript
}

/** Runtime export deliberately omits editorVersion, guides and editor canvas chrome. */
export interface UiRuntimeSceneMeta {
  sceneName: string
  sceneBase: string
  canvasWidth: number
  canvasHeight: number
  author: string
  description: string
}

export interface UiRuntimeSceneExport {
  version: string
  runtimeVersion: string
  meta: UiRuntimeSceneMeta
  transitions: UiTransitions
  globalFilter: UiGlobalFilter
  nodes: UiNode[]
  zOrder: string[]
  sceneScript: UiSceneScript
}

export type UiValidationSeverity = 'error' | 'warning'
export type UiValidationCode =
  | 'invalid-document-shape'
  | 'unsupported-version'
  | 'invalid-runtime-version'
  | 'scene-name-empty'
  | 'scene-name-invalid'
  | 'duplicate-node-id'
  | 'duplicate-node-name'
  | 'missing-parent'
  | 'missing-child'
  | 'cycle'
  | 'orphan-node'
  | 'invalid-z-order'
  | 'non-container-children'
  | 'duplicate-child-id'
  | 'duplicate-guide-id'
  | 'duplicate-frame-id'
  | 'empty-code'
  | 'invalid-code'
  | 'invalid-reference'
  | 'invalid-value'
  | 'missing-resource'
  | 'empty-frame-list'
  | 'particle-performance'
  | 'unnamed-node'

export interface UiValidationIssue {
  severity: UiValidationSeverity
  code: UiValidationCode
  message: string
  nodeId?: string
  nodeName?: string
  path?: string
  line?: number
}

export interface UiValidationReport {
  valid: boolean
  issues: UiValidationIssue[]
  errors: UiValidationIssue[]
  warnings: UiValidationIssue[]
}

export type UiPerformanceRating = 'smooth' | 'moderate' | 'mayStutter'

export interface UiPerformanceReport {
  nodeCount: number
  particleSystems: number
  maxParticleTotal: number
  frameCount: number
  codeModeProperties: number
  rating: UiPerformanceRating
  suggestions: string[]
}

export interface UiHistoryEntry {
  id: string
  description: string
  timestamp: number
}

export interface UiHistorySnapshot {
  document: UiDesignerDocument
  entries: UiHistoryEntry[]
  index: number
  savedIndex: number
}

export interface UiClipboardPayload {
  nodes: UiNode[]
  sourceIds: string[]
}

export type UiTreeDropPosition = 'before' | 'after' | 'inner'

export interface UiPoint {
  x: number
  y: number
}

export interface UiRect {
  x: number
  y: number
  width: number
  height: number
}

export interface UiViewport {
  zoom: number
  panX: number
  panY: number
  width: number
  height: number
}

export interface UiSnapResult extends UiPoint {
  snapped: boolean
  guides: UiGuide[]
  distance?: number
}

export interface UiRuntimeStatus {
  state: 'unknown' | 'missing' | 'file-unconfigured' | 'configured-disabled' | 'enabled-compatible' | 'version-too-old' | 'content-mismatch' | 'staged-pending' | 'error'
  version?: string
  requiredVersion?: string
  message: string
  runtimePath?: string
  digest?: string
  expectedDigest?: string
  pluginConfigured?: boolean
  pluginEnabled?: boolean
  staging?: {
    pending: boolean
    affectedFiles: string[]
    operationId?: string
  }
  needsConfirmation?: boolean
  projectCompatibility?: UiDesignerProjectCompatibility
}

export interface UiDesignerProjectCompatibility {
  engine: 'MV' | 'MZ' | 'unknown'
  engineVersion: string | null
  engineVersionSupported: boolean
  warnings: string[]
}

/**
 * The project-owned canvas profile consumed by the UI designer.
 *
 * This deliberately contains no project path or resource-root fields.  The
 * backend resolves those privately and only exposes the engine boundary and
 * the dimensions that define the editor/runtime canvas.
 */
export interface UiDesignerProjectProfile {
  engine: 'MV' | 'MZ'
  engineVersion: string | null
  screenWidth: number
  screenHeight: number
  uiAreaWidth: number
  uiAreaHeight: number
}

/** Result payload for the UI-designer project-profile operation. */
export interface UiDesignerProjectProfileResult extends UiDesignerProjectProfile {}

/** Result of an explicit runtime install/update or scene-export staging transaction. */
export interface UiDesignerRuntimeStageResult {
  status: 'staged'
  affectedFiles: string[]
  runtime: UiRuntimeStatus
  sceneRelativePath?: string
  digest: string
  transaction?: {
    operationId?: string
    sourceUnchanged?: boolean
    stagingUnchanged?: boolean
  }
  projectCompatibility?: UiDesignerProjectCompatibility
}

export type UiFileOperation = 'open' | 'save' | 'saveAs' | 'export'
export type UiFileStatus = 'idle' | 'ready' | 'busy' | 'unavailable' | 'success' | 'error'

export interface UiFileResult<T> {
  status: UiFileStatus
  value?: T
  path?: string
  message: string
  error?: {
    code: string
    operation: UiFileOperation | string
    recoverable: boolean
    choices?: readonly string[]
  }
  operation?: string
  code?: string
  recoverable?: boolean
  choices?: readonly string[]
  affectedFiles?: string[]
  digest?: string
  mtimeMs?: number
}

export type UiPreviewState = 'idle' | 'unavailable' | 'preparing' | 'running' | 'stopped' | 'error'

/**
 * A runtime failure reported by an isolated UI-designer preview.
 *
 * This is intentionally a small, stable envelope.  The preview runner does
 * not forward stdout/stderr into the editor; it writes this shape to the
 * session-owned diagnostic file and the desktop service validates it before
 * returning it to the renderer.
 */
export interface UiRuntimeDiagnostic {
  schemaVersion: '1.0.0'
  sessionId: string
  scene: string | null
  file: string | null
  node: string | null
  type: string | null
  phase: string | null
  event: string | null
  code: string
  severity: 'error' | 'warning'
  label: string
  message: string
  count: number
}

export interface UiResourceEntry {
  id: string
  category: 'image' | 'audio' | 'video' | 'font' | 'sceneData'
  path: string
  /** Engine-relative path persisted in .mzui/runtime JSON (never a URI). */
  relativePath?: string
  /** Renderer-only preview URL; never write this value back to a document. */
  previewUrl?: string
  name: string
  exists: boolean
  referenced: boolean
  size?: number
  thumbnailUrl?: string
  /** Scene-data metadata is intentionally shallow; it is not a parsed .mzui document. */
  sceneName?: string
  version?: string
  runtimeVersion?: string
  compatibility?: 'compatible' | 'outdated' | 'unsupported-version' | 'invalid' | 'unknown'
  diagnostic?: string
  mtimeMs?: number
}

export interface UiProjectResourceCatalog {
  projectPath: string
  engine: 'MV' | 'MZ' | 'unknown'
  projectCompatibility?: UiDesignerProjectCompatibility
  /**
   * The project's native window-text profile from data/System.json: the face
   * MV's Window_Base.standardFontFace would pick for the project locale, or
   * MZ's advanced font settings. Design-state text renders with these
   * defaults so it matches the engine-native preview. Absent when the engine
   * or System.json cannot be resolved.
   */
  mainFontFace?: string
  mainFontSize?: number
  resources: UiResourceEntry[]
  /** Total matches before the bounded page returned to the renderer. */
  total?: number
  offset?: number
  limit?: number
  hasMore?: boolean
}

export interface UiDesignerExportOptions {
  author?: string
  description?: string
  targetPath?: string
  overwrite?: boolean
}

export interface UiDesignerFileMetadata {
  path: string
  digest: string
  mtimeMs: number
  size: number
}

export interface UiDesignerFileConflict {
  code: 'UI_DESIGNER_CONFLICT'
  expected?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>
  actual?: UiDesignerFileMetadata | null
  recoverable: boolean
}

export interface UiDesignerFileRequest {
  path?: string
  project?: string
  /** PNG captured from the editor canvas and stored outside the source JSON. */
  thumbnailDataUrl?: string
  expected?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>
  force?: boolean
  overwrite?: boolean
}

export interface UiDesignerProjectRequest {
  project?: string
}

/** A profile request requires a selected project at runtime; the optional
 * field keeps the IPC API able to report a deterministic fail-fast error. */
export interface UiDesignerProjectProfileRequest extends UiDesignerProjectRequest {}

export interface UiDesignerResourceRequest extends UiDesignerProjectRequest {
  referencedPaths?: string[]
  category?: UiResourceEntry['category']
  query?: string
  offset?: number
  limit?: number
}

/** Explicit read of a catalog-listed Runtime scene JSON for lossy editor import. */
export interface UiDesignerSceneDataReadRequest extends UiDesignerProjectRequest {
  path: string
}

export interface UiDesignerSceneDataMetadata {
  id: string
  relativePath: string
  sceneName: string
  version: string
  runtimeVersion: string
  compatibility: 'compatible'
  digest: string
  mtimeMs: number
  size: number
}

export interface UiDesignerSceneDataReadResult {
  scene: UiRuntimeSceneExport
  metadata: UiDesignerSceneDataMetadata
  projectCompatibility: UiDesignerProjectCompatibility
}

/** Native directory selection for bulk frame import; results stay project-relative. */
export interface UiDesignerFrameFolderRequest extends UiDesignerProjectRequest {}

export interface UiDesignerRuntimeInstallRequest extends UiDesignerProjectRequest {
  forceModifiedRuntime?: boolean
  /** Installation is an explicit install-and-enable transaction. */
  enable: true
}

export interface UiDesignerSceneStageRequest extends UiDesignerProjectRequest {
  scene: UiRuntimeSceneExport
  targetPath?: string
  overwrite?: boolean
}

export interface UiDesignerRecoveryWriteRequest {
  document: UiDesignerDocument
  sourcePath?: string
  sourceMetadata?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>
  key?: string
}

export interface UiDesignerRuntimeExportRequest {
  scene: UiRuntimeSceneExport
  path?: string
  overwrite?: boolean
}

export interface UiDesignerSaveResult<T> extends UiFileResult<T> {
  metadata?: UiDesignerFileMetadata
  conflict?: UiDesignerFileConflict
  recoveryId?: string
  sourcePath?: string
}

export interface UiDesignerPersistenceAdapter {
  open(request?: UiDesignerFileRequest): Promise<UiDesignerSaveResult<UiDesignerDocument> | null>
  save(document: UiDesignerDocument, request?: UiDesignerFileRequest): Promise<UiDesignerSaveResult<UiDesignerDocument>>
  saveAs(document: UiDesignerDocument, request?: UiDesignerFileRequest): Promise<UiDesignerSaveResult<UiDesignerDocument>>
  listRecentFiles(): Promise<UiFileResult<UiDesignerRecentFileRecord[]>>
  removeRecentFile(path: string): Promise<UiFileResult<null>>
  writeRecovery(document: UiDesignerDocument, request?: { sourcePath?: string; sourceMetadata?: Pick<UiDesignerFileMetadata, 'digest' | 'mtimeMs'>; key?: string }): Promise<UiFileResult<UiDesignerRecoveryRecord>>
  listRecovery(): Promise<UiFileResult<UiDesignerRecoveryRecord[]>>
  readRecovery(recoveryId: string): Promise<UiFileResult<{ record: UiDesignerRecoveryRecord; document: UiDesignerDocument }>>
  clearRecovery(recoveryId: string): Promise<UiFileResult<null>>
  revealSource(path: string): Promise<UiFileResult<null>>
  readPreferences(): Promise<UiFileResult<Record<string, unknown>>>
  writePreferences(value: Record<string, unknown>): Promise<UiFileResult<Record<string, unknown>>>
  exportRuntime(scene: UiRuntimeSceneExport, request?: Pick<UiDesignerRuntimeExportRequest, 'path' | 'overwrite'>): Promise<UiFileResult<string>>
}

export interface UiDesignerRecentFileRecord {
  sourcePath: string
  /** Scene title captured by the persistence layer; old records may omit it. */
  sceneName?: string
  lastOpenedAt: string
  lastSavedAt?: string
  exists: boolean
  thumbnailUrl?: string
}

export interface UiDesignerSceneFileRecord {
  /** Project-relative .mzui path (posix separators). */
  path: string
  /** Absolute source path used only when opening the editable document. */
  sourcePath: string
  sceneName: string
  thumbnailUrl?: string
  modifiedAt: string
}

export interface UiDesignerRecoveryRecord {
  id: string
  sourcePath: string
  snapshotPath?: string
  savedAt: string
  digest: string
  mtimeMs: number
  key?: string
}

/** Backward type alias; persistence now exposes recent/recovery separately. */
export type UiDesignerSnapshotRecord = UiDesignerRecoveryRecord

export interface UiDesignerResourceAdapter {
  loadProject(request?: UiDesignerResourceRequest): Promise<UiFileResult<UiProjectResourceCatalog> | null>
  loadReferenced?(request: UiDesignerResourceRequest): Promise<UiFileResult<UiProjectResourceCatalog> | null>
  selectFrameFolder?(request?: UiDesignerFrameFolderRequest): Promise<UiFileResult<UiResourceEntry[]> | null>
  readSceneData(request: UiDesignerSceneDataReadRequest): Promise<UiFileResult<UiDesignerSceneDataReadResult>>
}

export interface UiDesignerProjectAdapter {
  getProfile(request?: UiDesignerProjectProfileRequest): Promise<UiFileResult<UiDesignerProjectProfileResult>>
  listSceneFiles(): Promise<UiFileResult<UiDesignerSceneFileRecord[]>>
}

export interface UiDesignerRuntimeAdapter {
  checkRuntime(projectPath?: string): Promise<UiRuntimeStatus>
  installRuntime(projectPath: string, options: { enable: true; forceModifiedRuntime?: boolean }): Promise<UiFileResult<UiDesignerRuntimeStageResult>>
  stageScene(projectPath: string, scene: UiRuntimeSceneExport, options?: { targetPath?: string; overwrite?: boolean }): Promise<UiFileResult<UiDesignerRuntimeStageResult>>
}

export type UiDesignerRendererHostStopReason = 'project-change' | 'unload' | 'shutdown' | 'protocol-error'

/**
 * Opaque handle for the physically isolated MV/MZ canvas renderer.
 *
 * The renderer receives no temporary-project path.  Project files are served
 * only through the confined preview protocol owned by the Electron main
 * process, and the iframe must complete the versioned renderer handshake
 * before this session can be confirmed.
 */
export interface UiDesignerRendererHostSession {
  sessionId: string
  generation: number
  iframeUrl: string
  engine: 'MV' | 'MZ'
  engineVersion: string
  runtimeVersion: string
  resourceRevision: number
}

export interface UiDesignerRendererResourceSyncRequest extends UiDesignerProjectRequest {
  sessionId: string
  generation: number
  manifest: import('./types.ts').ProjectAssetChangeManifest
}

export interface UiDesignerRendererResourceSyncResult {
  sessionId: string
  generation: number
  resourceRevision: number
  upsertedRelativePaths: string[]
  deletedRelativePaths: string[]
}

export interface UiDesignerRendererHostAdapter {
  start(generation: number): Promise<UiFileResult<UiDesignerRendererHostSession>>
  confirm(sessionId: string): Promise<UiFileResult<UiDesignerRendererHostSession>>
  stop(sessionId?: string, reason?: UiDesignerRendererHostStopReason): Promise<UiFileResult<null>>
  syncResources?(request: Omit<UiDesignerRendererResourceSyncRequest, 'project'>): Promise<UiFileResult<UiDesignerRendererResourceSyncResult>>
}

export interface UiDesignerGamePreviewSession {
  runId: string
  status: import('./types.ts').InteractivePlaytestRunStatus
  error?: string
}

export interface UiDesignerGamePreviewAdapter {
  start(projectPath: string, scene: UiRuntimeSceneExport): Promise<UiFileResult<UiDesignerGamePreviewSession>>
  stop(): Promise<UiFileResult<UiDesignerGamePreviewSession | null>>
  onStatus?(callback: (session: UiDesignerGamePreviewSession) => void): () => void
}

export interface UiCodeEditorAdapter {
  available: boolean
  label: string
  mount?: (element: HTMLElement, options: UiCodeEditorMountOptions) => UiCodeEditorHandle
}

export interface UiCodeEditorMountOptions {
  value: string
  mode: 'javascript' | 'json'
  lineNumbers: boolean
  foldGutter: boolean
  searchReplace: boolean
  completionItems?: string[]
  onChange: (value: string) => void
  /** Called for a real editor blur after CodeMirror has finished its own focus transition. */
  onBlur?: (value: string) => void
}

export interface UiCodeEditorHandle {
  getValue: () => string
  setValue: (value: string) => void
  focus: () => void
  refreshLayout?: () => void
  format?: () => void
  dispose: () => void
}

export interface UiDesignerLifecycleGuard {
  isDirty: () => boolean | Promise<boolean>
  save: () => void | Promise<void> | Promise<boolean>
  discard: () => void | Promise<void> | Promise<boolean>
  confirmDiscard?: () => Promise<boolean>
}

export interface UiDesignerLifecycleAdapter {
  registerGuard(guard: UiDesignerLifecycleGuard): () => void
}

export interface UiDesignerAdapterBundle {
  file?: UiDesignerPersistenceAdapter
  project?: UiDesignerProjectAdapter
  resource?: UiDesignerResourceAdapter
  runtime?: UiDesignerRuntimeAdapter
  rendererHost?: UiDesignerRendererHostAdapter
  gamePreview?: UiDesignerGamePreviewAdapter
  code?: UiCodeEditorAdapter
  lifecycle?: UiDesignerLifecycleAdapter
}
