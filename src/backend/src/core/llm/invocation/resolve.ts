import {
  defaultEngine,
  getAdapter,
  profileRuntimeToEngine,
  resolveBindingStorageKey,
  type AgentExecutionEngine,
} from "../../workflow/agent/runtime-adapters/index.ts";

import type { EngineProviderBinding, ResolveInvocationInput, ResolveInvocationResult } from "./types.ts";

export type ProfileConfigLike = {
  runtime?: string | null;
  dynamic?: boolean;
  sourceProviderId?: string;
  sourceModelId?: string;
  provider?: string;
  model?: string;
  [key: string]: unknown;
};

const OPENCODE_MAPPING_HINT =
  "请在设置中为 opencode 绑定供应商和模型。";

export function sanitizeProfileModelId(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

export function canonicalProfileProviderId(providerId: string, modelId: string): string {
  void modelId;
  return String(providerId || "").trim();
}

export function profileIdFromBinding(providerId: string, modelId: string): string {
  const pid = canonicalProfileProviderId(providerId, modelId);
  return `${pid}--${sanitizeProfileModelId(modelId)}`;
}

export function normalizeExplicitProfileId(
  profiles: Record<string, ProfileConfigLike>,
  profileId: string,
): string {
  if (profiles[profileId]) return profileId;
  return profileId;
}

function modelIdAliases(modelId: string): string[] {
  const mid = String(modelId || "").trim();
  return mid ? [mid] : [];
}

export function providerIdAliases(providerId: string, modelId: string): string[] {
  const canonical = canonicalProfileProviderId(providerId, modelId);
  return canonical ? [canonical] : [];
}

export function resolveBinding(
  engine: AgentExecutionEngine,
  settings?: ResolveInvocationInput["agentExecutionSettings"],
): EngineProviderBinding | null {
  const storageKey = resolveBindingStorageKey(engine);
  const bindings = settings?.bindings as Record<string, EngineProviderBinding | undefined> | undefined;
  const binding = bindings?.[storageKey] ?? bindings?.[engine];
  if (binding?.providerId && binding?.modelId) return binding;
  return null;
}

export function findOpencodeProfileForBinding(
  profiles: Record<string, ProfileConfigLike>,
  binding: EngineProviderBinding,
): { profileId: string; profile: ProfileConfigLike } | null {
  const preferredId = `opencode-${profileIdFromBinding(binding.providerId, binding.modelId)}`;
  const preferred = profiles[preferredId];
  if (preferred?.runtime === "opencode") {
    return { profileId: preferredId, profile: preferred };
  }

  const providerIds = providerIdAliases(binding.providerId, binding.modelId);
  const modelIds = modelIdAliases(binding.modelId);

  for (const [id, profile] of Object.entries(profiles)) {
    if (profile.runtime !== "opencode") continue;
    const srcProvider = String(profile.sourceProviderId || "");
    const srcModel = String(profile.sourceModelId || "");
    if (!srcProvider || !srcModel) continue;
    if (providerIds.includes(srcProvider) && modelIds.includes(srcModel)) {
      return { profileId: id, profile };
    }
  }
  return null;
}

export function findOpencodeProfileForDynamic(
  profiles: Record<string, ProfileConfigLike>,
  dynamicProfile: ProfileConfigLike,
): { profileId: string; profile: ProfileConfigLike } | null {
  const providerId = dynamicProfile.sourceProviderId;
  const modelId = dynamicProfile.sourceModelId;
  if (!providerId || !modelId) return null;

  const providerIds = providerIdAliases(String(providerId), String(modelId));
  const modelIds = modelIdAliases(String(modelId));

  for (const [id, profile] of Object.entries(profiles)) {
    if (profile.runtime !== "opencode") continue;
    const srcProvider = profile.sourceProviderId;
    const srcModel = profile.sourceModelId;
    if (!srcProvider || !srcModel) continue;
    if (
      providerIds.includes(srcProvider) &&
      modelIds.includes(srcModel)
    ) {
      return { profileId: id, profile };
    }
  }
  for (const [id, profile] of Object.entries(profiles)) {
    if (profile.runtime !== "opencode") continue;
    if (
      providerIds.includes(String(profile.provider || "")) &&
      typeof profile.model === "string" &&
      modelIds.some((mid) => profile.model!.includes(mid))
    ) {
      return { profileId: id, profile };
    }
  }
  return null;
}

function resolveProfileId(
  profiles: Record<string, ProfileConfigLike>,
  profileId: string,
  engine: AgentExecutionEngine,
  _settings?: ResolveInvocationInput["agentExecutionSettings"] | null,
): Pick<ResolveInvocationResult, "profileId" | "profile" | "executionEngine" | "blocker"> {
  const resolvedProfileId = normalizeExplicitProfileId(profiles, profileId);
  const profile = profiles[resolvedProfileId] || null;
  if (!profile) {
    return {
      profileId: resolvedProfileId,
      profile: null,
      executionEngine: engine,
      blocker: `Profile not found: ${resolvedProfileId}`,
    };
  }

  const profileEngine = profileRuntimeToEngine(profile.runtime);
  if (profileEngine === engine) {
    return { profileId: resolvedProfileId, profile, executionEngine: engine, blocker: null };
  }

  if (profileEngine && profileEngine !== engine) {
    return {
      profileId: resolvedProfileId,
      profile: null,
      executionEngine: engine,
      blocker: `Profile ${resolvedProfileId} 的运行时 (${profile.runtime}) 与所选执行引擎 (${engine}) 不匹配。请更换模型或在设置中切换引擎。`,
    };
  }

  const adapter = getAdapter(engine);
  if (adapter && profile.runtime !== adapter.profileRuntime) {
    return {
      profileId: resolvedProfileId,
      profile: null,
      executionEngine: engine,
      blocker: `Profile ${resolvedProfileId} 的运行时 ${profile.runtime || "(none)"} 不支持引擎 ${engine}。`,
    };
  }

  return { profileId: resolvedProfileId, profile, executionEngine: engine, blocker: null };
}

function pickProfileForEngine(
  profiles: Record<string, ProfileConfigLike>,
  candidateId: string | null | undefined,
  engine: AgentExecutionEngine,
  settings?: ResolveInvocationInput["agentExecutionSettings"] | null,
): { profileId: string; profile: ProfileConfigLike } | null {
  if (candidateId && profiles[candidateId]) {
    const resolved = resolveProfileId(profiles, candidateId, engine, settings);
    if (resolved.profile && !resolved.blocker) {
      return { profileId: resolved.profileId!, profile: resolved.profile };
    }
  }
  if (settings) {
    const binding = resolveBinding(engine, settings);
    if (binding?.providerId && binding?.modelId) {
      const matched = findOpencodeProfileForBinding(profiles, binding);
      if (matched) return matched;
    }
  }
  const adapter = getAdapter(engine);
  if (!adapter) return null;
  for (const [id, profile] of Object.entries(profiles)) {
    if (profile.runtime === adapter.profileRuntime && !profile.dynamic) {
      return { profileId: id, profile };
    }
  }
  return null;
}

export function resolveProfileForEngine(input: {
  executionEngine: AgentExecutionEngine;
  profileId?: string | null;
  agent?: ResolveInvocationInput["agent"];
  profiles: Record<string, ProfileConfigLike>;
  agentExecutionSettings?: ResolveInvocationInput["agentExecutionSettings"] | null;
}): Pick<ResolveInvocationResult, "profileId" | "profile" | "executionEngine" | "blocker"> {
  const engine = input.executionEngine || defaultEngine();
  const settings = input.agentExecutionSettings || null;
  const profiles = input.profiles;

  const explicitProfileId = input.profileId || null;
  const requestedId = explicitProfileId ||
    input.agent?.runtime?.defaultProfile ||
    null;

  if (requestedId && profiles[requestedId]) {
    const resolved = resolveProfileId(profiles, requestedId, engine, settings);
    if (!resolved.blocker) return resolved;
    if (explicitProfileId) return resolved;
  }

  const picked = pickProfileForEngine(
    profiles,
    explicitProfileId ? requestedId : null,
    engine,
    settings,
  );
  if (picked) {
    return resolveProfileId(profiles, picked.profileId, engine, settings);
  }

  if (requestedId && profiles[requestedId]) {
    return resolveProfileId(profiles, requestedId, engine, settings);
  }

  return {
    profileId: requestedId,
    profile: null,
    executionEngine: engine,
    blocker: requestedId
      ? `Profile not found for agent ${input.agent?.id || "(unknown)"}: ${requestedId}`
      : `Agent ${input.agent?.id || "(unknown)"} 没有可用的 ${engine} profile。${OPENCODE_MAPPING_HINT}`,
  };
}

export function resolveExplicitProfileId(input: ResolveInvocationInput): string | null {
  if (input.profileId) return input.profileId;
  const providerId = input.providerId || resolveBinding(input.engine, input.agentExecutionSettings)?.providerId;
  const modelId = input.modelId || resolveBinding(input.engine, input.agentExecutionSettings)?.modelId;
  if (providerId && modelId) return profileIdFromBinding(providerId, modelId);
  return null;
}

export function resolveInvocationCore(input: ResolveInvocationInput): ResolveInvocationResult {
  const engine = input.engine || defaultEngine();
  const binding = resolveBinding(engine, input.agentExecutionSettings);
  const profiles = (input.profiles || {}) as Record<string, ProfileConfigLike>;
  const explicitProfileId = resolveExplicitProfileId(input);

  const resolved = resolveProfileForEngine({
    executionEngine: engine,
    profileId: explicitProfileId,
    agent: input.agent,
    profiles,
    agentExecutionSettings: input.agentExecutionSettings,
  });

  return {
    ...resolved,
    materialized: {},
    binding: binding || (input.providerId && input.modelId
      ? { providerId: input.providerId, modelId: input.modelId }
      : null),
  };
}
