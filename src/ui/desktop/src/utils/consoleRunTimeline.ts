import { nativeTaskResultText, stripNativeTaskBlocks } from '../../../../contract/native-task-blocks.ts'

export type RunTimelineKind =
  | 'user'
  | 'assistant'
  | 'decision'
  | 'tool'
  | 'error'
  | 'artifact'
  | 'status'
  | 'internal';

export type RunTimelineOutcome = 'success' | 'failure' | 'neutral';

export interface RunTimelineItem {
  id: string;
  kind: RunTimelineKind;
  title: string;
  body: string;
  parameters?: string;
  error?: string;
  at: number;
  order: number;
  tool?: string;
  outcome: RunTimelineOutcome;
  lowValue: boolean;
}

export interface RunTimelineFilters {
  query?: string;
  kinds?: string[];
  tools?: string[];
  outcomes?: string[];
  showInternal?: boolean;
}

interface TimelineSegment {
  id?: unknown;
  type?: unknown;
  content?: unknown;
  timestamp?: unknown;
  metadata?: unknown;
  ask?: unknown;
}

interface TimelineEvent {
  type?: unknown;
  sequence?: unknown;
  at?: unknown;
  [key: string]: unknown;
}

const FAILURE_STATUSES = new Set(['blocked', 'failed', 'error', 'stopped', 'interrupted', 'timeout']);
const TRANSIENT_STATUSES = new Set(['preparing', 'starting', 'running']);
const SUCCESS_STATUSES = new Set(['pass', 'completed', 'success', 'done']);
const COMMON_TEXT_KEYS = ['message', 'error', 'summary', 'result', 'text', 'reason', 'status', 'path', 'file', 'name'];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayText(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  return stripNativeTaskBlocks(value).trim();
}

function outputDisplayText(value: unknown): string {
  if (typeof value !== 'string') return text(value);
  return stripNativeTaskBlocks(nativeTaskResultText(value)).trim();
}

