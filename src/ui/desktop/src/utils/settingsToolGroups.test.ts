import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CapabilityToolEntry } from '../api/client'
import { buildSettingsToolGroups } from './settingsToolGroups.ts'

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
    ], 'zh-CN')

    assert.deepEqual(groups.map((group) => group.layer), ['core', 'network', 'subagent', 'zzz'])
    assert.equal(groups[0].label, '核心文件工具')
    assert.equal(groups[3].label, '扩展工具')
  })

  it('can label known groups in English', () => {
    const groups = buildSettingsToolGroups([
      tool('WebFetch', 'network'),
      tool('Read', 'core'),
    ], 'en-US')

    assert.deepEqual(groups.map((group) => group.label), ['Core file tools', 'Network tools'])
  })

  it('localizes known runtime disabled reasons and warnings in English', () => {
    const read = tool('Read', 'core')
    read.disabledReason = '需要启用环境变量 RMMV_EXPERIMENTAL_TOOLS'
    read.warning = '已在运行策略 allow，但当前运行环境不满足启用条件'
    const agent = tool('Agent', 'subagent')
    agent.disabledReason = '此工具由 opencode 运行时管理，不能通过设置页启用'

    const groups = buildSettingsToolGroups([read, agent], 'en-US')
    const items = groups.flatMap((group) => group.items)

    assert.equal(
      items.find((item) => item.id === 'Read')?.disabledReason,
      'Environment variable RMMV_EXPERIMENTAL_TOOLS must be enabled',
    )
    assert.equal(
      items.find((item) => item.id === 'Read')?.warning,
      'Allowed in the runtime policy, but the current runtime environment does not meet the requirements',
    )
    assert.equal(
      items.find((item) => item.id === 'Agent')?.disabledReason,
      'This tool is managed by the opencode runtime and cannot be enabled from Settings',
    )
  })
})
