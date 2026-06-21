import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate } from '../i18n/messages.ts'

export type ToolPresentationKind = 'command' | 'subagent' | 'task' | 'plan' | 'tool'

export interface ToolPresentationSummary {
  kind: ToolPresentationKind
  label: string
  target: string
}

const COMMAND_TOOL_PATTERN = /(^|[._-])(bash|shell|powershell|command|cmd|exec|terminal)([._-]|$)/i
const SUBAGENT_TOOL_PATTERN = /(^|[._-])(agent|subagent|spawn_agent)([._-]|$)/i
const TODO_TOOL_PATTERN = /(^|[._-])(todo|todoread|todowrite|tasklist|taskupdate|taskboard|task_board)([._-]|$)/i
const PLAN_TOOL_PATTERN = /(^|[._-])(plan|enterplanmode|exitplanmode)([._-]|$)/i
const READ_TOOL_PATTERN = /(^|[._-])(read|fileread|file_read)([._-]|$)/i
const WRITE_TOOL_PATTERN = /(^|[._-])(write|edit|filewrite|file_write|apply_patch)([._-]|$)/i
const GLOB_TOOL_PATTERN = /(^|[._-])(glob|globfilesearch|glob_file_search)([._-]|$)/i
const GREP_TOOL_PATTERN = /(^|[._-])(grep|rg|ripgrep|search)([._-]|$)/i

export function summarizeToolCall(tool: unknown, input: unknown, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): ToolPresentationSummary {
  language = normalizeProductLanguage(language)
  const rawTool = cleanToolName(String(tool || 'tool'))
  const normalized = rawTool.toLowerCase()

  if (isCommandTool(normalized)) {
    return {
      kind: 'command',
      label: translate('tool.action.runCommand', language),
      target: truncate(findStringField(input, ['command', 'cmd', 'script', 'executable']) || pickTarget(input)),
    }
  }

  if (isTaskTool(rawTool, normalized)) {
    return {
      kind: 'task',
      label: translate('tool.action.updateTasks', language),
      target: truncate(findStringField(input, ['title', 'task', 'todo', 'description', 'content']) || ''),
    }
  }

  if (isSubagentTool(normalized)) {
    return {
      kind: 'subagent',
      label: translate('tool.action.startSubagent', language),
      target: truncate(findStringField(input, ['description', 'task', 'task_description', 'title', 'name']) || ''),
    }
  }

  if (isPlanTool(normalized)) {
    return {
      kind: 'plan',
      label: translate('tool.action.updatePlan', language),
      target: '',
    }
  }

  if (isReadTool(normalized)) {
    return {
      kind: 'tool',
      label: translate('tool.action.readFile', language),
      target: truncate(findStringField(input, ['path', 'file', 'filePath', 'file_path', 'filename']) || pickTarget(input)),
    }
  }

  if (isWriteTool(normalized)) {
    return {
      kind: 'tool',
      label: translate('tool.action.writeFile', language),
      target: truncate(findStringField(input, ['path', 'file', 'filePath', 'file_path', 'filename']) || pickTarget(input)),
    }
  }

  if (isGlobTool(normalized)) {
    return {
      kind: 'tool',
      label: translate('tool.action.findFiles', language),
      target: truncate(findStringField(input, ['pattern', 'glob_pattern', 'globPattern']) || pickTarget(input)),
    }
  }

  if (isGrepTool(normalized)) {
    return {
      kind: 'tool',
      label: translate('tool.action.searchContent', language),
      target: truncate(findStringField(input, ['pattern', 'query', 'regex', 'search']) || pickTarget(input)),
    }
  }

  const fallbackTarget = truncate(pickTarget(input))
  return {
    kind: 'tool',
    label: translate('tool.action.callTool', language),
    target: fallbackTarget || rawTool || translate('tool.action.unknownTool', language),
  }
}

function isCommandTool(normalized: string): boolean {
  return normalized === 'shell'
    || normalized === 'bash'
    || normalized === 'cmd'
    || COMMAND_TOOL_PATTERN.test(normalized)
}

function isSubagentTool(normalized: string): boolean {
  return normalized === 'agent'
    || normalized === 'subagent'
    || normalized === 'task'
    || SUBAGENT_TOOL_PATTERN.test(normalized)
}

function isTaskTool(rawTool: string, normalized: string): boolean {
  return rawTool === 'TASK'
    || normalized === 'tasklist'
    || normalized === 'taskupdate'
    || normalized === 'todowrite'
    || normalized === 'todoread'
    || normalized === 'todo'
    || TODO_TOOL_PATTERN.test(normalized)
}

function isPlanTool(normalized: string): boolean {
  return normalized === 'plan'
    || normalized === 'enterplanmode'
    || normalized === 'exitplanmode'
    || PLAN_TOOL_PATTERN.test(normalized)
}

function isReadTool(normalized: string): boolean {
  return normalized === 'read' || READ_TOOL_PATTERN.test(normalized)
}

function isWriteTool(normalized: string): boolean {
  return normalized === 'write'
    || normalized === 'edit'
    || WRITE_TOOL_PATTERN.test(normalized)
}

function isGlobTool(normalized: string): boolean {
  return normalized === 'glob' || GLOB_TOOL_PATTERN.test(normalized)
}

function isGrepTool(normalized: string): boolean {
  return normalized === 'grep' || GREP_TOOL_PATTERN.test(normalized)
}

function cleanToolName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const mcpMatch = /^mcp__[^_]+__(.+)$/.exec(trimmed)
  if (mcpMatch?.[1]) return mcpMatch[1]
  const parts = trimmed.split(/[.:/\\]/).filter(Boolean)
  return parts.at(-1) || trimmed
}

function findStringField(value: unknown, keys: string[], depth = 0): string {
  if (depth > 3 || value == null) return ''
  if (typeof value === 'string') return ''
  if (typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringField(item, keys, depth + 1)
      if (found) return found
    }
    return ''
  }

  const record = value as Record<string, unknown>
  const wanted = new Set(keys.map((key) => key.toLowerCase()))
  for (const [key, item] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && typeof item === 'string' && item.trim()) {
      return item.trim()
    }
  }
  for (const item of Object.values(record)) {
    const found = findStringField(item, keys, depth + 1)
    if (found) return found
  }
  return ''
}

function pickTarget(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  if (typeof input !== 'object') return String(input)
  const value = findStringField(input, [
    'path',
    'file',
    'filePath',
    'file_path',
    'filename',
    'pattern',
    'query',
    'url',
    'project',
    'mapId',
    'name',
    'action',
  ])
  return value
}

function truncate(value: string, max = 80): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine
}
