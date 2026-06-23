import type { ProductLanguage } from '@contract/types';
import type { SessionSubagentStatus } from '@contract/types';
import { DEFAULT_PRODUCT_LANGUAGE, pickByLocale } from '../../../../contract/i18n.ts';

interface SubagentStoreLabels {
  started: string;
  readOutput: string;
  stopRequested: string;
  failed: string;
  dispatched: string;
  completed: string;
  outputReadFailed: string;
  outputRead: string;
  stopFailed: string;
  stopped: string;
  reasoning: string;
  output: string;
  running: string;
  statusUpdate: string;
  loadFailed: string;
}

const SUBAGENT_STORE_LABELS_BY_LOCALE: Record<ProductLanguage, SubagentStoreLabels> = {
  'zh-CN': {
    started: '启动子任务',
    readOutput: '读取子任务输出',
    stopRequested: '请求停止子任务',
    failed: '子任务失败',
    dispatched: '子任务已派发',
    completed: '子任务完成',
    outputReadFailed: '输出读取失败',
    outputRead: '读取到子任务输出',
    stopFailed: '停止失败',
    stopped: '已停止',
    reasoning: '子任务推理',
    output: '子任务输出',
    running: '子任务运行中',
    statusUpdate: '子任务状态更新',
    loadFailed: '加载 subagent 失败',
  },
  'en-US': {
    started: 'Subtask started',
    readOutput: 'Read subtask output',
    stopRequested: 'Stop requested for subtask',
    failed: 'Subtask failed',
    dispatched: 'Subtask dispatched',
    completed: 'Subtask completed',
    outputReadFailed: 'Failed to read output',
    outputRead: 'Read subtask output',
    stopFailed: 'Stop failed',
    stopped: 'Stopped',
    reasoning: 'Subtask reasoning',
    output: 'Subtask output',
    running: 'Subtask running',
    statusUpdate: 'Subtask status update',
    loadFailed: 'Failed to load subagents',
  },
};

export function subagentStoreLabels(language?: ProductLanguage | null): SubagentStoreLabels {
  return pickByLocale(language ?? DEFAULT_PRODUCT_LANGUAGE, SUBAGENT_STORE_LABELS_BY_LOCALE);
}

export function subagentToolTitle(toolName: string, language?: ProductLanguage | null): string {
  return pickByLocale(language ?? DEFAULT_PRODUCT_LANGUAGE, {
    'zh-CN': `正在使用 ${toolName}`,
    'en-US': `Using ${toolName}`,
  });
}

export function subagentResultTitle(
  status: SessionSubagentStatus,
  failed: boolean,
  language?: ProductLanguage | null,
): string {
  const labels = subagentStoreLabels(language);
  if (status === 'running') return labels.dispatched;
  if (failed) return labels.failed;
  return labels.completed;
}

export function subagentNotificationTitle(status: SessionSubagentStatus, language?: ProductLanguage | null): string {
  const labels = subagentStoreLabels(language);
  if (status === 'completed') return labels.completed;
  if (status === 'failed' || status === 'timeout') return labels.failed;
  return labels.statusUpdate;
}