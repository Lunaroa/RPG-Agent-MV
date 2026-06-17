import {
  DEFAULT_ONLY_VARIANTS,
  resolveRegistryThinkingRule,
  type ThinkingVariant,
} from "../model-reasoning-registry.ts";

interface ChatParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface TestConnectionParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface TestConnectionResult {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  sample?: string;
  error?: string;
  status?: number | null;
}

interface ModelItem {
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
}

const VARIANT_LABELS: Record<string, string> = {
  default: "默认",
  minimal: "低",
  low: "低",
  medium: "中",
  high: "高",
  max: "超高"
};

const DEFAULT_THINKING_VARIANTS: ThinkingVariant[] = [...DEFAULT_ONLY_VARIANTS];

interface ListModelsParams {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

interface ListModelsResult {
  ok: boolean;
  models?: ModelItem[];
  error?: string;
}

interface OpenAIErrorResponse {
  error?: { message?: string } | string;
}

async function chat(params: ChatParams): Promise<unknown> {
  const { baseUrl, apiKey, model, messages, temperature, maxTokens, signal } = params || {} as ChatParams;
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!apiKey) throw new Error("apiKey is required");
  if (!model) throw new Error("model is required");
  const url = trimTrailingSlash(baseUrl) + "/chat/completions";
  const requestBody: Record<string, unknown> = {
    model,
    messages: messages || [{ role: "user", content: "ping" }],
    max_tokens: maxTokens !== undefined ? maxTokens : 16
  };
  if (temperature !== undefined) requestBody.temperature = temperature;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal
  });
  const payload: unknown = await response.json().catch((e) => { console.warn('[openai-compatible] Failed to parse response body as JSON:', e); return {}; });
  if (!response.ok) {
    const errPayload = payload as OpenAIErrorResponse;
    const message = (errPayload && errPayload.error && (typeof errPayload.error === "object" ? errPayload.error.message : errPayload.error))
      || `${response.status} ${response.statusText}`;
    const err = new Error(typeof message === "string" ? message : JSON.stringify(message)) as Error & { status?: number; payload?: unknown };
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (params && params.timeoutMs) || 15000);
  try {
    const result = await chat({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 4,
      signal: controller.signal
    }) as Record<string, unknown>;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      model: (result && result.model as string) || params.model,
      sample: extractText(result)
    };
  } catch (error) {
    const err = error as Error & { status?: number };
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err.message,
      status: err.status || null
    };
  } finally {
    clearTimeout(timer);
  }
}

function trimTrailingSlash(url: string): string {
  return String(url || "").replace(/\/+$/, "");
}

function extractText(result: unknown): string {
  try {
    const r = result as Record<string, unknown>;
    const choices = r?.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    return (typeof message?.content === "string" ? message.content : "").slice(0, 64);
  } catch (e) {
    console.warn('[openai-compatible] Failed to extract text from result:', e);
    return "";
  }
}

async function listModels(params: ListModelsParams): Promise<ListModelsResult> {
  const { baseUrl, apiKey, timeoutMs } = params || {} as ListModelsParams;
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!apiKey) throw new Error("apiKey is required");
  const url = trimTrailingSlash(baseUrl) + "/models";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    const payload: unknown = await response.json().catch((e) => { console.warn('[openai-compatible] Failed to parse models response body as JSON:', e); return {}; });
    if (!response.ok) {
      const errPayload = payload as OpenAIErrorResponse;
      const message = (errPayload && errPayload.error && (typeof errPayload.error === "object" ? errPayload.error.message : errPayload.error))
        || `${response.status} ${response.statusText}`;
      const err = new Error(typeof message === "string" ? message : JSON.stringify(message)) as Error & { status?: number; payload?: unknown };
      err.status = response.status;
      err.payload = payload;
      throw err;
    }
    const p = payload as Record<string, unknown>;
    const raw: unknown[] = Array.isArray(p?.data) ? p.data as unknown[]
      : Array.isArray(p?.models) ? p.models as unknown[]
      : Array.isArray(payload) ? payload as unknown[]
      : [];
    const models: ModelItem[] = [];
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === "string") {
        models.push({ id: item, label: item });
      } else if (typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const id = obj.id || obj.model || obj.name;
        if (!id) continue;
        models.push({
          id: String(id),
          label: String(obj.display_name || obj.label || obj.name || id),
          metadata: obj
        });
      }
    }
    return { ok: true, models };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVariantId(raw: unknown): string | null {
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  if (!id) return null;
  if (id in VARIANT_LABELS) return id;
  const aliases: Record<string, string> = {
    none: "default",
    off: "default",
    auto: "default",
    xhigh: "max",
    "x-high": "max",
    "extra-high": "max",
    "extra_high": "max"
  };
  return aliases[id] || null;
}

