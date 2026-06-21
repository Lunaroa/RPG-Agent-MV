import * as providerRegistry from "../provider-registry.ts";
import type { ProviderRecord } from "../provider-registry.ts";
import { loadAgentRegistry } from "../../workflow/agent/agent-registry.ts";
import { defaultEngine, type AgentExecutionEngine, usesOpencodeProviderBinding, resolveBindingStorageKey } from "../../workflow/agent/runtime-adapters/index.ts";
import { ConsoleSettingsDao } from "../../db/dao/console-settings-dao.ts";

import { materializeOpencodeEnv } from "../opencode/materialize-env.ts";
import {
  resolveBinding,
  resolveInvocationCore,
} from "./resolve.ts";
import type {
  ActivateBindingResult,
  CompatibleProviderSummary,
  EngineProviderBinding,
  ResolveInvocationInput,
  ResolveInvocationResult,
} from "./types.ts";

export type {
  ActivateBindingResult,
  CompatibleProviderSummary,
  EngineProviderBinding,
  InvocationMaterialized,
  ResolveInvocationInput,
  ResolveInvocationResult,
} from "./types.ts";
export {
  sanitizeProfileModelId,
  canonicalProfileProviderId,
  profileIdFromBinding,
  resolveBinding,
  resolveExplicitProfileId,
  resolveInvocationCore,
  findOpencodeProfileForBinding,
} from "./resolve.ts";
export {
  parseBindingFromProfileId,
  resolveSessionBinding,
  deserializeProfileModelId,
  bindingMatchesProfileId,
} from "./parse-profile-id.ts";

export function defaultSupportedEngines(provider: ProviderRecord): AgentExecutionEngine[] {
  const explicit = provider.supportedEngines;
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.some((e) => String(e) === "opencode")
      ? ["opencode"]
      : [];
  }
  const opencodeAuth = provider.opencodeAuth as { enabled?: boolean } | undefined;
  if (opencodeAuth?.enabled || provider.protocol === "anthropic" || provider.protocol === "openai-compatible") return ["opencode"];
  return [];
}

/** Whether a provider may appear in settings / activation lists for the given engine. */
export function providerSupportsEngine(
  provider: ProviderRecord,
  engine: AgentExecutionEngine,
): boolean {
  return defaultSupportedEngines(provider).includes(engine);
}

export async function listCompatibleProviders(
  engine: AgentExecutionEngine,
  workflowRoot: string,
): Promise<CompatibleProviderSummary[]> {
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const out: CompatibleProviderSummary[] = [];
  for (const [id, provider] of Object.entries(doc.providers || {})) {
    if (!providerSupportsEngine(provider, engine)) continue;
    const serialized = providerRegistry.serializeProvider(id, provider);
    out.push({
      id: serialized.id,
      displayName: serialized.label,
      protocol: serialized.protocol,
      baseUrl: serialized.baseUrl,
      defaultModel: serialized.models[0]?.id || "",
      credentialPresent: serialized.credentialPresent,
      models: serialized.models,
      hiddenModelIds: serialized.hiddenModelIds,
      supportedEngines: defaultSupportedEngines(provider),
      presetKind: typeof provider.presetKind === "string" ? provider.presetKind : undefined,
    });
  }
  return out;
}

async function runMaterializers(
  workflowRoot: string,
  engine: AgentExecutionEngine,
  binding: EngineProviderBinding | null,
  _agentExecutionSettings?: ResolveInvocationInput["agentExecutionSettings"] | null,
): Promise<ResolveInvocationResult["materialized"]> {
  const materialized: ResolveInvocationResult["materialized"] = {};
  if (usesOpencodeProviderBinding(engine) && binding?.providerId) {
    const doc = await providerRegistry.loadDocument(workflowRoot);
    const provider = doc.providers[binding.providerId] || null;
    const opencode = materializeOpencodeEnv(provider, { modelId: binding.modelId });
    materialized.agentRuntimeEnvKeys = opencode.envKeys;
    for (const [key, value] of Object.entries(opencode.env)) {
      process.env[key] = value;
    }
  }
  return materialized;
}

export async function resolveInvocation(input: ResolveInvocationInput): Promise<ResolveInvocationResult> {
  let profiles = input.profiles;
  let agent = input.agent;
  if (!profiles || (input.agent?.id && !agent)) {
    const registry = loadAgentRegistry({ workflowRoot: input.workflowRoot });
    profiles = profiles || registry.profiles;
    if (input.agent?.id) {
      agent = agent || registry.agents[input.agent.id];
    }
  }

  const core = resolveInvocationCore({
    ...input,
    profiles: profiles || {},
    agent,
  });

  if (input.materialize === false) {
    return core;
  }

  const binding = core.binding ||
    (input.providerId && input.modelId
      ? { providerId: input.providerId, modelId: input.modelId }
      : resolveBinding(input.engine, input.agentExecutionSettings));

  const materialized = await runMaterializers(
    input.workflowRoot,
    input.engine,
    binding,
    input.agentExecutionSettings,
  );
  return { ...core, materialized };
}

export async function activateBinding(
  workflowRoot: string,
  engine: AgentExecutionEngine,
  providerId: string,
  modelId: string,
  settingsPatch?: Record<string, unknown> | null,
): Promise<ActivateBindingResult> {
  const stored = (ConsoleSettingsDao.get("agentExecution") || {}) as Record<string, unknown>;
  const storageKey = resolveBindingStorageKey(engine);
  const bindings = {
    [storageKey]: { providerId, modelId },
  };
  const mergedSettings = {
    ...stored,
    ...settingsPatch,
    engine: engine || stored.engine || defaultEngine(),
    bindings,
    lastSyncedAt: new Date().toISOString(),
  };
  ConsoleSettingsDao.set("agentExecution", mergedSettings);

  const materialized = await runMaterializers(
    workflowRoot,
    engine,
    { providerId, modelId },
    mergedSettings as ResolveInvocationInput["agentExecutionSettings"],
  );

  const materializedOut: ActivateBindingResult["materialized"] = {};
  if (materialized.agentRuntimeEnvKeys?.length) {
    materializedOut.agentRuntimeEnvKeys = [...materialized.agentRuntimeEnvKeys];
  }

  // opencode validates straight from the selected provider; no profiles.yaml
  // row and no placeholder profile generation.
  if (usesOpencodeProviderBinding(engine)) {
    const doc = await providerRegistry.loadDocument(workflowRoot);
    const provider = doc.providers[providerId] || null;
    const opencode = materializeOpencodeEnv(provider, { modelId });
    return {
      ok: !opencode.blocker,
      profileId: opencode.blocker ? null : `opencode:${providerId}:${modelId}`,
      blocker: opencode.blocker,
      materialized: materializedOut,
      bindings,
      lastSyncedAt: mergedSettings.lastSyncedAt as string,
    };
  }

  throw new Error(`Unsupported execution engine: ${engine}`);
}

export async function activateForSession(
  workflowRoot: string,
  engine: AgentExecutionEngine,
  bindingOverride?: EngineProviderBinding | null,
): Promise<ResolveInvocationResult["materialized"]> {
  const stored = (ConsoleSettingsDao.get("agentExecution") || {}) as {
    bindings?: Partial<Record<AgentExecutionEngine, EngineProviderBinding>>;
  };
  const binding =
    bindingOverride?.providerId && bindingOverride?.modelId
      ? bindingOverride
      : resolveBinding(engine, stored);
  return runMaterializers(workflowRoot, engine, binding);
}

export { defaultEngine } from "../../workflow/agent/runtime-adapters/index.ts";
