import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type {
  EngineProviderBinding,
  MapOverviewLayoutId,
  MapOverviewLayoutParametersById,
  MapOverviewLayoutParametersState,
  MapOverviewThumbnailQuality,
  WorkspaceMapOverviewProjectState,
  WorkspaceEditorProjectState,
  WorkspaceLayoutState,
  WorkspaceSettings,
} from '@contract/types'
import { workspace as workspaceApi } from '../api/client'
import {
  DEFAULT_MAP_OVERVIEW_LAYOUT_ID,
  isMapOverviewLayoutId,
  parseMapOverviewLayoutId,
} from '../utils/mapOverviewLayouts'
import {
  defaultMapOverviewLayoutParameters,
  parseMapOverviewLayoutParameters,
} from '../utils/mapOverviewLayoutParameters'
import { clampMapOverviewZoom } from '../utils/mapOverviewViewport'
import {
  buildWorkspaceMigrationPatch,
  filterLegacyWorkspaceMigrationPatch,
  LEGACY_AGENT_PANEL_WIDTH_KEY,
  LEGACY_CHAT_COMPOSER_KEY,
  LEGACY_CHAT_HISTORY_WIDTH_KEY,
  LEGACY_EDITOR_WORKSPACE_KEY,
  mergeWorkspaceSettings,
  normalizeWorkspaceLayout,
  normalizeWorkspaceSettings,
} from '../utils/workspaceSettings'
import { chatSelectionStorageKey } from '../utils/chatProviderOptions'
import { useWorkbenchUiStore } from './workbenchUi'

