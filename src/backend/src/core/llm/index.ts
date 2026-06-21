import * as providerRegistry from "./provider-registry.ts";
import * as openaiCompatibleClient from "./client/openai-compatible.ts";
import * as anthropicClient from "./client/anthropic.ts";
import { extractThinkingVariantsFromModel, type ThinkingVariant } from "./client/openai-compatible.ts";
import {
  resolveListModelsClient,
  resolveTestClient,
  resolveListModelsBaseUrl,
  listModelsWithCandidates,
  buildModelsUrlCandidates,
  normalizeApiKey,
} from "./list-models-resolve.ts";

interface TestOverrides {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface TestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  model?: string;
  sample?: string;
  status?: number | null;
}

interface ListModelsOverrides {
  baseUrl?: string;
  apiKey?: string;
}

interface ListModelsResult {
  ok: boolean;
  models?: Array<{ id: string; label: string; metadata?: Record<string, unknown>; thinkingVariants?: ThinkingVariant[] }>;
  error?: string;
  status?: number | null;
}

type ProtocolClient = typeof openaiCompatibleClient | typeof anthropicClient;

function getClient(protocol: string): ProtocolClient {
  switch (protocol) {
    case "openai-compatible":
      return openaiCompatibleClient;
    case "anthropic":
      return anthropicClient;
    default:
      throw new Error(`unknown protocol: ${protocol}`);
  }
}

async function testProvider(workflowRoot: string, providerId: string, overrides?: TestOverrides | null): Promise<TestResult> {
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const provider = doc.providers[providerId];
  if (!provider) throw new Error(`provider not found: ${providerId}`);

  const opts = overrides || {} as TestOverrides;
  const baseUrl = opts.baseUrl || provider.baseUrl;
  const apiKey = normalizeApiKey(opts.apiKey || provider.credentialValue || "");
  const firstModel = provider.models && provider.models[0];
  const rawModel = opts.model
    || (firstModel && (typeof firstModel === "string" ? firstModel : firstModel.id))
    || null;
  const model = rawModel ? String(rawModel).trim() : null;

  if (!apiKey) {
    return { ok: false, error: "No usable credential is configured (credentialValue is missing)" };
  }
  if (!model) {
    return { ok: false, error: "provider has no model id configured" };
  }
  if (!baseUrl) {
    return { ok: false, error: "provider baseUrl is not configured" };
  }

  const client = resolveTestClient(provider, { baseUrl, providerId, model });
  return client.testConnection({ baseUrl, apiKey, model });
}

async function listModelsForProvider(workflowRoot: string, providerId: string, overrides?: ListModelsOverrides | null): Promise<ListModelsResult> {
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const provider = doc.providers[providerId];
  if (!provider) throw new Error(`provider not found: ${providerId}`);
  const opts = overrides || {} as ListModelsOverrides;
  const baseUrl = opts.baseUrl || provider.baseUrl;
  const apiKey = normalizeApiKey(opts.apiKey || provider.credentialValue || "");
  if (!apiKey) return { ok: false, error: "No usable credential is configured (credentialValue is missing)" };
  if (!baseUrl) return { ok: false, error: "provider baseUrl is not configured" };

  const client = resolveListModelsClient(provider);
  const clientWithListModels = client as unknown as { listModels?: (opts: { baseUrl: string; apiKey: string }) => Promise<ListModelsResult> };
  const modelsUrl = typeof provider.modelsUrl === "string" ? provider.modelsUrl : undefined;

  try {
    let result: ListModelsResult;
    if (client === openaiCompatibleClient) {
      result = await listModelsWithCandidates({ baseUrl, apiKey, modelsUrl });
    } else if (typeof clientWithListModels.listModels === "function") {
      const listBaseUrl = resolveListModelsBaseUrl(provider, opts);
      result = await clientWithListModels.listModels({ baseUrl: listBaseUrl, apiKey });
    } else {
      return { ok: false, error: `${provider.protocol || "openai-compatible"} protocol has not implemented listModels` };
    }

    if (!result.ok) {
      return result;
    }

    if (!result.models?.length) {
      return { ok: false, error: result.error || "Remote endpoint did not return any models", status: result.status ?? null };
    }

    return {
      ...result,
      models: result.models.map((model) => ({
        ...model,
        label: model.label || model.id,
        thinkingVariants: extractThinkingVariantsFromModel(
          model.id,
          model.metadata ?? null,
          providerId,
        ),
      })),
    };
  } catch (error) {
    const err = error as Error & { status?: number };
    return { ok: false, error: err.message, status: err.status || null };
  }
}

export type { TestOverrides, TestResult, ListModelsOverrides, ListModelsResult };
export {
  providerRegistry,
  getClient,
  resolveListModelsClient,
  resolveTestClient,
  resolveListModelsBaseUrl,
  buildModelsUrlCandidates,
  listModelsWithCandidates,
  testProvider,
  listModelsForProvider,
};
export { listThinkingVariants } from "./thinking-variants.ts";
export type { ThinkingVariantsResult } from "./thinking-variants.ts";
export {
  readCcSwitchOpencodeProviderCandidates,
  writeOpencodeProviderSeedFile,
} from "./cc-switch-provider-sync.ts";
export type {
  CcSwitchOpencodeCandidate,
  CcSwitchOpencodePreset,
  ReadCcSwitchOpencodeResult,
  WriteOpencodeProviderSeedResult,
} from "./cc-switch-provider-sync.ts";
export {
  ensureProviderSeedsInitialized,
  readProviderSeedFile,
  refreshProviderSeedCatalogFields,
  syncProviderSeeds,
  writeProviderSeedFile,
} from "./provider-seeds.ts";
export type {
  EnsureProviderSeedsResult,
  ProviderSeedEntry,
  ProviderSeedFile,
  SyncProviderSeedsResult,
  WriteProviderSeedFileResult,
} from "./provider-seeds.ts";