function labelForVariantId(id: string, fallback?: unknown): string {
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return VARIANT_LABELS[id] || id;
}

function dedupeVariants(items: ThinkingVariant[]): ThinkingVariant[] {
  const seen = new Set<string>();
  const out: ThinkingVariant[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function parseVariantsFromValue(value: unknown): ThinkingVariant[] {
  const out: ThinkingVariant[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const id = normalizeVariantId(entry);
        if (id) out.push({ id, label: labelForVariantId(id) });
      } else if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const id = normalizeVariantId(obj.id || obj.value || obj.key || obj.name);
        if (id) out.push({ id, label: labelForVariantId(id, obj.label || obj.display_name || obj.name) });
      }
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const id = normalizeVariantId(key);
      if (!id) continue;
      const label = typeof entry === "string" && entry.trim()
        ? entry.trim()
        : labelForVariantId(id);
      out.push({ id, label });
    }
  }
  return out;
}

function extractVariantsFromMetadata(metadata?: Record<string, unknown> | null): ThinkingVariant[] {
  if (!metadata) return [];
  const candidates: unknown[] = [
    metadata.variants,
    metadata.thinking_variants,
    metadata.reasoning_variants,
    metadata.supported_reasoning_effort,
    metadata.reasoning_effort,
    metadata.reasoning
  ];
  const capabilities = metadata.capabilities;
  if (capabilities && typeof capabilities === "object") {
    const caps = capabilities as Record<string, unknown>;
    candidates.push(caps.reasoning, caps.thinking, caps.variants);
  }
  const thinking = metadata.thinking;
  if (thinking && typeof thinking === "object") {
    const thinkingObj = thinking as Record<string, unknown>;
    candidates.push(thinkingObj.variants, thinkingObj.levels, thinkingObj.type);
  }
  const out: ThinkingVariant[] = [];
  for (const candidate of candidates) {
    out.push(...parseVariantsFromValue(candidate));
  }
  return dedupeVariants(out);
}

function normalizeMetadataVariants(metadata?: Record<string, unknown> | null): ThinkingVariant[] | null {
  const fromMetadata = extractVariantsFromMetadata(metadata);
  if (fromMetadata.length === 0) return null;
  if (!fromMetadata.some((item) => item.id === "default")) {
    return dedupeVariants([{ id: "default", label: "默认" }, ...fromMetadata]);
  }
  return fromMetadata;
}

function extractThinkingVariantsFromModel(
  modelId: string,
  metadata?: Record<string, unknown> | null,
  providerId?: string | null
): ThinkingVariant[] {
  const rule = resolveRegistryThinkingRule(providerId || "", modelId);
  const metadataVariants = normalizeMetadataVariants(metadata);

  if (rule?.explicit === "multi") {
    return [...rule.variants];
  }

  if (rule) {
    return [...rule.variants];
  }

  if (metadataVariants && metadataVariants.length > 1) {
    return metadataVariants;
  }

  return [...DEFAULT_THINKING_VARIANTS];
}

export type {
  ChatParams,
  TestConnectionParams,
  TestConnectionResult,
  ModelItem,
  ListModelsParams,
  ListModelsResult,
  ThinkingVariant
};
export { chat, testConnection, listModels, extractThinkingVariantsFromModel };
