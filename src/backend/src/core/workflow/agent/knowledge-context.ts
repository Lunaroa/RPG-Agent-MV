export const DEFAULT_KNOWLEDGE_COMMAND_TIMEOUT_MS = 0;

export interface KnowledgeTask {
  intent: string | null;
  project: string | null;
}

export interface DockerCommandResult {
  display: string;
  exitCode: number;
  error: string;
  stdout: string;
  stderr: string;
}

export interface KnowledgeContext {
  status: 'skipped' | 'blocked' | 'ingested' | 'ready';
  mode: 'off';
  required?: false;
  projectId?: string | null;
  outDir?: string | null;
  commands?: DockerCommandResult[];
  reason?: string;
  warning?: string;
  blocker?: string;
  markdownPath?: string | null;
  markdown?: string | null;
  jsonPath?: string | null;
  summary?: Record<string, unknown> | null;
}

export interface KnowledgePreparationProgress {
  stage: 'context';
  status: 'skipped';
  command: string;
  containerName: string;
  message?: string;
}

export interface PrepareKnowledgeContextOptions {
  workflowRoot?: string;
  agentId?: string;
  task?: KnowledgeTask;
  skipKnowledgeRefresh?: boolean;
  forceKnowledgeRefresh?: boolean;
  resetProjectIngest?: boolean;
  signal?: AbortSignal;
  taskId?: string;
  commandTimeoutMs?: number;
  projectId?: string;
  contextMode?: string;
  outDir?: string;
  onProgress?: (progress: KnowledgePreparationProgress) => void;
}

export class KnowledgeContextAbortedError extends Error {
  constructor() {
    super('Knowledge context preparation is unavailable because GraphRAG was removed.');
    this.name = 'KnowledgeContextAbortedError';
  }
}

export async function prepareKnowledgeContext(options: PrepareKnowledgeContextOptions): Promise<KnowledgeContext> {
  options.onProgress?.({
    stage: 'context',
    status: 'skipped',
    command: 'graphrag-removed',
    containerName: '',
    message: 'GraphRAG/knowledge-db has been removed.',
  });
  return {
    status: 'skipped',
    mode: 'off',
    required: false,
    projectId: options.projectId || null,
    outDir: options.outDir || null,
    commands: [],
    reason: 'graphrag-removed',
    warning: options.contextMode && options.contextMode !== 'off'
      ? 'GraphRAG context was requested, but GraphRAG/knowledge-db has been removed.'
      : undefined,
  };
}
