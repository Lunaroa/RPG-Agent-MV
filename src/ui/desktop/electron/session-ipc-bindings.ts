import { toIpcPayload } from './ipc-serialize.ts';

interface IpcEvent {
  sender: {
    id: number;
    isDestroyed: () => boolean;
    send: (channel: string, payload: unknown) => void;
  };
}

interface IpcLike {
  handle: (channel: string, listener: (event: IpcEvent, ...args: any[]) => unknown) => void;
  removeHandler: (channel: string) => void;
}

interface SlashCommandResult {
  ok: boolean;
  display: 'composer_hint' | 'chat_status';
  message: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  data?: Record<string, unknown>;
}

interface GetContextUsageResult {
  ok: boolean;
  data?: {
    contextUsedTokens: number;
    contextWindowTokens: number;
    contextPercent: number;
  };
  message?: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
}

interface SessionRuntime {
  getBootstrap: () => unknown;
  list: () => unknown[];
  get: (id: string) => unknown | null;
  history: (id: string) => unknown[];
  create: (payload: Record<string, unknown>) => Promise<unknown>;
  preview: (payload: Record<string, unknown>) => Promise<unknown>;
  stop: (id: string) => unknown | null;
  delete: (id: string) => boolean;
  deleteMany: (ids: string[]) => unknown;
  saveChatLog: (id: string, data: Record<string, unknown>) => boolean;
  submitAskResult: (sessionId: string, askId: string, result: unknown) => unknown | Promise<unknown>;
  listTasks: (sessionId: string) => unknown[];
  updateTask: (sessionId: string, taskId: string, patch: Record<string, unknown>) => unknown;
  getPlan: (sessionId: string) => unknown;
  listSubagents: (sessionId: string) => unknown;
  stopSubagent: (sessionId: string, taskId: string) => unknown;
  listSlashCommands(): Record<string, unknown>[];
  getContextUsage(sessionId: string): Promise<GetContextUsageResult>;
  slashCommand(sessionId: string, command: string, args?: string): Promise<SlashCommandResult>;
  subscribe: (
    sessionId: string,
    subscriber: { id: string; write: (event: unknown) => void },
    lastSequence?: number,
  ) => unknown[];
  unsubscribe: (sessionId: string, subscriberId: string) => void;
}

interface SessionIpcActions {
  revealArtifacts: (sessionId: string) => Promise<unknown>;
}

export const SESSION_IPC_CHANNELS = [
  'bootstrap:get',
  'sessions:list',
  'sessions:get',
  'sessions:create',
  'sessions:delete',
  'sessions:deleteMany',
  'sessions:stop',
  'sessions:history',
  'sessions:saveChatLog',
  'sessions:submitAskResult',
  'sessions:listTasks',
  'sessions:updateTask',
  'sessions:getPlan',
  'sessions:listSubagents',
  'sessions:stopSubagent',
  'sessions:preview',
  'sessions:listSlashCommands',
  'sessions:getContextUsage',
  'sessions:slashCommand',
  'sessions:revealArtifacts',
  'sessions:subscribe',
  'sessions:unsubscribe',
] as const;

export function registerSessionIpcHandlers(
  ipc: IpcLike,
  runtime: SessionRuntime,
  actions?: SessionIpcActions,
): void {
  ipc.handle('bootstrap:get', () => runtime.getBootstrap());
  ipc.handle('sessions:list', () => runtime.list());
  ipc.handle('sessions:get', (_event, id: string) => required(runtime.get(id)));
  ipc.handle('sessions:create', (_event, payload: Record<string, unknown>) => runtime.create(withoutInternalSystemPrompt(payload)));
  ipc.handle('sessions:delete', (_event, id: string) => ({ success: runtime.delete(id) }));
  ipc.handle('sessions:deleteMany', (_event, ids: unknown) => runtime.deleteMany(requireSessionIds(ids)));
  ipc.handle('sessions:stop', (_event, id: string) => required(runtime.stop(id)));
  ipc.handle('sessions:history', (_event, id: string) => runtime.history(id));
  ipc.handle('sessions:saveChatLog', (_event, id: string, data: Record<string, unknown>) => ({
    success: runtime.saveChatLog(id, data),
  }));
  ipc.handle('sessions:submitAskResult', async (_event, sessionId: string, askId: string, result: unknown) => (
    toIpcPayload(await runtime.submitAskResult(sessionId, askId, result))
  ));
  ipc.handle('sessions:listTasks', (_event, sessionId: string) => toIpcPayload(runtime.listTasks(sessionId)));
  ipc.handle('sessions:updateTask', (_event, sessionId: string, taskId: string, patch: Record<string, unknown>) => (
    toIpcPayload(runtime.updateTask(sessionId, taskId, patch))
  ));
  ipc.handle('sessions:getPlan', (_event, sessionId: string) => toIpcPayload(runtime.getPlan(sessionId)));
  // Derive subagents from persisted events so refresh and conversation restore match the live stream.
  ipc.handle('sessions:listSubagents', (_event, sessionId: string) => toIpcPayload(runtime.listSubagents(sessionId)));
  ipc.handle('sessions:stopSubagent', (_event, sessionId: string, taskId: string) => (
    toIpcPayload(runtime.stopSubagent(sessionId, taskId))
  ));
  ipc.handle('sessions:preview', (_event, payload: Record<string, unknown>) => runtime.preview(withoutInternalSystemPrompt(payload)));
  ipc.handle('sessions:listSlashCommands', () => toIpcPayload(runtime.listSlashCommands()));
  ipc.handle('sessions:getContextUsage', async (_event, sessionId: string) => (
    toIpcPayload(await runtime.getContextUsage(sessionId))
  ));
  ipc.handle('sessions:slashCommand', async (_event, sessionId: string, command: string, args?: string) => (
    toIpcPayload(await runtime.slashCommand(sessionId, command, args))
  ));
  ipc.handle('sessions:revealArtifacts', (_event, sessionId: string) => {
    if (!actions) throw new Error('reveal artifacts is unavailable');
    required(runtime.get(sessionId));
    return actions.revealArtifacts(sessionId);
  });
  ipc.handle('sessions:subscribe', (event, sessionId: string, lastSequence = 0) => {
    const subscriberId = String(event.sender.id);
    runtime.unsubscribe(sessionId, subscriberId);
    const replay = runtime.subscribe(sessionId, {
      id: subscriberId,
      write: (sessionEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('sessions:event', { sessionId, event: sessionEvent });
        }
      },
    }, lastSequence);
    return { sessionId, replayed: replay.length };
  });
  ipc.handle('sessions:unsubscribe', (event, sessionId: string) => {
    runtime.unsubscribe(sessionId, String(event.sender.id));
    return { success: true };
  });
}

export function cleanupSessionIpcHandlers(ipc: IpcLike): void {
  for (const channel of SESSION_IPC_CHANNELS) ipc.removeHandler(channel);
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error('session not found');
  return value;
}

function requireSessionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('session ids must be a non-empty string array');
  }
  return [...new Set(value.map((id) => id.trim()))];
}

function withoutInternalSystemPrompt(payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'profileId',
    'providerId',
    'modelId',
    'executionEngine',
    'intent',
    'displayText',
    'project',
    'continuationOf',
    'mapId',
    'taskId',
    'files',
    'thinkingLevel',
    'timeoutMs',
    'productLanguage',
    'imageAttachments',
    'requiresImageInput',
  ];
  const safe: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.hasOwn(payload, key)) safe[key] = payload[key];
  }
  return safe;
}
