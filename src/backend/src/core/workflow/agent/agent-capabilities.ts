import fs from "node:fs";
import path from "node:path";

import { isOpencodeOnlyMode } from "../../../../../contract/opencode-only.ts";
import { DEFAULT_OPENCODE_TOOLS } from "../../llm/opencode/build-profile.ts";
import {
  ensureWritableWorkflowFile,
  resolveFromWorkflowRoot,
  resolveOpencodeAgentsMdSource,
  resolveOpencodeSkillsSourceDir,
  resolveShippedRoot,
  resolveWorkflowRoot,
} from "../../workspace-paths.ts";
import { loadAgentRegistry } from "./agent-registry.ts";

export interface ToolManifestEntry {
  id: string;
  kind: string;
  layer: string;
  title: string;
  description: string;
  readOnly?: boolean;
  /**
   * 唯一的「只读会话写入」豁免：标 true 表示这工具的唯一副作用是**登记待放置事件**（生成待用户拖放
   * 落地的待放置事件，绝不直接改工程、绝不自动放置）。只读工作流子 agent 保留这类工具，其余会写工具
   * 仍一律关死。readOnly 保持诚实（这工具确实会写），由本旗标单独标出这一处受控豁免。
   */
  stagingSafe?: boolean;
  defaultAllow?: boolean;
  riskLevel?: ToolRiskLevel;
  riskBadges?: ToolRiskBadge[];
  userToggleable?: boolean;
  requires?: ToolAvailabilityRequirement[];
}

export type ToolRiskLevel = "normal" | "high" | "experimental";
export type ToolRiskBadge = Exclude<ToolRiskLevel, "normal">;

export type ToolAvailabilityRequirement =
  | { type: "envTruthy"; name: string; description?: string }
  | { type: "envEquals"; name: string; value: string; description?: string }
  | { type: "platform"; value: NodeJS.Platform; description?: string }
  | { type: "feature"; name: string; description?: string }
  | { type: "nodeEnv"; value: string; description?: string }
  | { type: "runtimeFiltered"; description: string };

export interface McpManifestEntry {
  id: string;
  title: string;
  description: string;
  managedBy?: string;
  userToggleable?: boolean;
}

export interface ToolManifest {
  version: number;
  tools: ToolManifestEntry[];
  mcpServers: McpManifestEntry[];
}

export interface CapabilityToolEntry {
  id: string;
  kind: string;
  layer: string;
  title: string;
  description: string;
  readOnly: boolean;
  riskLevel: ToolRiskLevel;
  riskBadges: ToolRiskBadge[];
  allowed: boolean;
  denied: boolean;
  inAgentRuntimeProfile: boolean;
  inAgentAllow: boolean;
  available: boolean;
  toggleable: boolean;
  disabledReason?: string | null;
  requiresNewSession: boolean;
  warning?: string | null;
}

type AgentRuntimeWithTools = {
  defaultProfileConfig?: {
    tools?: string[];
  } | null;
};

export interface McpServerSnapshot {
  id: string;
  title: string;
  description: string;
  type?: string;
  url?: string;
  enabled: boolean;
  managedBy?: string;
  userToggleable: boolean;
  runtimeInjected?: boolean;
}

export interface SkillSnapshot {
  path: string;
  absolutePath: string;
  title: string;
  description: string;
  enabled: boolean;
}

export interface RuleSnapshot {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  category: string;
  layer: "developer" | "agentPolicy";
  description?: string;
}

export interface AgentPolicySnapshot {
  note?: string | null;
  allowCount: number;
  denyCount: number;
  deny: string[];
}

export interface AgentCapabilitiesSnapshot {
  generatedAt: string;
  workflowRoot: string;
  repoRoot: string | null;
  engine: string | null;
  builtinTools: CapabilityToolEntry[];
  mcpServers: McpServerSnapshot[];
  skills: SkillSnapshot[];
  rules: RuleSnapshot[];
  agentPolicy: AgentPolicySnapshot;
  manifestPath: string;
}

