import { MEMORY_INDEX_MAX_BYTES, readIndex, readUserProfile, readWorkManual } from "./memory-store.ts";
import { resolveProjectMemoryDir } from "../workspace-paths.ts";

/** Defensive cap on the shared profile, same magnitude as the index. */
const USER_PROFILE_MAX_BYTES = MEMORY_INDEX_MAX_BYTES;

export interface MemoryPreambleParts {
  projectId: string;
  memoryDir: string;
  /** Shared author profile (`USER.md`), verbatim; cross-project. Empty ⇒ omitted. */
  userProfile: string;
  /** Project work manual (`AGENTS.md`), verbatim. */
  workManual: string;
  /** Long-term index (`MEMORY.md`), already capped on write; defensively re-capped here. */
  index: string;
  /** Recalled topic bodies (selected by the recall side-query); empty ⇒ no recall section. */
  recalledBodies?: RecalledBody[];
}

export interface RecalledBody {
  slug: string;
  name: string;
  body: string;
}

/**
 * Read the active project's always-on memory and compose the injected preamble.
 *
 * Mirrors Claude Code's `buildMemoryPrompt`: as long as there is a resolvable
 * project scope, the memory rules are ALWAYS injected — even when memory is empty
 * — with an "empty" placeholder, so the agent knows from turn 1 that it has a
 * memory system and how to bootstrap it. Returns "" only when no project scope is
 * resolvable (shared-only).
 */
export function buildMemoryPreamble(workflowRoot: string, projectId: string | null): string {
  if (!projectId) return "";
  return composeMemoryPreamble(readMemoryPreambleParts(workflowRoot, projectId));
}

/**
 * Gather the always-on (synchronous, IO) parts of the preamble for a resolved project.
 * Recall bodies are NOT loaded here (that is an async side-query); the async dispatch path
 * adds them via `recalledBodies` before calling `composeMemoryPreamble`.
 */
export function readMemoryPreambleParts(workflowRoot: string, projectId: string): MemoryPreambleParts {
  return {
    projectId,
    memoryDir: resolveProjectMemoryDir(workflowRoot, projectId),
    userProfile: readUserProfile(workflowRoot),
    workManual: readWorkManual(workflowRoot, projectId),
    index: readIndex(workflowRoot, projectId),
  };
}

/**
 * `full` (fresh session): profile + rules + work manual + index + recalled bodies.
 * `incremental` (continuation turn): ONLY the newly-recalled bodies — profile/rules/index were
 * already injected at session start, so re-emitting them every turn would be pure noise.
 */
export type MemoryPreambleMode = "full" | "incremental";

/** Pure composer — separated from file IO so it is directly unit-testable. */
export function composeMemoryPreamble(parts: MemoryPreambleParts, mode: MemoryPreambleMode = "full"): string {
  const recalled = (parts.recalledBodies || []).filter((r) => r && r.body.trim());

  // Continuation turns carry nothing but freshly-surfaced bodies; empty recall ⇒ inject nothing.
  if (mode === "incremental") {
    if (recalled.length === 0) return "";
    const out: string[] = ["## Newly relevant memory (for this turn)"];
    for (const r of recalled) {
      out.push("");
      out.push(`### ${r.name || r.slug}`);
      out.push("");
      out.push(r.body.trim());
    }
    return out.join("\n").trimEnd();
  }

  const userProfile = capBytes(parts.userProfile.trim(), USER_PROFILE_MAX_BYTES);
  const workManual = parts.workManual.trim();
  const index = capBytes(parts.index.trim(), MEMORY_INDEX_MAX_BYTES);

  const lines: string[] = [];
  lines.push("# Memory (persistent across sessions)");
  lines.push("");
  // Shared author profile (USER.md) — cross-project, verbatim, above project-specific memory.
  if (userProfile) {
    lines.push("## About the author (shared across projects)");
    lines.push("");
    lines.push(userProfile);
    lines.push("");
  }
  // Memory-dir location + DIR_EXISTS guidance (don't waste a turn checking/creating it) +
  // how-to-write + what-not-to-save, mirroring Claude Code's buildMemoryLines().
  lines.push(
    `Your durable memory for this project lives at \`${parts.memoryDir.replace(/\\/g, "/")}\`. `
    + "This directory is managed for you — do not waste a turn checking or creating it; the write "
    + "action creates it as needed. It survives across sessions. Use the `RmmvMemory` tool to read "
    + "or update it: `list` to see topics, `read` to load a topic body, `write` to add or revise a "
    + "durable note (with name/description/type), `remove` to drop one. Record only durable soft "
    + "knowledge (character voice, user taste, rejected approaches, staging conventions, "
    + "cross-session decisions). Keep hard facts (events, outline, switches/variables) in their "
    + "existing stores; a memory may point at a record but must not copy it.",
  );
  lines.push("");
  // Searching-past-context guidance (Claude Code's buildSearchingPastContextSection equivalent).
  lines.push(
    "When you need prior context, read `MEMORY.md` first, then open only the specific topic files "
    + "it indexes — do not load everything. If a memory references a file or record, verify it still "
    + "exists before relying on it.",
  );
  lines.push("");

  if (workManual) {
    lines.push("## Work manual");
    lines.push("");
    lines.push(workManual);
    lines.push("");
  }
  // The MEMORY.md index is ALWAYS present, with an empty placeholder when there is nothing yet.
  lines.push("## MEMORY.md");
  lines.push("");
  lines.push(index || "Your MEMORY.md is currently empty. When you save new memories, they will appear here.");
  // Recalled topic bodies (relevant-recall side-query). Only present when recall selected topics.
  if (recalled.length > 0) {
    lines.push("");
    lines.push("## Recalled memory (most relevant to this task)");
    for (const r of recalled) {
      lines.push("");
      lines.push(`### ${r.name || r.slug}`);
      lines.push("");
      lines.push(r.body.trim());
    }
  }
  return lines.join("\n").trimEnd();
}

function capBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  // Truncate on a character boundary safely under the byte cap.
  let out = text;
  while (Buffer.byteLength(out, "utf8") > maxBytes && out.length > 0) {
    out = out.slice(0, Math.max(0, out.length - 64));
  }
  return `${out}\n… (truncated)`;
}
