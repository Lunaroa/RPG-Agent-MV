import type { ChatSegment } from '../composables/useSessionStream'
import type { ProductLanguage } from '@contract/types'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'
import { translate, type MessageKey } from '../i18n/messages.ts'

export interface ChatTurn {
  id: string
  user?: ChatSegment
  timeline: ChatTimelineItem[]
  artifact?: ChatSegment
}

export interface ExecutionGroup {
  type: 'execution-group'
  id: string
  segments: ChatSegment[]
}

export interface ExecutionGroupSummary {
  state: 'failed' | 'blocked' | 'stopped' | 'running' | 'complete'
  createdFiles: number
  editedFiles: number
  commands: number
  text: string
}

export type ChatTimelineItem = ChatSegment | ExecutionGroup

const FAILURE_STATUSES = new Set(['failed', 'error', 'timeout'])
const BLOCKED_STATUSES = new Set(['blocked'])
const STOPPED_STATUSES = new Set(['stopped', 'interrupted'])
const RUNNING_STATUSES = new Set(['preparing', 'starting', 'running'])
const FILE_PATH_KEYS = new Set([
  'path',
  'file',
  'filepath',
  'file_path',
  'filename',
  'target',
  'targetpath',
  'target_path',
])
const FILE_PATH_COLLECTION_KEYS = new Set(['files', 'paths'])
const PATCH_TEXT_KEYS = new Set(['patch', 'diff', 'content', 'text'])
const CREATE_TOOL_PATTERN = /(?:^|[._-])(?:create|new|add)[_-]?file(?:$|[._-])/
const MUTATE_TOOL_PATTERN = /(?:^|[._-])(?:apply[_-]?patch|patch|edit|update|write|delete|remove|move|rename|replace|save)(?:$|[._-])/
const DIRECTORY_TOOL_PATTERN = /(?:^|[._-])(?:directory|folder|mkdir)(?:$|[._-])/
const CREATED_OUTPUT_PATTERN = /\b(?:created|added|new file|file written)\b|已创建|新建/i

function isMetaType(segment: ChatSegment, type: string): boolean {
  return segment.type === 'meta' && segment.metadata?.type === type
}

function isExecutionSegment(segment: ChatSegment): boolean {
  if (segment.type === 'tool' || segment.type === 'status') return true
  // artifact 与事件预览块是独立内嵌展示，不并入「已运行 N 条命令」折叠组。
  return segment.type === 'meta'
    && !isMetaType(segment, 'artifact')
    && !isMetaType(segment, 'event-preview-list')
    && !isMetaType(segment, 'slash_status')
}

function isEmptyTypedSegment(segment: ChatSegment): boolean {
  return (segment.type === 'text' || segment.type === 'reasoning')
    && !segment.content.trim()
}

export function groupExecutionSegments(segments: ChatSegment[]): ChatTimelineItem[] {
  const timeline: ChatTimelineItem[] = []
  let executionGroup: ExecutionGroup | null = null

  for (const segment of segments) {
    if (isEmptyTypedSegment(segment)) continue

    if (isExecutionSegment(segment)) {
      if (!executionGroup) {
        executionGroup = {
          type: 'execution-group',
          id: `execution-${segment.id}`,
          segments: [],
        }
        timeline.push(executionGroup)
      }
      executionGroup.segments.push(segment)
      continue
    }

    executionGroup = null
    timeline.push(segment)
  }

  return timeline
}

function hasPassBeforeFinalizeError(group: ExecutionGroup): boolean {
  let sawPass = false
  for (const segment of group.segments) {
    const status = segmentStatus(segment)
    if (status === 'pass') sawPass = true
    if (sawPass && status === 'error') return true
  }
  return false
}

