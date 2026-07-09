import fs from "fs";
import path from "path";

import { ProviderDao } from "../../db/dao/provider-dao.ts";
import {
  resolveAgentsRegistryPath,
  resolveWorkflowRelativePath,
  resolveWorkflowRoot,
} from "../../workspace-paths.ts";
import { getConfiguredDatabasePath } from "../../db/pool.ts";
import { canonicalProfileProviderId } from "../../llm/invocation/resolve.ts";

interface RegistryOptions {
  workflowRoot?: string;
  registryPath?: string;
}

interface RegistryEntry {
  path: string;
  defaultProfile?: string;
  escalationProfiles?: string[];
  [key: string]: unknown;
}

interface AgentRuntime {
  defaultProfile?: string | null;
  escalationProfiles?: string[];
  [key: string]: unknown;
}

interface AgentPaths {
  config: string;
  skills: string[];
  memory: string[];
  workspace: string | null;
}

interface AgentConfig {
  id: string;
  role?: string;
  description?: string;
  runtime?: AgentRuntime;
  skills?: string[];
  memory?: string[];
  workspace?: { root?: string };
  tools?: { allow?: string[]; deny?: string[]; [key: string]: unknown };
  permissions?: Record<string, unknown>;
  handoff?: { produces?: string[]; [key: string]: unknown };
  registryEntry?: RegistryEntry;
  paths?: AgentPaths;
  [key: string]: unknown;
}

interface ProfileConfig {
  runtime?: string;
  provider?: string;
  protocol?: string;
  model?: string;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  modelEnv?: string | null;
  baseUrlEnv?: string | null;
  command?: string;
  tools?: string[];
  label?: string | null;
  dynamic?: boolean;
  envFileHint?: string | null;
  mapsToRuntimeEnv?: Record<string, string>;
  [key: string]: unknown;
}

interface Registry {
  version: number;
  workflowRoot: string;
  registryPath: string;
  runtimeRoot: string;
  defaultEnvFile: string | null;
  profilePath: string;
  profiles: Record<string, ProfileConfig>;
  workflow: {
    coordination?: Record<string, unknown>;
    defaultOrder?: string[];
    repairRoutes?: Record<string, string>;
    [key: string]: unknown;
  };
  agents: Record<string, AgentConfig>;
}

interface WorkflowStage {
  step: number;
  agentId: string;
  role: string | null;
  description: string | null;
  defaultProfile: string | null;
  defaultProfileConfig: ProfileConfig | null;
  escalationProfiles: string[];
  produces: string[];
}

interface WorkflowPlan {
  coordination: Record<string, unknown> | null;
  defaultOrder: string[];
  repairRoutes: Record<string, string>;
  stages: WorkflowStage[];
}

interface RepairRoute {
  failureKind: string;
  agentId: string | null;
  agentRole?: string | null;
  agentExists?: boolean;
  escalateTo?: string;
  reason: string;
}

interface SummarizedAgent {
  id: string;
  role?: string;
  description?: string;
  runtime: SummarizedRuntime | null;
  workspace?: { root?: string } | null;
  skills?: string[];
  memory?: string[];
  tools?: { allow?: string[]; deny?: string[]; [key: string]: unknown };
  permissions?: Record<string, unknown>;
  handoff?: { produces?: string[]; [key: string]: unknown };
  configPath?: string | null;
}

interface SummarizedRuntime {
  defaultProfile: string | null;
  defaultProfileConfig: SummarizedProfile | null;
  escalationProfiles: string[];
  escalationProfileConfigs: SummarizedProfile[];
  escalationWhen: unknown[];
}

interface SummarizedProfile {
  runtime: string | null;
  provider: string | null;
  protocol: string | null;
  model: string | null;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  modelEnv: string | null;
  baseUrlEnv: string | null;
  command: string | null;
  tools: string[];
  label: string | null;
  dynamic: boolean;
}

interface SummarizedRegistry {
  version: number;
  registryPath: string;
  runtimeRoot: string;
  defaultEnvFile: string | null;
  profilePath: string;
  agents: string[];
  profiles: string[];
}