const DEFAULT_AGENT_ID = "default";
const MANIFEST_REL = "config/capabilities/tool-manifest.json";
type EnvironmentLike = Record<string, string | undefined>;

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonAgentConfig(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function resolveRepoRoot(workflowRoot: string): string | null {
  const parent = path.dirname(workflowRoot);
  if (fs.existsSync(path.join(parent, "AGENTS.md"))) return parent;
  if (fs.existsSync(path.join(parent, ".git"))) return parent;
  return null;
}

export function loadToolManifest(workflowRoot: string): ToolManifest {
  const manifestPath = resolveFromWorkflowRoot(workflowRoot, MANIFEST_REL);
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, tools: [], mcpServers: [] };
  }
  return readJsonFile<ToolManifest>(manifestPath);
}

export function summarizeSkillMarkdown(
  text: string,
  relPath = "",
): { title: string; description: string } {
  const trimmed = text.replace(/^\uFEFF/, "");
  const frontmatter = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  let title = "";
  let description = "";

  if (frontmatter) {
    const block = frontmatter[1];
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const titleMatch = block.match(/^title:\s*(.+)$/m);
    const descMatch = block.match(/^description:\s*(.+)$/m);
    title = (nameMatch?.[1] || titleMatch?.[1] || "").trim();
    description = (descMatch?.[1] || "").trim();
  }

  if (!title) {
    const body = frontmatter ? trimmed.slice(frontmatter[0].length) : trimmed;
    const heading = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("#"));
    if (heading) title = heading.replace(/^#+\s*/, "");
  }

  if (!title && relPath) {
    const normalized = relPath.replace(/\\/g, "/");
    const parentDir = path.posix.basename(path.posix.dirname(normalized));
    if (parentDir && parentDir !== "skills" && parentDir !== "opencode") {
      title = parentDir;
    }
  }

  if (!title) {
    title = relPath ? path.posix.basename(relPath) : "Untitled";
  }

  if (!description) {
    const body = frontmatter ? trimmed.slice(frontmatter[0].length) : trimmed;
    const line = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
    description = line || "";
  }

  return { title, description: description.slice(0, 280) };
}

function listAgentRuntimeRules(workflowRoot: string): RuleSnapshot[] {
  const agentsMd = resolveOpencodeAgentsMdSource(workflowRoot);
  if (!fs.existsSync(agentsMd)) return [];
  const rel = path.relative(workflowRoot, agentsMd).replace(/\\/g, "/");
  return [{
    id: rel,
    title: "AGENTS",
    path: rel,
    absolutePath: agentsMd,
    category: "rules",
    layer: "developer",
  }];
}

function listAgentReferenceDocs(workflowRoot: string): RuleSnapshot[] {
  const out: RuleSnapshot[] = [];
  const shippedRoot = resolveShippedRoot(workflowRoot);
  const docsRoot = path.join(shippedRoot, "config", "agents", DEFAULT_AGENT_ID, "docs");
  if (!fs.existsSync(docsRoot)) return out;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "rules") continue;
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const rel = path.relative(shippedRoot, abs).replace(/\\/g, "/");
      out.push({
        id: rel,
        title: entry.name.replace(/\.md$/, ""),
        path: rel,
        absolutePath: abs,
        category: "docs",
        layer: "developer",
      });
    }
  };
  walk(docsRoot);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function isAllowed(allow: string[], deny: string[], toolId: string): boolean {
  const normalizedDeny = new Set(deny.map((d) => d.toLowerCase()));
  if (normalizedDeny.has(toolId.toLowerCase())) return false;
  return isInAllowList(allow, toolId);
}

