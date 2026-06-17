import { defaultEngine, type AgentExecutionEngine, type AgentExecutionSettingsLike } from "./runtime-adapters/index.ts";
import { resolveInvocationCore } from "../../llm/invocation/resolve.ts";

export interface ProfileConfigLike {
  runtime?: string | null;
  dynamic?: boolean;
  sourceProviderId?: string;
  sourceModelId?: string;
  [key: string]: unknown;
}

export interface AgentConfigLike {
  id: string;
  runtime?: {
    defaultProfile?: string | null;
    escalationProfiles?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ProfileResolveInput {
  executionEngine?: AgentExecutionEngine;
  profileId?: string | null;
  agent: AgentConfigLike;
  profiles: Record<string, ProfileConfigLike>;
  agentExecutionSettings?: AgentExecutionSettingsLike | null;
}

export interface ProfileResolveResult {
  profileId: string | null;
  profile: ProfileConfigLike | null;
  executionEngine: AgentExecutionEngine;
  blocker: string | null;
}

export function resolveAgentProfile(input: ProfileResolveInput): ProfileResolveResult {
  const engine = input.executionEngine || defaultEngine();
  const result = resolveInvocationCore({
    workflowRoot: "",
    engine,
    profileId: input.profileId,
    agent: input.agent,
    profiles: input.profiles,
    agentExecutionSettings: input.agentExecutionSettings,
    materialize: false,
  });
  return {
    profileId: result.profileId,
    profile: result.profile as ProfileConfigLike | null,
    executionEngine: result.executionEngine,
    blocker: result.blocker,
  };
}