export function summarizeExecutionGroup(group: ExecutionGroup, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): ExecutionGroupSummary {
  language = normalizeProductLanguage(language)
  const summarySegment = [...group.segments].reverse().find((segment) => isMetaType(segment, 'summary'))
  const passedDespiteTransientError = summarySegment?.metadata?.status === 'pass'
    || hasPassBeforeFinalizeError(group)
  const hasFailure = !passedDespiteTransientError && group.segments.some(isFailureSegment)
  const hasBlocked = !hasFailure && group.segments.some(isBlockedSegment)
  const hasStopped = !hasFailure && !hasBlocked && group.segments.some(isStoppedSegment)
  const lastStatus = [...group.segments].reverse().find((segment) => segment.type === 'status')
  const isRunning = !hasFailure && !hasBlocked && !hasStopped && (
    lastStatus
      ? RUNNING_STATUSES.has(String(lastStatus.metadata?.status || ''))
      : group.segments.some((segment) =>
        segment.type === 'tool' && segment.metadata?.status === 'running'
      )
  )
  const createdFiles = new Set<string>()
  const editedFiles = new Set<string>()
  const mirroredCommands = new Set<string>()
  let commands = 0

  for (const segment of group.segments) {
    if (segment.type !== 'tool') continue

    const files = classifyToolFiles(segment)
    if (files.created.length || files.edited.length) {
      for (const path of files.created) {
        createdFiles.add(path)
        editedFiles.delete(path)
      }
      for (const path of files.edited) {
        if (!createdFiles.has(path)) editedFiles.add(path)
      }
      continue
    }

    const toolCommands = extractCommandValues(segment.metadata?.input)
    for (const command of toolCommands) mirroredCommands.add(normalizeCommand(command))
    commands += 1
  }

  for (const segment of group.segments) {
    if (!isMetaType(segment, 'command')) continue
    const command = normalizeCommand(String(segment.metadata?.command || ''))
    if (!command || !mirroredCommands.has(command)) commands += 1
  }

  const state = hasFailure ? 'failed' : hasBlocked ? 'blocked' : hasStopped ? 'stopped' : isRunning ? 'running' : 'complete'
  const counts: string[] = []
  if (createdFiles.size) counts.push(actionCountLabel(language, state, 'create', createdFiles.size))
  if (editedFiles.size) counts.push(actionCountLabel(language, state, 'edit', editedFiles.size))
  if (commands) counts.push(actionCountLabel(language, state, 'run', commands))
  if (!counts.length) counts.push(actionCountLabel(language, state, 'run', 0))

  return {
    state,
    createdFiles: createdFiles.size,
    editedFiles: editedFiles.size,
    commands,
    text: counts.join(' '),
  }
}

const ACTION_KEY_MAP: Record<'create' | 'edit' | 'run', { active: 'creating' | 'editing' | 'running'; done: 'created' | 'edited' | 'ran' }> = {
  create: { active: 'creating', done: 'created' },
  edit: { active: 'editing', done: 'edited' },
  run: { active: 'running', done: 'ran' },
}

function actionCountLabel(
  language: ProductLanguage,
  state: ExecutionGroupSummary['state'],
  kind: 'create' | 'edit' | 'run',
  count: number,
): string {
  const active = state === 'running'
  const action = ACTION_KEY_MAP[kind]
  const tense = active ? action.active : action.done
  const number = count === 1 ? 'one' : 'other'
  const key = `chatturns.${tense}.${number}` as MessageKey
  return translate(key, language, { count: String(count) })
}

export function visibleExecutionGroupSegments(group: ExecutionGroup): ChatSegment[] {
  return group.segments.filter((segment) => !isRedundantTransientStatus(segment))
}

function segmentStatus(segment: ChatSegment): string {
  if (segment.type === 'status') return String(segment.metadata?.status || '')
  if (isMetaType(segment, 'summary')) return String(segment.metadata?.status || '')
  return ''
}

function segmentBlocker(segment: ChatSegment): unknown {
  if (segment.type === 'status' || isMetaType(segment, 'summary')) return segment.metadata?.blocker
  return null
}

function hasBlocker(segment: ChatSegment): boolean {
  const blocker = segmentBlocker(segment)
  return typeof blocker === 'string' ? Boolean(blocker.trim()) : Boolean(blocker)
}

function isFailureSegment(segment: ChatSegment): boolean {
  if (segment.type === 'tool') {
    return segment.metadata?.status === 'done' && segment.metadata?.success === false
  }
  if (segment.type === 'meta' && segment.metadata?.type === 'ask_bridge_failed') return true
  return FAILURE_STATUSES.has(segmentStatus(segment))
}

function isBlockedSegment(segment: ChatSegment): boolean {
  return BLOCKED_STATUSES.has(segmentStatus(segment)) && hasBlocker(segment)
}

function isStoppedSegment(segment: ChatSegment): boolean {
  return STOPPED_STATUSES.has(segmentStatus(segment))
}

function isRedundantTransientStatus(segment: ChatSegment): boolean {
  if (segment.type !== 'status') return false
  if (!RUNNING_STATUSES.has(segmentStatus(segment))) return false
  if (hasBlocker(segment)) return false
  if (segment.metadata?.exitCode !== undefined) return false
  return !segment.content.trim()
}

