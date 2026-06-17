/**
 * Model-list URL resolution for OpenAI-compatible and Anthropic-compatible providers.
 */
import type { ProviderRecord } from "./provider-registry.ts";
import * as openaiCompatibleClient from "./client/openai-compatible.ts";
import * as anthropicClient from "./client/anthropic.ts";

const ERROR_BODY_MAX_CHARS = 512;

/** Length-descending so longest compatibility suffix wins. */
const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
] as const;

type ProtocolClient = typeof openaiCompatibleClient | typeof anthropicClient;

interface ListModelsParams {
  baseUrl: string;
  apiKey: string;
  modelsUrl?: string;
  timeoutMs?: number;
}

interface ListModelsResult {
  ok: boolean;
  models?: Array<{ id: string; label: string; metadata?: Record<string, unknown> }>;
  error?: string;
  status?: number | null;
}

function trimTrailingSlash(url: string): string {
  return String(url || "").replace(/\/+$/, "");
}

/** 去掉首尾空白与重复的 Bearer 前缀，避免鉴权头变成 Bearer Bearer xxx。 */
export function normalizeApiKey(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^Bearer\s+/i, "");
}

/** baseURL 是否以 OpenAI 风格版本段 `/v{N}` 结尾（如 `/v1`、智谱 `.../paas/v4`）。 */
function endsWithVersionSegment(url: string): boolean {
  const last = url.split("/").pop() || "";
  if (!last.startsWith("v")) return false;
  const digits = last.slice(1);
  return digits.length > 0 && /^[0-9]+$/.test(digits);
}

function stripCompatSuffix(baseUrl: string): string | null {
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (baseUrl.endsWith(suffix)) {
      return baseUrl.slice(0, baseUrl.length - suffix.length);
    }
  }
  return null;
}

export function hasKnownCompatSuffix(baseUrl: string): boolean {
  const trimmed = trimTrailingSlash(baseUrl);
  return KNOWN_COMPAT_SUFFIXES.some((suffix) => trimmed.endsWith(suffix));
}

/**
 * Build ordered candidate URLs for GET model list.
 */
export function buildModelsUrlCandidates(
  baseUrl: string,
  modelsUrlOverride?: string | null,
): string[] {
  if (modelsUrlOverride != null) {
    const trimmed = String(modelsUrlOverride).trim();
    if (trimmed) return [trimmed];
  }

  const trimmed = trimTrailingSlash(baseUrl);
  if (!trimmed) return [];

  const candidates: string[] = [];

  // 与 cc-switch model_fetch.rs 对齐：版本号已在路径里时拼 /models，非 /v1 时再兜底 /v1/models。
  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`);
    if (!trimmed.endsWith("/v1")) {
      candidates.push(`${trimmed}/v1/models`);
    }
  } else if (trimmed.endsWith("/v1")) {
    candidates.push(`${trimmed}/models`);
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }

  const stripped = stripCompatSuffix(trimmed);
  if (stripped) {
    const root = trimTrailingSlash(stripped);
    if (root && root.includes("://")) {
      candidates.push(`${root}/v1/models`);
      candidates.push(`${root}/models`);
    }
  }

  const unique: string[] = [];
  for (const url of candidates) {
    if (!unique.includes(url)) unique.push(url);
  }
  return unique;
}

/** First candidate URL used for model list GET (display / logging). */
export function resolveListModelsBaseUrl(
  provider: Pick<ProviderRecord, "baseUrl" | "modelsUrl">,
  overrides?: { baseUrl?: string } | null,
): string {
  const baseUrl = overrides?.baseUrl || provider.baseUrl || "";
  const candidates = buildModelsUrlCandidates(baseUrl, provider.modelsUrl as string | undefined);
  return candidates[0] || "";
}

function truncateBody(body: string): string {
  if (body.length <= ERROR_BODY_MAX_CHARS) return body;
  return `${body.slice(0, ERROR_BODY_MAX_CHARS)}…`;
}

/** Anthropic runtime has no listModels; list via OpenAI-compatible endpoints when providers expose them. */
export function resolveListModelsClient(provider: ProviderRecord): ProtocolClient {
  const protocol = provider.protocol || "openai-compatible";
  if (protocol === "anthropic") {
    return openaiCompatibleClient;
  }
  if (protocol === "openai-compatible") {
    return openaiCompatibleClient;
  }
  return anthropicClient;
}

export interface ResolveTestClientOptions {
  baseUrl?: string;
  providerId?: string;
  model?: string;
}

export function resolveTestClient(
  provider: ProviderRecord,
  options?: ResolveTestClientOptions | null,
): ProtocolClient {
  void options;
  const protocol = provider.protocol || "openai-compatible";
  if (protocol === "anthropic") {
    return anthropicClient;
  }
  return openaiCompatibleClient;
}

async function fetchModelsAtUrl(
  url: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<{ ok: true; models: ListModelsResult["models"] } | { ok: false; status: number; error: string; retry: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.ok) {
      let payload: unknown = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = {};
      }
      const p = payload as Record<string, unknown>;
      const raw: unknown[] = Array.isArray(p?.data)
        ? (p.data as unknown[])
        : Array.isArray(p?.models)
          ? (p.models as unknown[])
          : Array.isArray(payload)
            ? (payload as unknown[])
            : [];
      const models: NonNullable<ListModelsResult["models"]> = [];
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
            label: String(obj.display_name || obj.name || id),
            metadata: obj,
          });
        }
      }
      return { ok: true, models };
    }

    const errText = truncateBody(text || `${response.status} ${response.statusText}`);
    const retry = response.status === 404 || response.status === 405;
    return { ok: false, status: response.status, error: `HTTP ${response.status}: ${errText}`, retry };
  } catch (error) {
    const err = error as Error;
    return { ok: false, status: 0, error: err.message, retry: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch model list trying provider candidate URLs in order.
 */
export async function listModelsWithCandidates(params: ListModelsParams): Promise<ListModelsResult> {
  const { baseUrl, apiKey, modelsUrl, timeoutMs } = params;
  const normalizedKey = normalizeApiKey(apiKey);
  if (!baseUrl) return { ok: false, error: "provider 未配置 baseUrl" };
  if (!normalizedKey) return { ok: false, error: "没有可用的凭证 (credentialValue 未配置)" };

  const candidates = buildModelsUrlCandidates(baseUrl, modelsUrl);
  if (candidates.length === 0) {
    return { ok: false, error: "Base URL is empty" };
  }

  let lastErr: string | null = null;
  let lastStatus: number | null = null;

  for (const url of candidates) {
    const result = await fetchModelsAtUrl(url, normalizedKey, timeoutMs);
    if (result.ok) {
      return { ok: true, models: result.models };
    }
    lastErr = result.error;
    lastStatus = result.status || null;
    if (!result.retry) {
      return { ok: false, error: result.error, status: lastStatus };
    }
  }

  return {
    ok: false,
    error: `All candidates failed: ${lastErr || "no candidates"}`,
    status: lastStatus,
  };
}

export type { ListModelsParams, ListModelsResult };
