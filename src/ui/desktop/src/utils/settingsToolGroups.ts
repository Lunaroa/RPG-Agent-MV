import type { CapabilityToolEntry } from '../api/client'

const GROUP_LABELS: Record<string, string> = {
  core: '核心文件工具',
  network: '联网工具',
  subagent: 'subagent',
  task: '任务清单',
  editing: '编辑扩展',
  plan: '计划与问答',
  memory: '记忆与配置',
  worktree: '工作树',
  team: '团队协作',
  automation: '自动化',
  code: '代码智能',
  extra: '扩展工具',
  diagnostic: '诊断实验',
  internal: '内部工具',
  rmmv: 'RMMV MCP',
}

const GROUP_ORDER = new Map(
  Object.keys(GROUP_LABELS).map((layer, index) => [layer, index]),
)

export interface ToolGroup {
  layer: string
  label: string
  items: CapabilityToolEntry[]
}

export function buildSettingsToolGroups(tools: CapabilityToolEntry[]): ToolGroup[] {
  const groups = new Map<string, ToolGroup>()
  for (const tool of tools) {
    const layer = tool.layer || 'extra'
    const group = groups.get(layer) || {
      layer,
      label: GROUP_LABELS[layer] || layer,
      items: [],
    }
    group.items.push(tool)
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
