import type {
  EngineProviderBinding,
  RpgMakerEngine,
  MapPreviewOverrides,
  WorkspaceEditorProjectState,
  WorkspaceLayoutState,
  WorkspaceSettings,
  WorkspaceWindowState,
} from '@contract/types'
import { isMapPreviewVariableValue, parseMapPreviewSelfSwitchKey } from '@contract/map-preview-state'
import { AGENT_PANEL_DEFAULT_WIDTH } from './agentPanelWidth'
import { CHAT_HISTORY_DEFAULT_WIDTH } from './chatHistoryWidth'
import { readEditorZoom } from '../composables/useEditorWorkspaceState'
import { workspaceNoProjectsAvailable } from './workspaceSettingsLocalization'

export const WORKSPACE_SETTINGS_DB_KEY = 'workspace'

export const LEGACY_EDITOR_WORKSPACE_KEY = 'rmmv.editor.workspace.v1'
export const LEGACY_AGENT_PANEL_WIDTH_KEY = 'rmmv.workbench.agent-panel-width'
export const LEGACY_CHAT_HISTORY_WIDTH_KEY = 'rmmv.chat.history-width'
export const LEGACY_CHAT_COMPOSER_KEY = 'rmmv.chat.selection'

const OPENCODE_ENGINE_KEY = 'opencode'

export const DEFAULT_LEFT_DOCK_PALETTE_HEIGHT = 214
export const DEFAULT_LEFT_DOCK_WIDTH = 320
export const LEFT_DOCK_MIN_WIDTH = 214
export const LEFT_DOCK_MAX_WIDTH = 520
export const PALETTE_MIN_OPEN_HEIGHT = 120
export const PALETTE_MIN_TREE_HEIGHT = 64
export const PALETTE_PANE_RESIZER_HEIGHT = 8
export const PALETTE_MAX_PERSISTED_HEIGHT = 4096
export const PALETTE_RESET_HEIGHT = DEFAULT_LEFT_DOCK_PALETTE_HEIGHT

export function computeMaxPaletteHeight(availableHeight: number): number {
  if (availableHeight <= 0) return 520
  return Math.max(
    PALETTE_MIN_OPEN_HEIGHT,
    availableHeight - PALETTE_MIN_TREE_HEIGHT - PALETTE_PANE_RESIZER_HEIGHT,
  )
}

export const DEFAULT_WINDOW_WIDTH = 1280
export const DEFAULT_WINDOW_HEIGHT = 800

const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480
const MAXIMIZED_WINDOW_BOUNDS_TOLERANCE = 32

