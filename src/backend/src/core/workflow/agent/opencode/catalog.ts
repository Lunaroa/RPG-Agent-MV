import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";

import { ensureOpencodeServer } from "./runtime.ts";

export type OpencodeCatalogProviderSource = "opencode";

export interface OpencodeCatalogModel {
  id: string;
  label: string;
  limit?: { context?: number; output?: number };
}

export interface OpencodeCatalogProvider {
  id: string;
  label: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string;
  models: OpencodeCatalogModel[];
  envVar?: string;
  source: OpencodeCatalogProviderSource;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function inferProtocol(provider: Record<string, unknown>): "openai-compatible" | "anthropic" {
  const npm = asString(provider.npm).toLowerCase();
  if (npm.includes("anthropic")) return "anthropic";
  const env = Array.isArray(provider.env) ? provider.env.map(asString) : [];
  if (env.some((key) => key.includes("ANTHROPIC"))) return "anthropic";
  return "openai-compatible";
}

function inferEnvVar(provider: Record<string, unknown>, protocol: "openai-compatible" | "anthropic"): string | undefined {
  const env = Array.isArray(provider.env) ? provider.env.map(asString).filter(Boolean) : [];
  if (env[0]) return env[0];
  return protocol === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

/**
 * Resolve API base URL from a provider.list item.
 *
 * Real opencode Provider.Info has no top-level `api`; models.dev `provider.api`
 * is normalized onto `models[*].api.url`. User overrides live in options.baseURL.
 */
function inferBaseUrl(provider: Record<string, unknown>): string {
  const options = asRecord(provider.options);
  const fromOptions = asString(options.baseURL);
  if (fromOptions) return fromOptions;

  // Legacy / models.dev-shaped payloads may still carry top-level api.
  const fromTopLevel = asString(provider.api);
  if (fromTopLevel) return fromTopLevel;

  const models = asRecord(provider.models);
  for (const value of Object.values(models)) {
    const model = asRecord(value);
    const api = asRecord(model.api);
    const url = asString(api.url);
    if (url) return url;
  }
  return "";
}

function mapModels(rawModels: unknown): OpencodeCatalogModel[] {
  const modelsRecord = asRecord(rawModels);
  const out: OpencodeCatalogModel[] = [];
  for (const [id, value] of Object.entries(modelsRecord)) {
    const modelId = asString(id);
    if (!modelId) continue;
    const model = asRecord(value);
    const limitRecord = asRecord(model.limit);
    const context = positiveInteger(limitRecord.context);
    const output = positiveInteger(limitRecord.output);
    out.push({
      id: modelId,
      label: asString(model.name) || modelId,
      ...(context || output
        ? {
          limit: {
            ...(context ? { context } : {}),
            ...(output ? { output } : {}),
          },
        }
        : {}),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function mapOpencodeProviderList(data: unknown): OpencodeCatalogProvider[] {
  const root = asRecord(data);
  const all = Array.isArray(root.all) ? root.all : [];
  const out: OpencodeCatalogProvider[] = [];
  for (const item of all) {
    const provider = asRecord(item);
    const id = asString(provider.id);
    if (!id) continue;
    const protocol = inferProtocol(provider);
    out.push({
      id,
      label: asString(provider.name) || id,
      protocol,
      baseUrl: inferBaseUrl(provider),
      models: mapModels(provider.models),
      envVar: inferEnvVar(provider, protocol),
      source: "opencode",
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * List builtin opencode/models.dev providers via serve + provider.list.
 * Fail-fast when the runtime cannot start or provider.list fails — no seed fallback.
 */
export async function listOpencodeCatalogProviders(workflowRoot: string): Promise<OpencodeCatalogProvider[]> {
  const cwd = path.resolve(workflowRoot);
  const bootstrap = {
    workflowRoot: path.resolve(workflowRoot),
    cwd,
    prompt: "",
    sessionId: "",
    providerId: "catalog",
    modelId: "catalog",
    env: {
      OPENCODE_DISABLE_AUTOUPDATE: "true",
    },
    // Empty config: catalog comes from models.dev embedded in the runtime, not host seeds.
    config: {},
    timeoutMs: 30_000,
  };

  const server = await ensureOpencodeServer(bootstrap, { reuse: true });
  const client = createOpencodeClient({ baseUrl: server.url, directory: cwd });
  const result = await client.provider.list({
    query: { directory: cwd },
  });
  if (result.error) {
    const message = result.error instanceof Error
      ? result.error.message
      : JSON.stringify(result.error);
    throw new Error(`opencode provider catalog unavailable: ${message}`);
  }
  return mapOpencodeProviderList(result.data);
}