export const useWorkspaceStore = defineStore('workspace', () => {
  const settings = ref<WorkspaceSettings>(normalizeWorkspaceSettings({}))
  const hydrated = ref(false)
  const leftDockWidthPersisted = ref(false)
  const paletteHeightPersisted = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let pendingPatch: WorkspaceSettings | null = null
  const inFlightWrites = new Set<Promise<WorkspaceSettings>>()
  let layoutWatchBound = false

  async function load(): Promise<WorkspaceSettings> {
    const payload = await workspaceApi.get()
    leftDockWidthPersisted.value = typeof payload?.layout?.leftDockWidth === 'number'
    paletteHeightPersisted.value = typeof payload?.layout?.leftDockPaletteHeight === 'number'
    settings.value = normalizeWorkspaceSettings(payload)
    hydrated.value = true
    return settings.value
  }

  function mergePendingPatch(current: WorkspaceSettings | null, patch: WorkspaceSettings): WorkspaceSettings {
    if (!current) return patch
    return {
      ...current,
      ...patch,
      window: { ...current.window, ...patch.window },
      layout: { ...current.layout, ...patch.layout },
      composer: {
        ...current.composer,
        ...patch.composer,
        modelsByEngine: {
          ...(current.composer?.modelsByEngine || {}),
          ...(patch.composer?.modelsByEngine || {}),
        },
      },
      projects: {
        ...(current.projects || {}),
        ...(patch.projects || {}),
      },
      mapOverviewProjects: {
        ...(current.mapOverviewProjects || {}),
        ...(patch.mapOverviewProjects || {}),
      },
    }
  }

  function trackWrite(promise: Promise<WorkspaceSettings>): Promise<WorkspaceSettings> {
    inFlightWrites.add(promise)
    promise.then(
      () => inFlightWrites.delete(promise),
      () => inFlightWrites.delete(promise),
    )
    return promise
  }

  function schedulePersist(patch: WorkspaceSettings): void {
    settings.value = mergeWorkspaceSettings(settings.value, patch)
    pendingPatch = mergePendingPatch(pendingPatch, patch)
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      const patchToPersist = pendingPatch
      pendingPatch = null
      if (!patchToPersist) return
      const write = workspaceApi.patch(patchToPersist)
      trackWrite(write)
      void write.then((saved) => {
        if (!pendingPatch) settings.value = normalizeWorkspaceSettings(saved)
      }).catch((error) => {
        console.error('[workspace] persist failed', error)
      })
    }, 200)
  }

  async function flush(): Promise<void> {
    const patchToPersist = pendingPatch
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    pendingPatch = null
    if (patchToPersist) {
      settings.value = normalizeWorkspaceSettings(await trackWrite(workspaceApi.patch(patchToPersist)))
    }
    if (inFlightWrites.size) {
      await Promise.allSettled([...inFlightWrites])
    }
  }

  async function patch(patch: WorkspaceSettings): Promise<void> {
    settings.value = mergeWorkspaceSettings(settings.value, patch)
    const saved = normalizeWorkspaceSettings(await trackWrite(workspaceApi.patch(patch)))
    settings.value = pendingPatch
      ? mergeWorkspaceSettings(saved, pendingPatch)
      : saved
  }

  function patchDebounced(patch: WorkspaceSettings): void {
    schedulePersist(patch)
  }

  async function setLastProject(projectPath: string): Promise<void> {
    await patch({ lastProjectPath: projectPath.trim() || '' })
  }

  async function clearLastProject(): Promise<void> {
    await patch({ lastProjectPath: '' })
  }

  function patchLayout(layout: WorkspaceLayoutState): void {
    patchDebounced({ layout })
  }

  function patchComposer(partial: {
    thinkingLevel?: string
    engine?: string
    selection?: EngineProviderBinding
  }): Promise<void> {
    const composer = { ...(settings.value.composer || {}) }
    if (partial.thinkingLevel) composer.thinkingLevel = partial.thinkingLevel
    if (partial.engine && partial.selection) {
      composer.modelsByEngine = {
        ...(composer.modelsByEngine || {}),
        [partial.engine]: partial.selection,
      }
    }
    return patch({ composer })
  }

  function patchProjectEditor(projectPath: string, selection: WorkspaceEditorProjectState): void {
    patchDebounced({
      projects: {
        [projectPath]: selection,
      },
    })
  }

  function readProjectEditor(projectPath: string): WorkspaceEditorProjectState | null {
    return settings.value.projects?.[projectPath] || null
  }

  function patchMapOverviewPositions(projectPath: string, positions: Record<string, { x: number; y: number }>): void {
    patchMapOverviewProject(projectPath, { positions })
  }

  function readMapOverviewPositions(projectPath: string): Record<string, { x: number; y: number }> {
    return settings.value.mapOverviewProjects?.[projectPath]?.positions || {}
  }

  /** Legacy quality is read-tolerant only; fixed one-quarter thumbnails no longer persist quality. */
  function patchMapOverviewThumbnailQuality(_projectPath: string, _thumbnailQuality: MapOverviewThumbnailQuality): void {
    // intentionally no-op: thumbnailQuality must not be written
  }

  function readMapOverviewThumbnailQuality(projectPath: string): MapOverviewThumbnailQuality {
    const quality = settings.value.mapOverviewProjects?.[projectPath]?.thumbnailQuality
    return quality === 'standard' || quality === 'ultra' ? quality : 'high'
  }

  function patchMapOverviewZoom(projectPath: string, zoom: number): void {
    patchMapOverviewProject(projectPath, { zoom: clampMapOverviewZoom(zoom) })
  }

  function readMapOverviewZoom(projectPath: string): number | null {
    const zoom = settings.value.mapOverviewProjects?.[projectPath]?.zoom
    return typeof zoom === 'number' && Number.isFinite(zoom) ? clampMapOverviewZoom(zoom) : null
  }

  function patchMapOverviewLayoutVersion(projectPath: string, layoutVersion: number): void {
    if (!Number.isInteger(layoutVersion) || layoutVersion <= 0) throw new Error('Map overview layout version must be a positive integer.')
    patchMapOverviewProject(projectPath, { layoutVersion })
  }

  function readMapOverviewLayoutVersion(projectPath: string): number | null {
    const layoutVersion = settings.value.mapOverviewProjects?.[projectPath]?.layoutVersion
    return typeof layoutVersion === 'number' && Number.isInteger(layoutVersion) && layoutVersion > 0 ? layoutVersion : null
  }

  function patchMapOverviewLayout(projectPath: string, layout: MapOverviewLayoutId): void {
    if (!isMapOverviewLayoutId(layout)) {
      throw new Error(`Unknown map overview layout id: ${String(layout)}`)
    }
    patchMapOverviewProject(projectPath, { layout })
  }

  function readMapOverviewLayout(projectPath: string): MapOverviewLayoutId {
    return parseMapOverviewLayoutId(
      settings.value.mapOverviewProjects?.[projectPath]?.layout,
      DEFAULT_MAP_OVERVIEW_LAYOUT_ID,
    )
  }

  function patchMapOverviewLayoutParameters<K extends MapOverviewLayoutId>(
    projectPath: string,
    layoutId: K,
    parameters: MapOverviewLayoutParametersById[K],
  ): void {
    const validated = parseMapOverviewLayoutParameters(layoutId, parameters)
    const current = settings.value.mapOverviewProjects?.[projectPath]?.layoutParameters || {}
    const next: MapOverviewLayoutParametersState = { ...current }
    next[layoutId] = validated as MapOverviewLayoutParametersState[K]
    patchMapOverviewProject(projectPath, { layoutParameters: next })
  }

  function readMapOverviewLayoutParameters<K extends MapOverviewLayoutId>(
    projectPath: string,
    layoutId: K,
  ): MapOverviewLayoutParametersById[K] {
    const saved = settings.value.mapOverviewProjects?.[projectPath]?.layoutParameters?.[layoutId]
    return parseMapOverviewLayoutParameters(
      layoutId,
      saved ?? defaultMapOverviewLayoutParameters(layoutId),
    )
  }

  function patchMapOverviewPan(projectPath: string, pan: [number, number]): void {
    if (!Number.isFinite(pan[0]) || !Number.isFinite(pan[1])) {
      throw new Error('Map overview pan must be finite coordinates.')
    }
    patchMapOverviewProject(projectPath, { pan: [pan[0], pan[1]] })
  }

  function readMapOverviewPan(projectPath: string): [number, number] | null {
    const pan = settings.value.mapOverviewProjects?.[projectPath]?.pan
    if (!pan || !Number.isFinite(pan[0]) || !Number.isFinite(pan[1])) return null
    return [pan[0], pan[1]]
  }

  function patchMapOverviewSelection(
    projectPath: string,
    selection: { selectedNodeId?: number | null; selectedEdgeId?: string | null },
  ): void {
    const patch: Partial<WorkspaceMapOverviewProjectState> & {
      selectedNodeId?: number | null
      selectedEdgeId?: string | null
    } = {}
    if ('selectedNodeId' in selection) {
      const id = selection.selectedNodeId
      patch.selectedNodeId = id != null && Number.isInteger(id) && id > 0 ? id : null
    }
    if ('selectedEdgeId' in selection) {
      const edgeId = selection.selectedEdgeId
      patch.selectedEdgeId = typeof edgeId === 'string' && edgeId.trim() ? edgeId.trim() : null
    }
    patchMapOverviewProject(projectPath, patch as Partial<WorkspaceMapOverviewProjectState>)
  }

  function readMapOverviewSelection(projectPath: string): {
    selectedNodeId: number | null
    selectedEdgeId: string | null
  } {
    const state = settings.value.mapOverviewProjects?.[projectPath]
    const nodeId = state?.selectedNodeId
    const edgeId = state?.selectedEdgeId
    return {
      selectedNodeId: typeof nodeId === 'number' && Number.isInteger(nodeId) && nodeId > 0 ? nodeId : null,
      selectedEdgeId: typeof edgeId === 'string' && edgeId.trim() ? edgeId.trim() : null,
    }
  }

  function patchMapOverviewProject(
    projectPath: string,
    partial: Partial<WorkspaceMapOverviewProjectState>,
  ): void {
    const current = settings.value.mapOverviewProjects?.[projectPath]
    patchDebounced({ mapOverviewProjects: { [projectPath]: {
      positions: current?.positions || {},
      ...current,
      ...partial,
    } } })
  }

  function readComposerModel(engine: string): Partial<EngineProviderBinding> {
    return settings.value.composer?.modelsByEngine?.[engine] || {}
  }

  function hydrateWorkbenchLayout(): void {
    const ui = useWorkbenchUiStore()
    const layout = normalizeWorkspaceLayout(settings.value.layout)
    ui.appRailOpen = layout.appRailOpen ?? true
    ui.agentPanelOpen = layout.agentPanelOpen ?? true
    ui.bottomPanelOpen = layout.bottomPanelOpen ?? false
    ui.leftDockTilesOpen = layout.leftDockTilesOpen ?? true
    if (leftDockWidthPersisted.value && layout.leftDockWidth != null) {
      ui.setLeftDockWidth(layout.leftDockWidth)
    }
    if (paletteHeightPersisted.value && layout.leftDockPaletteHeight != null) {
      ui.setLeftDockPaletteHeight(layout.leftDockPaletteHeight)
    }
  }

  function markPaletteHeightPersisted(height: number): void {
    paletteHeightPersisted.value = true
    useWorkbenchUiStore().setLeftDockPaletteHeight(height)
  }

  function markLeftDockWidthPersisted(width: number): void {
    leftDockWidthPersisted.value = true
    const ui = useWorkbenchUiStore()
    ui.setLeftDockWidth(width)
    patchLayout({ leftDockWidth: ui.leftDockWidth })
  }

  function bindWorkbenchLayoutPersistence(): void {
    if (layoutWatchBound) return
    layoutWatchBound = true
    const ui = useWorkbenchUiStore()
    watch(
      () => [
        ui.appRailOpen,
        ui.agentPanelOpen,
        ui.bottomPanelOpen,
        ui.leftDockTilesOpen,
        ui.leftDockWidth,
        ui.leftDockPaletteHeight,
      ],
      () => {
        const layoutPatch: WorkspaceLayoutState = {
          appRailOpen: ui.appRailOpen,
          agentPanelOpen: ui.agentPanelOpen,
          bottomPanelOpen: ui.bottomPanelOpen,
          leftDockTilesOpen: ui.leftDockTilesOpen,
        }
        if (leftDockWidthPersisted.value) {
          layoutPatch.leftDockWidth = ui.leftDockWidth
        }
        if (paletteHeightPersisted.value) {
          layoutPatch.leftDockPaletteHeight = ui.leftDockPaletteHeight
        }
        patchLayout(layoutPatch)
      },
    )
  }

  async function migrateFromBrowserStorage(): Promise<void> {
    const sessionModelSelections: Record<string, string> = {}
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index)
        if (!key || !key.startsWith('rmmv.chat.model:')) continue
        const value = sessionStorage.getItem(key)
        if (!value) continue
        sessionModelSelections[key.slice('rmmv.chat.model:'.length)] = value
      }
    } catch {
      // sessionStorage unavailable
    }

    let editorWorkspace: string | null = null
    let agentPanelWidth: string | null = null
    let chatHistoryWidth: string | null = null
    let composerPrefs: string | null = null
    try {
      editorWorkspace = localStorage.getItem(LEGACY_EDITOR_WORKSPACE_KEY)
      agentPanelWidth = localStorage.getItem(LEGACY_AGENT_PANEL_WIDTH_KEY)
      chatHistoryWidth = localStorage.getItem(LEGACY_CHAT_HISTORY_WIDTH_KEY)
      composerPrefs = localStorage.getItem(LEGACY_CHAT_COMPOSER_KEY)
    } catch {
      return
    }

    const hasLegacy = Boolean(
      editorWorkspace
      || agentPanelWidth
      || chatHistoryWidth
      || composerPrefs
      || Object.keys(sessionModelSelections).length,
    )
    if (!hasLegacy) return

    const migrationPatch = filterLegacyWorkspaceMigrationPatch(settings.value, buildWorkspaceMigrationPatch({
      editorWorkspace,
      agentPanelWidth,
      chatHistoryWidth,
      composerPrefs,
      sessionModelSelections,
    }))
    settings.value = mergeWorkspaceSettings(settings.value, migrationPatch)
    settings.value = normalizeWorkspaceSettings(await trackWrite(workspaceApi.patch(migrationPatch)))

    try {
      localStorage.removeItem(LEGACY_EDITOR_WORKSPACE_KEY)
      localStorage.removeItem(LEGACY_AGENT_PANEL_WIDTH_KEY)
      localStorage.removeItem(LEGACY_CHAT_HISTORY_WIDTH_KEY)
      for (const engine of Object.keys(sessionModelSelections)) {
        sessionStorage.removeItem(chatSelectionStorageKey(engine))
      }
    } catch {
      // ignore cleanup failures
    }
  }

  return {
    settings,
    hydrated,
    load,
    flush,
    patch,
    patchDebounced,
    setLastProject,
    clearLastProject,
    patchLayout,
    patchComposer,
    patchProjectEditor,
    readProjectEditor,
    patchMapOverviewPositions,
    readMapOverviewPositions,
    patchMapOverviewThumbnailQuality,
    readMapOverviewThumbnailQuality,
    patchMapOverviewZoom,
    readMapOverviewZoom,
    patchMapOverviewLayoutVersion,
    readMapOverviewLayoutVersion,
    patchMapOverviewLayout,
    readMapOverviewLayout,
    patchMapOverviewLayoutParameters,
    readMapOverviewLayoutParameters,
    patchMapOverviewPan,
    readMapOverviewPan,
    patchMapOverviewSelection,
    readMapOverviewSelection,
    readComposerModel,
    hydrateWorkbenchLayout,
    bindWorkbenchLayoutPersistence,
    migrateFromBrowserStorage,
    leftDockWidthPersisted,
    markLeftDockWidthPersisted,
    paletteHeightPersisted,
    markPaletteHeightPersisted,
  }
})
