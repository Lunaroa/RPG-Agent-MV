import { buildOpencodeRmmvMcpConfig } from "../opencode/config.ts";

/** opencode MCP config for RMMV tools only. */
export function buildRmmvMcpConfig(workflowRoot: string): Record<string, unknown> {
  return {
    mcp: {
      rmmv: buildOpencodeRmmvMcpConfig(workflowRoot),
    },
  };
}

export function buildRmmvMcpConfigJson(workflowRoot: string): string {
  return JSON.stringify(buildRmmvMcpConfig(workflowRoot));
}

/** opencode exposes MCP tools as `<server>_<tool>` ids. */
export const RMMV_MCP_ALLOWED_TOOLS = "rmmv_*";
