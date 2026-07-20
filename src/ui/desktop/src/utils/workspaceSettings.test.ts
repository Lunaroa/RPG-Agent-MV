import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceMigrationPatch,
  clampPaletteHeight,
  clampLeftDockWidth,
  computeMaxPaletteHeight,
  DEFAULT_LEFT_DOCK_WIDTH,
  filterLegacyWorkspaceMigrationPatch,
  isLikelyMaximizedWindowBounds,
  isValidWindowBounds,
  mergeWorkspaceSettings,
  normalizeWorkspaceSettings,
  normalizeMapPreviewOverrides,
  PALETTE_MAX_PERSISTED_HEIGHT,
  PALETTE_MIN_TREE_HEIGHT,
  PALETTE_PANE_RESIZER_HEIGHT,
  resolveStoredProjectPath,
} from './workspaceSettings'

describe('workspaceSettings', () => {
  it('normalizes layout defaults', () => {
    const settings = normalizeWorkspaceSettings({})
    expect(settings.layout?.appRailOpen).toBe(true)
    expect(settings.layout?.leftDockTilesOpen).toBe(true)
    expect(settings.layout?.leftDockWidth).toBeUndefined()
    expect(settings.layout?.leftDockPaletteHeight).toBeUndefined()
    expect(settings.layout?.agentPanelWidth).toBe(480)
    expect(settings.suppressProjectCompatibilityWarnings).toBe(false)
  })

  it('persists the project compatibility warning preference without resetting other settings', () => {
    const merged = mergeWorkspaceSettings(
      { lastProjectPath: 'projects/Project' },
      { suppressProjectCompatibilityWarnings: true },
    )

    expect(merged.lastProjectPath).toBe('projects/Project')
    expect(merged.suppressProjectCompatibilityWarnings).toBe(true)
  })

  it('normalizes and independently preserves MV and MZ playtest runtime selections', () => {
    const normalized = normalizeWorkspaceSettings({
      playtestRuntimes: {
        'rpg-maker-mv': '  runtime/mv  ',
        'rpg-maker-mz': '',
      },
    })
    expect(normalized.playtestRuntimes).toEqual({ 'rpg-maker-mv': 'runtime/mv' })

    const merged = mergeWorkspaceSettings(
      { playtestRuntimes: { 'rpg-maker-mv': 'runtime/mv' } },
      { playtestRuntimes: { 'rpg-maker-mz': 'runtime/mz' } },
    )
    expect(merged.playtestRuntimes).toEqual({
      'rpg-maker-mv': 'runtime/mv',
      'rpg-maker-mz': 'runtime/mz',
    })
  })

  it('migrates the previous version-warning preference to compatibility warnings', () => {
    const settings = normalizeWorkspaceSettings({ suppressUnsupportedMZVersionWarnings: true })
    expect(settings.suppressProjectCompatibilityWarnings).toBe(true)
  })

  it('computes max palette height from workbench height', () => {
    expect(PALETTE_MIN_TREE_HEIGHT).toBe(64)
    expect(computeMaxPaletteHeight(600)).toBe(600 - PALETTE_MIN_TREE_HEIGHT - PALETTE_PANE_RESIZER_HEIGHT)
    expect(computeMaxPaletteHeight(800)).toBe(800 - PALETTE_MIN_TREE_HEIGHT - PALETTE_PANE_RESIZER_HEIGHT)
    expect(computeMaxPaletteHeight(900)).toBe(900 - PALETTE_MIN_TREE_HEIGHT - PALETTE_PANE_RESIZER_HEIGHT)
  })

  it('keeps a large persisted preference while leaving viewport clamping to the dock', () => {
    expect(clampPaletteHeight(720)).toBe(720)
    expect(clampPaletteHeight(PALETTE_MAX_PERSISTED_HEIGHT + 500)).toBe(PALETTE_MAX_PERSISTED_HEIGHT)
  })

  it('normalizes and clamps a persisted left dock width', () => {
    expect(DEFAULT_LEFT_DOCK_WIDTH).toBe(320)
    expect(clampLeftDockWidth(120)).toBe(214)
    expect(clampLeftDockWidth(640)).toBe(520)

    expect(normalizeWorkspaceSettings({
      layout: { leftDockWidth: 412.6 },
    }).layout?.leftDockWidth).toBe(413)
    expect(normalizeWorkspaceSettings({
      layout: { leftDockWidth: Number.NaN },
    }).layout?.leftDockWidth).toBeUndefined()
  })

  it('persists left dock width in partial layout patches', () => {
    const merged = mergeWorkspaceSettings(
      { layout: { leftDockWidth: 320, leftDockPaletteHeight: 240 } },
      { layout: { leftDockWidth: 480 } },
    )

    expect(merged.layout?.leftDockWidth).toBe(480)
    expect(merged.layout?.leftDockPaletteHeight).toBe(240)
  })

  it('merges nested project editor state', () => {
    const merged = mergeWorkspaceSettings(
      {
        projects: {
          'projects/A': { mapId: 1, mode: 'map', zoom: 1 },
        },
      },
      {
        projects: {
          'projects/A': { mapId: 2, mode: 'event', tileTab: 'B' },
        },
      },
    )
    expect(merged.projects?.['projects/A']).toEqual({
      mapId: 2,
      mode: 'event',
      zoom: 1,
      tileTab: 'B',
    })
  })

  it('preserves the read-only map preview mode in project editor state', () => {
    const settings = normalizeWorkspaceSettings({
      projects: {
        'projects/sample': { mapId: 4, mode: 'preview' },
      },
    })
    expect(settings.projects?.['projects/sample']).toEqual({ mapId: 4, mode: 'preview' })
  })

  it('normalizes project-wide map preview switch and variable overrides', () => {
    expect(normalizeMapPreviewOverrides({
      switches: { '1': true, '02': false, bad: true, '3': 1 },
      variables: { '4': 12, '5': Number.NaN, '-1': 2, '6': '7' },
    })).toEqual({
      switches: { '1': true, '2': false },
      variables: { '4': 12 },
    })
  })

  it('merges shared preview overrides without resetting editor selection', () => {
    const merged = mergeWorkspaceSettings(
      { projects: { 'projects/sample': { mapId: 1, mode: 'preview', previewOverrides: { switches: { '7': true }, variables: {} } } } },
      { projects: { 'projects/sample': { mapId: 2, mode: 'preview', previewOverrides: { switches: { '7': true }, variables: { '8': 42 } } } } },
    )
    expect(merged.projects?.['projects/sample']).toEqual({
      mapId: 2,
      mode: 'preview',
      previewOverrides: { switches: { '7': true }, variables: { '8': 42 } },
    })
  })

  it('merges partial workspace patches without resetting unrelated state', () => {
    const merged = mergeWorkspaceSettings(
      {
        lastProjectPath: 'projects/Project',
        layout: {
          appRailOpen: false,
          agentPanelOpen: false,
          bottomPanelOpen: true,
          leftDockTilesOpen: false,
          agentPanelWidth: 620,
          chatHistoryWidth: 360,
        },
        composer: {
          thinkingLevel: 'medium',
          modelsByEngine: {
            opencode: { providerId: 'deepseek-claude', modelId: 'deepseek-v4-pro' },
          },
        },
      },
      {
        lastProjectPath: 'projects/sample-project',
      },
    )

    expect(merged.lastProjectPath).toBe('projects/sample-project')
    expect(merged.layout?.appRailOpen).toBe(false)
    expect(merged.layout?.agentPanelOpen).toBe(false)
    expect(merged.layout?.bottomPanelOpen).toBe(true)
    expect(merged.layout?.leftDockTilesOpen).toBe(false)
    expect(merged.layout?.agentPanelWidth).toBe(620)
    expect(merged.layout?.chatHistoryWidth).toBe(360)
    expect(merged.composer?.thinkingLevel).toBe('medium')
    expect(merged.composer?.modelsByEngine?.opencode).toEqual({
      providerId: 'deepseek-claude',
      modelId: 'deepseek-v4-pro',
    })
  })

  it('clears the stored project path when explicitly patched empty', () => {
    const merged = mergeWorkspaceSettings(
      {
        lastProjectPath: 'projects/Project',
        layout: { appRailOpen: false },
      },
      {
        lastProjectPath: '',
      },
    )

    expect(merged.lastProjectPath).toBeUndefined()
    expect(merged.layout?.appRailOpen).toBe(false)
  })

  it('resolves stored project path with fallback', () => {
    const projects = [
      { path: 'projects/Project', isDefault: true },
      { path: 'projects/Other', isDefault: false },
    ]
    expect(resolveStoredProjectPath('projects/Other', projects)).toBe('projects/Other')
    expect(resolveStoredProjectPath('projects/Missing', projects)).toBe('projects/Project')
  })

  it('restores sample-project when it is the stored project path', () => {
    const projects = [
      { path: 'projects/Project', isDefault: true },
      { path: 'projects/sample-project', isDefault: false },
    ]
    expect(resolveStoredProjectPath('projects/sample-project', projects)).toBe('projects/sample-project')
  })

  it('migrates legacy browser storage into workspace patch', () => {
    const patch = buildWorkspaceMigrationPatch({
      agentPanelWidth: '420',
      chatHistoryWidth: '300',
      composerPrefs: JSON.stringify({ thinkingLevel: 'high' }),
      sessionModelSelections: {
        opencode: JSON.stringify({ providerId: 'anthropic', modelId: 'claude-sonnet' }),
      },
      editorWorkspace: JSON.stringify({
        'projects/Demo': { mapId: 3, mode: 'event', zoom: 0.5 },
      }),
    })
    expect(patch.layout?.agentPanelWidth).toBe(420)
    expect(patch.layout?.chatHistoryWidth).toBe(300)
    expect(patch.composer?.thinkingLevel).toBe('high')
    expect(patch.composer?.modelsByEngine?.opencode).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
    })
    expect(patch.projects?.['projects/Demo']?.mapId).toBe(3)
  })

  it('ignores legacy browser model selections from removed engines', () => {
    const patch = buildWorkspaceMigrationPatch({
      sessionModelSelections: {
        'local-agent': JSON.stringify({ providerId: 'anthropic', modelId: 'claude-sonnet' }),
      },
    })
    expect(patch.composer?.modelsByEngine).toBeUndefined()
  })

  it('does not let legacy browser migration overwrite existing persisted workspace state', () => {
    const legacyPatch = buildWorkspaceMigrationPatch({
      composerPrefs: JSON.stringify({ thinkingLevel: 'low' }),
      sessionModelSelections: {
        opencode: JSON.stringify({ providerId: 'old-provider', modelId: 'old-model' }),
      },
      editorWorkspace: JSON.stringify({
        'projects/sample-project': { mapId: 1, mode: 'map' },
        'projects/New': { mapId: 2, mode: 'event' },
      }),
    })
    const filtered = filterLegacyWorkspaceMigrationPatch(
      {
        composer: {
          thinkingLevel: 'medium',
          modelsByEngine: {
            opencode: { providerId: 'custom-openai', modelId: 'custom/deepseek-v4-pro' },
          },
        },
        projects: {
          'projects/sample-project': { mapId: 18, mode: 'event' },
        },
      },
      legacyPatch,
    )

    expect(filtered.composer).toBeUndefined()
    expect(filtered.projects?.['projects/sample-project']).toBeUndefined()
    expect(filtered.projects?.['projects/New']).toEqual({ mapId: 2, mode: 'event' })
  })

  it('validates window bounds', () => {
    expect(isValidWindowBounds({ x: 10, y: 20, width: 1280, height: 800 })).toBe(true)
    expect(isValidWindowBounds({ x: 10, y: 20, width: 200, height: 800 })).toBe(false)
  })

  it('detects saved work-area-sized bounds as maximized window bounds', () => {
    const workArea = { x: 0, y: 0, width: 2000, height: 1160 }
    expect(isLikelyMaximizedWindowBounds({ x: 0, y: 0, width: 2000, height: 1160 }, workArea)).toBe(true)
    expect(isLikelyMaximizedWindowBounds({ x: 320, y: 180, width: 1280, height: 800 }, workArea)).toBe(false)
  })
})
