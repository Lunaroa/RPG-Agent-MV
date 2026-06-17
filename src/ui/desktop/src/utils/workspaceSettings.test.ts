import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceMigrationPatch,
  computeMaxPaletteHeight,
  filterLegacyWorkspaceMigrationPatch,
  isLikelyMaximizedWindowBounds,
  isValidWindowBounds,
  mergeWorkspaceSettings,
  normalizeWorkspaceSettings,
  resolveStoredProjectPath,
} from './workspaceSettings'

describe('workspaceSettings', () => {
  it('normalizes layout defaults', () => {
    const settings = normalizeWorkspaceSettings({})
    expect(settings.layout?.appRailOpen).toBe(true)
    expect(settings.layout?.leftDockTilesOpen).toBe(true)
    expect(settings.layout?.leftDockPaletteHeight).toBeUndefined()
    expect(settings.layout?.agentPanelWidth).toBe(480)
  })

  it('computes max palette height from workbench height', () => {
    expect(computeMaxPaletteHeight(600)).toBe(600 - 190 - 8)
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
