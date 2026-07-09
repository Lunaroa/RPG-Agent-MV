import type { AgentExecutionEngine } from "../../workflow/agent/runtime-adapters/types.ts";
import * as providerRegistry from "../provider-registry.ts";
import type { ProviderRecord } from "../provider-registry.ts";
import { readProviderSeedFile, type ProviderSeedEntry } from "../provider-seeds.ts";
import type { CompatibleProviderSummary } from "./types.ts";

export type ProviderListSource = "opencode" | "product-seed" | "user";

export interface SettingsProviderSummary extends CompatibleProviderSummary {
  source: ProviderListSource;
  disableModelFetch?: boolean;
  opencodeAuth?: { enabled?: boolean; envVar?: string };
}

function supportedEnginesFor(provider: {
  supportedEngines?: string[];
  protocol?: string;
  opencodeAuth?: { enabled?: boolean };
}): AgentExecutionEngine[] {
  const explicit = provider.supportedEngines;
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.some((entry) => String(entry) === "opencode") ? ["opencode"] : [];
  }
  if (provider.opencodeAuth?.enabled || provider.protocol === "anthropic" || provider.protocol === "openai-compatible") {
    return ["opencode"];
  }
  return [];
}

function supportsEngine(
  provider: {
    supportedEngines?: string[];
    protocol?: string;
    opencodeAuth?: { enabled?: boolean };
  },
  engine: AgentExecutionEngine,
): boolean {
  return supportedEnginesFor(provider).includes(engine);
}

function seedModels(entry: ProviderSeedEntry): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const model of entry.models || []) {
    if (typeof model === "string") {
      const id = model.trim();
      if (id) out.push({ id, label: id });
      continue;
    }
    if (!model || typeof model !== "object") continue;
    const id = String(model.id || "").trim();
    if (!id) continue;
    out.push({ id, label: String(model.label || id) });
  }
  return out;
}

function fromSeed(entry: ProviderSeedEntry): SettingsProviderSummary {
  const models = seedModels(entry);
  return {
    id: entry.id,
    displayName: entry.label || entry.id,
    protocol: entry.protocol || "openai-compatible",
    baseUrl: entry.baseUrl,
    defaultModel: models[0]?.id || "",
    credentialPresent: false,
    models,
    hiddenModelIds: [],
    supportedEngines: (entry.supportedEngines as AgentExecutionEngine[] | undefined) || ["opencode"],
    presetKind: "product-seed",
    source: "product-seed",
    disableModelFetch: entry.disableModelFetch === true,
    opencodeAuth: entry.opencodeAuth,
  };
}

function fromRegistry(
  provider: Awaited<ReturnType<typeof providerRegistry.listProviders>>[number],
  source: ProviderListSource,
): SettingsProviderSummary {
  return {
    id: provider.id,
    displayName: provider.label || provider.id,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    defaultModel: provider.models[0]?.id || "",
    credentialPresent: provider.credentialPresent,
    models: provider.models.map((model) => ({ id: model.id, label: model.label || model.id })),
    hiddenModelIds: provider.hiddenModelIds || [],
    supportedEngines: (provider.supportedEngines as AgentExecutionEngine[] | undefined)
      || supportedEnginesFor(provider as ProviderRecord),
    presetKind: provider.presetKind,
    source,
    disableModelFetch: provider.disableModelFetch,
    opencodeAuth: provider.opencodeAuth,
  };
}

function mergeProvider(
  base: SettingsProviderSummary,
  overlay: SettingsProviderSummary,
): SettingsProviderSummary {
  const credentialPresent = overlay.credentialPresent || base.credentialPresent;
  return {
    ...base,
    ...overlay,
    models: overlay.models.length > 0 ? overlay.models : base.models,
    defaultModel: overlay.defaultModel || base.defaultModel,
    baseUrl: overlay.baseUrl || base.baseUrl,
    protocol: overlay.protocol || base.protocol,
    opencodeAuth: overlay.opencodeAuth || base.opencodeAuth,
    disableModelFetch: overlay.disableModelFetch ?? base.disableModelFetch,
    hiddenModelIds: overlay.hiddenModelIds.length ? overlay.hiddenModelIds : base.hiddenModelIds,
    credentialPresent,
    source: credentialPresent
      ? "user"
      : (overlay.source === "product-seed" || base.source === "product-seed"
        ? "product-seed"
        : (overlay.source || base.source)),
  };
}

/**
 * Settings provider directory after sync:
 * local registry (catalog∪seed∪keyed user) ∪ product seeds for any not-yet-synced rows.
 * Live opencode catalog is only fetched during syncProviderSeeds — not on every settings open.
 */
export async function listProvidersForSettings(
  engine: AgentExecutionEngine,
  workflowRoot: string,
): Promise<SettingsProviderSummary[]> {
  const [seedFile, registry] = await Promise.all([
    Promise.resolve(readProviderSeedFile(workflowRoot)),
    providerRegistry.listProviders(workflowRoot),
  ]);

  const byId = new Map<string, SettingsProviderSummary>();
  const seedIds = new Set(seedFile.providers.map((entry) => entry.id));

  for (const provider of registry) {
    if (!supportsEngine(provider as ProviderRecord, engine)) continue;
    const source: ProviderListSource = provider.credentialPresent
      ? "user"
      : (seedIds.has(provider.id) || provider.presetKind === "product-seed"
        ? "product-seed"
        : "opencode");
    byId.set(provider.id, fromRegistry(provider, source));
  }

  for (const entry of seedFile.providers) {
    const mapped = fromSeed(entry);
    if (!supportsEngine(mapped, engine)) continue;
    const existing = byId.get(mapped.id);
    byId.set(mapped.id, existing ? mergeProvider(existing, mapped) : mapped);
  }

  return [...byId.values()].sort((a, b) => (
    a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)
  ));
}
