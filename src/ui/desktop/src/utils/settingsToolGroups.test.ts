import { describe, expect, it } from 'vitest'
import type { CapabilityToolEntry } from '../api/client'
import { buildSettingsToolGroups } from './settingsToolGroups'

function tool(id: string, layer: string): CapabilityToolEntry {
  return {
    id,
    kind: 'builtin',
    layer,
    title: id,
    description: '',
    readOnly: true,
    riskLevel: 'normal',
    riskBadges: [],
    allowed: false,
    denied: false,
    inAgentRuntimeProfile: false,
    inAgentAllow: false,
    available: true,
    toggleable: true,
    disabledReason: null,
    requiresNewSession: true,
    warning: null,
  }
}

describe('settingsToolGroups', () => {
  it('groups tools by product order and keeps unknown layers last', () => {
    const groups = buildSettingsToolGroups([
      tool('WebFetch', 'network'),
      tool('Read', 'core'),
      tool('Agent', 'subagent'),
      tool('Custom', 'zzz'),
    ])

    expect(groups.map((group) => group.layer)).toEqual(['core', 'network', 'subagent', 'zzz'])
    expect(groups[0].label).toBe('核心文件工具')
    expect(groups[3].label).toBe('zzz')
  })
})