export interface WindowWorkAreaBounds {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_WORKSPACE_LAYOUT: Required<WorkspaceLayoutState> = {
  appRailOpen: true,
  agentPanelOpen: true,
  bottomPanelOpen: false,
  leftDockTilesOpen: true,
  leftDockWidth: DEFAULT_LEFT_DOCK_WIDTH,
  leftDockPaletteHeight: DEFAULT_LEFT_DOCK_PALETTE_HEIGHT,
  agentPanelWidth: AGENT_PANEL_DEFAULT_WIDTH,
  chatHistoryWidth: CHAT_HISTORY_DEFAULT_WIDTH,
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function clampPaletteHeight(height: number): number {
  return Math.max(110, Math.min(PALETTE_MAX_PERSISTED_HEIGHT, Math.round(height)))
}

export function clampLeftDockWidth(width: number): number {
  return Math.max(LEFT_DOCK_MIN_WIDTH, Math.min(LEFT_DOCK_MAX_WIDTH, Math.round(width)))
}

export function isValidWindowBounds(state: WorkspaceWindowState): boolean {
  const width = finiteNumber(state.width)
  const height = finiteNumber(state.height)
  const x = finiteNumber(state.x)
  const y = finiteNumber(state.y)
  if (width == null || height == null || x == null || y == null) return false
  return width >= MIN_WINDOW_WIDTH && height >= MIN_WINDOW_HEIGHT
}

export function isLikelyMaximizedWindowBounds(
  state: WorkspaceWindowState,
  workArea: WindowWorkAreaBounds,
): boolean {
  const width = finiteNumber(state.width)
  const height = finiteNumber(state.height)
  const x = finiteNumber(state.x)
  const y = finiteNumber(state.y)
  if (width == null || height == null || x == null || y == null) return false

  return (
    width >= workArea.width - MAXIMIZED_WINDOW_BOUNDS_TOLERANCE
    && height >= workArea.height - MAXIMIZED_WINDOW_BOUNDS_TOLERANCE
    && Math.abs(x - workArea.x) <= MAXIMIZED_WINDOW_BOUNDS_TOLERANCE
    && Math.abs(y - workArea.y) <= MAXIMIZED_WINDOW_BOUNDS_TOLERANCE
  )
}

export function normalizeWorkspaceLayout(
  layout: WorkspaceLayoutState | undefined,
): WorkspaceLayoutState {
  const source = layout || {}
  const leftDockWidth = finiteNumber(source.leftDockWidth)
  const paletteHeight = finiteNumber(source.leftDockPaletteHeight)
  const agentWidth = finiteNumber(source.agentPanelWidth)
  const historyWidth = finiteNumber(source.chatHistoryWidth)
  return {
    appRailOpen: bool(source.appRailOpen, DEFAULT_WORKSPACE_LAYOUT.appRailOpen),
    agentPanelOpen: bool(source.agentPanelOpen, DEFAULT_WORKSPACE_LAYOUT.agentPanelOpen),
    bottomPanelOpen: bool(source.bottomPanelOpen, DEFAULT_WORKSPACE_LAYOUT.bottomPanelOpen),
    leftDockTilesOpen: bool(source.leftDockTilesOpen, DEFAULT_WORKSPACE_LAYOUT.leftDockTilesOpen),
    leftDockWidth: leftDockWidth == null
      ? undefined
      : clampLeftDockWidth(leftDockWidth),
    leftDockPaletteHeight: paletteHeight == null
      ? undefined
      : clampPaletteHeight(paletteHeight),
    agentPanelWidth: agentWidth == null ? DEFAULT_WORKSPACE_LAYOUT.agentPanelWidth : agentWidth,
    chatHistoryWidth: historyWidth == null ? DEFAULT_WORKSPACE_LAYOUT.chatHistoryWidth : historyWidth,
  }
}

function normalizeEditorProjectState(
  value: unknown,
): WorkspaceEditorProjectState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const mapId = Number(record.mapId)
  const storedMode = record.mode
  if (!Number.isInteger(mapId) || mapId <= 0) return null
  if (storedMode !== 'map' && storedMode !== 'event' && storedMode !== 'preview') return null
  // Preview is a transient runtime state. Restoring it on the next editor mount can
  // immediately restart a preview that previously stalled the UI. Keep the selected
  // map, but always reopen persisted preview sessions in the safe map editor.
  const mode = storedMode === 'preview' ? 'map' : storedMode
  const expanded = Array.isArray(record.expandedMapIds)
    ? [...new Set(record.expandedMapIds.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0))]
    : undefined
  const tileTab = typeof record.tileTab === 'string' && record.tileTab.trim()
    ? record.tileTab.trim()
    : undefined
  const zoom = record.zoom == null ? undefined : readEditorZoom(record.zoom)
  const state: WorkspaceEditorProjectState = { mapId, mode }
  if (zoom != null) state.zoom = zoom
  if (expanded?.length) state.expandedMapIds = expanded
  if (tileTab) state.tileTab = tileTab
  const previewOverrides = normalizeMapPreviewOverrides(record.previewOverrides)
  if (previewOverrides) state.previewOverrides = previewOverrides
  return state
}

export function normalizeMapPreviewOverrides(value: unknown): MapPreviewOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const switches: Record<string, boolean> = {}
  const variables: MapPreviewOverrides['variables'] = {}
  const selfSwitches: Record<string, boolean> = {}
  if (source.switches && typeof source.switches === 'object' && !Array.isArray(source.switches)) {
    for (const [rawId, rawValue] of Object.entries(source.switches as Record<string, unknown>)) {
      const id = positiveStateId(rawId)
      if (id != null && typeof rawValue === 'boolean') switches[String(id)] = rawValue
    }
  }
  if (source.variables && typeof source.variables === 'object' && !Array.isArray(source.variables)) {
    for (const [rawId, rawValue] of Object.entries(source.variables as Record<string, unknown>)) {
      const id = positiveStateId(rawId)
      if (id != null && isMapPreviewVariableValue(rawValue)) variables[String(id)] = rawValue
    }
  }
  if (source.selfSwitches && typeof source.selfSwitches === 'object' && !Array.isArray(source.selfSwitches)) {
    for (const [rawKey, rawValue] of Object.entries(source.selfSwitches as Record<string, unknown>)) {
      if (parseMapPreviewSelfSwitchKey(rawKey) && typeof rawValue === 'boolean') selfSwitches[rawKey] = rawValue
    }
  }
  return { switches, variables, selfSwitches }
}

