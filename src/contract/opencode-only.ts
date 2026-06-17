import type { AgentExecutionEngineId } from './types.ts';

export const OPENCODE_ONLY_MODE = true;

export const FORCED_AGENT_EXECUTION_ENGINE: AgentExecutionEngineId = 'opencode';

export function isOpencodeOnlyMode(): boolean {
  return OPENCODE_ONLY_MODE;
}

export function resolveExecutionEngineForProduct(
  requested?: AgentExecutionEngineId | null,
): AgentExecutionEngineId {
  if (OPENCODE_ONLY_MODE) return FORCED_AGENT_EXECUTION_ENGINE;
  return requested || FORCED_AGENT_EXECUTION_ENGINE;
}