function classifyToolFiles(segment: ChatSegment): { created: string[]; edited: string[] } {
  const created = new Set<string>()
  const edited = new Set<string>()
  const patchTexts = [
    ...extractPatchTexts(segment.metadata?.input),
    ...extractPatchTexts(segment.metadata?.output),
  ]

  for (const patchText of patchTexts) {
    for (const operation of parsePatchOperations(patchText)) {
      if (operation.kind === 'created') {
        created.add(operation.path)
        edited.delete(operation.path)
      } else if (!created.has(operation.path)) {
        edited.add(operation.path)
      }
    }
  }

  if (created.size || edited.size) {
    return { created: [...created], edited: [...edited] }
  }

  const tool = String(segment.metadata?.tool || '').toLowerCase()
  if (!tool || DIRECTORY_TOOL_PATTERN.test(tool)) return { created: [], edited: [] }

  const paths = new Set([
    ...extractStructuredPaths(segment.metadata?.input),
    ...extractStructuredPaths(segment.metadata?.output),
  ])
  if (!paths.size) return { created: [], edited: [] }

  if (CREATE_TOOL_PATTERN.test(tool)) {
    return { created: [...paths], edited: [] }
  }
  if (MUTATE_TOOL_PATTERN.test(tool)) {
    if (outputSignalsCreatedFile(segment.metadata?.output)) {
      return { created: [...paths], edited: [] }
    }
    return { created: [], edited: [...paths] }
  }
  return { created: [], edited: [] }
}

function extractPatchTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    return looksLikePatch(value) ? [value] : []
  }
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(extractPatchTexts)

  const texts: string[] = []
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && PATCH_TEXT_KEYS.has(key.toLowerCase()) && looksLikePatch(item)) {
      texts.push(item)
      continue
    }
    if (item && typeof item === 'object') texts.push(...extractPatchTexts(item))
  }
  return texts
}

function looksLikePatch(value: string): boolean {
  return /^\*\*\* (?:Add|Update|Delete) File:/m.test(value)
}

function parsePatchOperations(patch: string): Array<{ kind: 'created' | 'edited'; path: string }> {
  const operations: Array<{ kind: 'created' | 'edited'; path: string }> = []
  const pattern = /^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/gm
  for (const match of patch.matchAll(pattern)) {
    const path = normalizePath(match[2])
    if (!path) continue
    operations.push({ kind: match[1] === 'Add' ? 'created' : 'edited', path })
  }
  return operations
}

function extractStructuredPaths(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(extractStructuredPaths)

  const paths: string[] = []
  for (const [rawKey, item] of Object.entries(value)) {
    const key = rawKey.toLowerCase()
    if (FILE_PATH_KEYS.has(key) && typeof item === 'string') {
      const path = normalizePath(item)
      if (path) paths.push(path)
      continue
    }
    if (FILE_PATH_COLLECTION_KEYS.has(key) && Array.isArray(item)) {
      for (const candidate of item) {
        if (typeof candidate === 'string') {
          const path = normalizePath(candidate)
          if (path) paths.push(path)
        } else {
          paths.push(...extractStructuredPaths(candidate))
        }
      }
      continue
    }
    if (item && typeof item === 'object') paths.push(...extractStructuredPaths(item))
  }
  return paths
}

function extractCommandValues(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(extractCommandValues)

  const commands: string[] = []
  for (const [key, item] of Object.entries(value)) {
    if ((key.toLowerCase() === 'command' || key.toLowerCase() === 'cmd') && typeof item === 'string') {
      commands.push(item)
      continue
    }
    if (item && typeof item === 'object') commands.push(...extractCommandValues(item))
  }
  return commands
}

function outputSignalsCreatedFile(output: unknown): boolean {
  if (typeof output === 'string') return CREATED_OUTPUT_PATTERN.test(output)
  if (!output || typeof output !== 'object') return false
  try {
    return CREATED_OUTPUT_PATTERN.test(JSON.stringify(output))
  } catch {
    return false
  }
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

function normalizeCommand(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function buildChatTurns(
  segments: ChatSegment[],
  dockedAskId?: string | null,
): ChatTurn[] {
  const buckets: ChatSegment[][] = []
  let current: ChatSegment[] = []

  for (const segment of segments) {
    if (segment.type === 'user' && current.length > 0) {
      buckets.push(current)
      current = []
    }
    current.push(segment)
  }
  if (current.length > 0) buckets.push(current)

  return buckets.map((bucket, index) => {
    const user = bucket.find((segment) => segment.type === 'user')
    const artifact = [...bucket].reverse().find((segment) => isMetaType(segment, 'artifact'))
      || [...bucket].reverse().find((segment) =>
        isMetaType(segment, 'summary') && Boolean(segment.metadata?.outDir)
      )
    const visibleTimeline = bucket.filter((segment) => {
      if (segment === user || isMetaType(segment, 'artifact')) return false
      if (isEmptyTypedSegment(segment)) return false
      return segment.type !== 'ask' || segment.ask?.askId !== dockedAskId
    })
    const timeline = groupExecutionSegments(visibleTimeline)

    return {
      id: user?.id || bucket[0]?.id || `turn-${index}`,
      user,
      timeline,
      artifact,
    }
  })
}
