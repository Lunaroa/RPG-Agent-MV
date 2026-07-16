import type { AgentExecutionEngine } from "../../workflow/agent/runtime-adapters/types.ts";

export interface EngineProviderBinding {
  providerId: string;
  modelId: string;
}

export interface InvocationMaterialized {
  agentRuntimeEnvKeys?: string[];
}

export interface ResolveInvocationInput {
  workflowRoot: string;
  engine: AgentExecutionEngine;
  agentId?: string;
  providerId?: string | null;
  modelId?: string | null;
  profileId?: string | null;
  agent?: { id: string; runtime?: { defaultProfile?: string | null; [key: string]: unknown }; [key: string]: unknown };
  profiles?: Record<string, { [key: string]: unknown }>;
  agentExecutionSettings?: {
    engine?: AgentExecutionEngine;
    bindings?: Partial<Record<AgentExecutionEngine, EngineProviderBinding>>;
    [key: string]: unknown;
  } | null;
  materialize?: boolean;
}

export interface ResolveInvocationResult {
  profileId: string | null;
  profile: Record<string, unknown> | null;
  executionEngine: AgentExecutionEngine;
  blocker: string | null;
  materialized: InvocationMaterialized;
  binding: EngineProviderBinding | null;
}

export interface ActivateBindingResult {
  ok: boolean;
  profileId: string | null;
  blocker: string | null;
  materialized: InvocationMaterialized;
  bindings: Partial<Record<AgentExecutionEngine, EngineProviderBinding>>;
  lastSyncedAt: string;
}

export interface CompatibleProviderSummary {
  id: string;
  displayName: string;
  protocol?: string;
  baseUrl: string;
  defaultModel: string;
  credentialPresent: boolean;
  models: Array<{ id: string; label: string; inputModalities?: string[] }>;
  hiddenModelIds: string[];
  supportedEngines?: AgentExecutionEngine[];
  presetKind?: string;
  disableModelFetch?: boolean;
  opencodeAuth?: { enabled?: boolean; envVar?: string };
  source?: "opencode" | "product-seed" | "user";
}
