import * as providerRegistry from "./provider-registry.ts";
import {
  extractThinkingVariantsFromModel,
  type ThinkingVariant
} from "./client/openai-compatible.ts";
import { resolveRegistryThinkingVariants, normalizeThinkingLevel, resolveThinkingVariantsForModel } from "./model-reasoning-registry.ts";
import { resolveListModelsClient, listModelsWithCandidates, normalizeApiKey } from "./list-models-resolve.ts";
import * as openaiCompatibleClient from "./client/openai-compatible.ts";

interface ThinkingVariantsResult {
  ok: boolean;
  variants: ThinkingVariant[];
  error?: string;
}

interface ListModelsResult {
  ok: boolean;
  models?: Array<{ id: string; label: string; metadata?: Record<string, unknown> }>;
  error?: string;
}

const DEFAULT_VARIANTS: ThinkingVariant[] = [{ id: "default", label: "默认" }];

async function fetchProviderModels(workflowRoot: string, providerId: string): Promise<ListModelsResult> {
  const doc = await providerRegistry.loadDocument(workflowRoot);
  const provider = doc.providers[providerId];
  if (!provider) throw new Error(`provider not found: ${providerId}`);
  const baseUrl = provider.baseUrl;
  const apiKey = normalizeApiKey(provider.credentialValue || "");
  if (!apiKey) return { ok: false, error: "没有可用的凭证 (credentialValue 未配置)" };
  if (!baseUrl) return { ok: false, error: "provider 未配置 baseUrl" };

  const client = resolveListModelsClient(provider);
  const modelsUrl = typeof provider.modelsUrl === "string" ? provider.modelsUrl : undefined;

  if (client === openaiCompatibleClient) {
    return listModelsWithCandidates({ baseUrl, apiKey, modelsUrl });
  }

  const clientWithListModels = client as unknown as {
    listModels?: (opts: { baseUrl: string; apiKey: string }) => Promise<ListModelsResult>;
  };
  if (typeof clientWithListModels.listModels !== "function") {
    return { ok: false, error: `${provider.protocol || "openai-compatible"} 协议尚未实现 listModels` };
  }
  try {
    return await clientWithListModels.listModels({ baseUrl, apiKey });
  } catch (error) {
    const err = error as Error;
    return { ok: false, error: err.message };
  }
}

function resolveVariants(providerId: string, modelId: string, metadata?: Record<string, unknown> | null): ThinkingVariant[] {
  return extractThinkingVariantsFromModel(modelId, metadata, providerId);
}

async function listThinkingVariants(
  workflowRoot: string,
  providerId: string,
  modelId: string
): Promise<ThinkingVariantsResult> {
  if (!providerId || !modelId) {
    return { ok: false, variants: [...DEFAULT_VARIANTS], error: "providerId 与 modelId 不能为空" };
  }

  try {
    const listResult = await fetchProviderModels(workflowRoot, providerId);
    if (!listResult.ok) {
      return { ok: false, variants: [...DEFAULT_VARIANTS], error: listResult.error };
    }

    const models = listResult.models || [];
    const match = models.find((item) => item.id === modelId)
      || models.find((item) => item.id.toLowerCase() === modelId.toLowerCase());
    const variants = resolveVariants(providerId, modelId, match?.metadata ?? null);
    return { ok: true, variants };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, variants: [...DEFAULT_VARIANTS], error: message };
  }
}

export type { ThinkingVariantsResult };
export {
  listThinkingVariants,
  extractThinkingVariantsFromModel,
  normalizeThinkingLevel,
  resolveRegistryThinkingVariants,
  resolveThinkingVariantsForModel,
};