function clip(value: string, max = 4000): string {
  const normalized = value.replace(/\r/g, '').trim();
  return normalized.length > max ? `${normalized.slice(0, max).trimEnd()}…` : normalized;
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function outcomeFrom(value: unknown, success?: unknown): RunTimelineOutcome {
  if (success === false) return 'failure';
  if (success === true) return 'success';
  const status = String(value || '').toLowerCase();
  if (FAILURE_STATUSES.has(status)) return 'failure';
  if (SUCCESS_STATUSES.has(status)) return 'success';
  return 'neutral';
}

function humanSummary(value: unknown): string {
  const direct = outputDisplayText(value);
  if (direct) return clip(direct, 900);
  if (Array.isArray(value)) return value.length ? `返回 ${value.length} 项结果` : '未返回结果';
  const data = record(value);
  for (const key of COMMON_TEXT_KEYS) {
    const candidate = outputDisplayText(data[key]);
    if (candidate) return clip(candidate, 900);
  }
  return Object.keys(data).length ? '已返回结构化结果' : '';
}

function isKnownRuntimeWarningText(value: unknown): boolean {
  return /\[ripgrep\]\s+fallback:\s+builtin rg unavailable on win32, using system rg/i.test(displayText(value));
}

function cleanError(value: unknown): string {
  const summary = (outputDisplayText(value) || humanSummary(value))
    .replace(/<\/?tool_use_error>/gi, '')
    .replace(/<\/?error>/gi, '')
    .trim();
  return summary || '运行过程中出现错误';
}

function formatToolParameters(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolOutputSummary(value: unknown, outcome: RunTimelineOutcome): string {
  const data = record(value);
  for (const key of ['error', 'message', 'summary', 'status', 'result']) {
    const candidate = data[key];
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return `${key}：${String(candidate)}`;
    const candidateText = outputDisplayText(candidate);
    if (candidateText && !/^[{[]/.test(candidateText)) return clip(candidateText.split(/\r?\n/)[0] || candidateText, 280);
  }

  const direct = outputDisplayText(value);
  if (direct) {
    const usefulLine = direct
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line
        && !/^[\d\s|+\-drwx.]+$/.test(line)
        && !/^[{[\]},]/.test(line)
        && !/^"[^"]+"\s*:/.test(line)
        && !/^\d+\s/.test(line))
      .find((line) => /成功|失败|错误|找到|创建|更新|完成|warning|error|failed|created|updated|found|passed/i.test(line));
    if (usefulLine) return clip(usefulLine, 280);
  }

  if (outcome === 'failure') return '工具执行失败';
  if (outcome === 'success') return '工具执行成功';
  return '工具调用已结束';
}

function statusLabel(status: unknown): string {
  const labels: Record<string, string> = {
    preparing: '正在准备运行',
    starting: '正在启动 Agent',
    running: 'Agent 正在执行',
    pass: '运行通过',
    completed: '运行完成',
    blocked: '运行被拦截',
    failed: '运行失败',
    error: '运行出错',
    stopped: '运行已停止',
    interrupted: '运行已中断',
    timeout: '运行超时',
  };
  return labels[String(status || '')] || `状态变更：${String(status || '未知')}`;
}

function makeItem(
  id: string,
  kind: RunTimelineKind,
  title: string,
  body: string,
  at: number,
  order: number,
  options: Partial<Pick<RunTimelineItem, 'tool' | 'outcome' | 'lowValue' | 'parameters' | 'error'>> = {},
): RunTimelineItem {
  return {
    id,
    kind,
    title,
    body: clip(body),
    parameters: options.parameters,
    error: options.error,
    at,
    order,
    outcome: options.outcome || 'neutral',
    lowValue: options.lowValue || false,
    tool: options.tool,
  };
}

function segmentsFrom(chatLog: unknown): TimelineSegment[] {
  if (Array.isArray(chatLog)) return chatLog as TimelineSegment[];
  const segments = record(chatLog).segments;
  return Array.isArray(segments) ? segments as TimelineSegment[] : [];
}

function eventItems(events: TimelineEvent[]): RunTimelineItem[] {
  const items: RunTimelineItem[] = [];
  const textStreams = new Map<string, RunTimelineItem>();
  const tools = new Map<string, RunTimelineItem>();
  const skippedToolCalls = new Set<string>();

  events.forEach((event, index) => {
    const type = String(event.type || 'unknown');
    const order = Number(event.sequence) || index;
    const at = timestamp(event.at, order);
    const id = `event-${order}-${type}`;

    if (type === 'text_delta' || type === 'reasoning_delta' || type === 'stdout') {
      const kind = type === 'reasoning_delta' ? 'internal' : 'assistant';
      const streamId = String(event.segment_id || `${type}-${order}`);
      const key = `${type}:${streamId}`;
      const body = type === 'reasoning_delta' ? text(event.text) : displayText(event.text);
      const existing = textStreams.get(key);
      if (existing) {
        existing.body = clip(`${existing.body}${body}`);
      } else if (body) {
        const item = makeItem(id, kind, kind === 'assistant' ? 'Agent 回复' : '分析过程', body, at, order, {
          lowValue: kind === 'internal',
        });
        textStreams.set(key, item);
        items.push(item);
      }
      return;
    }

    if (type === 'tool_call') {
      const tool = String(event.tool || '未命名工具');
      const callId = String(event.call_id || id);
      if (/askuser|ask_(clarify|multi_choice|plan|map|event|production)/i.test(tool)) {
        skippedToolCalls.add(callId);
        return;
      }
      const item = makeItem(id, 'tool', tool, '', at, order, {
        tool,
        parameters: formatToolParameters(event.input),
      });
      tools.set(callId, item);
      items.push(item);
      return;
    }

    if (type === 'tool_result') {
      const callId = String(event.call_id || '');
      if (skippedToolCalls.has(callId)) return;
      const tool = String(event.tool || '未命名工具');
      const outcome = outcomeFrom('', event.success);
      const result = toolOutputSummary(event.output, outcome);
      const existing = tools.get(callId);
      if (existing) {
        existing.outcome = outcome;
        existing.body = outcome === 'failure' ? '' : result;
        existing.error = outcome === 'failure' ? cleanError(event.output) : undefined;
      } else {
        items.push(makeItem(id, 'tool', tool, outcome === 'failure' ? '' : result, at, order, {
          tool,
          outcome,
          error: outcome === 'failure' ? cleanError(event.output) : undefined,
        }));
      }
      return;
    }

    if (type === 'stderr') {
      if (isKnownRuntimeWarningText(event.text)) {
        items.push(makeItem(id, 'status', '运行告警', cleanError(event.text), at, order, {
          outcome: 'neutral',
          lowValue: true,
        }));
        return;
      }
      items.push(makeItem(id, 'error', '运行错误', '', at, order, {
        outcome: 'failure',
        error: cleanError(event.text),
      }));
      return;
    }

    if (type === 'status') {
      const outcome = outcomeFrom(event.status);
      items.push(makeItem(id, 'status', statusLabel(event.status), humanSummary(event.blocker), at, order, {
        outcome,
        lowValue: TRANSIENT_STATUSES.has(String(event.status || '')),
      }));
      return;
    }

    if (type === 'artifact') {
      items.push(makeItem(id, 'artifact', '运行产物已生成', '产物已写入当前会话目录', at, order, { outcome: 'success' }));
      return;
    }

    if (type === 'command') {
      items.push(makeItem(id, 'internal', '启动执行命令', text(event.command) || '已启动执行环境', at, order, { lowValue: true }));
      return;
    }

    if (type === 'preparation') {
      const stage = text(event.stage);
      items.push(makeItem(id, 'internal', '准备运行环境', stage ? `阶段：${stage}` : '正在读取工程与运行配置', at, order, { lowValue: true }));
      return;
    }

    if (['usage', 'usage_summary', 'summary', 'opencode_session'].includes(type)) {
      items.push(makeItem(id, 'internal', '运行内部信息', humanSummary(event), at, order, { lowValue: true }));
      return;
    }

    items.push(makeItem(id, 'status', `运行事件：${type}`, humanSummary(event) || '记录了一项运行事件', at, order));
  });

  return items;
}

function segmentItems(segments: TimelineSegment[], includeRuntimeSegments: boolean): RunTimelineItem[] {
  const items: RunTimelineItem[] = [];
  segments.forEach((segment, index) => {
    const type = String(segment.type || 'unknown');
    const metadata = record(segment.metadata);
    const ask = record(segment.ask);
    const at = timestamp(segment.timestamp, index);
    const id = String(segment.id || `segment-${index}-${type}`);
    const content = type === 'text' ? displayText(segment.content) : text(segment.content);

    if (type === 'user') {
      items.push(makeItem(id, 'user', '用户请求', content || '用户提交了一条请求', at, index));
      return;
    }
    if (type === 'ask') {
      const prompt = text(ask.prompt);
      const result = humanSummary(ask.result);
      items.push(makeItem(id, 'decision', text(ask.title) || '等待用户确认', [prompt, result && `用户选择：${result}`].filter(Boolean).join('\n'), at, index));
      return;
    }
    if (!includeRuntimeSegments) return;

    if (type === 'text') {
      if (!content) return;
      items.push(makeItem(id, 'assistant', 'Agent 回复', content, at, index));
      return;
    }
    if (type === 'reasoning') {
      items.push(makeItem(id, 'internal', '分析过程', content, at, index, { lowValue: true }));
      return;
    }
    if (type === 'tool') {
      const tool = String(metadata.tool || '未命名工具');
      const outcome = outcomeFrom(metadata.status, metadata.success);
      items.push(makeItem(
        id,
        'tool',
        tool,
        outcome === 'failure' ? '' : toolOutputSummary(metadata.output, outcome),
        at,
        index,
        {
          tool,
          outcome,
          parameters: formatToolParameters(metadata.input),
          error: outcome === 'failure' ? cleanError(metadata.output) : undefined,
        },
      ));
      return;
    }
    if (type === 'status') {
      items.push(makeItem(id, 'status', statusLabel(metadata.status), humanSummary(metadata.blocker), at, index, {
        outcome: outcomeFrom(metadata.status),
        lowValue: TRANSIENT_STATUSES.has(String(metadata.status || '')),
      }));
      return;
    }
    if (type === 'meta' && metadata.type === 'stderr') {
      if (isKnownRuntimeWarningText(metadata.text)) {
        items.push(makeItem(id, 'status', '运行告警', cleanError(metadata.text), at, index, {
          outcome: 'neutral',
          lowValue: true,
        }));
        return;
      }
      items.push(makeItem(id, 'error', '运行错误', '', at, index, {
        outcome: 'failure',
        error: cleanError(metadata.text),
      }));
      return;
    }
    if (type === 'meta' && metadata.type === 'artifact') {
      items.push(makeItem(id, 'artifact', '运行产物已生成', '产物已写入当前会话目录', at, index, { outcome: 'success' }));
      return;
    }
    if (type === 'meta' && metadata.type === 'command') {
      items.push(makeItem(id, 'internal', '启动执行命令', text(metadata.command) || '已启动执行环境', at, index, { lowValue: true }));
      return;
    }
    if (type === 'meta' && metadata.type === 'preparation') {
      items.push(makeItem(id, 'internal', '准备运行环境', '正在读取工程与运行配置', at, index, { lowValue: true }));
      return;
    }
    if (type === 'meta') {
      items.push(makeItem(id, 'internal', '运行内部信息', humanSummary(metadata), at, index, { lowValue: true }));
      return;
    }
    items.push(makeItem(id, 'status', `运行事件：${type}`, content || '记录了一项运行事件', at, index));
  });
  return items;
}

export function buildRunTimeline(chatLog: unknown, rawEvents: unknown, blocker?: unknown): RunTimelineItem[] {
  const events = Array.isArray(rawEvents) ? rawEvents as TimelineEvent[] : [];
  const segments = segmentsFrom(chatLog);
  const items = [
    ...eventItems(events),
    ...segmentItems(segments, events.length === 0),
  ];
  const blockerText = cleanError(blocker);
  if (text(blocker) && !items.some((item) => item.outcome === 'failure'
    && `${item.body}\n${item.error || ''}`.includes(text(blocker)))) {
    const last = items.reduce((max, item) => Math.max(max, item.at), 0);
    items.push(makeItem('session-blocker', 'error', '会话阻塞', '', last + 1, Number.MAX_SAFE_INTEGER, {
      outcome: 'failure',
      error: blockerText,
    }));
  }
  return items
    .filter((item) => item.body || item.title || item.parameters || item.error)
    .sort((a, b) => a.at - b.at || a.order - b.order);
}

export function filterRunTimeline(items: RunTimelineItem[], filters: RunTimelineFilters): RunTimelineItem[] {
  const query = String(filters.query || '').trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (!filters.showInternal && item.lowValue) return false;
    if (filters.kinds?.length && !filters.kinds.includes(item.kind)) return false;
    if (filters.tools?.length && (!item.tool || !filters.tools.includes(item.tool))) return false;
    if (filters.outcomes?.length && !filters.outcomes.includes(item.outcome)) return false;
    if (query && !`${item.title} ${item.body} ${item.parameters || ''} ${item.error || ''} ${item.tool || ''}`.toLocaleLowerCase().includes(query)) return false;
    return true;
  });
}