function positiveStateId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function normalizeWorkspaceSettings(raw: unknown): WorkspaceSettings {
  if (!raw || typeof raw !== 'object') {
    return { layout: normalizeWorkspaceLayout(undefined) }
  }
  const source = raw as WorkspaceSettings
  const legacy = source as WorkspaceSettings & { suppressUnsupportedMZVersionWarnings?: unknown }
  const projects: Record<string, WorkspaceEditorProjectState> = {}
  if (source.projects && typeof source.projects === 'object') {
    for (const [projectPath, value] of Object.entries(source.projects)) {
      const normalized = normalizeEditorProjectState(value)
      if (normalized) projects[projectPath] = normalized
    }
  }
  const composer = source.composer && typeof source.composer === 'object'
    ? {
        thinkingLevel: typeof source.composer.thinkingLevel === 'string'
          ? source.composer.thinkingLevel
          : undefined,
        modelsByEngine: normalizeModelsByEngine(source.composer.modelsByEngine),
      }
    : undefined
  return {
    lastProjectPath: typeof source.lastProjectPath === 'string' && source.lastProjectPath.trim()
      ? source.lastProjectPath.trim()
      : undefined,
    suppressProjectCompatibilityWarnings: bool(
      source.suppressProjectCompatibilityWarnings ?? legacy.suppressUnsupportedMZVersionWarnings,
      false,
    ),
    playtestRuntimes: normalizePlaytestRuntimes(source.playtestRuntimes),
    window: source.window && typeof source.window === 'object'
      ? {
          x: finiteNumber(source.window.x),
          y: finiteNumber(source.window.y),
          width: finiteNumber(source.window.width),
          height: finiteNumber(source.window.height),
          maximized: bool(source.window.maximized, false),
          firstRunDone: bool(source.window.firstRunDone, false),
        }
      : undefined,
    layout: normalizeWorkspaceLayout(source.layout),
    composer,
    projects: Object.keys(projects).length ? projects : undefined,
  }
}

export function normalizeWorkspacePatch(raw: unknown): WorkspaceSettings {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const source = raw as WorkspaceSettings
  const patch: WorkspaceSettings = {}

  if (Object.prototype.hasOwnProperty.call(source, 'lastProjectPath')) {
    patch.lastProjectPath = typeof source.lastProjectPath === 'string' && source.lastProjectPath.trim()
      ? source.lastProjectPath.trim()
      : ''
  }

  if (typeof source.suppressProjectCompatibilityWarnings === 'boolean') {
    patch.suppressProjectCompatibilityWarnings = source.suppressProjectCompatibilityWarnings
  }

  if (source.playtestRuntimes && typeof source.playtestRuntimes === 'object') {
    const playtestRuntimes = normalizePlaytestRuntimes(source.playtestRuntimes)
    if (playtestRuntimes) patch.playtestRuntimes = playtestRuntimes
  }

  if (source.window && typeof source.window === 'object') {
    const window: WorkspaceWindowState = {}
    const x = finiteNumber(source.window.x)
    const y = finiteNumber(source.window.y)
    const width = finiteNumber(source.window.width)
    const height = finiteNumber(source.window.height)
    if (x != null) window.x = x
    if (y != null) window.y = y
    if (width != null) window.width = width
    if (height != null) window.height = height
    if (typeof source.window.maximized === 'boolean') window.maximized = source.window.maximized
    if (typeof source.window.firstRunDone === 'boolean') window.firstRunDone = source.window.firstRunDone
    if (Object.keys(window).length) patch.window = window
  }

  if (source.layout && typeof source.layout === 'object') {
    const layout: WorkspaceLayoutState = {}
    if (typeof source.layout.appRailOpen === 'boolean') layout.appRailOpen = source.layout.appRailOpen
    if (typeof source.layout.agentPanelOpen === 'boolean') layout.agentPanelOpen = source.layout.agentPanelOpen
    if (typeof source.layout.bottomPanelOpen === 'boolean') layout.bottomPanelOpen = source.layout.bottomPanelOpen
    if (typeof source.layout.leftDockTilesOpen === 'boolean') layout.leftDockTilesOpen = source.layout.leftDockTilesOpen
    const leftDockWidth = finiteNumber(source.layout.leftDockWidth)
    const paletteHeight = finiteNumber(source.layout.leftDockPaletteHeight)
    const agentWidth = finiteNumber(source.layout.agentPanelWidth)
    const historyWidth = finiteNumber(source.layout.chatHistoryWidth)
    if (leftDockWidth != null) layout.leftDockWidth = clampLeftDockWidth(leftDockWidth)
    if (paletteHeight != null) layout.leftDockPaletteHeight = clampPaletteHeight(paletteHeight)
    if (agentWidth != null) layout.agentPanelWidth = agentWidth
    if (historyWidth != null) layout.chatHistoryWidth = historyWidth
    if (Object.keys(layout).length) patch.layout = layout
  }

  if (source.composer && typeof source.composer === 'object') {
    const composer: WorkspaceSettings['composer'] = {}
    if (typeof source.composer.thinkingLevel === 'string') {
      composer.thinkingLevel = source.composer.thinkingLevel
    }
    const modelsByEngine = normalizeModelsByEngine(source.composer.modelsByEngine)
    if (modelsByEngine) composer.modelsByEngine = modelsByEngine
    if (composer.thinkingLevel || composer.modelsByEngine) patch.composer = composer
  }

  if (source.projects && typeof source.projects === 'object') {
    const projects: Record<string, WorkspaceEditorProjectState> = {}
    for (const [projectPath, value] of Object.entries(source.projects)) {
      const normalized = normalizeEditorProjectState(value)
      if (normalized) projects[projectPath] = normalized
    }
    if (Object.keys(projects).length) patch.projects = projects
  }

  return patch
}

