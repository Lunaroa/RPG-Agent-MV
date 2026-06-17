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
      blocker: "未找到所选的 opencode 供应商，请在 设置 → 供应商 中检查配置。",
    };
  }

  const label = provider.label || "(未命名供应商)";
  const baseUrl = String(provider.baseUrl || "").trim();
  const credential = String(provider.credentialValue || "").trim();

  if (!credential) {
    return {
      env,
      envKeys,
      blocker: `供应商「${label}」缺少 API Key，请在 设置 → 供应商 中填写后再运行。`,
    };
  }
  if (!baseUrl) {
    return {
      env,
      envKeys,
      blocker: `供应商「${label}」缺少接口地址（Base URL）。`,
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
