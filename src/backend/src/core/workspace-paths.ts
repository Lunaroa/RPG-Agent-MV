import fs from "node:fs";
import path from "node:path";

/** Top-level product directory name (formerly `workspace/`). */
export const PRODUCT_DIR_NAME = "RPG-Agent-MV";

export const WORKSPACE_LAYERS = {
  config: "config",
  src: "src",
  data: "data",
  runtime: "runtime",
} as const;

/** Relative paths from workflow root (P3 four-layer layout). */
export const PATHS = {
  agentsRegistry: "config/agents/registry.yaml",
  dataDb: "data/rmmv.db",
  runtimeRoot: "runtime",
  backendCli: "src/backend/src/cli.ts",
  pyRoot: "src/py",
  pyRootLegacy: "py",
  cliOutRoot: "runtime/out",
  cliOutRootLegacy: "out",
  opencodeCli: "runtime/out/opencode/windows-x64/opencode.exe",
  opencodeResourceCli: process.platform === "win32"
    ? "opencode/opencode.exe"
    : "opencode/opencode",
  opencodeRipgrep: process.platform === "win32"
    ? "runtime/out/opencode/windows-x64/rg.exe"
    : "runtime/out/opencode/windows-x64/rg",
  opencodeResourceRipgrep: process.platform === "win32"
    ? "opencode/rg.exe"
    : "opencode/rg",
  OpencodeConfigDir: ".opencode",
} as const;

function isEmptyDirectory(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).length === 0;
}

const WORKFLOW_ROOT_MARKERS: readonly string[][] = [
  [PATHS.agentsRegistry],
  [WORKSPACE_LAYERS.src, "backend"],
  [PATHS.backendCli],
];

function hasMarkers(root: string, markers: readonly string[]): boolean {
  return markers.every((segment) => fs.existsSync(path.join(root, segment)));
}

/**
 * Resolve workflow root: explicit env first, then walk parents for layout markers.
 */
