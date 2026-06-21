import fs from "node:fs";

import { DEFAULT_AGENT_EXECUTION_ENGINE } from "../../../../../../contract/types.ts";
import { resolveOpencodeCli } from "../../../workspace-paths.ts";
import { materializeOpencodeEnv } from "../../../llm/opencode/materialize-env.ts";
import type {
  AgentExecutionEngine,
  AgentExecutionSettingsLike,
  ProfileLike,
  RuntimeAdapter,
  RuntimeCommand,
  RuntimeCommandBuildContext,
} from "./types.ts";

export type {
  AgentExecutionEngine,
  AgentExecutionSettingsLike,
  EngineProviderBindingLike,
  ProfileLike,
  RuntimeAdapter,
  RuntimeCommand,
  RuntimeCommandBuildContext,
  StreamFormat,
} from "./types.ts";
export { formatDisplay } from "./format-display.ts";

const OPENCODE_ENGINE: RuntimeAdapter = {
  id: "opencode",
  profileRuntime: "opencode",
  streamFormat: "opencode-sse",
  buildCommand(profile: ProfileLike, context: RuntimeCommandBuildContext): RuntimeCommand | null {
    if (profile.runtime && profile.runtime !== "opencode") return null;
    const workflowRoot = context.workflowRoot || process.cwd();
    return {
      command: resolveOpencodeCli(workflowRoot),
      args: ["serve"],
      stdin: context.userPrompt,
      display: "opencode serve",
      streamFormat: "opencode-sse",
    };
  },
  async buildEnv(profile: ProfileLike): Promise<import("./types.ts").RuntimeEnvResult> {
    void profile;
    return {
      env: {
        OPENCODE_DISABLE_AUTOUPDATE: "true",
      },
      keys: ["OPENCODE_DISABLE_AUTOUPDATE"],
    };
  },
};

const ADAPTERS: RuntimeAdapter[] = [OPENCODE_ENGINE];

export function listAdapters(): RuntimeAdapter[] {
  return [...ADAPTERS];
}

export function getAdapter(engineId: AgentExecutionEngine): RuntimeAdapter | null {
  return ADAPTERS.find((adapter) => adapter.id === engineId) || null;
}

export function getAdapterForProfileRuntime(runtime: string | null | undefined): RuntimeAdapter | null {
  if (!runtime) return null;
  return ADAPTERS.find((adapter) => adapter.profileRuntime === runtime) || null;
}

export function profileRuntimeToEngine(runtime: string | null | undefined): AgentExecutionEngine | null {
  const adapter = getAdapterForProfileRuntime(runtime || undefined);
  return adapter ? adapter.id : null;
}

export function defaultEngine(): AgentExecutionEngine {
  return DEFAULT_AGENT_EXECUTION_ENGINE;
}

export function resolveExecutableOverride(
  engine: AgentExecutionEngine,
  settings?: AgentExecutionSettingsLike | null,
): string | null {
  void engine;
  void settings;
  return null;
}

export function buildRuntimeCommandForEngine(
  engine: AgentExecutionEngine,
  profile: ProfileLike,
  context: RuntimeCommandBuildContext,
): RuntimeCommand | null {
  const adapter = getAdapter(engine);
  if (!adapter) return null;
  if (profile.runtime && profile.runtime !== adapter.profileRuntime) return null;
  return adapter.buildCommand(profile, context);
}

export async function buildRuntimeEnvForEngine(
  engine: AgentExecutionEngine,
  profile: ProfileLike,
  workflowRoot: string,
): Promise<import("./types.ts").RuntimeEnvResult> {
  void workflowRoot;
  const adapter = getAdapter(engine);
  if (!adapter) return { env: {}, keys: [] };
  return adapter.buildEnv(profile, workflowRoot);
}

export function streamFormatForEngine(engine: AgentExecutionEngine): string | undefined {
  const adapter = getAdapter(engine);
  return adapter?.streamFormat;
}

export function resolveRuntimeReadinessBlocker(
  engine: AgentExecutionEngine,
  workflowRoot?: string | null,
): string | null {
  if (engine !== "opencode") return `Unknown execution engine: ${engine}`;
  if (!workflowRoot) return null;
  const cli = resolveOpencodeCli(workflowRoot);
  return fs.existsSync(cli) ? null : `opencode runtime file is missing: ${cli}. Run npm run build:opencode-runtime to build the runtime from third_party/opencode first.`;
}

export function usesOpencodeProviderBinding(engine: AgentExecutionEngine): boolean {
  return engine === "opencode";
}

export function resolveBindingStorageKey(engine: AgentExecutionEngine): AgentExecutionEngine {
  return engine;
}

export function resolveExecutableOnPath(command: string): string {
  return command;
}

export function executableExists(command: string): boolean {
  return Boolean(command) && fs.existsSync(command);
}

const ENGINE_LABELS: Record<AgentExecutionEngine, string> = {
  opencode: "opencode",
};

export function listExecutionEngineMeta(): Array<{
  id: AgentExecutionEngine;
  label: string;
  available: boolean;
  hint: string;
}> {
  return [
    {
      id: "opencode",
      label: ENGINE_LABELS.opencode,
      available: true,
      hint: "Only execution backend: local opencode serve with the official SDK/SSE event stream.",
    },
  ];
}

export interface ProbeAgentExecutionResult {
  engine: AgentExecutionEngine;
  ok: boolean;
  commandDisplay: string | null;
  error: string | null;
}

export function probeAgentExecution(
  engine: AgentExecutionEngine,
  settings?: AgentExecutionSettingsLike | null,
  workflowRoot?: string | null,
): ProbeAgentExecutionResult {
  void settings;
  if (engine !== "opencode") {
    return { engine, ok: false, commandDisplay: null, error: `Unknown engine: ${engine}` };
  }
  const blocker = resolveRuntimeReadinessBlocker(engine, workflowRoot);
  if (blocker) {
    return { engine, ok: false, commandDisplay: null, error: blocker };
  }
  const cli = workflowRoot ? resolveOpencodeCli(workflowRoot) : "opencode";
  return {
    engine,
    ok: true,
    commandDisplay: `${cli} serve`,
    error: null,
  };
}

export { materializeOpencodeEnv };
