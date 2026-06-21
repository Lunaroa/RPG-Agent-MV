import type { CapabilityToolEntry } from '../api/client'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { pickByLocale, translate, type MessageKey } from '../i18n/messages.ts'

const GROUP_LABEL_KEYS: Record<string, MessageKey> = {
  core: 'toolgroup.core',
  network: 'toolgroup.network',
  subagent: 'toolgroup.subagent',
  task: 'toolgroup.task',
  editing: 'toolgroup.editing',
  plan: 'toolgroup.plan',
  memory: 'toolgroup.memory',
  worktree: 'toolgroup.worktree',
  team: 'toolgroup.team',
  automation: 'toolgroup.automation',
  code: 'toolgroup.code',
  extra: 'toolgroup.extra',
  diagnostic: 'toolgroup.diagnostic',
  internal: 'toolgroup.internal',
  rmmv: 'toolgroup.rmmv',
}

const GROUP_ORDER = new Map(
  Object.keys(GROUP_LABEL_KEYS).map((layer, index) => [layer, index]),
)

export interface ToolGroup {
  layer: string
  label: string
  items: CapabilityToolEntry[]
}

export function buildSettingsToolGroups(tools: CapabilityToolEntry[], language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): ToolGroup[] {
  language = normalizeProductLanguage(language)
  const groups = new Map<string, ToolGroup>()
  for (const tool of tools) {
    const layer = tool.layer || 'extra'
    const group = groups.get(layer) || {
      layer,
      label: translate(GROUP_LABEL_KEYS[layer] || 'toolgroup.extra', language),
      items: [],
    }
    group.items.push(localizeToolEntry(tool, language))
    groups.set(layer, group)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => {
      const ai = GROUP_ORDER.get(a.layer) ?? Number.MAX_SAFE_INTEGER
      const bi = GROUP_ORDER.get(b.layer) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      return a.label.localeCompare(b.label)
    })
}

function localizeToolEntry(tool: CapabilityToolEntry, language: ProductLanguage): CapabilityToolEntry {
  return pickByLocale<() => CapabilityToolEntry>(language, {
    'zh-CN': () => tool,
    'en-US': () => ({
      ...tool,
      disabledReason: tool.disabledReason ? localizeRuntimeToolMessage(tool.disabledReason) : tool.disabledReason,
      warning: tool.warning ? localizeRuntimeToolMessage(tool.warning) : tool.warning,
    }),
  })()
}

function localizeRuntimeToolMessage(message: string): string {
  const envTruthy = message.match(/^需要启用环境变量 (.+)$/)
  if (envTruthy) return `Environment variable ${envTruthy[1]} must be enabled`
  const envEquals = message.match(/^需要环境变量 (.+)$/)
  if (envEquals) return `Environment variable ${envEquals[1]} is required`
  const platform = message.match(/^只支持 (.+) 平台$/)
  if (platform) return `Only supported on ${platform[1]}`
  const nodeEnv = message.match(/^只在 NODE_ENV=(.+) 时可用$/)
  if (nodeEnv) return `Only available when NODE_ENV=${nodeEnv[1]}`
  const feature = message.match(/^需要 opencode 构建特性 (.+)$/)
  if (feature) return `Requires opencode build feature ${feature[1]}`
  if (message === '此工具由 opencode 运行时管理，不能通过设置页启用') {
    return 'This tool is managed by the opencode runtime and cannot be enabled from Settings'
  }
  if (message === '当前运行环境不满足工具启用条件') {
    return 'The current runtime environment does not meet this tool’s requirements'
  }
  if (message === '此工具不能通过设置页切换') {
    return 'This tool cannot be toggled from Settings'
  }
  if (message === '已在运行策略 allow，但 opencode profile 未包含此基础工具') {
    return 'Allowed in the runtime policy, but the opencode profile does not include this builtin tool'
  }
  if (message === '已在运行策略 allow，但当前运行环境不满足启用条件') {
    return 'Allowed in the runtime policy, but the current runtime environment does not meet the requirements'
  }
  return message
}
