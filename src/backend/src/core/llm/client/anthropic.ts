/**
 * Anthropic Messages API client (test + future chat).
 * opencode-backed agents use materializeOpencodeEnv + opencode serve, not chat() here.
 */

const ANTHROPIC_VERSION = "2023-06-01";
const ERROR_BODY_MAX_CHARS = 512;

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

function trimTrailingSlash(url: string): string {
  return String(url || "").replace(/\/+$/, "");
}

function truncateBody(body: string): string {
  if (body.length <= ERROR_BODY_MAX_CHARS) return body;
  return `${body.slice(0, ERROR_BODY_MAX_CHARS)}…`;
}

/** Resolve POST URL for Anthropic Messages API from provider baseUrl. */
export function buildAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlash(baseUrl);
  if (!trimmed) return "";
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
}

function formatHttpError(status: number, bodyText: string): string {
  const snippet = truncateBody(bodyText.trim());
  if (status === 401) {
    return "API key is invalid or expired. Check credential settings.";
  }
  if (status === 403) {
    return "API access is forbidden (403). Check key permissions or account status.";
  }
  if (status === 404) {
    return `Endpoint was not found (404). Check whether baseUrl is correct${snippet ? `: ${snippet}` : ""}`;
  }
  return `HTTP ${status}${snippet ? `: ${snippet}` : ""}`;
}

function formatNetworkError(error: Error): string {
  if (error.name === "AbortError") {
    return "Connection timed out. Check network access or whether baseUrl is reachable.";
  }
  return `Could not connect to server: ${error.message}`;
}

/** 200 = success; 400 = reachable + key accepted but request rejected (still OK for connectivity test). */
function isConnectivityOkStatus(status: number): boolean {
  return status === 200 || status === 400;
}

function extractSample(payload: unknown): string {
  try {
    const p = payload as Record<string, unknown>;
    const content = p?.content;
    if (!Array.isArray(content)) return "";
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          return b.text.slice(0, 64);
        }
      }
    }
    return "";
  } catch {
    return "";
  }
}

async function chat(): Promise<never> {
  throw new Error("anthropic protocol client not yet implemented");
}

async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
  const { baseUrl, apiKey, model, timeoutMs } = params || {} as TestConnectionParams;
  if (!baseUrl) return { ok: false, error: "provider baseUrl is not configured" };
  if (!apiKey) return { ok: false, error: "No usable credential is configured (credentialValue is missing)" };
  if (!model) return { ok: false, error: "model id is not configured" };

  const url = buildAnthropicMessagesUrl(baseUrl);
  if (!url.includes("://")) {
    return { ok: false, error: "baseUrl format is invalid" };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);

  const requestBody = JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        authorization: `Bearer ${apiKey}`,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: requestBody,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }

    if (isConnectivityOkStatus(response.status)) {
      const p = payload as Record<string, unknown>;
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        model: typeof p?.model === "string" ? p.model : model,
        sample: extractSample(payload),
        status: response.status,
      };
    }

    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: formatHttpError(response.status, text),
      status: response.status,
    };
  } catch (error) {
    const err = error as Error;
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: formatNetworkError(err),
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type { TestConnectionParams, TestConnectionResult };
export { chat, testConnection };
