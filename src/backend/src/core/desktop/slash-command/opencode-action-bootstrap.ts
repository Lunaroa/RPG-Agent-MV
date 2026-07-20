import type { ProductLanguage } from "../../../../../contract/types.ts";
import { materializeOpencodeEnv } from "../../llm/opencode/materialize-env.ts";
import { loadDocument, type ProviderRecord } from "../../llm/provider-registry.ts";
import { readMemorySettings } from "../../memory/memory-settings.ts";
import { buildOpencodeRuntimeConfig } from "../../workflow/agent/opencode/config.ts";

export interface OpencodeActionBootstrap {
  env: Record<string, string>;
  config: Record<string, unknown>;
}

export interface OpencodeActionBootstrapSession {
  providerId: string;
  modelId: string;
  productLanguage: ProductLanguage;
  project?: string;
  opencodeRunContext?: {
    env?: Record<string, string>;
    config?: Record<string, unknown>;
  } | null;
}

export interface OpencodeActionBootstrapDeps {
  loadProviderDocument?: typeof loadDocument;
  buildRuntimeConfig?: typeof buildOpencodeRuntimeConfig;
  materializeEnv?: typeof materializeOpencodeEnv;
  readMemory?: typeof readMemorySettings;
}

/**
 * Prefer the live run context when present. After a turn ends (or on restore from disk)
 * that context is cleared — rebuild env/config from the session's bound provider/model
 * so slash/context-usage can still talk to opencode without guessing credentials.
 */
export async function resolveOpencodeActionBootstrap(
  workflowRoot: string,
  session: OpencodeActionBootstrapSession,
  deps: OpencodeActionBootstrapDeps = {},
): Promise<OpencodeActionBootstrap> {
  const liveEnv = session.opencodeRunContext?.env;
  const liveConfig = session.opencodeRunContext?.config;
  if (liveEnv && liveConfig && Object.keys(liveConfig).length > 0) {
    return { env: liveEnv, config: liveConfig };
  }

  const providerId = session.providerId.trim();
  const modelId = session.modelId.trim();
  if (!providerId || !modelId) {
    throw new Error("opencode provider or model is missing");
  }

  const loadProviderDocument = deps.loadProviderDocument ?? loadDocument;
  const buildRuntimeConfig = deps.buildRuntimeConfig ?? buildOpencodeRuntimeConfig;
  const materializeEnv = deps.materializeEnv ?? materializeOpencodeEnv;
  const readMemory = deps.readMemory ?? readMemorySettings;

  const document = await loadProviderDocument(workflowRoot);
  const provider = (document.providers[providerId] || null) as ProviderRecord | null;
  if (!provider) {
    throw new Error(`opencode provider not found: ${providerId}`);
  }

  const envResult = materializeEnv(provider, { modelId });
  if (envResult.blocker) {
    throw new Error(envResult.blocker);
  }

  const config = buildRuntimeConfig({
    workflowRoot,
    providerId,
    modelId,
    provider,
    productLanguage: session.productLanguage,
    memoryEnabled: readMemory().enabled,
    readOnlyTools: true,
    projectState: session.project?.trim() ? "bound" : "none",
    projectDirectory: session.project?.trim() || null,
  });

  return {
    env: {
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      ...envResult.env,
    },
    config,
  };
}
