export type AgentExecutionEngine = "opencode";

export type StreamFormat = "opencode-sse" | undefined;

export interface RuntimeCommand {
  command: string;
  args: string[];
  stdin?: string;
  display: string;
  streamFormat?: StreamFormat;
}

export interface ProfileLike {
  runtime?: string | null;
  provider?: string;
  protocol?: string;
  model?: string;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  modelEnv?: string | null;
  baseUrlEnv?: string | null;
  tools?: string[];
  mapsToRuntimeEnv?: Record<string, string>;
  dynamic?: boolean;
  sourceProviderId?: string;
  sourceModelId?: string;
  thinkingVariant?: string;
  [key: string]: unknown;
}

export interface RuntimeCommandBuildContext {
  userPrompt: string;
  project?: string;
  files: string[];
  thinkingLevel?: string | null;
  /** opencode persisted session id for native conversation continuity. */
  opencodeSessionId?: string | null;
  executableOverride?: string | null;
  /** Active engine binding model id; fallback when profile lacks sourceModelId. */
  bindingModelId?: string | null;
  /** Desktop session id. Legacy ask MCP wiring is disabled. */
  sessionId?: string | null;
  /** Deprecated: legacy ask MCP gateway is disabled; kept for older callers. */
  askMcpGatewayPort?: number | null;
  /** Workflow root path — enables vendor source detection. */
  workflowRoot?: string | null;
  /** Restrict the runtime to non-mutating builtin tools; used by isolated evaluation sessions. */
  readOnlyTools?: boolean;
}

export interface RuntimeEnvResult {
  env: Record<string, string>;
  keys: string[];
  envFile?: string | null;
}

export interface RuntimeAdapter {
  id: AgentExecutionEngine;
  /** Profile `runtime` field this adapter handles. */
  profileRuntime: string;
  streamFormat: StreamFormat;
  buildCommand(profile: ProfileLike, context: RuntimeCommandBuildContext): RuntimeCommand | null;
  buildEnv(profile: ProfileLike, workflowRoot: string): Promise<RuntimeEnvResult>;
}

export interface EngineProviderBindingLike {
  providerId: string;
  modelId: string;
}

export interface AgentExecutionSettingsLike {
  [key: string]: unknown;
  engine?: AgentExecutionEngine;
  bindings?: Partial<Record<AgentExecutionEngine, EngineProviderBindingLike>>;
  lastSyncedAt?: string;
}