function isInAllowList(allow: string[], toolId: string): boolean {
  const loweredToolId = toolId.toLowerCase();
  return allow.some((entry) => {
    const lowered = entry.toLowerCase();
    if (lowered === loweredToolId) return true;
    if (lowered.endsWith("*")) return loweredToolId.startsWith(lowered.slice(0, -1));
    return false;
  });
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function normalizeRiskLevel(level: unknown): ToolRiskLevel {
  if (level === "high" || level === "experimental") return level;
  return "normal";
}

function normalizeRiskBadges(tool: ToolManifestEntry): ToolRiskBadge[] {
  const out: ToolRiskBadge[] = [];
  const push = (badge: unknown) => {
    if (badge !== "high" && badge !== "experimental") return;
    if (!out.includes(badge)) out.push(badge);
  };
  if (Array.isArray(tool.riskBadges)) {
    for (const badge of tool.riskBadges) push(badge);
  }
  push(normalizeRiskLevel(tool.riskLevel));
  return out;
}

function describeRequirement(req: ToolAvailabilityRequirement): string {
  if (req.description) return req.description;
  if (req.type === "envTruthy") return `Environment variable ${req.name} must be enabled`;
  if (req.type === "envEquals") return `Environment variable ${req.name}=${req.value} is required`;
  if (req.type === "platform") return `Only ${req.value} platform is supported`;
  if (req.type === "nodeEnv") return `Only available when NODE_ENV=${req.value}`;
  if (req.type === "feature") return `opencode build feature ${req.name} is required`;
  return req.description;
}

function requirementMet(req: ToolAvailabilityRequirement, workflowRoot: string, env: EnvironmentLike = process.env): boolean {
  if (req.type === "envTruthy") return isEnvTruthy(env[req.name]);
  if (req.type === "envEquals") return env[req.name] === req.value;
  if (req.type === "platform") return process.platform === req.value;
  if (req.type === "nodeEnv") return env.NODE_ENV === req.value;
  if (req.type === "feature") return false;
  if (req.type === "runtimeFiltered") return false;
  return false;
}

function evaluateToolAvailability(tool: ToolManifestEntry, workflowRoot: string, env: EnvironmentLike = process.env): {
  available: boolean;
  disabledReason: string | null;
} {
  for (const req of tool.requires || []) {
    if (!requirementMet(req, workflowRoot, env)) {
      return { available: false, disabledReason: describeRequirement(req) };
    }
  }
  return { available: true, disabledReason: null };
}

function canToggleTool(tool: ToolManifestEntry, available: boolean): boolean {
  if (!available) return false;
  if (tool.userToggleable === false) return false;
  return tool.kind === "builtin" || tool.kind === "mcp";
}

function resolveDisabledReason(
  tool: ToolManifestEntry,
  available: boolean,
  disabledReason: string | null,
): string | null {
  if (disabledReason) return disabledReason;
  if (tool.userToggleable === false) return "This tool is managed by the opencode runtime and cannot be enabled from Settings";
  if (!available) return "The current runtime environment does not meet this tool's requirements";
  return null;
}

export function resolveEnabledAgentRuntimeTools(
  workflowRootInput?: string,
  options?: { env?: EnvironmentLike },
): string[] {
  const workflowRoot = workflowRootInput
    ? path.resolve(workflowRootInput)
    : resolveWorkflowRoot();
  const manifest = loadToolManifest(workflowRoot);
  const registry = loadAgentRegistry({ workflowRoot });
  const agent = registry.agents[DEFAULT_AGENT_ID] || null;
  const allow: string[] = (agent?.tools?.allow as string[]) || [];
  const deny: string[] = (agent?.tools?.deny as string[]) || [];
  const enabled: string[] = [];
  for (const tool of manifest.tools) {
    if (tool.kind !== "builtin" && tool.kind !== "mcp") continue;
    const { available } = evaluateToolAvailability(tool, workflowRoot, options?.env);
    if (!available) continue;
    if (!isAllowed(allow, deny, tool.id)) continue;
    enabled.push(tool.id);
  }
  return enabled;
}

export function resolveEnabledAgentRuntimeBuiltinTools(
  workflowRootInput?: string,
  options?: { env?: EnvironmentLike },
): string[] {
  const workflowRoot = workflowRootInput
    ? path.resolve(workflowRootInput)
    : resolveWorkflowRoot();
  const manifest = loadToolManifest(workflowRoot);
  const enabled = new Set(resolveEnabledAgentRuntimeTools(workflowRoot, options));
  return manifest.tools
    .filter((tool) => tool.kind === "builtin" && enabled.has(tool.id))
    .map((tool) => tool.id);
}

export function buildOpencodeToolPolicyFromAgentAllow(
  workflowRootInput?: string,
  options?: { env?: EnvironmentLike; readOnly?: boolean },
): Record<string, boolean> {
  const workflowRoot = workflowRootInput
    ? path.resolve(workflowRootInput)
    : resolveWorkflowRoot();
  const manifest = loadToolManifest(workflowRoot);
  const registry = loadAgentRegistry({ workflowRoot });
  const agent = registry.agents[DEFAULT_AGENT_ID] || null;
  const allow: string[] = (agent?.tools?.allow as string[]) || [];
  const deny: string[] = (agent?.tools?.deny as string[]) || [];
  const policy: Record<string, boolean> = {};
  for (const tool of manifest.tools) {
    if (tool.kind !== "builtin" && tool.kind !== "mcp") continue;
    const { available } = evaluateToolAvailability(tool, workflowRoot, options?.env);
    const allowed = available && isAllowed(allow, deny, tool.id);
    // Read-only sessions (isolated workflow subagents) hard-disable every tool not flagged
    // read-only in the manifest — edits, writes, bash, subagent spawn, and the mutating RMMV
    // MCP tools all turn off. This is the real enforcement: the `readOnly` flag is not advisory.
    // The single carve-out: stagingSafe tools (whose only side effect is registering a
    // pending-placement event) stay on for read-only workflow subagents — they are forced on by
    // availability alone (not gated by the agent allow-list), since they exist solely to let a
    // read-only workflow stage event drafts for the user to place. They never reach a normal
    // session (not in the allow-list → the non-readOnly branch leaves them off).
    if (options?.readOnly) {
      policy[tool.id] = tool.stagingSafe === true ? available : (allowed && tool.readOnly === true);
    } else {
      policy[tool.id] = allowed;
    }
  }
  return policy;
}

export function hasEnabledRmmvMcpTools(
  workflowRootInput?: string,
  options?: { env?: EnvironmentLike },
): boolean {
  return resolveEnabledAgentRuntimeTools(workflowRootInput, options).some((toolId) => toolId.startsWith("rmmv_"));
}

export function getAgentCapabilitiesSnapshot(
  workflowRootInput?: string,
  options?: { engine?: string | null },
): AgentCapabilitiesSnapshot {
  const workflowRoot = workflowRootInput
    ? path.resolve(workflowRootInput)
    : resolveWorkflowRoot();
  const manifest = loadToolManifest(workflowRoot);
  const manifestPath = resolveFromWorkflowRoot(workflowRoot, MANIFEST_REL);
  const registry = loadAgentRegistry({ workflowRoot });
  const agent = registry.agents[DEFAULT_AGENT_ID] || null;
  const allow: string[] = (agent?.tools?.allow as string[]) || [];
  const deny: string[] = (agent?.tools?.deny as string[]) || [];
  const engine = options?.engine ?? null;
  const usesAgentRuntimeBuiltinTools = engine === "opencode";
  const runtimeEnv: EnvironmentLike = process.env;
  const runtime = agent?.runtime as AgentRuntimeWithTools | undefined;
  const profileTools: string[] = usesAgentRuntimeBuiltinTools
    ? resolveEnabledAgentRuntimeBuiltinTools(workflowRoot, { env: runtimeEnv })
    : runtime?.defaultProfileConfig?.tools || [...DEFAULT_OPENCODE_TOOLS];

  const builtinTools: CapabilityToolEntry[] = manifest.tools.map((tool) => {
    const inAgentAllow = isInAllowList(allow, tool.id);
    const denied = deny.some((d) => d.toLowerCase() === tool.id.toLowerCase());
    const allowed = isAllowed(allow, deny, tool.id);
    const { available, disabledReason } = evaluateToolAvailability(tool, workflowRoot, runtimeEnv);
    const toggleable = canToggleTool(tool, available);
    const inAgentRuntimeProfile = tool.kind === "mcp"
      ? isAllowed(allow, deny, tool.id) && available
      : usesAgentRuntimeBuiltinTools
        ? profileTools.includes(tool.id)
        : (runtime?.defaultProfileConfig?.tools || []).includes(tool.id);
    let warning: string | null = null;
    if (tool.kind === "builtin" && allowed && !inAgentRuntimeProfile && usesAgentRuntimeBuiltinTools && available) {
      warning = "Allowed by runtime policy, but the opencode profile does not include this builtin tool";
    }
    if (tool.kind === "builtin" && allowed && !available) {
      warning = "Allowed by runtime policy, but the current runtime environment does not meet the enablement requirements";
    }
    return {
      id: tool.id,
      kind: tool.kind,
      layer: tool.layer,
      title: tool.title,
      description: tool.description,
      readOnly: Boolean(tool.readOnly),
      riskLevel: normalizeRiskLevel(tool.riskLevel),
      riskBadges: normalizeRiskBadges(tool),
      allowed,
      denied,
      inAgentRuntimeProfile,
      inAgentAllow,
      available,
      toggleable,
      disabledReason: resolveDisabledReason(tool, available, disabledReason),
      requiresNewSession: true,
      warning,
    };
  });

  const mcpServers: McpServerSnapshot[] = manifest.mcpServers.map((def) => {
    const rmmvEnabled = def.id === "rmmv" ? hasEnabledRmmvMcpTools(workflowRoot, { env: runtimeEnv }) : true;
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      enabled: rmmvEnabled,
      managedBy: def.managedBy,
      userToggleable: false,
      runtimeInjected: def.managedBy === "session-runtime",
    };
  });

  const nativeSkills = isOpencodeOnlyMode();
  const enabledSkillPaths = new Set(
    (agent?.skills || []).map((s) => s.replace(/\\/g, "/")),
  );
  const skillFiles = new Map<string, string>();
  if (nativeSkills) {
    const opencodeSkillsRoot = resolveOpencodeSkillsSourceDir(workflowRoot);
    if (fs.existsSync(opencodeSkillsRoot)) {
      for (const entry of fs.readdirSync(opencodeSkillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(opencodeSkillsRoot, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        const rel = path.relative(workflowRoot, skillMd).replace(/\\/g, "/");
        skillFiles.set(rel, skillMd);
      }
    }
  } else {
    for (const skillPath of agent?.paths?.skills || []) {
      const abs = path.isAbsolute(skillPath) ? skillPath : path.resolve(workflowRoot, skillPath);
      const rel = path.relative(workflowRoot, abs).replace(/\\/g, "/");
      skillFiles.set(rel, abs);
    }
    if (agent?.paths?.config) {
      const skillsDir = path.join(path.dirname(agent.paths.config), "skills");
      if (fs.existsSync(skillsDir)) {
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
          const abs = path.join(skillsDir, entry.name);
          const rel = path.relative(workflowRoot, abs).replace(/\\/g, "/");
          skillFiles.set(rel, abs);
        }
      }
    }
  }
  const skills: SkillSnapshot[] = [...skillFiles.entries()].map(([rel, abs]) => {
    const raw = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const { title, description } = summarizeSkillMarkdown(raw, rel);
    return {
      path: rel,
      absolutePath: abs,
      title,
      description,
      enabled: nativeSkills ? true : enabledSkillPaths.has(rel),
    };
  });

  const repoRoot = resolveRepoRoot(workflowRoot);
  const rules: RuleSnapshot[] = [
    ...listAgentRuntimeRules(workflowRoot),
    ...listAgentReferenceDocs(workflowRoot),
  ];
  const policyNote =
    agent?.tools && typeof agent.tools._note === "string" ? agent.tools._note : null;

  return {
    generatedAt: new Date().toISOString(),
    workflowRoot,
    repoRoot,
    engine: options?.engine ?? null,
    builtinTools,
    mcpServers,
    skills,
    rules,
    agentPolicy: {
      note: policyNote,
      allowCount: allow.length,
      denyCount: deny.length,
      deny: [...deny],
    },
    manifestPath,
  };
}

function getAgentConfigPath(workflowRoot: string): string {
  const registry = loadAgentRegistry({ workflowRoot });
  const agent = registry.agents[DEFAULT_AGENT_ID];
  const rel = agent?.registryEntry?.path;
  if (!rel) throw new Error("Default executor config not found");
  return ensureWritableWorkflowFile(workflowRoot, rel);
}

export function updateAgentToolAllow(
  workflowRoot: string,
  toolId: string,
  allowed: boolean,
): AgentCapabilitiesSnapshot {
  const manifest = loadToolManifest(workflowRoot);
  const tool = manifest.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error(`Unknown tool id: ${toolId}`);
  const { available, disabledReason } = evaluateToolAvailability(tool, workflowRoot);
  if (!canToggleTool(tool, available)) {
    const reason = resolveDisabledReason(tool, available, disabledReason) || "This tool cannot be toggled from Settings";
    throw new Error(`${toolId} cannot be toggled: ${reason}`);
  }
  const configPath = getAgentConfigPath(workflowRoot);
  const doc = readJsonFile<Record<string, unknown>>(configPath);
  const tools = (doc.tools || {}) as { allow?: string[]; deny?: string[]; [key: string]: unknown };
  const allow = Array.isArray(tools.allow) ? [...tools.allow] : [];
  const deny = Array.isArray(tools.deny) ? [...tools.deny] : [];
  const idx = allow.findIndex((e) => e === toolId);
  const denyIdx = deny.findIndex((e) => e.toLowerCase() === toolId.toLowerCase());

  if (allowed) {
    if (idx < 0) allow.push(toolId);
    if (denyIdx >= 0) deny.splice(denyIdx, 1);
  } else if (idx >= 0) {
    allow.splice(idx, 1);
  }

  doc.tools = { ...tools, allow, deny };
  writeJsonAgentConfig(configPath, doc);
  return getAgentCapabilitiesSnapshot(workflowRoot, { engine: "opencode" });
}

export function updateMcpServerEnabled(
  workflowRoot: string,
  serverId: string,
  enabled: boolean,
): AgentCapabilitiesSnapshot {
  void workflowRoot;
  void enabled;
  throw new Error(`MCP server ${serverId} is managed by opencode runtime and cannot be toggled here`);
}

export function updateAgentSkillEnabled(
  workflowRoot: string,
  skillPath: string,
  enabled: boolean,
): AgentCapabilitiesSnapshot {
  const configPath = getAgentConfigPath(workflowRoot);
  const doc = readJsonFile<Record<string, unknown>>(configPath);
  const skills = Array.isArray(doc.skills) ? [...(doc.skills as string[])] : [];
  const normalized = skillPath.replace(/\\/g, "/");
  const idx = skills.findIndex((s) => s.replace(/\\/g, "/") === normalized);
  if (enabled && idx < 0) skills.push(normalized);
  if (!enabled && idx >= 0) skills.splice(idx, 1);
  doc.skills = skills;
  writeJsonAgentConfig(configPath, doc);
  return getAgentCapabilitiesSnapshot(workflowRoot);
}