export function resolveWorkflowRoot(fromDir?: string): string {
  const env =
    process.env.AGENT_RPG_ROOT?.trim() ||
    process.env.AIWF_WORKFLOW_ROOT?.trim() ||
    process.env.RMMV_AGENT_WORKFLOW_ROOT?.trim();
  if (env) return path.resolve(env);

  const start = fromDir ? path.resolve(fromDir) : process.cwd();
  let current = start;
  while (true) {
    for (const markers of WORKFLOW_ROOT_MARKERS) {
      if (hasMarkers(current, markers)) return current;
    }
    // Check nested product directories used by source checkouts and packaged layouts.
    for (const dirName of [PRODUCT_DIR_NAME, "workspace"]) {
      const nested = path.join(current, dirName);
      for (const markers of WORKFLOW_ROOT_MARKERS) {
        if (hasMarkers(nested, markers)) return nested;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot resolve RPG-Agent-MV product root from ${start}`);
}

export function resolveFromWorkflowRoot(workflowRoot: string, rel: string): string {
  return path.resolve(workflowRoot, rel);
}

export function resolveAgentsRegistryPath(workflowRoot: string): string {
  return path.join(workflowRoot, PATHS.agentsRegistry);
}

/** Canonical agents directory relative to workflow root. */
export function agentsDirRel(): string {
  return "config/agents";
}

/** Resolve agents-relative path (e.g. default agent docs) under the canonical config tree. */
export function resolveAgentsPath(workflowRoot: string, ...segments: string[]): string {
  return path.join(workflowRoot, "config", "agents", ...segments);
}

/**
 * Resolve CLI output root under runtime/out; one-time migrate legacy top-level out/ contents.
 */
export function resolveCliOutRoot(workflowRoot: string): string {
  const root = path.resolve(workflowRoot);
  const canonical = path.join(root, PATHS.cliOutRoot);
  const legacy = path.join(root, PATHS.cliOutRootLegacy);

  fs.mkdirSync(canonical, { recursive: true });

  if (fs.existsSync(legacy)) {
    for (const entry of fs.readdirSync(legacy)) {
      const src = path.join(legacy, entry);
      const dest = path.join(canonical, entry);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.renameSync(src, dest);
    }
    if (isEmptyDirectory(legacy)) {
      fs.rmdirSync(legacy);
    }
  }

  return canonical;
}

/** Absolute path to the pinned opencode executable. */
export function resolveOpencodeCli(workflowRoot: string): string {
  const packaged = process.env.AGENT_RPG_OPENCODE_BIN?.trim();
  if (packaged) return path.resolve(packaged);

  const resourcesRoot = process.env.AGENT_RPG_RESOURCES_PATH?.trim();
  if (resourcesRoot) {
    return path.join(path.resolve(resourcesRoot), PATHS.opencodeResourceCli);
  }

  return path.join(path.resolve(workflowRoot), PATHS.opencodeCli);
}

/**
 * Absolute path to the bundled ripgrep executable shipped alongside the opencode
 * runtime. The opencode binary searches PATH (plus its own cache) for `rg`; the
 * backend points it at this bundled copy so packaged installs never download
 * ripgrep at runtime.
 */
export function resolveOpencodeRipgrep(workflowRoot: string): string {
  const explicit = process.env.AGENT_RPG_RIPGREP_BIN?.trim();
  if (explicit) return path.resolve(explicit);

  const resourcesRoot = process.env.AGENT_RPG_RESOURCES_PATH?.trim();
  if (resourcesRoot) {
    return path.join(path.resolve(resourcesRoot), PATHS.opencodeResourceRipgrep);
  }

  return path.join(path.resolve(workflowRoot), PATHS.opencodeRipgrep);
}

/** Node executable for local MCP servers. Packaged Electron falls back to its runtime Node. */
export function resolveAgentNodeCommand(
  _workflowRoot: string,
  _platform = process.platform,
  _arch = process.arch,
  execPath = process.execPath,
): string {
  return execPath;
}

/** Absolute path to product-anchored opencode config/state. */
export function resolveOpencodeConfigDir(workflowRoot: string): string {
  return path.join(workflowRoot, PATHS.OpencodeConfigDir);
}

/** Shipped opencode config tree (rules, skills source, instructions). */
export function resolveOpencodeProductConfigDir(workflowRoot: string): string {
  return path.join(workflowRoot, WORKSPACE_LAYERS.config, "opencode");
}

/** Canonical agent rules committed with the product (synced to `.opencode/AGENTS.md` at runtime). */
export function resolveOpencodeAgentsMdSource(workflowRoot: string): string {
  return path.join(resolveOpencodeProductConfigDir(workflowRoot), "AGENTS.md");
}

/** Runtime copy of agent rules loaded by opencode via `OPENCODE_CONFIG_DIR`. */
export function resolveOpencodeAgentsMdRuntime(workflowRoot: string): string {
  return path.join(resolveOpencodeConfigDir(workflowRoot), "AGENTS.md");
}

export function resolveOpencodePersonalPreferencesPath(workflowRoot: string): string {
  return path.join(resolveOpencodeProductConfigDir(workflowRoot), "instructions", "personal-preferences.md");
}

/** Product-authored skills loaded by opencode `skills.paths`. */
export function resolveOpencodeSkillsSourceDir(workflowRoot: string): string {
  return path.join(resolveOpencodeProductConfigDir(workflowRoot), "skills");
}

/** User-published skill drafts under project-local opencode state. */
export function resolveOpencodeSkillsDir(workflowRoot: string): string {
  return path.join(resolveOpencodeConfigDir(workflowRoot), "skills");
}

/**
 * Durable agent memory root, product-anchored under `.opencode/memory/main`.
 *
 * This lives in a `.opencode/` subdir opencode's native project discovery does
 * NOT scan, and is never registered with opencode's instruction loader — the
 * backend is the sole reader/injector. Unlike `.opencode/runtime/`, this tree is
 * durable and must not be pruned. See the agent-memory design doc.
 */
export function resolveMemoryRoot(workflowRoot: string): string {
  return path.join(resolveOpencodeConfigDir(workflowRoot), "memory", "main");
}

/** Shared user profile (用户画像), one per author, across all projects (used from Phase 2). */
export function resolveMemoryUserProfilePath(workflowRoot: string): string {
  return path.join(resolveMemoryRoot(workflowRoot), "USER.md");
}

/**
 * Per-project long-term memory directory: `memory/main/<projectId>/`.
 *
 * `projectId` is the canonical project key (basename of the RMMV project root),
 * the same id `event_contracts.project_id` uses, so memory partitions line up
 * with the hard-fact SQLite stores.
 */
export function resolveProjectMemoryDir(workflowRoot: string, projectId: string): string {
  return path.join(resolveMemoryRoot(workflowRoot), projectId);
}