interface StoredProviderConfig {
  label?: string;
  protocol?: string;
  baseUrl?: string;
  models?: (string | { id?: string })[];
  opencodeAuth?: {
    enabled?: boolean;
    envVar?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function loadAgentRegistry(options?: RegistryOptions | null): Registry {
  const workflowRoot: string = path.resolve(
    options?.workflowRoot || resolveWorkflowRoot(import.meta.dirname),
  );
  const registryPath: string = path.resolve(
    options?.registryPath || resolveAgentsRegistryPath(workflowRoot),
  );
  const registry = readJsonCompatibleYaml(registryPath) as Record<string, unknown>;
  const profilePath: string = resolveWorkflowRelativePath(
    workflowRoot,
    (registry.providerProfilesFile as string) || "config/api-profiles/profiles.yaml",
  );
  const profileDocument = fs.existsSync(profilePath)
    ? readJsonCompatibleYaml(profilePath) as Record<string, unknown>
    : { profiles: {} };
  const profiles = (profileDocument.profiles || {}) as Record<string, ProfileConfig>;
  const dynamicProfileIds: string[] = mergeDynamicProviderProfiles(profiles, registry.defaultEnvFile as string | null);
  const agents: Record<string, AgentConfig> = {};
  for (const entry of (registry.agents || []) as RegistryEntry[]) {
    const agentPath: string = resolveWorkflowRelativePath(workflowRoot, entry.path);
    const agent = readJsonCompatibleYaml(agentPath) as AgentConfig;
    const defaultProfileId: string | null = (agent.runtime && agent.runtime.defaultProfile) || entry.defaultProfile || null;
    const escalationProfileIds: string[] = [
      ...(entry.escalationProfiles || []),
      ...((agent.runtime && agent.runtime.escalationProfiles) || [])
    ].filter((value: string, index: number, all: string[]) => value && all.indexOf(value) === index);
    const mergedEscalation: string[] = [
      ...escalationProfileIds,
      ...dynamicProfileIds.filter((id: string) => !escalationProfileIds.includes(id) && id !== defaultProfileId)
    ];
    agents[agent.id] = {
      ...agent,
      registryEntry: entry,
      paths: {
        config: agentPath,
        skills: (agent.skills || []).map((skillPath: string) => resolveWorkflowRelativePath(workflowRoot, skillPath)),
        memory: (agent.memory || []).map((memoryPath: string) => resolveWorkflowRelativePath(workflowRoot, memoryPath)),
        workspace: agent.workspace && agent.workspace.root
          ? resolveWorkflowRelativePath(workflowRoot, agent.workspace.root)
          : null
      },
      runtime: {
        ...(agent.runtime || {}),
        defaultProfile: defaultProfileId,
        defaultProfileConfig: defaultProfileId ? profiles[defaultProfileId] || null : null,
        escalationProfiles: mergedEscalation,
        escalationProfileConfigs: mergedEscalation.map((id: string) => profiles[id] || null).filter(Boolean) as ProfileConfig[]
      }
    };
  }
  return {
    version: (registry.version as number) || 1,
    workflowRoot,
    registryPath,
    runtimeRoot: resolveWorkflowRelativePath(workflowRoot, (registry.runtimeRoot as string) || "runtime"),
    defaultEnvFile: (registry.defaultEnvFile as string) || null,
    profilePath,
    profiles,
    workflow: (registry.workflow || {}) as Registry["workflow"],
    agents
  };
}

function getAgentConfig(registry: Registry, id: string): AgentConfig | null {
  return registry && registry.agents && registry.agents[id] || null;
}

function loadWorkflowPlan(registry: Registry): WorkflowPlan {
  if (!registry) throw new Error("loadWorkflowPlan requires a registry");
  const workflow = registry.workflow || {};
  const coordination: Record<string, unknown> | null = workflow.coordination && typeof workflow.coordination === "object"
    ? { ...workflow.coordination }
    : null;
  const defaultOrder: string[] = Array.isArray(workflow.defaultOrder) ? workflow.defaultOrder.slice() : [];
  const repairRoutes: Record<string, string> = workflow.repairRoutes && typeof workflow.repairRoutes === "object"
    ? { ...workflow.repairRoutes }
    : {};
  const stages: WorkflowStage[] = defaultOrder.map((agentId: string, index: number) => {
    const agent = getAgentConfig(registry, agentId);
    if (!agent) {
      throw new Error(`registry.workflow.defaultOrder references unknown agent: ${agentId}`);
    }
    return {
      step: index + 1,
      agentId,
      role: agent.role || null,
      description: agent.description || null,
      defaultProfile: (agent.runtime && agent.runtime.defaultProfile) || null,
      defaultProfileConfig: (agent.runtime && agent.runtime.defaultProfileConfig as ProfileConfig) || null,
      escalationProfiles: (agent.runtime && agent.runtime.escalationProfiles) || [],
      produces: (agent.handoff && agent.handoff.produces) || []
    };
  });
  return { coordination, defaultOrder, repairRoutes, stages };
}

function routeRepair(registry: Registry, failureKind: string): RepairRoute {
  if (!registry) throw new Error("routeRepair requires a registry");
  const repairRoutes = (registry.workflow && registry.workflow.repairRoutes) || {};
  const target = repairRoutes[failureKind] || repairRoutes["ambiguous"] || null;
  if (!target) {
    return { failureKind, agentId: null, reason: "no repair route configured" };
  }
  if (target === "orchestrator") {
    return { failureKind, agentId: null, escalateTo: "orchestrator", reason: "registry routes this failure back to orchestrator" };
  }
  const agent = getAgentConfig(registry, target);
  return {
    failureKind,
    agentId: target,
    agentRole: agent && agent.role || null,
    agentExists: Boolean(agent),
    reason: agent
      ? `registry.repairRoutes[${failureKind}] = ${target}`
      : `registry.repairRoutes[${failureKind}] = ${target} but agent definition missing`
  };
}

function summarizeAgentForTrace(agent: AgentConfig | null): SummarizedAgent | null {
  if (!agent) return null;
  return {
    id: agent.id,
    role: agent.role,
    description: agent.description,
    runtime: summarizeRuntime(agent.runtime),
    workspace: agent.workspace || null,
    skills: agent.skills || [],
    memory: agent.memory || [],
    tools: agent.tools || {},
    permissions: agent.permissions || {},
    handoff: agent.handoff || {},
    configPath: agent.paths && agent.paths.config || null
  };
}

function summarizeRegistryForTrace(registry: Registry | null): SummarizedRegistry | null {
  if (!registry) return null;
  return {
    version: registry.version,
    registryPath: registry.registryPath,
    runtimeRoot: registry.runtimeRoot,
    profilePath: registry.profilePath,
    defaultEnvFile: registry.defaultEnvFile,
    agents: Object.keys(registry.agents || {}),
    profiles: Object.keys(registry.profiles || {})
  };
}

function summarizeRuntime(runtime?: AgentRuntime): SummarizedRuntime | null {
  if (!runtime) return null;
  return {
    defaultProfile: runtime.defaultProfile || null,
    defaultProfileConfig: summarizeProfile(runtime.defaultProfileConfig as ProfileConfig),
    escalationProfiles: runtime.escalationProfiles || [],
    escalationProfileConfigs: ((runtime.escalationProfileConfigs || []) as ProfileConfig[]).map(summarizeProfile),
    escalationWhen: (runtime.escalationWhen || []) as unknown[]
  };
}

function summarizeProfile(profile?: ProfileConfig): SummarizedProfile {
  if (!profile) return null as unknown as SummarizedProfile;
  return {
    runtime: profile.runtime || null,
    provider: profile.provider || null,
    protocol: profile.protocol || null,
    model: profile.model || null,
    baseUrl: profile.baseUrl || null,
    apiKeyEnv: profile.apiKeyEnv || null,
    modelEnv: profile.modelEnv || null,
    baseUrlEnv: profile.baseUrlEnv || null,
    command: profile.command || null,
    tools: profile.tools || [],
    label: profile.label || null,
    dynamic: Boolean(profile.dynamic)
  };
}

function mergeDynamicProviderProfiles(profiles: Record<string, ProfileConfig>, defaultEnvFile: string | null): string[] {
  if (!getConfiguredDatabasePath()) return [];
  const dynamicIds: string[] = [];
  for (const row of ProviderDao.list()) {
    const providerId = row.id;
    const provider = row.config as StoredProviderConfig;
    if (!provider) continue;
    const credentialValue = typeof provider.credentialValue === "string"
      ? provider.credentialValue.trim()
      : "";
    // Full catalog sync may leave 150+ unkeyed presets in SQLite — only activate keyed ones.
    if (!credentialValue) continue;
    const auth = provider.opencodeAuth || {};
    if (!auth.enabled && provider.protocol !== "anthropic" && provider.protocol !== "openai-compatible") continue;
    const models = Array.isArray(provider.models) ? provider.models : [];
    for (const model of models) {
      const modelId: string | undefined = typeof model === "string" ? model : (model && model.id);
      if (!modelId) continue;
      const canonicalProviderId = canonicalProfileProviderId(providerId, modelId);
      const profileId: string = `${canonicalProviderId}--${sanitizeId(modelId)}`;
      if (profiles[profileId]) continue;
      const fullModel = modelId.includes("/") ? modelId : `${canonicalProviderId}/${modelId}`;
      profiles[profileId] = {
        runtime: "opencode",
        provider: canonicalProviderId,
        protocol: "openai-compatible",
        model: fullModel,
        baseUrl: provider.baseUrl || null,
        label: `${provider.label || providerId} · ${modelId}`,
        envFileHint: defaultEnvFile || null,
        apiKeyEnv: auth.envVar || null,
        mapsToRuntimeEnv: {},
        dynamic: true,
        sourceProviderId: canonicalProviderId,
        sourceModelId: modelId
      };
      dynamicIds.push(profileId);
    }
  }
  return dynamicIds;
}

function sanitizeId(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

function readJsonCompatibleYaml(filePath: string): unknown {
  const text: string = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath} must be JSON-compatible YAML for the workflow loader: ${(error as Error).message}`);
  }
}

function resolveFromRoot(workflowRoot: string, value: string | null | undefined): string | null {
  if (!value) return null;
  return resolveWorkflowRelativePath(workflowRoot, value);
}

export {
  getAgentConfig,
  loadAgentRegistry,
  loadWorkflowPlan,
  routeRepair,
  summarizeAgentForTrace,
  summarizeRegistryForTrace
};
