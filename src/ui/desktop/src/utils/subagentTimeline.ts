import type { SessionSubagentActivity, SessionSubagentItem } from '@contract/types'
import type { ChatSegment } from '../composables/useSessionStream.ts'

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
): ChatSegment {
  return {
    id,
    type: 'meta',
    content: '',
    timestamp: timestampFor(at, index),
    metadata: {
      type: 'preparation',
      stage: title,
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
): ChatSegment {
  return {
    id,
    type: 'status',
    content: '',
    timestamp: timestampFor(at, index),
    metadata: blocker ? { status, blocker } : { status },
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
): ChatSegment {
  if (entry.tool) return toolSegment(entry, index, itemStatus)

  const status = statusForActivity(entry, itemStatus)
  const id = `subagent-activity-${entry.id}`
  if (status === 'failed' || status === 'stopped') {
    return statusSegment(id, status, entry.detail, entry.at, index)
  }
  if ((entry.kind === 'output' || entry.kind === 'notification') && entry.detail && entry.detail !== finalOutput) {
    return {
      id,
      type: 'text',
      content: entry.detail,
      timestamp: timestampFor(entry.at, index),
    }
  }
  return metaSegment(id, entry.title, status, entry.at, index)
}

export function subagentTimelineSegments(item: SessionSubagentItem): ChatSegment[] {
  const segments: ChatSegment[] = []
  let index = 0

  if (item.prompt) {
    segments.push({
      id: `subagent-${item.id}-prompt`,
      type: 'reasoning',
      content: `原始请求\n\n${item.prompt}`,
      timestamp: timestampFor(item.updatedAt, ++index),
    })
  }

  for (const entry of item.activity || []) {
    segments.push(activitySegment(entry, ++index, item.output, item.status))
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
        '子任务已完成，但没有收到正文输出。',
        '',
        `输出文件：\`${item.outputFile}\``,
        '',
        '如果这里仍为空，说明运行后端没有把子任务结果写入该文件。',
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
    ))
  }

  return segments
}
