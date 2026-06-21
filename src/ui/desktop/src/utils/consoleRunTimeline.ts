import { nativeTaskResultText, stripNativeTaskBlocks } from '../../../../contract/native-task-blocks.ts'
import type { ProductLanguage } from '@contract/types'
import { translate, type MessageKey } from '../i18n/messages.ts'
import { DEFAULT_PRODUCT_LANGUAGE, normalizeProductLanguage } from '../i18n/messages.ts'

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

function humanSummary(value: unknown, language: ProductLanguage): string {
  const direct = outputDisplayText(value);
  if (direct) return clip(direct, 900);
  if (Array.isArray(value)) return value.length
    ? translate('run.timeline.returnedNResults', language, { count: value.length })
    : translate('run.timeline.noResult', language);
  const data = record(value);
  for (const key of COMMON_TEXT_KEYS) {
    const candidate = outputDisplayText(data[key]);
    if (candidate) return clip(candidate, 900);
  }
  return Object.keys(data).length ? translate('run.timeline.structuredResult', language) : '';
}

function isKnownRuntimeWarningText(value: unknown): boolean {
  return /\[ripgrep\]\s+fallback:\s+builtin rg unavailable on win32, using system rg/i.test(displayText(value));
}

function cleanError(value: unknown, language: ProductLanguage): string {
  const summary = (outputDisplayText(value) || humanSummary(value, language))
    .replace(/<\/?tool_use_error>/gi, '')
    .replace(/<\/?error>/gi, '')
    .trim();
  return summary || translate('run.timeline.errorDuringRun', language);
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

function toolOutputSummary(value: unknown, outcome: RunTimelineOutcome, language: ProductLanguage): string {
  const data = record(value);
  for (const key of ['error', 'message', 'summary', 'status', 'result']) {
    const candidate = data[key];
    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      return `${key}${translate('run.timeline.keyValueSeparator', language)}${String(candidate)}`;
    }
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

  if (outcome === 'failure') return translate('run.timeline.toolFailed', language);
  if (outcome === 'success') return translate('run.timeline.toolSucceeded', language);
  return translate('run.timeline.toolFinished', language);
}

const STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  preparing: 'run.timeline.status.preparing',
  starting: 'run.timeline.status.starting',
  running: 'run.timeline.status.running',
  pass: 'run.timeline.status.pass',
  completed: 'run.timeline.status.completed',
  blocked: 'run.timeline.status.blocked',
  failed: 'run.timeline.status.failed',
  error: 'run.timeline.status.error',
  stopped: 'run.timeline.status.stopped',
  interrupted: 'run.timeline.status.interrupted',
  timeout: 'run.timeline.status.timeout',
};

function statusLabel(status: unknown, language: ProductLanguage): string {
  const value = String(status || '');
  const key = STATUS_LABEL_KEYS[value];
  if (key) return translate(key, language);
  const statusText = String(status || translate('run.timeline.unknownStatus', language));
  return translate('run.timeline.statusChanged', language, { status: statusText });
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

function eventItems(events: TimelineEvent[], language: ProductLanguage): RunTimelineItem[] {
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
        const item = makeItem(id, kind, kind === 'assistant' ? translate('run.timeline.agentResponse', language) : translate('run.timeline.reasoning', language), body, at, order, {
          lowValue: kind === 'internal',
        });
        textStreams.set(key, item);
        items.push(item);
      }
      return;
    }

    if (type === 'tool_call') {
      const tool = String(event.tool || translate('run.timeline.unnamedTool', language));
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
      const tool = String(event.tool || translate('run.timeline.unnamedTool', language));
      const outcome = outcomeFrom('', event.success);
      const result = toolOutputSummary(event.output, outcome, language);
      const existing = tools.get(callId);
      if (existing) {
        existing.outcome = outcome;
        existing.body = outcome === 'failure' ? '' : result;
        existing.error = outcome === 'failure' ? cleanError(event.output, language) : undefined;
      } else {
        items.push(makeItem(id, 'tool', tool, outcome === 'failure' ? '' : result, at, order, {
          tool,
          outcome,
          error: outcome === 'failure' ? cleanError(event.output, language) : undefined,
        }));
      }
      return;
    }

    if (type === 'stderr') {
      if (isKnownRuntimeWarningText(event.text)) {
        items.push(makeItem(id, 'status', translate('run.timeline.runWarning', language), cleanError(event.text, language), at, order, {
          outcome: 'neutral',
          lowValue: true,
        }));
        return;
      }
      items.push(makeItem(id, 'error', translate('run.timeline.runErrorTitle', language), '', at, order, {
        outcome: 'failure',
        error: cleanError(event.text, language),
      }));
      return;
    }

    if (type === 'status') {
      const outcome = outcomeFrom(event.status);
      items.push(makeItem(id, 'status', statusLabel(event.status, language), humanSummary(event.blocker, language), at, order, {
        outcome,
        lowValue: TRANSIENT_STATUSES.has(String(event.status || '')),
      }));
      return;
    }

    if (type === 'artifact') {
      items.push(makeItem(id, 'artifact', translate('run.timeline.artifactGenerated', language), translate('run.timeline.artifactWritten', language), at, order, { outcome: 'success' }));
      return;
    }

    if (type === 'command') {
      items.push(makeItem(id, 'internal', translate('run.timeline.startCommand', language), text(event.command) || translate('run.timeline.envStarted', language), at, order, { lowValue: true }));
      return;
    }

    if (type === 'preparation') {
      const stage = text(event.stage);
      items.push(makeItem(id, 'internal', translate('run.timeline.prepareEnv', language), stage ? translate('run.timeline.stage', language, { stage }) : translate('run.timeline.readingConfig', language), at, order, { lowValue: true }));
      return;
    }

    if (['usage', 'usage_summary', 'summary', 'opencode_session'].includes(type)) {
      items.push(makeItem(id, 'internal', translate('run.timeline.internalInfo', language), humanSummary(event, language), at, order, { lowValue: true }));
      return;
    }

    items.push(makeItem(id, 'status', translate('run.timeline.runEvent', language, { type }), humanSummary(event, language) || translate('run.timeline.recordedEvent', language), at, order));
  });

  return items;
}

