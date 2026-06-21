import type { ProviderRecord } from "../provider-registry.ts";

export interface OpencodeEnvResult {
  env: Record<string, string>;
  envKeys: string[];
  blocker: string | null;
}

function setEnv(env: Record<string, string>, envKeys: string[], key: string, value: string): void {
  env[key] = value;
  envKeys.push(key);
}

export function materializeOpencodeEnv(
  provider: ProviderRecord | null | undefined,
  options: { modelId?: string | null } = {},
): OpencodeEnvResult {
  const env: Record<string, string> = {};
  const envKeys: string[] = [];

  if (!provider) {
    return {
      env,
      envKeys,
      blocker: "Selected opencode provider was not found. Check Settings > Providers.",
    };
  }

  const label = provider.label || "(unnamed provider)";
  const baseUrl = String(provider.baseUrl || "").trim();
  const credential = String(provider.credentialValue || "").trim();

  if (!credential) {
    return {
      env,
      envKeys,
      blocker: `Provider "${label}" is missing an API Key. Fill it in Settings > Providers before running.`,
    };
  }
  if (!baseUrl) {
    return {
      env,
      envKeys,
      blocker: `Provider "${label}" is missing a Base URL.`,
    };
  }

  setEnv(env, envKeys, "OPENCODE_DISABLE_AUTOUPDATE", "true");
  setEnv(env, envKeys, "OPENCODE_PROVIDER_MANAGED_BY_HOST", "1");

  if (provider.protocol === "openai-compatible") {
    setEnv(env, envKeys, "OPENAI_BASE_URL", baseUrl);
    setEnv(env, envKeys, "OPENAI_API_KEY", credential);
    const customEnv = String(provider.opencodeAuth?.envVar || "").trim();
    if (customEnv && customEnv !== "OPENAI_API_KEY") {
      setEnv(env, envKeys, customEnv, credential);
    }
    const modelId = String(options.modelId || "").trim();
    if (modelId) setEnv(env, envKeys, "OPENAI_MODEL", modelId);
    return { env, envKeys, blocker: null };
  }

  setEnv(env, envKeys, "ANTHROPIC_BASE_URL", baseUrl);
  const tokenEnv = String(provider.opencodeAuth?.envVar || "").trim() || "ANTHROPIC_API_KEY";
  setEnv(env, envKeys, tokenEnv, credential);
  return { env, envKeys, blocker: null };
}