function normalizeModelsByEngine(
  value: unknown,
): Record<string, EngineProviderBinding> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result: Record<string, EngineProviderBinding> = {}
  for (const [engine, binding] of Object.entries(value as Record<string, unknown>)) {
    if (!binding || typeof binding !== 'object') continue
    const record = binding as Record<string, unknown>
    const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : ''
    const modelId = typeof record.modelId === 'string' ? record.modelId.trim() : ''
    if (!providerId || !modelId) continue
    const normalizedEngine = normalizeComposerEngineKey(engine)
    if (!normalizedEngine) continue
    result[normalizedEngine] = { providerId, modelId }
  }
  return Object.keys(result).length ? result : undefined
}

function normalizePlaytestRuntimes(
  value: unknown,
): Partial<Record<RpgMakerEngine, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const result: Partial<Record<RpgMakerEngine, string>> = {}
  for (const engine of ['rpg-maker-mv', 'rpg-maker-mz'] as const) {
    const runtimeRoot = typeof source[engine] === 'string' ? source[engine].trim() : ''
    if (runtimeRoot) result[engine] = runtimeRoot
  }
  return Object.keys(result).length ? result : undefined
}

function normalizeComposerEngineKey(engine: string): string | null {
  return engine === OPENCODE_ENGINE_KEY ? OPENCODE_ENGINE_KEY : null
}

export function mergeWorkspaceSettings(
  current: WorkspaceSettings,
  patch: WorkspaceSettings,
): WorkspaceSettings {
  const base = normalizeWorkspaceSettings(current)
  const next = normalizeWorkspacePatch(patch)
  const mergedProjects = { ...(base.projects || {}) }
  if (next.projects) {
    for (const [projectPath, value] of Object.entries(next.projects)) {
      const previous = mergedProjects[projectPath]
      mergedProjects[projectPath] = normalizeEditorProjectState({
        ...previous,
        ...value,
      })!
    }
  }
  const merged: WorkspaceSettings = { ...base }
  if (Object.prototype.hasOwnProperty.call(next, 'lastProjectPath')) {
    if (next.lastProjectPath) merged.lastProjectPath = next.lastProjectPath
    else delete merged.lastProjectPath
  }
  if (typeof next.suppressProjectCompatibilityWarnings === 'boolean') {
    merged.suppressProjectCompatibilityWarnings = next.suppressProjectCompatibilityWarnings
  }
  if (next.playtestRuntimes) {
    merged.playtestRuntimes = {
      ...(base.playtestRuntimes || {}),
      ...next.playtestRuntimes,
    }
  }
  if (next.window) merged.window = { ...base.window, ...next.window }
  if (next.layout) merged.layout = { ...base.layout, ...next.layout }
  if (next.composer) {
    merged.composer = {
      ...base.composer,
      ...next.composer,
      modelsByEngine: {
        ...(base.composer?.modelsByEngine || {}),
        ...(next.composer?.modelsByEngine || {}),
      },
    }
  }
  merged.projects = Object.keys(mergedProjects).length ? mergedProjects : undefined
  return normalizeWorkspaceSettings(merged)
}

