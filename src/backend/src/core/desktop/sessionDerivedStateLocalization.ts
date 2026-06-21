import type { SessionSubagentStatus } from '../../../../contract/types.ts';
import type { ProductLanguage } from '../../../../contract/i18n.ts';
import { pickByLocale } from '../../../../contract/i18n.ts';
import { resolveLanguage } from '../i18n/request-language.ts';

export interface SessionPlanLabels {
  idleTitle: string;
  planningTitle: string;
  approvalRequestedTitle: string;
  responseFailed: string;
  enterFailed: string;
  exitFailed: string;
}

export interface SessionSubagentLabels {
  fallbackDescription: string;
  started: string;
  readOutput: string;
  stopRequested: string;
  dispatched: string;
  failed: string;
  completed: string;
  outputReadFailed: string;
  outputRead: string;
  stopFailed: string;
  stopped: string;
  reasoning: string;
  output: string;
  running: string;
  statusUpdate: string;
  stopSubagentFailed: string;
}

const SESSION_PLAN_LABELS_BY_LOCALE = {
  'zh-CN': {
    idleTitle: '计划',
    planningTitle: '计划模式',
    approvalRequestedTitle: '计划待批准',
    responseFailed: '计划审批响应失败',
    enterFailed: '进入计划模式失败',
    exitFailed: '退出计划模式失败',
  },
  'en-US': {
    idleTitle: 'Plan',
    planningTitle: 'Planning mode',
    approvalRequestedTitle: 'Plan awaiting approval',
    responseFailed: 'Plan approval response failed',
    enterFailed: 'Failed to enter planning mode',
    exitFailed: 'Failed to exit planning mode',
  },
} as const satisfies Record<ProductLanguage, SessionPlanLabels>;

const SESSION_SUBAGENT_LABELS_BY_LOCALE = {
  'zh-CN': {
    fallbackDescription: '子任务',
    started: '启动子任务',
    readOutput: '读取子任务输出',
    stopRequested: '请求停止子任务',
    dispatched: '子任务已派发',
    failed: '子任务失败',
    completed: '子任务完成',
    outputReadFailed: '输出读取失败',
    outputRead: '读取到子任务输出',
    stopFailed: '停止失败',
    stopped: '已停止',
    reasoning: '子任务推理',
    output: '子任务输出',
    running: '子任务运行中',
    statusUpdate: '子任务状态更新',
    stopSubagentFailed: '停止子任务失败',
  },
  'en-US': {
    fallbackDescription: 'Subtask',
    started: 'Subtask started',
    readOutput: 'Read subtask output',
    stopRequested: 'Stop requested for subtask',
    dispatched: 'Subtask dispatched',
    failed: 'Subtask failed',
    completed: 'Subtask completed',
    outputReadFailed: 'Failed to read output',
    outputRead: 'Read subtask output',
    stopFailed: 'Stop failed',
    stopped: 'Stopped',
    reasoning: 'Subtask reasoning',
    output: 'Subtask output',
    running: 'Subtask running',
    statusUpdate: 'Subtask status update',
    stopSubagentFailed: 'Failed to stop subtask',
  },
} as const satisfies Record<ProductLanguage, SessionSubagentLabels>;

export function sessionPlanLabels(language?: ProductLanguage | null): SessionPlanLabels {
  return pickByLocale(resolveLanguage(language), SESSION_PLAN_LABELS_BY_LOCALE);
}

export function sessionSubagentLabels(language?: ProductLanguage | null): SessionSubagentLabels {
  return pickByLocale(resolveLanguage(language), SESSION_SUBAGENT_LABELS_BY_LOCALE);
}

export function sessionSubagentToolTitle(toolName: string, language?: ProductLanguage | null): string {
  return pickByLocale(resolveLanguage(language), {
    'zh-CN': `正在使用 ${toolName}`,
    'en-US': `Using ${toolName}`,
  });
}

export function sessionSubagentResultTitle(
  status: SessionSubagentStatus,
  language?: ProductLanguage | null,
): string {
  const labels = sessionSubagentLabels(language);
  if (status === 'running') return labels.dispatched;
  if (status === 'failed') return labels.failed;
  return labels.completed;
}

export function sessionSubagentNotificationTitle(
  status: SessionSubagentStatus,
  language?: ProductLanguage | null,
): string {
  const labels = sessionSubagentLabels(language);
  if (status === 'completed') return labels.completed;
  if (status === 'failed' || status === 'timeout') return labels.failed;
  return labels.statusUpdate;
}