function segmentItems(segments: TimelineSegment[], includeRuntimeSegments: boolean, language: ProductLanguage): RunTimelineItem[] {
  const items: RunTimelineItem[] = [];
  segments.forEach((segment, index) => {
    const type = String(segment.type || 'unknown');
    const metadata = record(segment.metadata);
    const ask = record(segment.ask);
    const at = timestamp(segment.timestamp, index);
    const id = String(segment.id || `segment-${index}-${type}`);
    const content = type === 'text' ? displayText(segment.content) : text(segment.content);

    if (type === 'user') {
      items.push(makeItem(id, 'user', translate('run.timeline.userRequest', language), content || translate('run.timeline.userSubmitted', language), at, index));
      return;
    }
    if (type === 'ask') {
      const prompt = text(ask.prompt);
      const result = humanSummary(ask.result, language);
      items.push(makeItem(id, 'decision', text(ask.title) || translate('run.timeline.waitingConfirmation', language), [prompt, result && translate('run.timeline.userChoice', language, { result })].filter(Boolean).join('\n'), at, index));
      return;
    }
    if (!includeRuntimeSegments) return;

    if (type === 'text') {
      if (!content) return;
      items.push(makeItem(id, 'assistant', translate('run.timeline.agentResponse', language), content, at, index));
      return;
    }
    if (type === 'reasoning') {
      items.push(makeItem(id, 'internal', translate('run.timeline.reasoning', language), content, at, index, { lowValue: true }));
      return;
    }
    if (type === 'tool') {
      const tool = String(metadata.tool || translate('run.timeline.unnamedTool', language));
      const outcome = outcomeFrom(metadata.status, metadata.success);
      items.push(makeItem(
        id,
        'tool',
        tool,
        outcome === 'failure' ? '' : toolOutputSummary(metadata.output, outcome, language),
        at,
        index,
        {
          tool,
          outcome,
          parameters: formatToolParameters(metadata.input),
          error: outcome === 'failure' ? cleanError(metadata.output, language) : undefined,
        },
      ));
      return;
    }
    if (type === 'status') {
      items.push(makeItem(id, 'status', statusLabel(metadata.status, language), humanSummary(metadata.blocker, language), at, index, {
        outcome: outcomeFrom(metadata.status),
        lowValue: TRANSIENT_STATUSES.has(String(metadata.status || '')),
      }));
      return;
    }
    if (type === 'meta' && metadata.type === 'stderr') {
      if (isKnownRuntimeWarningText(metadata.text)) {
        items.push(makeItem(id, 'status', translate('run.timeline.runWarning', language), cleanError(metadata.text, language), at, index, {
          outcome: 'neutral',
          lowValue: true,
        }));
        return;
      }
      items.push(makeItem(id, 'error', translate('run.timeline.runErrorTitle', language), '', at, index, {
        outcome: 'failure',
        error: cleanError(metadata.text, language),
      }));
      return;
    }
    if (type === 'meta' && metadata.type === 'artifact') {
      items.push(makeItem(id, 'artifact', translate('run.timeline.artifactGenerated', language), translate('run.timeline.artifactWritten', language), at, index, { outcome: 'success' }));
      return;
    }
    if (type === 'meta' && metadata.type === 'command') {
      items.push(makeItem(id, 'internal', translate('run.timeline.startCommand', language), text(metadata.command) || translate('run.timeline.envStarted', language), at, index, { lowValue: true }));
      return;
    }
    if (type === 'meta' && metadata.type === 'preparation') {
      items.push(makeItem(id, 'internal', translate('run.timeline.prepareEnv', language), translate('run.timeline.readingConfig', language), at, index, { lowValue: true }));
      return;
    }
    if (type === 'meta') {
      items.push(makeItem(id, 'internal', translate('run.timeline.internalInfo', language), humanSummary(metadata, language), at, index, { lowValue: true }));
      return;
    }
    items.push(makeItem(id, 'status', translate('run.timeline.runEvent', language, { type }), content || translate('run.timeline.recordedEvent', language), at, index));
  });
  return items;
}

export function buildRunTimeline(chatLog: unknown, rawEvents: unknown, blocker?: unknown, language: ProductLanguage = DEFAULT_PRODUCT_LANGUAGE): RunTimelineItem[] {
  const normalizedLanguage = normalizeProductLanguage(language)
  const events = Array.isArray(rawEvents) ? rawEvents as TimelineEvent[] : [];
  const segments = segmentsFrom(chatLog);
  const items = [
    ...eventItems(events, normalizedLanguage),
    ...segmentItems(segments, events.length === 0, normalizedLanguage),
  ];
  const blockerText = cleanError(blocker, normalizedLanguage);
  if (text(blocker) && !items.some((item) => item.outcome === 'failure'
    && `${item.body}\n${item.error || ''}`.includes(text(blocker)))) {
    const last = items.reduce((max, item) => Math.max(max, item.at), 0);
    items.push(makeItem('session-blocker', 'error', translate('run.timeline.sessionBlocked', normalizedLanguage), '', last + 1, Number.MAX_SAFE_INTEGER, {
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