export function filterLegacyWorkspaceMigrationPatch(
  current: WorkspaceSettings,
  migrationPatch: WorkspaceSettings,
): WorkspaceSettings {
  const existing = normalizeWorkspaceSettings(current)
  const patch = normalizeWorkspacePatch(migrationPatch)

  if (existing.composer?.thinkingLevel && patch.composer) {
    delete patch.composer.thinkingLevel
  }
  for (const engine of Object.keys(existing.composer?.modelsByEngine || {})) {
    if (patch.composer?.modelsByEngine) {
      delete patch.composer.modelsByEngine[engine]
    }
  }
  if (patch.composer?.modelsByEngine && !Object.keys(patch.composer.modelsByEngine).length) {
    delete patch.composer.modelsByEngine
  }
  if (patch.composer && !patch.composer.thinkingLevel && !patch.composer.modelsByEngine) {
    delete patch.composer
  }

  for (const projectPath of Object.keys(existing.projects || {})) {
    if (patch.projects) {
      delete patch.projects[projectPath]
    }
  }
  if (patch.projects && !Object.keys(patch.projects).length) {
    delete patch.projects
  }

  return patch
}

export interface ProjectInfoLike {
  path: string
  isDefault?: boolean
}

export function resolveStoredProjectPath(
  storedPath: string | undefined,
  projects: ProjectInfoLike[],
  language?: import('@contract/types').ProductLanguage | null,
): string {
  if (!projects.length) {
    throw new Error(workspaceNoProjectsAvailable(language))
  }
  if (storedPath && projects.some((project) => project.path === storedPath)) {
    return storedPath
  }
  const defaultProject = projects.find((project) => project.isDefault)
  return (defaultProject || projects[0]).path
}

export interface BrowserStorageMigrationInput {
  editorWorkspace?: string | null
  agentPanelWidth?: string | null
  chatHistoryWidth?: string | null
  composerPrefs?: string | null
  sessionModelSelections?: Record<string, string>
}

export function buildWorkspaceMigrationPatch(
  input: BrowserStorageMigrationInput,
): WorkspaceSettings {
  const patch: WorkspaceSettings = { projects: {} }
  const layout: WorkspaceLayoutState = {}
  const composer: WorkspaceSettings['composer'] = { modelsByEngine: {} }

  if (input.agentPanelWidth) {
    const width = Number(input.agentPanelWidth)
    if (Number.isFinite(width) && width > 0) layout.agentPanelWidth = width
  }
  if (input.chatHistoryWidth) {
    const width = Number(input.chatHistoryWidth)
    if (Number.isFinite(width) && width > 0) layout.chatHistoryWidth = width
  }
  if (Object.keys(layout).length) patch.layout = layout

  if (input.composerPrefs) {
    try {
      const parsed = JSON.parse(input.composerPrefs) as {
        thinkingLevel?: string
        provider?: string
        model?: string
      }
      if (parsed.thinkingLevel) composer!.thinkingLevel = parsed.thinkingLevel
      if (parsed.provider && parsed.model) {
        composer!.modelsByEngine![OPENCODE_ENGINE_KEY] = {
          providerId: parsed.provider,
          modelId: parsed.model,
        }
      }
    } catch {
      // ignore invalid legacy payload
    }
  }

  for (const [engine, raw] of Object.entries(input.sessionModelSelections || {})) {
    try {
      const parsed = JSON.parse(raw) as { providerId?: string; modelId?: string }
      const normalizedEngine = normalizeComposerEngineKey(engine)
      if (normalizedEngine && parsed.providerId && parsed.modelId) {
        composer!.modelsByEngine![normalizedEngine] = {
          providerId: parsed.providerId,
          modelId: parsed.modelId,
        }
      }
    } catch {
      // ignore invalid legacy payload
    }
  }

  if (input.editorWorkspace) {
    try {
      const store = JSON.parse(input.editorWorkspace) as Record<string, unknown>
      for (const [projectPath, value] of Object.entries(store)) {
        const normalized = normalizeEditorProjectState(value)
        if (normalized) patch.projects![projectPath] = normalized
      }
    } catch {
      // ignore invalid legacy payload
    }
  }

  if (composer?.thinkingLevel || Object.keys(composer?.modelsByEngine || {}).length) {
    patch.composer = composer
  }
  if (!Object.keys(patch.projects || {}).length) delete patch.projects
  return patch
}
