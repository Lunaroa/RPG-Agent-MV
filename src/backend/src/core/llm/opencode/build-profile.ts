import type { ProviderRecord } from "../provider-registry.ts";

export const DEFAULT_OPENCODE_TOOLS = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "glob",
  "todowrite",
  "todoread",
  "task",
  "question",
];

export interface EphemeralOpencodeProfile {
  runtime: "opencode";
  provider: string;
  protocol: "anthropic" | "openai-compatible";
  model: string;
  baseUrl: string;
  tools: string[];
  sourceProviderId: string;
  sourceModelId: string;
  mapsToRuntimeEnv: Record<string, string>;
  ephemeral: true;
}

export function buildEphemeralOpencodeProfile(
  provider: ProviderRecord,
  providerId: string,
  modelId: string,
): EphemeralOpencodeProfile {
  const model = String(modelId || "").trim();
  return {
    runtime: "opencode",
    provider: providerId,
    protocol: provider.protocol === "openai-compatible" ? "openai-compatible" : "anthropic",
    model,
    baseUrl: provider.baseUrl || "",
    tools: [...DEFAULT_OPENCODE_TOOLS],
    sourceProviderId: providerId,
    sourceModelId: modelId,
    mapsToRuntimeEnv: {},
    ephemeral: true,
  };
}
