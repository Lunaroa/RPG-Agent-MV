import type { ProductLanguage, SessionSubagentActivity, SessionSubagentItem } from '@contract/types'
import type { ChatSegment } from '../composables/useSessionStream.ts'
import { pickByLocale, translate } from '../i18n/messages.ts'
import { SUBAGENT_ACTIVITY_TITLE_TRANSLATIONS, SUBAGENT_USING_TOOL_TITLE_RE } from './subagentTimelineLocalization.ts'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'

function timestampFor(value: string | null | undefined, fallback: number): number {
  const timestamp = value ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function statusForActivity(entry: SessionSubagentActivity, itemStatus?: string | null): string {
  const status = String(entry.status || '')
  const parentStatus = String(itemStatus || '')
  if (entry.kind === 'failed' || status === 'failed' || status === 'timeout') return 'failed'
  if (entry.kind === 'stopped' || status === 'stopped') return 'stopped'
  if (status === 'completed' || status === 'success' || status === 'done') return 'pass'
  if (
    (entry.kind === 'started' || entry.kind === 'progress' || status === 'running') &&
    parentStatus &&
    parentStatus !== 'running' &&
    parentStatus !== 'unknown'
  ) {
    if (parentStatus === 'completed') return 'pass'
    if (parentStatus === 'failed' || parentStatus === 'timeout') return 'failed'
    return parentStatus
  }
  if (entry.kind === 'started' || entry.kind === 'progress' || status === 'running') return 'running'
  if (status === 'completed') return 'pass'
  return status || 'running'
}

function metaSegment(
  id: string,
  title: string,
  status: string,
  at: string | null | undefined,
  index: number,
  language: ProductLanguage,
): ChatSegment {
  return {
    id,
    type: 'meta',
    content: '',
    timestamp: timestampFor(at, index),
    metadata: {
      type: 'preparation',
      stage: localizeSubagentActivityTitle(title, language),
      status,
    },
  }
}

function statusSegment(
  id: string,
  status: string,
  blocker: string | null | undefined,
  at: string | null | undefined,
  index: number,
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): ChatSegment {
  language = normalizeProductLanguage(language)
  return {
    id,
    type: 'status',
    content: '',
    timestamp: timestampFor(at, index),
    metadata: blocker ? { status, blocker: localizeSubagentActivityTitle(blocker, language) } : { status },
  }
}

function toolSegment(entry: SessionSubagentActivity, index: number, itemStatus?: string | null): ChatSegment {
  const status = statusForActivity(entry, itemStatus)
  const done = status !== 'running'
  return {
    id: `subagent-activity-${entry.id}`,
    type: 'tool',
    content: '',
    timestamp: timestampFor(entry.at, index),
    metadata: {
      tool: entry.tool,
      status: done ? 'done' : 'running',
      success: status !== 'failed',
      input: entry.input ?? {
        detail: entry.detail || undefined,
        query: entry.detail || undefined,
        status: entry.status || undefined,
      },
      output: entry.output !== undefined
        ? entry.output
        : entry.outputFile
        ? { outputFile: entry.outputFile, status: entry.status || status }
        : undefined,
    },
  }
}

function activitySegment(
  entry: SessionSubagentActivity,
  index: number,
  finalOutput?: string | null,
  itemStatus?: string | null,
  language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE,
): ChatSegment {
  language = normalizeProductLanguage(language)
  if (entry.tool) return toolSegment(entry, index, itemStatus)

  const status = statusForActivity(entry, itemStatus)
  const id = `subagent-activity-${entry.id}`
  if (status === 'failed' || status === 'stopped') {
    return statusSegment(id, status, entry.detail, entry.at, index, language)
  }
  if ((entry.kind === 'output' || entry.kind === 'notification') && entry.detail && entry.detail !== finalOutput) {
    return {
      id,
      type: 'text',
      content: entry.detail,
      timestamp: timestampFor(entry.at, index),
    }
  }
  return metaSegment(id, entry.title, status, entry.at, index, language)
}

export function subagentTimelineSegments(item: SessionSubagentItem, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): ChatSegment[] {
  language = normalizeProductLanguage(language)
  const segments: ChatSegment[] = []
  let index = 0

  if (item.prompt) {
    segments.push({
      id: `subagent-${item.id}-prompt`,
      type: 'reasoning',
      content: `${translate('subagent.timeline.originalRequest', language)}\n\n${item.prompt}`,
      timestamp: timestampFor(item.updatedAt, ++index),
    })
  }

  for (const entry of item.activity || []) {
    segments.push(activitySegment(entry, ++index, item.output, item.status, language))
  }

  if (item.output) {
    segments.push({
      id: `subagent-${item.id}-output`,
      type: 'text',
      content: item.output,
      timestamp: timestampFor(item.updatedAt, ++index),
    })
  } else if (item.outputFile && item.status === 'completed') {
    segments.push({
      id: `subagent-${item.id}-output-file`,
      type: 'text',
      content: [
        translate('subagent.timeline.noTextOutput', language),
        '',
        `${translate('subagent.timeline.outputFileLabel', language)}: \`${item.outputFile}\``,
        '',
        translate('subagent.timeline.emptyOutputHint', language),
      ].join('\n'),
      timestamp: timestampFor(item.updatedAt, ++index),
    })
  }

  if (item.error) {
    segments.push(statusSegment(
      `subagent-${item.id}-error`,
      item.status === 'timeout' ? 'timeout' : 'failed',
      item.error,
      item.updatedAt,
      ++index,
      language,
    ))
  }

  return segments
}

export function localizeSubagentActivityTitle(title: string, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): string {
  language = normalizeProductLanguage(language)
  return pickByLocale(language, {
    'zh-CN': () => title,
    'en-US': () => {
      const tool = title.match(SUBAGENT_USING_TOOL_TITLE_RE)
      if (tool) return `Using ${tool[1]}`
      return SUBAGENT_ACTIVITY_TITLE_TRANSLATIONS[title] || title
    },
  })()
}
